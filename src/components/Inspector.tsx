import { ChevronDown, ChevronRight, Scissors, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { deleteSelectedClip, splitAtPlayhead, updateClip } from '../actions'
import { timecode } from '../lib/time'
import { clipEnd } from '../lib/timeline'
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, type Clip, type ColorGrade, type Transform } from '../project'
import { setState, useStore } from '../store'
import { Panel } from './Panel'
import { PropertyRow } from './PropertyRow'
import { KindIcon } from './ui'

interface Field<K> {
  key: K
  label: string
  min: number
  max: number
  step: number
  unit?: string
}

const COLOR_FIELDS: Field<keyof ColorGrade>[] = [
  { key: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, unit: 'EV' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
]

/** Properties of the selected clip: transform, colour grade and volume (After Effects' "Effect Controls"). */
export function Inspector() {
  const clip = useStore((s) => s.project.clips.find((c) => c.id === s.selectedClipId))
  const assets = useStore((s) => s.project.assets)
  const settings = useStore((s) => s.project.settings)

  if (!clip) {
    return (
      <Panel title="Properties">
        <div className="empty-note">
          Select a clip on the timeline to adjust its position, colour and volume.
          <button type="button" className="link" onClick={() => setState({ dialog: 'comp' })}>
            Composition settings…
          </button>
        </div>
      </Panel>
    )
  }

  const asset = assets.find((a) => a.id === clip.assetId)
  const visual = asset?.kind !== 'audio'
  const audible = asset?.kind !== 'image'
  // The merge key makes each drag or typing burst on one property a single undo step.
  const edit = (field: string, change: (c: Clip) => void) => updateClip(clip.id, change, `${clip.id}:${field}`)

  const transformFields: Field<keyof Transform>[] = [
    { key: 'x', label: 'Position X', min: -settings.width, max: settings.width, step: 1, unit: 'px' },
    { key: 'y', label: 'Position Y', min: -settings.height, max: settings.height, step: 1, unit: 'px' },
    { key: 'scale', label: 'Scale', min: 0, max: 400, step: 1, unit: '%' },
    { key: 'rotation', label: 'Rotation', min: -180, max: 180, step: 1, unit: '°' },
    { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, unit: '%' },
  ]

  return (
    <Panel title="Properties">
      <div className="inspector-head">
        {asset && <KindIcon kind={asset.kind} size={15} />}
        <div>
          <strong title={asset?.name}>{asset?.name ?? 'Missing media'}</strong>
          <span className="muted">
            {timecode(clip.start, settings.fps)} – {timecode(clipEnd(clip), settings.fps)}
          </span>
        </div>
      </div>

      {visual && (
        <Section
          title="Transform"
          onReset={() => edit('transform', (c) => { c.transform = { ...DEFAULT_TRANSFORM } })}
        >
          {transformFields.map(({ key, ...f }) => (
            <PropertyRow
              key={key}
              {...f}
              value={clip.transform[key]}
              defaultValue={DEFAULT_TRANSFORM[key]}
              onChange={(v) => edit(key, (c) => { c.transform[key] = v })}
            />
          ))}
        </Section>
      )}

      {visual && (
        <Section title="Color" onReset={() => edit('color', (c) => { c.color = { ...DEFAULT_COLOR } })}>
          {COLOR_FIELDS.map(({ key, ...f }) => (
            <PropertyRow
              key={key}
              {...f}
              value={clip.color[key]}
              defaultValue={DEFAULT_COLOR[key]}
              onChange={(v) => edit(key, (c) => { c.color[key] = v })}
            />
          ))}
        </Section>
      )}

      {audible && (
        <Section title="Audio" onReset={() => edit('volume', (c) => { c.volume = 100 })}>
          <PropertyRow
            label="Volume"
            value={clip.volume}
            min={0}
            max={200}
            step={1}
            unit="%"
            defaultValue={100}
            onChange={(v) => edit('volume', (c) => { c.volume = v })}
          />
        </Section>
      )}

      <div className="inspector-actions">
        <button type="button" className="btn" onClick={splitAtPlayhead}>
          <Scissors size={13} /> Split at playhead
        </button>
        <button type="button" className="btn danger" onClick={deleteSelectedClip}>
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </Panel>
  )
}

function Section({ title, onReset, children }: { title: string; onReset: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="section">
      <div className="section-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{title}</span>
        <button
          type="button"
          className="link"
          onClick={(e) => {
            e.stopPropagation()
            onReset()
          }}
        >
          Reset
        </button>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}
