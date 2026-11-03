import { Download, Keyboard, Magnet, MousePointer2, Redo2, Scissors, Undo2, Upload } from 'lucide-react'
import { importDialog } from '../actions'
import { redo, setState, undo, useStore } from '../store'
import { IconButton } from './ui'

export function Toolbar() {
  const tool = useStore((s) => s.tool)
  const snapping = useStore((s) => s.snapping)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)

  return (
    <div className="toolbar">
      <IconButton
        icon={MousePointer2}
        title="Selection tool (V): move and trim clips"
        active={tool === 'select'}
        onClick={() => setState({ tool: 'select' })}
      />
      <IconButton
        icon={Scissors}
        title="Razor tool (C): click a clip to cut it"
        active={tool === 'razor'}
        onClick={() => setState({ tool: 'razor' })}
      />
      <div className="toolbar-sep" />
      <IconButton
        icon={Magnet}
        title="Snapping: clips snap to the playhead, markers and other clips"
        active={snapping}
        onClick={() => setState({ snapping: !snapping })}
      />
      <span className="toolbar-label">Snapping</span>
      <div className="toolbar-sep" />
      <IconButton icon={Undo2} title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
      <IconButton icon={Redo2} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
      <div className="spacer" />
      <IconButton icon={Keyboard} title="Keyboard shortcuts (?)" onClick={() => setState({ dialog: 'shortcuts' })} />
      <button type="button" className="btn" onClick={importDialog}>
        <Upload size={14} /> Import
      </button>
      <button type="button" className="btn primary" onClick={() => setState({ dialog: 'export' })}>
        <Download size={14} /> Export
      </button>
    </div>
  )
}
