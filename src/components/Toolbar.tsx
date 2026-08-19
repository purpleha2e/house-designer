import { useState } from 'react'
import type { FloorLevel, WallKind } from '../types'

type ToolbarProps = {
  activeFloorId: string
  floors: FloorLevel[]
  isAddingWall: boolean
  selectedFloorViewId: string
  wallCount: number
  wallKind: WallKind
  canCopy: boolean
  canPaste: boolean
  canRedo: boolean
  canUndo: boolean
  onAddEmptyFloor: () => void
  onAddFloor: () => void
  onCopy: () => void
  onCut: () => void
  onLoadProject: () => void
  onPaste: () => void
  onRedo: () => void
  onSaveProject: () => void
  onSelectFloor: (floorId: string) => void
  onToggleAddWall: () => void
  onUndo: () => void
  onWallKindChange: (wallKind: WallKind) => void
}

export function Toolbar({
  activeFloorId,
  floors,
  isAddingWall,
  selectedFloorViewId,
  wallCount,
  wallKind,
  canCopy,
  canPaste,
  canRedo,
  canUndo,
  onAddEmptyFloor,
  onAddFloor,
  onCopy,
  onCut,
  onLoadProject,
  onPaste,
  onRedo,
  onSaveProject,
  onSelectFloor,
  onToggleAddWall,
  onUndo,
  onWallKindChange,
}: ToolbarProps) {
  const [isFloorMenuOpen, setIsFloorMenuOpen] = useState(false)
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
                {wallCount} walls across {floors.length} floors
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

      <div className="tool-dock">
        <button
          type="button"
          className={isAddingWall ? 'tool-button active' : 'tool-button'}
          aria-pressed={isAddingWall}
          onClick={onToggleAddWall}
        >
          Add Wall
        </button>

        <div className="segmented-control compact edit-actions" aria-label="Edit actions">
          <button type="button" disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
          <button type="button" disabled={!canRedo} onClick={onRedo}>
            Redo
          </button>
          <button type="button" disabled={!canCopy} onClick={onCopy}>
            Copy
          </button>
          <button type="button" disabled={!canCopy} onClick={onCut}>
            Cut
          </button>
          <button type="button" disabled={!canPaste} onClick={onPaste}>
            Paste
          </button>
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

        <label className="toolbar-select">
          <span>Floor</span>
          <select
            value={selectedFloorViewId}
            onChange={(event) => onSelectFloor(event.target.value)}
          >
            <option value="all">All floors</option>
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.id === activeFloorId ? `${floor.name} (editing)` : floor.name}
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
      </div>
    </header>
  )
}
