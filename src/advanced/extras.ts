// A pick of light, useful effects from After Effects' Blur & Sharpen, Channel, Matte and
// Noise & Grain categories.
import { BLEND_ORIGINAL, NOISE, blurPasses, bool, choose, color, num, pct, point, px, select, type EffectDef, type EffectPass } from '../fxlib'
import type { ParamValue } from '../project'

const at = (key: string) => `vec2(u_${key}X, u_${key}Y) / 100.0`
const dirs = (p: Record<string, ParamValue>, key = 'dimensions') => ({
  h: p[key] === 'Vertical' ? [0, 0] : [1, 0],
  v: p[key] === 'Horizontal' ? [0, 0] : [0, 1],
})

/** Separable box blur along u_dir (radius u_boxRadius, comp px). */
const BOX = `uniform float u_boxRadius;
void main() {
  float r = u_boxRadius * u_px;
  if (r < 0.5 || dot(u_dir, u_dir) == 0.0) { outColor = texture(u_tex, v_uv); return; }
  float stride = max(1.0, r / 15.0);
  vec4 acc = vec4(0.0);
  float n = 0.0;
  for (int i = -15; i <= 15; i++) {
    float x = float(i) * stride;
    if (abs(x) > r) continue;
    acc += texture(u_tex, v_uv + u_dir / u_size * x);
    n += 1.0;
  }
  outColor = acc / n;
}`

/** Separable minimum/maximum along u_dir. u_mmOp: 0 max, 1 min, 2 skip; u_mmChannel: 0 colour, 1 all, 2 alpha. */
const MINMAX = `uniform float u_mmOp, u_mmRadius, u_mmChannel;
void main() {
  vec4 c = texture(u_tex, v_uv);
  float r = u_mmRadius * u_px;
  if (u_mmOp > 1.5 || r < 0.5 || dot(u_dir, u_dir) == 0.0) { outColor = c; return; }
  float stride = max(1.0, r / 15.0);
  vec4 m = c;
  for (int i = -15; i <= 15; i++) {
    float x = float(i) * stride;
    if (abs(x) > r) continue;
    vec4 s = texture(u_tex, v_uv + u_dir / u_size * x);
    m = u_mmOp < 0.5 ? max(m, s) : min(m, s);
  }
  if (u_mmChannel < 0.5) m = vec4(min(m.rgb, vec3(c.a)), c.a);
  else if (u_mmChannel > 1.5) m = vec4(unpremul(c).rgb * m.a, m.a);
  outColor = m;
}`
const minmaxPass = (u: (p: Record<string, ParamValue>) => { op: number; radius: number; channel: number; dir: number[] }): EffectPass => ({
  frag: MINMAX,
  uniforms: (p) => {
    const { op, radius, channel, dir } = u(p)
    return { u_mmOp: op, u_mmRadius: radius, u_mmChannel: channel, u_dir: dir }
  },
})

/** Per-channel median of a 3x3 neighbourhood spaced r texture px apart (McGuire's min/max network). */
const MEDIAN = `#define s2(a, b) tmp = a; a = min(a, b); b = max(tmp, b);
#define mn3(a, b, c) s2(a, b); s2(a, c);
#define mx3(a, b, c) s2(b, c); s2(a, c);
#define mnmx3(a, b, c) mx3(a, b, c); s2(a, b);
#define mnmx4(a, b, c, d) s2(a, b); s2(c, d); s2(a, c); s2(b, d);
#define mnmx5(a, b, c, d, e) s2(a, b); s2(c, d); mn3(a, c, e); mx3(b, d, e);
#define mnmx6(a, b, c, d, e, f) s2(a, d); s2(b, e); s2(c, f); mn3(a, b, c); mx3(d, e, f);
vec4 median9(vec2 uv, float r) {
  vec4 v[9];
  vec2 t = r / u_size;
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) v[j * 3 + i] = texture(u_tex, uv + vec2(float(i - 1), float(j - 1)) * t);
  vec4 tmp;
  mnmx6(v[0], v[1], v[2], v[3], v[4], v[5]);
  mnmx5(v[1], v[2], v[3], v[4], v[6]);
  mnmx4(v[2], v[3], v[4], v[7]);
  mnmx3(v[3], v[4], v[8]);
  return v[4];
}
`

const SOURCES = ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Hue', 'Lightness', 'Saturation', 'Full on', 'Full off']

const B = 'Blur & Sharpen'
const CH = 'Channel'
const N = 'Noise & Grain'

export const EXTRAS: EffectDef[] = [
  // ---- Blur & Sharpen --------------------------------------------------------------------------
  {
    type: 'ae-camera-lens-blur', name: 'Camera Lens Blur', category: B,
    description: 'Lens-like blur with shaped bokeh and glowing highlights.',
    keywords: 'bokeh defocus iris',
    params: [
      px('radius', 'Blur radius', 10, 100), select('iris', 'Iris shape', ['Circle', 'Hexagon', 'Octagon', 'Triangle', 'Square']),
      pct('highlightGain', 'Specular brightness', 50), pct('highlightThreshold', 'Specular threshold', 80),
    ],
    passes: [{
      frag: `void main() {
        float r = u_radius * u_px;
        if (r < 0.5) { outColor = texture(u_tex, v_uv); return; }
        float sides = u_iris < 0.5 ? 0.0 : u_iris < 1.5 ? 6.0 : u_iris < 2.5 ? 8.0 : u_iris < 3.5 ? 3.0 : 4.0;
        vec4 acc = vec4(0.0);
        float total = 0.0;
        for (int i = 0; i < 48; i++) {
          float a = float(i) * 2.39996;
          float rr = sqrt((float(i) + 0.5) / 48.0);
          if (sides > 0.0) { float seg = 6.2832 / sides; rr *= cos(3.14159 / sides) / cos(mod(a, seg) - seg * 0.5); }
          vec4 s = texture(u_tex, v_uv + vec2(cos(a), sin(a)) * rr * r / u_size);
          float w = 1.0 + u_highlightGain / 100.0 * 4.0 * smoothstep(u_highlightThreshold / 100.0, 1.0, luma(unpremul(s).rgb));
          acc += s * w;
          total += w;
        }
        outColor = acc / total;
      }`,
    }],
  },
  {
    type: 'ae-radial-blur', name: 'Radial Blur', category: B,
    description: 'Spin the layer around a centre, or zoom out from it.',
    keywords: 'spin zoom rotate motion',
    params: [num('amount', 'Amount', 10, 0, 100), ...point('center', 'Centre'), select('kind', 'Type', ['Spin', 'Zoom'])],
    passes: [{
      frag: `void main() {
        vec2 aspect = vec2(u_size.x / u_size.y, 1.0);
        vec2 c = ${at('center')};
        vec2 p = (v_uv - c) * aspect;
        vec4 acc = vec4(0.0);
        for (int i = 0; i < 32; i++) {
          float t = float(i) / 31.0 - 0.5;
          vec2 q;
          if (u_kind < 0.5) { float a = t * radians(u_amount * 0.9); q = mat2(cos(a), sin(a), -sin(a), cos(a)) * p; }
          else q = p * (1.0 - (t + 0.5) * u_amount / 100.0 * 0.5);
          acc += tap(c + q / aspect);
        }
        outColor = acc / 32.0;
      }`,
    }],
  },
  {
    type: 'ae-channel-blur', name: 'Channel Blur', category: B,
    description: 'Blur red, green, blue and alpha by different amounts.',
    keywords: 'chromatic',
    params: [
      px('redBlur', 'Red blurriness', 0, 200), px('greenBlur', 'Green blurriness', 0, 200), px('blueBlur', 'Blue blurriness', 10, 200),
      px('alphaBlur', 'Alpha blurriness', 0, 200), select('dimensions', 'Blur dimensions', ['Both', 'Horizontal', 'Vertical']),
    ],
    passes: (['h', 'v'] as const).map((d) => ({
      frag: `void main() {
        vec4 r = vec4(u_redBlur, u_greenBlur, u_blueBlur, u_alphaBlur) * u_px;
        float rmax = max(max(r.x, r.y), max(r.z, r.w));
        if (rmax < 0.5 || dot(u_dir, u_dir) == 0.0) { outColor = texture(u_tex, v_uv); return; }
        vec4 sigma = max(r / 2.0, vec4(0.5));
        float stride = max(1.0, rmax / 20.0);
        vec4 acc = vec4(0.0), total = vec4(0.0);
        for (int i = -20; i <= 20; i++) {
          float x = float(i) * stride;
          if (abs(x) > rmax) continue;
          vec4 w = exp(-0.5 * x * x / (sigma * sigma)) * step(vec4(abs(x)), r + 0.5);
          acc += texture(u_tex, v_uv + u_dir / u_size * x) * w;
          total += w;
        }
        vec4 o = acc / total;
        outColor = vec4(min(o.rgb, vec3(o.a)), o.a);
      }`,
      uniforms: (p: Record<string, ParamValue>) => ({ u_dir: dirs(p)[d] }),
    })),
  },
  {
    type: 'ae-fast-box-blur', name: 'Fast Box Blur', category: B,
    description: 'A quick blur; more iterations look smoother.',
    keywords: 'soften fast',
    params: [px('radius', 'Blur radius', 10, 200), num('iterations', 'Iterations', 2, 1, 3), select('dimensions', 'Blur dimensions', ['Both', 'Horizontal', 'Vertical'])],
    passes: [0, 1, 2].flatMap((k) =>
      (['h', 'v'] as const).map((d) => ({
        frag: BOX,
        uniforms: (p: Record<string, ParamValue>) => ({ u_boxRadius: Number(p.radius), u_dir: k < Number(p.iterations) ? dirs(p)[d] : [0, 0] }),
      })),
    ),
  },
  {
    type: 'ae-unsharp-mask', name: 'Unsharp Mask', category: B,
    description: 'Sharpen by boosting contrast around edges, with radius and threshold control.',
    keywords: 'sharpen detail crisp',
    params: [num('amount', 'Amount', 50, 0, 500, 1, '%'), px('radius', 'Radius', 2, 100), num('threshold', 'Threshold', 0, 0, 255)],
    passes: [
      ...blurPasses((p) => Number(p.radius)),
      {
        frag: `void main() {
          vec4 o = texture(u_orig, v_uv), b = texture(u_tex, v_uv);
          vec4 d = o - b;
          if (max(abs(d.r), max(abs(d.g), abs(d.b))) * 255.0 < u_threshold) d = vec4(0.0);
          vec4 s = o + d * u_amount / 100.0;
          outColor = vec4(clamp(s.rgb, vec3(0.0), vec3(o.a)), o.a);
        }`,
      },
    ],
  },
  {
    type: 'ae-smart-blur', name: 'Smart Blur', category: B,
    description: 'Blur flat areas but keep edges sharp (or draw just the edges).',
    keywords: 'bilateral denoise skin smooth',
    params: [px('radius', 'Radius', 3, 20, 1), num('threshold', 'Threshold', 25, 1, 100), select('mode', 'Mode', ['Normal', 'Edge only', 'Edge overlay'])],
    passes: [{
      frag: `void main() {
        vec4 c = texture(u_tex, v_uv);
        vec3 cc = unpremul(c).rgb;
        if (u_mode > 0.5) {
          float e = step(u_threshold / 100.0 * 0.6, sobel(v_uv));
          outColor = u_mode < 1.5 ? vec4(vec3(e) * c.a, c.a) : vec4(mix(c.rgb, vec3(c.a), e), c.a);
          return;
        }
        float stride = u_radius * u_px / 3.0, sc = u_threshold / 100.0 * 0.5 + 0.01;
        vec4 acc = vec4(0.0);
        float total = 0.0;
        for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
          vec4 s = texture(u_tex, v_uv + vec2(float(i), float(j)) * stride / u_size);
          vec3 d = unpremul(s).rgb - cc;
          float w = exp(-dot(d, d) / (2.0 * sc * sc));
          acc += s * w;
          total += w;
        }
        outColor = acc / total;
      }`,
    }],
  },

  // ---- Channel -----------------------------------------------------------------------------------
  {
    type: 'ae-invert', name: 'Invert', category: CH,
    description: 'Invert colours, one channel, hue, saturation, lightness, luminance or alpha.',
    keywords: 'negative',
    params: [select('channel', 'Channel', ['RGB', 'Red', 'Green', 'Blue', 'HLS lightness', 'Hue', 'Saturation', 'YIQ luminance', 'Alpha']), BLEND_ORIGINAL],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        vec4 o = c;
        vec3 hsv = rgb2hsv(c.rgb);
        float ch = u_channel;
        if (ch < 0.5) o.rgb = 1.0 - c.rgb;
        else if (ch < 1.5) o.r = 1.0 - c.r;
        else if (ch < 2.5) o.g = 1.0 - c.g;
        else if (ch < 3.5) o.b = 1.0 - c.b;
        else if (ch < 4.5) o.rgb = hsv2rgb(vec3(hsv.xy, 1.0 - hsv.z));
        else if (ch < 5.5) o.rgb = hsv2rgb(vec3(fract(hsv.x + 0.5), hsv.yz));
        else if (ch < 6.5) o.rgb = hsv2rgb(vec3(hsv.x, 1.0 - hsv.y, hsv.z));
        else if (ch < 7.5) o.rgb = clamp(c.rgb + 1.0 - 2.0 * luma(c.rgb), 0.0, 1.0);
        else o.a = 1.0 - c.a;
        outColor = premul(mix(o, c, u_blend / 100.0));
      }`,
    }],
  },
  {
    type: 'ae-minimax', name: 'Minimax', category: CH,
    description: 'Spread the brightest (maximum) or darkest (minimum) pixels: grow or shrink highlights and mattes.',
    keywords: 'dilate erode grow shrink',
    params: [
      select('operation', 'Operation', ['Maximum', 'Minimum', 'Minimum then maximum', 'Maximum then minimum']), px('radius', 'Radius', 3, 50),
      select('channel', 'Channel', ['Colour', 'Alpha and colour', 'Alpha']), select('direction', 'Direction', ['Both', 'Horizontal', 'Vertical']),
    ],
    passes: [0, 1, 2, 3].map((i) =>
      minmaxPass((p) => {
        const op = ['Maximum', 'Minimum', 'Minimum then maximum', 'Maximum then minimum'].indexOf(String(p.operation))
        const first = op === 0 || op === 3 ? 0 : 1
        const second = op === 2 ? 0 : op === 3 ? 1 : 2
        const d = dirs(p, 'direction')
        return { op: i < 2 ? first : second, radius: Number(p.radius), channel: ['Colour', 'Alpha and colour', 'Alpha'].indexOf(String(p.channel)), dir: i % 2 ? d.v : d.h }
      }),
    ),
  },
  {
    type: 'ae-shift-channels', name: 'Shift Channels', category: CH,
    description: 'Build red, green, blue and alpha from any channel of the layer.',
    keywords: 'swap channels',
    params: [
      choose('takeRed', 'Take red from', SOURCES, 'Red'), choose('takeGreen', 'Take green from', SOURCES, 'Green'),
      choose('takeBlue', 'Take blue from', SOURCES, 'Blue'), choose('takeAlpha', 'Take alpha from', SOURCES, 'Alpha'),
    ],
    passes: [{
      frag: `float pick(vec4 c, vec3 hsv, float s) {
        return s < 0.5 ? c.r : s < 1.5 ? c.g : s < 2.5 ? c.b : s < 3.5 ? c.a : s < 4.5 ? luma(c.rgb)
          : s < 5.5 ? hsv.x : s < 6.5 ? hsv.z : s < 7.5 ? hsv.y : s < 8.5 ? 1.0 : 0.0;
      }
      void main() {
        vec4 c = src();
        vec3 hsv = rgb2hsv(c.rgb);
        outColor = premul(vec4(pick(c, hsv, u_takeRed), pick(c, hsv, u_takeGreen), pick(c, hsv, u_takeBlue), pick(c, hsv, u_takeAlpha)));
      }`,
    }],
  },
  {
    type: 'ae-solid-composite', name: 'Solid Composite', category: CH,
    description: 'Composite the layer over a solid colour, with a blending mode.',
    keywords: 'background matte fill',
    params: [
      pct('sourceOpacity', 'Source opacity', 100), color('solidColor', 'Colour', '#000000'), pct('opacity', 'Opacity', 100),
      select('blendMode', 'Blending mode', ['Normal', 'Multiply', 'Screen', 'Add', 'Overlay', 'Difference']),
    ],
    passes: [{
      frag: `void main() {
        vec4 s = texture(u_tex, v_uv) * u_sourceOpacity / 100.0;
        vec3 b = u_solidColor, f = unpremul(s).rgb;
        float m = u_blendMode, ba = u_opacity / 100.0;
        vec3 bl = m < 0.5 ? f : m < 1.5 ? b * f : m < 2.5 ? b + f - b * f : m < 3.5 ? min(b + f, 1.0)
          : m < 4.5 ? mix(2.0 * b * f, 1.0 - 2.0 * (1.0 - b) * (1.0 - f), step(0.5, b)) : abs(b - f);
        bl = mix(f, bl, ba);
        outColor = vec4(bl * s.a + b * ba * (1.0 - s.a), s.a + ba * (1.0 - s.a));
      }`,
    }],
  },
  {
    type: 'ae-remove-color-matting', name: 'Remove Color Matting', category: CH,
    description: 'Remove dark (or coloured) fringes from footage premultiplied against a background colour.',
    keywords: 'fringe halo premultiplied unmultiply',
    params: [color('background', 'Background colour', '#000000')],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        if (c.a <= 0.0) { outColor = vec4(0.0); return; }
        vec3 fg = clamp((c.rgb - u_background * (1.0 - c.a)) / c.a, 0.0, 1.0);
        outColor = premul(vec4(fg, c.a));
      }`,
    }],
  },

  // ---- Matte -------------------------------------------------------------------------------------
  {
    type: 'ae-simple-choker', name: 'Simple Choker', category: 'Matte',
    description: 'Shrink (positive) or spread (negative) the edges of a matte, e.g. after keying.',
    keywords: 'choke erode dilate matte key edge',
    params: [num('choke', 'Choke matte', 0, -100, 100, 0.1, 'px'), select('view', 'View', ['Final output', 'Matte'])],
    passes: [
      ...[0, 1].map((i) => minmaxPass((p) => ({ op: Number(p.choke) >= 0 ? 1 : 0, radius: Math.abs(Number(p.choke)), channel: 2, dir: i ? [0, 1] : [1, 0] }))),
      { frag: 'void main() { vec4 c = texture(u_tex, v_uv); outColor = u_view > 0.5 ? vec4(vec3(c.a), 1.0) : c; }' },
    ],
  },

  // ---- Noise & Grain -----------------------------------------------------------------------------
  {
    type: 'ae-fractal-noise', name: 'Fractal Noise', category: N,
    description: 'Animated fractal noise: clouds, smoke, fire, textures and organic backgrounds.',
    keywords: 'clouds smoke texture turbulent noise perlin',
    params: [
      select('fractalType', 'Fractal type', ['Basic', 'Turbulent smooth', 'Turbulent sharp']), bool('invert', 'Invert', false),
      num('contrast', 'Contrast', 100, 0, 400, 1, '%'), num('brightness', 'Brightness', 0, -100, 100), px('noiseScale', 'Scale', 100, 2000, 4),
      num('complexity', 'Complexity', 6, 1, 10), num('evolution', 'Evolution', 0, -3600, 3600, 1, '°'), num('evolutionSpeed', 'Evolution speed', 0.2, 0, 10, 0.05),
      pct('opacity', 'Opacity', 100), select('blendMode', 'Blending mode', ['Normal', 'Add', 'Multiply', 'Screen', 'Overlay', 'Soft light']),
    ],
    passes: [{
      frag: `${NOISE}
      void main() {
        vec4 c = src();
        vec2 q = v_uv * u_size / max(u_noiseScale * u_px, 1.0);
        float n = fbm(q, u_evolution / 360.0 + u_time * u_evolutionSpeed, u_complexity, u_fractalType > 0.5 ? 1.0 : 0.0);
        if (u_fractalType > 1.5) n = pow(n, 0.55);
        n = clamp((n - 0.5) * u_contrast / 100.0 + 0.5 + u_brightness / 100.0, 0.0, 1.0);
        if (u_invert > 0.5) n = 1.0 - n;
        float m = u_blendMode;
        vec3 b = c.rgb, v = vec3(n);
        vec3 bl = m < 0.5 ? v : m < 1.5 ? min(b + v, 1.0) : m < 2.5 ? b * v : m < 3.5 ? b + v - b * v
          : m < 4.5 ? mix(2.0 * b * v, 1.0 - 2.0 * (1.0 - b) * (1.0 - v), step(0.5, b)) : mix(b - (1.0 - 2.0 * v) * b * (1.0 - b), b + (2.0 * v - 1.0) * (sqrt(b) - b), step(0.5, v));
        float k = u_opacity / 100.0;
        float a = m < 0.5 ? mix(c.a, 1.0, k) : c.a;
        outColor = premul(vec4(mix(b, bl, k), a));
      }`,
    }],
  },
  {
    type: 'ae-median', name: 'Median', category: N,
    description: 'Replace each pixel with the median of its neighbours: removes speckles, paint-like at bigger radii.',
    keywords: 'denoise despeckle',
    params: [px('radius', 'Radius', 1, 10, 1)],
    passes: [{ frag: `${MEDIAN}void main() { outColor = median9(v_uv, u_radius * u_px); }` }],
  },
  {
    type: 'ae-dust-scratches', name: 'Dust & Scratches', category: N,
    description: 'Remove small specks that differ from their surroundings by more than a threshold.',
    keywords: 'denoise clean restore',
    params: [px('radius', 'Radius', 2, 10, 1), num('threshold', 'Threshold', 20, 0, 255)],
    passes: [{
      frag: `${MEDIAN}void main() {
        vec4 c = texture(u_tex, v_uv), m = median9(v_uv, u_radius * u_px);
        vec4 d = abs(c - m);
        outColor = max(max(d.r, d.g), max(d.b, d.a)) * 255.0 > u_threshold ? m : c;
      }`,
    }],
  },
  {
    type: 'ae-noise-hls', name: 'Noise HLS', category: N,
    description: 'Noise in hue, lightness and saturation separately, with grain size.',
    keywords: 'grain film',
    params: [
      select('noiseType', 'Noise', ['Uniform', 'Squared', 'Grain']), num('hue', 'Hue', 0, 0, 100), num('lightness', 'Lightness', 20, 0, 100),
      num('saturation', 'Saturation', 0, 0, 100), px('grainSize', 'Grain size', 1, 20, 1), bool('animated', 'Animated', true),
    ],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        float g = max(u_grainSize * u_px, 1.0);
        vec2 q = floor(v_uv * u_size / g);
        float seed = u_animated > 0.5 ? floor(u_time * 24.0) : 0.0;
        vec3 n = vec3(hash(q + seed * 13.1), hash(q * 1.31 + seed * 7.7 + 3.1), hash(q * 1.73 + seed * 3.3 + 9.2)) - 0.5;
        if (u_noiseType > 0.5) n = sign(n) * n * n * 4.0;
        if (u_noiseType > 1.5) n *= 0.5 + hash(floor(q / 3.0) + seed);
        vec3 hsv = rgb2hsv(c.rgb);
        hsv.x = fract(hsv.x + n.x * u_hue / 100.0 + 1.0);
        hsv.z = clamp(hsv.z + n.y * u_lightness / 100.0, 0.0, 1.0);
        hsv.y = clamp(hsv.y + n.z * u_saturation / 100.0, 0.0, 1.0);
        outColor = premul(vec4(hsv2rgb(hsv), c.a));
      }`,
    }],
  },
]
