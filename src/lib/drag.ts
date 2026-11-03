/** Follow a pointer drag that has just started: `onMove` runs on every move until the button is released. */
export function trackDrag(onMove: (e: PointerEvent) => void, onEnd?: (e: PointerEvent) => void) {
  const end = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    onEnd?.(e)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}
