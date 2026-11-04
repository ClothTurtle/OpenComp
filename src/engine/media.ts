// Runtime-only media: URLs for imported files, thumbnails, the <video>/<audio>/<img> elements that
// decode them, waveform peaks, and the Web Audio graph used for volume, pan, EQ and export.
import { IMAGE_DURATION, type Asset, type AssetKind, type Clip } from '../project'

interface Source {
  url: string
  revoke: boolean // object URLs we created and must free
  thumb?: string
}

const sources = new Map<string, Source>() // assetId -> media URL
const elements = new Map<string, { el: HTMLMediaElement; url: string }>() // clipId -> decoder
const images = new Map<string, HTMLImageElement>() // assetId -> decoded image

const EXTENSION_KIND: Record<string, AssetKind> = {
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', opus: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image',
}

export function kindOfName(name: string, mime = ''): AssetKind | null {
  const major = mime.split('/')[0]
  if (major === 'video' || major === 'audio' || major === 'image') return major
  return EXTENSION_KIND[name.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

export const kindOf = (file: File) => kindOfName(file.name, file.type)

export interface MediaInfo {
  duration: number
  width: number
  height: number
}

/** Attach a file to an asset id and read its duration/size. Throws if the browser can't decode it. */
export const loadFile = (assetId: string, file: File, kind: AssetKind) =>
  loadUrl(assetId, URL.createObjectURL(file), kind, true)

/** Attach any URL (an object URL, or the desktop app's file URL) to an asset id. */
export async function loadUrl(assetId: string, url: string, kind: AssetKind, revoke = false): Promise<MediaInfo> {
  try {
    const { thumb, ...info } = kind === 'image' ? await probeImage(url) : await probeMedia(url, kind)
    const old = sources.get(assetId)
    if (old?.revoke) URL.revokeObjectURL(old.url)
    sources.set(assetId, { url, revoke, thumb })
    images.delete(assetId)
    peaks.delete(assetId)
    return info
  } catch (err) {
    if (revoke) URL.revokeObjectURL(url)
    throw err
  }
}

export const hasSource = (assetId: string) => sources.has(assetId)
export const thumbnail = (assetId: string) => sources.get(assetId)?.thumb
export const sourceUrl = (assetId: string) => sources.get(assetId)?.url

function probeImage(url: string): Promise<MediaInfo & { thumb: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ duration: IMAGE_DURATION, width: img.naturalWidth, height: img.naturalHeight, thumb: url })
    img.onerror = () => reject(new Error('Unsupported image'))
    img.src = url
  })
}

export function waitFor(el: HTMLMediaElement, event: string, timeoutMs = 10_000): Promise<void> {
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
  chains.get(entry.el)?.gain.disconnect()
  chains.delete(entry.el)
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

// ---- Waveforms ------------------------------------------------------------------------------

const PEAKS_PER_SECOND = 50
const peaks = new Map<string, Float32Array | 'pending' | 'none'>()

/** Audio peaks (max amplitude per 1/50 s) for drawing waveforms. Computed lazily; `onReady` fires once available. */
export function waveform(assetId: string, onReady: () => void): { data: Float32Array; rate: number } | null {
  const state = peaks.get(assetId)
  if (state instanceof Float32Array) return { data: state, rate: PEAKS_PER_SECOND }
  if (state) return null
  const url = sources.get(assetId)?.url
  if (!url) return null
  peaks.set(assetId, 'pending')
  decodeAudio(url)
    .then((buffer) => {
      const data = buffer.getChannelData(0)
      const per = Math.max(1, Math.floor(buffer.sampleRate / PEAKS_PER_SECOND))
      const out = new Float32Array(Math.ceil(data.length / per))
      for (let i = 0; i < out.length; i++) {
        let max = 0
        for (let j = i * per, end = Math.min(data.length, j + per); j < end; j++) max = Math.max(max, Math.abs(data[j]))
        out[i] = max
      }
      peaks.set(assetId, out)
      onReady()
    })
    .catch(() => peaks.set(assetId, 'none'))
  return null
}

/** Decode a media file's audio track. Skips files too big to decode comfortably in memory. */
export async function decodeAudio(url: string, sampleRate?: number): Promise<AudioBuffer> {
  const blob = await (await fetch(url)).blob()
  if (blob.size > 600 * 1024 * 1024) throw new Error('File too large to analyse')
  const ctx = new OfflineAudioContext(1, 1, sampleRate ?? 44100)
  return ctx.decodeAudioData(await blob.arrayBuffer())
}

// ---- Audio graph ----------------------------------------------------------------------------
// element -> gain (volume, fades) -> pan -> low shelf -> mid peak -> high shelf -> master bus.
// The master bus feeds the speakers, a level meter and a MediaStream the exporter records.

interface Chain {
  gain: GainNode
  pan: StereoPannerNode
  low: BiquadFilterNode
  mid: BiquadFilterNode
  high: BiquadFilterNode
}

let audio: {
  ctx: AudioContext
  master: GainNode
  meter: AnalyserNode
  output: MediaStreamAudioDestinationNode
} | null = null
const chains = new Map<HTMLMediaElement, Chain>()

/** Create or resume the audio graph. The first call must come from a user gesture (e.g. pressing play). */
export function ensureAudio() {
  if (!audio) {
    const ctx = new AudioContext()
    const master = ctx.createGain()
    const meter = ctx.createAnalyser()
    meter.fftSize = 1024
    const output = ctx.createMediaStreamDestination()
    master.connect(ctx.destination)
    master.connect(meter)
    master.connect(output)
    audio = { ctx, master, meter, output }
    for (const { el } of elements.values()) connect(el)
  }
  if (audio.ctx.state === 'suspended') void audio.ctx.resume()
  return audio
}

function connect(el: HTMLMediaElement) {
  const { ctx, master } = audio!
  const filter = (type: BiquadFilterType, frequency: number) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = frequency
    return f
  }
  const chain: Chain = {
    gain: ctx.createGain(),
    pan: ctx.createStereoPanner(),
    low: filter('lowshelf', 250),
    mid: filter('peaking', 1000),
    high: filter('highshelf', 4000),
  }
  ctx.createMediaElementSource(el).connect(chain.gain).connect(chain.pan).connect(chain.low).connect(chain.mid).connect(chain.high).connect(master)
  chains.set(el, chain)
}

export interface AudioParams {
  gain: number // linear, 1 = unchanged
  pan: number // -1..1
  low: number // dB
  mid: number
  high: number
}

export function setAudio(el: HTMLMediaElement, p: AudioParams) {
  const chain = chains.get(el)
  if (!chain) {
    el.volume = Math.min(1, Math.max(0, p.gain))
    return
  }
  chain.gain.gain.value = p.gain
  chain.pan.pan.value = p.pan
  chain.low.gain.value = p.low
  chain.mid.gain.value = p.mid
  chain.high.gain.value = p.high
}

/** The mixed audio of the whole timeline, for recording. */
export const audioStream = () => ensureAudio().output.stream

const meterData = new Float32Array(1024)
/** Current master output level (RMS, 0..1). */
export function audioLevel(): number {
  if (!audio) return 0
  audio.meter.getFloatTimeDomainData(meterData)
  let sum = 0
  for (const v of meterData) sum += v * v
  return Math.sqrt(sum / meterData.length)
}
