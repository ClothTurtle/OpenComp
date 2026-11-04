const noSelect = (e: Event) => e.preventDefault()

/**
 * Follow a pointer drag that has just started: `onMove` runs on every move until the button is released.
 * Text selection is off for the whole drag, so scrubbing or dragging never highlights the labels it passes.
 */
export function trackDrag(onMove: (e: PointerEvent) => void, onEnd?: (e: PointerEvent) => void) {
  document.body.dataset.dragging = ''
  document.addEventListener('selectstart', noSelect)
  const end = (e: PointerEvent) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    document.removeEventListener('selectstart', noSelect)
    delete document.body.dataset.dragging
    onEnd?.(e)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}
