// Every optional feature, as listed in the Features sidebar. Each can be switched off in the sidebar
// (settings.disabledFeatures); the UI checks `useEnabled(id)` before showing it.
import {
  addAdjustmentLayer,
  addSolidLayer,
  addTextLayer,
  applyEffect,
  applyPreset,
  copyClip,
  duplicateClip,
  pasteClip,
  rippleDeleteSelected,
  saveFrame,
} from './actions'
import { EFFECTS } from './effects'
import { PRESETS } from './lib/presets'
import { setState, type Tool } from './store'

export interface Feature {
  id: string
  name: string
  category: string
  description: string
  keywords?: string
  /** A button next to the toggle (e.g. "Apply" for effects). `needsClip` disables it with nothing selected. */
  action?: { label: string; run: () => void; needsClip?: boolean }
}

const useTool = (tool: Tool) => () => setState({ tool })
const openDialog = (dialog: 'captions' | 'image') => () => setState({ dialog })

const BASE: Feature[] = [
  // Tools
  { id: 'tool-hand', name: 'Hand Tool (H)', category: 'Tools', description: 'Drag to pan around a zoomed-in preview.', action: { label: 'Use', run: useTool('hand') } },
  { id: 'tool-razor', name: 'Razor Tool (C)', category: 'Tools', description: 'Click a clip on the timeline to cut it there.', keywords: 'cut split', action: { label: 'Use', run: useTool('razor') } },
  { id: 'tool-text', name: 'Type Tool (T)', category: 'Tools', description: 'Click the preview to add a text layer there.', keywords: 'title', action: { label: 'Use', run: useTool('text') } },

  // Layers
  { id: 'text-layers', name: 'Text Layers', category: 'Layers', description: 'Titles and captions with font, outline, shadow and box.', keywords: 'title type', action: { label: 'New', run: () => addTextLayer() } },
  { id: 'solid-layers', name: 'Solid Layers', category: 'Layers', description: 'Full-frame colour layers, handy as backgrounds or with effects.', keywords: 'color background', action: { label: 'New', run: () => addSolidLayer() } },
  { id: 'adjustment-layers', name: 'Adjustment Layers', category: 'Layers', description: 'Apply colour, effects and masks to every layer below.', keywords: 'grade', action: { label: 'New', run: () => addAdjustmentLayer() } },
  { id: 'blend-modes', name: 'Blend Modes', category: 'Layers', description: 'Multiply, screen, overlay, add and more.', keywords: 'composite' },
  { id: 'keyframes', name: 'Keyframes', category: 'Layers', description: 'Animate any property with the stopwatch in Properties.', keywords: 'animate animation' },
  { id: 'speed', name: 'Clip Speed', category: 'Layers', description: 'Slow motion and fast forward, from 10% to 1000%.', keywords: 'slow motion time remap' },

  // Editing
  { id: 'duplicate', name: 'Duplicate Clip (Ctrl+D)', category: 'Editing', description: 'Copy a clip right after itself.', action: { label: 'Run', run: () => duplicateClip(), needsClip: true } },
  { id: 'copy-paste', name: 'Copy & Paste (Ctrl+C / V)', category: 'Editing', description: 'Copy a clip and paste it at the playhead.', action: { label: 'Copy', run: copyClip, needsClip: true } },
  { id: 'paste', name: 'Paste at Playhead', category: 'Editing', description: 'Paste the copied clip at the playhead.', action: { label: 'Paste', run: pasteClip } },
  { id: 'ripple-delete', name: 'Ripple Delete (Shift+Del)', category: 'Editing', description: 'Delete a clip and close the gap it leaves.', action: { label: 'Run', run: rippleDeleteSelected, needsClip: true } },

  // Timeline
  { id: 'work-area', name: 'Work Area (I / O)', category: 'Timeline', description: 'Limit playback, looping and export to a range.', keywords: 'in out range' },
  { id: 'track-lock', name: 'Track Lock', category: 'Timeline', description: 'Protect a track from accidental edits.' },
  { id: 'track-solo', name: 'Track Solo', category: 'Timeline', description: 'See and hear only the soloed tracks.' },
  { id: 'jump-edits', name: 'Jump Between Edits (J / K)', category: 'Timeline', description: 'Move the playhead to the previous/next cut or marker.', keywords: 'navigate' },
  { id: 'loop', name: 'Loop Playback (L)', category: 'Timeline', description: 'Repeat the work area (or the whole edit) while playing.' },
  { id: 'waveforms', name: 'Audio Waveforms', category: 'Timeline', description: 'Draw audio waveforms on clips.' },
  { id: 'thumbnails', name: 'Clip Thumbnails', category: 'Timeline', description: 'Show a picture of each video clip on the timeline.' },

  // Viewer
  { id: 'guides', name: 'Guides', category: 'Viewer', description: 'Rule-of-thirds grid and title/action safe areas.', keywords: 'grid safe' },
  { id: 'transparency-grid', name: 'Transparency Grid', category: 'Viewer', description: 'Show a checkerboard where nothing is drawn.', keywords: 'alpha checkerboard' },
  { id: 'preview-quality', name: 'Preview Resolution', category: 'Viewer', description: 'Full, half or quarter resolution for smoother previews.', keywords: 'performance' },
  { id: 'snapshot', name: 'Save Frame as PNG', category: 'Viewer', description: 'Export the current frame as an image.', keywords: 'screenshot still', action: { label: 'Save', run: () => void saveFrame() } },
  { id: 'audio-meter', name: 'Audio Level Meter', category: 'Viewer', description: 'Live output level in the toolbar.', keywords: 'vu' },

  // Audio
  { id: 'audio-fades', name: 'Audio Fades', category: 'Audio', description: 'Fade a clip’s sound in and out.' },
  { id: 'audio-pan', name: 'Stereo Pan', category: 'Audio', description: 'Move a clip’s sound left or right.' },
  { id: 'audio-eq', name: '3-Band EQ', category: 'Audio', description: 'Bass, mid and treble per clip.', keywords: 'equalizer' },

  // Masks
  { id: 'masks', name: 'Masks', category: 'Masks', description: 'Show or hide parts of a layer, with feather, expansion and invert.' },
  { id: 'shape-masks', name: 'Shape & Pen Masks (Q / E / G)', category: 'Masks', description: 'Draw rectangle, ellipse or freeform masks on the preview.', keywords: 'rectangle ellipse pen', action: { label: 'Use', run: useTool('rect-mask') } },
  { id: 'ai-mask-brush', name: 'AI Mask Brush (B)', category: 'Masks', description: 'Paint over an object and AI masks exactly that object. Alt-paint to remove.', keywords: 'segment anything sam rotoscope cutout', action: { label: 'Use', run: useTool('brush-mask') } },
  { id: 'ai-smart-mask', name: 'Smart Click Mask (A)', category: 'Masks', description: 'Click an object; AI works out what you mean. Alt-click to exclude, Tab for alternatives.', keywords: 'segment anything sam magic wand', action: { label: 'Use', run: useTool('smart-mask') } },
  { id: 'ai-mask-tracking', name: 'Mask Tracking', category: 'Masks', description: 'Follow a masked object as it moves through the clip.', keywords: 'track rotoscope' },

  // AI
  { id: 'claude-assistant', name: 'Claude Assistant', category: 'AI', description: 'Ask Claude to edit for you: cut, grade, add titles, effects and more.', keywords: 'anthropic chat agent', action: { label: 'Open', run: () => setState({ sideTab: 'assistant' }) } },
  { id: 'claude-mcp', name: 'Claude Desktop / Code Link (MCP)', category: 'AI', description: 'Let Claude Desktop or Claude Code control OpenComp.', keywords: 'model context protocol anthropic', action: { label: 'Set up', run: () => setState({ dialog: 'settings' }) } },
  { id: 'auto-captions', name: 'Auto Captions', category: 'AI', description: 'Transcribe speech into caption layers (runs locally, or via an API).', keywords: 'subtitles transcribe whisper speech', action: { label: 'Open', run: openDialog('captions') } },
  { id: 'image-generation', name: 'Image Generation', category: 'AI', description: 'Create images or Claude-drawn graphics and drop them in.', keywords: 'generate picture svg dall-e', action: { label: 'Open', run: openDialog('image') } },
]

const EFFECT_FEATURES: Feature[] = EFFECTS.map((e) => ({
  id: `fx:${e.type}`,
  name: e.name,
  category: `Effects · ${e.category}`,
  description: e.description,
  keywords: e.keywords,
  action: { label: 'Apply', run: () => void applyEffect(e.type), needsClip: true },
}))

const PRESET_FEATURES: Feature[] = PRESETS.map((p) => ({
  id: `preset:${p.id}`,
  name: p.name,
  category: 'Animation Presets',
  description: p.description,
  action: { label: 'Apply', run: () => applyPreset(p.id), needsClip: true },
}))

export const FEATURES: Feature[] = [...BASE, ...PRESET_FEATURES, ...EFFECT_FEATURES]
