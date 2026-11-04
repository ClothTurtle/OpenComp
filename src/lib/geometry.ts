import type { Point, Transform } from '../project'

/** Where a layer lands in the comp: centre and size in comp pixels, rotation in radians. */
export interface Geometry {
  cx: number
  cy: number
  w: number
  h: number
  rot: number
}

/**
 * Media is first fitted inside the frame (like "fit to comp"), then the clip's transform applies.
 * Generated layers (text, solids) pass fit = false: their size is already in comp pixels.
 */
export function layerGeometry(
  t: Transform,
  srcW: number,
  srcH: number,
  compW: number,
  compH: number,
  fit = true,
): Geometry {
  const w = srcW || compW
  const h = srcH || compH
  const scale = (fit ? Math.min(compW / w, compH / h) : 1) * (t.scale / 100)
  return { cx: compW / 2 + t.x, cy: compH / 2 + t.y, w: w * scale, h: h * scale, rot: (t.rotation * Math.PI) / 180 }
}

/** Corner points in comp pixels, clockwise from top-left. */
export function corners(g: Geometry): [number, number][] {
  return [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([u, v]) => toComp(g, u, v))
}

/** Normalised layer coordinates (0..1) -> comp pixels. */
export function toComp(g: Geometry, u: number, v: number): [number, number] {
  const cos = Math.cos(g.rot)
  const sin = Math.sin(g.rot)
  const x = (u - 0.5) * g.w
  const y = (v - 0.5) * g.h
  return [g.cx + cos * x - sin * y, g.cy + sin * x + cos * y]
}

/** Comp pixels -> normalised layer coordinates (0..1 inside the layer). */
export function toLayer(g: Geometry, x: number, y: number): Point {
  const dx = x - g.cx
  const dy = y - g.cy
  const cos = Math.cos(g.rot)
  const sin = Math.sin(g.rot)
  return [(cos * dx + sin * dy) / g.w + 0.5, (-sin * dx + cos * dy) / g.h + 0.5]
}

export function containsPoint(g: Geometry, x: number, y: number) {
  const [u, v] = toLayer(g, x, y)
  return u >= 0 && u <= 1 && v >= 0 && v <= 1
}
