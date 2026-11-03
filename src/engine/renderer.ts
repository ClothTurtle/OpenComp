// WebGL2 compositor: draws each visible layer as a textured quad, applying its transform and colour
// grade in the shader. New per-pixel effects (masks, keys, LUTs) belong in FRAGMENT below.
import { layerGeometry, type Geometry } from '../lib/geometry'
import type { ColorGrade, CompSettings, Transform } from '../project'

export interface Layer {
  key: string // texture cache key
  source: TexImageSource
  width: number
  height: number
  ready: boolean // false while a video is still decoding: reuse the last uploaded frame
  still: boolean // images never change, so upload them once
  transform: Transform
  color: ColorGrade
}

export interface Renderer {
  draw(layers: Layer[], settings: CompSettings): void
  dispose(): void
}

const VERTEX = `#version 300 es
in vec2 a_pos; // unit quad, 0..1
uniform mat3 u_matrix; // quad -> clip space
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4((u_matrix * vec3(a_pos, 1.0)).xy, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_saturation, u_temperature, u_tint;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 src = texture(u_tex, v_uv); // premultiplied
  vec3 c = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);

  c *= exp2(u_exposure);
  c *= vec3(1.0 + u_temperature * 0.2, 1.0 - u_tint * 0.2, 1.0 - u_temperature * 0.2);
  float l = luma(c);
  c += u_shadows * 0.25 * (1.0 - smoothstep(0.0, 0.5, l));
  c += u_highlights * 0.25 * smoothstep(0.5, 1.0, l);
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c = mix(vec3(luma(c)), c, 1.0 + u_saturation);

  float a = src.a * u_opacity;
  outColor = vec4(clamp(c, 0.0, 1.0) * a, a);
}`

const GRADE_UNIFORMS = ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'temperature', 'tint'] as const

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true })
  if (!gl) throw new Error('WebGL2 is not available in this browser.')

  const program = linkProgram(gl)
  gl.useProgram(program)
  const uniform = (name: string) => gl.getUniformLocation(program, name)
  const uMatrix = uniform('u_matrix')
  const uOpacity = uniform('u_opacity')
  const uGrade = GRADE_UNIFORMS.map((name) => uniform(`u_${name}`))

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, 'a_pos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)

  const textures = new Map<string, { tex: WebGLTexture; source: TexImageSource | null }>()

  /** Bind the layer's texture, uploading a new frame when needed. Returns false if there's nothing to draw yet. */
  const bindTexture = (layer: Layer): boolean => {
    let entry = textures.get(layer.key)
    if (!entry) {
      if (!layer.ready) return false
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      entry = { tex, source: null }
      textures.set(layer.key, entry)
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex)
    if (layer.ready && (!layer.still || entry.source !== layer.source)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source)
      entry.source = layer.source
    }
    return true
  }

  return {
    draw(layers, settings) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      const [r, g, b] = hexToRgb(settings.background)
      gl.clearColor(r, g, b, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      const used = new Set<string>()
      for (const layer of layers) {
        used.add(layer.key)
        if (!bindTexture(layer)) continue
        const geometry = layerGeometry(layer.transform, layer.width, layer.height, settings.width, settings.height)
        gl.uniformMatrix3fv(uMatrix, false, quadMatrix(geometry, settings.width, settings.height))
        gl.uniform1f(uOpacity, layer.transform.opacity / 100)
        GRADE_UNIFORMS.forEach((name, i) => {
          const value = layer.color[name]
          gl.uniform1f(uGrade[i], name === 'exposure' ? value : value / 100)
        })
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }

      for (const [key, entry] of textures) {
        if (used.has(key)) continue
        gl.deleteTexture(entry.tex)
        textures.delete(key)
      }
    },
    dispose() {
      for (const entry of textures.values()) gl.deleteTexture(entry.tex)
      textures.clear()
    },
  }
}

/** Maps the unit quad onto the layer's rotated rectangle, in clip space. Column-major mat3. */
function quadMatrix(g: Geometry, compW: number, compH: number): Float32Array {
  const cos = Math.cos(g.rot)
  const sin = Math.sin(g.rot)
  const du = [cos * g.w, sin * g.w] // pixel step along the quad's u axis
  const dv = [-sin * g.h, cos * g.h] // ...and v axis
  const ox = g.cx - (du[0] + dv[0]) / 2 // pixel position of the quad's (0, 0) corner
  const oy = g.cy - (du[1] + dv[1]) / 2
  const sx = 2 / compW
  const sy = -2 / compH // pixel y points down, clip-space y points up
  return new Float32Array([du[0] * sx, du[1] * sy, 0, dv[0] * sx, dv[1] * sy, 0, ox * sx - 1, oy * sy + 1, 1])
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16) || 0
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function linkProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()!
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader error')
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Link error')
  return program
}
