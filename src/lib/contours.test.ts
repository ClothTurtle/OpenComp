import { describe, expect, it } from 'vitest'
import { estimateShift, interiorPoints, iou, polygonArea, rasterize, simplify, traceContours, vectorize } from './contours'
import { readProp, resolveClip, sample, setKeyframe, toggleAnimation } from './keyframes'
import { newClip, type Point } from '../project'

const square: Point[][] = [
  [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.75],
    [0.25, 0.75],
  ],
]

describe('contours', () => {
  it('rasterizes and traces a square back to the same area', () => {
    const mask = rasterize(square, 40, 40)
    expect(mask.reduce((a, b) => a + b, 0)).toBe(400)
    const loops = traceContours(mask, 40, 40)
    expect(loops).toHaveLength(1)
    expect(polygonArea(loops[0])).toBeGreaterThan(380)
    expect(polygonArea(loops[0])).toBeLessThan(420)
  })

  it('vectorizes to a simple normalised outline', () => {
    const polys = vectorize(rasterize(square, 64, 64), 64, 64, { tolerance: 1, minArea: 4, largestOnly: false, fillHoles: false })
    expect(polys).toHaveLength(1)
    expect(polys[0].length).toBeLessThanOrEqual(8) // a square needs only its corners (plus bevels)
    expect(iou(rasterize(polys, 64, 64), rasterize(square, 64, 64))).toBeGreaterThan(0.9)
  })

  it('keeps holes, or fills them on request', () => {
    const ring: Point[][] = [...square, [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]]
    const mask = rasterize(ring, 50, 50)
    expect(mask[25 * 50 + 25]).toBe(0) // centre is a hole
    const opts = { tolerance: 1, minArea: 4, largestOnly: false, fillHoles: false }
    expect(vectorize(mask, 50, 50, opts)).toHaveLength(2)
    expect(vectorize(mask, 50, 50, { ...opts, fillHoles: true })).toHaveLength(1)
  })

  it('drops small specks and keeps the largest region', () => {
    const polys: Point[][] = [...square, [[0.9, 0.9], [0.95, 0.9], [0.95, 0.95]]]
    const out = vectorize(rasterize(polys, 60, 60), 60, 60, { tolerance: 1, minArea: 1, largestOnly: true, fillHoles: false })
    expect(out).toHaveLength(1)
  })

  it('simplifies a straight line of points down to its ends', () => {
    const line: Point[] = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 3]]
    expect(simplify(line, 0.5)).toHaveLength(4)
  })

  it('finds a point deep inside an object', () => {
    const mask = rasterize(square, 40, 40)
    const [[x, y]] = interiorPoints(mask, 40, 40, 1)
    expect(Math.abs(x - 20)).toBeLessThan(3)
    expect(Math.abs(y - 20)).toBeLessThan(3)
  })

  it('estimates how far a pattern moved', () => {
    const w = 64
    const frame = (ox: number, oy: number) => {
      const g = new Uint8Array(w * w)
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) g[y * w + x] = ((x - ox) * 7 + (y - oy) * 13) % 256 > 128 ? 255 : 0
      return g
    }
    const box = { x0: 20, y0: 20, x1: 40, y1: 40 }
    expect(estimateShift(frame(0, 0), frame(3, -2), w, w, box, 6)).toEqual([3, -2])
  })
})

describe('keyframes', () => {
  it('interpolates linearly and holds at the ends', () => {
    const keys = [
      { t: 0, v: 0, ease: 'linear' as const },
      { t: 2, v: 100, ease: 'linear' as const },
    ]
    expect(sample(keys, -1)).toBe(0)
    expect(sample(keys, 1)).toBe(50)
    expect(sample(keys, 5)).toBe(100)
  })

  it('resolves animated properties without touching the original clip', () => {
    const clip = newClip({ trackId: 't', start: 0, duration: 5 })
    setKeyframe(clip, 'transform.opacity', 0, 0, 'linear')
    setKeyframe(clip, 'transform.opacity', 1, 100, 'linear')
    expect(resolveClip(clip, 0.5).transform.opacity).toBe(50)
    expect(clip.transform.opacity).toBe(100)
  })

  it('toggling animation off keeps the current value', () => {
    const clip = newClip({ trackId: 't', start: 0, duration: 5 })
    setKeyframe(clip, 'transform.x', 0, 0, 'linear')
    setKeyframe(clip, 'transform.x', 2, 200, 'linear')
    toggleAnimation(clip, 'transform.x', 1)
    expect(clip.keyframes['transform.x']).toBeUndefined()
    expect(readProp(clip, 'transform.x')).toBe(100)
  })
})
