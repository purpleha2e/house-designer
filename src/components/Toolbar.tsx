import { useState } from 'react'

type ToolbarProps = {
  floorCount: number
  isEngineConsoleOpen: boolean
  wallCount: number
  onLoadProject: () => void
  onEngineConsoleOpenChange: (isOpen: boolean) => void
  onOpenManufacturerPortal: () => void
  onSaveProject: () => void
}

export function Toolbar({
  isEngineConsoleOpen,
  onEngineConsoleOpenChange,
  onLoadProject,
  onOpenManufacturerPortal,
  onSaveProject,
}: ToolbarProps) {
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false)

  return (
    <header className="toolbar">
      <div className="project-menu">
        <button
          type="button"
          className="project-menu-button"
          aria-expanded={isProjectMenuOpen}
          aria-label="Project menu"
          onClick={() => setIsProjectMenuOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>
        {isProjectMenuOpen ? (
          <div className="project-menu-dropdown">
            <div>
              <h1>House Designer</h1>
            </div>
            <button
              type="button"
              onClick={() => {
                onLoadProject()
                setIsProjectMenuOpen(false)
              }}
            >
              Load
            </button>
            <button
              type="button"
              onClick={() => {
                onSaveProject()
                setIsProjectMenuOpen(false)
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenManufacturerPortal()
                setIsProjectMenuOpen(false)
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
        ) : null}
      </div>
    </header>
  )
}
