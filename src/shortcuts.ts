// Keyboard shortcuts. This table drives both the key handler and the Help > Keyboard Shortcuts dialog.
import {
  addMarker,
  deleteSelectedClip,
  importDialog,
  openProject,
  saveProject,
  splitAtPlayhead,
  zoomTimeline,
} from './actions'
import { seek, stepFrames, togglePlay } from './engine/playback'
import { contentEnd } from './lib/timeline'
import { getState, redo, setState, undo } from './store'

export interface Shortcut {
  keys: string // as shown to the user
  label: string
  combos: string[] // as produced by comboOf()
  run: (combo: string) => void
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Space', label: 'Play / pause', combos: ['space'], run: togglePlay },
  {
    keys: '← / →',
    label: 'Previous / next frame',
    combos: ['arrowleft', 'arrowright'],
    run: (c) => stepFrames(c === 'arrowleft' ? -1 : 1),
  },
  {
    keys: 'Shift + ← / →',
    label: 'Jump 10 frames',
    combos: ['shift+arrowleft', 'shift+arrowright'],
    run: (c) => stepFrames(c === 'shift+arrowleft' ? -10 : 10),
  },
  {
    keys: 'Home / End',
    label: 'Go to start / end',
    combos: ['home', 'end'],
    run: (c) => seek(c === 'home' ? 0 : contentEnd(getState().project)),
  },
  { keys: 'S', label: 'Split at playhead', combos: ['s', 'mod+shift+d'], run: splitAtPlayhead },
  { keys: 'Delete', label: 'Delete selected clip', combos: ['delete', 'backspace'], run: deleteSelectedClip },
  { keys: 'M', label: 'Add marker (bookmark)', combos: ['m'], run: () => addMarker() },
  { keys: 'V', label: 'Selection tool', combos: ['v'], run: () => setState({ tool: 'select' }) },
  { keys: 'C', label: 'Razor tool (click clips to cut)', combos: ['c'], run: () => setState({ tool: 'razor' }) },
  {
    keys: '= / -',
    label: 'Zoom timeline in / out',
    combos: ['=', '+', '-'],
    run: (c) => zoomTimeline(c === '-' ? 0.8 : 1.25),
  },
  { keys: 'Ctrl + Z', label: 'Undo', combos: ['mod+z'], run: undo },
  { keys: 'Ctrl + Shift + Z', label: 'Redo', combos: ['mod+shift+z', 'mod+y'], run: redo },
  { keys: 'Ctrl + I', label: 'Import media', combos: ['mod+i'], run: importDialog },
  { keys: 'Ctrl + K', label: 'Composition settings', combos: ['mod+k'], run: () => setState({ dialog: 'comp' }) },
  { keys: 'Ctrl + M', label: 'Export video', combos: ['mod+m'], run: () => setState({ dialog: 'export' }) },
  { keys: 'Ctrl + S', label: 'Save project', combos: ['mod+s'], run: saveProject },
  { keys: 'Ctrl + O', label: 'Open project', combos: ['mod+o'], run: openProject },
  { keys: '?', label: 'Show shortcuts', combos: ['?'], run: () => setState({ dialog: 'shortcuts' }) },
]

/** Normalise a key event to strings like "mod+shift+z", "space" or "?". */
export function comboOf(e: KeyboardEvent): string {
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
  const shiftIsPartOfKey = key.length === 1 && !/[a-z]/.test(key) // "?" is already shift + "/"
  return [(e.ctrlKey || e.metaKey) && 'mod', e.shiftKey && !shiftIsPartOfKey && 'shift', e.altKey && 'alt', key]
    .filter(Boolean)
    .join('+')
}

/** Text fields keep their keys; sliders keep arrow keys. */
function isEditing(target: EventTarget | null, key: string) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  if (!(target instanceof HTMLInputElement)) return false
  if (target.type === 'range') return key.startsWith('Arrow') || key === 'Home' || key === 'End'
  return !['checkbox', 'button', 'color'].includes(target.type)
}

export function handleKeydown(e: KeyboardEvent) {
  if (getState().dialog || isEditing(e.target, e.key)) return
  const combo = comboOf(e)
  const shortcut = SHORTCUTS.find((s) => s.combos.includes(combo))
  if (!shortcut) return
  e.preventDefault()
  if (e.target instanceof HTMLButtonElement) e.target.blur() // so Space doesn't also "click" the focused button
  shortcut.run(combo)
}
