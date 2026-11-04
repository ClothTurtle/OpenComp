import { useEffect, useState, type RefObject } from 'react'
import { getState, useStore } from './store'

/** The content-box size of an element, kept current with a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

const PLAYING_UPDATE_MS = 125

/**
 * The playhead time for heavy panels: exact while paused, but at most ~8 updates a second during
 * playback, so re-rendering them doesn't steal frames from the preview.
 */
export function useCoarseTime() {
  const [time, setTime] = useState(getState().time)
  useEffect(() => {
    let last = 0
    return useStore.subscribe((s, prev) => {
      if (s.time === prev.time && s.playing === prev.playing) return
      const now = performance.now()
      if (s.playing && now - last < PLAYING_UPDATE_MS) return
      last = now
      setTime(s.time)
    })
  }, [])
  return time
}
