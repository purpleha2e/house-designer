import type { FloorLevel, PlacedModel, Room, Wall } from '../types'
import type { ModelDefinition } from '../models/modelLibrary'
import type { DetectedRoom } from '../wallTopology'

type ContextPanelProps = {
  activeFloor: FloorLevel
  selectedModel: {
    definition: ModelDefinition
    model: PlacedModel
  } | null
  selectedRoom: {
    detectedRoom: DetectedRoom
    metadata: Room
  } | null
  selectedWall: Wall | undefined
  onDeleteModel: (modelId: string) => void
  onRenameRoom: (roomSignature: string, name: string) => void
}

function getWallLength(wall: Wall) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
}

export function ContextPanel({
  activeFloor,
  selectedModel,
  selectedRoom,
  selectedWall,
  onDeleteModel,
  onRenameRoom,
}: ContextPanelProps) {
  return (
    <aside className="context-panel" aria-label="Selection details">
      <div>
        <h2>Context</h2>
        <p>
          {selectedWall
            ? `${activeFloor.name} - wall ${selectedWall.id.slice(0, 8)}`
            : selectedModel
              ? `${activeFloor.name} - ${selectedModel.definition.name}`
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
          <dd>
            {selectedWall
              ? selectedWall.kind
              : selectedModel
                ? selectedModel.definition.category
                : selectedRoom
                  ? 'room'
                  : '-'}
          </dd>
        </div>
        {selectedRoom ? (
          <div>
            <dt>Area</dt>
            <dd>{selectedRoom.detectedRoom.area.toFixed(2)} m2</dd>
          </div>
        ) : null}
        <div>
          <dt>Length</dt>
          <dd>
            {selectedWall
              ? `${getWallLength(selectedWall).toFixed(2)} m`
              : selectedModel
                ? `${(
                    selectedModel.definition.width * selectedModel.model.scale
                  ).toFixed(2)} m`
                : '-'}
          </dd>
        </div>
        <div>
          <dt>{selectedModel ? 'Depth' : 'Thickness'}</dt>
          <dd>
            {selectedWall
              ? `${selectedWall.thickness.toFixed(2)} m`
              : selectedModel
                ? `${(
                    selectedModel.definition.depth * selectedModel.model.scale
                  ).toFixed(2)} m`
                : '-'}
          </dd>
        </div>
        <div>
          <dt>Height</dt>
          <dd>
            {selectedWall
              ? `${selectedWall.height.toFixed(2)} m`
              : selectedModel
                ? `${(
                    selectedModel.definition.height * selectedModel.model.scale
                  ).toFixed(2)} m`
                : '-'}
          </dd>
        </div>
        {selectedModel ? (
          <>
            <div>
              <dt>Scale</dt>
              <dd>{selectedModel.model.scale.toFixed(2)}x</dd>
            </div>
            <div>
              <dt>Rotation</dt>
              <dd>{Math.round((selectedModel.model.rotation * 180) / Math.PI)} deg</dd>
            </div>
            <div className="context-actions">
              <dt>Actions</dt>
              <dd>
                <button
                  type="button"
                  onClick={() => onDeleteModel(selectedModel.model.id)}
                >
                  Delete
                </button>
              </dd>
            </div>
          </>
        ) : null}
      </dl>
    </aside>
  )
}
