// Runtime-only media: object URLs for imported files, thumbnails, the <video>/<audio>/<img> elements
// that decode them, and the Web Audio graph used for volume and export. Nothing here is saved.
import { IMAGE_DURATION, type Asset, type AssetKind, type Clip } from '../project'

interface Source {
  url: string
  thumb?: string
}

const sources = new Map<string, Source>() // assetId -> file
const elements = new Map<string, { el: HTMLMediaElement; url: string }>() // clipId -> decoder
const images = new Map<string, HTMLImageElement>() // assetId -> decoded image

const EXTENSION_KIND: Record<string, AssetKind> = {
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', opus: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image',
}

export function kindOf(file: File): AssetKind | null {
  const major = file.type.split('/')[0]
  if (major === 'video' || major === 'audio' || major === 'image') return major
  return EXTENSION_KIND[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

export interface MediaInfo {
  duration: number
  width: number
  height: number
}

/** Attach a file to an asset id and read its duration/size. Throws if the browser can't decode it. */
export async function loadFile(assetId: string, file: File, kind: AssetKind): Promise<MediaInfo> {
  const url = URL.createObjectURL(file)
  try {
    const { thumb, ...info } = kind === 'image' ? await probeImage(url) : await probeMedia(url, kind)
    const old = sources.get(assetId)
    if (old) URL.revokeObjectURL(old.url)
    sources.set(assetId, { url, thumb })
    images.delete(assetId)
    return info
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

export const hasSource = (assetId: string) => sources.has(assetId)
export const thumbnail = (assetId: string) => sources.get(assetId)?.thumb

function probeImage(url: string): Promise<MediaInfo & { thumb: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ duration: IMAGE_DURATION, width: img.naturalWidth, height: img.naturalHeight, thumb: url })
    img.onerror = () => reject(new Error('Unsupported image'))
    img.src = url
  })
}

function waitFor(el: HTMLMediaElement, event: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      el.removeEventListener(event, onOk)
      el.removeEventListener('error', onError)
      if (ok) resolve()
      else reject(new Error('Unsupported or unreadable media'))
    }
    const onOk = () => finish(true)
    const onError = () => finish(false)
    const timer = setTimeout(onError, timeoutMs)
    el.addEventListener(event, onOk)
    el.addEventListener('error', onError)
  })
}

async function probeMedia(url: string, kind: 'video' | 'audio'): Promise<MediaInfo & { thumb?: string }> {
  const el = document.createElement(kind)
  el.preload = 'auto'
  el.muted = true
  el.src = url
  await waitFor(el, 'loadedmetadata')
  // Files recorded with MediaRecorder often report an Infinite duration until you seek past the end.
  if (!Number.isFinite(el.duration)) {
    el.currentTime = 1e9
    while (!Number.isFinite(el.duration)) await waitFor(el, 'durationchange')
  }
  const info: MediaInfo & { thumb?: string } = { duration: el.duration, width: 0, height: 0 }
  if (el instanceof HTMLVideoElement && el.videoWidth) {
    info.width = el.videoWidth
    info.height = el.videoHeight
    el.currentTime = Math.min(1, el.duration / 3)
    await waitFor(el, 'seeked')
    info.thumb = snapshot(el)
  }
  el.removeAttribute('src')
  el.load()
  return info
}

function snapshot(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  canvas.height = 90
  canvas.width = Math.round((90 * video.videoWidth) / video.videoHeight)
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.7)
}

/**
 * The element that plays `clip`, created on demand. Each clip gets its own element so two clips
 * from the same file (e.g. after a cut, or stacked on two tracks) can play independently.
 */
export function clipElement(clip: Clip, asset: Asset, onUpdate: () => void): HTMLMediaElement | null {
  const source = sources.get(asset.id)
  if (!source || asset.kind === 'image') return null
  const cached = elements.get(clip.id)
  if (cached?.url === source.url) return cached.el
  releaseElement(clip.id)

  const el = document.createElement(asset.kind)
  el.preload = 'auto'
  if (el instanceof HTMLVideoElement) el.playsInline = true
  el.src = source.url
  el.addEventListener('seeked', onUpdate)
  el.addEventListener('loadeddata', onUpdate)
  elements.set(clip.id, { el, url: source.url })
  if (audio) connect(el)
  return el
}

export function releaseElement(clipId: string) {
  const entry = elements.get(clipId)
  if (!entry) return
  entry.el.pause()
  entry.el.removeAttribute('src')
  entry.el.load()
  gains.get(entry.el)?.disconnect()
  gains.delete(entry.el)
  elements.delete(clipId)
}

/** Free decoders for every clip not in `keep` (clips far from the playhead). */
export function releaseElementsExcept(keep: Set<string>) {
  for (const clipId of [...elements.keys()]) if (!keep.has(clipId)) releaseElement(clipId)
}

/** The decoded image for a still, or null while it is still loading. */
export function imageElement(asset: Asset, onUpdate: () => void): HTMLImageElement | null {
  const source = sources.get(asset.id)
  if (!source) return null
  let img = images.get(asset.id)
  if (!img) {
    img = new Image()
    img.onload = onUpdate
    img.src = source.url
    images.set(asset.id, img)
  }
  return img.complete && img.naturalWidth ? img : null
}

// ---- Audio ----------------------------------------------------------------------------------
// Every media element is routed through its own GainNode into a master bus. The bus feeds the
// speakers and a MediaStream that the exporter records.

let audio: { ctx: AudioContext; master: GainNode; output: MediaStreamAudioDestinationNode } | null = null
const gains = new Map<HTMLMediaElement, GainNode>()

/** Create or resume the audio graph. The first call must come from a user gesture (e.g. pressing play). */
export function ensureAudio() {
  if (!audio) {
    const ctx = new AudioContext()
    const master = ctx.createGain()
    const output = ctx.createMediaStreamDestination()
    master.connect(ctx.destination)
    master.connect(output)
    audio = { ctx, master, output }
    for (const { el } of elements.values()) connect(el)
  }
  if (audio.ctx.state === 'suspended') void audio.ctx.resume()
  return audio
}

function connect(el: HTMLMediaElement) {
  const { ctx, master } = audio!
  const gain = ctx.createGain()
  ctx.createMediaElementSource(el).connect(gain).connect(master)
  gains.set(el, gain)
}

/** Volume as a percentage; values above 100 boost. */
export function setVolume(el: HTMLMediaElement, percent: number) {
  const gain = gains.get(el)
  if (gain) gain.gain.value = percent / 100
  else el.volume = Math.min(1, percent / 100)
}

/** The mixed audio of the whole timeline, for recording. */
export const audioStream = () => ensureAudio().output.stream
