// OpenComp desktop: a thin Electron shell around the web app (built into ./web).
// It serves the app and local media from app://opencomp/ and gives the page native file dialogs,
// so projects can reference media by path and never go "offline".
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')

const WEB_ROOT = path.join(__dirname, 'web')
const ICON = path.join(__dirname, 'build', 'icon.png')
// The MCP bridge is unpacked from the app archive so Claude can run it with the app's own Node runtime.
const MCP_SERVER = path.join(__dirname, 'mcp', 'server.mjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

const MEDIA_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.opus': 'audio/ogg',
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
])

/** Serve a file, honouring Range requests so video seeking works on large files. */
async function serveFile(file, request) {
  let stat
  try {
    stat = await fsp.stat(file)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
  if (range && stat.size) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1
    if (start > end) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      },
    })
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' },
  })
}

function handleRequest(request) {
  const { pathname } = new URL(request.url)
  // Local media: app://opencomp/@media/<url-encoded absolute path>
  if (pathname.startsWith('/@media/')) return serveFile(decodeURIComponent(pathname.slice('/@media/'.length)), request)
  const file = path.normalize(path.join(WEB_ROOT, decodeURIComponent(pathname)))
  if (!file.startsWith(WEB_ROOT)) return new Response('Forbidden', { status: 403 })
  const exists = fs.existsSync(file) && fs.statSync(file).isFile()
  return serveFile(exists ? file : path.join(WEB_ROOT, 'index.html'), request)
}

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#161616',
    title: 'OpenComp',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  })
  mainWindow.loadURL('app://opencomp/index.html')
  // Links open in the user's browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('app://')) return
    event.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })
  mainWindow.on('closed', () => (mainWindow = null))
}

const parentOf = (event) => BrowserWindow.fromWebContents(event.sender) ?? undefined

ipcMain.on('app-version', (event) => (event.returnValue = app.getVersion()))

ipcMain.handle('open-media', async (event) => {
  const result = await dialog.showOpenDialog(parentOf(event), {
    title: 'Import media',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video, audio and images', extensions: MEDIA_EXTENSIONS }, { name: 'All files', extensions: ['*'] }],
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('open-project', async (event) => {
  const result = await dialog.showOpenDialog(parentOf(event), {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'OpenComp project', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return { path: result.filePaths[0], content: await fsp.readFile(result.filePaths[0], 'utf8') }
})

ipcMain.handle('save-project', async (event, content, current) => {
  let target = current
  if (!target) {
    const result = await dialog.showSaveDialog(parentOf(event), {
      title: 'Save project',
      defaultPath: path.join(app.getPath('documents'), 'Untitled.opencomp.json'),
      filters: [{ name: 'OpenComp project', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    target = result.filePath
  }
  await fsp.writeFile(target, content, 'utf8')
  return target
})

ipcMain.handle('save-file', async (event, data, name) => {
  const result = await dialog.showSaveDialog(parentOf(event), { defaultPath: path.join(app.getPath('videos'), name) })
  if (result.canceled || !result.filePath) return null
  await fsp.writeFile(result.filePath, Buffer.from(data))
  return result.filePath
})

ipcMain.handle('save-generated', async (_event, data, name) => {
  const dir = path.join(app.getPath('userData'), 'generated')
  await fsp.mkdir(dir, { recursive: true })
  const target = path.join(dir, `${Date.now()}-${path.basename(name)}`)
  await fsp.writeFile(target, Buffer.from(data))
  return target
})

ipcMain.handle('exists', (_event, paths) => Promise.all(paths.map((p) => fsp.access(p).then(() => true, () => false))))

// How Claude Desktop / Claude Code should start the bundled MCP bridge: this executable, in Node mode.
ipcMain.handle('mcp-command', () => ({ command: process.execPath, args: [MCP_SERVER], env: { ELECTRON_RUN_AS_NODE: '1' } }))

ipcMain.on('open-external', (_event, url) => {
  if (/^https?:/.test(url)) void shell.openExternal(url)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    // Windows/Linux use the app's own menus; macOS needs the standard ones for copy/paste and quitting.
    Menu.setApplicationMenu(
      process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null,
    )
    protocol.handle('app', handleRequest)
    createWindow()
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
