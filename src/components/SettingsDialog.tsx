import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useBridge } from '../ai/bridge'
import { resetLayout } from '../actions'
import { desktop, isDesktop } from '../platform'
import { DEFAULT_SETTINGS, updateSettings, useSettings, type Settings } from '../settings'
import { closeDialog, Modal, Tabs, Toggle } from './ui'

type Tab = 'general' | 'editing' | 'ai' | 'claude' | 'about'

const ACCENTS = ['#2d8ceb', '#8b5cf6', '#e5484d', '#f59e0b', '#22c55e', '#06b6d4', '#ec4899']

const CLAUDE_MODELS: [string, string][] = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (recommended)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (fastest, cheapest)'],
  ['claude-fable-5-1', 'Claude Fable 5.1 (most capable)'],
]

export function SettingsDialog() {
  const [tab, setTab] = useState<Tab>('general')
  const s = useSettings()
  const set = (patch: Partial<Settings>) => updateSettings(patch)

  return (
    <Modal
      title="Settings"
      wide
      footer={
        <>
          <button type="button" className="link" onClick={() => confirm('Reset all settings (not your API keys) to their defaults?') && set({ ...DEFAULT_SETTINGS, anthropicKey: s.anthropicKey, openaiKey: s.openaiKey })}>
            Reset to defaults
          </button>
          <div className="spacer" />
          <button type="button" className="btn primary" onClick={closeDialog}>
            Done
          </button>
        </>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'general', label: 'Appearance' },
          { id: 'editing', label: 'Preview & Timeline' },
          { id: 'ai', label: 'AI' },
          { id: 'claude', label: 'Claude' },
          { id: 'about', label: 'About' },
        ]}
      />
      <div className="settings-body">
        {tab === 'general' && (
          <>
            <Row label="Theme">
              <div className="segmented">
                {(['dark', 'light', 'system'] as const).map((t) => (
                  <button key={t} type="button" className={s.theme === t ? 'active' : ''} onClick={() => set({ theme: t })}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Accent colour">
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button key={c} type="button" className={`swatch ${s.accent === c ? 'active' : ''}`} style={{ background: c }} title={c} onClick={() => set({ accent: c })} />
                ))}
                <input type="color" value={s.accent} onChange={(e) => set({ accent: e.target.value })} title="Custom colour" />
              </div>
            </Row>
            <Row label={`Font size (${s.fontSize}px)`}>
              <input type="range" min={10} max={18} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
            </Row>
            <Row label="Features sidebar">
              <Toggle on={s.showSidebar} onChange={(v) => set({ showSidebar: v })} label="Show features sidebar" />
            </Row>
            <Row label="Panel layout">
              <button type="button" className="btn small" onClick={resetLayout}>
                Reset panel sizes
              </button>
            </Row>
          </>
        )}

        {tab === 'editing' && (
          <>
            <Row label="Preview resolution" hint="Lower is smoother on slow machines. Export is always full resolution.">
              <select value={s.previewQuality} onChange={(e) => set({ previewQuality: Number(e.target.value) as Settings['previewQuality'] })}>
                <option value={1}>Full</option>
                <option value={0.5}>Half</option>
                <option value={0.25}>Quarter</option>
              </select>
            </Row>
            <Row label="Transparency grid">
              <Toggle on={s.transparencyGrid} onChange={(v) => set({ transparencyGrid: v })} label="Transparency grid" />
            </Row>
            <Row label="Loop playback">
              <Toggle on={s.loop} onChange={(v) => set({ loop: v })} label="Loop playback" />
            </Row>
            <Row label={`Track height (${s.trackHeight}px)`}>
              <input type="range" min={28} max={96} value={s.trackHeight} onChange={(e) => set({ trackHeight: Number(e.target.value) })} />
            </Row>
            <Row label="Autosave" hint="Keeps your project in this browser/app so a refresh or crash doesn't lose work.">
              <Toggle on={s.autosave} onChange={(v) => set({ autosave: v })} label="Autosave" />
            </Row>
          </>
        )}

        {tab === 'ai' && (
          <>
            <h4>AI masks</h4>
            <Row label="Mask model" hint="Downloads once, then runs on this computer. Detailed is ~100 MB and slower.">
              <select value={s.maskModel} onChange={(e) => set({ maskModel: e.target.value as Settings['maskModel'] })}>
                <option value="fast">Fast (SlimSAM, ~15 MB)</option>
                <option value="detailed">Detailed (SAM ViT-B, ~100 MB)</option>
              </select>
            </Row>
            <Row label={`Edge smoothing (${s.maskSmoothing}px)`} hint="Higher gives smoother, simpler outlines; lower follows fine detail.">
              <input type="range" min={0.5} max={6} step={0.5} value={s.maskSmoothing} onChange={(e) => set({ maskSmoothing: Number(e.target.value) })} />
            </Row>
            <Row label="Tracking detail" hint="Tracking every frame is most accurate; every 2nd/4th frame is faster.">
              <select value={s.trackStep} onChange={(e) => set({ trackStep: Number(e.target.value) as Settings['trackStep'] })}>
                <option value={1}>Every frame</option>
                <option value={2}>Every 2nd frame</option>
                <option value={4}>Every 4th frame</option>
              </select>
            </Row>

            <h4>Claude (assistant & graphics)</h4>
            <Row label="Anthropic API key" hint="From console.anthropic.com. Stored only on this computer.">
              <input type="password" value={s.anthropicKey} placeholder="sk-ant-…" autoComplete="off" onChange={(e) => set({ anthropicKey: e.target.value.trim() })} />
            </Row>
            <Row label="Model">
              <select value={s.claudeModel} onChange={(e) => set({ claudeModel: e.target.value })}>
                {CLAUDE_MODELS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Effort" hint="Higher thinks harder on complex edits; lower is faster and cheaper.">
              <select value={s.claudeEffort} onChange={(e) => set({ claudeEffort: e.target.value as Settings['claudeEffort'] })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Row>

            <h4>Other AI services (OpenAI-compatible)</h4>
            <Row label="API base URL" hint="OpenAI, or any server that speaks the same API (e.g. a local one).">
              <input value={s.openaiBaseUrl} onChange={(e) => set({ openaiBaseUrl: e.target.value.trim() })} />
            </Row>
            <Row label="API key">
              <input type="password" value={s.openaiKey} placeholder="sk-…" autoComplete="off" onChange={(e) => set({ openaiKey: e.target.value.trim() })} />
            </Row>
            <Row label="Image model">
              <input value={s.imageModel} onChange={(e) => set({ imageModel: e.target.value.trim() })} />
            </Row>
          </>
        )}

        {tab === 'claude' && <ClaudeLink />}

        {tab === 'about' && (
          <div className="about">
            <p>
              <strong>OpenComp {__APP_VERSION__}</strong> · {isDesktop ? `desktop app (${desktop!.platform})` : 'browser version'}
            </p>
            <p>A lightweight, open-source video compositor and editor. MIT licensed.</p>
            <p className="muted">
              AI masks use Segment Anything (Meta) and captions use Whisper (OpenAI), both running locally through transformers.js. Nothing is uploaded unless you use an
              API-based feature with your own key.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div>{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  )
}

/** Setup for Claude Desktop / Claude Code: the MCP bridge command and its connection status. */
function ClaudeLink() {
  const s = useSettings()
  const connected = useBridge((b) => b.connected)
  const [cmd, setCmd] = useState<{ command: string; args: string[]; env: Record<string, string> } | null>(null)

  useEffect(() => {
    if (desktop) void desktop.mcpCommand().then(setCmd)
    else setCmd({ command: 'node', args: [`${__PROJECT_ROOT__.replace(/\\/g, '/')}/mcp/server.mjs`], env: {} })
  }, [])

  const desktopConfig = cmd && JSON.stringify({ mcpServers: { opencomp: { command: cmd.command, args: cmd.args, ...(Object.keys(cmd.env).length && { env: cmd.env }) } } }, null, 2)
  const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v)
  const codeCommand = cmd && ['claude mcp add opencomp', ...Object.entries(cmd.env).map(([k, v]) => `-e ${k}=${v}`), '--', quote(cmd.command), ...cmd.args.map(quote)].join(' ')

  return (
    <>
      <p>
        Let Claude Desktop or Claude Code edit this project with your Claude plan (no API key needed). They talk to OpenComp through a small bridge that ships with
        it.
      </p>
      <Row label="Connect to Claude Desktop / Claude Code" hint={s.bridgeEnabled ? (connected ? 'Connected.' : 'Waiting for Claude to start the bridge…') : 'Off.'}>
        <Toggle on={s.bridgeEnabled} onChange={(v) => updateSettings({ bridgeEnabled: v })} label="Connect to Claude" />
      </Row>
      <Row label="Bridge port" hint="Change only if 5199 is taken (set OPENCOMP_PORT for the bridge to match).">
        <input type="number" min={1024} max={65000} value={s.bridgePort} onChange={(e) => updateSettings({ bridgePort: Number(e.target.value) || 5199 })} />
      </Row>
      <h4>Claude Code</h4>
      <p className="hint">Run this once in a terminal:</p>
      {codeCommand && <Snippet text={codeCommand} />}
      <h4>Claude Desktop</h4>
      <p className="hint">In Claude Desktop open Settings → Developer → Edit Config, add this to claude_desktop_config.json, then restart Claude Desktop:</p>
      {desktopConfig && <Snippet text={desktopConfig} />}
      {!isDesktop && <p className="hint">The bridge needs Node.js 18+ (already installed if you run OpenComp from source).</p>}
    </>
  )
}

function Snippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="snippet">
      <pre>{text}</pre>
      <button
        type="button"
        className="btn small"
        onClick={() => {
          void navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
