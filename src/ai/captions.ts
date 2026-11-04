// Auto captions: transcribe the audio of clips and add the words as caption text layers.
// Runs Whisper locally by default (downloaded on first use); an OpenAI-compatible API is optional.
import { create } from 'zustand'
import { decodeAudio, sourceUrl } from '../engine/media'
import { trackState } from '../lib/timeline'
import { DEFAULT_TEXT, newClip, newTrack, type Clip } from '../project'
import { getSettings } from '../settings'
import { commit, getState } from '../store'
import type { AsrResponse } from './asr.worker'

export const useCaptions = create<{ running: boolean; message: string }>()(() => ({ running: false, message: '' }))

interface Segment {
  start: number
  end: number
  text: string
}

const SAMPLE_RATE = 16000
const MAX_LINE = 42

let worker: Worker | null = null
let nextId = 1

function transcribeLocally(audio: Float32Array): Promise<Segment[]> {
  const s = getSettings()
  worker ??= new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' })
  const id = nextId++
  return new Promise((resolve, reject) => {
    worker!.onmessage = (e: MessageEvent<AsrResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        if (msg.total) useCaptions.setState({ message: `Downloading speech model… ${Math.round((msg.loaded / msg.total) * 100)}%` })
        return
      }
      if (msg.id !== id) return
      if (msg.type === 'result') resolve(msg.segments)
      else reject(new Error(msg.message))
    }
    useCaptions.setState({ message: 'Transcribing…' })
    worker!.postMessage({ id, model: `Xenova/whisper-${s.captionModel}`, audio, language: s.captionLanguage }, [audio.buffer])
  })
}

async function transcribeWithApi(audio: Float32Array): Promise<Segment[]> {
  const s = getSettings()
  if (!s.openaiKey) throw new Error('Add an OpenAI-compatible API key in Settings → AI, or switch captions to "On this computer".')
  const form = new FormData()
  form.append('file', new Blob([wav(audio)], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  if (s.captionLanguage) form.append('language', s.captionLanguage)
  const res = await fetch(`${s.openaiBaseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.openaiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Transcription API error ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { segments?: Segment[]; text: string; duration?: number }
  return (json.segments ?? [{ start: 0, end: json.duration ?? audio.length / SAMPLE_RATE, text: json.text }]).map((x) => ({
    start: x.start,
    end: x.end,
    text: x.text.trim(),
  }))
}

/** 16-bit mono WAV, for upload to transcription APIs. */
function wav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, s: string) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true))
  return buffer
}

/** Break long segments into caption-sized pieces (two lines of ~42 characters), splitting time by word count. */
export function splitSegment(seg: Segment): Segment[] {
  const words = seg.text.split(/\s+/).filter(Boolean)
  const pieces: string[][] = [[]]
  for (const word of words) {
    const piece = pieces[pieces.length - 1]
    if ([...piece, word].join(' ').length > MAX_LINE * 2 && piece.length) pieces.push([word])
    else piece.push(word)
  }
  const per = (seg.end - seg.start) / Math.max(1, words.length)
  let t = seg.start
  return pieces.map((piece) => {
    const start = t
    t += piece.length * per
    return { start, end: t, text: wrap(piece) }
  })
}

const wrap = (words: string[]) => {
  const text = words.join(' ')
  if (text.length <= MAX_LINE) return text
  // Break at the space nearest the middle.
  let best = 0
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2)) best = i
  return best ? `${text.slice(0, best)}\n${text.slice(best + 1)}` : text
}

/** Transcribe the given clips (default: every audible clip with sound) and add caption layers. Returns how many were added. */
export async function generateCaptions(clipIds?: string[]): Promise<number> {
  const { project } = getState()
  const clips = project.clips.filter((c) => {
    const asset = project.assets.find((a) => a.id === c.assetId)
    const track = project.tracks.find((t) => t.id === c.trackId)
    if (!asset || asset.kind === 'image' || !sourceUrl(asset.id)) return false
    return clipIds ? clipIds.includes(c.id) : !!track && trackState(project, track).audible
  })
  if (!clips.length) throw new Error('No clips with audio to caption.')

  useCaptions.setState({ running: true, message: 'Reading audio…' })
  try {
    const captions: Segment[] = []
    for (const clip of clips) {
      const asset = project.assets.find((a) => a.id === clip.assetId)!
      const buffer = await decodeAudio(sourceUrl(asset.id)!, SAMPLE_RATE)
      const from = Math.floor(clip.in * SAMPLE_RATE)
      const to = Math.min(buffer.length, Math.ceil((clip.in + (clip.duration * clip.speed) / 100) * SAMPLE_RATE))
      const audio = buffer.getChannelData(0).slice(from, to)
      const segments = getSettings().captionEngine === 'openai' ? await transcribeWithApi(audio) : await transcribeLocally(audio)
      const speed = clip.speed / 100
      for (const seg of segments.flatMap(splitSegment)) {
        const start = clip.start + seg.start / speed
        const end = Math.min(clip.start + clip.duration, clip.start + seg.end / speed)
        if (end - start > 0.05) captions.push({ start, end, text: seg.text })
      }
    }
    if (!captions.length) throw new Error('No speech was found.')
    addCaptionClips(captions)
    useCaptions.setState({ message: `Added ${captions.length} captions.` })
    return captions.length
  } catch (err) {
    useCaptions.setState({ message: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    useCaptions.setState({ running: false })
  }
}

function addCaptionClips(captions: Segment[]) {
  const { height } = getState().project.settings
  const size = Math.round(height * 0.05)
  commit((p) => {
    const track = newTrack(p.tracks.length + 1)
    track.name = 'Captions'
    p.tracks.unshift(track)
    captions.sort((a, b) => a.start - b.start)
    captions.forEach((cap, i) => {
      const next = captions[i + 1]
      const end = next ? Math.min(cap.end, next.start) : cap.end // captions on one track can't overlap
      const clip: Clip = newClip({
        trackId: track.id,
        start: cap.start,
        duration: Math.max(0.1, end - cap.start),
        name: cap.text.replace(/\n/g, ' '),
        text: { ...DEFAULT_TEXT, text: cap.text, size, bold: true, shadow: false, box: true, boxColor: '#000000' },
      })
      clip.transform.y = height / 2 - size * 2.6 // lower third
      p.clips.push(clip)
    })
  })
}
