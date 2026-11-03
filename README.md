# OpenComp

A lightweight, open-source video compositor and editor that runs in your browser, with a dark, panel-based layout inspired by After Effects.

No accounts, no uploads, no backend: your media never leaves your computer.

## Quick start

**Windows:** double-click `start.bat`.
**macOS / Linux:** run `./start.sh`.

The first run installs dependencies (about a minute), then OpenComp opens in your browser at http://localhost:5173.

You need [Node.js](https://nodejs.org) 20 or newer. On Windows you can install it with:

```bash
winget install OpenJS.NodeJS.LTS
```

Or by hand:

```bash
npm install
npm run dev
```

Chrome or Edge is recommended. Firefox and Safari should work; most testing so far has been in Chromium.

## What it does

| Area | Features |
| --- | --- |
| **Project panel** | Import video, audio and images (button, Ctrl+I, or drag files anywhere). Search, thumbnails, duration. Double-click or drag an item onto the timeline. |
| **Composition viewer** | Live WebGL preview. Zoom to fit or 25–200%. Click a layer to select it, drag it to move it. Play controls and timecode. |
| **Timeline** | Tracks (top track = top layer), each with hide and mute. Drag clips to move them in time or between tracks, drag their edges to trim. Snapping to the playhead, markers and other clips. Ctrl + scroll to zoom. |
| **Cutting** | Split at the playhead (S), or use the razor tool (C) and click where to cut. |
| **Properties** | Per clip: position, scale, rotation, opacity; colour grading (exposure, contrast, highlights, shadows, saturation, temperature, tint); volume up to 200%. Drag the blue numbers or type values. Double-click a label to reset it. |
| **Markers** | Bookmark the current frame with M. Label them, click to jump. They appear on the ruler and clips snap to them. |
| **Composition settings** | Name, resolution (1080p, 720p, 4K, vertical, square or custom), frame rate (23.976–60) and background colour. Ctrl+K. |
| **Export** | MP4 (H.264) or WebM, at the composition's resolution and frame rate, with audio. Ctrl+M. |
| **Workspace** | Drag the dividers between panels to resize them (sizes are remembered). Double-click a panel's title bar to maximize it, Esc to restore. View → Reset Panel Layout. |
| **Undo** | Full undo/redo for every edit (Ctrl+Z / Ctrl+Shift+Z). |

Press **?** in the app for every keyboard shortcut.

### Saving and media files

Your project autosaves in the browser, so a refresh doesn't lose work. **File → Save Project** downloads a `.opencomp.json` file you can open later or on another machine.

Browsers can't store links to files on disk, so project files hold your edits, not your media. When you reopen a project, the Project panel shows **"N files offline → Relink…"**. Select the original files and they're matched back up by name.

### Known limitations

- **Export runs in real time.** It plays the timeline while recording it, so a 2-minute edit takes 2 minutes to export, and the tab must stay visible. It can drop a few frames at the very start or end.
- Codec support is whatever your browser supports. ProRes and some HEVC/MKV files won't open in every browser.
- One composition per project, with no keyframes yet.

## Project structure

```
src/
  project.ts          The data model (Project, Asset, Clip, Track, Marker). Plain JSON: saved, autosaved, undone.
  store.ts            App state (zustand): the project, undo/redo history, and UI state (playhead, selection, zoom).
  actions.ts          Every editing command (import, add/split/delete clips, tracks, markers, save/open).
  shortcuts.ts        Keyboard shortcuts. One table drives both the key handler and the Help dialog.
  engine/
    renderer.ts       WebGL2 compositor. One textured quad per layer; transform + colour grade in a shader.
    playback.ts       The preview loop: advances the playhead, keeps <video>/<audio> elements in sync, redraws.
    media.ts          Runtime media: imported files, decoding elements, thumbnails, the Web Audio graph (volume).
    exporter.ts       Records the canvas + audio mix with MediaRecorder.
  lib/                Pure helpers with no DOM: timeline maths, geometry, timecode. Unit tested.
  components/         React UI: one file per panel (ProjectPanel, Viewer, Timeline, Inspector, MarkersPanel),
                      plus the resizable Split layout, Panel chrome, MenuBar, Toolbar and dialogs.
  styles.css          The theme. Colours and sizes are CSS variables at the top.
```

How a change flows: a component calls an **action** → the action edits a copy of the project through `commit()` (which records undo history and triggers autosave) → React re-renders the panels and **playback** redraws the preview.

### Adding features

- **A new clip property** (e.g. blur): add it to the types in `project.ts` and its default, add a row in `Inspector.tsx`, pass it to the shader in `renderer.ts`. Undo, save and autosave come for free.
- **A new per-pixel effect** (masks, keying, LUTs): extend the fragment shader in `renderer.ts`. A mask can be a second texture sampled alongside the clip.
- **A new panel**: create a component using `<Panel>` and place it in the `<Split>` layout in `App.tsx`.
- **A new command**: add a function to `actions.ts`, then a menu item in `MenuBar.tsx` and/or a row in `shortcuts.ts`.

## Roadmap

- Smart masking brush (in-browser segmentation, e.g. SAM via ONNX Runtime Web / WebGPU)
- Auto captions (in-browser speech-to-text, e.g. Whisper via transformers.js)
- Keyframes for transform, colour and volume
- Faster frame-accurate export with WebCodecs
- Text and shape layers, transitions
- Desktop build (Tauri) with direct file access, so media never goes offline

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Type-check and build a static site into `dist/` (host it anywhere, e.g. GitHub Pages) |
| `npm run preview` | Serve the built `dist/` locally |
| `npm test` | Run unit tests |
| `npm run typecheck` | Type-check only |

## License

MIT. See [LICENSE](LICENSE). OpenComp is an independent project, not affiliated with Adobe.
