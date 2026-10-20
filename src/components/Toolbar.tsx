type ToolbarProps = {
  onClose: () => void
  isEngineConsoleOpen: boolean
  onLoadProject: () => void
  onEngineConsoleOpenChange: (isOpen: boolean) => void
  onNewProject: () => void
  onOpenManufacturerPortal: () => void
  onOpenMaterialEditor: () => void
  onOpenAccount?: () => void
  onSaveProject: () => void
}

export function Toolbar({
  onClose,
  isEngineConsoleOpen,
  onEngineConsoleOpenChange,
  onLoadProject,
  onNewProject,
  onOpenManufacturerPortal,
  onOpenMaterialEditor,
  onOpenAccount,
  onSaveProject,
}: ToolbarProps) {
  return (
    <div className="project-menu-dropdown">
      <div>
        <h1>House Designer</h1>
      </div>
      {onOpenAccount && <button type="button" onClick={() => { onOpenAccount(); onClose() }}>Account &amp; workspace</button>}
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
      <button
        type="button"
        onClick={() => {
          onSaveProject()
          onClose()
        }}
      >
        Save
      </button>
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
