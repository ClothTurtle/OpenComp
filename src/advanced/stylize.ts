// After Effects' Stylize category.
import { BLEND_ORIGINAL, NOISE, blurPasses, bool, color, colorFx, deg, num, pct, point, px, select, type EffectDef } from '../fxlib'

const C = 'Stylize'
const at = (key: string) => `vec2(u_${key}X, u_${key}Y) / 100.0`

/** Height from the (blurred) layer's brightness, and its normal. */
const BUMP = `float h(vec2 uv) { return luma(unpremul(texture(u_tex, uv)).rgb); }
vec2 grad(vec2 uv) {
  vec2 t = 2.0 / u_size;
  return vec2(h(uv + vec2(t.x, 0.0)) - h(uv - vec2(t.x, 0.0)), h(uv + vec2(0.0, t.y)) - h(uv - vec2(0.0, t.y)));
}
vec3 lightDir() { float a = radians(u_lightDirection); return normalize(vec3(cos(a), sin(a), 1.0)); }
`

export const STYLIZE: EffectDef[] = [
  {
    type: 'ae-block-load', name: 'Block Load', category: C,
    description: 'The picture builds up from big blocks to full detail, like a loading image. Animate Completion.',
    keywords: 'cc progressive jpeg pixel',
    params: [pct('completion', 'Completion', 50), bool('scanlines', 'Scanlines', true)],
    passes: [{
      frag: `void main() {
        float lev = mix(6.0, 0.0, clamp(u_completion / 100.0, 0.0, 1.0));
        float cell = exp2(floor(lev)) * max(u_px, 0.01);
        vec2 q = v_uv * u_size;
        if (u_scanlines > 0.5 && fract(lev) < 0.5 && mod(floor(q.y / cell), 2.0) < 1.0) cell = max(cell * 0.5, 1.0);
        outColor = cell <= 1.0 ? texture(u_tex, v_uv) : texture(u_tex, (floor(q / cell) + 0.5) * cell / u_size);
      }`,
    }],
  },
  {
    type: 'ae-burn-film', name: 'Burn Film', category: C,
    description: 'The frame burns away from a point, with glowing, charred edges. Animate Burn.',
    keywords: 'cc fire melt film burn',
    params: [pct('burn', 'Burn', 30), ...point('center', 'Centre'), num('seed', 'Random seed', 1, 0, 100)],
    passes: [{
      frag: `${NOISE}
      void main() {
        vec2 aspect = vec2(u_size.x / u_size.y, 1.0);
        vec2 p = (v_uv - ${at('center')}) * aspect;
        float v = fbm(v_uv * aspect * 4.0 + u_seed * 7.13, 0.0, 5.0, 0.0) * 0.5 + length(p) * 0.8;
        float th = u_burn / 100.0 * 1.4;
        vec4 c = src();
        vec3 rgb = mix(vec3(0.05, 0.02, 0.0), c.rgb, smoothstep(th + 0.01, th + 0.08, v));
        rgb += vec3(1.0, 0.45, 0.05) * (1.0 - smoothstep(th, th + 0.025, v)) * step(0.001, u_burn);
        outColor = premul(vec4(clamp(rgb, 0.0, 1.0), c.a * (u_burn > 0.0 ? smoothstep(th - 0.005, th + 0.005, v) : 1.0)));
      }`,
    }],
  },
  {
    type: 'ae-glass', name: 'Glass', category: C,
    description: 'Look at the layer through bumpy glass, using its own brightness as the surface.',
    keywords: 'cc refract bump',
    params: [px('softness', 'Softness', 8, 60), num('height', 'Height', 50, -100, 100), num('displacement', 'Displacement', 50, -200, 200), pct('lightIntensity', 'Light intensity', 80), deg('lightDirection', 'Light direction', -45)],
    passes: [
      ...blurPasses((p) => Number(p.softness)),
      {
        frag: `${BUMP}
        void main() {
          vec2 g = grad(v_uv) * u_height / 50.0;
          vec3 n = normalize(vec3(-g * 15.0, 1.0));
          vec4 o = texture(u_orig, v_uv + g * u_displacement / 100.0 * 20.0 * u_px / u_size);
          float spec = pow(max(dot(reflect(-lightDir(), n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0) * u_lightIntensity / 100.0;
          outColor = vec4(min(o.rgb + spec * o.a, vec3(o.a)), o.a);
        }`,
      },
    ],
  },
  {
    type: 'ae-hextile', name: 'HexTile', category: C,
    description: 'Hexagonal tiles: a hex mosaic at full smearing, more detail inside each tile below that.',
    keywords: 'cc hexagon honeycomb mosaic',
    params: [px('radius', 'Radius', 40, 400, 4), ...point('center', 'Centre'), deg('rotate', 'Rotate', 0), pct('smearing', 'Smearing', 100)],
    passes: [{
      frag: `void main() {
        float a = radians(u_rotate);
        mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
        vec2 Cp = ${at('center')} * u_size;
        float s = max(u_radius * u_px, 2.0);
        vec2 p = R * (v_uv * u_size - Cp) / s;
        const vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 ga = mod(p, r) - h, gb = mod(p - h, r) - h;
        vec2 g = dot(ga, ga) < dot(gb, gb) ? ga : gb;
        vec2 q = (p - g) + g * (1.0 - u_smearing / 100.0);
        outColor = tap((transpose(R) * (q * s) + Cp) / u_size);
      }`,
    }],
  },
  {
    type: 'ae-plastic', name: 'Plastic', category: C,
    description: 'Shiny, embossed plastic lighting from the layer’s own brightness.',
    keywords: 'cc emboss gloss bump',
    params: [
      px('softness', 'Softness', 6, 60), pct('height', 'Height', 50), pct('cutAway', 'Cut away', 0), pct('lightIntensity', 'Light intensity', 100),
      deg('lightDirection', 'Light direction', -45), color('lightColor', 'Light colour', '#ffffff'), pct('roughness', 'Roughness', 30),
    ],
    passes: [
      ...blurPasses((p) => Number(p.softness)),
      {
        frag: `${BUMP}
        void main() {
          vec3 n = normalize(vec3(-grad(v_uv) * u_height / 3.0, 1.0));
          vec3 L = lightDir();
          float li = u_lightIntensity / 100.0;
          float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), mix(60.0, 6.0, u_roughness / 100.0)) * li;
          vec4 o = unpremul(texture(u_orig, v_uv));
          vec3 rgb = o.rgb * mix(1.0, 0.35 + 0.9 * max(dot(n, L), 0.0), li) + u_lightColor * spec;
          float k = u_cutAway > 0.0 ? smoothstep(u_cutAway / 100.0 - 0.03, u_cutAway / 100.0 + 0.03, h(v_uv)) : 1.0;
          outColor = premul(vec4(clamp(rgb, 0.0, 1.0), o.a * k));
        }`,
      },
    ],
  },
  {
    type: 'ae-repetile', name: 'RepeTile', category: C,
    description: 'Shrink the layer and fill around it with repeated or mirrored copies.',
    keywords: 'cc repeat tile extend mirror',
    params: [pct('expand', 'Expand', 25), select('tiling', 'Tiling', ['Repeat', 'Unfold (mirror)', 'Checker flip H', 'Checker flip V'])],
    passes: [{
      frag: `void main() {
        vec2 q = (v_uv - 0.5) * (1.0 + 2.0 * u_expand / 100.0) + 0.5;
        vec2 cell = floor(q), f = fract(q);
        float odd = mod(cell.x + cell.y, 2.0);
        if (u_tiling > 0.5 && u_tiling < 1.5) f = mix(f, 1.0 - f, mod(cell, 2.0));
        else if (u_tiling > 1.5 && u_tiling < 2.5 && odd > 0.5) f.x = 1.0 - f.x;
        else if (u_tiling > 2.5 && odd > 0.5) f.y = 1.0 - f.y;
        outColor = texture(u_tex, f);
      }`,
    }],
  },
  {
    type: 'ae-threshold-rgb', name: 'Threshold RGB', category: C,
    description: 'Threshold red, green and blue separately for bold, posterised colour.',
    keywords: 'cc posterize pop art',
    params: [num('red', 'Red threshold', 128, 0, 255), num('green', 'Green threshold', 128, 0, 255), num('blue', 'Blue threshold', 128, 0, 255), bool('invert', 'Invert', false), BLEND_ORIGINAL],
    passes: [{
      frag: colorFx(`vec3 o = step(vec3(u_red, u_green, u_blue) / 255.0, rgb);
        if (u_invert > 0.5) o = 1.0 - o;
        rgb = mix(o, rgb, u_blend / 100.0);`),
    }],
  },
  {
    type: 'ae-color-emboss', name: 'Color Emboss', category: C,
    description: 'Emboss that keeps the original colours.',
    keywords: 'relief raised',
    params: [deg('direction', 'Direction', 45), px('relief', 'Relief', 2, 20), num('contrast', 'Contrast', 100, 0, 1000, 1, '%'), BLEND_ORIGINAL],
    passes: [{
      frag: colorFx(`float a = radians(u_direction);
        vec2 d = vec2(cos(a), sin(a)) * max(u_relief * u_px, 1.0) / u_size;
        float e = (lumAt(v_uv - d) - lumAt(v_uv + d)) * u_contrast / 100.0;
        rgb = mix(rgb + e, rgb, u_blend / 100.0);`),
    }],
  },
  {
    type: 'ae-mosaic', name: 'Mosaic', category: C,
    description: 'Big solid-colour blocks, set by how many across and down.',
    keywords: 'pixelate censor blocks',
    params: [num('hBlocks', 'Horizontal blocks', 10, 1, 400), num('vBlocks', 'Vertical blocks', 10, 1, 400), bool('sharpColors', 'Sharp colours', false)],
    passes: [{
      frag: `void main() {
        vec2 cell = 1.0 / vec2(u_hBlocks, u_vBlocks);
        vec2 base = floor(v_uv / cell) * cell;
        if (u_sharpColors > 0.5) { outColor = texture(u_tex, base + cell * 0.5); return; }
        vec4 acc = vec4(0.0);
        for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) acc += texture(u_tex, base + cell * (vec2(float(i), float(j)) + 0.5) / 4.0);
        outColor = acc / 16.0;
      }`,
    }],
  },
  {
    type: 'ae-motion-tile', name: 'Motion Tile', category: C,
    description: 'Tile the layer, with optional mirrored edges and offset rows.',
    keywords: 'repeat tile pattern',
    params: [
      ...point('tileCenter', 'Tile centre'), num('tileWidth', 'Tile width', 100, 1, 100, 1, '%'), num('tileHeight', 'Tile height', 100, 1, 100, 1, '%'),
      num('outputWidth', 'Output width', 300, 100, 1000, 1, '%'), num('outputHeight', 'Output height', 300, 100, 1000, 1, '%'),
      bool('mirrorEdges', 'Mirror edges', false), deg('phase', 'Phase', 0, 0, 360), bool('hPhaseShift', 'Horizontal phase shift', false),
    ],
    passes: [{
      frag: `void main() {
        vec2 tc = ${at('tileCenter')}, tile = vec2(u_tileWidth, u_tileHeight) / 100.0;
        vec2 q = (v_uv - 0.5) * vec2(u_outputWidth, u_outputHeight) / 100.0 + 0.5;
        vec2 t = (q - tc) / tile + 0.5;
        if (u_hPhaseShift > 0.5) t.y += floor(t.x) * u_phase / 360.0;
        else t.x += floor(t.y) * u_phase / 360.0;
        vec2 cell = floor(t), f = fract(t);
        if (u_mirrorEdges > 0.5) f = mix(f, 1.0 - f, mod(cell, 2.0));
        outColor = tap(tc + (f - 0.5) * tile);
      }`,
    }],
  },
  {
    type: 'ae-roughen-edges', name: 'Roughen Edges', category: C,
    description: 'Ragged, eroded edges, like torn paper or rust, on the layer’s shape.',
    keywords: 'torn paper rough erode',
    params: [
      select('edgeType', 'Edge type', ['Roughen', 'Roughen colour', 'Cut']), color('edgeColor', 'Edge colour', '#d35400'),
      px('border', 'Border', 8, 100), num('scale', 'Scale', 100, 10, 1000, 1, '%'), num('complexity', 'Complexity', 3, 1, 10),
      deg('evolution', 'Evolution', 0), num('evolutionSpeed', 'Evolution speed', 0, 0, 10, 0.1),
    ],
    passes: [{
      frag: `${NOISE}
      float erode(vec2 uv, float r) {
        float m = texture(u_tex, uv).a;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7854;
          m = min(m, tap(uv + vec2(cos(a), sin(a)) * r / u_size).a);
        }
        return m;
      }
      void main() {
        vec2 q = v_uv * u_size / max(u_scale / 100.0 * 40.0 * u_px, 1.0);
        float n = fbm(q, u_evolution / 360.0 + u_time * u_evolutionSpeed, u_complexity, 0.0);
        float b = u_border * u_px;
        float m = erode(v_uv, b * n);
        vec4 c = src();
        float k = u_edgeType > 1.5 ? step(0.5, m) : smoothstep(0.3, 0.7, m);
        vec3 rgb = c.rgb;
        if (u_edgeType > 0.5 && u_edgeType < 1.5) rgb = mix(u_edgeColor, rgb, smoothstep(0.3, 0.7, erode(v_uv, b * n + b * 0.4)));
        outColor = premul(vec4(rgb, c.a * k));
      }`,
    }],
  },
  {
    type: 'ae-scatter', name: 'Scatter', category: C,
    description: 'Scatter pixels randomly for a frosted or grainy break-up.',
    keywords: 'jitter diffuse frosted',
    params: [px('amount', 'Scatter amount', 8, 100), select('grain', 'Grain', ['Both', 'Horizontal', 'Vertical']), bool('randomize', 'Randomise every frame', false)],
    passes: [{
      frag: `void main() {
        vec2 q = floor(v_uv * u_size);
        float seed = u_randomize > 0.5 ? floor(u_time * 30.0) : 0.0;
        vec2 r = vec2(hash(q + seed), hash(q * 1.37 + seed + 7.1)) - 0.5;
        if (u_grain > 0.5 && u_grain < 1.5) r.y = 0.0;
        if (u_grain > 1.5) r.x = 0.0;
        outColor = tap(v_uv + r * u_amount * 2.0 * u_px / u_size);
      }`,
    }],
  },
  {
    type: 'ae-strobe-light', name: 'Strobe Light', category: C,
    description: 'Regular (or random) flashes of colour, or flicker the layer away.',
    keywords: 'flash flicker blink',
    params: [
      color('strobeColor', 'Strobe colour', '#ffffff'), BLEND_ORIGINAL, num('strobeDuration', 'Strobe duration', 0.05, 0.01, 5, 0.01, 's'),
      num('strobePeriod', 'Strobe period', 0.5, 0.02, 10, 0.01, 's'), pct('randomProbability', 'Random probability', 0),
      select('strobe', 'Strobe', ['Operates on colour', 'Makes layer transparent']),
    ],
    passes: [{
      frag: `void main() {
        float t = mod(u_local, u_strobePeriod);
        bool on = t < u_strobeDuration || hash(vec2(floor(u_local * 30.0), 1.3)) * 100.0 < u_randomProbability;
        vec4 c = texture(u_tex, v_uv);
        if (!on) { outColor = c; return; }
        float k = u_blend / 100.0;
        outColor = u_strobe < 0.5 ? vec4(mix(u_strobeColor * c.a, c.rgb, k), c.a) : c * k;
      }`,
    }],
  },
]
