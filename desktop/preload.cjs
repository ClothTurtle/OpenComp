// Exposes a small, safe API to the page as window.opencompDesktop (see src/platform.ts).
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('opencompDesktop', {
  platform: process.platform,
  version: ipcRenderer.sendSync('app-version'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  mediaUrl: (filePath) => `app://opencomp/@media/${encodeURIComponent(filePath)}`,
  openMedia: () => ipcRenderer.invoke('open-media'),
  openProject: () => ipcRenderer.invoke('open-project'),
  saveProject: (content, filePath) => ipcRenderer.invoke('save-project', content, filePath),
  saveFile: (data, name) => ipcRenderer.invoke('save-file', data, name),
  saveGenerated: (data, name) => ipcRenderer.invoke('save-generated', data, name),
  exists: (paths) => ipcRenderer.invoke('exists', paths),
  mcpCommand: () => ipcRenderer.invoke('mcp-command'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
})
