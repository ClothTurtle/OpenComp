import { X } from 'lucide-react'
import type { PointerEvent } from 'react'
import { EFFECT_MAP } from '../effects'
import { trackDrag } from '../lib/drag'
import { clipLabel } from '../project'
import { useStore } from '../store'
import { closeToolWindow, moveToolWindow, raiseToolWindow, useToolWindows, type ToolSection, type ToolWindow } from '../toolWindows'
import { ClipControls } from './Inspector'
import { IconButton } from './ui'

const SECTION_TITLES: Record<ToolSection, string> = {
  layer: 'Blend & Speed',
  transform: 'Transform & Keyframes',
  color: 'Color',
  masks: 'Masks',
  audio: 'Audio',
  text: 'Text',
}

/** Every open tool window, floating above the workspace. */
export function ToolWindows() {
  const windows = useToolWindows((s) => s.windows)
  return windows.map((w) => <Window key={w.id} win={w} />)
}

function Window({ win }: { win: ToolWindow }) {
  const { focus } = win
  const clipId = useStore((s) => (focus.kind === 'effect' ? focus.clipId : s.selectedClipId))
  const clip = useStore((s) => s.project.clips.find((c) => c.id === clipId))
  const assets = useStore((s) => s.project.assets)
  const fxName = focus.kind === 'effect' ? EFFECT_MAP.get(clip?.effects.find((fx) => fx.id === focus.fxId)?.type ?? '')?.name : undefined
  const title = focus.kind === 'effect' ? (fxName ?? 'Effect') : SECTION_TITLES[focus.section]

  const startMove = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const dx = e.clientX - win.x
    const dy = e.clientY - win.y
    trackDrag((ev) =>
      moveToolWindow(win.id, Math.min(window.innerWidth - 80, Math.max(0, ev.clientX - dx)), Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dy))),
    )
  }

  return (
    <div className="tool-window" style={{ left: win.x, top: win.y }} onPointerDown={() => raiseToolWindow(win.id)} role="dialog" aria-label={title}>
      <div className="tool-window-head" onPointerDown={startMove}>
        <span className="tool-window-title">{title}</span>
        {clip && <span className="tool-window-clip">{clipLabel(clip, assets)}</span>}
        <IconButton icon={X} title="Close" onClick={() => closeToolWindow(win.id)} />
      </div>
      <div className="tool-window-body">
        {clip ? <ClipControls clip={clip} only={focus} /> : <div className="empty-note">{focus.kind === 'effect' ? 'That clip was deleted.' : 'Select a clip on the timeline.'}</div>}
      </div>
    </div>
  )
}
