// AI masks: turn the user's clicks/strokes into a mask on a clip, cycle between the model's
// alternative interpretations, and track the masked object through the clip.
import { create } from 'zustand'
import { addMask, updateMask } from '../actions'
import { imageElement, sourceUrl, waitFor } from '../engine/media'
import { elementFor, requestRender, waitForFrame } from '../engine/playback'
import { estimateShift, interiorPoints, iou, maskBounds, rasterize, shiftPolygons } from '../lib/contours'
import { sourceTime } from '../lib/timeline'
import { MASK_FPS, type Mask, type Point } from '../project'
import { getSettings } from '../settings'
import { getState, setState } from '../store'
import type { Candidate } from './segment.worker'
import { frameImage, rankCandidates, segment } from './segmenter'

type Prompt = [number, number, 0 | 1][]

/** The latest ranked alternatives for each mask, so Tab can cycle through them. */
const alternatives = new Map<string, { candidates: Candidate[]; index: number }>()

function selectedMedia() {
  const { project, selectedClipId } = getState()
  const clip = project.clips.find((c) => c.id === selectedClipId)
  const asset = project.assets.find((a) => a.id === clip?.assetId)
  if (!clip || !asset || asset.kind === 'audio') return null
  return { clip, asset }
}

/**
 * Mask the object the user pointed at on the selected clip's current frame. Adds to the selected AI
 * mask when it was made on this same frame (so extra clicks refine it); otherwise starts a new mask.
 */
export async function maskFromPrompt(newPoints: Prompt, fresh = false): Promise<string | null> {
  const media = selectedMedia()
  if (!media) {
    setState({ status: 'Select a video or image clip first' })
    return null
  }
  const { clip, asset } = media
  await waitForFrame()
  const { time, selectedMaskId } = getState()
  const frame = Math.round(sourceTime(clip, time) * MASK_FPS)
  const existing = clip.masks.find((m) => m.id === selectedMaskId && m.kind === 'ai')
  const refine = !fresh && existing?.prompt?.frame === frame
  const points: Prompt = [...(refine ? existing!.prompt!.points : []), ...newPoints]

  const grab = () => {
    const el = asset.kind === 'image' ? imageElement(asset, requestRender) : (elementFor(getState().project, clip, asset) as HTMLVideoElement | null)
    if (!el) throw new Error('The frame is not loaded yet')
    return frameImage(el, asset.width, asset.height)
  }
  setState({ status: 'Finding the object…' })
  const ranked = rankCandidates(await segment(`${asset.id}:${frame}`, grab, points), points)
  if (!ranked.length) {
    setState({ status: 'Nothing found there. Try clicking the middle of the object.' })
    return null
  }
  const shape = ranked[0].polygons as Point[][]
  const prompt = { frame, points }
  let maskId: string
  if (refine) {
    maskId = existing!.id
    updateMask(clip.id, maskId, (m) => {
      m.shape = shape
      m.prompt = prompt
      delete m.frames
    })
  } else {
    maskId = addMask(clip.id, { kind: 'ai', name: 'AI Mask', shape, prompt })
  }
  alternatives.set(maskId, { candidates: ranked, index: 0 })
  setState({ status: ranked.length > 1 ? 'Masked. Press Tab to try a different interpretation.' : 'Masked.' })
  return maskId
}

/** Swap the selected AI mask for the model's next-best interpretation (whole object vs. part). */
export function nextAlternative() {
  const { selectedClipId, selectedMaskId } = getState()
  const alt = selectedMaskId ? alternatives.get(selectedMaskId) : undefined
  if (!alt || !selectedClipId || alt.candidates.length < 2) return
  alt.index = (alt.index + 1) % alt.candidates.length
  updateMask(selectedClipId, selectedMaskId!, (m) => {
    m.shape = alt.candidates[alt.index].polygons as Point[][]
    delete m.frames
  })
  setState({ status: `Interpretation ${alt.index + 1} of ${alt.candidates.length}` })
}

// ---- Tracking -------------------------------------------------------------------------------

/** The tracking job in progress, if any (one at a time). */
export const useTracking = create<{ maskId: string | null; progress: number; cancel: () => void }>()(() => ({
  maskId: null,
  progress: 0,
  cancel: () => {},
}))

const GRAY_WIDTH = 192 // motion is estimated on small grayscale frames

/**
 * Follow the mask's object from its key frame to the end (dir 1) or start (dir -1) of the clip:
 * estimate how the object moved, prompt the model inside the predicted region, and keep whichever of
 * the model's answers best matches the prediction.
 */
export async function trackMask(clipId: string, maskId: string, dir: 1 | -1) {
  const { project, time } = getState()
  const clip = project.clips.find((c) => c.id === clipId)
  const asset = project.assets.find((a) => a.id === clip?.assetId)
  const mask = clip?.masks.find((m) => m.id === maskId)
  const url = asset && sourceUrl(asset.id)
  if (!clip || !asset || !mask || !url || asset.kind !== 'video') throw new Error('Tracking needs an AI mask on a video clip.')
  if (useTracking.getState().maskId) throw new Error('Another mask is already being tracked.')

  let cancelled = false
  useTracking.setState({ maskId, progress: 0, cancel: () => (cancelled = true) })
  const step = getSettings().trackStep * dir
  const firstFrame = Math.ceil(clip.in * MASK_FPS)
  const lastFrame = Math.floor(sourceTime(clip, clip.start + clip.duration - 1e-3) * MASK_FPS)
  const keyFrame = mask.prompt?.frame ?? Math.round(sourceTime(clip, time) * MASK_FPS)
  const total = Math.max(1, Math.abs((dir > 0 ? lastFrame : firstFrame) - keyFrame))

  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url
  await waitFor(video, 'loadeddata')
  const seekTo = async (frame: number) => {
    video.currentTime = frame / MASK_FPS
    await waitFor(video, 'seeked')
  }
  const gh = Math.round((GRAY_WIDTH * asset.height) / asset.width)
  const gray = () => {
    const { data } = frameImage(video, asset.width, asset.height, GRAY_WIDTH)
    const out = new Uint8Array(GRAY_WIDTH * gh)
    for (let i = 0; i < out.length; i++) out[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8
    return out
  }

  const frames: Record<string, Point[][]> = { ...mask.frames, [keyFrame]: mask.frames?.[keyFrame] ?? mask.shape }
  let prevPolys = frames[keyFrame]
  await seekTo(keyFrame)
  let prevGray = gray()
  let lost = 0
  const save = () =>
    updateMask(clipId, maskId, (m: Mask) => {
      m.frames = { ...frames }
    }, `track:${maskId}`)

  try {
    for (let f = keyFrame + step; dir > 0 ? f <= lastFrame : f >= firstFrame; f += step) {
      if (cancelled) break
      await seekTo(f)
      const curGray = gray()

      // Predict where the object is now, then ask the model to segment inside that prediction.
      const prevMask = rasterize(prevPolys, GRAY_WIDTH, gh)
      const box = maskBounds(prevMask, GRAY_WIDTH, gh)
      if (!box) break
      const [dx, dy] = estimateShift(prevGray, curGray, GRAY_WIDTH, gh, box, Math.round(GRAY_WIDTH * 0.08))
      const predicted = shiftPolygons(prevPolys, dx / GRAY_WIDTH, dy / gh)
      const predictedMask = rasterize(predicted, GRAY_WIDTH, gh)
      const points: Prompt = interiorPoints(predictedMask, GRAY_WIDTH, gh, 3).map(([x, y]) => [x / GRAY_WIDTH, y / gh, 1])
      if (!points.length) break

      const candidates = await segment(`${asset.id}:${f}`, () => frameImage(video, asset.width, asset.height), points)
      let best: Point[][] | null = null
      let bestScore = 0.15 // below this overlap the model lost the object
      for (const c of candidates) {
        const overlap = iou(rasterize(c.polygons as Point[][], GRAY_WIDTH, gh), predictedMask)
        if (overlap > bestScore) [best, bestScore] = [c.polygons as Point[][], overlap]
      }
      if (best) lost = 0
      else if (++lost > 3) break // object gone (left the frame, or occluded): stop
      frames[f] = best ?? predicted
      prevPolys = frames[f]
      prevGray = curGray

      useTracking.setState({ progress: Math.abs(f - keyFrame) / total })
      if (Object.keys(frames).length % 8 === 0) save()
    }
  } finally {
    save()
    video.removeAttribute('src')
    video.load()
    useTracking.setState({ maskId: null, progress: 0 })
  }
}
