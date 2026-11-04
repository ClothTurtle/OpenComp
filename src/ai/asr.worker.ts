// Speech-to-text with Whisper, off the main thread. Audio arrives as 16 kHz mono samples.
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

export interface AsrRequest {
  id: number
  model: string
  audio: Float32Array
  language: string // '' = auto-detect
}

export type AsrResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'result'; id: number; segments: { start: number; end: number; text: string }[] }
  | { type: 'error'; id: number; message: string }

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{
  text: string
  chunks?: { timestamp: [number, number | null]; text: string }[]
}>

let current: { model: string; ready: Promise<Transcriber> } | null = null

self.onmessage = async (e: MessageEvent<AsrRequest>) => {
  const { id, model, audio, language } = e.data
  const post = (msg: AsrResponse) => self.postMessage(msg)
  try {
    if (current?.model !== model) {
      const progress_callback = (p: { status: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress') post({ type: 'progress', loaded: p.loaded ?? 0, total: p.total ?? 0 })
      }
      current = {
        model,
        ready: pipeline('automatic-speech-recognition', model, { dtype: 'q8', device: 'wasm', progress_callback }) as unknown as Promise<Transcriber>,
      }
    }
    const transcribe = await current.ready
    const out = await transcribe(audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(language && { language, task: 'transcribe' }),
    })
    const duration = audio.length / 16000
    const segments = (out.chunks ?? [{ timestamp: [0, duration] as [number, number], text: out.text }]).map((c) => ({
      start: c.timestamp[0],
      end: c.timestamp[1] ?? duration,
      text: c.text.trim(),
    }))
    post({ type: 'result', id, segments: segments.filter((s) => s.text) })
  } catch (err) {
    current = null
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) })
  }
}
