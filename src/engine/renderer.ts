// WebGL2 compositor. Every frame:
//   1. each layer is drawn into its own working texture: mask + colour grade, then each effect's passes
//   2. the result is composited into the comp texture with its transform, opacity and blend mode
//      (adjustment layers instead process the comp texture itself)
//   3. the comp texture is drawn to the canvas over the background
// Textures are premultiplied RGBA. Texture v = 0 is the top row everywhere; only the final blit flips.
import { EFFECT_MAP, type EffectDef } from '../effects'
import { layerGeometry } from '../lib/geometry'
import { BLEND_MODES, type BlendMode, type ColorGrade, type Effect, type TextStyle, type Transform } from '../project'
import { layoutText, renderText } from './text'

export interface Layer {
  key: string
  kind: 'media' | 'text' | 'solid' | 'adjustment'
  source?: TexImageSource
  ready?: boolean // false while a video is still decoding: reuse the last uploaded frame
  still?: boolean // images never change, so upload them once
  width: number // media: source px. text/solid/adjustment: ignored (sized from the comp/text)
  height: number
  text?: TextStyle
  solidColor?: string
  transform: Transform
  color: ColorGrade
  effects: Effect[]
  blendMode: BlendMode
  mask?: { key: string; draw: (w: number, h: number, pxScale: number) => CanvasImageSource | null }
  local: number // seconds since the clip started
  duration: number
}

export interface Frame {
  width: number
  height: number
  quality: number // preview resolution, 0..1
  background: string
  checker: boolean
  time: number
  layers: Layer[]
}

export interface Renderer {
  draw(frame: Frame): void
  dispose(): void
}

const VERTEX = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`

const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform sampler2D u_orig;
uniform vec2 u_size;
uniform float u_px;
uniform float u_time;
uniform float u_local;
uniform float u_duration;
uniform vec2 u_dir;
vec4 unpremul(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
vec4 src() { return unpremul(texture(u_tex, v_uv)); }
vec4 tap(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_tex, uv); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float lumAt(vec2 uv) { return luma(unpremul(texture(u_tex, uv)).rgb); }
float sobel(vec2 uv) {
  vec2 t = 1.0 / u_size;
  float tl = lumAt(uv + t * vec2(-1.0, -1.0)), tc = lumAt(uv + t * vec2(0.0, -1.0)), tr = lumAt(uv + t * vec2(1.0, -1.0));
  float ml = lumAt(uv + t * vec2(-1.0, 0.0)), mr = lumAt(uv + t * vec2(1.0, 0.0));
  float bl = lumAt(uv + t * vec2(-1.0, 1.0)), bc = lumAt(uv + t * vec2(0.0, 1.0)), br = lumAt(uv + t * vec2(1.0, 1.0));
  return length(vec2(-tl - 2.0 * ml - bl + tr + 2.0 * mr + br, -tl - 2.0 * tc - tr + bl + 2.0 * bc + br));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 sepiaTone(vec3 c) {
  return vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
}
float wipeAmount(float completion, float mode, float seconds) {
  float c = completion / 100.0;
  if (abs(mode - 1.0) < 0.5 || mode > 2.5) c = max(c, 1.0 - clamp(u_local / seconds, 0.0, 1.0));
  if (mode > 1.5) c = max(c, 1.0 - clamp((u_duration - u_local) / seconds, 0.0, 1.0));
  return c;
}
`

/** Mask + colour grade (or a solid colour fill): the first pass of every layer. */
const PREP = `uniform sampler2D u_mask;
uniform float u_hasMask, u_solid;
uniform vec3 u_solidColor;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_saturation, u_temperature, u_tint;
void main() {
  vec4 s = u_solid > 0.5 ? vec4(u_solidColor, 1.0) : texture(u_tex, v_uv);
  vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  c *= exp2(u_exposure);
  c *= vec3(1.0 + u_temperature * 0.2, 1.0 - u_tint * 0.2, 1.0 - u_temperature * 0.2);
  float l = luma(c);
  c += u_shadows * 0.25 * (1.0 - smoothstep(0.0, 0.5, l));
  c += u_highlights * 0.25 * smoothstep(0.5, 1.0, l);
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c = mix(vec3(luma(c)), c, 1.0 + u_saturation);
  float a = s.a;
  if (u_hasMask > 0.5) a *= texture(u_mask, v_uv).a;
  outColor = vec4(clamp(c, 0.0, 1.0) * a, a);
}`

/** Draws a layer's texture into the comp with its transform, opacity and blend mode. */
const COMPOSITE = `uniform sampler2D u_src;
uniform mat3 u_inv; // comp px -> layer uv
uniform vec2 u_compSize;
uniform vec2 u_layerPx; // layer size in comp px, for anti-aliased edges
uniform float u_opacity, u_mode;
vec3 blendColor(vec3 b, vec3 s, float m) {
  if (m < 0.5) return s;
  if (m < 1.5) return b * s;
  if (m < 2.5) return b + s - b * s;
  if (m < 3.5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (m < 4.5) return mix(2.0 * b * s + b * b * (1.0 - 2.0 * s), sqrt(b) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s), step(0.5, s));
  if (m < 5.5) return min(b + s, 1.0);
  if (m < 6.5) return min(b, s);
  if (m < 7.5) return max(b, s);
  return abs(b - s);
}
void main() {
  vec4 d = texture(u_tex, v_uv);
  vec2 uv = (u_inv * vec3(v_uv * u_compSize, 1.0)).xy;
  vec2 edge = min(uv, 1.0 - uv) * u_layerPx;
  float cover = clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0);
  vec4 s = texture(u_src, clamp(uv, 0.0, 1.0)) * cover * u_opacity;
  if (s.a <= 0.0) { outColor = d; return; }
  vec3 dc = d.a > 0.0 ? d.rgb / d.a : vec3(0.0);
  vec3 rgb = (1.0 - s.a) * d.rgb + (1.0 - d.a) * s.rgb + s.a * d.a * blendColor(dc, s.rgb / s.a, u_mode);
  outColor = vec4(rgb, s.a + d.a * (1.0 - s.a));
}`

const BLIT = `uniform vec3 u_bg;
uniform float u_checker;
void main() {
  vec4 c = texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y));
  vec3 bg = u_bg;
  if (u_checker > 0.5) bg = mod(floor(gl_FragCoord.x / 12.0) + floor(gl_FragCoord.y / 12.0), 2.0) < 1.0 ? vec3(0.4) : vec3(0.55);
  outColor = vec4(c.rgb + bg * (1.0 - c.a), 1.0);
}`

interface Program {
  program: WebGLProgram
  loc: Map<string, WebGLUniformLocation | null>
}

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
  lastUsed: number
}

type UniformValue = number | number[] | Float32Array

const GRADE_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'temperature', 'tint'] as const
const MAX_SIZE = 4096

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true })
  if (!gl) throw new Error('WebGL2 is not available in this browser.')

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.disable(gl.BLEND)

  // ---- programs ----
  const programs = new Map<string, Program | null>()
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)

  const program = (key: string, body: () => string): Program | null => {
    if (programs.has(key)) return programs.get(key)!
    let result: Program | null = null
    try {
      const p = gl.createProgram()
      gl.attachShader(p, vertex)
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, HEADER + body()))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link failed')
      result = { program: p, loc: new Map() }
    } catch (err) {
      console.warn(`OpenComp: shader "${key}" failed to compile`, err)
    }
    programs.set(key, result)
    return result
  }

  const effectProgram = (def: EffectDef, i: number) =>
    program(`fx:${def.type}:${i}`, () => {
      const decls = def.params
        .map((p) => `uniform ${p.type === 'color' ? 'vec3' : 'float'} u_${p.key};`)
        .join('\n')
      return `${decls}\n${def.passes[i].frag}`
    })

  // ---- render targets ----
  let frameNo = 0
  const pool: Target[] = []
  const inUse: Target[] = []

  const makeTexture = () => {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return tex
  }

  // Bound to samplers with nothing to read, so they never point at the texture being rendered to.
  const blank = makeTexture()
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))

  const acquire = (w: number, h: number): Target => {
    const i = pool.findIndex((t) => t.w === w && t.h === h)
    let t: Target
    if (i >= 0) t = pool.splice(i, 1)[0]
    else {
      const tex = makeTexture()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      t = { fbo, tex, w, h, lastUsed: 0 }
    }
    t.lastUsed = frameNo
    inUse.push(t)
    return t
  }

  /** Return every target acquired since `mark` to the pool, except `keep`. */
  const releaseSince = (mark: number, keep?: Target) => {
    for (const t of inUse.splice(mark)) {
      if (t === keep) inUse.push(t)
      else pool.push(t)
    }
  }

  // ---- source + mask textures, cached per layer ----
  const sources = new Map<string, { tex: WebGLTexture; source: TexImageSource | null; w: number; h: number; mip: boolean; used: number }>()
  const masks = new Map<string, { tex: WebGLTexture; key: string; used: number }>()

  const sourceTexture = (layer: Layer, workW: number): WebGLTexture | null => {
    let entry = sources.get(layer.key)
    if (!entry) {
      if (!layer.ready || !layer.source) return null
      entry = { tex: makeTexture(), source: null, w: 0, h: 0, mip: false, used: 0 }
      sources.set(layer.key, entry)
    }
    entry.used = frameNo
    gl.bindTexture(gl.TEXTURE_2D, entry.tex)
    const changed = !layer.still || entry.source !== layer.source
    // Big downscales alias badly without mipmaps.
    const mip = workW < layer.width * 0.6
    if (layer.ready && layer.source && (changed || mip !== entry.mip)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source)
      if (mip) gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
      entry.source = layer.source
      entry.mip = mip
    }
    return entry.tex
  }

  const maskTexture = (layer: Layer, w: number, h: number, pxScale: number): WebGLTexture | null => {
    if (!layer.mask) return null
    const key = `${layer.mask.key}@${w}x${h}`
    let entry = masks.get(layer.key)
    if (entry?.key !== key) {
      const image = layer.mask.draw(w, h, pxScale)
      if (!image) return null
      entry ??= { tex: makeTexture(), key, used: 0 }
      entry.key = key
      masks.set(layer.key, entry)
      gl.bindTexture(gl.TEXTURE_2D, entry.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource)
    }
    entry.used = frameNo
    return entry.tex
  }

  // ---- passes ----
  const run = (
    prog: Program,
    target: Target | null,
    textures: { u_tex?: WebGLTexture | null; u_orig?: WebGLTexture | null; u_src?: WebGLTexture | null; u_mask?: WebGLTexture | null },
    uniforms: Record<string, UniformValue>,
  ) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
    gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height)
    gl.useProgram(prog.program)
    const loc = (name: string) => {
      if (!prog.loc.has(name)) prog.loc.set(name, gl.getUniformLocation(prog.program, name))
      return prog.loc.get(name)!
    }
    let unit = 0
    for (const [name, tex] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex ?? blank)
      gl.uniform1i(loc(name), unit++)
    }
    gl.activeTexture(gl.TEXTURE0)
    for (const [name, v] of Object.entries(uniforms)) {
      const l = loc(name)
      if (!l) continue
      if (typeof v === 'number') gl.uniform1f(l, v)
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1])
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2])
      else if (v.length === 9) gl.uniformMatrix3fv(l, false, v)
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** Mask + grade, then every enabled effect. Returns the target holding the result. */
  const processLayer = (
    layer: Layer,
    input: WebGLTexture | null,
    w: number,
    h: number,
    pxScale: number,
    time: number,
  ): Target | null => {
    const prep = program('prep', () => PREP)
    if (!prep) return null
    const out = acquire(w, h)
    const maskTex = maskTexture(layer, w, h, pxScale)
    const grade = Object.fromEntries(GRADE_KEYS.map((k) => [`u_${k}`, k === 'exposure' ? layer.color[k] : layer.color[k] / 100]))
    run(prep, out, { u_tex: input, u_orig: null, u_mask: maskTex }, {
      ...grade,
      u_hasMask: maskTex ? 1 : 0,
      u_solid: layer.kind === 'solid' ? 1 : 0,
      u_solidColor: hexToRgb(layer.solidColor ?? '#000000'),
    })

    let cur = out
    for (const fx of layer.effects) {
      const def = EFFECT_MAP.get(fx.type)
      if (!def) continue
      const orig = cur
      const params: Record<string, UniformValue> = {}
      for (const p of def.params) {
        const v = fx.params[p.key] ?? p.default
        params[`u_${p.key}`] =
          p.type === 'color' ? hexToRgb(String(v))
          : p.type === 'boolean' ? (v ? 1 : 0)
          : p.type === 'select' ? Math.max(0, p.options!.indexOf(String(v)))
          : Number(v)
      }
      def.passes.forEach((pass, i) => {
        const prog = effectProgram(def, i)
        if (!prog) return
        const next = acquire(w, h)
        run(prog, next, { u_tex: cur.tex, u_orig: orig.tex }, {
          u_size: [w, h],
          u_px: pxScale,
          u_time: time,
          u_local: layer.local,
          u_duration: layer.duration,
          u_dir: [0, 0],
          ...params,
          ...pass.uniforms?.(fx.params),
        })
        cur = next
      })
    }
    return cur
  }

  return {
    draw(frame) {
      frameNo++
      const q = frame.quality
      const W = Math.max(1, Math.min(MAX_SIZE, Math.round(frame.width * q)))
      const H = Math.max(1, Math.min(MAX_SIZE, Math.round(frame.height * q)))
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      const composite = program('composite', () => COMPOSITE)
      const blit = program('blit', () => BLIT)
      if (!composite || !blit) return

      let comp = acquire(W, H)
      gl.bindFramebuffer(gl.FRAMEBUFFER, comp.fbo)
      gl.viewport(0, 0, W, H)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      for (const layer of frame.layers) {
        const mark = inUse.length
        let result: Target | null
        let inv: Float32Array
        let layerPx: number[]

        if (layer.kind === 'adjustment') {
          result = processLayer(layer, comp.tex, W, H, q, frame.time)
          inv = new Float32Array([1 / W, 0, 0, 0, 1 / H, 0, 0, 0, 1])
          layerPx = [W, H]
        } else {
          let natW = layer.width
          let natH = layer.height
          let fit = true
          if (layer.kind === 'text' && layer.text) {
            const L = layoutText(layer.text)
            ;[natW, natH, fit] = [L.width, L.height, false]
          } else if (layer.kind === 'solid') {
            ;[natW, natH, fit] = [frame.width, frame.height, false]
          }
          const g = layerGeometry(layer.transform, natW, natH, frame.width, frame.height, fit)
          if (g.w < 0.5 || g.h < 0.5) continue

          let input: WebGLTexture | null = null
          let w: number
          let h: number
          if (layer.kind === 'text' && layer.text) {
            const image = renderText(layer.text, (g.w * q) / natW)
            w = image.width
            h = image.height
            input = sourceTexture({ ...layer, source: image, ready: true, still: true, width: w }, w)
          } else {
            const cap = layer.kind === 'media' ? 1 : Infinity // don't upscale media beyond its own resolution
            w = Math.round(Math.min(natW * cap, g.w * q, MAX_SIZE))
            h = Math.round(Math.min(natH * cap, g.h * q, MAX_SIZE))
            w = Math.max(1, w)
            h = Math.max(1, h)
            if (layer.kind === 'media') {
              input = sourceTexture(layer, w)
              if (!input) continue
            }
          }
          result = processLayer(layer, input, w, h, w / g.w, frame.time)
          inv = inverseMatrix(g, q)
          layerPx = [g.w * q, g.h * q]
        }

        if (result) {
          const next = acquire(W, H)
          run(composite, next, { u_tex: comp.tex, u_src: result.tex }, {
            u_inv: inv,
            u_compSize: [W, H],
            u_layerPx: layerPx,
            u_opacity: layer.transform.opacity / 100,
            u_mode: layer.kind === 'adjustment' ? 0 : Math.max(0, BLEND_MODES.indexOf(layer.blendMode)),
          })
          const previous = comp
          comp = next
          releaseSince(mark, comp)
          inUse.splice(inUse.indexOf(previous), 1)
          pool.push(previous)
        } else {
          releaseSince(mark)
        }
      }

      run(blit, null, { u_tex: comp.tex }, { u_bg: hexToRgb(frame.background), u_checker: frame.checker ? 1 : 0 })
      releaseSince(0)

      // Free GPU memory nobody has used for a while.
      for (let i = pool.length - 1; i >= 0; i--) {
        if (frameNo - pool[i].lastUsed > 120) {
          gl.deleteFramebuffer(pool[i].fbo)
          gl.deleteTexture(pool[i].tex)
          pool.splice(i, 1)
        }
      }
      for (const cache of [sources, masks]) {
        for (const [key, entry] of cache) {
          if (frameNo - entry.used > 120) {
            gl.deleteTexture(entry.tex)
            cache.delete(key)
          }
        }
      }
    },
    dispose() {
      for (const t of [...pool, ...inUse]) {
        gl.deleteFramebuffer(t.fbo)
        gl.deleteTexture(t.tex)
      }
      for (const e of [...sources.values(), ...masks.values()]) gl.deleteTexture(e.tex)
      pool.length = inUse.length = 0
      sources.clear()
      masks.clear()
    },
  }
}

/** Comp working px -> layer uv (column-major mat3), for a layer at geometry g and preview scale q. */
function inverseMatrix(g: { cx: number; cy: number; w: number; h: number; rot: number }, q: number): Float32Array {
  const cos = Math.cos(g.rot)
  const sin = Math.sin(g.rot)
  return new Float32Array([
    cos / (q * g.w), -sin / (q * g.h), 0,
    sin / (q * g.w), cos / (q * g.h), 0,
    -(cos * g.cx + sin * g.cy) / g.w + 0.5, (sin * g.cx - cos * g.cy) / g.h + 0.5, 1,
  ])
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16) || 0
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed')
  return shader
}
