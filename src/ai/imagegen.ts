// Image generation through any OpenAI-compatible images API (OpenAI, or a local/self-hosted server
// that speaks the same protocol), plus helpers to bring generated images into the project.
import { addClip, importFiles, importPaths } from '../actions'
import { desktop } from '../platform'
import { getSettings } from '../settings'

export async function generateImage(prompt: string, size: string): Promise<Blob> {
  const s = getSettings()
  if (!s.openaiKey) throw new Error('Add an image API key in Settings → AI.')
  const res = await fetch(`${s.openaiBaseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiKey}` },
    body: JSON.stringify({ model: s.imageModel, prompt, size, n: 1 }),
  })
  if (!res.ok) throw new Error(`Image API error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const item = ((await res.json()) as { data?: { b64_json?: string; url?: string }[] }).data?.[0]
  if (item?.b64_json) return new Blob([Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0))], { type: 'image/png' })
  if (item?.url) return (await fetch(item.url)).blob()
  throw new Error('The image API returned no image.')
}

/** Rasterise an SVG string to a PNG. */
export async function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the SVG'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Import a generated image and put it on the timeline at the playhead. */
export async function addGeneratedImage(blob: Blob, name: string) {
  const fileName = `${name.replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'generated'}.png`
  const assets = desktop
    ? await importPaths([await desktop.saveGenerated(await blob.arrayBuffer(), fileName)]) // keep it on disk so it never goes offline
    : await importFiles([new File([blob], fileName, { type: 'image/png' })])
  if (assets[0]) addClip(assets[0].id)
}
