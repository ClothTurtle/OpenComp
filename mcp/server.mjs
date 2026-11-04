#!/usr/bin/env node
// OpenComp MCP bridge. Claude Desktop / Claude Code start this as an MCP server (stdio). It listens
// on ws://127.0.0.1:5199 for the OpenComp app (browser or desktop) and forwards Claude's tool calls
// to it. No dependencies: just Node 18+ (or the desktop app's bundled runtime).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'

const TOOLS = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8'))
const PORT = Number(process.env.OPENCOMP_PORT) || 5199
const VERSION = '0.3.0'
const LONG_TOOLS = new Set(['track_mask', 'generate_captions', 'ai_mask', 'import_media'])
const NOT_CONNECTED =
  'OpenComp is not connected. Ask the user to open OpenComp and turn on Settings → Claude → "Connect to Claude Desktop / Claude Code".'

const log = (...args) => console.error('[opencomp-mcp]', ...args) // stdout is reserved for MCP messages

// ---- WebSocket server: just enough of RFC 6455 for local text messages ------------------------

const apps = new Set()
const pending = new Map()
let nextCallId = 0

// Only the OpenComp app (served from localhost, the desktop app, or a file) may connect.
const ALLOWED_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(:\d+)?|app:\/\/opencomp|file:\/\/|null)$/i

function accept(req, socket) {
  const origin = req.headers.origin
  const key = req.headers['sec-websocket-key']
  if (!key || (origin && !ALLOWED_ORIGIN.test(origin))) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    return
  }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  const app = { socket, buffer: Buffer.alloc(0), fragments: [] }
  apps.add(app)
  socket.on('data', (chunk) => {
    app.buffer = Buffer.concat([app.buffer, chunk])
    readFrames(app)
  })
  const drop = () => {
    if (apps.delete(app)) log('OpenComp disconnected')
  }
  socket.on('close', drop)
  socket.on('error', drop)
}

function readFrames(app) {
  for (;;) {
    const b = app.buffer
    if (b.length < 2) return
    const fin = b[0] & 0x80
    const opcode = b[0] & 0x0f
    const masked = b[1] & 0x80
    let length = b[1] & 0x7f
    let offset = 2
    if (length === 126) {
      if (b.length < 4) return
      length = b.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (b.length < 10) return
      length = Number(b.readBigUInt64BE(2))
      offset = 10
    }
    const maskAt = offset
    if (masked) offset += 4
    if (b.length < offset + length) return
    let payload = b.subarray(offset, offset + length)
    if (masked) {
      const mask = b.subarray(maskAt, maskAt + 4)
      payload = Buffer.from(payload.map((v, i) => v ^ mask[i % 4]))
    }
    app.buffer = b.subarray(offset + length)

    if (opcode === 0x8) app.socket.end()
    else if (opcode === 0x9) send(app, payload, 0xa)
    else if (opcode === 0x0 || opcode === 0x1) {
      app.fragments.push(payload)
      if (fin) {
        const text = Buffer.concat(app.fragments).toString('utf8')
        app.fragments = []
        onAppMessage(text)
      }
    }
  }
}

function send(app, data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
  let header
  if (payload.length < 126) header = Buffer.from([0x80 | opcode, payload.length])
  else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header.writeUInt16BE(payload.length, 2)
    header[1] = 126
  } else {
    header = Buffer.alloc(10)
    header.writeBigUInt64BE(BigInt(payload.length), 2)
    header[1] = 127
  }
  header[0] = 0x80 | opcode
  app.socket.write(Buffer.concat([header, payload]))
}

function onAppMessage(text) {
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }
  if (msg.type === 'hello') log(`OpenComp ${msg.version ?? ''} connected`)
  else if (msg.type === 'result') {
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
  }
}

function callApp(name, args) {
  const app = [...apps].at(-1) // the most recent connection
  if (!app) return Promise.resolve({ content: [{ type: 'text', text: NOT_CONNECTED }], isError: true })
  const id = ++nextCallId
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => {
        pending.delete(id)
        resolve({ content: [{ type: 'text', text: 'OpenComp did not answer in time.' }], isError: true })
      },
      LONG_TOOLS.has(name) ? 30 * 60_000 : 120_000,
    )
    pending.set(id, (msg) => {
      clearTimeout(timer)
      resolve({ content: msg.content ?? [], isError: !!msg.isError })
    })
    send(app, JSON.stringify({ type: 'call', id, name, args }))
  })
}

const http = createServer((_, res) => res.end('OpenComp MCP bridge'))
http.on('upgrade', accept)
http.on('error', (err) =>
  log(`Can't listen on 127.0.0.1:${PORT} (${err.code}). If another Claude app already runs the bridge, set OPENCOMP_PORT=${PORT + 1} for this one.`),
)
http.listen(PORT, '127.0.0.1', () => log(`waiting for OpenComp on ws://127.0.0.1:${PORT}`))

// ---- MCP over stdio: JSON-RPC 2.0, one message per line ---------------------------------------

const STATUS_TOOL = {
  name: 'opencomp_status',
  description: 'Check whether the OpenComp app is open and connected to this bridge.',
  inputSchema: { type: 'object', properties: {} },
}

const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`)

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  if (msg.id === undefined || msg.id === null) return // a notification: nothing to answer
  const reply = (result) => write({ jsonrpc: '2.0', id: msg.id, result })

  switch (msg.method) {
    case 'initialize':
      reply({
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'opencomp', version: VERSION },
        instructions:
          'Tools for editing the project open in the OpenComp video editor. Call get_project first. The user must have OpenComp open with the Claude connection switched on.',
      })
      break
    case 'ping':
      reply({})
      break
    case 'tools/list':
      reply({ tools: [STATUS_TOOL, ...TOOLS] })
      break
    case 'tools/call': {
      const { name, arguments: args } = msg.params ?? {}
      if (name === 'opencomp_status') {
        reply({ content: [{ type: 'text', text: apps.size ? 'OpenComp is connected.' : NOT_CONNECTED }] })
      } else if (!TOOLS.some((t) => t.name === name)) {
        reply({ content: [{ type: 'text', text: `Unknown tool "${name}"` }], isError: true })
      } else {
        reply(await callApp(name, args ?? {}))
      }
      break
    }
    default:
      write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } })
  }
})

process.stdin.on('end', () => process.exit(0))
