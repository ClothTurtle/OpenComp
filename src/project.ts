// The project data model. Everything here is plain JSON: it is what gets saved, autosaved and undone.
// Runtime objects (files, <video> elements, textures) live in src/engine and are never stored here.

export type AssetKind = 'video' | 'audio' | 'image'

/** A media file imported into the Project panel. */
export interface Asset {
  id: string
  name: string
  kind: AssetKind
  duration: number // seconds; for images, the default still length
  width: number
  height: number
  path?: string // absolute file path (desktop app only), so media never goes offline
}

/** Position is an offset from the frame centre in comp pixels. Scale and opacity are percentages. */
export interface Transform {
  x: number
  y: number
  scale: number
  rotation: number // degrees, clockwise
  opacity: number
}

/** Every value is 0 at neutral. Exposure is in stops; the rest range from -100 to 100. */
export interface ColorGrade {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  saturation: number
  temperature: number
  tint: number
}

export interface AudioSettings {
  volume: number // percent; above 100 boosts
  pan: number // -100 (left) .. 100 (right)
  fadeIn: number // seconds
  fadeOut: number
  low: number // EQ gains in dB
  mid: number
  high: number
}

export interface TextStyle {
  text: string
  font: string
  size: number // comp px
  color: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  strokeWidth: number
  strokeColor: string
  shadow: boolean
  box: boolean
  boxColor: string
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'add'
  | 'darken'
  | 'lighten'
  | 'difference'

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'add',
  'darken',
  'lighten',
  'difference',
]

export type ParamValue = number | string | boolean

/** An effect applied to a clip. `type` refers to an entry in src/effects.ts. */
export interface Effect {
  id: string
  type: string
  enabled: boolean
  params: Record<string, ParamValue>
}

/** A point in layer space, normalised so (0, 0) is the layer's top-left and (1, 1) its bottom-right. */
export type Point = [number, number]

export type MaskMode = 'add' | 'subtract' | 'intersect'

export interface Mask {
  id: string
  name: string
  kind: 'rect' | 'ellipse' | 'path' | 'ai'
  enabled: boolean
  mode: MaskMode
  inverted: boolean
  feather: number // comp px
  expansion: number // comp px, negative shrinks
  opacity: number // percent
  shape: Point[][] // outlines (even-odd filled). For AI masks: the result on the frame you clicked.
  frames?: Record<string, Point[][]> // AI masks after tracking, keyed by source frame (see MASK_FPS)
  prompt?: { frame: number; points: [number, number, 0 | 1][] } // AI masks: the clicks/strokes (1 = include, 0 = exclude)
}

export interface Keyframe {
  t: number // layer time (see layerTime in lib/timeline.ts)
  v: number
  ease: 'linear' | 'ease' | 'hold'
}

/** One item on the timeline: a piece of media, or a generated text / solid / adjustment layer. */
export interface Clip {
  id: string
  trackId: string
  start: number // where it sits on the timeline (s)
  in: number // offset into the source media (s)
  duration: number // length on the timeline (s)
  assetId?: string
  text?: TextStyle
  solid?: string // #rrggbb
  adjustment?: boolean // applies its colour, effects and masks to everything below it
  name?: string
  speed: number // percent
  blendMode: BlendMode
  transform: Transform
  color: ColorGrade
  audio: AudioSettings
  effects: Effect[]
  masks: Mask[]
  keyframes: Record<string, Keyframe[]> // property path (e.g. "transform.x") -> keyframes
}

export interface Track {
  id: string
  name: string
  hidden: boolean
  muted: boolean
  locked: boolean
  solo: boolean
}

/** A bookmark on the timeline. */
export interface Marker {
  id: string
  time: number
  label: string
  color: string
}

export interface CompSettings {
  width: number
  height: number
  fps: number
  background: string // #rrggbb
}

export interface Project {
  version: 2
  name: string
  settings: CompSettings
  assets: Asset[]
  tracks: Track[] // index 0 is the top layer
  clips: Clip[]
  markers: Marker[]
  workArea: [number, number] | null // in/out range for playback looping and export
}

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 }

export const DEFAULT_COLOR: ColorGrade = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
}

export const DEFAULT_AUDIO: AudioSettings = { volume: 100, pan: 0, fadeIn: 0, fadeOut: 0, low: 0, mid: 0, high: 0 }

export const DEFAULT_TEXT: TextStyle = {
  text: 'Your text here',
  font: 'Segoe UI, Inter, Helvetica, Arial, sans-serif',
  size: 96,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  strokeWidth: 0,
  strokeColor: '#000000',
  shadow: true,
  box: false,
  boxColor: '#000000',
}

export const IMAGE_DURATION = 5
export const MASK_FPS = 30 // AI mask frames are stored at this rate, whatever the composition's frame rate

// Not crypto.randomUUID(): that only exists on https/localhost, and the app may be served over a LAN.
export const uid = () => Math.random().toString(36).slice(2, 10)

export const newTrack = (n: number): Track => ({
  id: uid(),
  name: `Track ${n}`,
  hidden: false,
  muted: false,
  locked: false,
  solo: false,
})

/** A clip with every optional setting at its default. */
export function newClip(fields: Partial<Clip> & Pick<Clip, 'trackId' | 'start' | 'duration'>): Clip {
  return {
    id: uid(),
    in: 0,
    speed: 100,
    blendMode: 'normal',
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    audio: { ...DEFAULT_AUDIO },
    effects: [],
    masks: [],
    keyframes: {},
    ...fields,
  }
}

export function newProject(): Project {
  return {
    version: 2,
    name: 'Untitled Project',
    settings: { width: 1920, height: 1080, fps: 30, background: '#000000' },
    assets: [],
    tracks: [newTrack(1), newTrack(2), newTrack(3)],
    clips: [],
    markers: [],
    workArea: null,
  }
}

export type LayerKind = AssetKind | 'text' | 'solid' | 'adjustment'

export function clipKind(clip: Clip, assets: Asset[]): LayerKind | null {
  if (clip.text) return 'text'
  if (clip.solid) return 'solid'
  if (clip.adjustment) return 'adjustment'
  return assets.find((a) => a.id === clip.assetId)?.kind ?? null
}

export function clipLabel(clip: Clip, assets: Asset[]): string {
  if (clip.name) return clip.name
  if (clip.text) return clip.text.text.split('\n')[0] || 'Text'
  if (clip.solid) return 'Solid'
  if (clip.adjustment) return 'Adjustment Layer'
  return assets.find((a) => a.id === clip.assetId)?.name ?? 'Missing media'
}

/**
 * Bring a project from any saved version (or from an AI tool call) up to the current shape,
 * filling in anything missing with defaults.
 */
export function migrateProject(raw: unknown): Project {
  const p = raw as Partial<Project> & { version?: number }
  if (!p || typeof p !== 'object' || !Array.isArray(p.clips)) throw new Error('Not an OpenComp project')
  const base = newProject()
  return {
    version: 2,
    name: p.name ?? base.name,
    settings: { ...base.settings, ...p.settings },
    assets: p.assets ?? [],
    tracks: (p.tracks ?? base.tracks).map((t) => ({ ...newTrack(0), ...t })),
    clips: p.clips.map((legacy) => {
      const { volume, ...c } = legacy as Clip & { volume?: number } // v1 kept volume on the clip
      return newClip({
        ...c,
        transform: { ...DEFAULT_TRANSFORM, ...c.transform },
        color: { ...DEFAULT_COLOR, ...c.color },
        audio: { ...DEFAULT_AUDIO, ...(volume !== undefined && { volume }), ...c.audio },
        effects: c.effects ?? [],
        masks: c.masks ?? [],
        keyframes: c.keyframes ?? {},
      })
    }),
    markers: p.markers ?? [],
    workArea: p.workArea ?? null,
  }
}
