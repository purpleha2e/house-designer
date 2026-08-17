import type { FloorLevel, Wall } from '../types'

type ContextPanelProps = {
  activeFloor: FloorLevel
  selectedWall: Wall | undefined
}

function getWallLength(wall: Wall) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
}

export function ContextPanel({ activeFloor, selectedWall }: ContextPanelProps) {
  return (
    <aside className="context-panel" aria-label="Selection details">
      <div>
        <h2>Context</h2>
        <p>
          {selectedWall
            ? `${activeFloor.name} - wall ${selectedWall.id.slice(0, 8)}`
            : `${activeFloor.name} selected`}
        </p>
      </div>

      <dl>
        <div>
          <dt>Floor elev.</dt>
          <dd>{activeFloor.elevation.toFixed(2)} m</dd>
        </div>
        <div>
          <dt>Room height</dt>
          <dd>{activeFloor.roomHeight.toFixed(2)} m</dd>
        </div>
        <div>
          <dt>Slab</dt>
          <dd>{activeFloor.slabThickness.toFixed(2)} m</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{selectedWall ? selectedWall.kind : '-'}</dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd>{selectedWall ? `${getWallLength(selectedWall).toFixed(2)} m` : '-'}</dd>
        </div>
        <div>
          <dt>Thickness</dt>
          <dd>{selectedWall ? `${selectedWall.thickness.toFixed(2)} m` : '-'}</dd>
        </div>
        <div>
          <dt>Height</dt>
          <dd>{selectedWall ? `${selectedWall.height.toFixed(2)} m` : '-'}</dd>
        </div>
      </dl>
    </aside>
  )
}
