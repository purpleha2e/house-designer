import { useState } from 'react'
import type { FloorLevel, WallKind } from '../types'

type ToolbarProps = {
  activeFloorId: string
  floors: FloorLevel[]
  isAddingWall: boolean
  wallCount: number
  wallKind: WallKind
  onAddEmptyFloor: () => void
  onAddFloor: () => void
  onLoadProject: () => void
  onSaveProject: () => void
  onSelectFloor: (floorId: string) => void
  onToggleAddWall: () => void
  onWallKindChange: (wallKind: WallKind) => void
}

export function Toolbar({
  activeFloorId,
  floors,
  isAddingWall,
  wallCount,
  wallKind,
  onAddEmptyFloor,
  onAddFloor,
  onLoadProject,
  onSaveProject,
  onSelectFloor,
  onToggleAddWall,
  onWallKindChange,
}: ToolbarProps) {
  const [isFloorMenuOpen, setIsFloorMenuOpen] = useState(false)

  return (
    <header className="toolbar">
      <div>
        <h1>House Designer</h1>
        <p>{wallCount} walls across {floors.length} floors</p>
      </div>

      <div className="toolbar-controls">
        <div className="project-actions" aria-label="Project save and load">
          <button type="button" onClick={onSaveProject}>
            Save
          </button>
          <button type="button" onClick={onLoadProject}>
            Load
          </button>
        </div>

        <label className="toolbar-select">
          <span>Floor</span>
          <select
            value={activeFloorId}
            onChange={(event) => onSelectFloor(event.target.value)}
          >
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.name}
              </option>
            ))}
          </select>
        </label>

        <div className="split-button">
          <button type="button" onClick={onAddFloor}>
            Add Floor
          </button>
          <button
            type="button"
            aria-expanded={isFloorMenuOpen}
            aria-label="More add floor options"
            onClick={() => setIsFloorMenuOpen((value) => !value)}
          >
            v
          </button>
          {isFloorMenuOpen ? (
            <div className="split-button-menu">
              <button
                type="button"
                onClick={() => {
                  onAddEmptyFloor()
                  setIsFloorMenuOpen(false)
                }}
              >
                Add empty floor
              </button>
            </div>
          ) : null}
        </div>

        <div className="segmented-control" aria-label="Wall type">
          <button
            type="button"
            className={wallKind === 'external' ? 'active' : ''}
            onClick={() => onWallKindChange('external')}
          >
            External
          </button>
          <button
            type="button"
            className={wallKind === 'internal' ? 'active' : ''}
            onClick={() => onWallKindChange('internal')}
          >
            Internal
          </button>
        </div>

        <button
          type="button"
          className={isAddingWall ? 'tool-button active' : 'tool-button'}
          aria-pressed={isAddingWall}
          onClick={onToggleAddWall}
        >
          Add Wall
        </button>
      </div>
    </header>
  )
}
