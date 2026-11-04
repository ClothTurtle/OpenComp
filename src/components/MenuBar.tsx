import { useEffect, useRef, useState } from 'react'
import {
  addAdjustmentLayer,
  addMarker,
  addSolidLayer,
  addTextLayer,
  addTrack,
  clearWorkArea,
  copyClip,
  deleteSelectedClip,
  duplicateClip,
  importDialog,
  newProjectAction,
  openProject,
  pasteClip,
  resetLayout,
  rippleDeleteSelected,
  saveFrame,
  saveProject,
  setWorkArea,
  splitAtPlayhead,
  zoomTimeline,
} from '../actions'
import { isDesktop } from '../platform'
import { getSettings, updateSettings, useSettings } from '../settings'
import { redo, setState, undo, useStore, type Dialog } from '../store'

type MenuItem = { label: string; keys?: string; run: () => void; disabled?: boolean; feature?: string } | 'separator'

const openDialog = (dialog: Dialog) => () => setState({ dialog })

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null)
  const name = useStore((s) => s.project.name)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const hasClip = useStore((s) => !!s.selectedClipId)
  const disabled = useSettings((s) => s.disabledFeatures)
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
        { label: 'Open Project…', keys: 'Ctrl+O', run: () => void openProject() },
        { label: 'Save Project', keys: 'Ctrl+S', run: () => void saveProject() },
        ...(isDesktop ? [{ label: 'Save Project As…', keys: 'Ctrl+Shift+S', run: () => void saveProject(true) }] : []),
        'separator',
        { label: 'Import Media…', keys: 'Ctrl+I', run: () => void importDialog() },
        { label: 'Export Video…', keys: 'Ctrl+M', run: openDialog('export') },
        { label: 'Save Frame as PNG…', run: () => void saveFrame(), feature: 'snapshot' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', keys: 'Ctrl+Z', run: undo, disabled: !canUndo },
        { label: 'Redo', keys: 'Ctrl+Shift+Z', run: redo, disabled: !canRedo },
        'separator',
        { label: 'Copy Clip', keys: 'Ctrl+C', run: copyClip, disabled: !hasClip, feature: 'copy-paste' },
        { label: 'Paste Clip', keys: 'Ctrl+V', run: pasteClip, feature: 'copy-paste' },
        { label: 'Duplicate Clip', keys: 'Ctrl+D', run: () => duplicateClip(), disabled: !hasClip, feature: 'duplicate' },
        { label: 'Split at Playhead', keys: 'S', run: splitAtPlayhead },
        { label: 'Delete Clip', keys: 'Del', run: deleteSelectedClip, disabled: !hasClip },
        { label: 'Ripple Delete', keys: 'Shift+Del', run: rippleDeleteSelected, disabled: !hasClip, feature: 'ripple-delete' },
        'separator',
        { label: 'Settings…', keys: 'Ctrl+,', run: openDialog('settings') },
      ],
    },
    {
      label: 'Layer',
      items: [
        { label: 'New Text Layer', keys: 'T', run: () => addTextLayer(), feature: 'text-layers' },
        { label: 'New Solid', run: () => addSolidLayer(), feature: 'solid-layers' },
        { label: 'New Adjustment Layer', run: () => addAdjustmentLayer(), feature: 'adjustment-layers' },
        'separator',
        { label: 'Effects & Presets…', keys: 'Ctrl+B', run: () => updateSettings({ showSidebar: true }) },
      ],
    },
    {
      label: 'Composition',
      items: [
        { label: 'Composition Settings…', keys: 'Ctrl+K', run: openDialog('comp') },
        { label: 'Add Track', run: addTrack },
        { label: 'Add Marker', keys: 'M', run: () => addMarker() },
        'separator',
        { label: 'Set Work Area In', keys: 'I', run: () => setWorkArea('in'), feature: 'work-area' },
        { label: 'Set Work Area Out', keys: 'O', run: () => setWorkArea('out'), feature: 'work-area' },
        { label: 'Clear Work Area', keys: 'Alt+X', run: clearWorkArea, feature: 'work-area' },
      ],
    },
    {
      label: 'AI',
      items: [
        { label: 'AI Mask Brush', keys: 'B', run: () => setState({ tool: 'brush-mask' }), feature: 'ai-mask-brush' },
        { label: 'Smart Click Mask', keys: 'A', run: () => setState({ tool: 'smart-mask' }), feature: 'ai-smart-mask' },
        { label: 'Auto Captions…', run: openDialog('captions'), feature: 'auto-captions' },
        { label: 'Generate Image…', run: openDialog('image'), feature: 'image-generation' },
        'separator',
        { label: 'Claude Assistant', run: () => setState({ sideTab: 'assistant' }), feature: 'claude-assistant' },
        { label: 'Connect to Claude Desktop / Code…', run: openDialog('settings'), feature: 'claude-mcp' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Features & Effects Sidebar', keys: 'Ctrl+B', run: () => updateSettings({ showSidebar: !getSettings().showSidebar }) },
        { label: 'Toggle Light / Dark Theme', run: () => updateSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) },
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
          <button type="button" onClick={() => setOpen(open === i ? null : i)} onPointerEnter={() => open !== null && setOpen(i)}>
            {menu.label}
          </button>
          {open === i && (
            <div className="menu-dropdown" role="menu">
              {menu.items
                .filter((item) => item === 'separator' || !item.feature || !disabled.includes(item.feature))
                .map((item, j) =>
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
      <span className="menubar-title">
        {name} — OpenComp{isDesktop ? '' : ' (browser)'}
      </span>
    </nav>
  )
}
