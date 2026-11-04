// Main-thread side of the segmentation worker: model loading status, and turning clicks/strokes on a
// clip into mask outlines. The model downloads on first use (about 15 MB for "fast") and is cached.
import { create } from 'zustand'
import { pointInPolygon } from '../lib/contours'
import type { Point } from '../project'
import { getSettings } from '../settings'
import type { Candidate, WorkerRequest, WorkerResponse } from './segment.worker'

interface AIStatus {
  model: 'idle' | 'loading' | 'ready' | 'error'
  progress: number // 0..1 while downloading
  device: string
  busy: boolean
  error: string
}

export const useSegmenter = create<AIStatus>()(() => ({ model: 'idle', progress: 0, device: '', busy: false, error: '' }))

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (msg: WorkerResponse) => void>()
const files = new Map<string, { loaded: number; total: number }>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data
    if (msg.type === 'progress') {
      files.set(msg.file, { loaded: msg.loaded, total: msg.total })
      const all = [...files.values()]
      const total = all.reduce((a, f) => a + f.total, 0)
      useSegmenter.setState({ model: 'loading', progress: total ? all.reduce((a, f) => a + f.loaded, 0) / total : 0 })
      return
    }
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
  }
  return worker
}

type Request = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

function call(request: Request, transfer: Transferable[] = []): Promise<WorkerResponse> {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    getWorker().postMessage({ ...request, id }, transfer)
  })
}

/** Download/initialise the model now (shows progress), so the first click is fast. */
export async function warmUp() {
  if (useSegmenter.getState().model === 'ready') return
  useSegmenter.setState({ model: 'loading', error: '' })
  const res = await call({ type: 'load', quality: getSettings().maskModel })
  if (res.type === 'ready') useSegmenter.setState({ model: 'ready', device: res.device, progress: 1 })
  else if (res.type === 'error') {
    useSegmenter.setState({ model: 'error', error: res.message })
    throw new Error(res.message)
  }
}

/**
 * Segment one frame. `frameKey` identifies the frame; `getImage` is only called when the worker
 * hasn't seen that frame yet. Points are normalised (0..1) with a label (1 include, 0 exclude).
 */
export async function segment(
  frameKey: string,
  getImage: () => ImageData,
  points: [number, number, 0 | 1][],
): Promise<Candidate[]> {
  const s = getSettings()
  useSegmenter.setState({ busy: true })
  try {
    await warmUp()
    const vectorizeOpts = { tolerance: s.maskSmoothing, minArea: 24, largestOnly: false, fillHoles: false }
    const request = (image?: ImageData) => {
      const w = image?.width ?? lastSize.get(frameKey)?.[0] ?? 1
      const h = image?.height ?? lastSize.get(frameKey)?.[1] ?? 1
      return call(
        {
          type: 'segment',
          quality: s.maskModel,
          key: `${s.maskModel}:${frameKey}`,
          image: image && { data: image.data, width: image.width, height: image.height },
          points: points.map(([x, y, label]) => [x * w, y * h, label]),
          vectorize: vectorizeOpts,
        },
        image ? [image.data.buffer] : [],
      )
    }
    let res = lastSize.has(frameKey) ? await request() : await request(remember(frameKey, getImage()))
    if (res.type === 'needImage') res = await request(remember(frameKey, getImage()))
    if (res.type === 'error') throw new Error(res.message)
    if (res.type !== 'result') return []
    return res.candidates
  } finally {
    useSegmenter.setState({ busy: false })
  }
}

const lastSize = new Map<string, [number, number]>()
function remember(frameKey: string, image: ImageData) {
  lastSize.set(frameKey, [image.width, image.height])
  if (lastSize.size > 50) lastSize.delete(lastSize.keys().next().value!)
  return image
}

/**
 * Rank candidates: the model's confidence, plus how well each one agrees with what the user asked
 * for (includes every "include" point, excludes every "exclude" point), with a nudge away from
 * masks that cover most of the frame (usually "the background", rarely what was meant).
 */
export function rankCandidates(candidates: Candidate[], points: [number, number, 0 | 1][]): Candidate[] {
  const agree = (c: Candidate) => {
    if (!points.length) return 0
    const inside = (p: Point) => c.polygons.filter((poly) => pointInPolygon(p, poly)).length % 2 === 1
    return points.filter(([x, y, label]) => inside([x, y]) === (label === 1)).length / points.length
  }
  return candidates
    .filter((c) => c.polygons.length)
    .map((c) => ({ c, rank: agree(c) * 2 + c.score - Math.max(0, c.area - 0.6) }))
    .sort((a, b) => b.rank - a.rank)
    .map(({ c }) => c)
}

/** Draw a video/image frame scaled so its longest side is at most `maxSide`. */
export function frameImage(source: CanvasImageSource, width: number, height: number, maxSide = 1024): ImageData {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}
