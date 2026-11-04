// Building blocks for effects (see effects.ts for the shader conventions): parameter helpers,
// common GLSL snippets and passes, shared by the essential and the After Effects-style effects.
import type { ParamValue } from './project'

export interface ParamDef {
  key: string
  label: string
  type: 'number' | 'color' | 'boolean' | 'select'
  default: ParamValue
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: string[]
}

export interface EffectPass {
  frag: string
  uniforms?: (p: Record<string, ParamValue>) => Record<string, number | number[]>
}

export interface EffectDef {
  type: string
  name: string
  category: string
  description: string
  keywords?: string
  params: ParamDef[]
  passes: EffectPass[]
}

export const num = (key: string, label: string, def: number, min: number, max: number, step = 1, unit?: string): ParamDef => ({
  key, label, type: 'number', default: def, min, max, step, unit,
})
export const color = (key: string, label: string, def: string): ParamDef => ({ key, label, type: 'color', default: def })
export const bool = (key: string, label: string, def: boolean): ParamDef => ({ key, label, type: 'boolean', default: def })
export const select = (key: string, label: string, options: string[]): ParamDef => ({
  key, label, type: 'select', default: options[0], options,
})

/** A per-pixel colour effect: `body` edits `rgb` (unpremultiplied); `c` is the source pixel. */
export const colorFx = (body: string) => `void main() {
  vec4 c = src();
  vec3 rgb = c.rgb;
  ${body}
  outColor = premul(vec4(clamp(rgb, 0.0, 1.0), c.a));
}`

/** Separable gaussian blur along u_dir, radius u_blurRadius (comp px). */
export const BLUR = `uniform float u_blurRadius;
void main() {
  float r = u_blurRadius * u_px;
  if (r < 0.5 || dot(u_dir, u_dir) == 0.0) { outColor = texture(u_tex, v_uv); return; }
  float sigma = max(r / 2.0, 0.5);
  float stride = max(1.0, r / 20.0);
  vec2 stepUv = u_dir / u_size;
  vec4 acc = vec4(0.0);
  float total = 0.0;
  for (int i = -20; i <= 20; i++) {
    float x = float(i) * stride;
    if (abs(x) > r) continue;
    float w = exp(-0.5 * x * x / (sigma * sigma));
    acc += texture(u_tex, v_uv + stepUv * x) * w;
    total += w;
  }
  outColor = acc / total;
}`
export const blurPasses = (radius: (p: Record<string, ParamValue>) => number): EffectPass[] => [
  { frag: BLUR, uniforms: (p) => ({ u_blurRadius: radius(p), u_dir: [1, 0] }) },
  { frag: BLUR, uniforms: (p) => ({ u_blurRadius: radius(p), u_dir: [0, 1] }) },
]

export const ANIMATE = select('animate', 'Animate', ['Off', 'Wipe in', 'Wipe out', 'In and out'])
export const WIPE_TIME = num('wipeTime', 'Wipe duration', 1, 0.1, 10, 0.05, 's')

// ---- Helpers for the After Effects-style effects (src/advanced) ----------------------------

/** A select whose default isn't the first option. */
export const choose = (key: string, label: string, options: string[], def: string): ParamDef => ({ key, label, type: 'select', default: def, options })
export const pct = (key: string, label: string, def: number) => num(key, label, def, 0, 100, 1, '%')
export const deg = (key: string, label: string, def: number, min = -360, max = 360) => num(key, label, def, min, max, 1, '°')
export const px = (key: string, label: string, def: number, max = 200, min = 0) => num(key, label, def, min, max, 1, 'px')
/** A point on the layer as X/Y percentages (keys `<key>X`, `<key>Y`). */
export const point = (key: string, label: string, x = 50, y = 50): ParamDef[] => [pct(`${key}X`, `${label} X`, x), pct(`${key}Y`, `${label} Y`, y)]
export const BLEND_ORIGINAL = pct('blend', 'Blend with original', 0)
/** Mix the effect's result back toward its input (`u_blend`, 0..100). Use in place of `outColor = x`. */
export const blendOut = (expr: string) => `outColor = mix(${expr}, texture(u_orig, v_uv), u_blend / 100.0);`

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16) || 0
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Smooth value noise, an "evolving" variant, and fractal (fbm) noise with optional turbulence. */
export const NOISE = `
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vnoise3(vec2 p, float z) {
  float zi = floor(z), zf = fract(z);
  zf = zf * zf * (3.0 - 2.0 * zf);
  return mix(vnoise(p + zi * 17.31), vnoise(p + (zi + 1.0) * 17.31), zf);
}
float fbm(vec2 p, float z, float octaves, float turbulent) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= octaves) break;
    float n = vnoise3(p, z + float(i) * 3.7);
    if (turbulent > 0.5) n = abs(n * 2.0 - 1.0);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    p = p * 2.03 + vec2(13.7, 7.1);
  }
  return sum / norm;
}
`

/** Sample the layer on a fixed 12x12 grid: whole-image statistics without a reduction pass. */
export const GRID = `
const int GRID_N = 12;
vec4 gridAt(int i, int j) { return unpremul(texture(u_tex, (vec2(float(i), float(j)) + 0.5) / float(GRID_N))); }
`

/**
 * 3D channel effects. Ordinary video has no depth channel, so depth (0 = near, 1 = far) is derived
 * from the picture. The first two passes smooth the layer into u_tex; u_orig keeps the colour.
 */
export const DEPTH_PARAMS: ParamDef[] = [
  select('depthSource', 'Depth from', ['Brightness (bright = near)', 'Brightness (dark = near)', 'Height (top = far)', 'Height (bottom = far)']),
  num('depthSmooth', 'Depth smoothing', 6, 0, 100, 1, 'px'),
]
export const DEPTH = `
float depthAt(vec2 uv) {
  if (u_depthSource > 2.5) return uv.y;
  if (u_depthSource > 1.5) return 1.0 - uv.y;
  float l = luma(unpremul(texture(u_tex, uv)).rgb);
  return u_depthSource < 0.5 ? 1.0 - l : l;
}
`
export const depthPasses = (main: string): EffectPass[] => [...blurPasses((p) => Number(p.depthSmooth)), { frag: DEPTH + main }]

/** Generators draw over the layer (premultiplied `base` and `g`). */
export const GEN_BLEND = select('genBlend', 'Blend mode', ['Normal', 'Add', 'Multiply', 'Screen', 'Generator only'])
export const GEN = `
vec4 genBlend(vec4 base, vec4 g) {
  if (u_genBlend < 0.5) return g + base * (1.0 - g.a);
  if (u_genBlend < 1.5) { float a = max(base.a, g.a); return vec4(min(base.rgb + g.rgb, vec3(a)), a); }
  if (u_genBlend < 2.5) return vec4(base.rgb * mix(vec3(1.0), g.rgb / max(g.a, 1e-4), g.a), base.a);
  if (u_genBlend < 3.5) { float a = max(base.a, g.a); return vec4(min(base.rgb + g.rgb - base.rgb * g.rgb, vec3(a)), a); }
  return g;
}
`
