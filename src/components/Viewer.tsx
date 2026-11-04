import { Camera, Film, Grid3x3, Pause, Play, Repeat, Settings2, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { maskFromPrompt, nextAlternative } from '../ai/maskTools'
import { useSegmenter } from '../ai/segmenter'
import { addMask, addTextLayer, ellipse, importDialog, saveFrame, updateClip } from '../actions'
import { clipGeometry } from '../engine/layers'
import { maskShapeAt } from '../engine/masks'
import { attachCanvas, seek, stepFrames, togglePlay } from '../engine/playback'
import { useElementSize } from '../hooks'
import { trackDrag } from '../lib/drag'
import { containsPoint, corners, toComp, toLayer } from '../lib/geometry'
import { timecode } from '../lib/time'
import { contentEnd, sourceTime, visualClipsAt } from '../lib/timeline'
import { DEFAULT_TRANSFORM, uid, type Point } from '../project'
import { updateSettings, useSettings, type Settings } from '../settings'
import { getState, setState, useStore } from '../store'
import { Panel } from './Panel'
import { IconButton } from './ui'

const ZOOM_LEVELS = [0.25, 0.5, 1, 2]

type Draft =
  | { kind: 'box'; shape: 'rect' | 'ellipse'; from: Point; to: Point }
  | { kind: 'pen'; clipId: string; points: Point[] }
  | { kind: 'brush'; points: Point[]; exclude: boolean }

/** The composition preview, plus every tool that works by pointing at it. */
export function Viewer() {
  const settings = useStore((s) => s.project.settings)
  const name = useStore((s) => s.project.name)
  const isEmpty = useStore((s) => s.project.clips.length === 0)
  const tool = useStore((s) => s.tool)
  const prefs = useSettings()
  const on = (id: string) => !prefs.disabledFeatures.includes(id)
  const [zoomChoice, setZoomChoice] = useState<'fit' | number>('fit')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stage = useElementSize(stageRef)
  const { width: W, height: H } = settings

  const fit = Math.max(0.02, Math.min((stage.width - 24) / W, (stage.height - 24) / H))
  const zoom = zoomChoice === 'fit' ? fit : zoomChoice

  useEffect(() => attachCanvas(canvasRef.current!), [])
  useEffect(() => setDraft(null), [tool])

  const toCompPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H]
  }

  /**
   * The clip a mask tool acts on: the selected clip if the pointer is over it, else the topmost clip
   * under the pointer, else the selected clip (e.g. dragging a mask that starts outside it).
   */
  const maskTarget = (p: Point): string | null => {
    const { project, time, selectedClipId } = getState()
    const visible = visualClipsAt(project, time)
      .reverse()
      .map(({ clip }) => clip)
      .filter((clip) => !project.tracks.find((t) => t.id === clip.trackId)?.locked)
    const under = visible.filter((clip) => {
      const g = clipGeometry(project, clip, time)
      return g && containsPoint(g, p[0], p[1])
    })
    const target = under.find((c) => c.id === selectedClipId) ?? under[0] ?? visible.find((c) => c.id === selectedClipId)
    if (!target) {
      setState({ status: 'Point at a clip in the preview (or select one on the timeline) first.' })
      return null
    }
    if (target.id !== selectedClipId) setState({ selectedClipId: target.id, selectedMaskId: null })
    return target.id
  }

  /** Comp points -> the clip's normalised layer space. */
  const toLayerPoints = (clipId: string, points: Point[]): Point[] | null => {
    const { project, time } = getState()
    const clip = project.clips.find((c) => c.id === clipId)
    const g = clip && clipGeometry(project, clip, time)
    return g ? points.map(([x, y]) => toLayer(g, x, y)) : null
  }

  const runAI = (points: [number, number, 0 | 1][], fresh: boolean) => {
    maskFromPrompt(points, fresh).catch((err) => setState({ status: `AI mask failed: ${err instanceof Error ? err.message : err}` }))
  }

  const finishPen = (d: Extract<Draft, { kind: 'pen' }>) => {
    const shape = d.points.length >= 3 ? toLayerPoints(d.clipId, d.points) : null
    if (shape) addMask(d.clipId, { kind: 'path', name: 'Pen Mask', shape: [shape] })
    setDraft(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || getState().dialog) return
      if (e.key === 'Tab' && (tool === 'smart-mask' || tool === 'brush-mask')) {
        e.preventDefault()
        nextAlternative()
      }
      if (draft?.kind === 'pen') {
        if (e.key === 'Enter') finishPen(draft)
        if (e.key === 'Escape') setDraft(null)
        if (e.key === 'Backspace') setDraft({ ...draft, points: draft.points.slice(0, -1) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const p = toCompPoint(e)

    if (tool === 'hand') {
      const el = stageRef.current!
      const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
      trackDrag((ev) => {
        el.scrollLeft = start.left - (ev.clientX - start.x)
        el.scrollTop = start.top - (ev.clientY - start.y)
      })
      return
    }

    if (tool === 'text') {
      addTextLayer(undefined, { transform: { ...DEFAULT_TRANSFORM, x: Math.round(p[0] - W / 2), y: Math.round(p[1] - H / 2) } })
      setState({ tool: 'select' })
      return
    }

    if (tool === 'rect-mask' || tool === 'ellipse-mask') {
      const clipId = maskTarget(p)
      if (!clipId) return
      const shape = tool === 'rect-mask' ? 'rect' : 'ellipse'
      setDraft({ kind: 'box', shape, from: p, to: p })
      trackDrag(
        (ev) => setDraft({ kind: 'box', shape, from: p, to: toCompPoint(ev) }),
        (ev) => {
          setDraft(null)
          const [x1, y1] = toCompPoint(ev)
          const [x0, y0] = p
          if (Math.abs(x1 - x0) < 4 || Math.abs(y1 - y0) < 4) return
          const outline: Point[] =
            shape === 'rect'
              ? [
                  [x0, y0],
                  [x1, y0],
                  [x1, y1],
                  [x0, y1],
                ]
              : ellipse(x0, y0, x1, y1)
          const layer = toLayerPoints(clipId, outline)
          if (layer) addMask(clipId, { kind: shape, name: shape === 'rect' ? 'Rectangle Mask' : 'Ellipse Mask', shape: [layer] })
        },
      )
      return
    }

    if (tool === 'pen-mask') {
      if (draft?.kind === 'pen') {
        const [fx, fy] = draft.points[0]
        const closeEnough = Math.hypot(p[0] - fx, p[1] - fy) * zoom < 10
        if (closeEnough && draft.points.length >= 3) finishPen(draft)
        else setDraft({ ...draft, points: [...draft.points, p] })
      } else {
        const clipId = maskTarget(p)
        if (clipId) setDraft({ kind: 'pen', clipId, points: [p] })
      }
      return
    }

    if (tool === 'brush-mask') {
      const clipId = maskTarget(p)
      if (!clipId) return
      const exclude = e.altKey
      const fresh = e.shiftKey
      const stroke: Point[] = [p]
      setDraft({ kind: 'brush', points: stroke, exclude })
      trackDrag(
        (ev) => {
          stroke.push(toCompPoint(ev))
          setDraft({ kind: 'brush', points: [...stroke], exclude })
        },
        () => {
          setDraft(null)
          const layer = toLayerPoints(clipId, resample(stroke, 10))
          if (layer) runAI(layer.map(([x, y]) => [x, y, exclude ? 0 : 1]), fresh)
        },
      )
      return
    }

    if (tool === 'smart-mask') {
      const clipId = maskTarget(p)
      const layer = clipId && toLayerPoints(clipId, [p])
      if (layer) runAI([[layer[0][0], layer[0][1], e.altKey ? 0 : 1]], e.shiftKey)
      return
    }

    // Selection tool: click a layer to select it, drag to move it.
    const { project, time, selectedClipId } = getState()
    const hits = visualClipsAt(project, time)
      .reverse()
      .filter(({ clip }) => {
        if (project.tracks.find((t) => t.id === clip.trackId)?.locked) return false
        const g = clipGeometry(project, clip, time)
        return g && containsPoint(g, p[0], p[1])
      })
    const target = (hits.find((h) => h.clip.id === selectedClipId) ?? hits[0])?.clip
    setState({ selectedClipId: target?.id ?? null, ...(target?.id !== selectedClipId && { selectedMaskId: null }) })
    if (!target || target.adjustment) return

    const origin = { ...target.transform }
    const animated = !!target.keyframes['transform.x']?.length || !!target.keyframes['transform.y']?.length
    if (animated) {
      setState({ status: 'Position is animated: change it with the keyframes in Properties.' })
      return
    }
    const mergeKey = `viewer-move:${uid()}`
    trackDrag((ev) => {
      const [x, y] = toCompPoint(ev)
      updateClip(target.id, (c) => {
        c.transform.x = Math.round(origin.x + x - p[0])
        c.transform.y = Math.round(origin.y + y - p[1])
      }, mergeKey)
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
          <select className="mini-select" title="Preview zoom" value={String(zoomChoice)} onChange={(e) => setZoomChoice(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
            <option value="fit">Fit ({Math.round(fit * 100)}%)</option>
            {ZOOM_LEVELS.map((z) => (
              <option key={z} value={z}>
                {z * 100}%
              </option>
            ))}
          </select>
          {on('preview-quality') && (
            <select
              className="mini-select"
              title="Preview resolution (lower is smoother)"
              value={prefs.previewQuality}
              onChange={(e) => updateSettings({ previewQuality: Number(e.target.value) as Settings['previewQuality'] })}
            >
              <option value={1}>Full</option>
              <option value={0.5}>Half</option>
              <option value={0.25}>Quarter</option>
            </select>
          )}
          {on('guides') && (
            <select className="mini-select" title="Guides" value={prefs.guides} onChange={(e) => updateSettings({ guides: e.target.value as Settings['guides'] })}>
              <option value="off">No guides</option>
              <option value="thirds">Thirds</option>
              <option value="safe">Safe areas</option>
              <option value="both">Thirds + safe</option>
            </select>
          )}
          {on('transparency-grid') && (
            <IconButton icon={Grid3x3} title="Transparency grid" active={prefs.transparencyGrid} onClick={() => updateSettings({ transparencyGrid: !prefs.transparencyGrid })} />
          )}
          {on('snapshot') && <IconButton icon={Camera} title="Save frame as PNG" onClick={() => void saveFrame()} />}
          <div className="spacer" />
          <Transport />
          <CurrentTime className="viewer-time" />
          <div className="spacer" />
          <button type="button" className="footer-info" title="Composition settings (Ctrl+K)" onClick={() => setState({ dialog: 'comp' })}>
            {W}×{H} · {settings.fps} fps
          </button>
        </>
      }
    >
      <div className={`stage tool-${tool}`} ref={stageRef}>
        <div className="canvas-wrap" style={{ width: W * zoom, height: H * zoom }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={(e) => tool === 'brush-mask' && setCursor(toCompPoint(e))}
            onPointerLeave={() => setCursor(null)}
          />
          <Overlay zoom={zoom} draft={draft} cursor={tool === 'brush-mask' ? cursor : null} brushSize={prefs.brushSize} guides={on('guides') ? prefs.guides : 'off'} />
        </div>
        <AIStatus />
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

/** Evenly spaced points along a stroke (at most `count`). */
function resample(points: Point[], count: number): Point[] {
  if (points.length <= 1) return points
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  const total = lengths[lengths.length - 1]
  if (total < 3) return [points[0]]
  const n = Math.min(count, Math.max(2, Math.round(total / 30)))
  return Array.from({ length: n }, (_, k) => {
    const d = (k / (n - 1)) * total
    const i = Math.max(1, lengths.findIndex((l) => l >= d))
    const t = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1)
    return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t] as Point
  })
}

/** Selection outline, mask outlines, guides and in-progress tool drawing, over the canvas. */
function Overlay({ zoom, draft, cursor, brushSize, guides }: { zoom: number; draft: Draft | null; cursor: Point | null; brushSize: number; guides: Settings['guides'] }) {
  const project = useStore((s) => s.project)
  const time = useStore((s) => s.time)
  const selectedId = useStore((s) => s.selectedClipId)
  const selectedMaskId = useStore((s) => s.selectedMaskId)
  const { width: W, height: H } = project.settings
  const z = (n: number) => n * zoom
  const path = (pts: Point[], close = true) => `M${pts.map(([x, y]) => `${z(x)},${z(y)}`).join('L')}${close ? 'Z' : ''}`

  const selected = visualClipsAt(project, time).find((l) => l.clip.id === selectedId)?.clip
  const g = selected && clipGeometry(project, selected, time)

  return (
    <svg className="overlay" width={z(W)} height={z(H)}>
      {(guides === 'thirds' || guides === 'both') && (
        <g className="guide">
          {[1, 2].map((i) => (
            <g key={i}>
              <line x1={z((W * i) / 3)} y1={0} x2={z((W * i) / 3)} y2={z(H)} />
              <line x1={0} y1={z((H * i) / 3)} x2={z(W)} y2={z((H * i) / 3)} />
            </g>
          ))}
        </g>
      )}
      {(guides === 'safe' || guides === 'both') && (
        <g className="guide">
          {[0.9, 0.8].map((f) => (
            <rect key={f} x={z((W * (1 - f)) / 2)} y={z((H * (1 - f)) / 2)} width={z(W * f)} height={z(H * f)} />
          ))}
          <line x1={z(W / 2 - 12)} y1={z(H / 2)} x2={z(W / 2 + 12)} y2={z(H / 2)} />
          <line x1={z(W / 2)} y1={z(H / 2 - 12)} x2={z(W / 2)} y2={z(H / 2 + 12)} />
        </g>
      )}
      {g && selected && (
        <>
          <path className="selection" d={path(corners(g))} />
          {selected.masks.map((m) => {
            const outlines = maskShapeAt(m, sourceTime(selected, time))
            const d = outlines.map((poly) => path(poly.map(([u, v]) => toComp(g, u, v)))).join(' ')
            return <path key={m.id} className={`mask-outline ${m.id === selectedMaskId ? 'selected' : ''} ${m.enabled ? '' : 'off'}`} d={d} fillRule="evenodd" />
          })}
        </>
      )}
      {draft?.kind === 'box' &&
        (draft.shape === 'rect' ? (
          <rect className="draft" x={z(Math.min(draft.from[0], draft.to[0]))} y={z(Math.min(draft.from[1], draft.to[1]))} width={z(Math.abs(draft.to[0] - draft.from[0]))} height={z(Math.abs(draft.to[1] - draft.from[1]))} />
        ) : (
          <ellipse className="draft" cx={z((draft.from[0] + draft.to[0]) / 2)} cy={z((draft.from[1] + draft.to[1]) / 2)} rx={z(Math.abs(draft.to[0] - draft.from[0]) / 2)} ry={z(Math.abs(draft.to[1] - draft.from[1]) / 2)} />
        ))}
      {draft?.kind === 'pen' && (
        <>
          <path className="draft" d={path(draft.points, false)} />
          {draft.points.map(([x, y], i) => (
            <circle key={i} className={`pen-point ${i === 0 ? 'first' : ''}`} cx={z(x)} cy={z(y)} r={i === 0 ? 5 : 3} />
          ))}
        </>
      )}
      {draft?.kind === 'brush' && (
        <path className={`brush-stroke ${draft.exclude ? 'exclude' : ''}`} d={path(draft.points, false)} strokeWidth={z(brushSize)} />
      )}
      {cursor && <circle className="brush-cursor" cx={z(cursor[0])} cy={z(cursor[1])} r={z(brushSize / 2)} />}
    </svg>
  )
}

/** Model download / "thinking" badge for the AI mask tools. */
function AIStatus() {
  const { model, progress, busy, error } = useSegmenter()
  if (model === 'loading') return <div className="ai-status">Downloading the AI mask model… {Math.round(progress * 100)}% (first time only)</div>
  if (busy) return <div className="ai-status">Finding the object…</div>
  if (model === 'error') return <div className="ai-status error">AI model failed to load: {error}</div>
  return null
}

export function Transport() {
  const playing = useStore((s) => s.playing)
  const loop = useSettings((s) => s.loop)
  const loopOn = useSettings((s) => !s.disabledFeatures.includes('loop'))
  return (
    <div className="transport">
      <IconButton icon={SkipBack} title="Go to start (Home)" onClick={() => seek(0)} />
      <IconButton icon={StepBack} title="Previous frame (←)" onClick={() => stepFrames(-1)} />
      <IconButton icon={playing ? Pause : Play} title="Play / pause (Space)" className="play-btn" onClick={togglePlay} />
      <IconButton icon={StepForward} title="Next frame (→)" onClick={() => stepFrames(1)} />
      <IconButton icon={SkipForward} title="Go to end (End)" onClick={() => seek(contentEnd(getState().project))} />
      {loopOn && <IconButton icon={Repeat} title="Loop (L)" active={loop} onClick={() => updateSettings({ loop: !loop })} />}
    </div>
  )
}

export function CurrentTime({ className }: { className?: string }) {
  const time = useStore((s) => s.time)
  const fps = useStore((s) => s.project.settings.fps)
  return <span className={`timecode ${className ?? ''}`}>{timecode(time, fps)}</span>
}
