# OpenComp

(DISCLAIMER) This application is fully vibe-coded using Claude.

A lightweight, open-source video compositor and editor with a dark, panel-based layout inspired by After Effects. It has AI masking that follows objects, auto captions, 46 GPU effects, keyframes, and Claude built in.

It comes in two flavours, with the same app inside:

- **Desktop app** (Windows, macOS, Linux): download, install, run. Media is remembered by file path, so it never goes offline.
- **Browser version**: run it from source with one click, or host the built files anywhere. Nothing is uploaded; your media stays on your computer.

## Get it

### Desktop app

Download the installer for your system from the project's **Releases** page:

| System | File |
| --- | --- |
| Windows | `OpenComp-Setup-x.y.z.exe` (installer) or `OpenComp-Portable-x.y.z.exe` (no install) |
| macOS | `OpenComp-x.y.z.dmg` |
| Linux | `OpenComp-x.y.z.AppImage` |

The builds aren't code-signed yet. On Windows, click **More info → Run anyway** the first time. On macOS, right-click the app and choose **Open**.

### Browser version (from source)

**Windows:** double-click `start.bat`. **macOS / Linux:** run `./start.sh`.

The first run installs dependencies, then OpenComp opens at http://localhost:5173. You need [Node.js](https://nodejs.org) 20 or newer:

```bash
winget install OpenJS.NodeJS.LTS
```

Chrome or Edge is recommended (WebGPU makes the AI features much faster).

### Build the desktop app yourself

```bash
npm install
npm run desktop        # build and launch it
npm run desktop:dist   # make installers in desktop/release/
```

This needs Node.js 22.12 or newer. Electron is only downloaded for these commands, never for the browser version. Pushing a tag such as `v0.2.0` makes GitHub Actions build all three platforms and attach them to a release (`.github/workflows/desktop-release.yml`).

## What it does

Everything optional is listed in the **Features & Effects** sidebar on the right (Ctrl+B). It's searchable, and every item has an on/off switch. Switch off what you don't use and it disappears from the menus, toolbar and panels. Effects and presets can be dragged onto a clip, or applied to the selected clip.

| Area | Features |
| --- | --- |
| **Editing** | Tracks (top = top layer) with hide, mute, solo, lock and rename. Move and trim clips, with snapping. Split (S) or the razor tool (C). Duplicate, copy/paste, ripple delete. Clip speed 10–1000%. Markers. Work area (I/O) for looping and export. Undo everything. |
| **Layers** | Video, audio, images, **text** (font, outline, shadow, box), **solids**, and **adjustment layers** that apply their effects to everything below. Nine blend modes. |
| **Animation** | A keyframe stopwatch on every numeric property: transform, colour, volume, text size and every effect parameter. Easing, keyframe navigation, and diamonds on the timeline. 13 animation presets: fades, slides, pop, spin, Ken Burns, shake, blur-in. |
| **Colour** | Exposure, contrast, highlights, shadows, saturation, temperature and tint on every clip, plus Levels, Hue/Sat, Vibrance, split toning, duotone and more as effects. |
| **Effects (46)** | Colour & light, blurs (gaussian, directional, zoom), sharpen, distortions (wave, twirl, bulge, lens, RGB split, glitch, mirror, kaleidoscope), stylize (glow, drop shadow, outline, grain, scanlines, halftone, cartoon, old film), keying (chroma, luma) and transitions (fades, dip to colour, linear/iris/clock wipes). All run on the GPU. |
| **Masks** | Rectangle (Q), ellipse (E) and pen (G) masks, with add/subtract/intersect, feather, expansion, opacity and invert. |
| **AI masks** | **Mask brush (B):** paint over an object and the AI masks exactly that object. Alt-paint marks areas to leave out. **Smart click (A):** click an object and the AI works out what you mean; Tab cycles between interpretations (part vs. whole). **Tracking:** one click makes the mask follow the object through the clip. Runs locally (Segment Anything), downloaded once, ~15 MB. |
| **Audio** | Volume up to 200%, pan, fades, 3-band EQ, waveforms, level meter. |
| **Viewer** | Fit or 25–200% zoom, half/quarter preview resolution, rule-of-thirds and safe-area guides, transparency grid, Save Frame as PNG, maximize any panel (double-click its title). |
| **Export** | MP4 (H.264) or WebM with audio, whole edit or work area only. |
| **Settings** | Dark/light/system theme, accent colour, font size, track height, preview quality, autosave, AI models and keys. Press Ctrl+, to open them. |

Press **?** in the app to see every keyboard shortcut.

## AI and Claude

| Feature | How it runs | Needs |
| --- | --- | --- |
| AI mask brush, smart click, tracking | On your computer (Segment Anything via transformers.js; WebGPU when available) | Nothing; the model downloads on first use |
| Auto captions | On your computer (Whisper), or any OpenAI-compatible transcription API | Nothing, or an API key |
| Claude assistant | The **Claude** tab beside Markers: chat, and Claude edits the project for you and can look at frames to check its work | An Anthropic API key (Settings → AI) |
| Claude graphics | Claude draws titles, lower thirds and icons as vector graphics, added as images | An Anthropic API key |
| Image generation | Any OpenAI-compatible images API | That service's API key |
| **Claude Desktop / Claude Code** | Through MCP: Claude controls the open project with 28 tools (add text, effects, keyframes, masks, captions, get a rendered frame…) | Your Claude plan. No API key. |

### Connect Claude Desktop or Claude Code (MCP)

1. In OpenComp, open **Settings → Claude** and turn on **Connect to Claude Desktop / Claude Code**.
2. The same page shows the exact command to copy:
   - **Claude Code:** a one-line `claude mcp add opencomp …` command.
   - **Claude Desktop:** a snippet for `claude_desktop_config.json` (Claude Desktop → Settings → Developer → Edit Config), then restart Claude Desktop.
3. Ask Claude something like *"Add a title that says Summer 2026 and fade it in"*.

The bridge is `mcp/server.mjs`, a single dependency-free file. The desktop app ships it and runs it with its own runtime. The browser version runs it with Node. It only accepts connections from OpenComp on this computer.

API keys are stored only on this computer, in the app's local storage.

## Project structure

```
src/
  project.ts           Data model (Project, Asset, Clip, Track, Mask, Effect, Keyframe…) + migration of old files
  store.ts             App state: project, undo/redo history, UI state; autosave to IndexedDB
  settings.ts          Preferences, feature toggles, theme
  features.ts          The Features sidebar list (every toggleable feature)
  effects.ts           The effects library: each effect's parameters and GLSL shader passes
  actions.ts           Every editing command
  shortcuts.ts         Keyboard shortcuts (one table drives the handler and the Help dialog)
  platform.ts          Browser vs. desktop (file dialogs, file paths)
  engine/
    renderer.ts        WebGL2 compositor: per-layer passes (mask, grade, effects), blend modes, adjustment layers
    playback.ts        Preview loop: playhead, syncing media elements, rendering frames, frame capture
    media.ts           Imported files, decoders, waveforms, Web Audio graph (volume, pan, EQ, meter)
    masks.ts / text.ts Mask and text rasterising
    exporter.ts        MediaRecorder export
  ai/
    segment.worker.ts  Segment Anything in a worker; segmenter.ts + maskTools.ts drive brush/click/tracking
    asr.worker.ts      Whisper in a worker; captions.ts turns transcripts into caption layers
    tools.ts           The tools Claude can use (definitions in mcp/tools.json)
    claude.ts          In-app assistant and Claude graphics (Anthropic SDK)
    bridge.ts          Connection to the MCP bridge
    imagegen.ts        OpenAI-compatible image generation
  lib/                 Pure helpers (timeline maths, keyframes, geometry, contours…), unit tested
  components/          React UI: one file per panel, plus dialogs
mcp/                   MCP bridge for Claude Desktop / Claude Code (server.mjs + tools.json)
desktop/               Electron shell (main.cjs, preload.cjs) and installer config
scripts/desktop.mjs    Builds the web app into the desktop shell and runs/packages it
```

### Adding things

- **An effect:** add an entry to `EFFECTS` in `src/effects.ts`: parameters plus one or more GLSL passes. It automatically appears in the sidebar and Properties, is keyframeable, and becomes available to Claude.
- **A feature toggle:** add it to `src/features.ts` and check `useEnabled('your-id')` where it appears.
- **A Claude tool:** describe it in `mcp/tools.json` and implement it in `HANDLERS` in `src/ai/tools.ts`. Both the MCP bridge and the in-app assistant pick it up.
- **A clip property:** add it to `project.ts` (with a default in `newClip` / `migrateProject`), show it in `Inspector.tsx`, use it in `playback.ts` / `renderer.ts`.

## Known limitations

- **Export runs in real time** (it plays the edit while recording), so the window must stay visible. A faster frame-by-frame exporter is on the roadmap.
- AI mask tracking takes about 1–2 seconds per frame. Use **Settings → AI → Tracking detail** to track every 2nd or 4th frame.
- Codec support follows the browser engine. ProRes and some HEVC/MKV files may not open.
- In the browser version, media files are matched by name when you reopen a project (Relink). The desktop app doesn't need this.

## Roadmap

- AI in-between frames (RIFE) for smooth slow motion
- Faster frame-accurate export (WebCodecs)
- Multiple compositions / precomps, shape layers, motion tracking for any layer
- Code-signed desktop builds and auto-update

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Browser version with hot reload |
| `npm run build` | Type-check and build the browser version into `dist/` |
| `npm run desktop` | Build and launch the desktop app |
| `npm run desktop:dist` | Build desktop installers into `desktop/release/` |
| `npm test` | Unit tests |

## License

MIT. See [LICENSE](LICENSE). OpenComp is an independent project, not affiliated with Adobe. AI masks use Meta's Segment Anything and captions use OpenAI's Whisper, both run through transformers.js.
