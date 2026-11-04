// Pure timeline helpers: no DOM, no store. Covered by timeline.test.ts.
import type { Asset, Clip, Project, Track } from '../project'

const EPS = 1e-6

export const clipEnd = (c: Clip) => c.start + c.duration

/** End of the last clip. This is how long playback and export run. */
export const contentEnd = (p: Project) => p.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0)

export const isActiveAt = (c: Clip, t: number) => t >= c.start && t < clipEnd(c)

/** Where in the source media the clip is at timeline time t (speed-aware). */
export const sourceTime = (c: Clip, t: number) => c.in + (t - c.start) * (c.speed / 100)

/**
 * Keyframe time for a clip. It stays put when the clip is trimmed or split, so keyframes stay
 * attached to the same moment of the content; it moves with the clip when the clip moves.
 */
export const layerTime = (c: Clip, t: number) => t - c.start + c.in / (c.speed / 100)

/** Track visibility/audibility, taking solo into account: if any track is soloed, only soloed tracks count. */
export function trackState(p: Project, track: Track) {
  const solo = p.tracks.some((t) => t.solo)
  return {
    visible: !track.hidden && (!solo || track.solo),
    audible: !track.muted && (!solo || track.solo),
  }
}

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
    in: sourceTime(clip, t),
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
export function visualClipsAt(p: Project, t: number): { clip: Clip; asset?: Asset }[] {
  const out: { clip: Clip; asset?: Asset }[] = []
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i]
    if (!trackState(p, track).visible) continue
    for (const clip of p.clips) {
      if (clip.trackId !== track.id || !isActiveAt(clip, t)) continue
      if (!clip.assetId) {
        out.push({ clip })
        continue
      }
      const asset = p.assets.find((a) => a.id === clip.assetId)
      if (asset && asset.kind !== 'audio') out.push({ clip, asset })
    }
  }
  return out
}

/**
 * Which clips can share one media element: pieces that carry straight on from each other (same
 * media, track and speed, the next starting exactly where the previous ends, on the timeline and in
 * the source, which is what a split makes). Playback then runs across the cut without restarting.
 * Returns clip id -> key (the id of the first piece in the run).
 */
export function playbackKeys(p: Project): Map<string, string> {
  const keys = new Map<string, string>()
  const media = p.clips.filter((c) => c.assetId).sort((a, b) => a.start - b.start)
  for (const clip of media) {
    const before = media.find(
      (c) =>
        c !== clip &&
        c.trackId === clip.trackId &&
        c.assetId === clip.assetId &&
        c.speed === clip.speed &&
        Math.abs(clipEnd(c) - clip.start) < 1e-3 &&
        Math.abs(sourceTime(c, clipEnd(c)) - clip.in) < 1e-3,
    )
    keys.set(clip.id, before ? keys.get(before.id)! : clip.id)
  }
  return keys
}

/** Every marker and clip edge, sorted: what "jump to previous/next" moves between. */
export function editPoints(p: Project): number[] {
  const points = new Set<number>([0, ...p.markers.map((m) => m.time)])
  for (const c of p.clips) {
    points.add(c.start)
    points.add(clipEnd(c))
  }
  return [...points].sort((a, b) => a - b)
}
