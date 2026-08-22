import { useState } from 'react'
import type { FloorLevel, WallKind } from '../types'

type RailPanel = 'floor' | 'project' | 'wall'

type LeftToolRailProps = {
  activeFloorId: string
  canCopy: boolean
  canPaste: boolean
  canRedo: boolean
  canUndo: boolean
  floors: FloorLevel[]
  internalWallThickness: number
  isAddingWall: boolean
  selectedFloorViewId: string
  wallCount: number
  wallKind: WallKind
  onAddEmptyFloor: () => void
  onAddFloor: () => void
  onCopy: () => void
  onCut: () => void
  onDeleteFloor: () => void
  onInternalWallThicknessChange: (thickness: number) => void
  onLoadProject: () => void
  onOpenModelSelector: () => void
  onPaste: () => void
  onRedo: () => void
  onSaveProject: () => void
  onSelectFloor: (floorId: string) => void
  onToggleAddWall: () => void
  onUndo: () => void
  onWallKindChange: (wallKind: WallKind) => void
}

function IconButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean
  children: string
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function LeftToolRail({
  activeFloorId,
  canCopy,
  canPaste,
  canRedo,
  canUndo,
  floors,
  internalWallThickness,
  isAddingWall,
  selectedFloorViewId,
  wallCount,
  wallKind,
  onAddEmptyFloor,
  onAddFloor,
  onCopy,
  onCut,
  onDeleteFloor,
  onInternalWallThicknessChange,
  onLoadProject,
  onOpenModelSelector,
  onPaste,
  onRedo,
  onSaveProject,
  onSelectFloor,
  onToggleAddWall,
  onUndo,
  onWallKindChange,
}: LeftToolRailProps) {
  const [openPanel, setOpenPanel] = useState<RailPanel | null>(null)
  const activeFloor = floors.find((floor) => floor.id === activeFloorId)
  const updateInternalWallThickness = (value: string) => {
    const parsedValue = Number.parseFloat(value)

    if (!Number.isFinite(parsedValue)) {
      return
    }

    onInternalWallThicknessChange(
      Math.min(0.3, Math.max(0.05, parsedValue)),
    )
  }
  const togglePanel = (panel: RailPanel) => {
    setOpenPanel((currentPanel) => (currentPanel === panel ? null : panel))
  }

  return (
    <>
      <nav className="left-tool-rail" aria-label="Editor tools">
        <IconButton
          active={openPanel === 'project'}
          label="Project"
          onClick={() => togglePanel('project')}
        >
          P
        </IconButton>
        <IconButton
          active={isAddingWall || openPanel === 'wall'}
          label="Wall tools"
          onClick={() => togglePanel('wall')}
        >
          W
        </IconButton>
        <IconButton
          active={openPanel === 'floor'}
          label="Floor tools"
          onClick={() => togglePanel('floor')}
        >
          F
        </IconButton>
        <IconButton label="Add model" onClick={onOpenModelSelector}>
          M
        </IconButton>
        <div className="left-tool-rail-divider" />
        <IconButton disabled={!canUndo} label="Undo" onClick={onUndo}>
          U
        </IconButton>
        <IconButton disabled={!canRedo} label="Redo" onClick={onRedo}>
          R
        </IconButton>
        <IconButton disabled={!canCopy} label="Copy" onClick={onCopy}>
          C
        </IconButton>
        <IconButton disabled={!canCopy} label="Cut" onClick={onCut}>
          X
        </IconButton>
        <IconButton disabled={!canPaste} label="Paste" onClick={onPaste}>
          V
        </IconButton>
      </nav>

      {openPanel ? (
        <aside className="left-tool-flyout" aria-label={`${openPanel} tools`}>
          {openPanel === 'project' ? (
            <>
              <header>
                <h2>Project</h2>
                <p>
                  {wallCount} walls, {floors.length} floors
                </p>
              </header>
              <button type="button" onClick={onSaveProject}>
                Save project
              </button>
              <button type="button" onClick={onLoadProject}>
                Load project
              </button>
            </>
          ) : null}

          {openPanel === 'wall' ? (
            <>
              <header>
                <h2>Walls</h2>
                <p>{isAddingWall ? 'Click and drag in 2D' : 'Choose wall type'}</p>
              </header>
              <button
                type="button"
                className={isAddingWall ? 'active' : ''}
                onClick={onToggleAddWall}
              >
                {isAddingWall ? 'Stop adding walls' : 'Add wall'}
              </button>
              <div className="flyout-segmented-control" aria-label="Wall type">
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
              <label className="flyout-field">
                <span>Internal thickness</span>
                <div>
                  <input
                    type="number"
                    min="0.05"
                    max="0.3"
                    step="0.005"
                    value={internalWallThickness}
                    onChange={(event) =>
                      updateInternalWallThickness(event.target.value)
                    }
                  />
                  <span>m</span>
                </div>
              </label>
            </>
          ) : null}

          {openPanel === 'floor' ? (
            <>
              <header>
                <h2>Floors</h2>
                <p>{activeFloor ? `Editing ${activeFloor.name}` : 'No active floor'}</p>
              </header>
              <label className="flyout-select">
                <span>View / edit</span>
                <select
                  value={selectedFloorViewId}
                  onChange={(event) => onSelectFloor(event.target.value)}
                >
                  <option value="all">All floors</option>
                  {floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.id === activeFloorId
                        ? `${floor.name} (editing)`
                        : floor.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={onAddFloor}>
                Add floor from external walls
              </button>
              <button type="button" onClick={onAddEmptyFloor}>
                Add empty floor
              </button>
              <button type="button" disabled={floors.length <= 1} onClick={onDeleteFloor}>
                Delete current floor
              </button>
            </>
          ) : null}
        </aside>
      ) : null}
    </>
  )
}
