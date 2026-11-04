import {
  Brush,
  Circle,
  Download,
  Hand,
  Magnet,
  MousePointer2,
  MousePointerClick,
  PanelRight,
  PenTool,
  RectangleHorizontal,
  Redo2,
  Scissors,
  Settings,
  Sparkles,
  Type,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useBridge } from '../ai/bridge'
import { importDialog } from '../actions'
import { audioLevel } from '../engine/media'
import { updateSettings, useSettings } from '../settings'
import { redo, setState, undo, useStore, type Tool } from '../store'
import { IconButton } from './ui'

const TOOLS: [Tool, LucideIcon, string, string | null][] = [
  ['select', MousePointer2, 'Selection tool (V): select, move and trim', null],
  ['hand', Hand, 'Hand tool (H): pan the preview', 'tool-hand'],
  ['razor', Scissors, 'Razor tool (C): click a clip to cut it', 'tool-razor'],
  ['text', Type, 'Type tool (T): click the preview to add text', 'tool-text'],
  ['rect-mask', RectangleHorizontal, 'Rectangle mask (Q)', 'shape-masks'],
  ['ellipse-mask', Circle, 'Ellipse mask (E)', 'shape-masks'],
  ['pen-mask', PenTool, 'Pen mask (G): click points, click the first point to close', 'shape-masks'],
  ['brush-mask', Brush, 'AI mask brush (B): paint over an object to mask it', 'ai-mask-brush'],
  ['smart-mask', MousePointerClick, 'Smart click mask (A): click an object to mask it', 'ai-smart-mask'],
]

export function Toolbar() {
  const tool = useStore((s) => s.tool)
  const snapping = useStore((s) => s.snapping)
  const status = useStore((s) => s.status)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const prefs = useSettings()
  const connected = useBridge((s) => s.connected)
  const on = (id: string | null) => !id || !prefs.disabledFeatures.includes(id)

  // Status messages fade after a few seconds.
  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setState({ status: '' }), 5000)
    return () => clearTimeout(t)
  }, [status])

  return (
    <div className="toolbar">
      {TOOLS.filter(([, , , feature]) => on(feature)).map(([t, Icon, title]) => (
        <IconButton key={t} icon={Icon} title={title} active={tool === t} onClick={() => setState({ tool: t })} />
      ))}
      {tool === 'brush-mask' && (
        <label className="brush-size" title="Brush size ([ and ])">
          <input type="range" min={4} max={400} value={prefs.brushSize} onChange={(e) => updateSettings({ brushSize: Number(e.target.value) })} />
          <span>{Math.round(prefs.brushSize)}px</span>
        </label>
      )}
      <div className="toolbar-sep" />
      <IconButton icon={Magnet} title="Snapping: clips snap to the playhead, markers and other clips" active={snapping} onClick={() => setState({ snapping: !snapping })} />
      <IconButton icon={Undo2} title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
      <IconButton icon={Redo2} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
      <div className="toolbar-status" role="status">
        {status}
      </div>
      <div className="spacer" />
      {on('audio-meter') && <Meter />}
      {on('claude-mcp') && prefs.bridgeEnabled && (
        <button
          type="button"
          className={`bridge ${connected ? 'on' : ''}`}
          title={connected ? 'Connected to Claude Desktop / Claude Code' : 'Waiting for Claude Desktop / Claude Code (see Settings → Claude)'}
          onClick={() => setState({ dialog: 'settings' })}
        >
          <Sparkles size={13} /> {connected ? 'Claude linked' : 'Claude: waiting'}
        </button>
      )}
      <IconButton icon={PanelRight} title="Features & effects sidebar (Ctrl+B)" active={prefs.showSidebar} onClick={() => updateSettings({ showSidebar: !prefs.showSidebar })} />
      <IconButton icon={Settings} title="Settings (Ctrl+,)" onClick={() => setState({ dialog: 'settings' })} />
      <button type="button" className="btn" onClick={importDialog}>
        <Upload size={14} /> Import
      </button>
      <button type="button" className="btn primary" onClick={() => setState({ dialog: 'export' })}>
        <Download size={14} /> Export
      </button>
    </div>
  )
}

/** Master output level, updated while playing. */
function Meter() {
  const bar = useRef<HTMLDivElement>(null)
  const playing = useStore((s) => s.playing)
  useEffect(() => {
    if (!playing) {
      if (bar.current) bar.current.style.width = '0%'
      return
    }
    let raf = 0
    const loop = () => {
      const db = 20 * Math.log10(audioLevel() + 1e-6) // -60..0
      if (bar.current) bar.current.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [playing])
  return (
    <div className="meter" title="Output level">
      <div ref={bar} />
    </div>
  )
}
