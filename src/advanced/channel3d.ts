// After Effects' 3D Channel category. AE reads depth and object IDs from 3D render files; ordinary
// video has neither, so depth comes from the picture (DEPTH_PARAMS) and IDs from flat colours.
import { DEPTH_PARAMS, bool, color, depthPasses, num, pct, px, select, type EffectDef } from '../fxlib'

const C = '3D Channel'
const DEPTH_NOTE = 'Depth is estimated from brightness or height, since video has no depth channel.'

export const CHANNEL_3D: EffectDef[] = [
  {
    type: 'ae-3d-channel-extract', name: '3D Channel Extract', category: C,
    description: `Show the depth channel as a greyscale image (near = white). ${DEPTH_NOTE}`,
    keywords: 'z depth pass map',
    params: [...DEPTH_PARAMS, pct('blackPoint', 'Black point', 0), pct('whitePoint', 'White point', 100), bool('invert', 'Invert', false)],
    passes: depthPasses(`void main() {
      float d = 1.0 - depthAt(v_uv);
      d = clamp((d - u_blackPoint / 100.0) / max((u_whitePoint - u_blackPoint) / 100.0, 0.001), 0.0, 1.0);
      if (u_invert > 0.5) d = 1.0 - d;
      float a = texture(u_orig, v_uv).a;
      outColor = vec4(vec3(d) * a, a);
    }`),
  },
  {
    type: 'ae-depth-matte', name: 'Depth Matte', category: C,
    description: `Keep only what is nearer (or further) than a depth. ${DEPTH_NOTE}`,
    keywords: 'z key cutout',
    params: [...DEPTH_PARAMS, pct('depth', 'Depth', 50), pct('feather', 'Feather', 10), bool('invert', 'Invert (keep far)', false)],
    passes: depthPasses(`void main() {
      float f = u_feather / 100.0 + 0.001;
      float k = 1.0 - smoothstep(u_depth / 100.0 - f * 0.5, u_depth / 100.0 + f * 0.5, depthAt(v_uv));
      if (u_invert > 0.5) k = 1.0 - k;
      outColor = texture(u_orig, v_uv) * k;
    }`),
  },
  {
    type: 'ae-depth-of-field', name: 'Depth of Field', category: C,
    description: `Blur what is away from the focal plane, like a shallow-focus lens. ${DEPTH_NOTE}`,
    keywords: 'dof bokeh focus defocus lens',
    params: [...DEPTH_PARAMS, pct('focalPlane', 'Focal plane', 30), pct('focalRange', 'In-focus range', 10), px('maxRadius', 'Maximum blur', 12, 60)],
    passes: depthPasses(`void main() {
      float coc = clamp((abs(depthAt(v_uv) - u_focalPlane / 100.0) - u_focalRange / 200.0) * 2.0, 0.0, 1.0);
      float r = coc * u_maxRadius * u_px;
      if (r < 0.5) { outColor = texture(u_orig, v_uv); return; }
      vec4 acc = vec4(0.0);
      for (int i = 0; i < 32; i++) {
        float a = float(i) * 2.39996;
        acc += texture(u_orig, v_uv + vec2(cos(a), sin(a)) * sqrt((float(i) + 0.5) / 32.0) * r / u_size);
      }
      outColor = acc / 32.0;
    }`),
  },
  {
    type: 'ae-fog-3d', name: 'Fog 3D', category: C,
    description: `Fog that thickens with distance. ${DEPTH_NOTE}`,
    keywords: 'haze mist atmosphere',
    params: [...DEPTH_PARAMS, color('fogColor', 'Fog colour', '#c8ccd4'), pct('fogStart', 'Fog start depth', 30), pct('fogEnd', 'Fog end depth', 100), pct('density', 'Density', 80)],
    passes: depthPasses(`void main() {
      vec4 o = texture(u_orig, v_uv);
      float k = smoothstep(u_fogStart / 100.0, max(u_fogEnd, u_fogStart + 1.0) / 100.0, depthAt(v_uv)) * u_density / 100.0;
      outColor = vec4(mix(o.rgb, u_fogColor * o.a, k), o.a);
    }`),
  },
  {
    type: 'ae-extractor', name: 'EXtractoR', category: C,
    description: `Show any one channel (red, green, blue, alpha, luminance or depth) as greyscale, with black and white points. ${DEPTH_NOTE}`,
    keywords: 'extract channel exr',
    params: [
      select('channel', 'Channel', ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Depth']), ...DEPTH_PARAMS,
      pct('blackPoint', 'Black point', 0), pct('whitePoint', 'White point', 100), bool('keepAlpha', 'Keep alpha', true),
    ],
    passes: depthPasses(`void main() {
      vec4 o = unpremul(texture(u_orig, v_uv));
      float ch = u_channel;
      float v = ch < 0.5 ? o.r : ch < 1.5 ? o.g : ch < 2.5 ? o.b : ch < 3.5 ? o.a : ch < 4.5 ? luma(o.rgb) : 1.0 - depthAt(v_uv);
      v = clamp((v - u_blackPoint / 100.0) / max((u_whitePoint - u_blackPoint) / 100.0, 0.001), 0.0, 1.0);
      outColor = u_keepAlpha > 0.5 ? premul(vec4(vec3(v), o.a)) : vec4(vec3(v), 1.0);
    }`),
  },
  {
    type: 'ae-id-matte', name: 'ID Matte', category: C,
    description: 'Isolate one object of a colour-coded ID pass (each object a flat colour) by picking its colour.',
    keywords: 'object id cryptomatte mask',
    params: [
      color('idColor', 'ID colour', '#ff0000'), pct('tolerance', 'Tolerance', 10), pct('feather', 'Feather', 5),
      bool('invert', 'Invert', false), bool('showMatte', 'Show matte only', false),
    ],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        float t = u_tolerance / 100.0 * 0.6;
        float k = 1.0 - smoothstep(t, t + u_feather / 100.0 * 0.3 + 0.001, distance(c.rgb, u_idColor));
        if (u_invert > 0.5) k = 1.0 - k;
        outColor = u_showMatte > 0.5 ? vec4(vec3(k) * c.a, c.a) : texture(u_tex, v_uv) * k;
      }`,
    }],
  },
  {
    type: 'ae-identifier', name: 'IDentifier', category: C,
    description: 'Split the image into numbered IDs by brightness or hue; colour each one, or isolate a single ID.',
    keywords: 'object id segment',
    params: [
      num('ids', 'Number of IDs', 8, 2, 64), select('idFrom', 'IDs from', ['Brightness', 'Hue']),
      select('display', 'Display', ['Colour each ID', 'Isolate one ID']), num('id', 'ID to isolate', 1, 1, 64),
    ],
    passes: [{
      frag: `void main() {
        vec4 c = src();
        float v = u_idFrom < 0.5 ? luma(c.rgb) : rgb2hsv(c.rgb).x;
        float id = min(floor(v * u_ids), u_ids - 1.0);
        if (u_display < 0.5) outColor = premul(vec4(hsv2rgb(vec3(fract(id * 0.618 + 0.1), 0.65, 0.95)), c.a));
        else outColor = abs(id - (u_id - 1.0)) < 0.5 ? texture(u_tex, v_uv) : vec4(0.0);
      }`,
    }],
  },
]
