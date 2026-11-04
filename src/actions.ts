// Every editing command the UI, keyboard shortcuts and AI tools can run. They change the project
// through commit() so everything here is undoable.
import { EFFECT_MAP, defaultParams } from './effects'
import { hasSource, kindOf, kindOfName, loadFile, loadUrl } from './engine/media'
import { captureFrame, seek } from './engine/playback'
import { download, fileSafe, MEDIA_ACCEPT, pickFiles } from './lib/files'
import { PRESETS } from './lib/presets'
import { clamp, toFrame } from './lib/time'
import { clipEnd, contentEnd, editPoints, isActiveAt, isFree, splitClip } from './lib/timeline'
import { desktop } from './platform'
import {
  DEFAULT_TEXT,
  migrateProject,
  newClip,
  newProject,
  newTrack,
  uid,
  type Asset,
  type AssetKind,
  type Clip,
  type Effect,
  type Marker,
  type Mask,
  type Point,
  type Project,
  type Track,
} from './project'
import { commit, getState, replaceProject, setState } from './store'

// ---- Media ----------------------------------------------------------------------------------

const BAD_MEDIA = "These files couldn't be opened:"

async function addAssets(items: { name: string; kind: AssetKind | null; path?: string; load: (id: string, kind: AssetKind) => Promise<{ duration: number; width: number; height: number }> }[]) {
  const added: Asset[] = []
  const failed: string[] = []
  for (const item of items) {
    let kind = item.kind
    if (!kind) {
      failed.push(item.name)
      continue
    }
    const id = uid()
    try {
      const info = await item.load(id, kind)
      if (kind === 'video' && !info.width) kind = 'audio' // e.g. an audio-only .webm
      added.push({ id, name: item.name, kind, ...info, ...(item.path && { path: item.path }) })
    } catch {
      failed.push(item.name)
    }
  }
  if (added.length) {
    commit((p) => {
      p.assets.push(...added)
    })
    setState((s) => ({ selectedAssetId: added[0].id, mediaVersion: s.mediaVersion + 1 }))
  }
  if (failed.length) alert(`${BAD_MEDIA}\n\n${failed.join('\n')}`)
  return added
}

/** Import files into the Project panel. In the desktop app they're remembered by path, so they never go offline. */
export function importFiles(files: File[]): Promise<Asset[]> {
  return addAssets(
    files.map((file) => {
      const path = desktop?.pathForFile(file) || undefined
      return {
        name: file.name,
        kind: kindOf(file),
        path,
        load: (id, kind) => (path ? loadUrl(id, desktop!.mediaUrl(path), kind) : loadFile(id, file, kind)),
      }
    }),
  )
}

export function importPaths(paths: string[]): Promise<Asset[]> {
  return addAssets(
    paths.map((path) => {
      const name = path.split(/[\\/]/).pop() ?? path
      return { name, kind: kindOfName(name), path, load: (id, kind) => loadUrl(id, desktop!.mediaUrl(path), kind) }
    }),
  )
}

export async function importDialog() {
  if (desktop) await importPaths(await desktop.openMedia())
  else await importFiles(await pickFiles(MEDIA_ACCEPT))
}

/** Desktop: reconnect every asset whose file still exists at its saved path. */
export async function relinkKnownPaths() {
  if (!desktop) return
  const pending = getState().project.assets.filter((a) => a.path && !hasSource(a.id))
  if (!pending.length) return
  const exists = await desktop.exists(pending.map((a) => a.path!))
  await Promise.all(
    pending.map((a, i) => (exists[i] ? loadUrl(a.id, desktop!.mediaUrl(a.path!), a.kind).catch(() => {}) : null)),
  )
  setState((s) => ({ mediaVersion: s.mediaVersion + 1 }))
}

/** Reconnect offline media by matching file names. */
export async function relinkDialog() {
  const files = desktop ? null : await pickFiles(MEDIA_ACCEPT)
  const paths = desktop ? await desktop.openMedia() : []
  const name = (p: string) => p.split(/[\\/]/).pop()
  for (const asset of getState().project.assets) {
    if (hasSource(asset.id)) continue
    try {
      const path = paths.find((p) => name(p) === asset.name)
      const file = files?.find((f) => f.name === asset.name)
      if (path) {
        await loadUrl(asset.id, desktop!.mediaUrl(path), asset.kind)
        commit((p) => {
          const a = p.assets.find((x) => x.id === asset.id)
          if (a) a.path = path
        })
      } else if (file) await loadFile(asset.id, file, asset.kind)
    } catch {
      // Leave it offline.
    }
  }
  setState((s) => ({ mediaVersion: s.mediaVersion + 1 }))
}

export function removeAsset(id: string) {
  commit((p) => {
    p.assets = p.assets.filter((a) => a.id !== id)
    p.clips = p.clips.filter((c) => c.assetId !== id)
  })
  setState({ selectedAssetId: null })
}

// ---- Clips ----------------------------------------------------------------------------------

const lockedTrack = (p: Project, trackId: string) => p.tracks.find((t) => t.id === trackId)?.locked

/** Insert a clip at its start time on `trackId` if there's room, else the first free track, else a new top track. */
function placeClip(p: Project, clip: Clip, trackId?: string) {
  const fits = (t: Track) => !t.locked && isFree(p, t.id, clip.start, clip.start + clip.duration)
  let track = p.tracks.find((t) => t.id === trackId && fits(t)) ?? p.tracks.find(fits)
  if (!track) {
    track = newTrack(p.tracks.length + 1)
    p.tracks.unshift(track)
  }
  clip.trackId = track.id
  p.clips.push(clip)
}

/** Place an asset on the timeline at `start` (default: the playhead). */
export function addClip(assetId: string, start = getState().time, trackId?: string) {
  const { project } = getState()
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset) return null
  const fps = project.settings.fps
  const at = Math.max(0, toFrame(start, fps))
  const duration = Math.max(1, Math.floor(asset.duration * fps + 1e-6)) / fps
  const clip = newClip({ assetId, trackId: '', start: at, duration })
  commit((p) => placeClip(p, clip, trackId))
  setState({ selectedClipId: clip.id })
  return clip.id
}

/** Generated layers (text, solid, adjustment) go on a new top track at the playhead, like After Effects. */
function addGenerated(fields: Partial<Clip>, duration = 5) {
  const { time, project } = getState()
  const clip = newClip({ trackId: '', start: toFrame(time, project.settings.fps), duration, ...fields })
  commit((p) => {
    const track = newTrack(p.tracks.length + 1)
    p.tracks.unshift(track)
    clip.trackId = track.id
    p.clips.push(clip)
  })
  setState({ selectedClipId: clip.id, selectedMaskId: null })
  return clip.id
}

export const addTextLayer = (text = DEFAULT_TEXT.text, fields: Partial<Clip> = {}) =>
  addGenerated({ text: { ...DEFAULT_TEXT, text }, ...fields })
export const addSolidLayer = (color = '#3a6ea5', fields: Partial<Clip> = {}) => addGenerated({ solid: color, ...fields })
export const addAdjustmentLayer = (fields: Partial<Clip> = {}) =>
  addGenerated({ adjustment: true, ...fields }, Math.max(5, contentEnd(getState().project) - getState().time))

export function updateClip(id: string, change: (clip: Clip) => void, mergeKey?: string) {
  commit((p) => {
    const clip = p.clips.find((c) => c.id === id)
    if (!clip) return false
    change(clip)
  }, mergeKey)
}

export function splitClips(ids: string[], t: number) {
  commit((p) => {
    let changed = false
    for (const id of ids) {
      const i = p.clips.findIndex((c) => c.id === id)
      if (i < 0 || lockedTrack(p, p.clips[i].trackId)) continue
      const parts = splitClip(p.clips[i], t, uid())
      if (parts) {
        p.clips.splice(i, 1, ...parts)
        changed = true
      }
    }
    if (!changed) return false
  })
}

/** Cut at the playhead: just the selected clip if it's under the playhead, otherwise everything under it. */
export function splitAtPlayhead() {
  const { project, time, selectedClipId } = getState()
  const under = project.clips.filter((c) => isActiveAt(c, time))
  const selected = under.find((c) => c.id === selectedClipId)
  splitClips(selected ? [selected.id] : under.map((c) => c.id), time)
}

export function deleteClip(id = getState().selectedClipId, ripple = false) {
  commit((p) => {
    const clip = p.clips.find((c) => c.id === id)
    if (!clip || lockedTrack(p, clip.trackId)) return false
    p.clips = p.clips.filter((c) => c !== clip)
    // Ripple: pull everything after it on the same track back to close the gap.
    if (ripple) for (const c of p.clips) if (c.trackId === clip.trackId && c.start >= clipEnd(clip) - 1e-6) c.start -= clip.duration
  })
  if (id === getState().selectedClipId) setState({ selectedClipId: null, selectedMaskId: null })
}

export const deleteSelectedClip = () => deleteClip()
export const rippleDeleteSelected = () => deleteClip(getState().selectedClipId, true)

/** Copy of a clip with fresh ids (for duplicate / paste). */
function cloneClip(clip: Clip): Clip {
  const copy = structuredClone(clip)
  copy.id = uid()
  const ids = new Map<string, string>()
  for (const fx of copy.effects) {
    const next = uid()
    ids.set(fx.id, next)
    fx.id = next
  }
  for (const m of copy.masks) m.id = uid()
  // Effect keyframes reference effect ids.
  copy.keyframes = Object.fromEntries(
    Object.entries(copy.keyframes).map(([path, keys]) => {
      const [group, id, param] = path.split('.')
      return [group === 'fx' && ids.has(id) ? `fx.${ids.get(id)}.${param}` : path, keys]
    }),
  )
  return copy
}

export function duplicateClip(id = getState().selectedClipId) {
  const clip = getState().project.clips.find((c) => c.id === id)
  if (!clip) return
  const copy = cloneClip(clip)
  copy.start = clipEnd(clip)
  commit((p) => placeClip(p, copy, clip.trackId))
  setState({ selectedClipId: copy.id })
}

export function copyClip() {
  const { project, selectedClipId } = getState()
  const clip = project.clips.find((c) => c.id === selectedClipId)
  if (clip) setState({ clipboard: structuredClone(clip) })
}

export function pasteClip() {
  const { clipboard, time, project } = getState()
  if (!clipboard) return
  const copy = cloneClip(clipboard)
  copy.start = toFrame(time, project.settings.fps)
  commit((p) => placeClip(p, copy, clipboard.trackId))
  setState({ selectedClipId: copy.id })
}

/** Change speed, stretching or squeezing the clip so it covers the same source footage. */
export function setClipSpeed(id: string, speed: number) {
  const { project } = getState()
  const clip = project.clips.find((c) => c.id === id)
  const asset = project.assets.find((a) => a.id === clip?.assetId)
  if (!clip) return
  const next = clamp(speed, 10, 1000)
  let duration = (clip.duration * clip.speed) / next
  if (asset && asset.kind !== 'image') duration = Math.min(duration, (asset.duration - clip.in) / (next / 100))
  // Don't run into the next clip on the track.
  const following = project.clips.filter((c) => c.trackId === clip.trackId && c.start >= clipEnd(clip) - 1e-6)
  const limit = Math.min(Infinity, ...following.map((c) => c.start - clip.start))
  updateClip(id, (c) => {
    c.speed = next
    c.duration = Math.max(1 / project.settings.fps, Math.min(duration, limit))
  }, `${id}:speed`)
}

// ---- Effects --------------------------------------------------------------------------------

export function applyEffect(type: string, clipId = getState().selectedClipId): string | null {
  const def = EFFECT_MAP.get(type)
  if (!def || !clipId) return null
  const fx: Effect = { id: uid(), type, enabled: true, params: defaultParams(def) }
  updateClip(clipId, (c) => {
    c.effects.push(fx)
  })
  return fx.id
}

export function updateEffect(clipId: string, effectId: string, change: (fx: Effect) => void, mergeKey?: string) {
  updateClip(clipId, (c) => {
    const fx = c.effects.find((e) => e.id === effectId)
    if (fx) change(fx)
  }, mergeKey)
}

export function removeEffect(clipId: string, effectId: string) {
  updateClip(clipId, (c) => {
    c.effects = c.effects.filter((e) => e.id !== effectId)
    for (const path of Object.keys(c.keyframes)) if (path.startsWith(`fx.${effectId}.`)) delete c.keyframes[path]
  })
}

export function moveEffect(clipId: string, effectId: string, dir: -1 | 1) {
  updateClip(clipId, (c) => {
    const i = c.effects.findIndex((e) => e.id === effectId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= c.effects.length) return
    ;[c.effects[i], c.effects[j]] = [c.effects[j], c.effects[i]]
  })
}

export function applyPreset(presetId: string, clipId = getState().selectedClipId) {
  const preset = PRESETS.find((p) => p.id === presetId)
  if (!preset || !clipId) return
  const comp = getState().project.settings
  updateClip(clipId, (c) => preset.apply(c, comp))
}

// ---- Masks ----------------------------------------------------------------------------------

export function addMask(clipId: string, fields: Partial<Mask> & Pick<Mask, 'kind' | 'shape'>): string {
  const count = getState().project.clips.find((c) => c.id === clipId)?.masks.length ?? 0
  const mask: Mask = {
    id: uid(),
    name: `Mask ${count + 1}`,
    enabled: true,
    mode: 'add',
    inverted: false,
    feather: fields.kind === 'ai' ? 2 : 0,
    expansion: 0,
    opacity: 100,
    ...fields,
  }
  updateClip(clipId, (c) => {
    c.masks.push(mask)
  })
  setState({ selectedMaskId: mask.id })
  return mask.id
}

export function updateMask(clipId: string, maskId: string, change: (m: Mask) => void, mergeKey?: string) {
  updateClip(clipId, (c) => {
    const m = c.masks.find((x) => x.id === maskId)
    if (m) change(m)
  }, mergeKey)
}

export function removeMask(clipId: string, maskId: string) {
  updateClip(clipId, (c) => {
    c.masks = c.masks.filter((m) => m.id !== maskId)
  })
  if (getState().selectedMaskId === maskId) setState({ selectedMaskId: null })
}

export const ellipse = (x0: number, y0: number, x1: number, y1: number, n = 48): Point[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return [(x0 + x1) / 2 + (Math.cos(a) * (x1 - x0)) / 2, (y0 + y1) / 2 + (Math.sin(a) * (y1 - y0)) / 2] as Point
  })

// ---- Tracks ---------------------------------------------------------------------------------

export function addTrack() {
  commit((p) => {
    p.tracks.unshift(newTrack(p.tracks.length + 1))
  })
}

export function removeTrack(id: string) {
  commit((p) => {
    p.tracks = p.tracks.filter((t) => t.id !== id)
    p.clips = p.clips.filter((c) => c.trackId !== id)
  })
}

export function toggleTrack(id: string, flag: 'hidden' | 'muted' | 'locked' | 'solo') {
  commit((p) => {
    const track = p.tracks.find((t) => t.id === id)
    if (!track) return false
    track[flag] = !track[flag]
  })
}

export function renameTrack(id: string, name: string) {
  commit((p) => {
    const track = p.tracks.find((t) => t.id === id)
    if (!track || !name.trim()) return false
    track.name = name.trim()
  })
}

// ---- Markers, work area, navigation ---------------------------------------------------------

const MARKER_COLORS = ['#e5c07b', '#56b6c2', '#c678dd', '#98c379', '#e06c75', '#61afef']

export function addMarker(time = getState().time, label = '') {
  commit((p) => {
    const t = toFrame(time, p.settings.fps)
    if (p.markers.some((m) => Math.abs(m.time - t) < 1e-6)) return false
    p.markers.push({ id: uid(), time: t, label, color: MARKER_COLORS[p.markers.length % MARKER_COLORS.length] })
    p.markers.sort((a, b) => a.time - b.time)
  })
}

export function updateMarker(id: string, change: Partial<Marker>, mergeKey?: string) {
  commit((p) => {
    const marker = p.markers.find((m) => m.id === id)
    if (!marker) return false
    Object.assign(marker, change)
    p.markers.sort((a, b) => a.time - b.time)
  }, mergeKey)
}

export function removeMarker(id: string) {
  commit((p) => {
    p.markers = p.markers.filter((m) => m.id !== id)
  })
}

/** Set the work area's in (I) or out (O) point at the playhead. */
export function setWorkArea(edge: 'in' | 'out') {
  commit((p) => {
    const t = getState().time
    const [a, b] = p.workArea ?? [0, Math.max(contentEnd(p), t)]
    const next: [number, number] = edge === 'in' ? [t, Math.max(b, t + 1 / p.settings.fps)] : [Math.min(a, t), t]
    if (next[1] <= next[0]) return false
    p.workArea = next
  })
}

export function clearWorkArea() {
  commit((p) => {
    if (!p.workArea) return false
    p.workArea = null
  })
}

/** Jump the playhead to the previous/next clip edge or marker (J / K). */
export function jumpEdit(dir: -1 | 1) {
  const { project, time } = getState()
  const points = editPoints(project)
  const target = dir > 0 ? points.find((t) => t > time + 1e-6) : [...points].reverse().find((t) => t < time - 1e-6)
  if (target !== undefined) seek(target)
}

// ---- Project --------------------------------------------------------------------------------

let projectPath: string | null = null // desktop: where Ctrl+S saves

export function newProjectAction() {
  const { project } = getState()
  const hasWork = project.assets.length > 0 || project.clips.length > 0
  if (hasWork && !confirm('Start a new project? Save the current one first if you want to keep it.')) return
  projectPath = null
  replaceProject(newProject())
}

/** Save the project file. Media isn't embedded: the desktop app stores paths, the browser relinks by name. */
export async function saveProject(saveAs = false) {
  const { project } = getState()
  const json = JSON.stringify(project, null, 2)
  if (desktop) {
    const saved = await desktop.saveProject(json, saveAs ? null : projectPath)
    if (saved) {
      projectPath = saved
      setState({ status: `Saved ${saved.split(/[\\/]/).pop()}` })
    }
  } else {
    download(new Blob([json], { type: 'application/json' }), `${fileSafe(project.name)}.opencomp.json`)
  }
}

export async function openProject() {
  let content: string
  let name: string
  if (desktop) {
    const file = await desktop.openProject()
    if (!file) return
    ;[content, name, projectPath] = [file.content, file.path, file.path]
  } else {
    const [file] = await pickFiles('.json,application/json', false)
    if (!file) return
    ;[content, name] = [await file.text(), file.name]
  }
  try {
    replaceProject(migrateProject(JSON.parse(content)))
    void relinkKnownPaths()
  } catch {
    alert(`${name} isn't an OpenComp project file.`)
  }
}

/** Save the current frame as a PNG. */
export async function saveFrame() {
  const canvas = await captureFrame()
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) return
  const { project, time } = getState()
  const name = `${fileSafe(project.name)} ${time.toFixed(2)}s.png`
  if (desktop) await desktop.saveFile(await blob.arrayBuffer(), name)
  else download(blob, name)
}

// ---- View -----------------------------------------------------------------------------------

export const MIN_ZOOM = 2 // px per second
export const MAX_ZOOM = 800

export const setZoom = (pxPerSec: number) => setState({ pxPerSec: clamp(pxPerSec, MIN_ZOOM, MAX_ZOOM) })
export const zoomTimeline = (factor: number) => setZoom(getState().pxPerSec * factor)

export function resetLayout() {
  for (const key of Object.keys(localStorage)) if (key.startsWith('opencomp:layout:')) localStorage.removeItem(key)
  setState((s) => ({ layoutVersion: s.layoutVersion + 1 }))
}
