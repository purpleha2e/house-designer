type ToolbarProps = {
  onClose: () => void
  isEngineConsoleOpen: boolean
  onLoadProject: () => void
  onEngineConsoleOpenChange: (isOpen: boolean) => void
  onNewProject: () => void
  onOpenManufacturerPortal: () => void
  onSaveProject: () => void
}

export function Toolbar({
  onClose,
  isEngineConsoleOpen,
  onEngineConsoleOpenChange,
  onLoadProject,
  onNewProject,
  onOpenManufacturerPortal,
  onSaveProject,
}: ToolbarProps) {
  return (
    <div className="project-menu-dropdown">
      <div>
        <h1>House Designer</h1>
      </div>
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
