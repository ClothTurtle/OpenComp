import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { relinkKnownPaths } from './actions'
import { startBridge } from './ai/bridge'
import { App } from './App'
import { restoreAutosave } from './store'
import './styles.css'

await restoreAutosave()
void relinkKnownPaths() // desktop: media is remembered by path, so reconnect it straight away
startBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
