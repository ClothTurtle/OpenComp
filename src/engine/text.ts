// Text layers are drawn with the 2D canvas API at the size they appear on screen, then composited
// like any other layer.
import type { TextStyle } from '../project'

const measure = document.createElement('canvas').getContext('2d')!

const font = (s: TextStyle) => `${s.italic ? 'italic ' : ''}${s.bold ? 700 : 400} ${s.size}px ${s.font}`

export interface TextLayout {
  lines: string[]
  width: number // comp px, including padding
  height: number
  lineHeight: number
  pad: number
}

export function layoutText(s: TextStyle): TextLayout {
  measure.font = font(s)
  const lines = s.text.split('\n')
  const widest = Math.max(1, ...lines.map((l) => measure.measureText(l).width))
  const lineHeight = s.size * 1.2
  const pad = Math.ceil(s.size * 0.25 + s.strokeWidth + (s.shadow ? s.size * 0.12 : 0))
  return { lines, width: Math.ceil(widest + pad * 2), height: Math.ceil(lineHeight * lines.length + pad * 2), lineHeight, pad }
}

const cache = new Map<string, HTMLCanvasElement>()

/** The text drawn at `scale` (screen px per comp px). Cached, so call it every frame. */
export function renderText(s: TextStyle, scale: number): HTMLCanvasElement {
  const q = Math.min(4, Math.max(0.05, Math.round(scale * 20) / 20))
  const key = `${q}|${JSON.stringify(s)}`
  const hit = cache.get(key)
  if (hit) return hit

  const L = layoutText(s)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(L.width * q))
  canvas.height = Math.max(1, Math.ceil(L.height * q))
  const ctx = canvas.getContext('2d')!
  ctx.scale(q, q)
  if (s.box) {
    ctx.fillStyle = s.boxColor
    ctx.beginPath()
    ctx.roundRect(0, 0, L.width, L.height, s.size * 0.15)
    ctx.fill()
  }
  ctx.font = font(s)
  ctx.textAlign = s.align
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const x = s.align === 'left' ? L.pad : s.align === 'right' ? L.width - L.pad : L.width / 2
  L.lines.forEach((line, i) => {
    const y = L.pad + L.lineHeight * (i + 0.5)
    ctx.save()
    if (s.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
      ctx.shadowBlur = s.size * 0.12 * q
      ctx.shadowOffsetY = s.size * 0.04 * q
    }
    if (s.strokeWidth > 0) {
      ctx.lineWidth = s.strokeWidth * 2
      ctx.strokeStyle = s.strokeColor
      ctx.strokeText(line, x, y)
      ctx.shadowColor = 'transparent'
    }
    ctx.fillStyle = s.color
    ctx.fillText(line, x, y)
    ctx.restore()
  })

  if (cache.size > 60) cache.delete(cache.keys().next().value!)
  cache.set(key, canvas)
  return canvas
}
