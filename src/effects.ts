// The effects library. Each effect is a list of GPU passes; the renderer compiles them on demand.
//
// Shader conventions (the header that every pass gets is in engine/renderer.ts):
// - textures are premultiplied RGBA; u_tex is the previous pass, u_orig the effect's input
// - u_size is the working texture size in px; multiply px-based params by u_px (texture px per comp px)
// - u_time (timeline s), u_local (s since the clip started), u_duration (clip length)
// - every param is available as a uniform named u_<key> (colours are vec3, selects are the option index)
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

const num = (key: string, label: string, def: number, min: number, max: number, step = 1, unit?: string): ParamDef => ({
  key, label, type: 'number', default: def, min, max, step, unit,
})
const color = (key: string, label: string, def: string): ParamDef => ({ key, label, type: 'color', default: def })
const bool = (key: string, label: string, def: boolean): ParamDef => ({ key, label, type: 'boolean', default: def })
const select = (key: string, label: string, options: string[]): ParamDef => ({
  key, label, type: 'select', default: options[0], options,
})

/** A per-pixel colour effect: `body` edits `rgb` (unpremultiplied); `c` is the source pixel. */
const colorFx = (body: string) => `void main() {
  vec4 c = src();
  vec3 rgb = c.rgb;
  ${body}
  outColor = premul(vec4(clamp(rgb, 0.0, 1.0), c.a));
}`

/** Separable gaussian blur along u_dir, radius u_blurRadius (comp px). */
const BLUR = `uniform float u_blurRadius;
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
const blurPasses = (radius: (p: Record<string, ParamValue>) => number): EffectPass[] => [
  { frag: BLUR, uniforms: (p) => ({ u_blurRadius: radius(p), u_dir: [1, 0] }) },
  { frag: BLUR, uniforms: (p) => ({ u_blurRadius: radius(p), u_dir: [0, 1] }) },
]

const ANIMATE = select('animate', 'Animate', ['Off', 'Wipe in', 'Wipe out', 'In and out'])
const WIPE_TIME = num('wipeTime', 'Wipe duration', 1, 0.1, 10, 0.05, 's')

export const EFFECTS: EffectDef[] = [
  // ---- Color & Light -------------------------------------------------------------------------
  {
    type: 'brightness-contrast', name: 'Brightness & Contrast', category: 'Color & Light',
    description: 'Simple brightness and contrast.',
    params: [num('brightness', 'Brightness', 0, -100, 100), num('contrast', 'Contrast', 0, -100, 100)],
    passes: [{ frag: colorFx('rgb += u_brightness / 200.0; rgb = (rgb - 0.5) * (1.0 + u_contrast / 100.0) + 0.5;') }],
  },
  {
    type: 'levels', name: 'Levels', category: 'Color & Light',
    description: 'Remap black point, white point and gamma.', keywords: 'gamma input output',
    params: [
      num('inBlack', 'Input black', 0, 0, 255), num('inWhite', 'Input white', 255, 0, 255),
      num('gamma', 'Gamma', 1, 0.1, 3, 0.01), num('outBlack', 'Output black', 0, 0, 255), num('outWhite', 'Output white', 255, 0, 255),
    ],
    passes: [{
      frag: colorFx(`rgb = clamp((rgb - u_inBlack / 255.0) / max((u_inWhite - u_inBlack) / 255.0, 0.001), 0.0, 1.0);
        rgb = pow(rgb, vec3(1.0 / u_gamma));
        rgb = mix(vec3(u_outBlack / 255.0), vec3(u_outWhite / 255.0), rgb);`),
    }],
  },
  {
    type: 'hue-saturation', name: 'Hue / Saturation', category: 'Color & Light',
    description: 'Rotate hues, change saturation and lightness.', keywords: 'colour shift',
    params: [num('hue', 'Hue', 0, -180, 180, 1, '°'), num('saturation', 'Saturation', 0, -100, 100), num('lightness', 'Lightness', 0, -100, 100)],
    passes: [{
      frag: colorFx(`vec3 hsv = rgb2hsv(rgb);
        hsv.x = fract(hsv.x + u_hue / 360.0);
        hsv.y = clamp(hsv.y * (1.0 + u_saturation / 100.0), 0.0, 1.0);
        rgb = hsv2rgb(hsv);
        rgb = u_lightness > 0.0 ? mix(rgb, vec3(1.0), u_lightness / 100.0) : rgb * (1.0 + u_lightness / 100.0);`),
    }],
  },
  {
    type: 'vibrance', name: 'Vibrance', category: 'Color & Light',
    description: 'Boost muted colours more than already-saturated ones.',
    params: [num('amount', 'Amount', 30, -100, 100)],
    passes: [{
      frag: colorFx(`float sat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
        rgb = mix(vec3(luma(rgb)), rgb, 1.0 + (u_amount / 100.0) * (1.0 - sat));`),
    }],
  },
  {
    type: 'black-white', name: 'Black & White', category: 'Color & Light',
    description: 'Convert to monochrome, optionally tinted.', keywords: 'grayscale greyscale mono',
    params: [num('amount', 'Amount', 100, 0, 100), color('tintColor', 'Tint', '#ffffff')],
    passes: [{ frag: colorFx('rgb = mix(rgb, vec3(luma(rgb)) * u_tintColor, u_amount / 100.0);') }],
  },
  {
    type: 'sepia', name: 'Sepia', category: 'Color & Light', description: 'Warm, old-photo toning.',
    params: [num('amount', 'Amount', 100, 0, 100)],
    passes: [{ frag: colorFx('rgb = mix(rgb, sepiaTone(rgb), u_amount / 100.0);') }],
  },
  {
    type: 'invert', name: 'Invert', category: 'Color & Light', description: 'Negative image.', keywords: 'negative',
    params: [num('amount', 'Amount', 100, 0, 100)],
    passes: [{ frag: colorFx('rgb = mix(rgb, 1.0 - rgb, u_amount / 100.0);') }],
  },
  {
    type: 'posterize', name: 'Posterize', category: 'Color & Light', description: 'Reduce the number of colour levels.',
    params: [num('levels', 'Levels', 6, 2, 32)],
    passes: [{ frag: colorFx('rgb = floor(rgb * (u_levels - 1.0) + 0.5) / (u_levels - 1.0);') }],
  },
  {
    type: 'threshold', name: 'Threshold', category: 'Color & Light', description: 'Pure black and white at a cutoff.',
    params: [num('level', 'Level', 128, 0, 255)],
    passes: [{ frag: colorFx('rgb = vec3(step(u_level / 255.0, luma(rgb)));') }],
  },
  {
    type: 'tint', name: 'Tint (Duotone)', category: 'Color & Light',
    description: 'Map shadows and highlights to two colours.', keywords: 'duotone gradient map',
    params: [color('mapBlack', 'Map black to', '#1a1a40'), color('mapWhite', 'Map white to', '#ffe0a0'), num('amount', 'Amount', 100, 0, 100)],
    passes: [{ frag: colorFx('rgb = mix(rgb, mix(u_mapBlack, u_mapWhite, luma(rgb)), u_amount / 100.0);') }],
  },
  {
    type: 'split-toning', name: 'Split Toning', category: 'Color & Light',
    description: 'Tint shadows and highlights separately (teal & orange and friends).', keywords: 'teal orange cinematic look',
    params: [
      color('shadowColor', 'Shadows', '#2a6f9f'), color('highlightColor', 'Highlights', '#ffad60'),
      num('balance', 'Balance', 0, -100, 100), num('amount', 'Amount', 50, 0, 100),
    ],
    passes: [{
      frag: colorFx(`float l = clamp(luma(rgb) + u_balance / 200.0, 0.0, 1.0);
        vec3 tone = mix(u_shadowColor, u_highlightColor, smoothstep(0.0, 1.0, l));
        vec3 toned = (1.0 - 2.0 * tone) * rgb * rgb + 2.0 * tone * rgb;
        rgb = mix(rgb, toned, u_amount / 100.0);`),
    }],
  },
  {
    type: 'vignette', name: 'Vignette', category: 'Color & Light', description: 'Darken (or tint) the edges of the frame.',
    params: [num('amount', 'Amount', 50, 0, 100), num('radius', 'Radius', 75, 0, 150), num('softness', 'Softness', 50, 0, 100), color('vColor', 'Colour', '#000000')],
    passes: [{
      frag: colorFx(`float r = length((v_uv - 0.5) * 2.0) / 1.4142;
        float inner = (u_radius / 100.0) * (1.0 - u_softness / 100.0);
        float v = smoothstep(inner, u_radius / 100.0 + 0.0001, r);
        rgb = mix(rgb, u_vColor, v * u_amount / 100.0);`),
    }],
  },
  {
    type: 'fill', name: 'Fill', category: 'Color & Light', description: 'Fill the layer with a solid colour (keeps its shape).',
    params: [color('fillColor', 'Colour', '#ff3366'), num('amount', 'Amount', 100, 0, 100)],
    passes: [{ frag: colorFx('rgb = mix(rgb, u_fillColor, u_amount / 100.0);') }],
  },
  {
    type: 'gradient-ramp', name: 'Gradient Overlay', category: 'Color & Light', description: 'Blend a two-colour gradient over the layer.',
    keywords: 'ramp',
    params: [
      color('startColor', 'Start colour', '#ff6a00'), color('endColor', 'End colour', '#7a00ff'),
      num('angle', 'Angle', 90, 0, 360, 1, '°'), num('amount', 'Amount', 50, 0, 100), select('blend', 'Blend', ['Normal', 'Multiply', 'Screen', 'Overlay']),
    ],
    passes: [{
      frag: colorFx(`float a = radians(u_angle);
        float t = clamp(dot(v_uv - 0.5, vec2(cos(a), sin(a))) + 0.5, 0.0, 1.0);
        vec3 g = mix(u_startColor, u_endColor, t);
        vec3 b = g;
        if (u_blend > 0.5 && u_blend < 1.5) b = rgb * g;
        else if (u_blend > 1.5 && u_blend < 2.5) b = 1.0 - (1.0 - rgb) * (1.0 - g);
        else if (u_blend > 2.5) b = mix(2.0 * rgb * g, 1.0 - 2.0 * (1.0 - rgb) * (1.0 - g), step(0.5, rgb));
        rgb = mix(rgb, b, u_amount / 100.0);`),
    }],
  },

  // ---- Blur & Sharpen ------------------------------------------------------------------------
  {
    type: 'gaussian-blur', name: 'Gaussian Blur', category: 'Blur & Sharpen', description: 'Smooth, even blur.', keywords: 'soften defocus',
    params: [num('radius', 'Radius', 10, 0, 200, 1, 'px'), select('dimensions', 'Direction', ['Both', 'Horizontal', 'Vertical'])],
    passes: [
      { frag: BLUR, uniforms: (p) => ({ u_blurRadius: Number(p.radius), u_dir: p.dimensions === 'Vertical' ? [0, 0] : [1, 0] }) },
      { frag: BLUR, uniforms: (p) => ({ u_blurRadius: Number(p.radius), u_dir: p.dimensions === 'Horizontal' ? [0, 0] : [0, 1] }) },
    ],
  },
  {
    type: 'directional-blur', name: 'Directional Blur', category: 'Blur & Sharpen', description: 'Motion-style blur in one direction.',
    keywords: 'motion blur',
    params: [num('angle', 'Angle', 0, 0, 360, 1, '°'), num('length', 'Length', 20, 0, 200, 1, 'px')],
    passes: [{
      frag: `void main() {
        float len = u_length * u_px;
        if (len < 0.5) { outColor = texture(u_tex, v_uv); return; }
        float a = radians(u_angle);
        vec2 d = vec2(cos(a), sin(a)) / u_size;
        vec4 acc = vec4(0.0);
        for (int i = 0; i < 32; i++) acc += texture(u_tex, v_uv + d * (float(i) / 31.0 - 0.5) * len);
        outColor = acc / 32.0;
      }`,
    }],
  },
  {
    type: 'zoom-blur', name: 'Zoom Blur', category: 'Blur & Sharpen', description: 'Radial blur streaking out from a centre.',
    keywords: 'radial',
    params: [num('amount', 'Amount', 20, 0, 100), num('centerX', 'Centre X', 50, 0, 100, 1, '%'), num('centerY', 'Centre Y', 50, 0, 100, 1, '%')],
    passes: [{
      frag: `void main() {
        vec2 c = vec2(u_centerX, u_centerY) / 100.0;
        vec4 acc = vec4(0.0);
        for (int i = 0; i < 32; i++) acc += texture(u_tex, c + (v_uv - c) * (1.0 - (u_amount / 100.0) * 0.5 * float(i) / 31.0));
        outColor = acc / 32.0;
      }`,
    }],
  },
  {
    type: 'sharpen', name: 'Sharpen', category: 'Blur & Sharpen', description: 'Crisp up edges.', keywords: 'unsharp detail',
    params: [num('amount', 'Amount', 50, 0, 300)],
    passes: [{
      frag: `void main() {
        vec2 t = 1.0 / u_size;
        vec4 c = texture(u_tex, v_uv);
        vec4 n = texture(u_tex, v_uv + vec2(t.x, 0.0)) + texture(u_tex, v_uv - vec2(t.x, 0.0))
               + texture(u_tex, v_uv + vec2(0.0, t.y)) + texture(u_tex, v_uv - vec2(0.0, t.y));
        vec4 o = c + (c * 4.0 - n) * (u_amount / 100.0);
        outColor = vec4(clamp(o.rgb, vec3(0.0), vec3(c.a)), c.a);
      }`,
    }],
  },

  // ---- Distort -------------------------------------------------------------------------------
  {
    type: 'pixelate', name: 'Pixelate', category: 'Distort', description: 'Big blocky pixels.', keywords: 'mosaic censor',
    params: [num('cellSize', 'Cell size', 20, 1, 200, 1, 'px')],
    passes: [{
      frag: `void main() {
        vec2 cell = max(vec2(u_cellSize * u_px), vec2(1.0)) / u_size;
        outColor = texture(u_tex, (floor(v_uv / cell) + 0.5) * cell);
      }`,
    }],
  },
  {
    type: 'mirror', name: 'Mirror', category: 'Distort', description: 'Reflect one half of the layer onto the other.',
    keywords: 'symmetry reflect',
    params: [select('mode', 'Mode', ['Left onto right', 'Right onto left', 'Top onto bottom', 'Bottom onto top', 'Four ways'])],
    passes: [{
      frag: `void main() {
        vec2 uv = v_uv;
        if (u_mode < 0.5) uv.x = uv.x > 0.5 ? 1.0 - uv.x : uv.x;
        else if (u_mode < 1.5) uv.x = uv.x < 0.5 ? 1.0 - uv.x : uv.x;
        else if (u_mode < 2.5) uv.y = uv.y > 0.5 ? 1.0 - uv.y : uv.y;
        else if (u_mode < 3.5) uv.y = uv.y < 0.5 ? 1.0 - uv.y : uv.y;
        else uv = vec2(uv.x > 0.5 ? 1.0 - uv.x : uv.x, uv.y > 0.5 ? 1.0 - uv.y : uv.y);
        outColor = texture(u_tex, uv);
      }`,
    }],
  },
  {
    type: 'flip', name: 'Flip', category: 'Distort', description: 'Flip horizontally and/or vertically.',
    params: [bool('horizontal', 'Horizontal', true), bool('vertical', 'Vertical', false)],
    passes: [{
      frag: `void main() {
        vec2 uv = v_uv;
        if (u_horizontal > 0.5) uv.x = 1.0 - uv.x;
        if (u_vertical > 0.5) uv.y = 1.0 - uv.y;
        outColor = texture(u_tex, uv);
      }`,
    }],
  },
  {
    type: 'wave-warp', name: 'Wave Warp', category: 'Distort', description: 'Animated sine-wave distortion.', keywords: 'ripple wobble',
    params: [
      num('amplitude', 'Amplitude', 20, 0, 200, 1, 'px'), num('wavelength', 'Wavelength', 200, 10, 2000, 1, 'px'),
      num('speed', 'Speed', 1, 0, 10, 0.1, 'Hz'), select('direction', 'Direction', ['Horizontal', 'Vertical']),
    ],
    passes: [{
      frag: `void main() {
        vec2 uv = v_uv;
        float ph = u_time * u_speed * 6.2832;
        float wl = max(u_wavelength * u_px, 1.0);
        if (u_direction < 0.5) uv.x += sin(v_uv.y * u_size.y / wl * 6.2832 + ph) * u_amplitude * u_px / u_size.x;
        else uv.y += sin(v_uv.x * u_size.x / wl * 6.2832 + ph) * u_amplitude * u_px / u_size.y;
        outColor = tap(uv);
      }`,
    }],
  },
  {
    type: 'twirl', name: 'Twirl', category: 'Distort', description: 'Swirl around the centre.', keywords: 'swirl spiral',
    params: [num('angle', 'Angle', 180, -720, 720, 1, '°'), num('radius', 'Radius', 50, 1, 100, 1, '%')],
    passes: [{
      frag: `void main() {
        vec2 aspect = vec2(u_size.x / u_size.y, 1.0);
        vec2 p = (v_uv - 0.5) * aspect;
        float R = u_radius / 100.0 * 0.5 * max(aspect.x, 1.0);
        float r = length(p);
        if (r < R) {
          float t = 1.0 - r / R;
          float a = radians(u_angle) * t * t;
          p = vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y);
        }
        outColor = tap(p / aspect + 0.5);
      }`,
    }],
  },
  {
    type: 'bulge', name: 'Bulge / Pinch', category: 'Distort', description: 'Magnify (or squeeze) the centre.', keywords: 'spherize fisheye',
    params: [num('amount', 'Amount', 50, -100, 100), num('radius', 'Radius', 50, 1, 100, 1, '%')],
    passes: [{
      frag: `void main() {
        vec2 aspect = vec2(u_size.x / u_size.y, 1.0);
        vec2 p = (v_uv - 0.5) * aspect;
        float R = u_radius / 100.0 * 0.5 * max(aspect.x, 1.0);
        float k = length(p) / R;
        if (k < 1.0) p *= 1.0 - (u_amount / 100.0) * (1.0 - k) * (1.0 - k);
        outColor = tap(p / aspect + 0.5);
      }`,
    }],
  },
  {
    type: 'lens-distortion', name: 'Lens Distortion', category: 'Distort', description: 'Barrel (+) or pincushion (−) lens curvature.',
    keywords: 'fisheye barrel',
    params: [num('amount', 'Amount', 30, -100, 100)],
    passes: [{
      frag: `void main() {
        vec2 p = v_uv - 0.5;
        p *= 1.0 + (u_amount / 100.0) * dot(p, p) * 2.0;
        outColor = tap(p + 0.5);
      }`,
    }],
  },
  {
    type: 'rgb-split', name: 'RGB Split', category: 'Distort', description: 'Chromatic aberration: offset the colour channels.',
    keywords: 'chromatic aberration',
    params: [num('amount', 'Amount', 8, 0, 100, 1, 'px'), num('angle', 'Angle', 0, 0, 360, 1, '°')],
    passes: [{
      frag: `void main() {
        float a = radians(u_angle);
        vec2 o = vec2(cos(a), sin(a)) * u_amount * u_px / u_size;
        vec4 r = tap(v_uv + o);
        vec4 g = texture(u_tex, v_uv);
        vec4 b = tap(v_uv - o);
        outColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
      }`,
    }],
  },
  {
    type: 'glitch', name: 'Glitch', category: 'Distort', description: 'Digital glitch: torn rows and colour shifts.', keywords: 'datamosh vhs',
    params: [num('amount', 'Amount', 40, 0, 100), num('speed', 'Speed', 8, 0, 30)],
    passes: [{
      frag: `void main() {
        float t = floor(u_time * u_speed);
        float k = u_amount / 100.0;
        float row = floor(v_uv.y * 24.0);
        float shift = hash(vec2(row, t)) > 1.0 - k * 0.5 ? (hash(vec2(t, row)) - 0.5) * 0.15 * k : 0.0;
        vec2 uv = vec2(v_uv.x + shift, v_uv.y);
        float o = k * 0.02 * (hash(vec2(t, 7.0)) - 0.5);
        vec4 g = tap(uv);
        outColor = vec4(tap(uv + vec2(o, 0.0)).r, g.g, tap(uv - vec2(o, 0.0)).b, g.a);
      }`,
    }],
  },
  {
    type: 'offset', name: 'Offset (Wrap)', category: 'Distort', description: 'Scroll the layer with wrap-around.', keywords: 'tile scroll',
    params: [num('shiftX', 'Shift X', 0, -100, 100, 1, '%'), num('shiftY', 'Shift Y', 0, -100, 100, 1, '%')],
    passes: [{ frag: 'void main() { outColor = texture(u_tex, fract(v_uv - vec2(u_shiftX, u_shiftY) / 100.0)); }' }],
  },
  {
    type: 'kaleidoscope', name: 'Kaleidoscope', category: 'Distort', description: 'Repeat a wedge around the centre.',
    params: [num('segments', 'Segments', 6, 2, 24), num('rotation', 'Rotation', 0, 0, 360, 1, '°')],
    passes: [{
      frag: `void main() {
        vec2 aspect = vec2(u_size.x / u_size.y, 1.0);
        vec2 p = (v_uv - 0.5) * aspect;
        float seg = 6.2832 / u_segments;
        float a = mod(atan(p.y, p.x) + radians(u_rotation), seg);
        a = abs(a - seg * 0.5);
        outColor = tap(vec2(cos(a), sin(a)) * length(p) / aspect + 0.5);
      }`,
    }],
  },

  // ---- Stylize -------------------------------------------------------------------------------
  {
    type: 'glow', name: 'Glow', category: 'Stylize', description: 'Bright areas bloom outwards.', keywords: 'bloom',
    params: [num('threshold', 'Threshold', 60, 0, 100), num('radius', 'Radius', 30, 0, 200, 1, 'px'), num('intensity', 'Intensity', 100, 0, 300)],
    passes: [
      {
        frag: `void main() {
          vec4 c = src();
          float k = smoothstep(u_threshold / 100.0, u_threshold / 100.0 + 0.1, luma(c.rgb));
          outColor = premul(vec4(c.rgb, c.a * k));
        }`,
      },
      ...blurPasses((p) => Number(p.radius)),
      {
        frag: `void main() {
          vec4 o = texture(u_orig, v_uv);
          vec4 g = texture(u_tex, v_uv) * (u_intensity / 100.0);
          float a = max(o.a, min(1.0, g.a));
          outColor = vec4(min(o.rgb + g.rgb, vec3(a)), a);
        }`,
      },
    ],
  },
  {
    type: 'drop-shadow', name: 'Drop Shadow', category: 'Stylize', description: 'A soft shadow behind the layer’s shape (great on text).',
    keywords: 'shadow',
    params: [
      color('shadowColor', 'Colour', '#000000'), num('opacity', 'Opacity', 60, 0, 100, 1, '%'),
      num('distance', 'Distance', 12, 0, 200, 1, 'px'), num('angle', 'Angle', 45, 0, 360, 1, '°'), num('softness', 'Softness', 10, 0, 100, 1, 'px'),
    ],
    passes: [
      {
        frag: `void main() {
          float a = radians(u_angle);
          float s = tap(v_uv - vec2(cos(a), sin(a)) * u_distance * u_px / u_size).a;
          outColor = vec4(u_shadowColor * s, s) * (u_opacity / 100.0);
        }`,
      },
      ...blurPasses((p) => Number(p.softness)),
      { frag: 'void main() { vec4 o = texture(u_orig, v_uv); outColor = o + texture(u_tex, v_uv) * (1.0 - o.a); }' },
    ],
  },
  {
    type: 'outline', name: 'Outline', category: 'Stylize', description: 'A coloured stroke around the layer’s shape.',
    keywords: 'stroke border',
    params: [color('strokeColor', 'Colour', '#ffffff'), num('width', 'Width', 6, 1, 50, 1, 'px')],
    passes: [{
      frag: `void main() {
        vec4 c = texture(u_tex, v_uv);
        float w = u_width * u_px;
        float m = 0.0;
        for (int i = 0; i < 24; i++) {
          vec2 d = vec2(cos(float(i) * 0.2618), sin(float(i) * 0.2618)) / u_size;
          m = max(m, max(tap(v_uv + d * w).a, tap(v_uv + d * w * 0.5).a));
        }
        outColor = c + vec4(u_strokeColor * m, m) * (1.0 - c.a);
      }`,
    }],
  },
  {
    type: 'noise', name: 'Noise / Grain', category: 'Stylize', description: 'Film grain or digital noise.', keywords: 'grain',
    params: [num('amount', 'Amount', 20, 0, 100), bool('animated', 'Animated', true), bool('monochrome', 'Monochrome', true)],
    passes: [{
      frag: colorFx(`float seed = u_animated > 0.5 ? floor(u_time * 24.0) : 0.0;
        vec2 q = v_uv * u_size;
        float n = hash(q + seed * 17.13) - 0.5;
        vec3 nc = u_monochrome > 0.5 ? vec3(n) : vec3(n, hash(q * 1.7 + seed) - 0.5, hash(q * 2.3 + seed) - 0.5);
        rgb += nc * u_amount / 100.0;`),
    }],
  },
  {
    type: 'scanlines', name: 'Scanlines', category: 'Stylize', description: 'CRT-style horizontal lines.', keywords: 'crt retro tv',
    params: [num('count', 'Lines', 400, 50, 1500), num('amount', 'Amount', 40, 0, 100), num('scroll', 'Scroll speed', 0, 0, 50)],
    passes: [{
      frag: colorFx(`float s = 0.5 + 0.5 * sin((v_uv.y * u_count + u_time * u_scroll) * 6.2832);
        rgb *= 1.0 - (u_amount / 100.0) * (1.0 - s);`),
    }],
  },
  {
    type: 'emboss', name: 'Emboss', category: 'Stylize', description: 'Raised, stamped-metal look.',
    params: [num('strength', 'Strength', 100, 0, 500), num('angle', 'Angle', 45, 0, 360, 1, '°')],
    passes: [{
      frag: `void main() {
        float a = radians(u_angle);
        vec2 o = vec2(cos(a), sin(a)) / u_size;
        float d = lumAt(v_uv + o) - lumAt(v_uv - o);
        outColor = premul(vec4(vec3(clamp(0.5 + d * u_strength / 100.0, 0.0, 1.0)), texture(u_tex, v_uv).a));
      }`,
    }],
  },
  {
    type: 'find-edges', name: 'Find Edges', category: 'Stylize', description: 'Outline the edges in the image.', keywords: 'sobel sketch',
    params: [num('amount', 'Amount', 100, 0, 100), bool('invert', 'Invert (dark lines)', false)],
    passes: [{
      frag: colorFx(`float e = clamp(sobel(v_uv), 0.0, 1.0);
        rgb = mix(rgb, u_invert > 0.5 ? vec3(1.0 - e) : vec3(e), u_amount / 100.0);`),
    }],
  },
  {
    type: 'halftone', name: 'Halftone', category: 'Stylize', description: 'Comic-book dot pattern.', keywords: 'comic dots print',
    params: [num('dotSize', 'Dot size', 8, 2, 60, 1, 'px'), num('angle', 'Angle', 45, 0, 90, 1, '°'), bool('colorful', 'Coloured dots', false)],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        float s = max(u_dotSize * u_px, 2.0);
        float a = radians(u_angle);
        mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec2 p = R * (v_uv * u_size);
        vec2 cell = (floor(p / s) + 0.5) * s;
        vec4 cc = unpremul(texture(u_tex, (transpose(R) * cell) / u_size));
        float radius = (1.0 - luma(cc.rgb)) * s * 0.7071;
        float ink = 1.0 - smoothstep(radius - 1.0, radius + 1.0, length(p - cell));
        vec3 rgb = u_colorful > 0.5 ? mix(vec3(1.0), cc.rgb, ink) : vec3(1.0 - ink);
        outColor = premul(vec4(rgb, c.a));
      }`,
    }],
  },
  {
    type: 'cartoon', name: 'Cartoon', category: 'Stylize', description: 'Flat colours with inked edges.', keywords: 'toon comic',
    params: [num('levels', 'Colour levels', 5, 2, 12), num('edges', 'Edge darkness', 70, 0, 100)],
    passes: [{
      frag: colorFx(`rgb = floor(rgb * (u_levels - 1.0) + 0.5) / (u_levels - 1.0);
        rgb *= 1.0 - smoothstep(0.15, 0.4, sobel(v_uv)) * u_edges / 100.0;`),
    }],
  },
  {
    type: 'old-film', name: 'Old Film', category: 'Stylize', description: 'Sepia, grain, flicker, vignette and scratches.',
    keywords: 'vintage retro',
    params: [num('amount', 'Amount', 70, 0, 100)],
    passes: [{
      frag: colorFx(`float k = u_amount / 100.0;
        float t = floor(u_time * 18.0);
        rgb = mix(rgb, sepiaTone(rgb), 0.8 * k);
        rgb *= 1.0 - 0.1 * k * hash(vec2(t, 3.0));
        rgb += (hash(v_uv * u_size + t) - 0.5) * 0.15 * k;
        rgb *= 1.0 - k * 0.6 * smoothstep(0.4, 1.0, length(v_uv - 0.5) * 1.4142);
        float line = (1.0 - smoothstep(0.0, 0.0015, abs(v_uv.x - hash(vec2(t, 11.0))))) * step(0.7, hash(vec2(t, 5.0)));
        rgb = mix(rgb, vec3(0.9), line * 0.6 * k);`),
    }],
  },

  // ---- Keying --------------------------------------------------------------------------------
  {
    type: 'chroma-key', name: 'Chroma Key', category: 'Keying', description: 'Remove a green/blue screen.',
    keywords: 'green screen blue screen transparent',
    params: [
      color('keyColor', 'Key colour', '#00ff00'), num('tolerance', 'Tolerance', 30, 0, 100),
      num('softness', 'Edge softness', 20, 0, 100), num('spill', 'Spill suppression', 50, 0, 100),
    ],
    passes: [{
      frag: `vec2 chroma(vec3 c) { return vec2(dot(c, vec3(-0.169, -0.331, 0.5)), dot(c, vec3(0.5, -0.419, -0.081))); }
      void main() {
        vec4 c = src();
        float d = distance(chroma(c.rgb), chroma(u_keyColor));
        float t = u_tolerance / 100.0 * 0.4;
        float s = u_softness / 100.0 * 0.3 + 0.001;
        float spillZone = 1.0 - smoothstep(t, t + s + 0.25, d);
        vec3 rgb = mix(c.rgb, vec3(luma(c.rgb)), spillZone * u_spill / 100.0);
        outColor = premul(vec4(rgb, c.a * smoothstep(t, t + s, d)));
      }`,
    }],
  },
  {
    type: 'luma-key', name: 'Luma Key', category: 'Keying', description: 'Make dark (or bright) areas transparent.',
    keywords: 'black white transparent',
    params: [num('threshold', 'Threshold', 20, 0, 100), num('softness', 'Softness', 10, 0, 100), select('keyOut', 'Key out', ['Darks', 'Brights'])],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        float l = luma(c.rgb);
        float t = u_threshold / 100.0;
        float s = u_softness / 100.0 + 0.001;
        float k = u_keyOut < 0.5 ? smoothstep(t, t + s, l) : 1.0 - smoothstep(1.0 - t - s, 1.0 - t, l);
        outColor = premul(vec4(c.rgb, c.a * k));
      }`,
    }],
  },

  // ---- Transitions ---------------------------------------------------------------------------
  {
    type: 'fade', name: 'Fade In / Out', category: 'Transitions', description: 'Fade the clip in at its start and out at its end.',
    keywords: 'dissolve opacity',
    params: [num('fadeIn', 'Fade in', 0.5, 0, 10, 0.05, 's'), num('fadeOut', 'Fade out', 0.5, 0, 10, 0.05, 's')],
    passes: [{
      frag: `void main() {
        float a = 1.0;
        if (u_fadeIn > 0.0) a = min(a, u_local / u_fadeIn);
        if (u_fadeOut > 0.0) a = min(a, (u_duration - u_local) / u_fadeOut);
        outColor = texture(u_tex, v_uv) * clamp(a, 0.0, 1.0);
      }`,
    }],
  },
  {
    type: 'dip', name: 'Dip to Colour', category: 'Transitions', description: 'Dip from/to black (or any colour) at the clip’s edges.',
    keywords: 'fade to black',
    params: [color('dipColor', 'Colour', '#000000'), num('dipIn', 'At start', 0.5, 0, 10, 0.05, 's'), num('dipOut', 'At end', 0.5, 0, 10, 0.05, 's')],
    passes: [{
      frag: `void main() {
        float k = 0.0;
        if (u_dipIn > 0.0) k = max(k, 1.0 - u_local / u_dipIn);
        if (u_dipOut > 0.0) k = max(k, 1.0 - (u_duration - u_local) / u_dipOut);
        vec4 c = texture(u_tex, v_uv);
        outColor = vec4(mix(c.rgb, u_dipColor * c.a, clamp(k, 0.0, 1.0)), c.a);
      }`,
    }],
  },
  {
    type: 'linear-wipe', name: 'Linear Wipe', category: 'Transitions', description: 'Wipe the layer away along a direction.',
    params: [num('completion', 'Completion', 0, 0, 100, 1, '%'), num('angle', 'Angle', 0, 0, 360, 1, '°'), num('feather', 'Feather', 20, 0, 500, 1, 'px'), ANIMATE, WIPE_TIME],
    passes: [{
      frag: `void main() {
        float a = radians(u_angle);
        vec2 d = vec2(cos(a), sin(a));
        float extent = 0.5 * (abs(d.x) * u_size.x + abs(d.y) * u_size.y);
        float pos = dot((v_uv - 0.5) * u_size, d) / extent * 0.5 + 0.5;
        float f = max(u_feather * u_px, 0.5) / (2.0 * extent);
        float edge = mix(-f, 1.0 + f, wipeAmount(u_completion, u_animate, u_wipeTime));
        outColor = texture(u_tex, v_uv) * smoothstep(edge - f, edge + f, pos);
      }`,
    }],
  },
  {
    type: 'iris-wipe', name: 'Iris Wipe', category: 'Transitions', description: 'A circle closing in (or opening up).', keywords: 'circle',
    params: [num('completion', 'Completion', 0, 0, 100, 1, '%'), num('feather', 'Feather', 20, 0, 500, 1, 'px'), ANIMATE, WIPE_TIME],
    passes: [{
      frag: `void main() {
        float halfDiagonal = 0.5 * length(u_size);
        float r = length((v_uv - 0.5) * u_size) / halfDiagonal;
        float f = max(u_feather * u_px, 0.5) / halfDiagonal;
        float edge = mix(1.0 + f, -f, wipeAmount(u_completion, u_animate, u_wipeTime));
        outColor = texture(u_tex, v_uv) * (1.0 - smoothstep(edge - f, edge + f, r));
      }`,
    }],
  },
  {
    type: 'radial-wipe', name: 'Clock Wipe', category: 'Transitions', description: 'Sweep the layer away like a clock hand.',
    keywords: 'radial',
    params: [num('completion', 'Completion', 0, 0, 100, 1, '%'), num('startAngle', 'Start angle', 270, 0, 360, 1, '°'), num('feather', 'Feather', 2, 0, 45, 1, '°'), ANIMATE, WIPE_TIME],
    passes: [{
      frag: `void main() {
        vec2 p = (v_uv - 0.5) * u_size;
        float ang = fract((atan(p.y, p.x) - radians(u_startAngle)) / 6.2832 + 1.0);
        float f = u_feather / 360.0 + 0.001;
        float edge = mix(-f, 1.0 + f, wipeAmount(u_completion, u_animate, u_wipeTime));
        outColor = texture(u_tex, v_uv) * smoothstep(edge - f, edge + f, ang);
      }`,
    }],
  },
]

export const EFFECT_MAP = new Map(EFFECTS.map((e) => [e.type, e]))

export const EFFECT_CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))]

export function defaultParams(def: EffectDef): Record<string, ParamValue> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]))
}
