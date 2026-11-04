// After Effects' Color Correction category.
import { BLEND_ORIGINAL, GRID, bool, color, colorFx, deg, hexRgb, num, pct, px, blurPasses, select, type EffectDef } from '../fxlib'

const C = 'Color Correction'

/** 0 = same hue .. 1 = opposite; greys count as far from every colour. */
export const HUE_DIST = `
float hueDistance(vec3 a, vec3 b) {
  vec3 ha = rgb2hsv(a), hb = rgb2hsv(b);
  float d = abs(ha.x - hb.x);
  return max(min(d, 1.0 - d) * 2.0, 1.0 - smoothstep(0.08, 0.3, ha.y));
}
vec2 chromaUV(vec3 c) { return vec2(dot(c, vec3(-0.169, -0.331, 0.5)), dot(c, vec3(0.5, -0.419, -0.081))); }
`

/** Shadow / midtone / highlight weights that sum to 1. */
const TONES = `
vec3 toneWeights(float l) {
  float s = (1.0 - l) * (1.0 - l), h = l * l;
  return vec3(s, 1.0 - s - h, h);
}
`

const PHOTO_FILTERS: Record<string, string> = {
  'Warming (85)': '#ec8a00', 'Warming (LBA)': '#fa9600', 'Warming (81)': '#ebb113', 'Cooling (80)': '#006dff',
  'Cooling (LBB)': '#005dff', 'Cooling (82)': '#00b5ff', Red: '#ea1a1a', Orange: '#f28400', Yellow: '#f9e31c',
  Green: '#19c919', Cyan: '#1dcbea', Blue: '#1d35ea', Violet: '#9b1dea', Magenta: '#e318e3', Sepia: '#ac7a33',
  'Deep Red': '#ff0000', 'Deep Blue': '#0022cd', 'Deep Emerald': '#008c00', 'Deep Yellow': '#ffd500', Underwater: '#00c1b1',
}

export const COLOR_CORRECTION: EffectDef[] = [
  {
    type: 'ae-auto-contrast', name: 'Auto Contrast', category: C,
    description: 'Stretch the darkest and brightest parts of the frame to black and white, keeping colours in balance.',
    params: [BLEND_ORIGINAL],
    passes: [{
      frag: GRID + colorFx(`float lo = 1.0, hi = 0.0;
        for (int j = 0; j < GRID_N; j++) for (int i = 0; i < GRID_N; i++) {
          vec4 s = gridAt(i, j);
          if (s.a < 0.5) continue;
          float l = luma(s.rgb);
          lo = min(lo, l);
          hi = max(hi, l);
        }
        if (hi > lo + 0.02) rgb = mix((rgb - lo) / (hi - lo), c.rgb, u_blend / 100.0);`),
    }],
  },
  {
    type: 'ae-auto-levels', name: 'Auto Levels', category: C,
    description: 'Stretch each colour channel to the full range (also removes colour casts).',
    params: [BLEND_ORIGINAL],
    passes: [{
      frag: GRID + colorFx(`vec3 lo = vec3(1.0), hi = vec3(0.0);
        for (int j = 0; j < GRID_N; j++) for (int i = 0; i < GRID_N; i++) {
          vec4 s = gridAt(i, j);
          if (s.a < 0.5) continue;
          lo = min(lo, s.rgb);
          hi = max(hi, s.rgb);
        }
        rgb = mix(clamp((rgb - lo) / max(hi - lo, vec3(0.02)), 0.0, 1.0), c.rgb, u_blend / 100.0);`),
    }],
  },
  {
    type: 'ae-black-white', name: 'Black & White', category: C,
    description: 'Monochrome with control over how bright each colour becomes, plus an optional tint.',
    keywords: 'grayscale greyscale mono',
    params: [
      num('reds', 'Reds', 40, -200, 300), num('yellows', 'Yellows', 60, -200, 300), num('greens', 'Greens', 40, -200, 300),
      num('cyans', 'Cyans', 60, -200, 300), num('blues', 'Blues', 20, -200, 300), num('magentas', 'Magentas', 80, -200, 300),
      bool('tint', 'Tint', false), color('tintColor', 'Tint colour', '#e1d3b3'),
    ],
    passes: [{
      frag: colorFx(`float mn = min(rgb.r, min(rgb.g, rgb.b));
        vec3 d = rgb - mn;
        float y = min(d.r, d.g); d.r -= y; d.g -= y;
        float cy = min(d.g, d.b); d.g -= cy; d.b -= cy;
        float m = min(d.r, d.b); d.r -= m; d.b -= m;
        float g = mn + (d.r * u_reds + d.g * u_greens + d.b * u_blues + y * u_yellows + cy * u_cyans + m * u_magentas) / 100.0;
        g = clamp(g, 0.0, 1.0);
        rgb = u_tint > 0.5 ? (g < 0.5 ? 2.0 * g * u_tintColor : 1.0 - 2.0 * (1.0 - g) * (1.0 - u_tintColor)) : vec3(g);`),
    }],
  },
  {
    type: 'ae-broadcast-colors', name: 'Broadcast Colors', category: C,
    description: 'Keep colours within TV-safe signal levels by lowering brightness or saturation, or key out unsafe colours.',
    keywords: 'legal safe ire ntsc pal',
    params: [
      select('locale', 'Broadcast locale', ['NTSC', 'PAL']),
      select('method', 'How to make safe', ['Reduce luminance', 'Reduce saturation', 'Key out unsafe', 'Key out safe']),
      num('maxIre', 'Maximum signal', 110, 90, 120, 1, 'IRE'),
    ],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        vec3 rgb = c.rgb;
        float y = luma(rgb);
        float chroma = length(vec2(0.492 * (rgb.b - y), 0.877 * (rgb.r - y)));
        float setup = u_locale < 0.5 ? 7.5 : 0.0;
        float limit = (u_maxIre - setup) / (100.0 - setup);
        float peak = y + chroma;
        bool unsafe = peak > limit;
        float a = c.a;
        if (u_method < 0.5) { if (unsafe) rgb *= limit / peak; }
        else if (u_method < 1.5) { if (unsafe) rgb = y + (rgb - y) * clamp((limit - y) / max(chroma, 1e-4), 0.0, 1.0); }
        else if (u_method < 2.5) { if (unsafe) a = 0.0; }
        else if (!unsafe) a = 0.0;
        outColor = premul(vec4(clamp(rgb, 0.0, 1.0), a));
      }`,
    }],
  },
  {
    type: 'ae-color-neutralizer', name: 'Color Neutralizer', category: C,
    description: 'Pick the colours that should be neutral in the shadows, midtones and highlights; their casts are removed.',
    keywords: 'cc white balance cast',
    params: [
      color('shadowsUnbalance', 'Shadows unbalance', '#000000'), color('midtonesUnbalance', 'Midtones unbalance', '#808080'),
      color('highlightsUnbalance', 'Highlights unbalance', '#ffffff'), pct('strength', 'Strength', 100),
    ],
    passes: [{
      frag: TONES + colorFx(`vec3 w = toneWeights(luma(rgb));
        vec3 fix = w.x * (vec3(luma(u_shadowsUnbalance)) - u_shadowsUnbalance)
                 + w.y * (vec3(luma(u_midtonesUnbalance)) - u_midtonesUnbalance)
                 + w.z * (vec3(luma(u_highlightsUnbalance)) - u_highlightsUnbalance);
        rgb += fix * u_strength / 100.0;`),
    }],
  },
  {
    type: 'ae-color-offset', name: 'Color Offset', category: C,
    description: 'Shift the red, green and blue channels around their range for psychedelic colour.',
    keywords: 'cc phase cycle',
    params: [
      deg('redPhase', 'Red phase', 0, 0, 360), deg('greenPhase', 'Green phase', 0, 0, 360), deg('bluePhase', 'Blue phase', 0, 0, 360),
      select('overflow', 'Overflow', ['Wrap', 'Solarize', 'Polarize']),
    ],
    passes: [{
      frag: colorFx(`vec3 v = rgb + vec3(u_redPhase, u_greenPhase, u_bluePhase) / 360.0;
        rgb = u_overflow < 0.5 ? v - step(vec3(1.0001), v) : u_overflow < 1.5 ? 1.0 - abs(v - 1.0) : min(v, vec3(1.0));`),
    }],
  },
  {
    type: 'ae-kernel', name: 'Kernel', category: C,
    description: 'A custom 3×3 convolution: sharpen, blur, emboss or edge-detect with your own weights.',
    keywords: 'cc convolution matrix',
    params: [
      num('k1', 'Top left', 0, -10, 10, 0.1), num('k2', 'Top', 0, -10, 10, 0.1), num('k3', 'Top right', 0, -10, 10, 0.1),
      num('k4', 'Left', 0, -10, 10, 0.1), num('k5', 'Centre', 1, -10, 10, 0.1), num('k6', 'Right', 0, -10, 10, 0.1),
      num('k7', 'Bottom left', 0, -10, 10, 0.1), num('k8', 'Bottom', 0, -10, 10, 0.1), num('k9', 'Bottom right', 0, -10, 10, 0.1),
      bool('normalize', 'Normalise', true), bool('absolute', 'Absolute value', false),
    ],
    passes: [{
      frag: `void main() {
        vec2 t = 1.0 / u_size;
        float k[9] = float[9](u_k1, u_k2, u_k3, u_k4, u_k5, u_k6, u_k7, u_k8, u_k9);
        vec4 sum = vec4(0.0);
        float total = 0.0;
        for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
          float w = k[j * 3 + i];
          sum += w * texture(u_tex, v_uv + vec2(float(i - 1), float(j - 1)) * t);
          total += w;
        }
        if (u_normalize > 0.5 && abs(total) > 1e-4) sum /= total;
        if (u_absolute > 0.5) sum = abs(sum);
        float a = clamp(texture(u_tex, v_uv).a, 0.0, 1.0);
        outColor = vec4(clamp(sum.rgb, vec3(0.0), vec3(a)), a);
      }`,
    }],
  },
  {
    type: 'ae-toner', name: 'Toner', category: C,
    description: 'Map brightness onto two, three or five colours (duotone, tritone, pentone).',
    keywords: 'cc duotone tritone gradient map',
    params: [
      select('tones', 'Tones', ['Duotone', 'Tritone', 'Pentone']), color('highlights', 'Highlights', '#ffffff'),
      color('brights', 'Brights', '#f0d6a8'), color('midtones', 'Midtones', '#b07840'), color('darktones', 'Darktones', '#4a2a16'),
      color('shadows', 'Shadows', '#000000'), BLEND_ORIGINAL,
    ],
    passes: [{
      frag: colorFx(`float l = clamp(luma(rgb), 0.0, 1.0);
        vec3 o;
        if (u_tones < 0.5) o = mix(u_shadows, u_highlights, l);
        else if (u_tones < 1.5) o = l < 0.5 ? mix(u_shadows, u_midtones, l * 2.0) : mix(u_midtones, u_highlights, l * 2.0 - 1.0);
        else {
          float f = l * 4.0;
          o = f < 1.0 ? mix(u_shadows, u_darktones, f) : f < 2.0 ? mix(u_darktones, u_midtones, f - 1.0)
            : f < 3.0 ? mix(u_midtones, u_brights, f - 2.0) : mix(u_brights, u_highlights, f - 3.0);
        }
        rgb = mix(o, rgb, u_blend / 100.0);`),
    }],
  },
  {
    type: 'ae-change-color', name: 'Change Color', category: C,
    description: 'Change the hue, lightness and saturation of one colour in the image.',
    keywords: 'replace hue selective',
    params: [
      select('view', 'View', ['Corrected layer', 'Colour correction mask']), deg('hueTransform', 'Hue transform', 0, -180, 180),
      num('lightnessTransform', 'Lightness transform', 0, -100, 100), num('saturationTransform', 'Saturation transform', 0, -100, 100),
      color('colorToChange', 'Colour to change', '#ff0000'), pct('tolerance', 'Matching tolerance', 15), pct('softness', 'Matching softness', 5),
      select('matchColors', 'Match colours', ['Using hue', 'Using RGB', 'Using chroma']), bool('invert', 'Invert mask', false),
    ],
    passes: [{
      frag: HUE_DIST + colorFx(`float d = u_matchColors < 0.5 ? hueDistance(rgb, u_colorToChange)
          : u_matchColors < 1.5 ? distance(rgb, u_colorToChange) / 1.732 : distance(chromaUV(rgb), chromaUV(u_colorToChange)) * 1.5;
        float t = u_tolerance / 100.0;
        float m = 1.0 - smoothstep(t, t + u_softness / 100.0 + 0.001, d);
        if (u_invert > 0.5) m = 1.0 - m;
        if (u_view > 0.5) { rgb = vec3(m); }
        else {
          vec3 hsv = rgb2hsv(rgb);
          hsv.x = fract(hsv.x + u_hueTransform / 360.0 * m);
          hsv.y = clamp(hsv.y * (1.0 + u_saturationTransform / 100.0 * m), 0.0, 1.0);
          rgb = hsv2rgb(hsv);
          float L = u_lightnessTransform / 100.0 * m;
          rgb = L > 0.0 ? mix(rgb, vec3(1.0), L) : rgb * (1.0 + L);
        }`),
    }],
  },
  {
    type: 'ae-change-to-color', name: 'Change to Color', category: C,
    description: 'Turn one colour into another, keeping the shading.',
    keywords: 'replace swap hue',
    params: [
      color('fromColor', 'From', '#ff0000'), color('toColor', 'To', '#0066ff'),
      select('change', 'Change', ['Hue', 'Hue & lightness', 'Hue, lightness & saturation']),
      pct('tolerance', 'Tolerance', 15), pct('softness', 'Softness', 10), bool('viewMask', 'View correction matte', false),
    ],
    passes: [{
      frag: HUE_DIST + colorFx(`float t = u_tolerance / 100.0;
        float m = 1.0 - smoothstep(t, t + u_softness / 100.0 + 0.001, hueDistance(rgb, u_fromColor));
        vec3 hsv = rgb2hsv(rgb), f = rgb2hsv(u_fromColor), to = rgb2hsv(u_toColor);
        float dh = to.x - f.x;
        dh -= floor(dh + 0.5);
        hsv.x = fract(hsv.x + dh * m + 1.0);
        if (u_change > 0.5) hsv.z = clamp(hsv.z + (to.z - f.z) * m, 0.0, 1.0);
        if (u_change > 1.5) hsv.y = clamp(hsv.y + (to.y - f.y) * m, 0.0, 1.0);
        rgb = u_viewMask > 0.5 ? vec3(m) : hsv2rgb(hsv);`),
    }],
  },
  {
    type: 'ae-channel-mixer', name: 'Channel Mixer', category: C,
    description: 'Build each output channel from a mix of the red, green and blue inputs.',
    keywords: 'rgb matrix swap',
    params: [
      ...(['red', 'green', 'blue'] as const).flatMap((out) =>
        (['Red', 'Green', 'Blue', 'Const'] as const).map((src) =>
          num(`${out}${src}`, `${out[0].toUpperCase()}${out.slice(1)}-${src}`, out === src.toLowerCase() ? 100 : 0, -200, 200),
        ),
      ),
      bool('monochrome', 'Monochrome', false),
    ],
    passes: [{
      frag: colorFx(`vec3 o = vec3(
          dot(rgb, vec3(u_redRed, u_redGreen, u_redBlue)) + u_redConst,
          dot(rgb, vec3(u_greenRed, u_greenGreen, u_greenBlue)) + u_greenConst,
          dot(rgb, vec3(u_blueRed, u_blueGreen, u_blueBlue)) + u_blueConst) / 100.0;
        rgb = u_monochrome > 0.5 ? vec3(o.r) : o;`),
    }],
  },
  {
    type: 'ae-color-balance', name: 'Color Balance', category: C,
    description: 'Push red, green and blue separately in the shadows, midtones and highlights.',
    keywords: 'grade cast',
    params: [
      ...(['shadow', 'midtone', 'highlight'] as const).flatMap((tone) =>
        (['Red', 'Green', 'Blue'] as const).map((ch) => num(`${tone}${ch}`, `${tone[0].toUpperCase()}${tone.slice(1)} ${ch.toLowerCase()}`, 0, -100, 100)),
      ),
      bool('preserveLuminosity', 'Preserve luminosity', false),
    ],
    passes: [{
      frag: TONES + colorFx(`float l = luma(rgb);
        vec3 w = toneWeights(l);
        rgb += (w.x * vec3(u_shadowRed, u_shadowGreen, u_shadowBlue)
              + w.y * vec3(u_midtoneRed, u_midtoneGreen, u_midtoneBlue)
              + w.z * vec3(u_highlightRed, u_highlightGreen, u_highlightBlue)) / 200.0;
        if (u_preserveLuminosity > 0.5) rgb *= l / max(luma(rgb), 1e-4);`),
    }],
  },
  {
    type: 'ae-color-balance-hls', name: 'Color Balance (HLS)', category: C,
    description: 'Shift hue, lightness and saturation.',
    params: [deg('hue', 'Hue', 0, -180, 180), num('lightness', 'Lightness', 0, -100, 100), num('saturation', 'Saturation', 0, -100, 100)],
    passes: [{
      frag: colorFx(`vec3 hsv = rgb2hsv(rgb);
        hsv.x = fract(hsv.x + u_hue / 360.0 + 1.0);
        hsv.y = clamp(hsv.y * (1.0 + u_saturation / 100.0), 0.0, 1.0);
        rgb = hsv2rgb(hsv);
        rgb = u_lightness > 0.0 ? mix(rgb, vec3(1.0), u_lightness / 100.0) : rgb * (1.0 + u_lightness / 100.0);`),
    }],
  },
  {
    type: 'ae-colorama', name: 'Colorama', category: C,
    description: 'Map brightness (or another channel) through a repeating colour cycle. Animate the phase for colour cycling.',
    keywords: 'gradient map psychedelic rainbow',
    params: [
      select('phaseFrom', 'Input phase', ['Intensity', 'Red', 'Green', 'Blue', 'Hue', 'Lightness', 'Saturation', 'Alpha']),
      deg('phaseShift', 'Phase shift', 0, 0, 360), num('cycles', 'Cycle repetitions', 1, 0.1, 10, 0.1),
      select('palette', 'Output cycle', ['Hue cycle', 'Fire', 'Ice', 'Ramp grayscale', 'Golden', 'Neon']),
      num('cycleSpeed', 'Cycle speed', 0, 0, 5, 0.05, 'Hz'), BLEND_ORIGINAL,
    ],
    passes: [{
      frag: `vec3 ramp(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
        t = clamp(t, 0.0, 1.0) * 3.0;
        return t < 1.0 ? mix(a, b, t) : t < 2.0 ? mix(b, c, t - 1.0) : mix(c, d, t - 2.0);
      }
      void main() {
        vec4 c = src();
        vec3 hsv = rgb2hsv(c.rgb);
        float f = u_phaseFrom;
        float v = f < 0.5 ? luma(c.rgb) : f < 1.5 ? c.r : f < 2.5 ? c.g : f < 3.5 ? c.b : f < 4.5 ? hsv.x : f < 5.5 ? hsv.z : f < 6.5 ? hsv.y : c.a;
        float ph = fract(v * u_cycles + u_phaseShift / 360.0 + u_time * u_cycleSpeed);
        float p = u_palette;
        vec3 o = p < 0.5 ? hsv2rgb(vec3(ph, 1.0, 1.0))
          : p < 1.5 ? ramp(vec3(0.0), vec3(0.8, 0.05, 0.0), vec3(1.0, 0.75, 0.0), vec3(1.0), ph)
          : p < 2.5 ? ramp(vec3(0.0), vec3(0.0, 0.15, 0.6), vec3(0.3, 0.8, 1.0), vec3(1.0), ph)
          : p < 3.5 ? vec3(ph)
          : p < 4.5 ? ramp(vec3(0.1, 0.05, 0.0), vec3(0.55, 0.32, 0.05), vec3(1.0, 0.82, 0.3), vec3(1.0, 0.98, 0.9), ph)
          : ramp(vec3(1.0, 0.0, 0.8), vec3(0.3, 0.0, 1.0), vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 0.8), ph);
        outColor = premul(vec4(mix(o, c.rgb, u_blend / 100.0), c.a));
      }`,
    }],
  },
  {
    type: 'ae-curves', name: 'Curves', category: C,
    description: 'Reshape the tone curve of all channels or one channel, via five points from shadows to highlights.',
    keywords: 'tone contrast',
    params: [
      select('channel', 'Channel', ['RGB', 'Red', 'Green', 'Blue', 'Alpha']),
      pct('p0', 'Shadows (0%)', 0), pct('p25', 'Darks (25%)', 25), pct('p50', 'Midtones (50%)', 50), pct('p75', 'Lights (75%)', 75), pct('p100', 'Highlights (100%)', 100),
    ],
    passes: [{
      frag: `float curve(float x) {
        float pts[5] = float[5](u_p0, u_p25, u_p50, u_p75, u_p100);
        float f = clamp(x, 0.0, 1.0) * 4.0;
        int i = int(min(floor(f), 3.0));
        float t = f - float(i);
        float p1 = pts[i], p2 = pts[i + 1];
        float p0 = i == 0 ? 2.0 * p1 - p2 : pts[i - 1];
        float p3 = i == 3 ? 2.0 * p2 - p1 : pts[i + 2];
        float v = 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t);
        return clamp(v / 100.0, 0.0, 1.0);
      }
      void main() {
        vec4 c = src();
        if (u_channel < 0.5) c.rgb = vec3(curve(c.r), curve(c.g), curve(c.b));
        else if (u_channel < 1.5) c.r = curve(c.r);
        else if (u_channel < 2.5) c.g = curve(c.g);
        else if (u_channel < 3.5) c.b = curve(c.b);
        else c.a = curve(c.a);
        outColor = premul(c);
      }`,
    }],
  },
  {
    type: 'ae-equalize', name: 'Equalize', category: C,
    description: 'Spread brightness (or each channel) evenly across the range, like histogram equalisation.',
    keywords: 'histogram',
    params: [select('style', 'Equalize', ['Brightness', 'RGB']), pct('amount', 'Amount to equalize', 100)],
    passes: [{
      frag: GRID + colorFx(`vec3 cdf = vec3(0.0);
        float n = 0.0, l = luma(rgb);
        for (int j = 0; j < GRID_N; j++) for (int i = 0; i < GRID_N; i++) {
          vec4 s = gridAt(i, j);
          if (s.a < 0.5) continue;
          cdf += u_style < 0.5 ? vec3(smoothstep(-0.03, 0.03, l - luma(s.rgb))) : smoothstep(vec3(-0.03), vec3(0.03), rgb - s.rgb);
          n += 1.0;
        }
        if (n > 0.0) {
          cdf /= n;
          vec3 eq = u_style < 0.5 ? rgb * (cdf.x / max(l, 0.01)) : cdf;
          rgb = mix(rgb, eq, u_amount / 100.0);
        }`),
    }],
  },
  {
    type: 'ae-exposure', name: 'Exposure', category: C,
    description: 'Exposure in stops, plus offset and gamma, like adjusting a camera.',
    keywords: 'stops brightness',
    params: [num('exposure', 'Exposure', 0, -5, 5, 0.05), num('offset', 'Offset', 0, -0.5, 0.5, 0.005), num('gamma', 'Gamma correction', 1, 0.1, 4, 0.01)],
    passes: [{ frag: colorFx('rgb = pow(max(rgb * exp2(u_exposure) + u_offset, 0.0), vec3(1.0 / u_gamma));') }],
  },
  {
    type: 'ae-gamma-pedestal-gain', name: 'Gamma/Pedestal/Gain', category: C,
    description: 'Per-channel gamma, black level (pedestal) and gain.',
    keywords: 'lift gamma gain',
    params: [
      num('blackStretch', 'Black stretch', 1, 1, 4, 0.05),
      ...(['red', 'green', 'blue'] as const).flatMap((ch) => {
        const n = `${ch[0].toUpperCase()}${ch.slice(1)}`
        return [num(`${ch}Gamma`, `${n} gamma`, 1, 0.1, 3, 0.01), num(`${ch}Pedestal`, `${n} pedestal`, 0, -1, 1, 0.01), num(`${ch}Gain`, `${n} gain`, 1, 0, 3, 0.01)]
      }),
    ],
    passes: [{
      frag: colorFx(`rgb = mix(pow(rgb, vec3(1.0 / u_blackStretch)), rgb, rgb);
        rgb = vec3(u_redPedestal, u_greenPedestal, u_bluePedestal)
            + vec3(u_redGain, u_greenGain, u_blueGain) * pow(rgb, 1.0 / vec3(u_redGamma, u_greenGamma, u_blueGamma));`),
    }],
  },
  {
    type: 'ae-leave-color', name: 'Leave Color', category: C,
    description: 'Drain the colour from everything except one colour.',
    keywords: 'colour splash selective desaturate',
    params: [
      pct('decolor', 'Amount to decolour', 100), color('leaveColor', 'Colour to leave', '#ff0000'), pct('tolerance', 'Tolerance', 20),
      pct('softness', 'Edge softness', 10), select('matchColors', 'Match colours', ['Using hue', 'Using RGB']),
    ],
    passes: [{
      frag: HUE_DIST + colorFx(`float d = u_matchColors < 0.5 ? hueDistance(rgb, u_leaveColor) : distance(rgb, u_leaveColor) / 1.732;
        float t = u_tolerance / 100.0;
        float m = 1.0 - smoothstep(t, t + u_softness / 100.0 + 0.001, d);
        rgb = mix(rgb, vec3(luma(rgb)), (1.0 - m) * u_decolor / 100.0);`),
    }],
  },
  {
    type: 'ae-levels-individual', name: 'Levels (Individual Controls)', category: C,
    description: 'Levels with separate input black, white and gamma for red, green and blue.',
    keywords: 'gamma input output',
    params: [
      num('inBlack', 'Input black', 0, 0, 255), num('inWhite', 'Input white', 255, 0, 255), num('gamma', 'Gamma', 1, 0.1, 3, 0.01),
      num('outBlack', 'Output black', 0, 0, 255), num('outWhite', 'Output white', 255, 0, 255),
      ...(['red', 'green', 'blue'] as const).flatMap((ch) => {
        const n = `${ch[0].toUpperCase()}${ch.slice(1)}`
        return [num(`${ch}InBlack`, `${n} input black`, 0, 0, 255), num(`${ch}InWhite`, `${n} input white`, 255, 0, 255), num(`${ch}Gamma`, `${n} gamma`, 1, 0.1, 3, 0.01)]
      }),
    ],
    passes: [{
      frag: colorFx(`vec3 ib = vec3(u_redInBlack, u_greenInBlack, u_blueInBlack) / 255.0;
        vec3 iw = vec3(u_redInWhite, u_greenInWhite, u_blueInWhite) / 255.0;
        rgb = pow(clamp((rgb - ib) / max(iw - ib, vec3(0.001)), 0.0, 1.0), 1.0 / vec3(u_redGamma, u_greenGamma, u_blueGamma));
        rgb = clamp((rgb - u_inBlack / 255.0) / max((u_inWhite - u_inBlack) / 255.0, 0.001), 0.0, 1.0);
        rgb = mix(vec3(u_outBlack / 255.0), vec3(u_outWhite / 255.0), pow(rgb, vec3(1.0 / u_gamma)));`),
    }],
  },
  {
    type: 'ae-basic-grade', name: 'Basic Color Grade', category: C,
    description: 'White balance, exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation and a faded-film look in one effect.',
    keywords: 'lumetri grade temperature tint correction',
    params: [
      num('temperature', 'Temperature', 0, -100, 100), num('tint', 'Tint', 0, -100, 100), num('exposure', 'Exposure', 0, -4, 4, 0.05),
      num('contrast', 'Contrast', 0, -100, 100), num('highlights', 'Highlights', 0, -100, 100), num('shadows', 'Shadows', 0, -100, 100),
      num('whites', 'Whites', 0, -100, 100), num('blacks', 'Blacks', 0, -100, 100), num('vibrance', 'Vibrance', 0, -100, 100),
      num('saturation', 'Saturation', 100, 0, 200, 1, '%'), pct('fadedFilm', 'Faded film', 0),
    ],
    passes: [{
      frag: colorFx(`rgb *= exp2(u_exposure);
        rgb *= vec3(1.0 + u_temperature / 250.0, 1.0 - u_tint / 250.0, 1.0 - u_temperature / 250.0);
        rgb = (rgb - 0.5) * (1.0 + u_contrast / 100.0) + 0.5;
        float l = clamp(luma(rgb), 0.0, 1.0);
        rgb += u_highlights / 200.0 * smoothstep(0.4, 1.0, l) + u_shadows / 200.0 * (1.0 - smoothstep(0.0, 0.6, l));
        rgb += u_whites / 300.0 * smoothstep(0.65, 1.0, l) + u_blacks / 300.0 * (1.0 - smoothstep(0.0, 0.35, l));
        float sat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
        rgb = mix(vec3(luma(rgb)), rgb, u_saturation / 100.0 * (1.0 + u_vibrance / 100.0 * (1.0 - clamp(sat, 0.0, 1.0))));
        rgb = mix(rgb, rgb * 0.82 + 0.12, u_fadedFilm / 100.0);`),
    }],
  },
  {
    type: 'ae-photo-filter', name: 'Photo Filter', category: C,
    description: 'Simulate a coloured filter in front of the lens (warming, cooling, sepia and more).',
    keywords: 'warm cool lens',
    params: [
      { key: 'filter', label: 'Filter', type: 'select', default: 'Warming (85)', options: [...Object.keys(PHOTO_FILTERS), 'Custom'] },
      color('customColor', 'Custom colour', '#ec8a00'), pct('density', 'Density', 25), bool('preserveLuminosity', 'Preserve luminosity', true),
    ],
    passes: [{
      frag: `uniform vec3 u_filterRgb;
      ${colorFx(`float l = luma(rgb);
        rgb = mix(rgb, rgb * u_filterRgb, u_density / 100.0);
        if (u_preserveLuminosity > 0.5) rgb *= l / max(luma(rgb), 1e-4);`)}`,
      uniforms: (p) => ({ u_filterRgb: hexRgb(p.filter === 'Custom' ? String(p.customColor) : (PHOTO_FILTERS[String(p.filter)] ?? '#ec8a00')) }),
    }],
  },
  {
    type: 'ae-selective-color', name: 'Selective Color', category: C,
    description: 'Adjust cyan, magenta, yellow and black within one range of colours. Add it again for another range.',
    keywords: 'cmyk',
    params: [
      select('colors', 'Colours', ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas', 'Whites', 'Neutrals', 'Blacks']),
      num('cyan', 'Cyan', 0, -100, 100, 1, '%'), num('magenta', 'Magenta', 0, -100, 100, 1, '%'), num('yellow', 'Yellow', 0, -100, 100, 1, '%'),
      num('black', 'Black', 0, -100, 100, 1, '%'), select('method', 'Method', ['Relative', 'Absolute']),
    ],
    passes: [{
      frag: colorFx(`float mx = max(rgb.r, max(rgb.g, rgb.b)), mn = min(rgb.r, min(rgb.g, rgb.b));
        float mid = rgb.r + rgb.g + rgb.b - mx - mn;
        float sel = u_colors, w = 0.0;
        if (sel < 0.5) w = rgb.r >= mx ? mx - mid : 0.0;
        else if (sel < 1.5) w = rgb.b <= mn ? mid - mn : 0.0;
        else if (sel < 2.5) w = rgb.g >= mx ? mx - mid : 0.0;
        else if (sel < 3.5) w = rgb.r <= mn ? mid - mn : 0.0;
        else if (sel < 4.5) w = rgb.b >= mx ? mx - mid : 0.0;
        else if (sel < 5.5) w = rgb.g <= mn ? mid - mn : 0.0;
        else if (sel < 6.5) w = clamp((mn - 0.5) * 2.0, 0.0, 1.0);
        else if (sel < 7.5) w = clamp(1.0 - (abs(mx - 0.5) + abs(mn - 0.5)), 0.0, 1.0);
        else w = clamp((0.5 - mx) * 2.0, 0.0, 1.0);
        vec3 cmy = (vec3(u_cyan, u_magenta, u_yellow) + u_black) / 100.0;
        vec3 scale = u_method < 0.5 ? mix(1.0 - rgb, rgb, step(0.0, cmy)) : vec3(1.0);
        rgb -= cmy * w * scale;`),
    }],
  },
  {
    type: 'ae-shadow-highlight', name: 'Shadow/Highlight', category: C,
    description: 'Brighten shadowed subjects and recover bright areas, based on the surrounding brightness.',
    keywords: 'backlit recover lift',
    params: [pct('shadowAmount', 'Shadow amount', 50), pct('highlightAmount', 'Highlight amount', 0), px('radius', 'Radius', 40, 300), BLEND_ORIGINAL],
    passes: [
      ...blurPasses((p) => Number(p.radius)),
      {
        frag: `void main() {
          vec4 o = unpremul(texture(u_orig, v_uv));
          float local = luma(unpremul(texture(u_tex, v_uv)).rgb);
          float s = u_shadowAmount / 100.0 * (1.0 - local) * (1.0 - local);
          float h = u_highlightAmount / 100.0 * local * local;
          vec3 rgb = pow(clamp(o.rgb, 0.0, 1.0), vec3((1.0 + 2.0 * h) / (1.0 + 2.0 * s)));
          outColor = premul(vec4(mix(rgb, o.rgb, u_blend / 100.0), o.a));
        }`,
      },
    ],
  },
  {
    type: 'ae-tritone', name: 'Tritone', category: C,
    description: 'Map shadows, midtones and highlights to three colours.',
    keywords: 'gradient map duotone',
    params: [color('highlights', 'Highlights', '#ffffff'), color('midtones', 'Midtones', '#806040'), color('shadows', 'Shadows', '#000000'), BLEND_ORIGINAL],
    passes: [{
      frag: colorFx(`float l = clamp(luma(rgb), 0.0, 1.0);
        vec3 o = l < 0.5 ? mix(u_shadows, u_midtones, l * 2.0) : mix(u_midtones, u_highlights, l * 2.0 - 1.0);
        rgb = mix(o, rgb, u_blend / 100.0);`),
    }],
  },
  {
    type: 'ae-video-limiter', name: 'Video Limiter', category: C,
    description: 'Clip brightness and colour intensity to legal video levels.',
    keywords: 'broadcast legal clamp',
    params: [num('lumaMin', 'Minimum luma', 16, 0, 128), num('lumaMax', 'Maximum luma', 235, 128, 255), pct('chromaMax', 'Maximum chroma', 100)],
    passes: [{
      frag: colorFx(`float y = luma(rgb);
        vec3 ch = rgb - y;
        float cl = length(ch), maxC = u_chromaMax / 100.0 * 0.6;
        if (cl > maxC) ch *= maxC / cl;
        rgb = clamp(y, u_lumaMin / 255.0, u_lumaMax / 255.0) + ch;`),
    }],
  },
]
