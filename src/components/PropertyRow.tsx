import { ChevronLeft, ChevronRight, Diamond, Timer } from 'lucide-react'
import { useRef, useState, type PointerEvent } from 'react'
import { trackDrag } from '../lib/drag'
import { clamp } from '../lib/time'

/** Keyframe controls for an animatable property (the After Effects stopwatch). */
export interface AnimControls {
  animated: boolean
  atKey: boolean
  toggle: () => void // stopwatch: start/stop animating
  key: () => void // add/remove a keyframe at the playhead
  prev?: () => void
  next?: () => void
}

interface Props {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  defaultValue: number
  onChange: (value: number) => void
  anim?: AnimControls
}

/** Label, slider and an editable number. Double-click the label to reset. */
export function PropertyRow({ label, value, min, max, step, unit, defaultValue, onChange, anim }: Props) {
  return (
    <div className={`prop-row ${anim ? 'has-anim' : ''}`}>
      {anim && (
        <span className="anim">
          <button
            type="button"
            className={`anim-btn ${anim.animated ? 'on' : ''}`}
            title={anim.animated ? 'Stop animating (keeps the current value)' : 'Animate this property'}
            onClick={anim.toggle}
          >
            <Timer size={12} />
          </button>
          {anim.animated && (
            <>
              <button type="button" className="anim-btn" title="Previous keyframe" disabled={!anim.prev} onClick={anim.prev}>
                <ChevronLeft size={11} />
              </button>
              <button type="button" className={`anim-btn ${anim.atKey ? 'on' : ''}`} title={anim.atKey ? 'Remove keyframe' : 'Add keyframe'} onClick={anim.key}>
                <Diamond size={10} />
              </button>
              <button type="button" className="anim-btn" title="Next keyframe" disabled={!anim.next} onClick={anim.next}>
                <ChevronRight size={11} />
              </button>
            </>
          )}
        </span>
      )}
      <label title="Double-click to reset" onDoubleClick={() => onChange(defaultValue)}>
        {label}
      </label>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <ScrubNumber value={value} min={min} max={max} step={step} unit={unit} onChange={onChange} />
    </div>
  )
}

/** After Effects-style value: drag left/right to change it (Shift = faster), click to type. */
function ScrubNumber({ value, min, max, step, unit, onChange }: Omit<Props, 'label' | 'defaultValue' | 'anim'>) {
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)
  const decimals = step < 1 ? (step < 0.1 ? 2 : 1) : 0
  const set = (v: number) => onChange(clamp(Number(v.toFixed(decimals)), min, max))

  if (editing) {
    return (
      <input
        className="scrub-input"
        autoFocus
        defaultValue={value.toFixed(decimals)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const v = parseFloat(e.target.value)
          if (!cancelled.current && Number.isFinite(v)) set(v)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            cancelled.current = true
            e.currentTarget.blur()
          }
        }}
      />
    )
  }

  const onPointerDown = (e: PointerEvent) => {
    const startX = e.clientX
    const startValue = value
    let dragged = false
    trackDrag(
      (ev) => {
        const dx = ev.clientX - startX
        if (!dragged && Math.abs(dx) < 3) return
        dragged = true
        set(startValue + dx * step * (ev.shiftKey ? 10 : 1))
      },
      () => {
        if (dragged) return
        cancelled.current = false
        setEditing(true)
      },
    )
  }

  return (
    <span className="scrub" title="Drag to change · click to type" onPointerDown={onPointerDown}>
      {value.toFixed(decimals)}
      {unit && <small>{unit}</small>}
    </span>
  )
}
