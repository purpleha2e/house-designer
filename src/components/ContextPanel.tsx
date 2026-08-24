import type {
  FloorLevel,
  PlacedModel,
  Room,
  Wall,
} from '../types'
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
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
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
  onUpdateModel,
}: ContextPanelProps) {
  const selectedModelIsLight = Boolean(selectedModel?.definition.isLight)
  const selectedModelIsSpotlight = selectedModel?.definition.lightKind === 'spot'

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
              : selectedModelIsLight
                ? '-'
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
              : selectedModelIsLight
                ? '-'
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
              : selectedModelIsLight && selectedModel
                ? `${(selectedModel.model.height ?? selectedModel.definition.height).toFixed(2)} m`
              : selectedModel
                ? `${(
                    selectedModel.definition.height * selectedModel.model.scale
                  ).toFixed(2)} m`
                : '-'}
          </dd>
        </div>
        {selectedModel ? (
          <>
            {selectedModelIsLight ? (
              <>
                <div className="context-field">
                  <dt>Enabled</dt>
                  <dd>
                    <input
                      type="checkbox"
                      checked={selectedModel.model.lightEnabled !== false}
                      onChange={(event) =>
                        onUpdateModel(selectedModel.model.id, {
                          lightEnabled: event.target.checked,
                        })
                      }
                    />
                  </dd>
                </div>
                <div className="context-field">
                  <dt>Colour</dt>
                  <dd>
                    <input
                      type="color"
                      value={
                        selectedModel.model.lightColor ??
                        selectedModel.definition.lightColor ??
                        selectedModel.definition.color
                      }
                      onChange={(event) =>
                        onUpdateModel(selectedModel.model.id, {
                          lightColor: event.target.value,
                        })
                      }
                    />
                  </dd>
                </div>
                <div className="context-field">
                  <dt>Power</dt>
                  <dd>
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      step={10}
                      value={
                        selectedModel.model.lightPower ??
                        selectedModel.definition.lightPower ??
                        450
                      }
                      onChange={(event) =>
                        onUpdateModel(selectedModel.model.id, {
                          lightPower: Number(event.target.value),
                        })
                      }
                    />
                  </dd>
                </div>
                <div className="context-field">
                  <dt>Range</dt>
                  <dd>
                    <input
                      type="number"
                      min={0.5}
                      max={30}
                      step={0.5}
                      value={
                        selectedModel.model.lightDistance ??
                        selectedModel.definition.lightDistance ??
                        10
                      }
                      onChange={(event) =>
                        onUpdateModel(selectedModel.model.id, {
                          lightDistance: Number(event.target.value),
                        })
                      }
                    />
                  </dd>
                </div>
                <div className="context-field">
                  <dt>Falloff</dt>
                  <dd>
                    <input
                      type="number"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={
                        selectedModel.model.lightFalloff ??
                        selectedModel.definition.lightFalloff ??
                        1.35
                      }
                      onChange={(event) =>
                        onUpdateModel(selectedModel.model.id, {
                          lightFalloff: Number(event.target.value),
                        })
                      }
                    />
                  </dd>
                </div>
                {selectedModelIsSpotlight ? (
                  <div className="context-field">
                    <dt>Spread</dt>
                    <dd>
                      <input
                        type="number"
                        min={5}
                        max={120}
                        step={1}
                        value={
                          selectedModel.model.lightSpread ??
                          selectedModel.definition.lightSpread ??
                          36
                        }
                        onChange={(event) =>
                          onUpdateModel(selectedModel.model.id, {
                            lightSpread: Number(event.target.value),
                          })
                        }
                      />
                    </dd>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div>
                  <dt>Scale</dt>
                  <dd>{selectedModel.model.scale.toFixed(2)}x</dd>
                </div>
                <div>
                  <dt>Rotation</dt>
                  <dd>{Math.round((selectedModel.model.rotation * 180) / Math.PI)} deg</dd>
                </div>
              </>
            )}
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
