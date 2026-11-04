// Pure raster/vector helpers for AI masks: binary mask <-> polygons, plus the small amount of
// image analysis the tracker needs. No DOM, so they also run inside the segmentation worker.
import type { Point } from '../project'

/** Outlines of a binary mask (marching squares), in pixel units. Holes come out as separate outlines. */
export function traceContours(mask: Uint8Array, w: number, h: number): Point[][] {
  const on = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] ? 1 : 0)
  // Points live on a doubled grid so edge midpoints are integers.
  const stride = 2 * w + 6
  const key = (X: number, Y: number) => (Y + 2) * stride + (X + 2)
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    adj.get(a)?.push(b) ?? adj.set(a, [b])
    adj.get(b)?.push(a) ?? adj.set(b, [a])
  }

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const c = on(x, y) * 8 + on(x + 1, y) * 4 + on(x + 1, y + 1) * 2 + on(x, y + 1)
      if (c === 0 || c === 15) continue
      const top = key(2 * x + 1, 2 * y)
      const right = key(2 * x + 2, 2 * y + 1)
      const bottom = key(2 * x + 1, 2 * y + 2)
      const left = key(2 * x, 2 * y + 1)
      switch (c) {
        case 1: case 14: link(left, bottom); break
        case 2: case 13: link(bottom, right); break
        case 3: case 12: link(left, right); break
        case 4: case 11: link(top, right); break
        case 6: case 9: link(top, bottom); break
        case 7: case 8: link(left, top); break
        case 5: link(left, bottom); link(top, right); break
        case 10: link(left, top); link(bottom, right); break
      }
    }
  }

  const loops: Point[][] = []
  const seen = new Set<number>()
  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    const loop: Point[] = []
    let prev = -1
    let cur = start
    while (!seen.has(cur)) {
      seen.add(cur)
      loop.push([(cur % stride) / 2 - 1 + 0.5, Math.floor(cur / stride) / 2 - 1 + 0.5])
      const [a, b] = adj.get(cur)!
      const next = a !== prev ? a : b
      prev = cur
      cur = next
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

export function polygonArea(poly: Point[]): number {
  let area = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]
  return Math.abs(area) / 2
}

export function pointInPolygon([x, y]: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Ramer–Douglas–Peucker simplification of a closed outline. */
export function simplify(poly: Point[], tolerance: number): Point[] {
  if (poly.length < 4 || tolerance <= 0) return poly
  const pts = [...poly, poly[0]]
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  // A closed loop's first and last points coincide, so seed with the point farthest from the start.
  let far = 0
  let farD = -1
  for (let i = 1; i < pts.length - 1; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2
    if (d > farD) [far, farD] = [i, d]
  }
  keep[far] = 1
  const stack: [number, number][] = [
    [0, far],
    [far, pts.length - 1],
  ]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let index = -1
    let maxD = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / len
      if (d > maxD) [index, maxD] = [i, d]
    }
    if (index >= 0) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  return pts.slice(0, -1).filter((_, i) => keep[i])
}

export interface VectorizeOptions {
  tolerance: number // simplification, in pixels
  minArea: number // drop specks smaller than this, in square pixels
  largestOnly: boolean // keep only the biggest region (and its holes)
  fillHoles: boolean
}

/** Binary mask -> simplified outlines normalised to 0..1. */
export function vectorize(mask: Uint8Array, w: number, h: number, opts: VectorizeOptions): Point[][] {
  let loops = traceContours(mask, w, h)
    .map((loop) => simplify(loop, opts.tolerance))
    .filter((loop) => loop.length >= 3 && polygonArea(loop) >= opts.minArea)
  // Outlines nested inside another outline an odd number of times are holes.
  const isHole = (loop: Point[]) =>
    loops.filter((other) => other !== loop && pointInPolygon(loop[0], other)).length % 2 === 1
  if (opts.fillHoles) loops = loops.filter((loop) => !isHole(loop))
  if (opts.largestOnly && loops.length > 1) {
    const outer = loops.filter((loop) => !isHole(loop)).sort((a, b) => polygonArea(b) - polygonArea(a))[0]
    loops = loops.filter((loop) => loop === outer || (isHole(loop) && pointInPolygon(loop[0], outer)))
  }
  return loops.map((loop) => loop.map(([x, y]) => [round4(x / w), round4(y / h)] as Point))
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Even-odd scanline fill of normalised outlines into a w x h mask. */
export function rasterize(polys: Point[][], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const xs: number[] = []
  for (let y = 0; y < h; y++) {
    const py = (y + 0.5) / h
    xs.length = 0
    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [x0, y0] = poly[j]
        const [x1, y1] = poly[i]
        if (y0 > py !== y1 > py) xs.push((x0 + ((py - y0) / (y1 - y0)) * (x1 - x0)) * w)
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5))
      const to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5))
      for (let x = from; x <= to; x++) out[y * w + x] = 1
    }
  }
  return out
}

export function maskBounds(mask: Uint8Array, w: number, h: number) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

export function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0
  let union = 0
  for (let i = 0; i < a.length; i++) {
    inter += a[i] & b[i]
    union += a[i] | b[i]
  }
  return union ? inter / union : 0
}

/**
 * Up to `count` well-separated points deep inside the mask (peaks of a distance transform), in
 * pixel units. These make good "this object" prompts for the segmentation model.
 */
export function interiorPoints(mask: Uint8Array, w: number, h: number, count: number): Point[] {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      const up = y > 0 ? d[i - w] + 1 : 0
      const left = x > 0 ? d[i - 1] + 1 : 0
      d[i] = Math.min(d[i], up, left)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      const down = y < h - 1 ? d[i + w] + 1 : 0
      const right = x < w - 1 ? d[i + 1] + 1 : 0
      d[i] = Math.min(d[i], down, right)
    }
  const points: Point[] = []
  for (let n = 0; n < count; n++) {
    let best = -1
    let bestD = 0
    for (let i = 0; i < d.length; i++) if (d[i] > bestD) [best, bestD] = [i, d[i]]
    if (best < 0 || (n > 0 && bestD < 2)) break
    const bx = best % w
    const by = Math.floor(best / w)
    points.push([bx + 0.5, by + 0.5])
    // Suppress the neighbourhood so the next point lands elsewhere in the object.
    const r = Math.max(bestD * 1.5, 3)
    for (let y = Math.max(0, Math.floor(by - r)); y < Math.min(h, by + r); y++)
      for (let x = Math.max(0, Math.floor(bx - r)); x < Math.min(w, bx + r); x++) d[y * w + x] = 0
  }
  return points
}

/**
 * How far the content inside `box` moved between two grayscale frames, by block matching
 * (sum of absolute differences). Returns the shift in pixels.
 */
export function estimateShift(
  prev: Uint8Array,
  cur: Uint8Array,
  w: number,
  h: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  maxShift: number,
): Point {
  const step = Math.max(1, Math.floor(Math.max(box.x1 - box.x0, box.y1 - box.y0) / 48))
  let best: Point = [0, 0]
  let bestCost = Infinity
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let cost = 0
      let n = 0
      for (let y = box.y0; y <= box.y1; y += step) {
        const ty = y + dy
        if (ty < 0 || ty >= h) continue
        for (let x = box.x0; x <= box.x1; x += step) {
          const tx = x + dx
          if (tx < 0 || tx >= w) continue
          cost += Math.abs(prev[y * w + x] - cur[ty * w + tx])
          n++
        }
      }
      // Slight preference for small moves breaks ties on flat regions.
      const score = n ? cost / n + 0.05 * Math.hypot(dx, dy) : Infinity
      if (score < bestCost) [best, bestCost] = [[dx, dy], score]
    }
  }
  return best
}

export const shiftPolygons = (polys: Point[][], dx: number, dy: number): Point[][] =>
  polys.map((poly) => poly.map(([x, y]) => [x + dx, y + dy] as Point))
