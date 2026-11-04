// The editing tools Claude can call. Definitions (names, descriptions, JSON schemas) live in
// mcp/tools.json so the MCP bridge and the in-app assistant share exactly one list.
import TOOL_JSON from '../../mcp/tools.json'
import {
  addAdjustmentLayer,
  addClip,
  addMarker,
  addSolidLayer,
  addTextLayer,
  addTrack,
  applyEffect,
  applyPreset,
  deleteClip,
  importPaths,
  removeEffect,
  removeMarker,
  setClipSpeed,
  splitClips,
  updateClip,
  updateEffect,
  updateMask,
} from '../actions'
import { EFFECT_MAP, EFFECTS } from '../effects'
import { hasSource } from '../engine/media'
import { captureFrame, pause, seek } from '../engine/playback'
import { layerGeometry, toLayer } from '../lib/geometry'
import { readProp, resolveClip, setKeyframe } from '../lib/keyframes'
import { PRESETS } from '../lib/presets'
import { clamp } from '../lib/time'
import { clipEnd, contentEnd, isActiveAt, isFree, layerTime } from '../lib/timeline'
import { desktop } from '../platform'
import {
  BLEND_MODES,
  DEFAULT_AUDIO,
  DEFAULT_COLOR,
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
  clipKind,
  clipLabel,
  type BlendMode,
  type Clip,
  type Project,
} from '../project'
import { commit, getState, redo, setState, undo } from '../store'
import { generateCaptions } from './captions'
import { maskFromPrompt, trackMask } from './maskTools'

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
}

export const TOOL_DEFS = TOOL_JSON as ToolDef[]

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export interface ToolResult {
  content: ToolContent[]
  isError?: boolean
}

type Args = Record<string, any>

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }],
})

class ToolError extends Error {}
const fail = (message: string): never => {
  throw new ToolError(message)
}

const project = () => getState().project
const findClip = (id: string): Clip => project().clips.find((c) => c.id === id) ?? fail(`No clip with id "${id}". Call get_project for ids.`)
const num = (v: unknown, name: string) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`"${name}" must be a number`))

/** Copy known numeric keys from `src` onto `dst`. */
function mergeNumbers<T extends object>(dst: T, src: unknown, defaults: T) {
  if (!src || typeof src !== 'object') return
  for (const [k, v] of Object.entries(src)) if (k in defaults && typeof v === 'number') (dst as Record<string, number>)[k] = v
}

function summarize(p: Project) {
  const nonDefault = (obj: object, defaults: object) =>
    Object.fromEntries(Object.entries(obj).filter(([k, v]) => (defaults as Record<string, unknown>)[k] !== v))
  return {
    name: p.name,
    composition: p.settings,
    duration: contentEnd(p),
    playhead: getState().time,
    work_area: p.workArea,
    tracks: p.tracks.map((t, i) => ({ id: t.id, name: t.name, layer_order: i, hidden: t.hidden, muted: t.muted, locked: t.locked, solo: t.solo })),
    assets: p.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, duration: a.duration, width: a.width, height: a.height, online: hasSource(a.id) })),
    clips: p.clips.map((c) => ({
      id: c.id,
      track_id: c.trackId,
      kind: clipKind(c, p.assets),
      label: clipLabel(c, p.assets),
      asset_id: c.assetId,
      start: c.start,
      end: clipEnd(c),
      source_in: c.in,
      speed: c.speed,
      blend_mode: c.blendMode,
      transform: nonDefault(c.transform, DEFAULT_TRANSFORM),
      color: nonDefault(c.color, DEFAULT_COLOR),
      audio: nonDefault(c.audio, DEFAULT_AUDIO),
      text: c.text,
      solid: c.solid,
      effects: c.effects.map((e) => ({ id: e.id, type: e.type, enabled: e.enabled, params: e.params })),
      masks: c.masks.map((m) => ({ id: m.id, name: m.name, kind: m.kind, mode: m.mode, inverted: m.inverted, feather: m.feather, expansion: m.expansion, tracked: !!m.frames })),
      animated_properties: Object.keys(c.keyframes),
    })),
    markers: p.markers,
  }
}

async function frameImage(time: number | undefined, maxSize: number) {
  pause()
  if (time !== undefined) seek(time)
  const canvas = await captureFrame(maxSize)
  const data = canvas.toDataURL('image/png').split(',')[1]
  const { width, height } = project().settings
  return {
    content: [
      { type: 'image', data, mimeType: 'image/png' },
      { type: 'text', text: `Frame at ${getState().time.toFixed(2)}s. Image is ${canvas.width}x${canvas.height}; the composition is ${width}x${height} px.` },
    ],
  } satisfies ToolResult
}

const HANDLERS: Record<string, (a: Args) => Promise<ToolResult> | ToolResult> = {
  get_project: () => ok(summarize(project())),
  get_frame: (a) => frameImage(a.time, a.max_size ?? 768),
  list_effects: () =>
    ok({
      effects: EFFECTS.map((e) => ({
        type: e.type,
        name: e.name,
        category: e.category,
        description: e.description,
        params: e.params.map((p) => ({ key: p.key, type: p.type, default: p.default, min: p.min, max: p.max, unit: p.unit, options: p.options })),
      })),
      presets: PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description })),
    }),
  seek: (a) => {
    seek(num(a.time, 'time'))
    return ok(`Playhead at ${getState().time}s`)
  },
  import_media: async (a) => {
    if (!desktop) fail('Importing by path needs the OpenComp desktop app. In the browser, ask the user to drag files in.')
    const assets = await importPaths(a.paths ?? [])
    return ok(assets.map((x) => ({ id: x.id, name: x.name, kind: x.kind, duration: x.duration })))
  },
  add_media_clip: (a) => {
    const id = addClip(a.asset_id, a.start, a.track_id) ?? fail(`No asset with id "${a.asset_id}".`)
    return ok({ clip_id: id })
  },
  add_text: (a) => {
    const text = {
      ...DEFAULT_TEXT,
      text: String(a.text),
      ...(a.size !== undefined && { size: num(a.size, 'size') }),
      ...(a.color && { color: a.color }),
      ...(a.font && { font: a.font }),
      ...(a.bold !== undefined && { bold: !!a.bold }),
      ...(a.italic !== undefined && { italic: !!a.italic }),
      ...(a.align && { align: a.align }),
      ...(a.box !== undefined && { box: !!a.box }),
      ...(a.box_color && { boxColor: a.box_color }),
      ...(a.stroke_width !== undefined && { strokeWidth: num(a.stroke_width, 'stroke_width') }),
      ...(a.stroke_color && { strokeColor: a.stroke_color }),
    }
    const id = addTextLayer(text.text, {
      text,
      transform: { ...DEFAULT_TRANSFORM, x: a.x ?? 0, y: a.y ?? 0 },
      ...(a.start !== undefined && { start: num(a.start, 'start') }),
      ...(a.duration !== undefined && { duration: num(a.duration, 'duration') }),
    })
    return ok({ clip_id: id })
  },
  add_solid: (a) => {
    const id = addSolidLayer(a.color, { ...(a.start !== undefined && { start: a.start }), ...(a.duration !== undefined && { duration: a.duration }) })
    return ok({ clip_id: id })
  },
  add_adjustment_layer: (a) => {
    const id = addAdjustmentLayer({ ...(a.start !== undefined && { start: a.start }), ...(a.duration !== undefined && { duration: a.duration }) })
    return ok({ clip_id: id })
  },
  update_clip: (a) => {
    const clip = findClip(a.clip_id)
    const start = a.start ?? clip.start
    const duration = a.duration ?? clip.duration
    const trackId = a.track_id ?? clip.trackId
    if (!project().tracks.some((t) => t.id === trackId)) fail(`No track with id "${trackId}".`)
    if (!isFree(project(), trackId, start, start + duration, clip.id)) fail('That would overlap another clip on the track.')
    if (a.blend_mode && !BLEND_MODES.includes(a.blend_mode)) fail(`blend_mode must be one of ${BLEND_MODES.join(', ')}`)
    updateClip(clip.id, (c) => {
      c.start = Math.max(0, start)
      c.duration = Math.max(0.01, duration)
      c.trackId = trackId
      if (a.name !== undefined) c.name = String(a.name)
      if (a.blend_mode) c.blendMode = a.blend_mode as BlendMode
      mergeNumbers(c.transform, a.transform, DEFAULT_TRANSFORM)
      mergeNumbers(c.color, a.color, DEFAULT_COLOR)
      mergeNumbers(c.audio, a.audio, DEFAULT_AUDIO)
      if (c.text && a.text && typeof a.text === 'object') c.text = { ...c.text, ...a.text }
      if (c.solid && typeof a.solid === 'string') c.solid = a.solid
    })
    if (a.speed !== undefined) setClipSpeed(clip.id, num(a.speed, 'speed'))
    return ok('Updated')
  },
  split_clip: (a) => {
    const t = num(a.time, 't')
    const ids = a.clip_id ? [findClip(a.clip_id).id] : project().clips.filter((c) => isActiveAt(c, t)).map((c) => c.id)
    const before = project().clips.length
    splitClips(ids, t)
    return ok(`${project().clips.length - before} cut(s) made`)
  },
  delete_clip: (a) => {
    deleteClip(findClip(a.clip_id).id, !!a.ripple)
    return ok('Deleted')
  },
  add_effect: (a) => {
    const def = EFFECT_MAP.get(a.type) ?? fail(`Unknown effect "${a.type}". Call list_effects.`)
    const clip = findClip(a.clip_id)
    const id = applyEffect(def.type, clip.id)!
    if (a.params) updateEffect(clip.id, id, (fx) => Object.assign(fx.params, a.params))
    return ok({ effect_id: id })
  },
  update_effect: (a) => {
    const clip = findClip(a.clip_id)
    if (!clip.effects.some((e) => e.id === a.effect_id)) fail(`No effect "${a.effect_id}" on that clip.`)
    updateEffect(clip.id, a.effect_id, (fx) => {
      if (a.params) Object.assign(fx.params, a.params)
      if (a.enabled !== undefined) fx.enabled = !!a.enabled
    })
    return ok('Updated')
  },
  remove_effect: (a) => {
    removeEffect(findClip(a.clip_id).id, a.effect_id)
    return ok('Removed')
  },
  set_keyframe: (a) => {
    const clip = findClip(a.clip_id)
    if (readProp(clip, a.property) === undefined) fail(`"${a.property}" isn't an animatable number on this clip.`)
    const t = layerTime(clip, num(a.time, 'time'))
    updateClip(clip.id, (c) => setKeyframe(c, a.property, t, num(a.value, 'value'), a.ease ?? 'ease'))
    return ok('Keyframe set')
  },
  apply_preset: (a) => {
    if (!PRESETS.some((p) => p.id === a.preset)) fail(`Unknown preset. Options: ${PRESETS.map((p) => p.id).join(', ')}`)
    applyPreset(a.preset, findClip(a.clip_id).id)
    return ok('Applied')
  },
  add_marker: (a) => {
    addMarker(num(a.time, 'time'), a.label ?? '')
    return ok('Marker added')
  },
  remove_marker: (a) => {
    removeMarker(a.marker_id)
    return ok('Removed')
  },
  set_composition: (a) => {
    const even = (n: number) => clamp(Math.round(n / 2) * 2, 16, 7680)
    commit((p) => {
      if (a.name) p.name = String(a.name)
      if (a.width) p.settings.width = even(num(a.width, 'width'))
      if (a.height) p.settings.height = even(num(a.height, 'height'))
      if (a.fps) p.settings.fps = clamp(num(a.fps, 'fps'), 1, 120)
      if (a.background) p.settings.background = String(a.background)
    })
    return ok(project().settings)
  },
  set_work_area: (a) => {
    commit((p) => {
      p.workArea = a.start !== undefined && a.end !== undefined && a.end > a.start ? [a.start, a.end] : null
    })
    return ok(project().workArea ? `Work area ${project().workArea}` : 'Work area cleared')
  },
  ai_mask: async (a) => {
    const clip = findClip(a.clip_id)
    const asset = project().assets.find((x) => x.id === clip.assetId)
    if (!asset || asset.kind === 'audio') fail('AI masks need a video or image clip.')
    pause()
    seek(a.time ?? Math.max(clip.start, Math.min(getState().time, clipEnd(clip) - 0.01)))
    if (!isActiveAt(clip, getState().time)) fail('That time is outside the clip.')
    const { width, height } = project().settings
    const r = resolveClip(clip, layerTime(clip, getState().time))
    const g = layerGeometry(r.transform, asset!.width, asset!.height, width, height)
    const points = (a.points ?? []).map((pt: Args) => [...toLayer(g, num(pt.x, 'x'), num(pt.y, 'y')), pt.include === false ? 0 : 1]) as [number, number, 0 | 1][]
    if (!points.length) fail('Give at least one point.')
    setState({ selectedClipId: clip.id, selectedMaskId: null })
    const maskId = (await maskFromPrompt(points, true)) ?? fail('The model found nothing at those points.')
    return ok({ mask_id: maskId })
  },
  update_mask: (a) => {
    const clip = findClip(a.clip_id)
    if (!clip.masks.some((m) => m.id === a.mask_id)) fail(`No mask "${a.mask_id}" on that clip.`)
    updateMask(clip.id, a.mask_id, (m) => {
      if (a.mode) m.mode = a.mode
      if (a.inverted !== undefined) m.inverted = !!a.inverted
      if (a.enabled !== undefined) m.enabled = !!a.enabled
      if (a.feather !== undefined) m.feather = num(a.feather, 'feather')
      if (a.expansion !== undefined) m.expansion = num(a.expansion, 'expansion')
      if (a.opacity !== undefined) m.opacity = num(a.opacity, 'opacity')
    })
    return ok('Updated')
  },
  track_mask: async (a) => {
    const clip = findClip(a.clip_id)
    const dirs: (1 | -1)[] = a.direction === 'backward' ? [-1] : a.direction === 'both' ? [1, -1] : [1]
    for (const dir of dirs) await trackMask(clip.id, a.mask_id, dir)
    return ok('Tracked')
  },
  generate_captions: async (a) => ok(`Added ${await generateCaptions(a.clip_id ? [findClip(a.clip_id).id] : undefined)} captions`),
  add_track: () => {
    addTrack()
    return ok({ track_id: project().tracks[0].id })
  },
  undo: () => {
    undo()
    return ok('Undone')
  },
  redo: () => {
    redo()
    return ok('Redone')
  },
}

/** Run a tool by name. Never throws: failures come back as an error result Claude can read. */
export async function runTool(name: string, args: unknown): Promise<ToolResult> {
  const handler = HANDLERS[name]
  if (!handler) return { content: [{ type: 'text', text: `Unknown tool "${name}"` }], isError: true }
  try {
    return await handler((args ?? {}) as Args)
  } catch (err) {
    return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true }
  }
}
