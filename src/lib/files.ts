export const MEDIA_ACCEPT = 'video/*,audio/*,image/*,.mkv,.mov'

/** Drag-and-drop type used when dragging an asset from the Project panel to the timeline. */
export const ASSET_DRAG_TYPE = 'application/x-opencomp-asset'

/** Open the native file picker. Resolves with [] if the user cancels. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple })
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

/** Save a blob through the browser's normal download flow. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: filename }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const fileSafe = (name: string) => name.replace(/[^\w\- ]+/g, '').trim() || 'opencomp'
