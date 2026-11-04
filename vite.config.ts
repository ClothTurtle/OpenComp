import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))

export default defineConfig({
  plugins: [react()],
  // Relative paths so the built app works from any folder or sub-path (e.g. GitHub Pages, the desktop app).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __PROJECT_ROOT__: JSON.stringify(root),
  },
  // The AI workers load their models with dynamic imports, which needs module workers.
  worker: { format: 'es' },
  // Only loaded on demand; pre-bundle them so the dev server doesn't reload the page on first use.
  optimizeDeps: { include: ['@huggingface/transformers', '@anthropic-ai/sdk'] },
  server: { port: 5173 },
})
