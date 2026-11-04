// After Effects' Distort category.
import { BLEND_ORIGINAL, NOISE, blurPasses, bool, choose, color, deg, num, pct, point, px, select, type EffectDef } from '../fxlib'
import type { ParamValue } from '../project'

const C = 'Distort'
const ASPECT = 'vec2 aspect = vec2(u_size.x / u_size.y, 1.0);'
const at = (key: string) => `vec2(u_${key}X, u_${key}Y) / 100.0`
const CHANNELS = ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Off']
const channelSelect = (key: string, label: string, def: string) => choose(key, label, CHANNELS, def)

/** Inverse of the perspective transform taking the unit square onto the four pinned corners (column-major mat3). */
function cornerPinMatrix(p: Record<string, ParamValue>): number[] {
  const n = (k: string) => Number(p[k]) / 100
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [n('ulX'), n('ulY'), n('urX'), n('urY'), n('lrX'), n('lrY'), n('llX'), n('llY')]
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dx2 * dy1
  let g = 0, h = 0
  if ((Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) && Math.abs(den) > 1e-12) {
    g = (dx3 * dy2 - dx2 * dy3) / den
    h = (dx1 * dy3 - dx3 * dy1) / den
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0
  // Adjugate of [[a b c] [d e f] [g h 1]], written column by column.
  return [e - f * h, f * g - d, d * h - e * g, c * h - b, a - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d]
}

export const DISTORT: EffectDef[] = [
  {
    type: 'ae-bender', name: 'Bender', category: C,
    description: 'Bend the layer between a base and a top point, in several styles.',
    keywords: 'cc bend it curve',
    params: [num('amount', 'Amount', 30, -100, 100), select('style', 'Style', ['Bend', 'Marilyn', 'Sharp', 'Boxer']), ...point('top', 'Top', 50, 0), ...point('base', 'Base', 50, 100)],
    passes: [{
      frag: `void main() {
        ${ASPECT}
        vec2 b = ${at('base')} * aspect, t = ${at('top')} * aspect, p = v_uv * aspect;
        vec2 ax = t - b;
        float len = max(length(ax), 1e-4);
        vec2 dir = ax / len, nrm = vec2(-dir.y, dir.x);
        float s = clamp(dot(p - b, dir) / len, 0.0, 1.0);
        float f = u_style < 0.5 ? s * s : u_style < 1.5 ? sin(s * 3.14159) : u_style < 2.5 ? 1.0 - abs(1.0 - 2.0 * s) : smoothstep(0.4, 0.6, s);
        p -= nrm * f * u_amount / 100.0 * len * 0.5;
        outColor = tap(p / aspect);
      }`,
    }],
  },
  {
    type: 'ae-blobbylize', name: 'Blobbylize', category: C,
    description: 'Melt the picture into glossy, lit blobs.',
    keywords: 'cc liquid gloss',
    params: [px('softness', 'Softness', 10, 60), pct('cutAway', 'Cut away', 25), pct('lightIntensity', 'Light intensity', 100), deg('lightDirection', 'Light direction', -45)],
    passes: [
      ...blurPasses((p) => Number(p.softness)),
      {
        frag: `float h(vec2 uv) { return luma(unpremul(texture(u_tex, uv)).rgb); }
        void main() {
          vec2 t = 2.0 / u_size;
          vec2 g = vec2(h(v_uv + vec2(t.x, 0.0)) - h(v_uv - vec2(t.x, 0.0)), h(v_uv + vec2(0.0, t.y)) - h(v_uv - vec2(0.0, t.y)));
          vec3 n = normalize(vec3(-g * 20.0, 1.0));
          float a = radians(u_lightDirection);
          vec3 L = normalize(vec3(cos(a), sin(a), 1.0));
          float li = u_lightIntensity / 100.0;
          float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
          float cut = u_cutAway / 100.0;
          float k = smoothstep(cut - 0.04, cut + 0.04, h(v_uv));
          vec4 o = unpremul(texture(u_orig, v_uv));
          vec3 rgb = o.rgb * mix(1.0, 0.4 + 0.8 * max(dot(n, L), 0.0), li) + spec * li;
          outColor = premul(vec4(clamp(rgb, 0.0, 1.0), o.a * k));
        }`,
      },
    ],
  },
  {
    type: 'ae-flo-motion', name: 'Flo Motion', category: C,
    description: 'Two knots that pull the picture in (positive) or push it out (negative).',
    keywords: 'cc pinch zoom knot',
    params: [...point('knot1', 'Knot 1', 30, 50), num('amount1', 'Amount 1', 50, -200, 200), ...point('knot2', 'Knot 2', 70, 50), num('amount2', 'Amount 2', -50, -200, 200), num('falloff', 'Falloff', 40, 1, 100)],
    passes: [{
      frag: `void main() {
        ${ASPECT}
        vec2 p = v_uv * aspect;
        float fall = u_falloff / 100.0 * 0.5;
        vec2 d1 = p - ${at('knot1')} * aspect, d2 = p - ${at('knot2')} * aspect;
        p -= d1 * u_amount1 / 100.0 * exp(-dot(d1, d1) / (fall * fall));
        p -= d2 * u_amount2 / 100.0 * exp(-dot(d2, d2) / (fall * fall));
        outColor = tap(p / aspect);
      }`,
    }],
  },
  {
    type: 'ae-griddler', name: 'Griddler', category: C,
    description: 'Break the layer into a grid of tiles, each scaled and rotated.',
    keywords: 'cc tiles grid',
    params: [
      num('hScale', 'Horizontal scale', 100, 10, 400, 1, '%'), num('vScale', 'Vertical scale', 100, 10, 400, 1, '%'),
      px('tileSize', 'Tile size', 60, 400, 4), deg('rotation', 'Rotation', 0), bool('cut', 'Cut tiles', false),
    ],
    passes: [{
      frag: `void main() {
        vec2 q = v_uv * u_size;
        float s = max(u_tileSize * u_px, 2.0);
        vec2 cell = floor(q / s), local = q - (cell + 0.5) * s;
        float a = radians(u_rotation);
        vec2 l = mat2(cos(a), -sin(a), sin(a), cos(a)) * local / (vec2(u_hScale, u_vScale) / 100.0);
        if (u_cut > 0.5 && (abs(l.x) > s * 0.5 || abs(l.y) > s * 0.5)) { outColor = vec4(0.0); return; }
        outColor = tap(((cell + 0.5) * s + l) / u_size);
      }`,
    }],
  },
  {
    type: 'ae-lens', name: 'Lens', category: C,
    description: 'Look through a round fisheye lens.',
    keywords: 'cc fisheye glass ball',
    params: [...point('center', 'Centre'), pct('lensSize', 'Size', 50), num('convergence', 'Convergence', 50, -100, 100)],
    passes: [{
      frag: `void main() {
        ${ASPECT}
        vec2 c = ${at('center')};
        vec2 p = (v_uv - c) * aspect;
        float R = max(u_lensSize / 100.0, 0.001);
        float r = length(p) / R;
        if (r > 1.0) { outColor = vec4(0.0); return; }
        float rs = pow(r, 1.0 + u_convergence / 100.0);
        outColor = tap(c + (r > 0.0 ? p / r * rs : p) / aspect);
      }`,
    }],
  },
  {
    type: 'ae-page-turn', name: 'Page Turn', category: C,
    description: 'Curl the layer back like a turning page. Animate the fold position to turn it.',
    keywords: 'cc curl peel paper',
    params: [
      ...point('fold', 'Fold position', 70, 70), deg('foldDirection', 'Fold direction', 45, 0, 360), px('foldRadius', 'Fold radius', 60, 400, 1),
      select('render', 'Render', ['Front & back page', 'Back page', 'Front page']), pct('backOpacity', 'Back page opacity', 100),
      color('backColor', 'Back page colour', '#f2f2f2'), pct('backImage', 'Image on back', 30),
    ],
    passes: [{
      frag: `bool inside(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0; }
      void main() {
        const float PI = 3.14159265;
        vec2 P = v_uv * u_size;
        vec2 F = ${at('fold')} * u_size;
        float a = radians(u_foldDirection);
        vec2 dir = vec2(cos(a), sin(a));
        float R = max(u_foldRadius * u_px, 1.0);
        float d = dot(P - F, dir);
        vec2 base = P - dir * d;
        vec4 front = d < 0.0 ? texture(u_tex, v_uv) : vec4(0.0);
        vec4 back = vec4(0.0);
        float shade = 1.0;
        if (d <= R) {
          float s = d >= 0.0 ? PI * R - R * asin(d / R) : PI * R - d;
          vec2 uv = (base + dir * s) / u_size;
          if (inside(uv)) {
            back = texture(u_tex, uv);
            if (d >= 0.0) shade = 0.65 + 0.35 * sqrt(max(0.0, 1.0 - d * d / (R * R)));
          } else if (d >= 0.0) {
            vec2 under = (base + dir * R * asin(d / R)) / u_size;
            if (inside(under)) front = texture(u_tex, under) * (0.55 + 0.45 * sqrt(max(0.0, 1.0 - d * d / (R * R))));
          }
        }
        if (u_render > 0.5 && u_render < 1.5) front = vec4(0.0);
        vec4 col = front;
        if (back.a > 0.0 && u_render < 1.5) {
          vec3 bc = mix(u_backColor, unpremul(back).rgb, u_backImage / 100.0) * shade;
          float ba = back.a * u_backOpacity / 100.0;
          col = vec4(bc * ba, ba) + col * (1.0 - ba);
        }
        outColor = col;
      }`,
    }],
  },
  {
    type: 'ae-ripple-pulse', name: 'Ripple Pulse', category: C,
    description: 'Animated rings rippling out from a centre.',
    keywords: 'cc water drop wave',
    params: [...point('center', 'Centre'), px('pulseLevel', 'Pulse level', 20, 200), num('rings', 'Rings', 8, 1, 40), num('speed', 'Speed', 1, 0, 10, 0.1), pct('spread', 'Spread', 60)],
    passes: [{
      frag: `void main() {
        ${ASPECT}
        vec2 p = (v_uv - ${at('center')}) * aspect;
        float r = length(p);
        float w = sin((r * u_rings - u_local * u_speed) * 6.2832) * (1.0 - smoothstep(0.0, max(u_spread / 100.0, 0.01), r));
        vec2 dir = r > 0.0 ? p / r : vec2(0.0);
        outColor = tap(v_uv + dir / aspect * w * u_pulseLevel * u_px / u_size.y);
      }`,
    }],
  },
  {
    type: 'ae-slant', name: 'Slant', category: C,
    description: 'Lean the layer sideways from a floor line.',
    keywords: 'cc skew italic shear',
    params: [num('slant', 'Slant', 20, -100, 100), pct('floor', 'Floor', 100)],
    passes: [{
      frag: `void main() {
        vec2 uv = v_uv;
        uv.x += u_slant / 100.0 * (u_floor / 100.0 - uv.y) * u_size.y / u_size.x;
        outColor = tap(uv);
      }`,
    }],
  },
  {
    type: 'ae-smear', name: 'Smear', category: C,
    description: 'Drag part of the picture from one point to another, like smudging paint.',
    keywords: 'cc smudge drag',
    params: [...point('from', 'From', 40, 50), ...point('to', 'To', 60, 50), pct('reach', 'Reach', 70), pct('radius', 'Radius', 15)],
    passes: [{
      frag: `void main() {
        ${ASPECT}
        vec2 p = v_uv * aspect, f = ${at('from')} * aspect, t = ${at('to')} * aspect;
        vec2 seg = t - f;
        float s = clamp(dot(p - f, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
        float k = (1.0 - smoothstep(0.0, max(u_radius / 100.0, 0.001), length(p - f - seg * s))) * u_reach / 100.0;
        outColor = tap((p - seg * s * k) / aspect);
      }`,
    }],
  },
  {
    type: 'ae-split', name: 'Split', category: C,
    description: 'Tear the layer open along the line between two points.',
    keywords: 'cc split 2 tear open',
    params: [...point('pointA', 'Point A', 50, 20), ...point('pointB', 'Point B', 50, 80), pct('split', 'Split', 30)],
    passes: [{
      frag: `void main() {
        ${ASPECT}
        vec2 p = v_uv * aspect, A = ${at('pointA')} * aspect, B = ${at('pointB')} * aspect;
        vec2 ax = B - A;
        float len = max(length(ax), 1e-4);
        vec2 dir = ax / len, nrm = vec2(-dir.y, dir.x);
        float t = dot(p - A, dir) / len, n = dot(p - A, nrm);
        float w = t > 0.0 && t < 1.0 ? u_split / 100.0 * len * 0.5 * sin(3.14159 * t) : 0.0;
        if (abs(n) < w) { outColor = vec4(0.0); return; }
        outColor = tap((p - nrm * sign(n) * w) / aspect);
      }`,
    }],
  },
  {
    type: 'ae-tiler', name: 'Tiler', category: C,
    description: 'Shrink the layer and repeat it to fill the frame.',
    keywords: 'cc tile repeat grid',
    params: [num('scale', 'Scale', 50, 5, 100, 1, '%'), ...point('center', 'Centre'), BLEND_ORIGINAL],
    passes: [{
      frag: `void main() {
        vec2 q = (v_uv - ${at('center')}) / (u_scale / 100.0) + 0.5;
        outColor = mix(texture(u_tex, fract(q)), texture(u_tex, v_uv), u_blend / 100.0);
      }`,
    }],
  },
  {
    type: 'ae-corner-pin', name: 'Corner Pin', category: C,
    description: 'Pin the layer’s four corners anywhere, for perspective (screen replacements, signs).',
    keywords: 'perspective power pin quad screen replace',
    params: [...point('ul', 'Upper left', 0, 0), ...point('ur', 'Upper right', 100, 0), ...point('ll', 'Lower left', 0, 100), ...point('lr', 'Lower right', 100, 100)],
    passes: [{
      frag: `uniform mat3 u_H;
      void main() {
        vec3 q = u_H * vec3(v_uv, 1.0);
        outColor = q.z > 0.0 ? tap(q.xy / q.z) : vec4(0.0);
      }`,
      uniforms: (p) => ({ u_H: cornerPinMatrix(p) }),
    }],
  },
  {
    type: 'ae-detail-upscale', name: 'Detail-preserving Upscale', category: C,
    description: 'Zoom into the layer while restoring edge detail.',
    keywords: 'enlarge zoom sharpen',
    params: [num('scale', 'Scale', 150, 100, 400, 1, '%'), pct('detail', 'Detail', 50)],
    passes: [{
      frag: `void main() {
        float k = u_scale / 100.0;
        vec2 uv = (v_uv - 0.5) / k + 0.5;
        vec2 t = 1.0 / u_size / k;
        vec4 c = tap(uv);
        vec4 avg = (tap(uv + vec2(t.x, 0.0)) + tap(uv - vec2(t.x, 0.0)) + tap(uv + vec2(0.0, t.y)) + tap(uv - vec2(0.0, t.y))) * 0.25;
        vec4 o = c + (c - avg) * u_detail / 100.0 * 2.0;
        outColor = vec4(clamp(o.rgb, vec3(0.0), vec3(c.a)), c.a);
      }`,
    }],
  },
  {
    type: 'ae-displacement-map', name: 'Displacement Map', category: C,
    description: 'Shift pixels by the layer’s own colour channels (the layer is its own map).',
    keywords: 'displace warp',
    params: [channelSelect('hFrom', 'Use for horizontal', 'Red'), px('hMax', 'Max horizontal shift', 20, 500, -500), channelSelect('vFrom', 'Use for vertical', 'Green'), px('vMax', 'Max vertical shift', 20, 500, -500)],
    passes: [{
      frag: `float chan(vec4 c, float s) { return s < 0.5 ? c.r : s < 1.5 ? c.g : s < 2.5 ? c.b : s < 3.5 ? c.a : s < 4.5 ? luma(c.rgb) : 0.5; }
      void main() {
        vec4 m = src();
        vec2 d = vec2((chan(m, u_hFrom) - 0.5) * u_hMax, (chan(m, u_vFrom) - 0.5) * u_vMax) * 2.0;
        outColor = tap(v_uv + d * u_px / u_size);
      }`,
    }],
  },
  {
    type: 'ae-magnify', name: 'Magnify', category: C,
    description: 'A magnifying glass over part of the layer.',
    keywords: 'zoom loupe',
    params: [
      select('shape', 'Shape', ['Circle', 'Square']), ...point('center', 'Centre'), num('magnification', 'Magnification', 200, 100, 600, 1, '%'),
      px('radius', 'Size', 120, 1000, 5), px('feather', 'Feather', 2, 200), pct('opacity', 'Opacity', 100),
    ],
    passes: [{
      frag: `void main() {
        vec2 P = v_uv * u_size, Cp = ${at('center')} * u_size, d = P - Cp;
        float dist = u_shape < 0.5 ? length(d) : max(abs(d.x), abs(d.y));
        float R = u_radius * u_px;
        float m = 1.0 - smoothstep(R - u_feather * u_px - 0.5, R, dist);
        vec4 z = tap((Cp + d / (u_magnification / 100.0)) / u_size);
        outColor = mix(texture(u_tex, v_uv), z, m * u_opacity / 100.0);
      }`,
    }],
  },
  {
    type: 'ae-mirror', name: 'Mirror', category: C,
    description: 'Reflect the layer across a line at any angle and position.',
    keywords: 'reflect symmetry',
    params: [...point('center', 'Reflection centre'), deg('angle', 'Reflection angle', 0)],
    passes: [{
      frag: `void main() {
        vec2 P = v_uv * u_size, Cp = ${at('center')} * u_size;
        float a = radians(u_angle);
        vec2 n = vec2(cos(a), sin(a));
        float d = dot(P - Cp, n);
        if (d > 0.0) P -= 2.0 * d * n;
        outColor = tap(P / u_size);
      }`,
    }],
  },
  {
    type: 'ae-optics-compensation', name: 'Optics Compensation', category: C,
    description: 'Add (or remove) wide-angle lens barrel distortion by field of view.',
    keywords: 'fisheye barrel lens undistort gopro',
    params: [num('fov', 'Field of view', 0, 0, 179, 1, '°'), bool('reverse', 'Reverse lens distortion', false), ...point('center', 'View centre')],
    passes: [{
      frag: `void main() {
        ${ASPECT}
        vec2 c = ${at('center')};
        vec2 p = (v_uv - c) * aspect;
        float diag = 0.5 * length(aspect);
        float r = length(p) / diag;
        float th = radians(u_fov) * 0.5;
        if (th < 0.005 || r < 1e-5) { outColor = tap(v_uv); return; }
        float rs = u_reverse > 0.5 ? atan(r * tan(th)) / th : tan(r * th) / tan(th);
        outColor = tap(c + p * (rs / r) / aspect);
      }`,
    }],
  },
  {
    type: 'ae-polar-coordinates', name: 'Polar Coordinates', category: C,
    description: 'Wrap the layer into a circle, or unwrap a circle into a strip.',
    keywords: 'polar circle wrap tiny planet',
    params: [pct('interpolation', 'Interpolation', 100), select('conversion', 'Type of conversion', ['Rect to polar', 'Polar to rect'])],
    passes: [{
      frag: `void main() {
        vec2 p = v_uv - 0.5;
        vec2 s;
        if (u_conversion < 0.5) s = vec2(fract(atan(p.x, -p.y) / 6.2832 + 0.5), 1.0 - length(p) * 2.0);
        else { float a = (v_uv.x - 0.5) * 6.2832; s = 0.5 + vec2(sin(a), -cos(a)) * (1.0 - v_uv.y) * 0.5; }
        outColor = tap(mix(v_uv, s, u_interpolation / 100.0));
      }`,
    }],
  },
  {
    type: 'ae-ripple', name: 'Ripple', category: C,
    description: 'Concentric ripples, like a stone dropped in water.',
    keywords: 'water wave rings',
    params: [
      pct('radius', 'Radius', 50), ...point('center', 'Centre of ripple'), num('waveSpeed', 'Wave speed', 1, -10, 10, 0.1),
      px('waveWidth', 'Wave width', 40, 400, 2), px('waveHeight', 'Wave height', 10, 200), deg('phase', 'Ripple phase', 0, 0, 360),
    ],
    passes: [{
      frag: `void main() {
        vec2 P = v_uv * u_size, Cp = ${at('center')} * u_size, d = P - Cp;
        float r = length(d), R = u_radius / 100.0 * 0.5 * length(u_size);
        float env = 1.0 - smoothstep(R * 0.6, R + 1.0, r);
        float w = sin(r / max(u_waveWidth * u_px, 1.0) * 6.2832 - u_local * u_waveSpeed * 6.2832 + radians(u_phase));
        outColor = tap((P + (r > 0.0 ? d / r : vec2(0.0)) * w * u_waveHeight * u_px * env) / u_size);
      }`,
    }],
  },
  {
    type: 'ae-spherize', name: 'Spherize', category: C,
    description: 'Bulge part of the layer as if wrapped over a sphere.',
    keywords: 'bulge globe',
    params: [px('radius', 'Radius', 250, 2000, 1), ...point('center', 'Centre of sphere')],
    passes: [{
      frag: `void main() {
        vec2 P = v_uv * u_size, Cp = ${at('center')} * u_size, d = P - Cp;
        float R = max(u_radius * u_px, 1.0), r = length(d);
        if (r < R && r > 0.0) P = Cp + d / r * (asin(r / R) / 1.5708) * R;
        outColor = tap(P / u_size);
      }`,
    }],
  },
  {
    type: 'ae-transform', name: 'Transform', category: C,
    description: 'Move, scale, skew and rotate the layer inside its own bounds (applied in effect order).',
    keywords: 'position scale rotate skew anchor',
    params: [
      ...point('anchor', 'Anchor point'), ...point('position', 'Position'), bool('uniformScale', 'Uniform scale', true),
      num('scaleHeight', 'Scale height', 100, 0, 400, 1, '%'), num('scaleWidth', 'Scale width', 100, 0, 400, 1, '%'),
      deg('skew', 'Skew', 0, -70, 70), deg('skewAxis', 'Skew axis', 0), deg('rotation', 'Rotation', 0), pct('opacity', 'Opacity', 100),
    ],
    passes: [{
      frag: `mat2 rot(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
      void main() {
        vec2 q = v_uv * u_size - ${at('position')} * u_size;
        q = rot(-radians(u_rotation)) * q;
        float ax = radians(u_skewAxis);
        q = rot(-ax) * q;
        q.x -= tan(radians(u_skew)) * q.y;
        q = rot(ax) * q;
        vec2 s = vec2(u_uniformScale > 0.5 ? u_scaleHeight : u_scaleWidth, u_scaleHeight) / 100.0;
        q /= max(s, vec2(1e-4));
        outColor = tap((q + ${at('anchor')} * u_size) / u_size) * (u_opacity / 100.0);
      }`,
    }],
  },
  {
    type: 'ae-turbulent-displace', name: 'Turbulent Displace', category: C,
    description: 'Warp the layer with fractal noise: smoke, heat haze, flags, liquid.',
    keywords: 'noise warp heat haze wobble',
    params: [
      select('displacement', 'Displacement', ['Turbulent', 'Bulge', 'Twist', 'Horizontal', 'Vertical']), num('amount', 'Amount', 50, 0, 500),
      px('noiseSize', 'Size', 100, 1000, 2), num('complexity', 'Complexity', 2, 1, 10), deg('evolution', 'Evolution', 0),
      num('evolutionSpeed', 'Evolution speed', 0.5, 0, 10, 0.1),
    ],
    passes: [{
      frag: `${NOISE}
      void main() {
        vec2 q = v_uv * u_size / max(u_noiseSize * u_px, 1.0);
        float z = u_evolution / 360.0 + u_time * u_evolutionSpeed;
        float n1 = fbm(q, z, u_complexity, 0.0) - 0.5, n2 = fbm(q + 31.7, z, u_complexity, 0.0) - 0.5;
        vec2 c = v_uv - 0.5, r = length(c) > 0.0 ? normalize(c) : vec2(0.0);
        float m = u_displacement;
        vec2 d = m < 0.5 ? vec2(n1, n2) : m < 1.5 ? r * n1 : m < 2.5 ? vec2(-r.y, r.x) * n1 : m < 3.5 ? vec2(n1, 0.0) : vec2(0.0, n1);
        outColor = tap(v_uv + d * u_amount * 2.0 * u_px / u_size);
      }`,
    }],
  },
  {
    type: 'ae-warp', name: 'Warp', category: C,
    description: 'Photoshop-style warps: arc, bulge, flag, wave, fish, rise, fisheye, inflate, squeeze and twist.',
    keywords: 'arc text bend envelope',
    params: [
      select('style', 'Warp style', ['Arc', 'Arc lower', 'Arc upper', 'Bulge', 'Flag', 'Wave', 'Fish', 'Rise', 'Fisheye', 'Inflate', 'Squeeze', 'Twist']),
      select('axis', 'Warp axis', ['Horizontal', 'Vertical']), num('bend', 'Bend', 50, -100, 100),
      num('hDistortion', 'Horizontal distortion', 0, -100, 100), num('vDistortion', 'Vertical distortion', 0, -100, 100),
    ],
    passes: [{
      frag: `void main() {
        vec2 p = v_uv * 2.0 - 1.0;
        if (u_axis > 0.5) p = p.yx;
        float b = u_bend / 100.0, s = u_style;
        vec2 q = p;
        if (s < 0.5) q.y = p.y + b * (1.0 - p.x * p.x) * 0.5;
        else if (s < 1.5) q.y = p.y + b * (1.0 - p.x * p.x) * 0.5 * (p.y + 1.0) * 0.5;
        else if (s < 2.5) q.y = p.y + b * (1.0 - p.x * p.x) * 0.5 * (1.0 - p.y) * 0.5;
        else if (s < 3.5) q.y = p.y / (1.0 + b * (1.0 - p.x * p.x) * 0.5);
        else if (s < 4.5) q.y = p.y + b * 0.3 * sin(p.x * 3.14159);
        else if (s < 5.5) q.y = p.y + b * 0.25 * sin((p.x + p.y * 0.5) * 3.14159);
        else if (s < 6.5) q.y = p.y / (1.0 + b * 0.5 * cos(p.x * 1.5708));
        else if (s < 7.5) q.y = p.y + b * 0.5 * p.x;
        else if (s < 8.5) q = p * (1.0 - b * 0.5 * max(0.0, 1.0 - dot(p, p)));
        else if (s < 9.5) q = p * (1.0 - b * 0.4 * (1.0 - p * p));
        else if (s < 10.5) q = vec2(p.x * (1.0 + b * 0.5 * (1.0 - p.y * p.y)), p.y * (1.0 - b * 0.3 * (1.0 - p.x * p.x)));
        else { float a = b * 3.14159 * max(0.0, 1.0 - length(p)); q = mat2(cos(a), sin(a), -sin(a), cos(a)) * p; }
        q.y *= 1.0 + u_hDistortion / 100.0 * q.x * 0.5;
        q.x *= 1.0 + u_vDistortion / 100.0 * q.y * 0.5;
        if (u_axis > 0.5) q = q.yx;
        outColor = tap(q * 0.5 + 0.5);
      }`,
    }],
  },
]
