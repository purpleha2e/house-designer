type ToolbarProps = {
  onClose: () => void
  isEngineConsoleOpen: boolean
  onLoadProject: () => void
  recentProjects: { id: string; fileName: string; handle?: unknown }[]
  onLoadRecentProject: (id: string) => void
  onEngineConsoleOpenChange: (isOpen: boolean) => void
  onNewProject: () => void
  onOpenManufacturerPortal: () => void
  onOpenMaterialEditor: () => void
  onOpenObjectBuilder?: () => void
  onOpenAccount?: () => void
  onOpenDesignAssistant?: () => void
  onSaveProject: () => void
  onSaveToDevice: () => void
  onDownloadCopy?: () => void
  onSaveToCloud: () => void
  canSave: boolean
  saveToDevice?: boolean
  isSaving: boolean
}

export function Toolbar({
  onClose,
  isEngineConsoleOpen,
  onEngineConsoleOpenChange,
  onLoadProject,
  recentProjects,
  onLoadRecentProject,
  onNewProject,
  onOpenManufacturerPortal,
  onOpenMaterialEditor,
  onOpenObjectBuilder,
  onOpenAccount,
  onOpenDesignAssistant,
  onSaveProject,
  onSaveToDevice,
  onDownloadCopy,
  onSaveToCloud,
  canSave,
  saveToDevice,
  isSaving,
}: ToolbarProps) {
  return (
    <div className="project-menu-dropdown">
      <div>
        <h1>House Designer</h1>
      </div>
      {onOpenAccount && <button type="button" onClick={() => { onOpenAccount(); onClose() }}>Account &amp; workspace</button>}
      {onOpenDesignAssistant && <button type="button" onClick={() => { onOpenDesignAssistant(); onClose() }}>AI Design Assistant</button>}
      <button
        type="button"
        onClick={() => {
          onNewProject()
          onClose()
        }}
      >
        New
      </button>
      <button
        type="button"
        onClick={() => {
          onLoadProject()
          onClose()
        }}
      >
        Load
      </button>
      <section className="project-menu-recent" aria-label="Recent models">
        <h2 className="viewport-menu-heading">Recent</h2>
        {recentProjects.length ? recentProjects.map(project => (
          <button key={project.id} type="button" title={project.handle ? project.fileName : `${project.fileName} (stored copy)`}
            onClick={() => { onLoadRecentProject(project.id); onClose() }}>
            {project.fileName}
          </button>
        )) : <p className="viewport-menu-description">No recent models</p>}
      </section>
      <button
        type="button"
        disabled={!canSave}
        title={canSave ? (saveToDevice ? 'Save to the chosen local file; choose a location if needed' : 'Overwrite the last saved cloud model') : 'Choose Save to cloud or Save to device first'}
        onClick={() => {
          onSaveProject()
          onClose()
        }}
      >
        Save
      </button>
      <button type="button" disabled={isSaving} onClick={() => { onSaveToCloud(); onClose() }}>Save to cloud</button>
      <button type="button" disabled={isSaving} onClick={() => { onSaveToDevice(); onClose() }}>Save to device</button>
      {onDownloadCopy && <button type="button" disabled={isSaving} onClick={() => { onDownloadCopy(); onClose() }}>Download copy</button>}
      {onOpenObjectBuilder && <button type="button" onClick={() => { onOpenObjectBuilder(); onClose() }}>Object builder</button>}
      <button
        type="button"
        onClick={() => {
          onOpenMaterialEditor()
          onClose()
        }}
      >
        Material editor
      </button>
      <button
        type="button"
        onClick={() => {
          onOpenManufacturerPortal()
          onClose()
        }}
      >
        Assets
      </button>
      <label className="project-menu-checkbox">
        <input
          type="checkbox"
          checked={isEngineConsoleOpen}
          onChange={(event) =>
            onEngineConsoleOpenChange(event.target.checked)
          }
        />
        Console
      </label>
    </div>
  )
}
