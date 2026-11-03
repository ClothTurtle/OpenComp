import { Film, Pause, Play, Settings2, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { importDialog, updateClip } from '../actions'
import { attachCanvas, requestRender, seek, stepFrames, togglePlay } from '../engine/playback'
import { useElementSize } from '../hooks'
import { trackDrag } from '../lib/drag'
import { containsPoint, corners, layerGeometry } from '../lib/geometry'
import { timecode } from '../lib/time'
import { contentEnd, visualClipsAt } from '../lib/timeline'
import { uid } from '../project'
import { getState, setState, useStore } from '../store'
import { Panel } from './Panel'
import { IconButton } from './ui'

const ZOOM_LEVELS = [0.25, 0.5, 1, 2]

/** The composition preview. Click a layer to select it; drag to move it. */
export function Viewer() {
  const settings = useStore((s) => s.project.settings)
  const name = useStore((s) => s.project.name)
  const isEmpty = useStore((s) => s.project.clips.length === 0)
  const [zoomChoice, setZoomChoice] = useState<'fit' | number>('fit')
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stage = useElementSize(stageRef)

  const fit = Math.max(0.02, Math.min((stage.width - 24) / settings.width, (stage.height - 24) / settings.height))
  const zoom = zoomChoice === 'fit' ? fit : zoomChoice

  useEffect(() => attachCanvas(canvasRef.current!), [])
  useEffect(requestRender, [settings.width, settings.height])

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const toComp = (ev: { clientX: number; clientY: number }) => [
      ((ev.clientX - rect.left) / rect.width) * settings.width,
      ((ev.clientY - rect.top) / rect.height) * settings.height,
    ]
    const [x0, y0] = toComp(e)
    const { project, time, selectedClipId } = getState()
    const hits = visualClipsAt(project, time)
      .reverse() // topmost first
      .filter(({ clip, asset }) => {
        const g = layerGeometry(clip.transform, asset.width, asset.height, settings.width, settings.height)
        return containsPoint(g, x0, y0)
      })
    const target = (hits.find((h) => h.clip.id === selectedClipId) ?? hits[0])?.clip
    setState({ selectedClipId: target?.id ?? null })
    if (!target) return

    const origin = { ...target.transform }
    const mergeKey = `viewer-move:${uid()}`
    trackDrag((ev) => {
      const [x, y] = toComp(ev)
      updateClip(
        target.id,
        (c) => {
          c.transform.x = Math.round(origin.x + x - x0)
          c.transform.y = Math.round(origin.y + y - y0)
        },
        mergeKey,
      )
    })
  }

  return (
    <Panel
      className="viewer"
      title={
        <>
          Composition <span className="accent">{name}</span>
        </>
      }
      footer={
        <>
          <select
            className="zoom-select"
            title="Preview zoom"
            value={String(zoomChoice)}
            onChange={(e) => setZoomChoice(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}
          >
            <option value="fit">Fit ({Math.round(fit * 100)}%)</option>
            {ZOOM_LEVELS.map((z) => (
              <option key={z} value={z}>
                {z * 100}%
              </option>
            ))}
          </select>
          <div className="spacer" />
          <Transport />
          <CurrentTime className="viewer-time" />
          <div className="spacer" />
          <button
            type="button"
            className="footer-info"
            title="Composition settings (Ctrl+K)"
            onClick={() => setState({ dialog: 'comp' })}
          >
            {settings.width}×{settings.height} · {settings.fps} fps
          </button>
        </>
      }
    >
      <div className="stage" ref={stageRef}>
        <div className="canvas-wrap" style={{ width: settings.width * zoom, height: settings.height * zoom }}>
          <canvas ref={canvasRef} width={settings.width} height={settings.height} onPointerDown={onPointerDown} />
          <SelectionOutline zoom={zoom} />
        </div>
        {isEmpty && (
          <div className="empty-stage">
            <button type="button" className="start-card" onClick={importDialog}>
              <Film size={44} strokeWidth={1} />
              Import Footage
            </button>
            <button type="button" className="start-card" onClick={() => setState({ dialog: 'comp' })}>
              <Settings2 size={44} strokeWidth={1} />
              Composition Settings
            </button>
            <p className="muted">Or drop files anywhere. Double-click media in the Project panel to add it to the timeline.</p>
          </div>
        )}
      </div>
    </Panel>
  )
}

/** Blue outline around the selected layer, like a bounding box. */
function SelectionOutline({ zoom }: { zoom: number }) {
  const project = useStore((s) => s.project)
  const time = useStore((s) => s.time)
  const selectedId = useStore((s) => s.selectedClipId)
  const hit = visualClipsAt(project, time).find((l) => l.clip.id === selectedId)
  if (!hit) return null
  const { width, height } = project.settings
  const g = layerGeometry(hit.clip.transform, hit.asset.width, hit.asset.height, width, height)
  const points = corners(g)
    .map(([x, y]) => `${x * zoom},${y * zoom}`)
    .join(' ')
  return (
    <svg className="selection-outline" width={width * zoom} height={height * zoom}>
      <polygon points={points} />
    </svg>
  )
}

export function Transport() {
  const playing = useStore((s) => s.playing)
  return (
    <div className="transport">
      <IconButton icon={SkipBack} title="Go to start (Home)" onClick={() => seek(0)} />
      <IconButton icon={StepBack} title="Previous frame (←)" onClick={() => stepFrames(-1)} />
      <IconButton icon={playing ? Pause : Play} title="Play / pause (Space)" className="play-btn" onClick={togglePlay} />
      <IconButton icon={StepForward} title="Next frame (→)" onClick={() => stepFrames(1)} />
      <IconButton
        icon={SkipForward}
        title="Go to end (End)"
        onClick={() => seek(contentEnd(getState().project))}
      />
    </div>
  )
}

export function CurrentTime({ className }: { className?: string }) {
  const time = useStore((s) => s.time)
  const fps = useStore((s) => s.project.settings.fps)
  return <span className={`timecode ${className ?? ''}`}>{timecode(time, fps)}</span>
}
