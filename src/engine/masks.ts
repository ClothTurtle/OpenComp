// Turns a clip's masks into an alpha image for the renderer. Masks are outlines in normalised layer
// space; feather, expansion, inversion and add/subtract/intersect are applied here with the 2D canvas.
import { MASK_FPS, type Mask, type Point } from '../project'

const sortedKeys = new WeakMap<Record<string, Point[][]>, number[]>()

function frameKeys(frames: Record<string, Point[][]>): number[] {
  let keys = sortedKeys.get(frames)
  if (!keys) {
    keys = Object.keys(frames).map(Number).sort((a, b) => a - b)
    sortedKeys.set(frames, keys)
  }
  return keys
}

/** Which tracked frame applies at a source time: the nearest one at or before it (or the first). */
export function maskFrameAt(mask: Mask, sourceTime: number): number | null {
  if (!mask.frames) return null
  const keys = frameKeys(mask.frames)
  if (!keys.length) return null
  const f = Math.round(sourceTime * MASK_FPS)
  let lo = 0
  let hi = keys.length - 1
  if (f <= keys[0]) return keys[0]
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (keys[mid] <= f) lo = mid
    else hi = mid - 1
  }
  return keys[lo]
}

export function maskShapeAt(mask: Mask, sourceTime: number): Point[][] {
  const frame = maskFrameAt(mask, sourceTime)
  return frame === null ? mask.shape : mask.frames![frame]
}

const setIds = new WeakMap<Mask[], number>()
let nextSetId = 1

/** Changes whenever the masks' rendering would change (edits create new arrays; tracking changes frames). */
export function masksKey(masks: Mask[], sourceTime: number): string {
  let id = setIds.get(masks)
  if (!id) setIds.set(masks, (id = nextSetId++))
  return `${id}:${masks.map((m) => maskFrameAt(m, sourceTime) ?? '').join(',')}`
}

const scratch: HTMLCanvasElement[] = []
function canvas(i: number, w: number, h: number) {
  const c = (scratch[i] ??= document.createElement('canvas'))
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.clearRect(0, 0, w, h)
  return { c, ctx }
}

export function outlinePath(polys: Point[][], w: number, h: number): Path2D {
  const path = new Path2D()
  for (const poly of polys) {
    poly.forEach(([x, y], i) => (i ? path.lineTo(x * w, y * h) : path.moveTo(x * w, y * h)))
    path.closePath()
  }
  return path
}

/** One mask with expansion, feather and inversion applied. */
function renderMask(mask: Mask, sourceTime: number, w: number, h: number, pxScale: number) {
  const shape = canvas(1, w, h)
  const path = outlinePath(maskShapeAt(mask, sourceTime), w, h)
  shape.ctx.fillStyle = '#fff'
  shape.ctx.strokeStyle = '#fff'
  shape.ctx.lineJoin = 'round'
  shape.ctx.fill(path, 'evenodd')
  const e = mask.expansion * pxScale
  if (e !== 0) {
    shape.ctx.lineWidth = Math.abs(e) * 2
    if (e < 0) shape.ctx.globalCompositeOperation = 'destination-out'
    shape.ctx.stroke(path)
  }

  const out = canvas(2, w, h)
  if (mask.inverted) {
    out.ctx.fillStyle = '#fff'
    out.ctx.fillRect(0, 0, w, h)
    out.ctx.globalCompositeOperation = 'destination-out'
  }
  const feather = mask.feather * pxScale
  if (feather > 0.3) out.ctx.filter = `blur(${feather / 2}px)`
  out.ctx.drawImage(shape.c, 0, 0)
  return out.c
}

const COMPOSITE: Record<Mask['mode'], GlobalCompositeOperation> = {
  add: 'source-over',
  subtract: 'destination-out',
  intersect: 'destination-in',
}

/** Alpha image (w x h) of all enabled masks combined, or null when the clip has none. */
export function rasterizeMasks(masks: Mask[], sourceTime: number, w: number, h: number, pxScale: number) {
  const active = masks.filter((m) => m.enabled)
  if (!active.length) return null
  const acc = canvas(0, w, h)
  // Like After Effects: if the first mask subtracts or intersects, it acts on a fully visible layer.
  if (active[0].mode !== 'add') {
    acc.ctx.fillStyle = '#fff'
    acc.ctx.fillRect(0, 0, w, h)
  }
  for (const mask of active) {
    const single = renderMask(mask, sourceTime, w, h, pxScale)
    acc.ctx.globalCompositeOperation = COMPOSITE[mask.mode]
    acc.ctx.globalAlpha = mask.opacity / 100
    acc.ctx.drawImage(single, 0, 0)
  }
  acc.ctx.globalCompositeOperation = 'source-over'
  acc.ctx.globalAlpha = 1
  return acc.c
}
