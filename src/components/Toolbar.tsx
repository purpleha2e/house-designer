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
  onSaveToDevice: () => void
  onSaveToCloud: () => void
  canSave: boolean
  isSaving: boolean
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
  onSaveToDevice,
  onSaveToCloud,
  canSave,
  isSaving,
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
        disabled={!canSave}
        title={canSave ? 'Overwrite the last saved destination' : 'Choose Save to cloud or Save to device first'}
        onClick={() => {
          onSaveProject()
          onClose()
        }}
      >
        Save
      </button>
      <button type="button" disabled={isSaving} onClick={() => { onSaveToCloud(); onClose() }}>Save to cloud</button>
      <button type="button" disabled={isSaving} onClick={() => { onSaveToDevice(); onClose() }}>Save to device</button>
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
