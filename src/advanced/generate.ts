// A pick of light, useful effects from After Effects' Generate, Keying, Transition and Simulation categories.
import { ANIMATE, BLEND_ORIGINAL, GEN, GEN_BLEND, WIPE_TIME, bool, color, deg, num, pct, point, px, select, type EffectDef } from '../fxlib'
import { HUE_DIST } from './color'

const at = (key: string) => `vec2(u_${key}X, u_${key}Y) / 100.0`
/** A generator: `body` sets the premultiplied vec4 `g`, drawn over the layer with the chosen blend mode. */
const gen = (body: string, helpers = '') => `${GEN}${helpers}
void main() {
  vec2 P = v_uv * u_size;
  vec4 base = texture(u_tex, v_uv);
  vec4 g = vec4(0.0);
  ${body}
  outColor = genBlend(base, g);
}`

const G = 'Generate'
const K = 'Keying'
const T = 'Transition'
const S = 'Simulation'

export const GENERATE: EffectDef[] = [
  // ---- Generate -------------------------------------------------------------------------------
  {
    type: 'ae-checkerboard', name: 'Checkerboard', category: G,
    description: 'A checkerboard pattern.', keywords: 'chess grid pattern',
    params: [...point('anchor', 'Anchor'), px('checkSize', 'Size', 60, 1000, 2), color('checkColor', 'Colour', '#ffffff'), pct('opacity', 'Opacity', 100), GEN_BLEND],
    passes: [{
      frag: gen(`vec2 q = (P - ${at('anchor')} * u_size) / max(u_checkSize * u_px, 1.0);
        float k = mod(floor(q.x) + floor(q.y), 2.0) * u_opacity / 100.0;
        g = vec4(u_checkColor, 1.0) * k;`),
    }],
  },
  {
    type: 'ae-circle', name: 'Circle', category: G,
    description: 'A filled circle or ring, with feathered edges.', keywords: 'disc ring dot shape',
    params: [
      ...point('center', 'Centre'), px('radius', 'Radius', 100, 2000), bool('ring', 'Ring', false), px('thickness', 'Ring thickness', 10, 500, 1),
      px('feather', 'Feather', 1, 200), bool('invert', 'Invert circle', false), color('fillColor', 'Colour', '#ffffff'), pct('opacity', 'Opacity', 100), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`float d = length(P - ${at('center')} * u_size);
        float R = u_radius * u_px, f = u_feather * u_px + 0.5;
        float k = 1.0 - smoothstep(R - f, R, d);
        if (u_ring > 0.5) k *= smoothstep(R - u_thickness * u_px - f, R - u_thickness * u_px, d);
        if (u_invert > 0.5) k = 1.0 - k;
        g = vec4(u_fillColor, 1.0) * k * u_opacity / 100.0;`),
    }],
  },
  {
    type: 'ae-ellipse', name: 'Ellipse', category: G,
    description: 'A glowing elliptical ring with inside and outside colours.', keywords: 'oval ring neon',
    params: [
      ...point('center', 'Centre'), px('width', 'Width', 400, 4000, 1), px('height', 'Height', 240, 4000, 1), px('thickness', 'Thickness', 24, 500, 1),
      pct('softness', 'Softness', 30), color('insideColor', 'Inside colour', '#ffffff'), color('outsideColor', 'Outside colour', '#2d8ceb'), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`vec2 radii = vec2(u_width, u_height) * 0.5 * u_px;
        vec2 q = (P - ${at('center')} * u_size) / max(radii, vec2(1.0));
        float dist = abs(length(q) - 1.0) * min(radii.x, radii.y);
        float t = max(u_thickness * u_px * 0.5, 0.5);
        float k = 1.0 - smoothstep(t * (1.0 - u_softness / 100.0), t, dist);
        g = vec4(mix(u_outsideColor, u_insideColor, 1.0 - smoothstep(0.0, t, dist * 1.6)), 1.0) * k;`),
    }],
  },
  {
    type: 'ae-grid', name: 'Grid', category: G,
    description: 'Grid lines over the layer.', keywords: 'lines graph paper',
    params: [
      ...point('anchor', 'Anchor'), px('cellWidth', 'Cell width', 80, 1000, 2), px('cellHeight', 'Cell height', 80, 1000, 2), px('border', 'Border', 2, 100),
      bool('invert', 'Invert grid', false), color('gridColor', 'Colour', '#ffffff'), pct('opacity', 'Opacity', 100), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`vec2 cell = max(vec2(u_cellWidth, u_cellHeight) * u_px, vec2(1.0));
        vec2 q = mod(P - ${at('anchor')} * u_size, cell);
        vec2 e = min(q, cell - q);
        float k = 1.0 - smoothstep(u_border * u_px * 0.5 - 0.5, u_border * u_px * 0.5 + 0.5, min(e.x, e.y));
        if (u_invert > 0.5) k = 1.0 - k;
        g = vec4(u_gridColor, 1.0) * k * u_opacity / 100.0;`),
    }],
  },
  {
    type: 'ae-cell-pattern', name: 'Cell Pattern', category: G,
    description: 'Animated cellular patterns: bubbles, crystals and plates.', keywords: 'voronoi worley cells organic',
    params: [
      select('pattern', 'Cell pattern', ['Bubbles', 'Crystals', 'Plates']), bool('invert', 'Invert', false), px('cellSize', 'Size', 60, 500, 4),
      pct('disperse', 'Disperse', 100), deg('evolution', 'Evolution', 0), num('evolutionSpeed', 'Evolution speed', 0.3, 0, 10, 0.05), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`vec2 q = P / max(u_cellSize * u_px, 2.0);
        vec2 id = floor(q);
        float f1 = 9.0, f2 = 9.0, best = 0.0;
        float evo = radians(u_evolution) + u_time * u_evolutionSpeed * 6.2832;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = id + vec2(float(i), float(j));
          vec2 o = 0.5 + 0.5 * u_disperse / 100.0 * sin(evo + 6.2832 * vec2(hash(c), hash(c + 7.7)));
          float d = length(c + o - q);
          if (d < f1) { f2 = f1; f1 = d; best = hash(c + 3.3); } else if (d < f2) f2 = d;
        }
        float v = u_pattern < 0.5 ? clamp(1.0 - f1, 0.0, 1.0) : u_pattern < 1.5 ? clamp((f2 - f1) * 2.0, 0.0, 1.0) : best;
        if (u_invert > 0.5) v = 1.0 - v;
        g = vec4(vec3(v), 1.0);`),
    }],
  },
  {
    type: 'ae-fractal', name: 'Fractal', category: G,
    description: 'Mandelbrot and Julia set fractals, zoomable and colour-cycled.', keywords: 'mandelbrot julia math',
    params: [
      select('fractalSet', 'Set', ['Mandelbrot', 'Julia']), num('centerX', 'X', -0.5, -2, 2, 0.001), num('centerY', 'Y', 0, -2, 2, 0.001),
      num('zoom', 'Zoom', 0, 0, 16, 0.01), num('iterations', 'Iterations', 100, 10, 500), num('colorCycles', 'Colour cycles', 3, 0.1, 20, 0.1),
      num('juliaX', 'Julia X', -0.8, -2, 2, 0.001), num('juliaY', 'Julia Y', 0.156, -2, 2, 0.001), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`vec2 aspect = vec2(u_size.x / u_size.y, 1.0);
        vec2 c = (v_uv - 0.5) * aspect * 3.0 / exp2(u_zoom) + vec2(u_centerX, u_centerY);
        vec2 z = u_fractalSet > 0.5 ? c : vec2(0.0);
        vec2 k = u_fractalSet > 0.5 ? vec2(u_juliaX, u_juliaY) : c;
        float n = 0.0;
        for (int i = 0; i < 500; i++) {
          if (float(i) >= u_iterations || dot(z, z) > 256.0) break;
          z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + k;
          n += 1.0;
        }
        vec3 rgb = vec3(0.0);
        if (n < u_iterations) {
          float sm = n - log2(log2(dot(z, z))) + 4.0;
          rgb = hsv2rgb(vec3(fract(sm / u_iterations * u_colorCycles), 0.8, 1.0));
        }
        g = vec4(rgb, 1.0);`),
    }],
  },
  {
    type: 'ae-lens-flare', name: 'Lens Flare', category: G,
    description: 'A bright lens flare with streaks and ghost reflections.', keywords: 'sun glare light',
    params: [
      ...point('flareCenter', 'Flare centre', 25, 25), num('brightness', 'Flare brightness', 100, 0, 300, 1, '%'),
      select('lensType', 'Lens type', ['50-300mm zoom', '35mm prime', '105mm prime']), BLEND_ORIGINAL,
    ],
    passes: [{
      frag: `void main() {
        vec2 aspect = vec2(u_size.x / u_size.y, 1.0);
        vec2 f = ${at('flareCenter')};
        vec2 p = (v_uv - f) * aspect;
        float b = u_brightness / 100.0, d = length(p);
        vec3 fl = vec3(1.0, 0.95, 0.85) * (exp(-d * 18.0) * 1.5 + exp(-d * 4.0) * 0.25);
        fl += vec3(1.0, 0.9, 0.8) * exp(-abs(p.y) * 160.0) * exp(-abs(p.x) * 2.5) * 0.6;
        if (u_lensType < 0.5 || u_lensType > 1.5) fl += vec3(0.9, 0.95, 1.0) * exp(-abs(p.x) * 160.0) * exp(-abs(p.y) * 3.5) * 0.3;
        vec2 axis = (vec2(0.5) - f) * aspect;
        for (int i = 0; i < 6; i++) {
          float t = 0.4 + float(i) * 0.33 + (u_lensType > 0.5 ? 0.15 : 0.0);
          float r = 0.02 + 0.03 * fract(float(i) * 0.618 + u_lensType * 0.2);
          float gd = length(p - axis * t * 2.0);
          vec3 tint = hsv2rgb(vec3(fract(0.08 + float(i) * 0.15), 0.6, 1.0));
          fl += tint * (smoothstep(r, r * 0.6, gd) * 0.12 + smoothstep(r * 1.3, r * 1.1, gd) * smoothstep(r * 0.9, r * 1.1, gd) * 0.15);
        }
        fl *= b;
        vec4 c = texture(u_tex, v_uv);
        float a = max(c.a, clamp(max(fl.r, max(fl.g, fl.b)), 0.0, 1.0));
        vec4 o = vec4(min(c.rgb + fl, vec3(a)), a);
        outColor = mix(o, c, u_blend / 100.0);
      }`,
    }],
  },
  {
    type: 'ae-radio-waves', name: 'Radio Waves', category: G,
    description: 'Rings pulsing out from a point, fading as they expand.', keywords: 'pulse rings sonar ripple',
    params: [
      ...point('producer', 'Producer point'), num('frequency', 'Frequency', 1, 0.1, 10, 0.1, 'Hz'), num('expansion', 'Expansion speed', 200, 10, 2000, 1, 'px/s'),
      num('lifespan', 'Lifespan', 3, 0.5, 20, 0.1, 's'), px('stroke', 'Stroke width', 6, 100, 1), select('shape', 'Wave type', ['Circle', 'Square', 'Triangle', 'Hexagon']),
      color('waveColor', 'Colour', '#ffffff'), pct('fadeOut', 'Fade out', 100), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`vec2 d = P - ${at('producer')} * u_size;
        float sides = u_shape < 0.5 ? 0.0 : u_shape < 1.5 ? 4.0 : u_shape < 2.5 ? 3.0 : 6.0;
        float r = length(d);
        if (sides > 0.0) { float seg = 6.2832 / sides; float a = atan(d.y, d.x) + 1.5708; r *= cos(mod(a, seg) - seg * 0.5) / cos(3.14159 / sides); }
        float newest = floor(u_local * u_frequency), k = 0.0;
        for (int i = 0; i < 60; i++) {
          float emit = newest - float(i);
          if (emit < 0.0) break;
          float age = u_local - emit / u_frequency;
          if (age > u_lifespan) break;
          float ring = 1.0 - smoothstep(u_stroke * u_px * 0.5 - 1.0, u_stroke * u_px * 0.5 + 1.0, abs(r - age * u_expansion * u_px));
          k = max(k, ring * (1.0 - u_fadeOut / 100.0 * age / u_lifespan));
        }
        g = vec4(u_waveColor, 1.0) * k;`),
    }],
  },
  {
    type: 'ae-light-rays', name: 'Light Rays', category: G,
    description: 'God rays streaming from a point through the bright parts of the layer.', keywords: 'cc volumetric god rays sun beams',
    params: [pct('intensity', 'Intensity', 100), ...point('center', 'Centre', 50, 30), pct('radius', 'Radius', 40), color('rayColor', 'Colour', '#fff2d0'), bool('raysOnly', 'Rays only', false)],
    passes: [{
      frag: `void main() {
        vec2 c = ${at('center')};
        vec3 acc = vec3(0.0);
        float decay = 1.0;
        for (int i = 0; i < 40; i++) {
          vec2 uv = mix(v_uv, c, float(i) / 40.0 * u_radius / 100.0 * 1.5);
          vec4 s = unpremul(texture(u_tex, uv));
          acc += s.rgb * smoothstep(0.5, 1.0, luma(s.rgb)) * s.a * decay;
          decay *= 0.96;
        }
        vec3 rays = acc / 40.0 * u_intensity / 100.0 * 3.0 * u_rayColor;
        vec4 o = texture(u_tex, v_uv);
        float a = u_raysOnly > 0.5 ? clamp(max(rays.r, max(rays.g, rays.b)), 0.0, 1.0) : max(o.a, clamp(max(rays.r, max(rays.g, rays.b)), 0.0, 1.0));
        outColor = vec4(min((u_raysOnly > 0.5 ? vec3(0.0) : o.rgb) + rays, vec3(a)), a);
      }`,
    }],
  },
  {
    type: 'ae-light-sweep', name: 'Light Sweep', category: G,
    description: 'A band of light sweeping across the layer: the classic shine on text and logos. Animate the centre.',
    keywords: 'cc shine glint sweep text logo',
    params: [
      ...point('center', 'Centre'), deg('direction', 'Direction', -30, -90, 90), select('shape', 'Shape', ['Linear', 'Smooth', 'Sharp']),
      px('width', 'Width', 60, 1000, 1), pct('sweepIntensity', 'Sweep intensity', 60), color('lightColor', 'Light colour', '#ffffff'),
      select('reception', 'Light reception', ['Add', 'Composite', 'Cutout']),
    ],
    passes: [{
      frag: `void main() {
        float a = radians(u_direction);
        float d = abs(dot(v_uv * u_size - ${at('center')} * u_size, vec2(cos(a), sin(a)))) / max(u_width * u_px * 0.5, 1.0);
        float l = u_shape < 0.5 ? max(0.0, 1.0 - d) : u_shape < 1.5 ? 1.0 - smoothstep(0.0, 1.0, d) : step(d, 1.0);
        l *= u_sweepIntensity / 100.0;
        vec4 c = texture(u_tex, v_uv);
        if (u_reception < 0.5) outColor = vec4(min(c.rgb + u_lightColor * l * c.a, vec3(c.a)), c.a);
        else if (u_reception < 1.5) outColor = vec4(u_lightColor * l, l) + c * (1.0 - l);
        else outColor = vec4(u_lightColor * l * c.a, l * c.a);
      }`,
    }],
  },
  {
    type: 'ae-beam', name: 'Beam', category: G,
    description: 'A glowing laser or light-saber beam between two points.', keywords: 'laser saber line glow',
    params: [
      ...point('start', 'Starting point', 20, 50), ...point('end', 'Ending point', 80, 50), px('startThickness', 'Starting thickness', 8, 300, 1),
      px('endThickness', 'Ending thickness', 8, 300, 1), pct('softness', 'Softness', 50), color('insideColor', 'Inside colour', '#ffffff'),
      color('outsideColor', 'Outside colour', '#4f8dff'), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`vec2 A = ${at('start')} * u_size, Bp = ${at('end')} * u_size, seg = Bp - A;
        float t = clamp(dot(P - A, seg) / max(dot(seg, seg), 1e-4), 0.0, 1.0);
        float dist = length(P - A - seg * t);
        float th = max(mix(u_startThickness, u_endThickness, t) * u_px * 0.5, 0.5);
        float s = u_softness / 100.0;
        float core = 1.0 - smoothstep(th * (1.0 - s), th * (1.0 + s * 2.0), dist);
        g = vec4(mix(u_outsideColor, u_insideColor, smoothstep(0.55, 1.0, core)), 1.0) * core;`),
    }],
  },

  // ---- Keying ---------------------------------------------------------------------------------
  {
    type: 'ae-linear-color-key', name: 'Linear Color Key', category: K,
    description: 'Key out (or keep) a colour by RGB, hue or chroma distance.', keywords: 'green screen chroma transparent',
    params: [
      select('view', 'View', ['Final output', 'Matte only']), color('keyColor', 'Key colour', '#00ff00'),
      select('matchColors', 'Match colours', ['Using RGB', 'Using hue', 'Using chroma']), pct('tolerance', 'Matching tolerance', 10),
      pct('softness', 'Matching softness', 10), select('operation', 'Key operation', ['Key colours', 'Keep colours']),
    ],
    passes: [{
      frag: `${HUE_DIST}
      void main() {
        vec4 c = src();
        float d = u_matchColors < 0.5 ? distance(c.rgb, u_keyColor) / 1.732 : u_matchColors < 1.5 ? hueDistance(c.rgb, u_keyColor) : distance(chromaUV(c.rgb), chromaUV(u_keyColor)) * 1.5;
        float t = u_tolerance / 100.0;
        float k = smoothstep(t, t + u_softness / 100.0 + 0.001, d);
        if (u_operation > 0.5) k = 1.0 - k;
        outColor = u_view > 0.5 ? vec4(vec3(k * c.a), 1.0) : premul(vec4(c.rgb, c.a * k));
      }`,
    }],
  },
  {
    type: 'ae-extract', name: 'Extract', category: K,
    description: 'Keep only a range of brightness (or one channel); everything outside turns transparent.', keywords: 'luma key range',
    params: [
      select('channel', 'Channel', ['Luminance', 'Red', 'Green', 'Blue', 'Alpha']), num('blackPoint', 'Black point', 0, 0, 255),
      num('whitePoint', 'White point', 255, 0, 255), num('blackSoftness', 'Black softness', 0, 0, 255), num('whiteSoftness', 'White softness', 0, 0, 255),
      bool('invert', 'Invert', false),
    ],
    passes: [{
      frag: `float ramp(float e0, float e1, float x) { return e1 > e0 ? smoothstep(e0, e1, x) : step(e1, x); }
      void main() {
        vec4 c = src();
        float v = (u_channel < 0.5 ? luma(c.rgb) : u_channel < 1.5 ? c.r : u_channel < 2.5 ? c.g : u_channel < 3.5 ? c.b : c.a) * 255.0;
        float k = ramp(u_blackPoint - u_blackSoftness, u_blackPoint, v) * (1.0 - ramp(u_whitePoint, u_whitePoint + u_whiteSoftness, v + 0.001));
        if (u_invert > 0.5) k = 1.0 - k;
        outColor = premul(vec4(c.rgb, c.a * k));
      }`,
    }],
  },
  {
    type: 'ae-color-difference-key', name: 'Color Difference Key', category: K,
    description: 'A classic green/blue-screen difference matte with spill suppression.', keywords: 'green screen blue screen chroma',
    params: [
      select('screen', 'Screen colour', ['Green', 'Blue', 'Red']), num('strength', 'Strength', 100, 0, 300, 1, '%'),
      pct('matteBlack', 'Matte black point', 5), pct('matteWhite', 'Matte white point', 40), pct('spill', 'Spill suppression', 80),
      select('view', 'View', ['Final output', 'Matte only']),
    ],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        vec3 rgb = c.rgb;
        float s = u_screen < 0.5 ? rgb.g : u_screen < 1.5 ? rgb.b : rgb.r;
        float o = u_screen < 0.5 ? max(rgb.r, rgb.b) : u_screen < 1.5 ? max(rgb.r, rgb.g) : max(rgb.g, rgb.b);
        float diff = max(s - o, 0.0) * u_strength / 100.0;
        float k = 1.0 - clamp((diff - u_matteBlack / 100.0) / max((u_matteWhite - u_matteBlack) / 100.0, 0.01), 0.0, 1.0);
        float limited = mix(s, min(s, o), u_spill / 100.0);
        if (u_screen < 0.5) rgb.g = limited; else if (u_screen < 1.5) rgb.b = limited; else rgb.r = limited;
        outColor = u_view > 0.5 ? vec4(vec3(k * c.a), 1.0) : premul(vec4(rgb, c.a * k));
      }`,
    }],
  },

  // ---- Transition -----------------------------------------------------------------------------
  {
    type: 'ae-venetian-blinds', name: 'Venetian Blinds', category: T,
    description: 'Close the layer like venetian blinds.', keywords: 'stripes wipe',
    params: [pct('completion', 'Transition completion', 0), deg('direction', 'Direction', 0, 0, 360), px('width', 'Width', 40, 500, 2), px('feather', 'Feather', 0, 100), ANIMATE, WIPE_TIME],
    passes: [{
      frag: `void main() {
        float a = radians(u_direction);
        float w = max(u_width * u_px, 1.0);
        float f = fract(dot(v_uv * u_size, vec2(cos(a), sin(a))) / w);
        float fe = max(u_feather * u_px, 0.5) / w;
        float c = wipeAmount(u_completion, u_animate, u_wipeTime);
        outColor = texture(u_tex, v_uv) * smoothstep(c - fe, c + fe, f * (1.0 + 2.0 * fe) - fe);
      }`,
    }],
  },
  {
    type: 'ae-gradient-wipe', name: 'Gradient Wipe', category: T,
    description: 'Dissolve the layer away from its darkest to its brightest parts.', keywords: 'luma wipe dissolve',
    params: [pct('completion', 'Transition completion', 0), pct('softness', 'Transition softness', 10), bool('invert', 'Invert gradient', false), ANIMATE, WIPE_TIME],
    passes: [{
      frag: `void main() {
        float l = luma(src().rgb);
        if (u_invert > 0.5) l = 1.0 - l;
        float s = u_softness / 100.0 + 0.001;
        float edge = wipeAmount(u_completion, u_animate, u_wipeTime) * (1.0 + s);
        outColor = texture(u_tex, v_uv) * smoothstep(edge - s, edge, l);
      }`,
    }],
  },
  {
    type: 'ae-grid-wipe', name: 'Grid Wipe', category: T,
    description: 'Tiles close from the centre outwards, as doors, circles or squares.', keywords: 'cc tiles squares',
    params: [
      pct('completion', 'Completion', 0), ...point('center', 'Centre'), deg('rotation', 'Rotation', 0), px('tileSize', 'Tile size', 60, 500, 4),
      select('shape', 'Shape', ['Doors', 'Radial', 'Rectangular']), bool('reverse', 'Reverse transition', false), ANIMATE, WIPE_TIME,
    ],
    passes: [{
      frag: `void main() {
        vec2 Cp = ${at('center')} * u_size;
        float a = radians(u_rotation);
        vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * (v_uv * u_size - Cp);
        float s = max(u_tileSize * u_px, 2.0);
        vec2 cell = floor(q / s), local = fract(q / s) - 0.5;
        float delay = clamp(length((cell + 0.5) * s) / (0.5 * length(u_size)), 0.0, 1.0);
        if (u_reverse > 0.5) delay = 1.0 - delay;
        float p = clamp(wipeAmount(u_completion, u_animate, u_wipeTime) * 2.0 - delay, 0.0, 1.0);
        float d = u_shape < 0.5 ? abs(local.x) : u_shape < 1.5 ? length(local) / 1.4142 : max(abs(local.x), abs(local.y));
        outColor = texture(u_tex, v_uv) * step(d, (1.0 - p) * 0.5 - 1e-4);
      }`,
    }],
  },
  {
    type: 'ae-jaws', name: 'Jaws', category: T,
    description: 'Toothed jaws bite the layer closed.', keywords: 'cc teeth zigzag wipe',
    params: [
      pct('completion', 'Completion', 0), ...point('center', 'Centre'), deg('direction', 'Direction', 0, 0, 360), px('height', 'Height', 40, 500, 1),
      px('width', 'Width', 40, 500, 1), select('shape', 'Shape', ['Spikes', 'Block', 'Waves']), ANIMATE, WIPE_TIME,
    ],
    passes: [{
      frag: `float tooth(float x) {
        float f = fract(x);
        return u_shape < 0.5 ? 1.0 - abs(2.0 * f - 1.0) : u_shape < 1.5 ? step(0.5, f) : 0.5 + 0.5 * sin(x * 6.2832);
      }
      void main() {
        float a = radians(u_direction);
        vec2 dir = vec2(cos(a), sin(a)), nrm = vec2(-dir.y, dir.x);
        vec2 d = v_uv * u_size - ${at('center')} * u_size;
        float along = dot(d, dir) / max(u_width * u_px, 1.0), n = dot(d, nrm), h = u_height * u_px;
        float prof = n > 0.0 ? tooth(along) : tooth(along + 0.5);
        float maxD = 0.5 * length(u_size);
        float c = wipeAmount(u_completion, u_animate, u_wipeTime);
        outColor = texture(u_tex, v_uv) * step(c * (maxD + h), abs(n) + prof * h);
      }`,
    }],
  },
  {
    type: 'ae-line-sweep', name: 'Line Sweep', category: T,
    description: 'Staggered stripes sweep the layer away.', keywords: 'cc stripes lines wipe',
    params: [pct('completion', 'Completion', 0), deg('direction', 'Direction', -45, -180, 180), px('thickness', 'Thickness', 30, 500, 1), pct('slant', 'Slant', 25), bool('flip', 'Flip direction', false), ANIMATE, WIPE_TIME],
    passes: [{
      frag: `void main() {
        float a = radians(u_direction);
        vec2 dir = vec2(cos(a), sin(a));
        vec2 d = (v_uv - 0.5) * u_size;
        float extent = 0.5 * (abs(dir.x) * u_size.x + abs(dir.y) * u_size.y);
        float pos = dot(d, dir) / extent * 0.5 + 0.5;
        if (u_flip > 0.5) pos = 1.0 - pos;
        float stripe = floor(dot(d, vec2(-dir.y, dir.x)) / max(u_thickness * u_px, 1.0));
        float sl = u_slant / 100.0;
        float edge = wipeAmount(u_completion, u_animate, u_wipeTime) * (1.0 + sl) - fract(stripe * 0.37) * sl;
        outColor = texture(u_tex, v_uv) * step(edge, pos);
      }`,
    }],
  },

  // ---- Simulation -----------------------------------------------------------------------------
  {
    type: 'ae-rainfall', name: 'Rainfall', category: S,
    description: 'Falling rain streaks in three depth layers.', keywords: 'cc rain weather storm',
    params: [
      pct('amount', 'Amount', 50), num('speed', 'Speed', 1500, 100, 5000, 10, 'px/s'), deg('wind', 'Wind', 10, -60, 60), px('dropLength', 'Drop length', 40, 300, 2),
      pct('opacity', 'Opacity', 40), color('dropColor', 'Colour', '#c8d8ff'), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`float a = radians(u_wind);
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * P / max(u_px, 0.01);
        float k = 0.0;
        for (int l = 0; l < 3; l++) {
          float depth = 1.0 - float(l) * 0.3;
          float colW = 10.0 / depth, col = floor(q.x / colW);
          float rnd = hash(vec2(col, float(l) * 17.0));
          if (rnd > u_amount / 100.0) continue;
          float len = u_dropLength * depth, spacing = len * 6.0;
          float y = q.y - u_time * u_speed * depth - rnd * spacing * 10.0;
          float f = fract(y / spacing) * spacing;
          float x = abs(fract(q.x / colW) - 0.5) * colW;
          k = max(k, (1.0 - smoothstep(0.0, len, f)) * (1.0 - smoothstep(0.3, 1.2 * depth, x)) * depth);
        }
        g = vec4(u_dropColor, 1.0) * k * u_opacity / 100.0;`),
    }],
  },
  {
    type: 'ae-snowfall', name: 'Snowfall', category: S,
    description: 'Gently drifting snowflakes in three depth layers.', keywords: 'cc snow weather winter',
    params: [
      pct('amount', 'Amount', 50), px('flakeSize', 'Size', 4, 30, 1), num('speed', 'Speed', 60, 0, 500, 1, 'px/s'), pct('wiggle', 'Wiggle', 50),
      deg('wind', 'Wind', 0, -60, 60), pct('opacity', 'Opacity', 90), color('flakeColor', 'Colour', '#ffffff'), GEN_BLEND,
    ],
    passes: [{
      frag: gen(`float k = 0.0;
        vec2 q0 = P / max(u_px, 0.01);
        for (int l = 0; l < 3; l++) {
          float depth = 1.0 - float(l) * 0.3;
          float cellS = u_flakeSize * 10.0 * depth;
          vec2 q = q0 - vec2(tan(radians(u_wind)), -1.0) * u_time * u_speed * depth;
          q.x += sin(q.y / cellS * 1.3 + u_time) * u_wiggle / 100.0 * cellS * 0.3;
          vec2 id = floor(q / cellS) + float(l) * 31.0;
          if (hash(id) > u_amount / 100.0) continue;
          vec2 c = (floor(q / cellS) + 0.2 + 0.6 * vec2(hash(id + 1.7), hash(id + 4.1))) * cellS;
          float r = u_flakeSize * depth * 0.5;
          k = max(k, (1.0 - smoothstep(r * 0.3, r, length(q - c))) * depth);
        }
        g = vec4(u_flakeColor, 1.0) * k * u_opacity / 100.0;`),
    }],
  },
]
