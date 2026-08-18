import type { FloorLevel, Room, Wall } from '../types'
import type { DetectedRoom } from '../wallTopology'

type ContextPanelProps = {
  activeFloor: FloorLevel
  selectedRoom: {
    detectedRoom: DetectedRoom
    metadata: Room
  } | null
  selectedWall: Wall | undefined
  onRenameRoom: (roomSignature: string, name: string) => void
}

function getWallLength(wall: Wall) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
}

export function ContextPanel({
  activeFloor,
  selectedRoom,
  selectedWall,
  onRenameRoom,
}: ContextPanelProps) {
  return (
    <aside className="context-panel" aria-label="Selection details">
      <div>
        <h2>Context</h2>
        <p>
          {selectedWall
            ? `${activeFloor.name} - wall ${selectedWall.id.slice(0, 8)}`
            : selectedRoom
              ? `${activeFloor.name} - ${selectedRoom.metadata.name}`
            : `${activeFloor.name} selected`}
        </p>
      </div>

      <dl>
        {selectedRoom ? (
          <div className="context-field">
            <dt>Room name</dt>
            <dd>
              <input
                value={selectedRoom.metadata.name}
                onChange={(event) =>
                  onRenameRoom(selectedRoom.metadata.signature, event.target.value)
                }
              />
            </dd>
          </div>
        ) : null}
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
          <dd>{selectedWall ? selectedWall.kind : selectedRoom ? 'room' : '-'}</dd>
        </div>
        {selectedRoom ? (
          <div>
            <dt>Area</dt>
            <dd>{selectedRoom.detectedRoom.area.toFixed(2)} m2</dd>
          </div>
        ) : null}
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
