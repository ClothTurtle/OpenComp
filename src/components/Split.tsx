import { Children, Fragment, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { trackDrag } from '../lib/drag'

const MIN_PANE_PX = 120
const storageKey = (id: string) => `opencomp:layout:${id}`

function loadSizes(id: string, count: number): number[] | null {
  try {
    const sizes = JSON.parse(localStorage.getItem(storageKey(id)) ?? 'null')
    return Array.isArray(sizes) && sizes.length === count ? sizes : null
  } catch {
    return null
  }
}

/** A row or column of panes with draggable dividers. Sizes are relative weights, remembered per `id`. */
export function Split({
  id,
  direction,
  initial,
  children,
}: {
  id: string
  direction: 'horizontal' | 'vertical'
  initial: number[]
  children: ReactNode
}) {
  const panes = Children.toArray(children)
  const [sizes, setSizes] = useState(() => loadSizes(id, panes.length) ?? initial)
  const ref = useRef<HTMLDivElement>(null)
  const horizontal = direction === 'horizontal'

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(sizes))
    } catch {
      // Layout persistence is a convenience only.
    }
  }, [id, sizes])

  const startResize = (i: number) => (e: PointerEvent) => {
    e.preventDefault()
    const rect = ref.current!.getBoundingClientRect()
    const pxPerUnit = (horizontal ? rect.width : rect.height) / sizes.reduce((a, b) => a + b, 0)
    const origin = horizontal ? e.clientX : e.clientY
    const start = [...sizes]
    const pair = start[i] + start[i + 1]
    const min = MIN_PANE_PX / pxPerUnit
    document.body.dataset.resizing = horizontal ? 'x' : 'y'
    trackDrag(
      (ev) => {
        const delta = ((horizontal ? ev.clientX : ev.clientY) - origin) / pxPerUnit
        const a = Math.min(pair - min, Math.max(min, start[i] + delta))
        const next = [...start]
        next[i] = a
        next[i + 1] = pair - a
        setSizes(next)
      },
      () => delete document.body.dataset.resizing,
    )
  }

  return (
    <div ref={ref} className={`split split-${direction}`}>
      {panes.map((pane, i) => (
        <Fragment key={i}>
          {i > 0 && <div className="gutter" onPointerDown={startResize(i - 1)} />}
          <div className="split-pane" style={{ flex: `${sizes[i]} 1 0` }}>
            {pane}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
