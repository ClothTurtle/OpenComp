// The preview engine. One requestAnimationFrame loop advances the playhead while playing, keeps
// every nearby clip's media element in step with it, and redraws the viewer canvas when needed.
import { EFFECT_MAP } from '../effects'
import { resolveClip } from '../lib/keyframes'
import { toFrame } from '../lib/time'
import { contentEnd, layerTime, sourceTime, trackState, visualClipsAt } from '../lib/timeline'
import type { Project } from '../project'
import { getSettings, isEnabled, useSettings } from '../settings'
import { getState, setState, useStore } from '../store'
import { masksKey, rasterizeMasks } from './masks'
import { clipElement, ensureAudio, imageElement, releaseElementsExcept, setAudio } from './media'
import { createRenderer, type Frame, type Layer, type Renderer } from './renderer'

const PRELOAD_S = 2 // start decoding a clip this long before the playhead reaches it
const MAX_DRIFT_S = 0.25 // re-sync a playing element that drifts further than this

let renderer: Renderer | null = null
let canvas: HTMLCanvasElement | null = null
let dirty = true
let clock = { wall: 0, time: 0 } // playhead time at a given performance.now()
let exportRange: [number, number] | null = null

/** Called by the Viewer when its canvas mounts. Returns a cleanup function. */
export function attachCanvas(el: HTMLCanvasElement) {
  canvas = el
  renderer = createRenderer(el)
  dirty = true
  return () => {
    renderer?.dispose()
    renderer = null
    canvas = null
  }
}

export const viewerCanvas = () => canvas
export const requestRender = () => {
  dirty = true
}

/** While exporting: play exactly this range, at full quality, without looping. */
export function setExportRange(range: [number, number] | null) {
  exportRange = range
  dirty = true
}

/** What play covers: the export range, else the work area, else the whole edit. */
export function playRange(p: Project): [number, number] {
  return exportRange ?? p.workArea ?? [0, contentEnd(p)]
}

export function seek(t: number) {
  const time = Math.max(0, toFrame(t, getState().project.settings.fps))
  clock = { wall: performance.now(), time }
  setState({ time })
}

export function play() {
  const { project, time } = getState()
  const [from, to] = playRange(project)
  if (to <= from) return
  ensureAudio()
  const start = time >= to || time < from ? from : time
  clock = { wall: performance.now(), time: start }
  setState({ playing: true, time: start })
}

export function pause() {
  const { time, project } = getState()
  setState({ playing: false, time: toFrame(time, project.settings.fps) })
}

export const togglePlay = () => (getState().playing ? pause() : play())

export function stepFrames(n: number) {
  pause()
  seek(getState().time + n / getState().project.settings.fps)
}

function tick(now: number) {
  const { project, playing } = getState()
  let { time } = getState()
  let stillPlaying = playing
  if (playing) {
    const [from, to] = playRange(project)
    time = clock.time + (now - clock.wall) / 1000
    if (time >= to) {
      if (getSettings().loop && !exportRange) {
        time = from
        clock = { wall: now, time }
      } else {
        time = to
        stillPlaying = false
      }
    }
    setState(stillPlaying ? { time } : { time, playing: false })
  }
  syncMedia(project, time, stillPlaying)
  if (renderer && (playing || dirty)) {
    dirty = false
    renderer.draw(frameAt(project, time))
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

useStore.subscribe((s, prev) => {
  if (s.project !== prev.project || s.time !== prev.time || s.mediaVersion !== prev.mediaVersion) dirty = true
})
useSettings.subscribe(requestRender)

/** Play, pause and seek each clip's element so it shows the right frame for time t. */
function syncMedia(p: Project, t: number, playing: boolean) {
  const nearby = new Set<string>()
  for (const clip of p.clips) {
    const asset = p.assets.find((a) => a.id === clip.assetId)
    if (!asset || asset.kind === 'image') continue
    const local = t - clip.start
    if (local < -PRELOAD_S || local > clip.duration + 0.5) continue
    const el = clipElement(clip, asset, requestRender)
    if (!el) continue
    nearby.add(clip.id)

    if (local < 0 || local >= clip.duration) {
      // Not on screen yet (or just finished): park it on its first frame so the cut is instant.
      if (!el.paused) el.pause()
      if (local < 0 && Math.abs(el.currentTime - clip.in) > 0.01) el.currentTime = clip.in
      continue
    }

    const c = resolveClip(clip, layerTime(clip, t))
    const track = p.tracks.find((tr) => tr.id === clip.trackId)
    const audible = track ? trackState(p, track).audible : true
    const fade = Math.min(
      1,
      c.audio.fadeIn > 0 ? local / c.audio.fadeIn : 1,
      c.audio.fadeOut > 0 ? (clip.duration - local) / c.audio.fadeOut : 1,
    )
    setAudio(el, {
      gain: audible ? (c.audio.volume / 100) * Math.max(0, fade) : 0,
      pan: c.audio.pan / 100,
      low: c.audio.low,
      mid: c.audio.mid,
      high: c.audio.high,
    })
    const rate = Math.min(16, Math.max(0.0625, clip.speed / 100))
    if (el.playbackRate !== rate) el.playbackRate = rate

    const target = sourceTime(clip, t)
    if (playing) {
      if (el.paused) {
        el.currentTime = target
        el.play().catch(() => {})
      } else if (Math.abs(el.currentTime - target) > MAX_DRIFT_S * rate) {
        el.currentTime = target
      }
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - target) > 0.5 / p.settings.fps) el.currentTime = target
    }
  }
  releaseElementsExcept(nearby)
}

/** Everything the renderer needs to draw time t. */
export function frameAt(p: Project, t: number, full = !!exportRange): Frame {
  const s = getSettings()
  return {
    width: p.settings.width,
    height: p.settings.height,
    quality: full ? 1 : s.previewQuality,
    background: p.settings.background,
    checker: !full && s.transparencyGrid,
    time: t,
    layers: layersAt(p, t),
  }
}

function layersAt(p: Project, t: number): Layer[] {
  const masksOn = isEnabled('masks')
  return visualClipsAt(p, t).flatMap(({ clip, asset }): Layer[] => {
    const c = resolveClip(clip, layerTime(clip, t))
    const src = sourceTime(clip, t)
    const base = {
      key: clip.id,
      width: 0,
      height: 0,
      transform: c.transform,
      color: c.color,
      effects: c.effects.filter((e) => e.enabled && EFFECT_MAP.has(e.type) && isEnabled(`fx:${e.type}`)),
      blendMode: c.blendMode,
      local: t - clip.start,
      duration: clip.duration,
      mask:
        masksOn && clip.masks.some((m) => m.enabled)
          ? { key: masksKey(clip.masks, src), draw: (w: number, h: number, px: number) => rasterizeMasks(clip.masks, src, w, h, px) }
          : undefined,
    }
    if (clip.text) return [{ ...base, kind: 'text', text: c.text }]
    if (clip.solid) return [{ ...base, kind: 'solid', solidColor: clip.solid }]
    if (clip.adjustment) return [{ ...base, kind: 'adjustment' }]
    if (!asset) return []
    const size = { width: asset.width, height: asset.height }
    if (asset.kind === 'image') {
      const img = imageElement(asset, requestRender)
      return img ? [{ ...base, ...size, kind: 'media', source: img, ready: true, still: true }] : []
    }
    const video = clipElement(clip, asset, requestRender) as HTMLVideoElement | null
    return video ? [{ ...base, ...size, kind: 'media', source: video, ready: video.readyState >= 2, still: false }] : []
  })
}

/** Resolve once every visible media layer at the current time has a decoded frame (or after a timeout). */
export async function waitForFrame(timeoutMs = 4000) {
  const started = performance.now()
  while (performance.now() - started < timeoutMs) {
    const { project, time } = getState()
    syncMedia(project, time, false)
    const ready = visualClipsAt(project, time).every(({ clip, asset }) => {
      if (!asset) return true
      if (asset.kind === 'image') return !!imageElement(asset, requestRender)
      const el = clipElement(clip, asset, requestRender)
      return !el || (el.readyState >= 2 && !el.seeking)
    })
    if (ready) return
    await new Promise((r) => requestAnimationFrame(r))
  }
}

/**
 * Render the current frame at full quality into an image (PNG), optionally scaled to fit `maxSide`.
 * Used by "Save frame", the Claude tools and AI features.
 */
export async function captureFrame(maxSide = 0): Promise<HTMLCanvasElement> {
  if (!renderer || !canvas) throw new Error('The viewer is not ready.')
  await waitForFrame()
  const { project, time } = getState()
  renderer.draw(frameAt(project, time, true))
  const scale = maxSide ? Math.min(1, maxSide / Math.max(canvas.width, canvas.height)) : 1
  const out = document.createElement('canvas')
  out.width = Math.round(canvas.width * scale)
  out.height = Math.round(canvas.height * scale)
  out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height) // must happen before the frame is presented
  dirty = true
  return out
}
