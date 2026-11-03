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

/** One piece of an asset placed on the timeline. */
export interface Clip {
  id: string
  assetId: string
  trackId: string
  start: number // where it sits on the timeline (s)
  in: number // offset into the source media (s)
  duration: number // length on the timeline (s)
  volume: number // percent; above 100 boosts
  transform: Transform
  color: ColorGrade
}

export interface Track {
  id: string
  name: string
  hidden: boolean
  muted: boolean
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
  version: 1
  name: string
  settings: CompSettings
  assets: Asset[]
  tracks: Track[] // index 0 is the top layer
  clips: Clip[]
  markers: Marker[]
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

export const IMAGE_DURATION = 5

// Not crypto.randomUUID(): that only exists on https/localhost, and the app may be served over a LAN.
export const uid = () => Math.random().toString(36).slice(2, 10)

export const newTrack = (n: number): Track => ({ id: uid(), name: `Track ${n}`, hidden: false, muted: false })

export function newProject(): Project {
  return {
    version: 1,
    name: 'Untitled Project',
    settings: { width: 1920, height: 1080, fps: 30, background: '#000000' },
    assets: [],
    tracks: [newTrack(1), newTrack(2), newTrack(3)],
    clips: [],
    markers: [],
  }
}
