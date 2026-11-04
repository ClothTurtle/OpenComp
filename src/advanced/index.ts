// The After Effects-style effects shown on the sidebar's "Advanced (AE)" page, by AE category.
// AE effects that OpenComp already has as an essential effect are listed as aliases of it.
import type { EffectDef } from '../fxlib'
import { CHANNEL_3D } from './channel3d'
import { COLOR_CORRECTION } from './color'
import { DISTORT } from './distort'
import { EXTRAS } from './extras'
import { GENERATE } from './generate'
import { PERSPECTIVE } from './perspective'
import { STYLIZE } from './stylize'

export const ADVANCED_EFFECTS: EffectDef[] = [...CHANNEL_3D, ...COLOR_CORRECTION, ...DISTORT, ...PERSPECTIVE, ...STYLIZE, ...EXTRAS, ...GENERATE]

/** The page's category order. */
export const ADVANCED_CATEGORIES = [
  '3D Channel', 'Color Correction', 'Distort', 'Perspective', 'Stylize',
  'Blur & Sharpen', 'Channel', 'Generate', 'Keying', 'Matte', 'Noise & Grain', 'Transition', 'Simulation',
]

/** AE effects that map onto an existing effect: [AE name, AE category, effect type]. */
export const ADVANCED_ALIASES: [string, string, string][] = [
  ['Brightness & Contrast', 'Color Correction', 'brightness-contrast'],
  ['Hue/Saturation', 'Color Correction', 'hue-saturation'],
  ['Levels', 'Color Correction', 'levels'],
  ['Tint', 'Color Correction', 'tint'],
  ['Vibrance', 'Color Correction', 'vibrance'],
  ['Bend It', 'Distort', 'ae-bender'],
  ['Bulge', 'Distort', 'bulge'],
  ['Offset', 'Distort', 'offset'],
  ['Power Pin', 'Distort', 'ae-corner-pin'],
  ['Split 2', 'Distort', 'ae-split'],
  ['Twirl', 'Distort', 'twirl'],
  ['Wave Warp', 'Distort', 'wave-warp'],
  ['Drop Shadow', 'Perspective', 'drop-shadow'],
  ['Cartoon', 'Stylize', 'cartoon'],
  ['Emboss', 'Stylize', 'emboss'],
  ['Find Edges', 'Stylize', 'find-edges'],
  ['Glow', 'Stylize', 'glow'],
  ['Kaleida', 'Stylize', 'kaleidoscope'],
  ['Posterize', 'Stylize', 'posterize'],
  ['Threshold', 'Stylize', 'threshold'],
  ['Vignette', 'Stylize', 'vignette'],
  ['Directional Blur', 'Blur & Sharpen', 'directional-blur'],
  ['Gaussian Blur', 'Blur & Sharpen', 'gaussian-blur'],
  ['Radial Fast Blur', 'Blur & Sharpen', 'zoom-blur'],
  ['Sharpen', 'Blur & Sharpen', 'sharpen'],
  ['Fill', 'Generate', 'fill'],
  ['Gradient Ramp', 'Generate', 'gradient-ramp'],
  ['Noise', 'Noise & Grain', 'noise'],
  ['Turbulent Noise', 'Noise & Grain', 'ae-fractal-noise'],
  ['Median (Legacy)', 'Noise & Grain', 'ae-median'],
  ['Iris Wipe', 'Transition', 'iris-wipe'],
  ['Linear Wipe', 'Transition', 'linear-wipe'],
  ['Radial Wipe', 'Transition', 'radial-wipe'],
]
