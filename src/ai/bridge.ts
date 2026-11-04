// Connects the app to the OpenComp MCP bridge (mcp/server.mjs), which Claude Desktop / Claude Code
// launch. The bridge listens on 127.0.0.1; the app connects to it and runs the tool calls Claude sends.
import { create } from 'zustand'
import { getSettings, useSettings } from '../settings'
import { setState } from '../store'
import { runTool } from './tools'

export const useBridge = create<{ connected: number }>()(() => ({ connected: 0 }))

const PORTS = 3 // try the configured port and the next two (one per running Claude app)
const sockets = new Map<number, WebSocket>()
let timer: ReturnType<typeof setTimeout> | undefined
let delay = 2000

function update() {
  useBridge.setState({ connected: [...sockets.values()].filter((s) => s.readyState === WebSocket.OPEN).length })
}

function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  sockets.set(port, ws)
  ws.onopen = () => {
    delay = 2000
    ws.send(JSON.stringify({ type: 'hello', app: 'OpenComp', version: __APP_VERSION__ }))
    update()
  }
  ws.onmessage = async (e) => {
    const msg = JSON.parse(String(e.data)) as { type: string; id: number; name: string; args: unknown }
    if (msg.type !== 'call') return
    setState({ status: `Claude is using ${msg.name.replace(/_/g, ' ')}…` })
    const result = await runTool(msg.name, msg.args)
    setState({ status: result.isError ? `Claude: ${msg.name} failed` : '' })
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'result', id: msg.id, ...result }))
  }
  ws.onclose = () => {
    sockets.delete(port)
    update()
  }
}

function scan() {
  clearTimeout(timer)
  const { bridgeEnabled, bridgePort } = getSettings()
  if (!bridgeEnabled) return
  for (let port = bridgePort; port < bridgePort + PORTS; port++) if (!sockets.has(port)) connect(port)
  // Back off while nobody is listening, so a closed Claude app doesn't mean constant retries.
  delay = Math.min(delay * 1.5, 15000)
  timer = setTimeout(scan, delay)
}

function stop() {
  clearTimeout(timer)
  for (const ws of sockets.values()) ws.close()
  sockets.clear()
  update()
}

/** Start/stop the connection whenever the setting changes. */
export function startBridge() {
  const apply = () => (getSettings().bridgeEnabled ? scan() : stop())
  apply()
  useSettings.subscribe((s, prev) => {
    if (s.bridgeEnabled !== prev.bridgeEnabled || s.bridgePort !== prev.bridgePort) {
      stop()
      delay = 2000
      apply()
    }
  })
}
