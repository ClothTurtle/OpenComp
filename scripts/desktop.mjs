// Builds the web app into desktop/web, copies the MCP bridge next to it, then runs or packages the
// Electron app. Usage: node scripts/desktop.mjs run | dist [extra args for electron / electron-builder]
import { execSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2] ?? 'run'
const root = fileURLToPath(new URL('..', import.meta.url))
const desktop = join(root, 'desktop')
const sh = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' })

sh('npx vite build --outDir desktop/web --emptyOutDir')
rmSync(join(desktop, 'mcp'), { recursive: true, force: true })
cpSync(join(root, 'mcp'), join(desktop, 'mcp'), { recursive: true })
if (!existsSync(join(desktop, 'node_modules'))) sh('npm install', desktop)

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const extra = process.argv.slice(3).join(' ')
if (mode === 'dist') sh(`npx electron-builder --publish never -c.extraMetadata.version=${version} ${extra}`, desktop)
else sh(`npx electron . ${extra}`, desktop)
