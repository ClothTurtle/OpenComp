import { create } from 'zustand'
import { newProject, type Project } from './project'

export type Tool = 'select' | 'razor'
export type Dialog = 'comp' | 'export' | 'shortcuts' | null

export interface EditorState {
  project: Project
  past: Project[]
  future: Project[]
  // Everything below is UI state: not saved and not part of undo.
  time: number
  playing: boolean
  selectedClipId: string | null
  selectedAssetId: string | null
  tool: Tool
  snapping: boolean
  pxPerSec: number // timeline zoom
  dialog: Dialog
  mediaVersion: number // bumped when media files are linked, so offline badges refresh
  layoutVersion: number // bumped to reset panel sizes
}

const SAVE_KEY = 'opencomp:project'
const HISTORY_LIMIT = 200
const MERGE_WINDOW_MS = 1500

function loadAutosave(): Project | null {
  try {
    const p = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null')
    return p?.version === 1 ? p : null
  } catch {
    return null
  }
}

export const useStore = create<EditorState>()(() => ({
  project: loadAutosave() ?? newProject(),
  past: [],
  future: [],
  time: 0,
  playing: false,
  selectedClipId: null,
  selectedAssetId: null,
  tool: 'select',
  snapping: true,
  pxPerSec: 60,
  dialog: null,
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
  setState({ project, past: [], future: [], time: 0, playing: false, selectedClipId: null, selectedAssetId: null })
}

// Autosave the project (not the media files themselves) so a refresh doesn't lose work.
let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((state, prev) => {
  if (state.project === prev.project) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state.project))
    } catch {
      // Storage full or blocked: autosave is best-effort.
    }
  }, 400)
})
