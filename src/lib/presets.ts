// Animation presets: one click adds keyframes to a clip (in the spirit of After Effects' presets).
import { EFFECT_MAP, defaultParams } from '../effects'
import { uid, type Clip } from '../project'
import { setKeyframe } from './keyframes'
import { layerTime } from './timeline'

export interface Preset {
  id: string
  name: string
  description: string
  apply(clip: Clip, comp: { width: number; height: number; fps: number }): void
}

const IN = 0.6 // seconds for "in" animations
const start = (c: Clip) => layerTime(c, c.start)
const end = (c: Clip) => layerTime(c, c.start + c.duration)

const slideIn = (axis: 'x' | 'y', sign: number): Preset['apply'] => (c, comp) => {
  const t0 = start(c)
  const distance = axis === 'x' ? comp.width : comp.height
  setKeyframe(c, `transform.${axis}`, t0, sign * distance)
  setKeyframe(c, `transform.${axis}`, t0 + IN, c.transform[axis])
}

export const PRESETS: Preset[] = [
  {
    id: 'fade-in', name: 'Fade In', description: 'Opacity 0 → 100% over half a second.',
    apply: (c) => {
      setKeyframe(c, 'transform.opacity', start(c), 0)
      setKeyframe(c, 'transform.opacity', start(c) + 0.5, 100)
    },
  },
  {
    id: 'fade-out', name: 'Fade Out', description: 'Opacity 100 → 0% over the last half second.',
    apply: (c) => {
      setKeyframe(c, 'transform.opacity', end(c) - 0.5, 100)
      setKeyframe(c, 'transform.opacity', end(c), 0)
    },
  },
  { id: 'slide-left', name: 'Slide In From Left', description: 'Glide in from off-screen left.', apply: slideIn('x', -1) },
  { id: 'slide-right', name: 'Slide In From Right', description: 'Glide in from off-screen right.', apply: slideIn('x', 1) },
  { id: 'slide-up', name: 'Slide In From Bottom', description: 'Rise in from below the frame.', apply: slideIn('y', 1) },
  { id: 'slide-down', name: 'Slide In From Top', description: 'Drop in from above the frame.', apply: slideIn('y', -1) },
  {
    id: 'pop-in', name: 'Pop In', description: 'Scale up with a little overshoot.',
    apply: (c) => {
      const t0 = start(c)
      setKeyframe(c, 'transform.scale', t0, 0)
      setKeyframe(c, 'transform.scale', t0 + 0.25, c.transform.scale * 1.1)
      setKeyframe(c, 'transform.scale', t0 + 0.4, c.transform.scale)
      setKeyframe(c, 'transform.opacity', t0, 0)
      setKeyframe(c, 'transform.opacity', t0 + 0.1, c.transform.opacity)
    },
  },
  {
    id: 'spin-in', name: 'Spin In', description: 'Spin and grow into place.',
    apply: (c) => {
      const t0 = start(c)
      setKeyframe(c, 'transform.rotation', t0, c.transform.rotation - 180)
      setKeyframe(c, 'transform.rotation', t0 + IN, c.transform.rotation)
      setKeyframe(c, 'transform.scale', t0, 0)
      setKeyframe(c, 'transform.scale', t0 + IN, c.transform.scale)
    },
  },
  {
    id: 'ken-burns-in', name: 'Slow Zoom In (Ken Burns)', description: 'Gently push in over the whole clip.',
    apply: (c) => {
      setKeyframe(c, 'transform.scale', start(c), c.transform.scale, 'linear')
      setKeyframe(c, 'transform.scale', end(c), c.transform.scale * 1.15, 'linear')
    },
  },
  {
    id: 'ken-burns-out', name: 'Slow Zoom Out', description: 'Gently pull back over the whole clip.',
    apply: (c) => {
      setKeyframe(c, 'transform.scale', start(c), c.transform.scale * 1.15, 'linear')
      setKeyframe(c, 'transform.scale', end(c), c.transform.scale, 'linear')
    },
  },
  {
    id: 'drift', name: 'Slow Drift', description: 'A subtle sideways pan across the clip.',
    apply: (c) => {
      setKeyframe(c, 'transform.x', start(c), c.transform.x - 40, 'linear')
      setKeyframe(c, 'transform.x', end(c), c.transform.x + 40, 'linear')
    },
  },
  {
    id: 'shake', name: 'Camera Shake', description: 'A short, decaying shake at the start of the clip.',
    apply: (c, comp) => {
      const t0 = start(c)
      const frames = Math.round(comp.fps * 0.6)
      for (let i = 0; i <= frames; i += 2) {
        const decay = 1 - i / frames
        const t = t0 + i / comp.fps
        setKeyframe(c, 'transform.x', t, c.transform.x + (Math.random() - 0.5) * 30 * decay, 'linear')
        setKeyframe(c, 'transform.y', t, c.transform.y + (Math.random() - 0.5) * 30 * decay, 'linear')
      }
    },
  },
  {
    id: 'blur-in', name: 'Blur In', description: 'Start blurred and come into focus.',
    apply: (c) => {
      const def = EFFECT_MAP.get('gaussian-blur')!
      const fx = { id: uid(), type: def.type, enabled: true, params: defaultParams(def) }
      c.effects.push(fx)
      setKeyframe(c, `fx.${fx.id}.radius`, start(c), 40)
      setKeyframe(c, `fx.${fx.id}.radius`, start(c) + IN, 0)
    },
  },
]
