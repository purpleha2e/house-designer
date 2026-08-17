import type { Wall } from '../types'

type ContextPanelProps = {
  selectedWall: Wall | undefined
}

function getWallLength(wall: Wall) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
}

export function ContextPanel({ selectedWall }: ContextPanelProps) {
  return (
    <aside className="context-panel" aria-label="Selection details">
      <div>
        <h2>Context</h2>
        <p>
          {selectedWall
            ? `Wall ${selectedWall.id.slice(0, 8)}`
            : 'No wall selected'}
        </p>
      </div>

      <dl>
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
