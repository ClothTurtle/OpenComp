import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Brush,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Italic,
  MousePointerClick,
  PenTool,
  RectangleHorizontal,
  Scissors,
  Trash2,
  X,
} from 'lucide-react'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useTracking, nextAlternative, trackMask } from '../ai/maskTools'
import {
  applyEffect,
  deleteSelectedClip,
  duplicateClip,
  moveEffect,
  removeEffect,
  removeMask,
  setClipSpeed,
  splitAtPlayhead,
  updateClip,
  updateEffect,
  updateMask,
} from '../actions'
import { EFFECT_GROUPS, EFFECT_MAP, type ParamDef } from '../effects'
import { seek } from '../engine/playback'
import { useCoarseTime } from '../hooks'
import { keyIndexAt, readProp, removeKeyframe, resolveClip, setKeyframe, toggleAnimation, writeProp } from '../lib/keyframes'
import { timecode } from '../lib/time'
import { clipEnd, layerTime } from '../lib/timeline'
import {
  BLEND_MODES,
  DEFAULT_AUDIO,
  DEFAULT_COLOR,
  DEFAULT_TRANSFORM,
  clipKind,
  clipLabel,
  type BlendMode,
  type Clip,
  type ColorGrade,
  type Mask,
  type TextStyle,
  type Transform,
} from '../project'
import { useEnabled, useSettings } from '../settings'
import { setState, useStore, type Tool } from '../store'
import type { ToolFocus, ToolSection } from '../toolWindows'
import { Panel } from './Panel'
import { PropertyRow } from './PropertyRow'
import { IconButton, KindIcon, Toggle } from './ui'

const TRANSFORM_FIELDS: [keyof Transform, string, number, number, number, string][] = [
  ['x', 'Position X', -4000, 4000, 1, 'px'],
  ['y', 'Position Y', -4000, 4000, 1, 'px'],
  ['scale', 'Scale', 0, 400, 1, '%'],
  ['rotation', 'Rotation', -360, 360, 1, '°'],
  ['opacity', 'Opacity', 0, 100, 1, '%'],
]

const COLOR_FIELDS: [keyof ColorGrade, string, number, number, number, string?][] = [
  ['exposure', 'Exposure', -3, 3, 0.05, 'EV'],
  ['contrast', 'Contrast', -100, 100, 1],
  ['highlights', 'Highlights', -100, 100, 1],
  ['shadows', 'Shadows', -100, 100, 1],
  ['saturation', 'Saturation', -100, 100, 1],
  ['temperature', 'Temperature', -100, 100, 1],
  ['tint', 'Tint', -100, 100, 1],
]

const FONTS = [
  'Segoe UI, Inter, Helvetica, Arial, sans-serif',
  'Georgia, Times New Roman, serif',
  'Impact, Haettenschweiler, sans-serif',
  'Arial Black, Arial, sans-serif',
  'Courier New, monospace',
  'Comic Sans MS, cursive',
  'Trebuchet MS, sans-serif',
]

/** Properties of the selected clip (After Effects' "Effect Controls"). */
export function Inspector() {
  const clip = useStore((s) => s.project.clips.find((c) => c.id === s.selectedClipId))
  const assets = useStore((s) => s.project.assets)
  const fps = useStore((s) => s.project.settings.fps)
  const duplicateOn = useEnabled('duplicate')

  if (!clip) {
    return (
      <Panel title="Properties">
        <div className="empty-note">
          Select a clip on the timeline to adjust its position, colour, effects, masks and sound.
          <button type="button" className="link" onClick={() => setState({ dialog: 'comp' })}>
            Composition settings…
          </button>
        </div>
      </Panel>
    )
  }

  const kind = clipKind(clip, assets)
  return (
    <Panel title="Properties">
      <div className="inspector-head">
        {kind && <KindIcon kind={kind} size={15} />}
        <div>
          <input
            className="name-input"
            value={clip.name ?? ''}
            placeholder={clipLabel({ ...clip, name: undefined }, assets)}
            aria-label="Clip name"
            onChange={(e) => updateClip(clip.id, (c) => (c.name = e.target.value || undefined), `${clip.id}:name`)}
          />
          <span className="muted">
            {timecode(clip.start, fps)} – {timecode(clipEnd(clip), fps)}
          </span>
        </div>
      </div>

      <ClipControls clip={clip} />

      <div className="inspector-actions">
        <button type="button" className="btn" onClick={splitAtPlayhead}>
          <Scissors size={13} /> Split
        </button>
        {duplicateOn && (
          <button type="button" className="btn" onClick={() => duplicateClip()}>
            <Copy size={13} /> Duplicate
          </button>
        )}
        <button type="button" className="btn danger" onClick={deleteSelectedClip}>
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </Panel>
  )
}

/** In a tool window, sections show their controls without the collapsible header. */
const FlatSections = createContext(false)

/**
 * A clip's controls: all of them (the Properties panel), or just the part a tool window shows
 * (`only`: one section, or one effect).
 */
export function ClipControls({ clip, only }: { clip: Clip; only?: ToolFocus }) {
  const assets = useStore((s) => s.project.assets)
  const time = useCoarseTime()
  const disabled = useSettings((s) => s.disabledFeatures)
  const on = (id: string) => !disabled.includes(id)

  const kind = clipKind(clip, assets)
  const visual = kind !== 'audio'
  const audible = kind === 'video' || kind === 'audio'
  const showBlend = visual && kind !== 'adjustment' && on('blend-modes')
  const showSpeed = audible && on('speed')
  const lt = layerTime(clip, time)
  const resolved = resolveClip(clip, lt)
  const toTimeline = (kt: number) => kt + clip.start - clip.in / (clip.speed / 100)
  const edit = (key: string, change: (c: Clip) => void) => updateClip(clip.id, change, `${clip.id}:${key}`)

  const available: Record<ToolSection, boolean> = {
    text: !!clip.text && on('text-layers'),
    layer: showBlend || showSpeed,
    transform: visual,
    color: visual,
    masks: visual && on('masks'),
    audio: audible,
  }
  const show = (section: ToolSection) => available[section] && (!only || (only.kind === 'section' && only.section === section))
  if (only?.kind === 'section' && !available[only.section]) {
    return <div className="empty-note">This clip has no {only.section === 'layer' ? 'blend or speed' : only.section} controls.</div>
  }

  /** A numeric row wired to keyframes: shows the animated value at the playhead and edits keyframes when animated. */
  const prop = (path: string, label: string, min: number, max: number, step: number, unit: string | undefined, def: number) => {
    const keys = clip.keyframes[path]
    const animated = !!keys?.length
    const value = readProp(resolved, path) ?? def
    const atKey = keyIndexAt(keys, lt) >= 0
    const prev = keys?.filter((k) => k.t < lt - 1e-3).at(-1)
    const next = keys?.find((k) => k.t > lt + 1e-3)
    return (
      <PropertyRow
        key={path}
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        defaultValue={def}
        onChange={(v) => edit(path, (c) => (animated ? setKeyframe(c, path, lt, v) : writeProp(c, path, v)))}
        anim={
          on('keyframes')
            ? {
                animated,
                atKey,
                toggle: () => updateClip(clip.id, (c) => toggleAnimation(c, path, lt)),
                key: () => updateClip(clip.id, (c) => (atKey ? removeKeyframe(c, path, lt) : setKeyframe(c, path, lt, value))),
                prev: prev && (() => seek(toTimeline(prev.t))),
                next: next && (() => seek(toTimeline(next.t))),
              }
            : undefined
        }
      />
    )
  }

  return (
    <FlatSections.Provider value={!!only}>
      {show('text') && <TextSection text={clip.text!} edit={edit} sizeRow={prop('text.size', 'Size', 8, 600, 1, 'px', 96)} />}

      {clip.solid && !only && (
        <Section title="Solid">
          <ColorRow label="Colour" value={clip.solid} onChange={(v) => edit('solid', (c) => (c.solid = v))} />
        </Section>
      )}

      {show('layer') && (
        <Section title="Layer">
          {showBlend && (
            <SelectRow
              label="Blend mode"
              value={clip.blendMode}
              options={BLEND_MODES}
              onChange={(v) => edit('blend', (c) => (c.blendMode = v as BlendMode))}
            />
          )}
          {showSpeed && (
            <PropertyRow label="Speed" value={clip.speed} min={10} max={400} step={1} unit="%" defaultValue={100} onChange={(v) => setClipSpeed(clip.id, v)} />
          )}
        </Section>
      )}

      {show('transform') && (
        <Section title={kind === 'adjustment' ? 'Opacity' : 'Transform'}>
          {TRANSFORM_FIELDS.filter(([key]) => kind !== 'adjustment' || key === 'opacity').map(([key, label, min, max, step, unit]) =>
            prop(`transform.${key}`, label, min, max, step, unit, DEFAULT_TRANSFORM[key]),
          )}
        </Section>
      )}

      {show('color') && (
        <Section title="Color">
          {COLOR_FIELDS.map(([key, label, min, max, step, unit]) => prop(`color.${key}`, label, min, max, step, unit, DEFAULT_COLOR[key]))}
        </Section>
      )}

      {visual && (!only || only.kind === 'effect') && <EffectsSection clip={clip} prop={prop} enabled={on} onlyFx={only?.kind === 'effect' ? only.fxId : undefined} />}

      {show('masks') && <MasksSection clip={clip} enabled={on} />}

      {show('audio') && (
        <Section title="Audio">
          {prop('audio.volume', 'Volume', 0, 200, 1, '%', 100)}
          {on('audio-pan') && prop('audio.pan', 'Pan', -100, 100, 1, undefined, 0)}
          {on('audio-fades') && (
            <>
              <PropertyRow label="Fade in" value={clip.audio.fadeIn} min={0} max={10} step={0.05} unit="s" defaultValue={0} onChange={(v) => edit('fadeIn', (c) => (c.audio.fadeIn = v))} />
              <PropertyRow label="Fade out" value={clip.audio.fadeOut} min={0} max={10} step={0.05} unit="s" defaultValue={0} onChange={(v) => edit('fadeOut', (c) => (c.audio.fadeOut = v))} />
            </>
          )}
          {on('audio-eq') &&
            (['low', 'mid', 'high'] as const).map((band) =>
              prop(`audio.${band}`, `EQ ${band}`, -18, 18, 0.5, 'dB', DEFAULT_AUDIO[band]),
            )}
        </Section>
      )}
    </FlatSections.Provider>
  )
}

type PropFn = (path: string, label: string, min: number, max: number, step: number, unit: string | undefined, def: number) => ReactNode

function TextSection({ text, edit, sizeRow }: { text: TextStyle; edit: (key: string, change: (c: Clip) => void) => void; sizeRow: ReactNode }) {
  const set = <K extends keyof TextStyle>(key: K, v: TextStyle[K]) => edit(`text.${key}`, (c) => (c.text = { ...c.text!, [key]: v }))
  return (
    <Section title="Text">
      <textarea className="text-input" rows={3} value={text.text} onChange={(e) => set('text', e.target.value)} aria-label="Text" />
      <div className="text-tools">
        <select value={FONTS.includes(text.font) ? text.font : ''} onChange={(e) => set('font', e.target.value)} aria-label="Font">
          {!FONTS.includes(text.font) && <option value="">{text.font}</option>}
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f.split(',')[0]}
            </option>
          ))}
        </select>
        <input type="color" value={text.color} onChange={(e) => set('color', e.target.value)} aria-label="Text colour" title="Text colour" />
        <IconButton icon={Bold} title="Bold" active={text.bold} onClick={() => set('bold', !text.bold)} />
        <IconButton icon={Italic} title="Italic" active={text.italic} onClick={() => set('italic', !text.italic)} />
        <IconButton icon={AlignLeft} title="Align left" active={text.align === 'left'} onClick={() => set('align', 'left')} />
        <IconButton icon={AlignCenter} title="Centre" active={text.align === 'center'} onClick={() => set('align', 'center')} />
        <IconButton icon={AlignRight} title="Align right" active={text.align === 'right'} onClick={() => set('align', 'right')} />
      </div>
      {sizeRow}
      <PropertyRow label="Outline" value={text.strokeWidth} min={0} max={30} step={1} unit="px" defaultValue={0} onChange={(v) => set('strokeWidth', v)} />
      <div className="row-line">
        <ColorRow label="Outline colour" value={text.strokeColor} onChange={(v) => set('strokeColor', v)} />
      </div>
      <CheckRow label="Shadow" value={text.shadow} onChange={(v) => set('shadow', v)} />
      <CheckRow label="Background box" value={text.box} onChange={(v) => set('box', v)} />
      {text.box && <ColorRow label="Box colour" value={text.boxColor} onChange={(v) => set('boxColor', v)} />}
    </Section>
  )
}

function EffectsSection({ clip, prop, enabled, onlyFx }: { clip: Clip; prop: PropFn; enabled: (id: string) => boolean; onlyFx?: string }) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  if (onlyFx && !clip.effects.some((fx) => fx.id === onlyFx)) return <div className="empty-note">This effect was removed from the clip.</div>
  const toggleOpen = (id: string) =>
    setClosed((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const paramRow = (fxId: string, p: ParamDef, value: unknown) => {
    const set = (v: unknown) => updateEffect(clip.id, fxId, (fx) => (fx.params[p.key] = v as never), `${fxId}:${p.key}`)
    if (p.type === 'number') return prop(`fx.${fxId}.${p.key}`, p.label, p.min!, p.max!, p.step!, p.unit, p.default as number)
    if (p.type === 'color') return <ColorRow key={p.key} label={p.label} value={String(value ?? p.default)} onChange={set} />
    if (p.type === 'boolean') return <CheckRow key={p.key} label={p.label} value={Boolean(value ?? p.default)} onChange={set} />
    return <SelectRow key={p.key} label={p.label} value={String(value ?? p.default)} options={p.options!} onChange={set} />
  }

  return (
    <Section title={`Effects${clip.effects.length ? ` (${clip.effects.length})` : ''}`}>
      {clip.effects.map((fx, i) => {
        const def = EFFECT_MAP.get(fx.type)
        if (!def || (onlyFx && fx.id !== onlyFx)) return null
        const open = !closed.has(fx.id)
        const off = !enabled(`fx:${fx.type}`)
        return (
          <div key={fx.id} className={`fx ${fx.enabled && !off ? '' : 'disabled'}`}>
            <div className="fx-head">
              <Toggle on={fx.enabled} label={def.name} onChange={(v) => updateEffect(clip.id, fx.id, (f) => (f.enabled = v))} />
              <button type="button" className="fx-name" onClick={() => toggleOpen(fx.id)}>
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {def.name}
                {off && <small> (feature off)</small>}
              </button>
              <IconButton icon={ArrowUp} title="Move up" disabled={i === 0} onClick={() => moveEffect(clip.id, fx.id, -1)} />
              <IconButton icon={ArrowDown} title="Move down" disabled={i === clip.effects.length - 1} onClick={() => moveEffect(clip.id, fx.id, 1)} />
              <IconButton icon={X} title="Remove effect" onClick={() => removeEffect(clip.id, fx.id)} />
            </div>
            {open && <div className="fx-body">{def.params.map((p) => paramRow(fx.id, p, fx.params[p.key]))}</div>}
          </div>
        )
      })}
      {!onlyFx && (
        <select
          className="add-effect"
          value=""
          aria-label="Add effect"
          onChange={(e) => e.target.value && applyEffect(e.target.value, clip.id)}
        >
          <option value="">+ Add effect…</option>
          {EFFECT_GROUPS.map(([cat, defs]) => {
            const items = defs.filter((e) => enabled(`fx:${e.type}`))
            return items.length ? (
              <optgroup key={cat} label={cat}>
                {items.map((e) => (
                  <option key={e.type} value={e.type}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ) : null
          })}
        </select>
      )}
    </Section>
  )
}

const MASK_TOOLS: [Tool, string, typeof Brush, string][] = [
  ['brush-mask', 'AI brush (B): paint over an object', Brush, 'ai-mask-brush'],
  ['smart-mask', 'Smart click (A): click an object', MousePointerClick, 'ai-smart-mask'],
  ['rect-mask', 'Rectangle (Q)', RectangleHorizontal, 'shape-masks'],
  ['ellipse-mask', 'Ellipse (E)', Circle, 'shape-masks'],
  ['pen-mask', 'Pen (G): click points, click the first point to close', PenTool, 'shape-masks'],
]

function MasksSection({ clip, enabled }: { clip: Clip; enabled: (id: string) => boolean }) {
  const selectedMaskId = useStore((s) => s.selectedMaskId)
  const tool = useStore((s) => s.tool)
  const tracking = useTracking()
  const [error, setError] = useState('')
  const isVideo = useStore((s) => s.project.assets.find((a) => a.id === clip.assetId)?.kind === 'video')

  const track = (mask: Mask, dir: 1 | -1) => {
    setError('')
    trackMask(clip.id, mask.id, dir).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <Section title={`Masks${clip.masks.length ? ` (${clip.masks.length})` : ''}`}>
      <div className="mask-tools">
        {MASK_TOOLS.filter(([, , , feature]) => enabled(feature)).map(([t, title, Icon]) => (
          <IconButton key={t} icon={Icon} title={title} active={tool === t} onClick={() => setState({ tool: tool === t ? 'select' : t })} />
        ))}
      </div>
      {(tool === 'brush-mask' || tool === 'smart-mask') && (
        <p className="hint">
          {tool === 'brush-mask'
            ? 'Paint over the object in the preview. Hold Alt to paint areas to leave out. Shift starts a new mask.'
            : 'Click the object in the preview. Alt-click to exclude an area, Shift-click for a new mask, Tab for another interpretation.'}
        </p>
      )}
      {clip.masks.map((m) => {
        const selected = m.id === selectedMaskId
        const isTracking = tracking.maskId === m.id
        return (
          <div key={m.id} className={`mask-item ${selected ? 'selected' : ''}`}>
            <div className="mask-head" onClick={() => setState({ selectedMaskId: selected ? null : m.id })}>
              <Toggle on={m.enabled} label={m.name} onChange={(v) => updateMask(clip.id, m.id, (x) => (x.enabled = v))} />
              <span className="mask-name">{m.name}</span>
              <span className="badge">{m.kind === 'ai' ? (m.frames ? `AI · tracked ${Object.keys(m.frames).length}f` : 'AI') : m.kind}</span>
              <IconButton icon={X} title="Delete mask" onClick={() => removeMask(clip.id, m.id)} />
            </div>
            {selected && (
              <div className="mask-body">
                <SelectRow label="Mode" value={m.mode} options={['add', 'subtract', 'intersect']} onChange={(v) => updateMask(clip.id, m.id, (x) => (x.mode = v as Mask['mode']))} />
                <CheckRow label="Inverted (remove the object)" value={m.inverted} onChange={(v) => updateMask(clip.id, m.id, (x) => (x.inverted = v))} />
                <PropertyRow label="Feather" value={m.feather} min={0} max={200} step={1} unit="px" defaultValue={0} onChange={(v) => updateMask(clip.id, m.id, (x) => (x.feather = v), `${m.id}:feather`)} />
                <PropertyRow label="Expansion" value={m.expansion} min={-100} max={100} step={1} unit="px" defaultValue={0} onChange={(v) => updateMask(clip.id, m.id, (x) => (x.expansion = v), `${m.id}:expansion`)} />
                <PropertyRow label="Opacity" value={m.opacity} min={0} max={100} step={1} unit="%" defaultValue={100} onChange={(v) => updateMask(clip.id, m.id, (x) => (x.opacity = v), `${m.id}:opacity`)} />
                {m.kind === 'ai' && (
                  <div className="mask-ai">
                    <button type="button" className="btn small" onClick={nextAlternative} title="Tab">
                      Other interpretation
                    </button>
                    {isVideo && enabled('ai-mask-tracking') && (
                      <>
                        <button type="button" className="btn small" disabled={!!tracking.maskId} onClick={() => track(m, -1)}>
                          ◀ Track back
                        </button>
                        <button type="button" className="btn small primary" disabled={!!tracking.maskId} onClick={() => track(m, 1)}>
                          Track forward ▶
                        </button>
                        {m.frames && (
                          <button type="button" className="link" onClick={() => updateMask(clip.id, m.id, (x) => delete x.frames)}>
                            Clear tracking
                          </button>
                        )}
                      </>
                    )}
                    {isTracking && (
                      <div className="track-progress">
                        <div className="progress">
                          <div style={{ width: `${tracking.progress * 100}%` }} />
                        </div>
                        <button type="button" className="link" onClick={tracking.cancel}>
                          Stop
                        </button>
                      </div>
                    )}
                    {error && <p className="error">{error}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  if (useContext(FlatSections)) return <div className="section-body">{children}</div>
  return (
    <div className="section">
      <button type="button" className="section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{title}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}
