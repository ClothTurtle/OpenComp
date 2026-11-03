import { useEffect, useRef, useState } from 'react'
import {
  addMarker,
  addTrack,
  deleteSelectedClip,
  importDialog,
  newProjectAction,
  openProject,
  resetLayout,
  saveProject,
  splitAtPlayhead,
  zoomTimeline,
} from '../actions'
import { redo, setState, undo, useStore, type Dialog } from '../store'

type MenuItem = { label: string; keys?: string; run: () => void; disabled?: boolean } | 'separator'

const openDialog = (dialog: Dialog) => () => setState({ dialog })

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null)
  const name = useStore((s) => s.project.name)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (open === null) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const menus: { label: string; items: MenuItem[] }[] = [
    {
      label: 'File',
      items: [
        { label: 'New Project', run: newProjectAction },
        { label: 'Open Project…', keys: 'Ctrl+O', run: openProject },
        { label: 'Save Project', keys: 'Ctrl+S', run: saveProject },
        'separator',
        { label: 'Import Media…', keys: 'Ctrl+I', run: importDialog },
        { label: 'Export Video…', keys: 'Ctrl+M', run: openDialog('export') },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', keys: 'Ctrl+Z', run: undo, disabled: !canUndo },
        { label: 'Redo', keys: 'Ctrl+Shift+Z', run: redo, disabled: !canRedo },
        'separator',
        { label: 'Split at Playhead', keys: 'S', run: splitAtPlayhead },
        { label: 'Delete Clip', keys: 'Del', run: deleteSelectedClip },
      ],
    },
    {
      label: 'Composition',
      items: [
        { label: 'Composition Settings…', keys: 'Ctrl+K', run: openDialog('comp') },
        { label: 'Add Marker', keys: 'M', run: () => addMarker() },
        { label: 'Add Track', run: addTrack },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Zoom Timeline In', keys: '=', run: () => zoomTimeline(1.25) },
        { label: 'Zoom Timeline Out', keys: '-', run: () => zoomTimeline(0.8) },
        'separator',
        { label: 'Reset Panel Layout', run: resetLayout },
      ],
    },
    {
      label: 'Help',
      items: [{ label: 'Keyboard Shortcuts', keys: '?', run: openDialog('shortcuts') }],
    },
  ]

  return (
    <nav className="menubar" ref={ref}>
      <img className="app-logo" src="./favicon.svg" alt="" />
      {menus.map((menu, i) => (
        <div key={menu.label} className={`menu ${open === i ? 'open' : ''}`}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <div className="menu-dropdown" role="menu">
              {menu.items.map((item, j) =>
                item === 'separator' ? (
                  <div key={j} className="menu-separator" />
                ) : (
                  <button
                    key={j}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null)
                      item.run()
                    }}
                  >
                    <span>{item.label}</span>
                    {item.keys && <kbd>{item.keys}</kbd>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <span className="menubar-title">{name} — OpenComp</span>
    </nav>
  )
}
