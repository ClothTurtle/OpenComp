// The desktop app (desktop/preload.cjs) exposes `window.opencompDesktop`. In a browser it is
// undefined and the app falls back to file pickers, downloads and object URLs.

export interface DesktopApi {
  platform: string
  version: string
  /** Absolute path of a File from a drop or file input ("" if it has none). */
  pathForFile(file: File): string
  /** URL the app can stream a local file from (supports seeking). */
  mediaUrl(path: string): string
  openMedia(): Promise<string[]>
  openProject(): Promise<{ path: string; content: string } | null>
  /** Write a project file. Asks for a location when `path` is null; returns the path saved to. */
  saveProject(content: string, path: string | null): Promise<string | null>
  /** Save bytes through a native "Save as" dialog. */
  saveFile(data: ArrayBuffer, defaultName: string): Promise<string | null>
  /** Keep a generated file (AI image, graphic) in the app's data folder; returns its path. */
  saveGenerated(data: ArrayBuffer, name: string): Promise<string>
  exists(paths: string[]): Promise<boolean[]>
  /** How Claude Desktop / Claude Code should launch the MCP bridge bundled with the app. */
  mcpCommand(): Promise<{ command: string; args: string[]; env: Record<string, string> }>
  openExternal(url: string): void
}

export const desktop = (window as { opencompDesktop?: DesktopApi }).opencompDesktop

export const isDesktop = !!desktop
