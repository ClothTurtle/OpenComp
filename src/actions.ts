// Every editing command the UI can run. Components and keyboard shortcuts call these; they change
// the project through commit() so everything here is undoable.
import { hasSource, kindOf, loadFile } from './engine/media'
import { download, fileSafe, MEDIA_ACCEPT, pickFiles } from './lib/files'
import { clamp, toFrame } from './lib/time'
import { isActiveAt, isFree, splitClip } from './lib/timeline'
import {
  DEFAULT_COLOR,
  DEFAULT_TRANSFORM,
  newProject,
  newTrack,
  uid,
  type Asset,
  type Clip,
  type Marker,
  type Track,
} from './project'
import { commit, getState, replaceProject, setState } from './store'

// ---- Media ----------------------------------------------------------------------------------

/** Import files into the Project panel. Files the browser can't decode are reported and skipped. */
export async function importFiles(files: File[]): Promise<Asset[]> {
  const added: Asset[] = []
  const failed: string[] = []
  for (const file of files) {
    let kind = kindOf(file)
    if (!kind) {
      failed.push(file.name)
      continue
    }
    const id = uid()
    try {
      const info = await loadFile(id, file, kind)
      if (kind === 'video' && !info.width) kind = 'audio' // e.g. an audio-only .webm
      added.push({ id, name: file.name, kind, ...info })
    } catch {
      failed.push(file.name)
    }
  }
  if (added.length) {
    commit((p) => {
      p.assets.push(...added)
    })
    setState((s) => ({ selectedAssetId: added[0].id, mediaVersion: s.mediaVersion + 1 }))
  }
  if (failed.length) alert(`These files couldn't be opened in this browser:\n\n${failed.join('\n')}`)
  return added
}

export async function importDialog() {
  await importFiles(await pickFiles(MEDIA_ACCEPT))
}

/** Reconnect offline media (after reopening a project) by matching file names. */
export async function relinkDialog() {
  const files = await pickFiles(MEDIA_ACCEPT)
  for (const asset of getState().project.assets) {
    const file = files.find((f) => f.name === asset.name)
    if (!file || hasSource(asset.id)) continue
    try {
      await loadFile(asset.id, file, asset.kind)
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

/** Place an asset on the timeline at `start`: on `trackId` if there's room, else the first free track, else a new top track. */
export function addClip(assetId: string, start = getState().time, trackId?: string) {
  const { project } = getState()
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset) return
  const fps = project.settings.fps
  const at = Math.max(0, toFrame(start, fps))
  const duration = Math.max(1, Math.floor(asset.duration * fps + 1e-6)) / fps
  const id = uid()
  commit((p) => {
    const fits = (t: Track) => isFree(p, t.id, at, at + duration)
    let track = p.tracks.find((t) => t.id === trackId && fits(t)) ?? p.tracks.find(fits)
    if (!track) {
      track = newTrack(p.tracks.length + 1)
      p.tracks.unshift(track)
    }
    p.clips.push({
      id,
      assetId,
      trackId: track.id,
      start: at,
      in: 0,
      duration,
      volume: 100,
      transform: { ...DEFAULT_TRANSFORM },
      color: { ...DEFAULT_COLOR },
    })
  })
  setState({ selectedClipId: id })
}

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
      const parts = i >= 0 ? splitClip(p.clips[i], t, uid()) : null
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

export function deleteSelectedClip() {
  const { selectedClipId } = getState()
  commit((p) => {
    const before = p.clips.length
    p.clips = p.clips.filter((c) => c.id !== selectedClipId)
    if (p.clips.length === before) return false
  })
  setState({ selectedClipId: null })
}

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

export function toggleTrack(id: string, flag: 'hidden' | 'muted') {
  commit((p) => {
    const track = p.tracks.find((t) => t.id === id)
    if (!track) return false
    track[flag] = !track[flag]
  })
}

// ---- Markers (bookmarks) --------------------------------------------------------------------

const MARKER_COLORS = ['#e5c07b', '#56b6c2', '#c678dd', '#98c379', '#e06c75', '#61afef']

export function addMarker(time = getState().time) {
  commit((p) => {
    const t = toFrame(time, p.settings.fps)
    if (p.markers.some((m) => Math.abs(m.time - t) < 1e-6)) return false
    p.markers.push({ id: uid(), time: t, label: '', color: MARKER_COLORS[p.markers.length % MARKER_COLORS.length] })
    p.markers.sort((a, b) => a.time - b.time)
  })
}

export function updateMarker(id: string, change: Partial<Marker>, mergeKey?: string) {
  commit((p) => {
    const marker = p.markers.find((m) => m.id === id)
    if (!marker) return false
    Object.assign(marker, change)
  }, mergeKey)
}

export function removeMarker(id: string) {
  commit((p) => {
    p.markers = p.markers.filter((m) => m.id !== id)
  })
}

// ---- Project --------------------------------------------------------------------------------

export function newProjectAction() {
  const { project } = getState()
  const hasWork = project.assets.length > 0 || project.clips.length > 0
  if (hasWork && !confirm('Start a new project? Save the current one first if you want to keep it.')) return
  replaceProject(newProject())
}

/** Download the project as JSON. Media files aren't embedded; they're relinked by name on open. */
export function saveProject() {
  const { project } = getState()
  const json = JSON.stringify(project, null, 2)
  download(new Blob([json], { type: 'application/json' }), `${fileSafe(project.name)}.opencomp.json`)
}

export async function openProject() {
  const [file] = await pickFiles('.json,application/json', false)
  if (!file) return
  try {
    const project = JSON.parse(await file.text())
    if (project?.version !== 1 || !Array.isArray(project.clips)) throw new Error('Not a project')
    replaceProject(project)
  } catch {
    alert(`${file.name} isn't an OpenComp project file.`)
  }
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
