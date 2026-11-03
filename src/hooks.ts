import { useEffect, useState, type RefObject } from 'react'

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
