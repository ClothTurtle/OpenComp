// The preview engine. One requestAnimationFrame loop advances the playhead while playing, keeps
// every nearby clip's media element in step with it, and redraws the viewer canvas when needed.
import { toFrame } from '../lib/time'
import { contentEnd, visualClipsAt } from '../lib/timeline'
import type { Project } from '../project'
import { getState, setState, useStore } from '../store'
import { clipElement, ensureAudio, imageElement, releaseElementsExcept, setVolume } from './media'
import { createRenderer, type Layer, type Renderer } from './renderer'

const PRELOAD_S = 2 // start decoding a clip this long before the playhead reaches it
const MAX_DRIFT_S = 0.25 // re-sync a playing element that drifts further than this

let renderer: Renderer | null = null
let canvas: HTMLCanvasElement | null = null
let dirty = true
let clock = { wall: 0, time: 0 } // playhead time at a given performance.now()

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

export function seek(t: number) {
  const time = Math.max(0, toFrame(t, getState().project.settings.fps))
  clock = { wall: performance.now(), time }
  setState({ time })
}

export function play() {
  const { project, time } = getState()
  const end = contentEnd(project)
  if (end === 0) return
  ensureAudio()
  const start = time >= end ? 0 : time
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
    const end = contentEnd(project)
    time = Math.min(end, clock.time + (now - clock.wall) / 1000)
    stillPlaying = time < end
    setState(stillPlaying ? { time } : { time, playing: false })
  }
  syncMedia(project, time, stillPlaying)
  if (renderer && (playing || dirty)) {
    dirty = false
    renderer.draw(layersAt(project, time), project.settings)
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

useStore.subscribe((s, prev) => {
  if (s.project !== prev.project || s.time !== prev.time || s.mediaVersion !== prev.mediaVersion) dirty = true
})

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

    const sourceTime = clip.in + local
    const muted = p.tracks.find((tr) => tr.id === clip.trackId)?.muted
    setVolume(el, muted ? 0 : clip.volume)
    if (playing) {
      if (el.paused) {
        el.currentTime = sourceTime
        el.play().catch(() => {})
      } else if (Math.abs(el.currentTime - sourceTime) > MAX_DRIFT_S) {
        el.currentTime = sourceTime
      }
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - sourceTime) > 0.5 / p.settings.fps) el.currentTime = sourceTime
    }
  }
  releaseElementsExcept(nearby)
}

function layersAt(p: Project, t: number): Layer[] {
  const layers: Layer[] = []
  for (const { clip, asset } of visualClipsAt(p, t)) {
    const base = { width: asset.width, height: asset.height, transform: clip.transform, color: clip.color }
    if (asset.kind === 'image') {
      const img = imageElement(asset, requestRender)
      if (img) layers.push({ ...base, key: `image:${asset.id}`, source: img, ready: true, still: true })
    } else {
      const video = clipElement(clip, asset, requestRender) as HTMLVideoElement | null
      if (video) layers.push({ ...base, key: clip.id, source: video, ready: video.readyState >= 2, still: false })
    }
  }
  return layers
}
