// Runs Segment Anything (SAM) off the main thread. The image encoder is the slow part, so its output
// is cached per frame; each click/brush stroke after that only runs the fast mask decoder.
import { AutoProcessor, RawImage, SamModel, Tensor, env, type Processor } from '@huggingface/transformers'
import { vectorize, type VectorizeOptions } from '../lib/contours'

env.allowLocalModels = false

export const MODELS = {
  fast: 'Xenova/slimsam-77-uniform',
  detailed: 'Xenova/sam-vit-base',
} as const

export type WorkerRequest =
  | { type: 'load'; id: number; quality: keyof typeof MODELS }
  | {
      type: 'segment'
      id: number
      quality: keyof typeof MODELS
      key: string // identifies the frame, so its embedding can be reused
      image?: { data: Uint8ClampedArray; width: number; height: number }
      points: [number, number, 0 | 1][] // image px, label (1 = include, 0 = exclude)
      vectorize: VectorizeOptions
    }

export interface Candidate {
  polygons: [number, number][][] // normalised 0..1
  score: number
  area: number // fraction of the frame
}

export type WorkerResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; id: number; device: string }
  | { type: 'result'; id: number; candidates: Candidate[] }
  | { type: 'needImage'; id: number }
  | { type: 'error'; id: number; message: string }

interface Loaded {
  name: string
  device: string
  model: SamModel
  processor: Processor
}

let loading: Promise<Loaded> | null = null
let loadedName = ''
const embeddings = new Map<string, { inputs: any; embeddings: any }>()

const post = (msg: WorkerResponse) => self.postMessage(msg)

async function hasWebGPU() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  return !!gpu && !!(await gpu.requestAdapter().catch(() => null))
}

async function load(quality: keyof typeof MODELS): Promise<Loaded> {
  const name = MODELS[quality]
  if (loading && loadedName === name) return loading
  loadedName = name
  embeddings.clear()
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 })
  }
  const promise = (async (): Promise<Loaded> => {
    const processor = await AutoProcessor.from_pretrained(name, { progress_callback })
    // The heavy image encoder runs on WebGPU where available. The small prompt decoder always runs on
    // WebAssembly: on WebGPU it returns wrong masks once the number of prompt points changes.
    if (await hasWebGPU()) {
      try {
        const model = (await SamModel.from_pretrained(name, {
          device: { vision_encoder: 'webgpu', prompt_encoder_mask_decoder: 'wasm' },
          dtype: { vision_encoder: 'fp32', prompt_encoder_mask_decoder: 'q8' },
          progress_callback,
        })) as SamModel
        return { name, device: 'webgpu', model, processor }
      } catch {
        // fall through
      }
    }
    const model = (await SamModel.from_pretrained(name, { device: 'wasm', dtype: 'q8', progress_callback })) as SamModel
    return { name, device: 'wasm', model, processor }
  })()
  loading = promise
  promise.catch(() => {
    if (loading === promise) loading = null
  })
  return promise
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    const l = await load(msg.quality)
    if (msg.type === 'load') {
      post({ type: 'ready', id: msg.id, device: l.device })
      return
    }

    let entry = embeddings.get(msg.key)
    if (!entry) {
      if (!msg.image) {
        post({ type: 'needImage', id: msg.id })
        return
      }
      const image = new RawImage(msg.image.data, msg.image.width, msg.image.height, 4).rgb()
      const inputs = await l.processor(image)
      entry = { inputs, embeddings: await l.model.get_image_embeddings(inputs) }
      embeddings.set(msg.key, entry)
      if (embeddings.size > 6) embeddings.delete(embeddings.keys().next().value!)
    }
    if (!msg.points.length) {
      post({ type: 'result', id: msg.id, candidates: [] })
      return
    }

    const processor = l.processor as any
    const input_points = processor.reshape_input_points(
      [msg.points.map(([x, y]) => [x, y])],
      entry.inputs.original_sizes,
      entry.inputs.reshaped_input_sizes,
    )
    const input_labels = new Tensor('int64', BigInt64Array.from(msg.points.map((p) => BigInt(p[2]))), [1, 1, msg.points.length])
    const outputs: any = await (l.model as any)({ ...entry.embeddings, input_points, input_labels })
    const [masks] = await processor.post_process_masks(outputs.pred_masks, entry.inputs.original_sizes, entry.inputs.reshaped_input_sizes)
    const [, count, h, w] = masks.dims as number[]
    const data = masks.data as Uint8Array
    const scores = outputs.iou_scores.data as Float32Array
    const candidates: Candidate[] = []
    for (let k = 0; k < count; k++) {
      const mask = data.subarray(k * w * h, (k + 1) * w * h)
      let area = 0
      for (let i = 0; i < mask.length; i++) area += mask[i]
      candidates.push({ polygons: vectorize(mask, w, h, msg.vectorize), score: scores[k], area: area / (w * h) })
    }
    post({ type: 'result', id: msg.id, candidates })
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}
