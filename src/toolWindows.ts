// Floating tool windows: one effect's controls, or one section of the selected clip's properties,
// opened from the Features sidebar so a tool can be used right where you are.
import { create } from 'zustand'

export type ToolSection = 'layer' | 'transform' | 'color' | 'masks' | 'audio' | 'text'

export type ToolFocus =
  | { kind: 'effect'; clipId: string; fxId: string } // pinned to that effect
  | { kind: 'section'; section: ToolSection } // follows the selected clip

export interface ToolWindow {
  id: string
  focus: ToolFocus
  x: number
  y: number
}

export const useToolWindows = create<{ windows: ToolWindow[] }>()(() => ({ windows: [] }))

const WIDTH = 300
const sameFocus = (a: ToolFocus, b: ToolFocus) =>
  a.kind === 'effect' ? b.kind === 'effect' && a.fxId === b.fxId : b.kind === 'section' && a.section === b.section

/** Open a window (or bring an open one to the front). New windows cascade from beside the sidebar. */
export function openToolWindow(focus: ToolFocus) {
  const { windows } = useToolWindows.getState()
  const existing = windows.find((w) => sameFocus(w.focus, focus))
  if (existing) return raiseToolWindow(existing.id)
  const n = windows.length % 8
  const sidebar = document.querySelector('.features-panel')?.getBoundingClientRect()
  const x = Math.max(8, (sidebar ? sidebar.left : window.innerWidth) - WIDTH - 16 - n * 24)
  const y = 96 + n * 24
  useToolWindows.setState({ windows: [...windows, { id: crypto.randomUUID(), focus, x, y }] })
}

export function raiseToolWindow(id: string) {
  const { windows } = useToolWindows.getState()
  const w = windows.find((x) => x.id === id)
  if (w && windows.at(-1) !== w) useToolWindows.setState({ windows: [...windows.filter((x) => x !== w), w] })
}

export function moveToolWindow(id: string, x: number, y: number) {
  useToolWindows.setState((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, x, y } : w)) }))
}

export function closeToolWindow(id: string) {
  useToolWindows.setState((s) => ({ windows: s.windows.filter((w) => w.id !== id) }))
}
