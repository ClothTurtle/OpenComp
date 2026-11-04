import { useState } from 'react'
import { generateCaptions, useCaptions } from '../ai/captions'
import { addGeneratedImage, generateImage, svgToPng } from '../ai/imagegen'
import { updateSettings, useSettings, type Settings } from '../settings'
import { setState, useStore } from '../store'
import { closeDialog, Modal } from './ui'

const LANGUAGES = ['', 'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch', 'japanese', 'korean', 'chinese', 'hindi', 'arabic', 'russian', 'vietnamese']

export function CaptionsDialog() {
  const prefs = useSettings()
  const { running, message } = useCaptions()
  const selected = useStore((s) => {
    const clip = s.project.clips.find((c) => c.id === s.selectedClipId)
    const asset = s.project.assets.find((a) => a.id === clip?.assetId)
    return asset && asset.kind !== 'image' ? clip : undefined
  })
  const [scope, setScope] = useState<'selected' | 'all'>(selected ? 'selected' : 'all')

  const start = () => void generateCaptions(scope === 'selected' && selected ? [selected.id] : undefined).catch(() => {})

  return (
    <Modal
      title="Auto Captions"
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={running} onClick={start}>
            {running ? 'Working…' : 'Generate captions'}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          Caption
          <select value={scope} onChange={(e) => setScope(e.target.value as 'selected' | 'all')}>
            {selected && <option value="selected">The selected clip</option>}
            <option value="all">Every clip with sound</option>
          </select>
        </label>
        <label>
          Transcribe with
          <select value={prefs.captionEngine} onChange={(e) => updateSettings({ captionEngine: e.target.value as Settings['captionEngine'] })}>
            <option value="local">This computer (free, private; downloads a model once)</option>
            <option value="openai">OpenAI-compatible API (needs a key in Settings → AI)</option>
          </select>
        </label>
        {prefs.captionEngine === 'local' && (
          <label>
            Accuracy
            <select value={prefs.captionModel} onChange={(e) => updateSettings({ captionModel: e.target.value as Settings['captionModel'] })}>
              <option value="tiny">Fast (Whisper tiny, ~40 MB)</option>
              <option value="base">Better (Whisper base, ~80 MB)</option>
            </select>
          </label>
        )}
        <label>
          Language
          <select value={prefs.captionLanguage} onChange={(e) => updateSettings({ captionLanguage: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l ? l[0].toUpperCase() + l.slice(1) : 'Detect automatically'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">Captions are added as text layers on a new “Captions” track. Restyle them like any text layer.</p>
      {message && <p className="message">{message}</p>}
    </Modal>
  )
}

export function ImageDialog() {
  const { width, height } = useStore((s) => s.project.settings)
  const hasClaude = useSettings((s) => !!s.anthropicKey)
  const hasImageApi = useSettings((s) => !!s.openaiKey)
  const [source, setSource] = useState<'claude' | 'api'>(hasClaude || !hasImageApi ? 'claude' : 'api')
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1536x1024')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const ready = source === 'claude' ? hasClaude : hasImageApi

  const generate = async () => {
    setBusy(true)
    setMessage(source === 'claude' ? 'Claude is drawing…' : 'Generating…')
    try {
      let blob: Blob
      if (source === 'claude') {
        const { claudeGraphic } = await import('../ai/claude')
        blob = await svgToPng(await claudeGraphic(prompt, width, height), width, height)
      } else {
        blob = await generateImage(prompt, size)
      }
      await addGeneratedImage(blob, prompt)
      setMessage('Added to the project and the timeline at the playhead.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Generate Image"
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={busy || !prompt.trim() || !ready} onClick={generate}>
            {busy ? 'Working…' : 'Generate'}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          Create with
          <select value={source} onChange={(e) => setSource(e.target.value as 'claude' | 'api')}>
            <option value="claude">Claude: titles, lower thirds, icons, shapes (vector graphics)</option>
            <option value="api">Image model: photos & illustrations (OpenAI-compatible API)</option>
          </select>
        </label>
        <label>
          Describe it
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={source === 'claude' ? 'A bold lower third that says “Jane Doe — Director”, white text on a blue bar' : 'A misty mountain lake at sunrise, cinematic'}
          />
        </label>
        {source === 'api' && (
          <label>
            Size
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="1536x1024">Landscape</option>
              <option value="1024x1024">Square</option>
              <option value="1024x1536">Portrait</option>
            </select>
          </label>
        )}
      </div>
      {!ready && (
        <p className="message">
          {source === 'claude' ? 'Add an Anthropic API key' : 'Add an image API key'} in{' '}
          <button type="button" className="link" onClick={() => setState({ dialog: 'settings' })}>
            Settings → AI
          </button>
          .
        </p>
      )}
      {message && <p className="message">{message}</p>}
    </Modal>
  )
}
