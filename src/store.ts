import { create } from 'zustand'
import { idbGet, idbSet } from './lib/idb'
import { migrateProject, newProject, type Clip, type Project } from './project'
import { getSettings } from './settings'

export type Tool =
  | 'select'
  | 'hand'
  | 'razor'
  | 'text'
  | 'rect-mask'
  | 'ellipse-mask'
  | 'pen-mask'
  | 'brush-mask'
  | 'smart-mask'

export type Dialog = 'comp' | 'export' | 'shortcuts' | 'settings' | 'captions' | 'image' | null

export interface EditorState {
  project: Project
  past: Project[]
  future: Project[]
  // Everything below is UI state: not saved and not part of undo.
  time: number
  playing: boolean
  selectedClipId: string | null
  selectedAssetId: string | null
  selectedMaskId: string | null
  tool: Tool
  snapping: boolean
  pxPerSec: number // timeline zoom
  dialog: Dialog
  sideTab: 'markers' | 'assistant'
  clipboard: Clip | null
  status: string // short message shown in the toolbar (e.g. AI progress)
  mediaVersion: number // bumped when media files are linked, so offline badges refresh
  layoutVersion: number // bumped to reset panel sizes
}

const AUTOSAVE_KEY = 'project'
const HISTORY_LIMIT = 100
const MERGE_WINDOW_MS = 1500

export const useStore = create<EditorState>()(() => ({
  project: newProject(),
  past: [],
  future: [],
  time: 0,
  playing: false,
  selectedClipId: null,
  selectedAssetId: null,
  selectedMaskId: null,
  tool: 'select',
  snapping: true,
  pxPerSec: 60,
  dialog: null,
  sideTab: 'markers',
  clipboard: null,
  status: '',
  mediaVersion: 0,
  layoutVersion: 0,
}))

export const getState = useStore.getState
export const setState = useStore.setState

let lastMergeKey: string | undefined
let lastCommitAt = 0

/**
 * Make an undoable change. `mutate` edits a copy of the project; return false to abandon the change.
 * Back-to-back commits with the same `mergeKey` (one slider drag, one clip drag) become a single undo step.
 */
export function commit(mutate: (draft: Project) => void | false, mergeKey?: string) {
  const { project, past } = getState()
  const draft = structuredClone(project)
  if (mutate(draft) === false) return
  const now = performance.now()
  const merge = mergeKey !== undefined && mergeKey === lastMergeKey && now - lastCommitAt < MERGE_WINDOW_MS
  lastMergeKey = mergeKey
  lastCommitAt = now
  setState({ project: draft, past: merge ? past : [...past.slice(1 - HISTORY_LIMIT), project], future: [] })
}

export function undo() {
  const { past, future, project } = getState()
  if (!past.length) return
  lastMergeKey = undefined
  setState({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] })
}

export function redo() {
  const { past, future, project } = getState()
  if (!future.length) return
  lastMergeKey = undefined
  setState({ project: future[0], past: [...past, project], future: future.slice(1) })
}

/** Swap in a whole project (new / open). Clears undo history. */
export function replaceProject(project: Project) {
  lastMergeKey = undefined
  setState({
    project,
    past: [],
    future: [],
    time: 0,
    playing: false,
    selectedClipId: null,
    selectedAssetId: null,
    selectedMaskId: null,
  })
}

/** Load the autosaved project, if any. Called once before the UI first renders. */
export async function restoreAutosave() {
  let saved = await idbGet<unknown>(AUTOSAVE_KEY)
  if (!saved) {
    // Version 0.1 autosaved to localStorage.
    try {
      saved = JSON.parse(localStorage.getItem('opencomp:project') ?? 'null')
    } catch {
      saved = null
    }
  }
  if (!saved) return
  try {
    setState({ project: migrateProject(saved) })
  } catch {
    // Corrupt autosave: start fresh.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((state, prev) => {
  if (state.project === prev.project || !getSettings().autosave) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void idbSet(AUTOSAVE_KEY, state.project).catch(() => {}), 500)
})
