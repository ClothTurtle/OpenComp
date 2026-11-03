/** Round a time (s) to the nearest whole frame. */
export const toFrame = (t: number, fps: number) => Math.round(t * fps) / fps

/** H:MM:SS:FF timecode, used everywhere a time is shown. Fractional rates use non-drop counting. */
export function timecode(t: number, fps: number): string {
  const rate = Math.round(fps)
  const frames = Math.max(0, Math.round(t * fps))
  const seconds = Math.floor(frames / rate)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(frames % rate)}`
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
