import { useState } from 'react'

type ToolbarProps = {
  floorCount: number
  wallCount: number
  onLoadProject: () => void
  onSaveProject: () => void
}

export function Toolbar({
  floorCount,
  wallCount,
  onLoadProject,
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
              <p>
                {wallCount} walls across {floorCount} floors
              </p>
            </div>
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
                onLoadProject()
                setIsProjectMenuOpen(false)
              }}
            >
              Load
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
