import { Search, Settings2, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { useState } from 'react'
import { addClip, importDialog, relinkDialog, removeAsset } from '../actions'
import { hasSource, thumbnail } from '../engine/media'
import { ASSET_DRAG_TYPE } from '../lib/files'
import { timecode } from '../lib/time'
import type { Asset } from '../project'
import { getState, setState, useStore } from '../store'
import { Panel } from './Panel'
import { IconButton, KindIcon } from './ui'

/** The media bin: everything imported into the project. Drag items to the timeline, or double-click. */
export function ProjectPanel() {
  const assets = useStore((s) => s.project.assets)
  const settings = useStore((s) => s.project.settings)
  const selectedId = useStore((s) => s.selectedAssetId)
  useStore((s) => s.mediaVersion) // re-render when files are (re)linked
  const [query, setQuery] = useState('')

  const selected = assets.find((a) => a.id === selectedId)
  const offline = assets.filter((a) => !hasSource(a.id)).length
  const shown = assets.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))

  const remove = (asset: Asset) => {
    const used = getState().project.clips.some((c) => c.assetId === asset.id)
    if (used && !confirm(`"${asset.name}" is used on the timeline. Remove it and its clips?`)) return
    removeAsset(asset.id)
  }

  return (
    <Panel
      title="Project"
      className="project-panel"
      footer={
        <>
          <IconButton icon={Upload} title="Import media (Ctrl+I)" onClick={importDialog} />
          <IconButton
            icon={Settings2}
            title="Composition settings (Ctrl+K)"
            onClick={() => setState({ dialog: 'comp' })}
          />
          <button type="button" className="footer-info" onClick={() => setState({ dialog: 'comp' })}>
            {settings.width}×{settings.height} · {settings.fps} fps
          </button>
          <div className="spacer" />
          <IconButton
            icon={Trash2}
            title="Remove from project"
            disabled={!selected}
            onClick={() => selected && remove(selected)}
          />
        </>
      }
    >
      <div className="asset-preview">
        {selected ? (
          <>
            <Thumb asset={selected} />
            <div className="asset-meta">
              <strong title={selected.name}>{selected.name}</strong>
              {selected.kind !== 'audio' && (
                <span>
                  {selected.width} × {selected.height}
                </span>
              )}
              <span>{selected.kind === 'image' ? 'Still image' : timecode(selected.duration, settings.fps)}</span>
            </div>
          </>
        ) : (
          <span className="muted">Select an item to see its details</span>
        )}
      </div>

      {offline > 0 && (
        <div className="offline-banner">
          <TriangleAlert size={14} />
          <span>
            {offline} file{offline > 1 ? 's' : ''} offline
          </span>
          <button type="button" className="link" onClick={relinkDialog}>
            Relink…
          </button>
        </div>
      )}

      <label className="search">
        <Search size={13} />
        <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <div className="asset-list" role="listbox" aria-label="Project media">
        <div className="asset-row asset-head">
          <span>Name</span>
          <span>Type</span>
          <span>Duration</span>
        </div>
        {shown.map((a) => (
          <div
            key={a.id}
            role="option"
            aria-selected={a.id === selectedId}
            className={`asset-row ${a.id === selectedId ? 'selected' : ''} ${hasSource(a.id) ? '' : 'offline'}`}
            title={hasSource(a.id) ? 'Double-click or drag onto the timeline' : 'File is offline — use Relink'}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => setState({ selectedAssetId: a.id })}
            onDoubleClick={() => addClip(a.id)}
          >
            <span className="asset-name">
              <KindIcon kind={a.kind} />
              {a.name}
            </span>
            <span>{a.kind}</span>
            <span>{a.kind === 'image' ? '—' : timecode(a.duration, settings.fps)}</span>
          </div>
        ))}
        {assets.length === 0 && (
          <button type="button" className="drop-hint" onClick={importDialog}>
            <Upload size={22} strokeWidth={1.5} />
            Drop video, audio or images here
            <span>or click to import</span>
          </button>
        )}
      </div>
    </Panel>
  )
}

function Thumb({ asset }: { asset: Asset }) {
  const src = thumbnail(asset.id)
  return (
    <div className="thumb">{src ? <img src={src} alt="" /> : <KindIcon kind={asset.kind} size={22} />}</div>
  )
}
