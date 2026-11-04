// The in-app Claude assistant (Anthropic API, user's own key) and Claude-drawn SVG graphics.
// Requests go straight from this app to api.anthropic.com; the key never leaves this machine otherwise.
import Anthropic from '@anthropic-ai/sdk'
import { getSettings } from '../settings'
import { TOOL_DEFS, runTool, type ToolContent } from './tools'

const SYSTEM = `You are the editing assistant built into OpenComp, a video compositor and editor inspired by After Effects. You edit the user's open project by calling tools.
- Call get_project first to learn the ids, times and what is on the timeline.
- Times are in seconds. Positions are composition pixels, measured as offsets from the frame centre (positive y is down). The top track is the top layer.
- When the look matters (framing, colour, masks, titles), call get_frame and check the result, then adjust.
- Make the edit directly rather than explaining how to do it. Keep replies short: say what you changed.
- Everything you do can be undone with Ctrl+Z.`

export type ChatEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown; error?: string }
  | { kind: 'notice'; text: string }

function client() {
  const apiKey = getSettings().anthropicKey
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings → AI to use the assistant.')
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

/** Server-side refusal fallback; Claude Haiku has none, so it's only sent for the other models. */
function requestOptions() {
  const s = getSettings()
  return {
    model: s.claudeModel,
    max_tokens: 16000,
    output_config: { effort: s.claudeEffort },
    ...(!s.claudeModel.startsWith('claude-haiku') && {
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
    }),
  }
}

const tools: Anthropic.Beta.BetaTool[] = TOOL_DEFS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema,
}))

const toBlocks = (content: ToolContent[]): Anthropic.Beta.BetaToolResultBlockParam['content'] =>
  content.map((c) =>
    c.type === 'text'
      ? { type: 'text' as const, text: c.text }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: c.data } },
  )

/**
 * Run one user turn: call Claude, execute the tools it asks for, and repeat until it's done.
 * `messages` is the conversation so far (including the new user message) and is extended in place.
 */
export async function runAssistant(
  messages: Anthropic.Beta.BetaMessageParam[],
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
) {
  const api = client()
  for (;;) {
    const response = await api.beta.messages.create({ ...requestOptions(), system: SYSTEM, tools, messages }, { signal })
    messages.push({ role: 'assistant', content: response.content })
    for (const block of response.content) if (block.type === 'text' && block.text.trim()) onEvent({ kind: 'text', text: block.text })

    if (response.stop_reason === 'refusal') {
      onEvent({ kind: 'notice', text: 'Claude declined this request.' })
      return
    }
    if (response.stop_reason === 'max_tokens') {
      onEvent({ kind: 'notice', text: 'The reply was cut off. Ask Claude to continue.' })
      return
    }
    if (response.stop_reason === 'pause_turn') continue
    if (response.stop_reason !== 'tool_use') return

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const result = await runTool(block.name, block.input)
      const error = result.isError ? result.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ') : undefined
      onEvent({ kind: 'tool', name: block.name, input: block.input, error })
      results.push({ type: 'tool_result', tool_use_id: block.id, content: toBlocks(result.content), is_error: result.isError })
    }
    if (signal.aborted) return
    messages.push({ role: 'user', content: results })
  }
}

/** Ask Claude to draw a graphic (titles, icons, lower thirds, backgrounds) as SVG. */
export async function claudeGraphic(prompt: string, width: number, height: number): Promise<string> {
  const response = await client().beta.messages.create({
    ...requestOptions(),
    system:
      'You draw graphics for video as SVG. Reply with exactly one complete, self-contained <svg> element and nothing else: no markdown, no explanation, no external images or fonts (use font-family="sans-serif" or similar).',
    messages: [
      {
        role: 'user',
        content: `Draw this as an SVG with width="${width}" height="${height}" viewBox="0 0 ${width} ${height}". Keep the background transparent unless the description asks for one.\n\n${prompt}`,
      },
    ],
  })
  if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.')
  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const svg = text.match(/<svg[\s\S]*<\/svg>/i)?.[0]
  if (!svg) throw new Error('Claude did not return an SVG. Try rephrasing.')
  return svg
}
