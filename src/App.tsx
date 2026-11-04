import { useEffect, type DragEvent } from 'react'
import { importFiles } from './actions'
import { CaptionsDialog, ImageDialog } from './components/AIDialogs'
import { AssistantPanel } from './components/AssistantPanel'
import { CompSettingsDialog, ExportDialog, ShortcutsDialog } from './components/dialogs'
import { FeaturesSidebar } from './components/FeaturesSidebar'
import { Inspector } from './components/Inspector'
import { MarkersPanel } from './components/MarkersPanel'
import { MenuBar } from './components/MenuBar'
import { Panel } from './components/Panel'
import { ProjectPanel } from './components/ProjectPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { Split } from './components/Split'
import { Timeline } from './components/Timeline'
import { Toolbar } from './components/Toolbar'
import { Tabs } from './components/ui'
import { Viewer } from './components/Viewer'
import { useSettings } from './settings'
import { handleKeydown } from './shortcuts'
import { setState, useStore } from './store'

export function App() {
  const dialog = useStore((s) => s.dialog)
  const layoutVersion = useStore((s) => s.layoutVersion)
  const projectName = useStore((s) => s.project.name)
  const showSidebar = useSettings((s) => s.showSidebar)

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

  const workspace = (
    <Split id="rows" direction="vertical" initial={[62, 38]}>
      <Split id="top" direction="horizontal" initial={[20, 56, 24]}>
        <ProjectPanel />
        <Viewer />
        <Split id="side" direction="vertical" initial={[62, 38]}>
          <Inspector />
          <SideTabs />
        </Split>
      </Split>
      <Timeline />
    </Split>
  )

  return (
    <div className="app" onDragOver={onDragOver} onDrop={onDrop}>
      <MenuBar />
      <Toolbar />
      <main className="workspace" key={layoutVersion}>
        {showSidebar ? (
          <Split id="outer" direction="horizontal" initial={[80, 20]}>
            {workspace}
            <FeaturesSidebar />
          </Split>
        ) : (
          workspace
        )}
      </main>
      {dialog === 'comp' && <CompSettingsDialog />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'captions' && <CaptionsDialog />}
      {dialog === 'image' && <ImageDialog />}
    </div>
  )
}

/** Markers and the Claude assistant share the panel under Properties. */
function SideTabs() {
  const tab = useStore((s) => s.sideTab)
  const assistantOn = useSettings((s) => !s.disabledFeatures.includes('claude-assistant'))
  const active = assistantOn ? tab : 'markers'
  return (
    <Panel
      className="side-tabs"
      title={
        <Tabs
          value={active}
          onChange={(sideTab) => setState({ sideTab })}
          tabs={[{ id: 'markers', label: 'Markers' }, ...(assistantOn ? [{ id: 'assistant' as const, label: 'Claude' }] : [])]}
        />
      }
    >
      {active === 'markers' ? <MarkersPanel /> : <AssistantPanel />}
    </Panel>
  )
}
