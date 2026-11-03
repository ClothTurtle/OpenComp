import { Bookmark, Eye, EyeOff, Plus, Scissors, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, type DragEvent, type PointerEvent, type RefObject } from 'react'
import {
  addClip,
  addMarker,
  addTrack,
  importFiles,
  MAX_ZOOM,
  MIN_ZOOM,
  removeTrack,
  setZoom,
  splitAtPlayhead,
  splitClips,
  toggleTrack,
  updateClip,
} from '../actions'
import { hasSource } from '../engine/media'
import { pause, seek } from '../engine/playback'
import { useElementSize } from '../hooks'
import { trackDrag } from '../lib/drag'
import { ASSET_DRAG_TYPE } from '../lib/files'
import { clamp, timecode, toFrame } from '../lib/time'
import { clipEnd, contentEnd, isFree, snapOffset, snapTargets } from '../lib/timeline'
import { uid, type Asset, type Clip, type Marker, type Track } from '../project'
import { getState, setState, useStore } from '../store'
import { Panel } from './Panel'
import { IconButton, KindIcon } from './ui'
import { CurrentTime } from './Viewer'

// Keep in sync with the --tl-* variables in styles.css.
const HEADER_W = 180
const ROW_H = 44
const TRIM_HANDLE_PX = 6
const SNAP_PX = 8

export function Timeline() {
  const project = useStore((s) => s.project)
  const pps = useStore((s) => s.pxPerSec)
  const selectedId = useStore((s) => s.selectedClipId)
  const tool = useStore((s) => s.tool)
  useStore((s) => s.mediaVersion)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { width: viewWidth } = useElementSize(scrollRef)

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
            <Ruler length={length} pps={pps} fps={project.settings.fps} markers={project.markers} />
          </div>
          {project.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              clips={project.clips.filter((c) => c.trackId === track.id)}
              assets={project.assets}
              pps={pps}
              selectedId={selectedId}
            />
          ))}
          {project.clips.length === 0 && (
            <div className="tl-hint">Drag media from the Project panel (or straight from your files) onto a track</div>
          )}
          <PlayheadLine pps={pps} scrollRef={scrollRef} />
        </div>
      </div>
    </Panel>
  )
}

/** Pick a label spacing that leaves room for a timecode (~90px) at the current zoom. */
function tickStep(pps: number, fps: number) {
  const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return steps.find((s) => s * pps >= 90) ?? 600
}

function Ruler({ length, pps, fps, markers }: { length: number; pps: number; fps: number; markers: Marker[] }) {
  const step = tickStep(pps, fps)
  const minorPx = (step * pps) / 5
  const ticks = Array.from({ length: Math.floor(length / step) + 1 }, (_, i) => i * step)

  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const left = e.currentTarget.getBoundingClientRect().left
    pause()
    seek((e.clientX - left) / pps)
    trackDrag((ev) => seek(Math.max(0, (ev.clientX - left) / pps)))
  }

  return (
    <div
      className="tl-ruler"
      style={{ width: length * pps, backgroundSize: `${minorPx}px 6px` }}
      onPointerDown={scrub}
      title="Click or drag to move the playhead"
    >
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
  selectedId,
}: {
  track: Track
  clips: Clip[]
  assets: Asset[]
  pps: number
  selectedId: string | null
}) {
  return (
    <div className={`tl-row ${track.hidden ? 'is-hidden' : ''}`} style={{ height: ROW_H }}>
      <div className="tl-track-head">
        <IconButton
          icon={track.hidden ? EyeOff : Eye}
          title={track.hidden ? 'Show track' : 'Hide track'}
          active={!track.hidden}
          onClick={() => toggleTrack(track.id, 'hidden')}
        />
        <IconButton
          icon={track.muted ? VolumeX : Volume2}
          title={track.muted ? 'Unmute track' : 'Mute track'}
          active={!track.muted}
          onClick={() => toggleTrack(track.id, 'muted')}
        />
        <span className="tl-track-name">{track.name}</span>
        <IconButton icon={X} title="Delete track and its clips" className="hover-reveal" onClick={() => removeTrack(track.id)} />
      </div>
      <div
        className="tl-lane"
        data-track={track.id}
        onPointerDown={(e) => e.target === e.currentTarget && setState({ selectedClipId: null })}
      >
        {clips.map((clip) => (
          <ClipBar
            key={clip.id}
            clip={clip}
            asset={assets.find((a) => a.id === clip.assetId)}
            pps={pps}
            selected={clip.id === selectedId}
          />
        ))}
      </div>
    </div>
  )
}

function ClipBar({ clip, asset, pps, selected }: { clip: Clip; asset?: Asset; pps: number; selected: boolean }) {
  const offline = !asset || !hasSource(asset.id)
  return (
    <div
      className={`clip clip-${asset?.kind ?? 'video'} ${selected ? 'selected' : ''} ${offline ? 'offline' : ''}`}
      style={{ left: clip.start * pps, width: Math.max(2, clip.duration * pps) }}
      onPointerDown={(e) => startClipDrag(e, clip)}
      title={`${asset?.name ?? 'Missing media'}\nDrag to move · drag edges to trim`}
    >
      {asset && <KindIcon kind={asset.kind} size={12} />}
      <span className="clip-name">{asset?.name ?? 'Missing media'}</span>
    </div>
  )
}

/** Move a clip (in time and between tracks) or trim either edge, depending on where it was grabbed. */
function startClipDrag(e: PointerEvent<HTMLDivElement>, clip: Clip) {
  if (e.button !== 0) return
  e.stopPropagation()
  const { project, tool, pxPerSec: pps, snapping, time } = getState()
  const fps = project.settings.fps
  const rect = e.currentTarget.getBoundingClientRect()
  const offset = e.clientX - rect.left

  if (tool === 'razor') {
    splitClips([clip.id], toFrame(clip.start + offset / pps, fps))
    return
  }
  setState({ selectedClipId: clip.id })

  const canTrim = rect.width > TRIM_HANDLE_PX * 3
  const mode =
    canTrim && offset < TRIM_HANDLE_PX ? 'trim-start' : canTrim && offset > rect.width - TRIM_HANDLE_PX ? 'trim-end' : 'move'
  const asset = project.assets.find((a) => a.id === clip.assetId)
  const still = !asset || asset.kind === 'image' // stills can be stretched to any length
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
      const rowDelta = Math.round((ev.clientY - e.clientY) / ROW_H)
      const track = project.tracks[clamp(trackIndex + rowDelta, 0, project.tracks.length - 1)]
      if (!track || !isFree(current, track.id, start, start + clip.duration, clip.id)) return
      updateClip(clip.id, (c) => {
        c.start = start
        c.trackId = track.id
      }, mergeKey)
    } else if (mode === 'trim-start') {
      let start = clip.start + dt
      start += snapOffset([start], targets, threshold)
      const earliest = Math.max(0, still ? 0 : clip.start - clip.in) // can't reveal media before the file starts
      start = clamp(toFrame(start, fps), earliest, clipEnd(clip) - frame)
      if (!isFree(current, clip.trackId, start, clipEnd(clip), clip.id)) return
      updateClip(clip.id, (c) => {
        c.in = still ? 0 : clip.in + (start - clip.start)
        c.duration = clipEnd(clip) - start
        c.start = start
      }, mergeKey)
    } else {
      let end = clipEnd(clip) + dt
      end += snapOffset([end], targets, threshold)
      const latest = still ? Infinity : clip.start + asset.duration - clip.in // ...or after it ends
      end = clamp(toFrame(end, fps), clip.start + frame, latest)
      if (!isFree(current, clip.trackId, clip.start, end, clip.id)) return
      updateClip(clip.id, (c) => {
        c.duration = end - clip.start
      }, mergeKey)
    }
  })
}
