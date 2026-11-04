// User preferences: appearance, behaviour, feature toggles and AI credentials. Saved in this
// browser/app only (localStorage), never in project files.
import { create } from 'zustand'

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  accent: string
  fontSize: number // px
  trackHeight: number // px
  previewQuality: 1 | 0.5 | 0.25
  transparencyGrid: boolean
  guides: 'off' | 'thirds' | 'safe' | 'both'
  loop: boolean
  showWaveforms: boolean
  showThumbnails: boolean
  autosave: boolean
  showSidebar: boolean
  disabledFeatures: string[]
  // AI
  brushSize: number // comp px
  maskModel: 'fast' | 'detailed'
  maskSmoothing: number // outline simplification, px
  trackStep: 1 | 2 | 4 // track every Nth frame
  captionEngine: 'local' | 'openai'
  captionModel: 'tiny' | 'base'
  captionLanguage: string // '' = auto-detect
  anthropicKey: string
  claudeModel: string
  claudeEffort: 'low' | 'medium' | 'high'
  openaiKey: string
  openaiBaseUrl: string
  imageModel: string
  bridgeEnabled: boolean
  bridgePort: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#2d8ceb',
  fontSize: 12,
  trackHeight: 44,
  previewQuality: 1,
  transparencyGrid: false,
  guides: 'off',
  loop: false,
  showWaveforms: true,
  showThumbnails: true,
  autosave: true,
  showSidebar: true,
  disabledFeatures: [],
  brushSize: 40,
  maskModel: 'fast',
  maskSmoothing: 1.5,
  trackStep: 1,
  captionEngine: 'local',
  captionModel: 'base',
  captionLanguage: '',
  anthropicKey: '',
  claudeModel: 'claude-opus-5-5',
  claudeEffort: 'medium',
  openaiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  imageModel: 'gpt-image-1',
  bridgeEnabled: false,
  bridgePort: 5199,
}

const KEY = 'opencomp:settings'

function load(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const useSettings = create<Settings>()(() => ({ ...DEFAULT_SETTINGS, ...load() }))
export const getSettings = useSettings.getState
export const updateSettings = (patch: Partial<Settings>) => useSettings.setState(patch)

/** Whether a feature from the Features sidebar is switched on. */
export const isEnabled = (featureId: string) => !getSettings().disabledFeatures.includes(featureId)
export const useEnabled = (featureId: string) => useSettings((s) => !s.disabledFeatures.includes(featureId))

export function setFeatureEnabled(featureId: string, on: boolean) {
  const disabled = new Set(getSettings().disabledFeatures)
  if (on) disabled.delete(featureId)
  else disabled.add(featureId)
  updateSettings({ disabledFeatures: [...disabled] })
}

const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)')

/** Push appearance settings onto the document as data attributes and CSS variables. */
function applyAppearance(s: Settings) {
  const root = document.documentElement
  const dark = s.theme === 'dark' || (s.theme === 'system' && (systemDark?.matches ?? true))
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.setProperty('--accent', s.accent)
  root.style.setProperty('--fs', `${s.fontSize}px`)
}

applyAppearance(getSettings())
systemDark?.addEventListener('change', () => applyAppearance(getSettings()))
useSettings.subscribe((s) => {
  applyAppearance(s)
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Storage blocked: settings just won't persist.
  }
})
