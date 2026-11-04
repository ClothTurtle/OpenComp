// After Effects' Perspective category.
import { bool, color, deg, num, pct, point, px, select, type EffectDef } from '../fxlib'

const C = 'Perspective'
const at = (key: string) => `vec2(u_${key}X, u_${key}Y) / 100.0`
const LIGHT = [pct('lightIntensity', 'Light intensity', 100), pct('ambient', 'Ambient', 30), deg('lightDirection', 'Light direction', -45)]
/** Diffuse light on a view-space normal (z toward the viewer). */
const SHADE = `float shade(vec3 n) {
  float a = radians(u_lightDirection);
  vec3 L = normalize(vec3(cos(a), sin(a), 1.2));
  float amb = u_ambient / 100.0;
  return amb + (1.0 - amb) * mix(1.0, max(dot(n, L), 0.0), u_lightIntensity / 100.0);
}
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat2 rot2(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
`

export const PERSPECTIVE: EffectDef[] = [
  {
    type: 'ae-3d-glasses', name: '3D Glasses', category: C,
    description: 'Fake stereo 3D: offset left and right views into an anaglyph for red/cyan glasses.',
    keywords: 'anaglyph stereo stereoscopic',
    params: [
      select('view', '3D view', ['Red/Cyan', 'Red/Blue (luminance)', 'Green/Magenta', 'Balanced red/cyan']),
      px('convergence', 'Scene convergence', 8, 100, -100), px('vAlign', 'Vertical alignment', 0, 50, -50),
    ],
    passes: [{
      frag: `void main() {
        vec2 o = vec2(u_convergence, u_vAlign) * u_px / u_size;
        vec4 L = tap(v_uv + o), R = tap(v_uv - o);
        vec3 l = unpremul(L).rgb, r = unpremul(R).rgb;
        vec3 rgb = u_view < 0.5 ? vec3(l.r, r.g, r.b) : u_view < 1.5 ? vec3(luma(l), 0.0, luma(r))
          : u_view < 2.5 ? vec3(r.r, l.g, r.b) : vec3(luma(l), r.g, r.b);
        outColor = premul(vec4(rgb, max(L.a, R.a)));
      }`,
    }],
  },
  {
    type: 'ae-bevel-alpha', name: 'Bevel Alpha', category: C,
    description: 'A lit, chiselled edge around the layer’s shape (text, logos, cut-outs).',
    keywords: 'emboss chisel 3d edge',
    params: [px('thickness', 'Edge thickness', 4, 50), deg('lightAngle', 'Light angle', -60), color('lightColor', 'Light colour', '#ffffff'), pct('intensity', 'Light intensity', 40)],
    passes: [{
      frag: `void main() {
        vec2 t = max(u_thickness * u_px, 1.0) / u_size;
        float gx = tap(v_uv + vec2(t.x, 0.0)).a - tap(v_uv - vec2(t.x, 0.0)).a + 0.5 * (tap(v_uv + vec2(t.x, 0.0) * 0.5).a - tap(v_uv - vec2(t.x, 0.0) * 0.5).a);
        float gy = tap(v_uv + vec2(0.0, t.y)).a - tap(v_uv - vec2(0.0, t.y)).a + 0.5 * (tap(v_uv + vec2(0.0, t.y) * 0.5).a - tap(v_uv - vec2(0.0, t.y) * 0.5).a);
        float a = radians(u_lightAngle);
        float s = -(gx * cos(a) + gy * sin(a)) * u_intensity / 100.0;
        vec4 c = src();
        vec3 rgb = s > 0.0 ? mix(c.rgb, u_lightColor, clamp(s, 0.0, 1.0)) : c.rgb * (1.0 + max(s, -1.0));
        outColor = premul(vec4(rgb, c.a));
      }`,
    }],
  },
  {
    type: 'ae-bevel-edges', name: 'Bevel Edges', category: C,
    description: 'Lit bevelled edges on the layer’s rectangle, like a raised tile or button.',
    keywords: 'button 3d frame',
    params: [pct('thickness', 'Edge thickness', 5), deg('lightAngle', 'Light angle', -60), color('lightColor', 'Light colour', '#ffffff'), pct('intensity', 'Light intensity', 40)],
    passes: [{
      frag: `void main() {
        vec2 P = v_uv * u_size;
        float T = u_thickness / 100.0 * 0.5 * min(u_size.x, u_size.y);
        vec4 d = vec4(P.x, u_size.x - P.x, P.y, u_size.y - P.y);
        float m = min(min(d.x, d.y), min(d.z, d.w));
        vec4 c = src();
        if (m < T) {
          vec2 n = m == d.x ? vec2(-1.0, 0.0) : m == d.y ? vec2(1.0, 0.0) : m == d.z ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
          float a = radians(u_lightAngle);
          float s = dot(n, vec2(cos(a), sin(a))) * u_intensity / 100.0;
          c.rgb = s > 0.0 ? mix(c.rgb, u_lightColor, s) : c.rgb * (1.0 + s);
        }
        outColor = premul(c);
      }`,
    }],
  },
  {
    type: 'ae-cylinder', name: 'Cylinder', category: C,
    description: 'Wrap the layer around a lit, spinning cylinder.',
    keywords: 'cc wrap 3d can label',
    params: [pct('radius', 'Radius', 70), deg('rotationY', 'Spin', 0), deg('rotationZ', 'Tilt', 0), select('render', 'Render', ['Full', 'Outside', 'Inside']), ...LIGHT],
    passes: [{
      frag: `${SHADE}
      void main() {
        vec2 p = rot2(-radians(u_rotationZ)) * ((v_uv - 0.5) * u_size);
        float R = max(u_radius / 100.0 * u_size.x * 0.5, 1.0);
        float x = p.x / R;
        if (abs(x) > 1.0 || abs(p.y) > u_size.y * 0.5) { outColor = vec4(0.0); return; }
        float v = p.y / u_size.y + 0.5;
        float tf = asin(x), tb = 3.14159 - tf, spin = radians(u_rotationY);
        vec4 front = texture(u_tex, vec2(fract((tf + spin) / 6.2832 + 0.5), v)) * shade(vec3(sin(tf), 0.0, cos(tf)));
        vec4 back = texture(u_tex, vec2(fract((tb + spin) / 6.2832 + 0.5), v)) * shade(-vec3(sin(tb), 0.0, cos(tb)));
        outColor = u_render < 0.5 ? front + back * (1.0 - front.a) : u_render < 1.5 ? front : back;
      }`,
    }],
  },
  {
    type: 'ae-sphere', name: 'Sphere', category: C,
    description: 'Wrap the layer onto a lit, rotating sphere (planets, globes, balls).',
    keywords: 'cc globe planet ball 3d',
    params: [
      pct('radius', 'Radius', 45), deg('rotationX', 'Rotation X', 0), deg('rotationY', 'Rotation Y', 0), deg('rotationZ', 'Rotation Z', 0),
      select('render', 'Render', ['Full', 'Outside', 'Inside']), ...LIGHT, pct('specular', 'Specular', 40),
    ],
    passes: [{
      frag: `${SHADE}
      vec2 sphereUv(vec3 s) {
        vec3 o = rotY(-radians(u_rotationY)) * rotX(-radians(u_rotationX)) * s;
        return vec2(atan(o.x, o.z) / 6.2832 + 0.5, asin(clamp(o.y, -1.0, 1.0)) / 3.14159 + 0.5);
      }
      void main() {
        vec2 q = rot2(-radians(u_rotationZ)) * ((v_uv - 0.5) * u_size) / max(u_radius / 100.0 * u_size.y, 1.0);
        float r2 = dot(q, q);
        if (r2 > 1.0) { outColor = vec4(0.0); return; }
        float z = sqrt(1.0 - r2);
        vec3 n = vec3(q, z);
        float a = radians(u_lightDirection);
        vec3 L = normalize(vec3(cos(a), sin(a), 1.2));
        float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 30.0) * u_specular / 100.0;
        vec4 front = texture(u_tex, sphereUv(n));
        front = vec4(front.rgb * shade(n) + spec * front.a, front.a);
        vec4 back = texture(u_tex, sphereUv(vec3(q, -z))) * shade(vec3(-q, z));
        outColor = u_render < 0.5 ? front + back * (1.0 - front.a) : u_render < 1.5 ? front : back;
        outColor.rgb = min(outColor.rgb, vec3(outColor.a));
      }`,
    }],
  },
  {
    type: 'ae-spotlight', name: 'Spotlight', category: C,
    description: 'A soft-edged spotlight shining onto the layer.',
    keywords: 'cc light pool stage',
    params: [
      ...point('from', 'From', 30, 15), ...point('to', 'To', 50, 60), pct('cone', 'Cone', 35), pct('edgeSoftness', 'Edge softness', 40),
      color('lightColor', 'Colour', '#fff4dc'), pct('intensity', 'Intensity', 100), pct('ambient', 'Ambient light', 20),
      select('render', 'Render', ['Light on layer', 'Light only', 'Layer only in light']),
    ],
    passes: [{
      frag: `void main() {
        vec2 aspect = vec2(u_size.x / u_size.y, 1.0);
        vec2 f = ${at('from')} * aspect, t = ${at('to')} * aspect, p = v_uv * aspect - t;
        vec2 dir = length(t - f) > 1e-4 ? normalize(t - f) : vec2(0.0, 1.0);
        float rb = max(u_cone / 100.0 * 0.5, 0.01), ra = rb * (1.0 + length(t - f));
        float e = length(vec2(dot(p, dir) / ra, dot(p, vec2(-dir.y, dir.x)) / rb));
        float soft = u_edgeSoftness / 100.0 + 0.01;
        float light = (1.0 - smoothstep(1.0 - soft, 1.0, e)) * u_intensity / 100.0;
        vec4 c = src();
        if (u_render < 0.5) outColor = premul(vec4(c.rgb * (u_ambient / 100.0 + light * u_lightColor), c.a));
        else if (u_render < 1.5) outColor = vec4(u_lightColor * light, light);
        else outColor = texture(u_tex, v_uv) * clamp(light, 0.0, 1.0);
      }`,
    }],
  },
  {
    type: 'ae-radial-shadow', name: 'Radial Shadow', category: C,
    description: 'A shadow cast from a point light, spreading away from it.',
    keywords: 'shadow light cast',
    params: [
      color('shadowColor', 'Shadow colour', '#000000'), pct('opacity', 'Opacity', 50), ...point('light', 'Light source', 50, 0),
      num('distance', 'Projection distance', 10, 0, 100), px('softness', 'Softness', 0, 100), bool('shadowOnly', 'Shadow only', false),
    ],
    passes: [{
      frag: `void main() {
        vec2 L = ${at('light')};
        vec2 q = L + (v_uv - L) / (1.0 + u_distance / 20.0);
        float r = u_softness * u_px;
        float s = 0.0;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.39996;
          s += tap(q + vec2(cos(a), sin(a)) * sqrt((float(i) + 0.5) / 12.0) * r / u_size).a;
        }
        s = s / 12.0 * u_opacity / 100.0;
        vec4 sh = vec4(u_shadowColor * s, s);
        vec4 c = texture(u_tex, v_uv);
        outColor = u_shadowOnly > 0.5 ? sh : c + sh * (1.0 - c.a);
      }`,
    }],
  },
]
