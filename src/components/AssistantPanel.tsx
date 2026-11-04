import type Anthropic from '@anthropic-ai/sdk'
import { useEffect, useRef, useState } from 'react'
import type { ChatEvent } from '../ai/claude'
import { useSettings } from '../settings'
import { setState } from '../store'

type Item = { kind: 'user'; text: string } | ChatEvent

const SUGGESTIONS = [
  'Add a title that says “My Trip” for the first 3 seconds',
  'Give everything a warm, cinematic look',
  'Cut the clip at every marker',
  'Fade the first clip in and the last clip out',
]

/** Chat with Claude, which edits the project through the same tools as the MCP bridge. */
export function AssistantPanel() {
  const hasKey = useSettings((s) => !!s.anthropicKey)
  const model = useSettings((s) => s.claudeModel)
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const history = useRef<Anthropic.Beta.BetaMessageParam[]>([])
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => list.current?.scrollTo(0, list.current.scrollHeight), [items, busy])

  const send = async (text = input.trim()) => {
    if (!text || busy) return
    setInput('')
    setItems((i) => [...i, { kind: 'user', text }])
    setBusy(true)
    history.current.push({ role: 'user', content: text })
    const controller = new AbortController()
    abort.current = controller
    try {
      const { runAssistant } = await import('../ai/claude') // keeps the SDK out of the main bundle
      await runAssistant(history.current, (e) => setItems((i) => [...i, e]), controller.signal)
    } catch (err) {
      if (!controller.signal.aborted) setItems((i) => [...i, { kind: 'notice', text: err instanceof Error ? err.message : String(err) }])
    } finally {
      // A request that stopped between Claude asking for tools and getting the results would leave the
      // conversation unanswerable; drop that half-finished turn.
      const last = history.current.at(-1)
      if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use')) history.current.pop()
      setBusy(false)
    }
  }

  return (
    <div className="assistant">
      <div className="chat" ref={list}>
        {!hasKey && (
          <div className="empty-note">
            <span>
              The assistant uses your own Anthropic API key. Add it in Settings → AI.
              <br />
              No key? Connect Claude Desktop or Claude Code instead (Settings → Claude).
            </span>
            <button type="button" className="btn small" onClick={() => setState({ dialog: 'settings' })}>
              Open Settings
            </button>
          </div>
        )}
        {hasKey && items.length === 0 && (
          <div className="suggestions">
            <p className="muted">Ask Claude to make edits for you. Try:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {items.map((it, i) =>
          it.kind === 'user' ? (
            <div key={i} className="msg user">
              {it.text}
            </div>
          ) : it.kind === 'text' ? (
            <div key={i} className="msg claude">
              {it.text}
            </div>
          ) : it.kind === 'tool' ? (
            <div key={i} className={`msg tool ${it.error ? 'error' : ''}`}>
              {it.name.replace(/_/g, ' ')}
              {it.error ? `: ${it.error}` : ''}
            </div>
          ) : (
            <div key={i} className="msg notice">
              {it.text}
            </div>
          ),
        )}
        {busy && <div className="msg thinking">Claude is working…</div>}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <textarea
          value={input}
          rows={2}
          disabled={!hasKey}
          placeholder="Ask Claude to edit… (Enter to send)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!hasKey || !input.trim()}>
            Send
          </button>
        )}
      </form>
      <div className="assistant-foot">
        <span>{model}</span>
        {items.length > 0 && !busy && (
          <button
            type="button"
            className="link"
            onClick={() => {
              history.current = []
              setItems([])
            }}
          >
            New chat
          </button>
        )}
      </div>
    </div>
  )
}
