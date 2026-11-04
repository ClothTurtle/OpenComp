// Keyboard shortcuts. This table drives both the key handler and the Help > Keyboard Shortcuts dialog.
import {
  addMarker,
  clearWorkArea,
  copyClip,
  deleteSelectedClip,
  duplicateClip,
  importDialog,
  jumpEdit,
  openProject,
  pasteClip,
  rippleDeleteSelected,
  saveProject,
  setWorkArea,
  splitAtPlayhead,
  zoomTimeline,
} from './actions'
import { seek, stepFrames, togglePlay } from './engine/playback'
import { contentEnd } from './lib/timeline'
import { getSettings, isEnabled, updateSettings } from './settings'
import { getState, redo, setState, undo, type Tool } from './store'

export interface Shortcut {
  keys: string // as shown to the user
  label: string
  combos: string[] // as produced by comboOf()
  run: (combo: string) => void
  feature?: string // only active while this feature is switched on
}

const tool = (t: Tool) => () => setState({ tool: t })

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Space', label: 'Play / pause', combos: ['space'], run: () => togglePlay() },
  { keys: '← / →', label: 'Previous / next frame', combos: ['arrowleft', 'arrowright'], run: (c) => stepFrames(c === 'arrowleft' ? -1 : 1) },
  { keys: 'Shift + ← / →', label: 'Jump 10 frames', combos: ['shift+arrowleft', 'shift+arrowright'], run: (c) => stepFrames(c === 'shift+arrowleft' ? -10 : 10) },
  { keys: 'Home / End', label: 'Go to start / end', combos: ['home', 'end'], run: (c) => seek(c === 'home' ? 0 : contentEnd(getState().project)) },
  { keys: 'J / K', label: 'Previous / next edit or marker', combos: ['j', 'k'], run: (c) => jumpEdit(c === 'j' ? -1 : 1), feature: 'jump-edits' },
  { keys: 'I / O', label: 'Set work area in / out', combos: ['i', 'o'], run: (c) => setWorkArea(c === 'i' ? 'in' : 'out'), feature: 'work-area' },
  { keys: 'Alt + X', label: 'Clear work area', combos: ['alt+x'], run: () => clearWorkArea(), feature: 'work-area' },
  { keys: 'L', label: 'Toggle loop', combos: ['l'], run: () => updateSettings({ loop: !getSettings().loop }), feature: 'loop' },
  { keys: 'S', label: 'Split at playhead', combos: ['s', 'mod+shift+d'], run: () => splitAtPlayhead() },
  { keys: 'Delete', label: 'Delete selected clip', combos: ['delete', 'backspace'], run: () => deleteSelectedClip() },
  { keys: 'Shift + Delete', label: 'Ripple delete (close the gap)', combos: ['shift+delete', 'shift+backspace'], run: () => rippleDeleteSelected(), feature: 'ripple-delete' },
  { keys: 'Ctrl + D', label: 'Duplicate clip', combos: ['mod+d'], run: () => duplicateClip(), feature: 'duplicate' },
  { keys: 'Ctrl + C / V', label: 'Copy / paste clip', combos: ['mod+c', 'mod+v'], run: (c) => (c === 'mod+c' ? copyClip() : pasteClip()), feature: 'copy-paste' },
  { keys: 'M', label: 'Add marker (bookmark)', combos: ['m'], run: () => addMarker() },
  { keys: 'V', label: 'Selection tool', combos: ['v'], run: tool('select') },
  { keys: 'H', label: 'Hand tool (pan the preview)', combos: ['h'], run: tool('hand'), feature: 'tool-hand' },
  { keys: 'C', label: 'Razor tool (click clips to cut)', combos: ['c'], run: tool('razor'), feature: 'tool-razor' },
  { keys: 'T', label: 'Type tool (click the preview)', combos: ['t'], run: tool('text'), feature: 'tool-text' },
  { keys: 'Q / E / G', label: 'Rectangle / ellipse / pen mask', combos: ['q', 'e', 'g'], run: (c) => setState({ tool: c === 'q' ? 'rect-mask' : c === 'e' ? 'ellipse-mask' : 'pen-mask' }), feature: 'shape-masks' },
  { keys: 'B', label: 'AI mask brush', combos: ['b'], run: tool('brush-mask'), feature: 'ai-mask-brush' },
  { keys: 'A', label: 'Smart click mask', combos: ['a'], run: tool('smart-mask'), feature: 'ai-smart-mask' },
  { keys: '[ / ]', label: 'Brush size smaller / bigger', combos: ['[', ']'], run: (c) => updateSettings({ brushSize: Math.max(4, Math.min(400, getSettings().brushSize * (c === '[' ? 0.8 : 1.25))) }) },
  { keys: '= / -', label: 'Zoom timeline in / out', combos: ['=', '+', '-'], run: (c) => zoomTimeline(c === '-' ? 0.8 : 1.25) },
  { keys: 'Ctrl + Z', label: 'Undo', combos: ['mod+z'], run: () => undo() },
  { keys: 'Ctrl + Shift + Z', label: 'Redo', combos: ['mod+shift+z', 'mod+y'], run: () => redo() },
  { keys: 'Ctrl + I', label: 'Import media', combos: ['mod+i'], run: () => void importDialog() },
  { keys: 'Ctrl + K', label: 'Composition settings', combos: ['mod+k'], run: () => setState({ dialog: 'comp' }) },
  { keys: 'Ctrl + M', label: 'Export video', combos: ['mod+m'], run: () => setState({ dialog: 'export' }) },
  { keys: 'Ctrl + S', label: 'Save project', combos: ['mod+s'], run: () => void saveProject() },
  { keys: 'Ctrl + Shift + S', label: 'Save project as…', combos: ['mod+shift+s'], run: () => void saveProject(true) },
  { keys: 'Ctrl + O', label: 'Open project', combos: ['mod+o'], run: () => void openProject() },
  { keys: 'Ctrl + ,', label: 'Settings', combos: ['mod+,'], run: () => setState({ dialog: 'settings' }) },
  { keys: 'Ctrl + B', label: 'Show / hide the Features sidebar', combos: ['mod+b'], run: () => updateSettings({ showSidebar: !getSettings().showSidebar }) },
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
  // Copy/paste of selected page text should still work outside the timeline.
  if ((e.ctrlKey || e.metaKey) && ['c', 'v'].includes(e.key.toLowerCase()) && window.getSelection()?.toString()) return
  const combo = comboOf(e)
  const shortcut = SHORTCUTS.find((s) => s.combos.includes(combo) && (!s.feature || isEnabled(s.feature)))
  if (!shortcut) return
  e.preventDefault()
  if (e.target instanceof HTMLButtonElement) e.target.blur() // so Space doesn't also "click" the focused button
  shortcut.run(combo)
}
