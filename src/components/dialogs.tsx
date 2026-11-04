import { useMemo, useRef, useState } from 'react'
import { exportVideo, supportedFormats, type ExportJob } from '../engine/exporter'
import { download, fileSafe } from '../lib/files'
import { timecode } from '../lib/time'
import { contentEnd } from '../lib/timeline'
import { desktop } from '../platform'
import { SHORTCUTS } from '../shortcuts'
import { commit, useStore } from '../store'
import { closeDialog, Modal } from './ui'

const PRESETS = [
  { label: 'HD 1080p', width: 1920, height: 1080 },
  { label: 'HD 720p', width: 1280, height: 720 },
  { label: '4K UHD', width: 3840, height: 2160 },
  { label: 'Vertical 9:16', width: 1080, height: 1920 },
  { label: 'Square 1:1', width: 1080, height: 1080 },
]
const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 60]

/** Most video encoders need even dimensions. */
const evenSize = (n: number) => Math.min(7680, Math.max(16, Math.round(n / 2) * 2))

export function CompSettingsDialog() {
  const project = useStore((s) => s.project)
  const [name, setName] = useState(project.name)
  const [settings, setSettings] = useState(project.settings)
  const preset = PRESETS.findIndex((p) => p.width === settings.width && p.height === settings.height)

  const apply = () => {
    commit((p) => {
      p.name = name.trim() || 'Untitled Project'
      p.settings = { ...settings, width: evenSize(settings.width), height: evenSize(settings.height) }
    })
    closeDialog()
  }

  return (
    <Modal
      title="Composition Settings"
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={apply}>
            OK
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Preset
          <select
            value={preset}
            onChange={(e) => {
              const p = PRESETS[Number(e.target.value)]
              if (p) setSettings({ ...settings, width: p.width, height: p.height })
            }}
          >
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label} ({p.width}×{p.height})
              </option>
            ))}
            <option value={-1}>Custom</option>
          </select>
        </label>
        <div className="form-row">
          <label>
            Width
            <input
              type="number"
              min={16}
              max={7680}
              value={settings.width}
              onChange={(e) => setSettings({ ...settings, width: Number(e.target.value) })}
            />
          </label>
          <label>
            Height
            <input
              type="number"
              min={16}
              max={7680}
              value={settings.height}
              onChange={(e) => setSettings({ ...settings, height: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          Frame rate
          <select value={settings.fps} onChange={(e) => setSettings({ ...settings, fps: Number(e.target.value) })}>
            {FRAME_RATES.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
        <label>
          Background
          <input
            type="color"
            value={settings.background}
            onChange={(e) => setSettings({ ...settings, background: e.target.value })}
          />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function ExportDialog() {
  const project = useStore((s) => s.project)
  const formats = useMemo(supportedFormats, [])
  const [formatIndex, setFormatIndex] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const job = useRef<ExportJob | null>(null)
  const [workAreaOnly, setWorkAreaOnly] = useState(!!project.workArea)
  const [from, to] = workAreaOnly && project.workArea ? project.workArea : [0, contentEnd(project)]
  const end = to - from
  const { width, height, fps } = project.settings

  const start = async () => {
    const format = formats[formatIndex]
    setMessage('')
    try {
      job.current = exportVideo(format, workAreaOnly, setProgress)
      setProgress(0)
      const blob = await job.current.done
      const name = `${fileSafe(project.name)}.${format.ext}`
      if (!blob) setMessage('Export cancelled.')
      else if (desktop) {
        const saved = await desktop.saveFile(await blob.arrayBuffer(), name)
        setMessage(saved ? `Saved to ${saved}` : 'Not saved.')
      } else {
        download(blob, name)
        setMessage('Done! The video was saved to your downloads.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
    job.current = null
    setProgress(null)
  }

  const close = () => {
    job.current?.cancel()
    closeDialog()
  }

  const running = progress !== null
  return (
    <Modal
      title="Export Video"
      onClose={close}
      footer={
        running ? (
          <button type="button" className="btn" onClick={() => job.current?.cancel()}>
            Cancel export
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={close}>
              Close
            </button>
            <button type="button" className="btn primary" disabled={!formats.length || end === 0} onClick={start}>
              Export
            </button>
          </>
        )
      }
    >
      <dl className="summary">
        <dt>Resolution</dt>
        <dd>
          {width} × {height}
        </dd>
        <dt>Frame rate</dt>
        <dd>{fps} fps</dd>
        <dt>Duration</dt>
        <dd>{timecode(end, fps)}</dd>
        {project.workArea && (
          <>
            <dt>Range</dt>
            <dd>
              <label className="check">
                <input type="checkbox" checked={workAreaOnly} disabled={running} onChange={(e) => setWorkAreaOnly(e.target.checked)} /> Work area only
              </label>
            </dd>
          </>
        )}
        <dt>Format</dt>
        <dd>
          {formats.length ? (
            <select value={formatIndex} disabled={running} onChange={(e) => setFormatIndex(Number(e.target.value))}>
              {formats.map((f, i) => (
                <option key={f.mime} value={i}>
                  {f.label}
                </option>
              ))}
            </select>
          ) : (
            'This browser cannot record video.'
          )}
        </dd>
      </dl>
      {end === 0 && <p className="muted">Add some clips to the timeline first.</p>}
      {running && (
        <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <p className="muted">
        {running
          ? `Exporting… ${Math.round(progress * 100)}%. Keep this tab visible until it finishes.`
          : 'Export plays the timeline in real time while recording it, so it takes as long as the video.'}
      </p>
      {message && <p className="message">{message}</p>}
    </Modal>
  )
}

export function ShortcutsDialog() {
  return (
    <Modal
      title="Keyboard Shortcuts"
      footer={
        <button type="button" className="btn primary" onClick={closeDialog}>
          Close
        </button>
      }
    >
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.label}>
              <td>
                <kbd>{s.keys}</kbd>
              </td>
              <td>{s.label}</td>
            </tr>
          ))}
          <tr>
            <td>
              <kbd>Ctrl + scroll</kbd>
            </td>
            <td>Zoom the timeline around the mouse</td>
          </tr>
          <tr>
            <td>
              <kbd>Double-click</kbd>
            </td>
            <td>A panel's title bar maximizes it (Esc restores)</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  )
}
