import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSFORM, newClip, newProject, type Clip } from '../project'
import { corners, containsPoint, layerGeometry } from './geometry'
import { timecode, toFrame } from './time'
import { contentEnd, isFree, layerTime, playbackKeys, snapOffset, splitClip, visualClipsAt } from './timeline'

const clip = (over: Partial<Clip> = {}): Clip =>
  newClip({ id: 'a', assetId: 'asset', trackId: 't1', start: 2, in: 1, duration: 4, ...over })

describe('splitClip', () => {
  it('cuts into two pieces that cover the original', () => {
    const [left, right] = splitClip(clip(), 3.5, 'b')!
    expect(left).toMatchObject({ id: 'a', start: 2, in: 1, duration: 1.5 })
    expect(right).toMatchObject({ id: 'b', start: 3.5, in: 2.5, duration: 2.5 })
  })

  it('refuses to cut at or outside the edges', () => {
    expect(splitClip(clip(), 2, 'b')).toBeNull()
    expect(splitClip(clip(), 6, 'b')).toBeNull()
    expect(splitClip(clip(), 9, 'b')).toBeNull()
  })

  it('gives each piece its own settings objects', () => {
    const [left, right] = splitClip(clip(), 3, 'b')!
    right.color.exposure = 2
    expect(left.color.exposure).toBe(0)
  })

  it('accounts for speed when working out the right piece’s source offset', () => {
    const [, right] = splitClip(clip({ speed: 200 }), 3, 'b')!
    expect(right.in).toBe(3) // 1s into the clip at 2x = 2s of source, plus the original 1s in-point
  })

  it('keeps keyframe time stable across the cut', () => {
    const original = clip({ speed: 50 })
    const [left, right] = splitClip(original, 4, 'b')!
    expect(layerTime(left, 5)).toBeCloseTo(layerTime(original, 5))
    expect(layerTime(right, 5)).toBeCloseTo(layerTime(original, 5))
  })
})

describe('playbackKeys', () => {
  it('lets the pieces of a split share one element, and nothing else', () => {
    const p = newProject()
    const [a, b] = splitClip(clip({ trackId: 't1' }), 4, 'b')!
    const moved = clip({ id: 'moved', trackId: 't1', start: 10 }) // same media, but not continuous
    const other = clip({ id: 'other', trackId: 't2', start: 6, in: 5 }) // continuous source, different track
    p.clips = [b, a, moved, other]
    const keys = playbackKeys(p)
    expect(keys.get('a')).toBe('a')
    expect(keys.get('b')).toBe('a')
    expect(keys.get('moved')).toBe('moved')
    expect(keys.get('other')).toBe('other')
  })
})

describe('isFree', () => {
  const p = { ...newProject(), clips: [clip({ trackId: 't1', start: 2, duration: 4 })] }

  it('detects overlaps on the same track only', () => {
    expect(isFree(p, 't1', 5, 7)).toBe(false)
    expect(isFree(p, 't2', 5, 7)).toBe(true)
  })

  it('allows clips to touch end to end', () => {
    expect(isFree(p, 't1', 6, 8)).toBe(true)
    expect(isFree(p, 't1', 0, 2)).toBe(true)
  })

  it('ignores the clip being moved', () => {
    expect(isFree(p, 't1', 3, 7, 'a')).toBe(true)
  })
})

describe('snapOffset', () => {
  it('snaps the nearest edge within the threshold', () => {
    expect(snapOffset([1.95, 4.95], [2, 10], 0.1)).toBeCloseTo(0.05)
  })

  it('leaves things alone outside the threshold', () => {
    expect(snapOffset([1.5], [2], 0.1)).toBe(0)
  })
})

describe('contentEnd / visualClipsAt', () => {
  it('measures the end of the last clip', () => {
    const p = { ...newProject(), clips: [clip({ start: 0, duration: 3 }), clip({ id: 'b', start: 5, duration: 2 })] }
    expect(contentEnd(p)).toBe(7)
    expect(contentEnd(newProject())).toBe(0)
  })

  it('orders layers bottom track first and skips hidden tracks', () => {
    const p = newProject()
    const [top, middle, bottom] = p.tracks
    p.assets = [{ id: 'asset', name: 'x.mp4', kind: 'video', duration: 10, width: 1920, height: 1080 }]
    p.clips = [
      clip({ id: 'top', trackId: top.id, start: 0 }),
      clip({ id: 'mid', trackId: middle.id, start: 0 }),
      clip({ id: 'bot', trackId: bottom.id, start: 0 }),
    ]
    middle.hidden = true
    expect(visualClipsAt(p, 1).map((l) => l.clip.id)).toEqual(['bot', 'top'])
  })
})

describe('time', () => {
  it('formats timecode as H:MM:SS:FF', () => {
    expect(timecode(0, 30)).toBe('0:00:00:00')
    expect(timecode(65.5, 30)).toBe('0:01:05:15')
    expect(timecode(3600, 24)).toBe('1:00:00:00')
  })

  it('rounds to whole frames', () => {
    expect(toFrame(1.01, 30)).toBeCloseTo(1)
    expect(toFrame(1.02, 30)).toBeCloseTo(31 / 30)
  })
})

describe('geometry', () => {
  it('fits media to the frame and keeps aspect ratio', () => {
    const g = layerGeometry(DEFAULT_TRANSFORM, 1280, 720, 1920, 1080)
    expect(corners(g)).toEqual([
      [0, 0],
      [1920, 0],
      [1920, 1080],
      [0, 1080],
    ])
    const tall = layerGeometry(DEFAULT_TRANSFORM, 1080, 1920, 1920, 1080)
    expect(tall.h).toBeCloseTo(1080)
    expect(tall.w).toBeCloseTo(607.5)
  })

  it('hit-tests rotated layers', () => {
    const g = layerGeometry({ ...DEFAULT_TRANSFORM, scale: 50, rotation: 45 }, 100, 100, 100, 100)
    expect(containsPoint(g, 50, 50)).toBe(true)
    expect(containsPoint(g, 50, 20)).toBe(true) // inside the diamond's top point
    expect(containsPoint(g, 30, 30)).toBe(false) // would be inside if unrotated
  })
})
