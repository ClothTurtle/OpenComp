import { layerGeometry, type Geometry } from '../lib/geometry'
import { resolveClip } from '../lib/keyframes'
import { layerTime } from '../lib/timeline'
import type { Clip, Project } from '../project'
import { layoutText } from './text'

/** Where a clip's picture sits in the comp at timeline time t (keyframes applied), or null for audio. */
export function clipGeometry(p: Project, clip: Clip, t: number): Geometry | null {
  const c = resolveClip(clip, layerTime(clip, t))
  const { width, height } = p.settings
  if (c.text) {
    const L = layoutText(c.text)
    return layerGeometry(c.transform, L.width, L.height, width, height, false)
  }
  if (c.solid || c.adjustment) return layerGeometry(c.transform, width, height, width, height, false)
  const asset = p.assets.find((a) => a.id === c.assetId)
  if (!asset || asset.kind === 'audio') return null
  return layerGeometry(c.transform, asset.width, asset.height, width, height)
}
