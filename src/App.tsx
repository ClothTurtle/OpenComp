import { useEffect, type DragEvent } from 'react'
import { importFiles } from './actions'
import { CompSettingsDialog, ExportDialog, ShortcutsDialog } from './components/dialogs'
import { Inspector } from './components/Inspector'
import { MarkersPanel } from './components/MarkersPanel'
import { MenuBar } from './components/MenuBar'
import { ProjectPanel } from './components/ProjectPanel'
import { Split } from './components/Split'
import { Timeline } from './components/Timeline'
import { Toolbar } from './components/Toolbar'
import { Viewer } from './components/Viewer'
import { handleKeydown } from './shortcuts'
import { useStore } from './store'

export function App() {
  const dialog = useStore((s) => s.dialog)
  const layoutVersion = useStore((s) => s.layoutVersion)
  const projectName = useStore((s) => s.project.name)

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  useEffect(() => {
    document.title = `${projectName} — OpenComp`
  }, [projectName])

  // Files dropped anywhere are imported into the Project panel. (The timeline handles its own drops.)
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    void importFiles([...e.dataTransfer.files])
  }

  return (
    <div className="app" onDragOver={onDragOver} onDrop={onDrop}>
      <MenuBar />
      <Toolbar />
      <main className="workspace" key={layoutVersion}>
        <Split id="rows" direction="vertical" initial={[62, 38]}>
          <Split id="top" direction="horizontal" initial={[20, 58, 22]}>
            <ProjectPanel />
            <Viewer />
            <Split id="side" direction="vertical" initial={[65, 35]}>
              <Inspector />
              <MarkersPanel />
            </Split>
          </Split>
          <Timeline />
        </Split>
      </main>
      {dialog === 'comp' && <CompSettingsDialog />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
    </div>
  )
}
