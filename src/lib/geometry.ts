import type { Transform } from '../project'

/** Where a layer lands in the comp: centre and size in comp pixels, rotation in radians. */
export interface Geometry {
  cx: number
  cy: number
  w: number
  h: number
  rot: number
}

/** Media is first fitted inside the frame (like "fit to comp"), then the clip's transform applies. */
export function layerGeometry(t: Transform, srcW: number, srcH: number, compW: number, compH: number): Geometry {
  const w = srcW || compW
  const h = srcH || compH
  const scale = Math.min(compW / w, compH / h) * (t.scale / 100)
  return { cx: compW / 2 + t.x, cy: compH / 2 + t.y, w: w * scale, h: h * scale, rot: (t.rotation * Math.PI) / 180 }
}

/** Corner points in comp pixels, clockwise from top-left. */
export function corners(g: Geometry): [number, number][] {
  const cos = Math.cos(g.rot)
  const sin = Math.sin(g.rot)
  return [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([u, v]) => [g.cx + cos * u * g.w - sin * v * g.h, g.cy + sin * u * g.w + cos * v * g.h])
}

export function containsPoint(g: Geometry, x: number, y: number) {
  const dx = x - g.cx
  const dy = y - g.cy
  const cos = Math.cos(-g.rot)
  const sin = Math.sin(-g.rot)
  return Math.abs(cos * dx - sin * dy) <= g.w / 2 && Math.abs(sin * dx + cos * dy) <= g.h / 2
}
