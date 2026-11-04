import { describe, expect, it } from 'vitest'
import { ADVANCED_ALIASES, ADVANCED_CATEGORIES, ADVANCED_EFFECTS } from './advanced'
import { ALL_EFFECTS, EFFECT_MAP, defaultParams } from './effects'

// Uniforms every pass already gets from the renderer's shader header.
const HEADER_UNIFORMS = ['tex', 'orig', 'size', 'px', 'time', 'local', 'duration', 'dir']

describe('effects library', () => {
  it('gives every effect a unique type', () => {
    expect(new Set(ALL_EFFECTS.map((e) => e.type)).size).toBe(ALL_EFFECTS.length)
  })

  it('uses param keys that are valid, unique GLSL names', () => {
    for (const e of ALL_EFFECTS) {
      const keys = e.params.map((p) => p.key)
      expect(new Set(keys).size, e.type).toBe(keys.length)
      for (const key of keys) {
        expect(key, e.type).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/)
        expect(HEADER_UNIFORMS, `${e.type}.${key}`).not.toContain(key)
      }
    }
  })

  it('has sane defaults: numbers within range, selects one of their options', () => {
    for (const e of ALL_EFFECTS) {
      const values = defaultParams(e)
      for (const p of e.params) {
        if (p.type === 'number') expect(Number(values[p.key]), `${e.type}.${p.key}`).toBeGreaterThanOrEqual(p.min!)
        if (p.type === 'number') expect(Number(values[p.key]), `${e.type}.${p.key}`).toBeLessThanOrEqual(p.max!)
        if (p.type === 'select') expect(p.options, `${e.type}.${p.key}`).toContain(values[p.key])
      }
      expect(e.passes.length, e.type).toBeGreaterThan(0)
    }
  })

  it('files every After Effects-style effect and alias under a known AE category', () => {
    for (const e of ADVANCED_EFFECTS) expect(ADVANCED_CATEGORIES, e.type).toContain(e.category)
    for (const [name, category, type] of ADVANCED_ALIASES) {
      expect(ADVANCED_CATEGORIES, name).toContain(category)
      expect(EFFECT_MAP.has(type), `${name} -> ${type}`).toBe(true)
    }
  })

  it('computes an identity corner pin when the corners are untouched', () => {
    const pin = EFFECT_MAP.get('ae-corner-pin')!
    const m = pin.passes[0].uniforms!(defaultParams(pin)).u_H as number[]
    const scale = m[8]
    expect(m.map((v) => v / scale)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1].map((v) => expect.closeTo(v, 9)))
  })
})
