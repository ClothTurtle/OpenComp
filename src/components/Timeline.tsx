import {
  Bookmark,
  Eye,
  EyeOff,
  Headphones,
  Lock,
  LockOpen,
  Plus,
  Scissors,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type RefObject } from 'react'
import {
  addClip,
  addMarker,
  addTrack,
  applyEffect,
  clearWorkArea,
  copyClip,
  deleteClip,
  duplicateClip,
  importFiles,
  MAX_ZOOM,
  MIN_ZOOM,
  pasteClip,
  removeTrack,
  renameTrack,
  setZoom,
  splitAtPlayhead,
  splitClips,
  toggleTrack,
  updateClip,
} from '../actions'
import { hasSource, thumbnail, waveform } from '../engine/media'
import { pause, seek } from '../engine/playback'
import { useElementSize } from '../hooks'
import { trackDrag } from '../lib/drag'
import { ASSET_DRAG_TYPE, EFFECT_DRAG_TYPE } from '../lib/files'
import { keyframeTimes } from '../lib/keyframes'
import { clamp, timecode, toFrame } from '../lib/time'
import { clipEnd, contentEnd, isFree, snapOffset, snapTargets } from '../lib/timeline'
import { clipKind, clipLabel, uid, type Asset, type Clip, type Marker, type Track } from '../project'
import { useSettings } from '../settings'
import { commit, getState, setState, useStore } from '../store'
import { Panel } from './Panel'
import { IconButton, KindIcon } from './ui'
import { CurrentTime } from './Viewer'

// Keep in sync with --tl-header-w in styles.css.
const HEADER_W = 200
const TRIM_HANDLE_PX = 6
const SNAP_PX = 8

interface Menu {
  x: number
  y: number
  clipId: string
}

export function Timeline() {
  const project = useStore((s) => s.project)
  const pps = useStore((s) => s.pxPerSec)
  const selectedId = useStore((s) => s.selectedClipId)
  const tool = useStore((s) => s.tool)
  const rowH = useSettings((s) => s.trackHeight)
  const disabled = useSettings((s) => s.disabledFeatures)
  const on = (id: string) => !disabled.includes(id)
  useStore((s) => s.mediaVersion)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { width: viewWidth } = useElementSize(scrollRef)
  const [menu, setMenu] = useState<Menu | null>(null)

  const end = contentEnd(project)
  const length = Math.max(end + 10, (viewWidth - HEADER_W) / pps) // seconds of timeline to draw

  // Ctrl/⌘/Alt + wheel zooms around the mouse; a plain wheel scrolls as usual.
  useEffect(() => {
    const el = scrollRef.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) return
      e.preventDefault()
      const before = getState().pxPerSec
      const x = e.clientX - el.getBoundingClientRect().left - HEADER_W + el.scrollLeft
      setZoom(before * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
      const ratio = getState().pxPerSec / before
      requestAnimationFrame(() => (el.scrollLeft += x * (ratio - 1)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const timeAtClientX = (clientX: number) => {
    const el = scrollRef.current!
    return Math.max(0, (clientX - el.getBoundingClientRect().left - HEADER_W + el.scrollLeft) / pps)
  }

  const onDragOver = (e: DragEvent) => {
    const types = e.dataTransfer.types
    if (types.includes(ASSET_DRAG_TYPE) || types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = async (e: DragEvent) => {
    if (e.dataTransfer.types.includes(EFFECT_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation() // don't also run the app-wide "import" drop
    let at = timeAtClientX(e.clientX)
    const trackId = (e.target as HTMLElement).closest<HTMLElement>('[data-track]')?.dataset.track
    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE)
    if (assetId) return addClip(assetId, at, trackId)
    for (const asset of await importFiles([...e.dataTransfer.files])) {
      addClip(asset.id, at, trackId)
      at += asset.duration
    }
  }

  const fitToWindow = () => setZoom((viewWidth - HEADER_W - 40) / Math.max(end, 5))
  const zoomSlider = Math.log(pps / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)

  return (
    <Panel title="Timeline" className={`timeline tool-${tool}`}>
      <div className="tl-bar">
        <CurrentTime className="tl-time" />
        <IconButton icon={Plus} title="Add track" onClick={addTrack} />
        <IconButton icon={Scissors} title="Split at playhead (S)" onClick={splitAtPlayhead} />
        <IconButton icon={Bookmark} title="Add marker at playhead (M)" onClick={() => addMarker()} />
        <div className="spacer" />
        <button type="button" className="btn small" title="Zoom to fit the whole edit" onClick={fitToWindow}>
          Fit
        </button>
        <ZoomOut size={14} className="muted" />
        <input
          type="range"
          className="zoom-slider"
          aria-label="Timeline zoom"
          title="Timeline zoom (Ctrl + scroll)"
          min={0}
          max={1}
          step={0.001}
          value={zoomSlider}
          onChange={(e) => setZoom(MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** Number(e.target.value))}
        />
        <ZoomIn size={14} className="muted" />
      </div>

      <div className="tl-scroll" ref={scrollRef} onDragOver={onDragOver} onDrop={onDrop}>
        <div className="tl-content" style={{ width: HEADER_W + length * pps }}>
          <div className="tl-ruler-row">
            <div className="tl-corner" />
            <Ruler length={length} pps={pps} fps={project.settings.fps} markers={project.markers} workArea={on('work-area') ? project.workArea : null} />
          </div>
          {project.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              clips={project.clips.filter((c) => c.trackId === track.id)}
              assets={project.assets}
              pps={pps}
              rowH={rowH}
              selectedId={selectedId}
              on={on}
              onMenu={setMenu}
            />
          ))}
          {project.clips.length === 0 && (
            <div className="tl-hint">Drag media from the Project panel (or straight from your files) onto a track</div>
          )}
          <PlayheadLine pps={pps} scrollRef={scrollRef} />
        </div>
      </div>
      {menu && <ClipMenu menu={menu} onClose={() => setMenu(null)} on={on} />}
    </Panel>
  )
}

/** Pick a label spacing that leaves room for a timecode (~90px) at the current zoom. */
function tickStep(pps: number, fps: number) {
  const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return steps.find((s) => s * pps >= 90) ?? 600
}

function Ruler({ length, pps, fps, markers, workArea }: { length: number; pps: number; fps: number; markers: Marker[]; workArea: [number, number] | null }) {
  const step = tickStep(pps, fps)
  const ticks = Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => i * step)

  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const left = e.currentTarget.getBoundingClientRect().left
    pause()
    seek((e.clientX - left) / pps)
    trackDrag((ev) => seek(Math.max(0, (ev.clientX - left) / pps)))
  }

  /** Drag a work area edge (or the whole band). */
  const dragWorkArea = (e: PointerEvent, part: 'in' | 'out' | 'band') => {
    e.stopPropagation()
    if (!workArea) return
    const startX = e.clientX
    const [a, b] = workArea
    const key = `workarea:${uid()}`
    trackDrag((ev) => {
      const dt = toFrame((ev.clientX - startX) / pps, fps)
      commit((p) => {
        if (part === 'in') p.workArea = [clamp(a + dt, 0, b - 1 / fps), b]
        else if (part === 'out') p.workArea = [a, Math.max(a + 1 / fps, b + dt)]
        else p.workArea = [Math.max(0, a + dt), Math.max(0, a + dt) + (b - a)]
      }, key)
    })
  }

  return (
    <div className="tl-ruler" style={{ width: length * pps, backgroundSize: `${(step * pps) / 5}px 6px` }} onPointerDown={scrub} title="Click or drag to move the playhead">
      {workArea && (
        <div
          className="tl-workarea"
          style={{ left: workArea[0] * pps, width: (workArea[1] - workArea[0]) * pps }}
          title="Work area: drag to move, drag the ends to resize, double-click to clear (I / O / Alt+X)"
          onPointerDown={(e) => dragWorkArea(e, 'band')}
          onDoubleClick={clearWorkArea}
        >
          <span className="wa-handle in" onPointerDown={(e) => dragWorkArea(e, 'in')} />
          <span className="wa-handle out" onPointerDown={(e) => dragWorkArea(e, 'out')} />
        </div>
      )}
      {ticks.map((t) => (
        <span key={t} className="tl-tick" style={{ left: t * pps }}>
          {timecode(t, fps)}
        </span>
      ))}
      {markers.map((m) => (
        <div
          key={m.id}
          className="tl-marker"
          style={{ left: m.time * pps, color: m.color }}
          title={m.label || 'Marker'}
          onPointerDown={(e) => {
            e.stopPropagation()
            seek(m.time)
          }}
        />
      ))}
      <PlayheadHead pps={pps} />
    </div>
  )
}

function PlayheadHead({ pps }: { pps: number }) {
  const time = useStore((s) => s.time)
  return <div className="tl-playhead-head" style={{ left: time * pps }} />
}

/** The playhead's line through the tracks. Follows the playhead while playing. */
function PlayheadLine({ pps, scrollRef }: { pps: number; scrollRef: RefObject<HTMLDivElement | null> }) {
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const x = time * pps

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const visible = el.clientWidth - HEADER_W
    if (x < el.scrollLeft || x > el.scrollLeft + visible - 20) el.scrollLeft = x - 40
  }, [x, playing, scrollRef])

  return <div className="tl-playhead-line" style={{ left: HEADER_W + x }} />
}

function TrackRow({
  track,
  clips,
  assets,
  pps,
  rowH,
  selectedId,
  on,
  onMenu,
}: {
  track: Track
  clips: Clip[]
  assets: Asset[]
  pps: number
  rowH: number
  selectedId: string | null
  on: (id: string) => boolean
  onMenu: (m: Menu) => void
}) {
  const [renaming, setRenaming] = useState(false)
  return (
    <div className={`tl-row ${track.hidden ? 'is-hidden' : ''} ${track.locked ? 'is-locked' : ''}`} style={{ height: rowH }}>
      <div className="tl-track-head">
        <IconButton icon={track.hidden ? EyeOff : Eye} title={track.hidden ? 'Show track' : 'Hide track'} active={!track.hidden} onClick={() => toggleTrack(track.id, 'hidden')} />
        <IconButton icon={track.muted ? VolumeX : Volume2} title={track.muted ? 'Unmute track' : 'Mute track'} active={!track.muted} onClick={() => toggleTrack(track.id, 'muted')} />
        {on('track-solo') && <IconButton icon={Headphones} title={track.solo ? 'Unsolo' : 'Solo: see/hear only this track'} active={track.solo} className="solo" onClick={() => toggleTrack(track.id, 'solo')} />}
        {on('track-lock') && <IconButton icon={track.locked ? Lock : LockOpen} title={track.locked ? 'Unlock track' : 'Lock track'} active={track.locked} className="lock" onClick={() => toggleTrack(track.id, 'locked')} />}
        {renaming ? (
          <input
            className="tl-track-name"
            autoFocus
            defaultValue={track.name}
            onBlur={(e) => {
              renameTrack(track.id, e.target.value)
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="tl-track-name" title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>
            {track.name}
          </span>
        )}
        <IconButton icon={X} title="Delete track and its clips" className="hover-reveal" onClick={() => removeTrack(track.id)} />
      </div>
      <div
        className="tl-lane"
        data-track={track.id}
        onPointerDown={(e) => e.target === e.currentTarget && setState({ selectedClipId: null, selectedMaskId: null })}
      >
        {clips.map((clip) => (
          <ClipBar
            key={clip.id}
            clip={clip}
            assets={assets}
            pps={pps}
            rowH={rowH}
            selected={clip.id === selectedId}
            locked={track.locked}
            on={on}
            onMenu={onMenu}
          />
        ))}
      </div>
    </div>
  )
}

function ClipBar({
  clip,
  assets,
  pps,
  rowH,
  selected,
  locked,
  on,
  onMenu,
}: {
  clip: Clip
  assets: Asset[]
  pps: number
  rowH: number
  selected: boolean
  locked: boolean
  on: (id: string) => boolean
  onMenu: (m: Menu) => void
}) {
  const asset = assets.find((a) => a.id === clip.assetId)
  const kind = clipKind(clip, assets) ?? 'video'
  const offline = !!clip.assetId && (!asset || !hasSource(asset.id))
  const thumb = on('thumbnails') && asset?.kind === 'video' ? thumbnail(asset.id) : undefined
  const width = Math.max(2, clip.duration * pps)
  const keyTimes = selected ? keyframeTimes(clip).map((kt) => kt - clip.in / (clip.speed / 100)).filter((t) => t >= 0 && t <= clip.duration) : []

  return (
    <div
      className={`clip clip-${kind} ${selected ? 'selected' : ''} ${offline ? 'offline' : ''} ${locked ? 'locked' : ''}`}
      style={{ left: clip.start * pps, width, backgroundImage: thumb ? `url(${thumb})` : undefined }}
      onPointerDown={(e) => !locked && startClipDrag(e, clip)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (locked) return
        setState({ selectedClipId: clip.id })
        onMenu({ x: e.clientX, y: e.clientY, clipId: clip.id })
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(EFFECT_DRAG_TYPE)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(EFFECT_DRAG_TYPE)
        if (!type || kind === 'audio') return
        e.preventDefault()
        e.stopPropagation()
        applyEffect(type, clip.id)
        setState({ selectedClipId: clip.id })
      }}
      title={`${clipLabel(clip, assets)}\nDrag to move · drag edges to trim · right-click for more`}
    >
      {asset && on('waveforms') && asset.kind !== 'image' && <Waveform clip={clip} asset={asset} pps={pps} height={Math.max(10, rowH - 22)} />}
      <span className="clip-label">
        <KindIcon kind={kind} size={12} />
        <span className="clip-name">{clipLabel(clip, assets)}</span>
        {clip.speed !== 100 && <span className="badge">{clip.speed}%</span>}
        {clip.effects.length > 0 && <span className="badge">fx {clip.effects.length}</span>}
        {clip.masks.length > 0 && <span className="badge">mask</span>}
      </span>
      {keyTimes.map((t) => (
        <span
          key={t}
          className="keyframe"
          style={{ left: t * pps }}
          title="Keyframe"
          onPointerDown={(e) => {
            e.stopPropagation()
            seek(clip.start + t)
          }}
        />
      ))}
    </div>
  )
}

function Waveform({ clip, asset, pps, height }: { clip: Clip; asset: Asset; pps: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wave = waveform(asset.id, () => setState((s) => ({ mediaVersion: s.mediaVersion + 1 })))
  const width = Math.min(4000, Math.max(1, Math.round(clip.duration * pps)))

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !wave) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
    const perPx = (clip.duration * clip.speed) / 100 / width // source seconds per pixel
    for (let x = 0; x < width; x++) {
      const from = Math.floor((clip.in + x * perPx) * wave.rate)
      const to = Math.max(from + 1, Math.floor((clip.in + (x + 1) * perPx) * wave.rate))
      let peak = 0
      for (let i = from; i < to && i < wave.data.length; i++) peak = Math.max(peak, wave.data[i])
      const h = Math.max(1, Math.min(1, peak * 1.4) * height)
      ctx.fillRect(x, (height - h) / 2, 1, h)
    }
  }, [wave, width, height, clip.in, clip.duration, clip.speed])

  return wave ? <canvas ref={ref} className="waveform" style={{ width, height }} /> : null
}

function ClipMenu({ menu, onClose, on }: { menu: Menu; onClose: () => void; on: (id: string) => boolean }) {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])

  const item = (label: string, run: () => void, keys?: string) => (
    <button
      type="button"
      className="menu-item"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        run()
        onClose()
      }}
    >
      <span>{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  )

  const rename = () => {
    const clip = getState().project.clips.find((c) => c.id === menu.clipId)
    const name = clip && prompt('Clip name', clip.name ?? '')
    if (clip && name !== null) updateClip(clip.id, (c) => (c.name = name || undefined))
  }

  return (
    <div className="menu-dropdown context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
      {item('Split at playhead', splitAtPlayhead, 'S')}
      {on('duplicate') && item('Duplicate', () => duplicateClip(menu.clipId), 'Ctrl+D')}
      {on('copy-paste') && item('Copy', copyClip, 'Ctrl+C')}
      {on('copy-paste') && item('Paste at playhead', pasteClip, 'Ctrl+V')}
      {item('Rename…', rename)}
      <div className="menu-separator" />
      {item('Delete', () => deleteClip(menu.clipId), 'Del')}
      {on('ripple-delete') && item('Ripple delete', () => deleteClip(menu.clipId, true), 'Shift+Del')}
    </div>
  )
}

/** Move a clip (in time and between tracks) or trim either edge, depending on where it was grabbed. */
function startClipDrag(e: PointerEvent<HTMLDivElement>, clip: Clip) {
  if (e.button !== 0) return
  e.stopPropagation()
  const { project, tool, pxPerSec: pps, snapping, time } = getState()
  const fps = project.settings.fps
  const rowH = useSettings.getState().trackHeight
  const rect = e.currentTarget.getBoundingClientRect()
  const offset = e.clientX - rect.left

  if (tool === 'razor') {
    splitClips([clip.id], toFrame(clip.start + offset / pps, fps))
    return
  }
  if (getState().selectedClipId !== clip.id) setState({ selectedClipId: clip.id, selectedMaskId: null })

  const canTrim = rect.width > TRIM_HANDLE_PX * 3
  const mode =
    canTrim && offset < TRIM_HANDLE_PX ? 'trim-start' : canTrim && offset > rect.width - TRIM_HANDLE_PX ? 'trim-end' : 'move'
  const asset = project.assets.find((a) => a.id === clip.assetId)
  const still = !asset || asset.kind === 'image' // stills and generated layers can be any length
  const sp = clip.speed / 100
  const targets = snapping ? snapTargets(project, time, clip.id) : []
  const threshold = SNAP_PX / pps
  const frame = 1 / fps
  const trackIndex = project.tracks.findIndex((t) => t.id === clip.trackId)
  const mergeKey = `clip-drag:${uid()}`

  trackDrag((ev) => {
    const dt = (ev.clientX - e.clientX) / pps
    const current = getState().project

    if (mode === 'move') {
      let start = Math.max(0, clip.start + dt)
      start = Math.max(0, toFrame(start + snapOffset([start, start + clip.duration], targets, threshold), fps))
      const rowDelta = Math.round((ev.clientY - e.clientY) / rowH)
      const track = project.tracks[clamp(trackIndex + rowDelta, 0, project.tracks.length - 1)]
      if (!track || track.locked || !isFree(current, track.id, start, start + clip.duration, clip.id)) return
      updateClip(clip.id, (c) => {
        c.start = start
        c.trackId = track.id
      }, mergeKey)
    } else if (mode === 'trim-start') {
      let start = clip.start + dt
      start += snapOffset([start], targets, threshold)
      const earliest = still ? 0 : Math.max(0, clip.start - clip.in / sp) // can't reveal media before the file starts
      start = clamp(toFrame(start, fps), earliest, clipEnd(clip) - frame)
      if (!isFree(current, clip.trackId, start, clipEnd(clip), clip.id)) return
      updateClip(clip.id, (c) => {
        c.in = clip.in + (start - clip.start) * sp
        c.duration = clipEnd(clip) - start
        c.start = start
      }, mergeKey)
    } else {
      let end = clipEnd(clip) + dt
      end += snapOffset([end], targets, threshold)
      const latest = still ? Infinity : clip.start + (asset.duration - clip.in) / sp // ...or after it ends
      end = clamp(toFrame(end, fps), clip.start + frame, latest)
      if (!isFree(current, clip.trackId, clip.start, end, clip.id)) return
      updateClip(clip.id, (c) => {
        c.duration = end - clip.start
      }, mergeKey)
    }
  })
}
