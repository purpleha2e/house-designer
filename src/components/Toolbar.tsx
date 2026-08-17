import type { FloorLevel, WallKind } from '../types'

type ToolbarProps = {
  activeFloorId: string
  floors: FloorLevel[]
  isAddingWall: boolean
  wallCount: number
  wallKind: WallKind
  onAddFloor: () => void
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
  onAddFloor,
  onSelectFloor,
  onToggleAddWall,
  onWallKindChange,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div>
        <h1>House Designer</h1>
        <p>{wallCount} walls across {floors.length} floors</p>
      </div>

      <div className="toolbar-controls">
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

        <button type="button" className="tool-button" onClick={onAddFloor}>
          Add Floor
        </button>

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
