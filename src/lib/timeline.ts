// Pure timeline helpers: no DOM, no store. Covered by timeline.test.ts.
import type { Asset, Clip, Project } from '../project'

const EPS = 1e-6

export const clipEnd = (c: Clip) => c.start + c.duration

/** End of the last clip. This is how long playback and export run. */
export const contentEnd = (p: Project) => p.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0)

export const isActiveAt = (c: Clip, t: number) => t >= c.start && t < clipEnd(c)

/** True if [start, end) on a track doesn't overlap any clip except `ignoreId`. */
export function isFree(p: Project, trackId: string, start: number, end: number, ignoreId?: string) {
  return p.clips.every(
    (c) => c.trackId !== trackId || c.id === ignoreId || end <= c.start + EPS || start >= clipEnd(c) - EPS,
  )
}

/** Cut a clip in two at time t. Returns null unless t falls strictly inside the clip. */
export function splitClip(clip: Clip, t: number, newId: string): [Clip, Clip] | null {
  if (t <= clip.start + EPS || t >= clipEnd(clip) - EPS) return null
  const left: Clip = { ...structuredClone(clip), duration: t - clip.start }
  const right: Clip = {
    ...structuredClone(clip),
    id: newId,
    start: t,
    in: clip.in + (t - clip.start),
    duration: clipEnd(clip) - t,
  }
  return [left, right]
}

/** Times a dragged edge can snap to: zero, the playhead, markers and other clips' edges. */
export function snapTargets(p: Project, playhead: number, ignoreId?: string): number[] {
  const targets = [0, playhead, ...p.markers.map((m) => m.time)]
  for (const c of p.clips) if (c.id !== ignoreId) targets.push(c.start, clipEnd(c))
  return targets
}

/** The smallest shift that lines one of `edges` up with one of `targets`, if within `threshold`; else 0. */
export function snapOffset(edges: number[], targets: number[], threshold: number): number {
  let best = 0
  let bestDistance = threshold
  for (const edge of edges) {
    for (const target of targets) {
      const d = Math.abs(target - edge)
      if (d <= bestDistance) {
        bestDistance = d
        best = target - edge
      }
    }
  }
  return best
}

/** Clips with a picture at time t, bottom layer first. Hidden tracks and audio are skipped. */
export function visualClipsAt(p: Project, t: number): { clip: Clip; asset: Asset }[] {
  const out: { clip: Clip; asset: Asset }[] = []
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i]
    if (track.hidden) continue
    for (const clip of p.clips) {
      if (clip.trackId !== track.id || !isActiveAt(clip, t)) continue
      const asset = p.assets.find((a) => a.id === clip.assetId)
      if (asset && asset.kind !== 'audio') out.push({ clip, asset })
    }
  }
  return out
}
