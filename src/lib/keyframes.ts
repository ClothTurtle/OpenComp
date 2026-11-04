// Keyframe animation. Animatable properties are addressed by path:
//   transform.x  color.exposure  audio.volume  text.size  fx.<effectId>.<param>
import type { Clip, Keyframe } from '../project'

const SAME_TIME = 1e-3

export function readProp(clip: Clip, path: string): number | undefined {
  const [group, key, param] = path.split('.')
  let value: unknown
  if (group === 'transform') value = clip.transform[key as keyof Clip['transform']]
  else if (group === 'color') value = clip.color[key as keyof Clip['color']]
  else if (group === 'audio') value = clip.audio[key as keyof Clip['audio']]
  else if (group === 'text') value = clip.text?.[key as keyof NonNullable<Clip['text']>]
  else if (group === 'fx') value = clip.effects.find((e) => e.id === key)?.params[param]
  return typeof value === 'number' ? value : undefined
}

export function writeProp(clip: Clip, path: string, v: number) {
  const [group, key, param] = path.split('.')
  if (group === 'transform') (clip.transform as unknown as Record<string, number>)[key] = v
  else if (group === 'color') (clip.color as unknown as Record<string, number>)[key] = v
  else if (group === 'audio') (clip.audio as unknown as Record<string, number>)[key] = v
  else if (group === 'text' && clip.text) (clip.text as unknown as Record<string, number>)[key] = v
  else if (group === 'fx') {
    const fx = clip.effects.find((e) => e.id === key)
    if (fx) fx.params[param] = v
  }
}

const EASING: Record<Keyframe['ease'], (x: number) => number> = {
  linear: (x) => x,
  ease: (x) => x * x * (3 - 2 * x),
  hold: () => 0,
}

/** Interpolated value of sorted keyframes at time t. */
export function sample(keys: Keyframe[], t: number): number {
  if (t <= keys[0].t) return keys[0].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t < b.t) return a.v + (b.v - a.v) * EASING[a.ease]((t - a.t) / (b.t - a.t))
  }
  return keys[keys.length - 1].v
}

/** A copy of the clip with every animated property set to its value at layer time t. */
export function resolveClip(clip: Clip, t: number): Clip {
  const paths = Object.keys(clip.keyframes).filter((p) => clip.keyframes[p].length)
  if (!paths.length) return clip
  const out: Clip = {
    ...clip,
    transform: { ...clip.transform },
    color: { ...clip.color },
    audio: { ...clip.audio },
    text: clip.text && { ...clip.text },
    effects: clip.effects.map((e) => ({ ...e, params: { ...e.params } })),
  }
  for (const path of paths) writeProp(out, path, sample(clip.keyframes[path], t))
  return out
}

export const keyIndexAt = (keys: Keyframe[] | undefined, t: number) =>
  keys?.findIndex((k) => Math.abs(k.t - t) < SAME_TIME) ?? -1

/** Add or replace the keyframe at time t (mutates the clip, as inside commit()). */
export function setKeyframe(clip: Clip, path: string, t: number, v: number, ease: Keyframe['ease'] = 'ease') {
  const keys = (clip.keyframes[path] ??= [])
  const i = keyIndexAt(keys, t)
  if (i >= 0) keys[i] = { ...keys[i], v }
  else {
    keys.push({ t, v, ease })
    keys.sort((a, b) => a.t - b.t)
  }
}

export function removeKeyframe(clip: Clip, path: string, t: number) {
  const keys = clip.keyframes[path]
  const i = keyIndexAt(keys, t)
  if (i >= 0) keys.splice(i, 1)
  if (keys && !keys.length) delete clip.keyframes[path]
}

/** Turn animation on (keyframe the current value) or off (keep the value at t, drop the keyframes). */
export function toggleAnimation(clip: Clip, path: string, t: number) {
  if (clip.keyframes[path]?.length) {
    const v = sample(clip.keyframes[path], t)
    delete clip.keyframes[path]
    writeProp(clip, path, v)
  } else {
    const v = readProp(clip, path)
    if (v !== undefined) setKeyframe(clip, path, t, v)
  }
}

/** Sorted, de-duplicated times of every keyframe on a clip. */
export function keyframeTimes(clip: Clip): number[] {
  const times = Object.values(clip.keyframes).flatMap((keys) => keys.map((k) => k.t))
  return [...new Set(times)].sort((a, b) => a - b)
}
