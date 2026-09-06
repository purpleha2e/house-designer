import type {
  FloorLevel,
  PlacedModel,
  Room,
  SelectableSurface,
  SurfaceMaterialAssignment,
  SurfaceMaterialProduct,
  Wall,
} from '../types'
import type { ModelDefinition } from '../models/modelLibrary'
import type { DetectedRoom } from '../wallTopology'
import { getSurfaceMaterialLabel } from '../materials/materialCatalog'

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
  selectedSurface: SelectableSurface | null
  selectedWall: Wall | undefined
  surfaceAssignments: SurfaceMaterialAssignment[]
  surfaceMaterials: SurfaceMaterialProduct[]
  onDeleteModel: (modelId: string) => void
  onRenameRoom: (roomSignature: string, name: string) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
}

function getWallLength(wall: Wall) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
}

function surfaceSideMatches(
  assignment: SurfaceMaterialAssignment,
  side: -1 | 1,
) {
  return (
    (assignment.target.type === 'wall-face' ||
      assignment.target.type === 'wall-surface-fragment') &&
    (assignment.target.side === 'both' || assignment.target.side === side)
  )
}

function getSelectedSurfaceAssignment(
  selectedSurface: SelectableSurface,
  surfaceAssignments: SurfaceMaterialAssignment[],
) {
  if (selectedSurface.type === 'room-floor') {
    return surfaceAssignments.findLast(
      (assignment) =>
        assignment.target.type === 'room-floor' &&
        assignment.target.floorId === selectedSurface.floorId &&
        assignment.target.roomSignature === selectedSurface.roomSignature,
    )
  }

  if (selectedSurface.type === 'ceiling') {
    return surfaceAssignments.findLast(
      (assignment) =>
        assignment.target.type === 'ceiling' &&
        assignment.target.floorId === selectedSurface.floorId &&
        assignment.target.roomSignature === selectedSurface.roomSignature,
    )
  }

  if (selectedSurface.type === 'floor-slab-edge') {
    return surfaceAssignments.findLast(
      (assignment) =>
        assignment.target.type === 'floor-slab-edge' &&
        assignment.target.floorId === selectedSurface.floorId,
    )
  }

  if (selectedSurface.type === 'portal-floor') {
    return surfaceAssignments.findLast(
      (assignment) =>
        assignment.target.type === 'portal-floor' &&
        assignment.target.floorId === selectedSurface.floorId &&
        assignment.target.wallId === selectedSurface.wallId &&
        assignment.target.openingId === selectedSurface.openingId,
    )
  }

  if (selectedSurface.type === 'wall-surface-fragment') {
    const fragmentAssignment = surfaceAssignments.findLast(
      (assignment) =>
        assignment.target.type === 'wall-surface-fragment' &&
        assignment.target.wallId === selectedSurface.wallId &&
        assignment.target.fragmentId === selectedSurface.fragmentId &&
        surfaceSideMatches(assignment, selectedSurface.side),
    )

    if (fragmentAssignment) {
      return fragmentAssignment
    }
  }

  return surfaceAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-face' &&
      assignment.target.wallId === selectedSurface.wallId &&
      surfaceSideMatches(assignment, selectedSurface.side),
  )
}

function getSurfaceTypeLabel(selectedSurface: SelectableSurface) {
  switch (selectedSurface.type) {
    case 'room-floor':
      return 'Room floor'
    case 'ceiling':
      return 'Ceiling'
    case 'floor-slab-edge':
      return 'Ceiling slab edge'
    case 'portal-floor':
      return 'Doorway floor'
    case 'wall-surface-fragment':
      return 'Wall section'
    case 'wall-face':
      return 'Wall face'
  }
}

function getDefaultSurfaceMaterialLabel(
  selectedSurface: SelectableSurface,
  selectedWall: Wall | undefined,
) {
  if (
    selectedSurface.type === 'wall-face' ||
    selectedSurface.type === 'wall-surface-fragment'
  ) {
    return selectedWall?.kind === 'external'
      ? 'Default external wall'
      : 'Default internal wall'
  }

  return `Default ${getSurfaceTypeLabel(selectedSurface).toLowerCase()}`
}

export function ContextPanel({
  activeFloor,
  selectedModel,
  selectedRoom,
  selectedSurface,
  selectedWall,
  surfaceAssignments,
  surfaceMaterials,
  onDeleteModel,
  onRenameRoom,
  onUpdateModel,
}: ContextPanelProps) {
  const selectedModelIsLight = Boolean(selectedModel?.definition.isLight)
  const selectedModelIsSpotlight = selectedModel?.definition.lightKind === 'spot'
  const selectedModelIsDoor = Boolean(
    selectedModel &&
      (selectedModel.definition.wallMount === 'exterior-door' ||
        selectedModel.definition.wallMount === 'interior-door' ||
        selectedModel.definition.wallMount === 'patio-door' ||
        selectedModel.definition.objectType === 'exterior-door' ||
        selectedModel.definition.objectType === 'interior-door' ||
        selectedModel.definition.objectType === 'patio-door'),
  )
  const selectedSurfaceAssignment = selectedSurface
    ? getSelectedSurfaceAssignment(selectedSurface, surfaceAssignments)
    : undefined
  const selectedSurfaceMaterial = selectedSurfaceAssignment
    ? surfaceMaterials.find(
        (material) => material.id === selectedSurfaceAssignment.materialId,
      )
    : undefined
  const selectedSurfaceMaterialLabel = selectedSurface
    ? selectedSurfaceMaterial
      ? getSurfaceMaterialLabel(selectedSurfaceMaterial)
      : getDefaultSurfaceMaterialLabel(selectedSurface, selectedWall)
    : null
  const selectedSurfaceColor =
    selectedSurfaceAssignment?.customColor ??
    selectedSurfaceMaterial?.pbr.baseColor

  return (
    <aside className="context-panel" aria-label="Selection details">
      <div>
        <h2>Context</h2>
        <p>
          {selectedSurface
            ? `${activeFloor.name} - ${getSurfaceTypeLabel(selectedSurface)}`
            : selectedWall
            ? `${activeFloor.name} - wall ${selectedWall.id.slice(0, 8)}`
            : selectedModel
              ? `${activeFloor.name} - ${selectedModel.definition.name}`
              : selectedRoom
                ? `${activeFloor.name} - ${selectedRoom.metadata.name}`
                : `${activeFloor.name} selected`}
        </p>
      </div>

      <dl>
        {selectedSurface ? (
          <>
            <div>
              <dt>Surface</dt>
              <dd>{getSurfaceTypeLabel(selectedSurface)}</dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd className="context-material-value">
                {selectedSurfaceColor ? (
                  <span
                    className="context-colour-swatch"
                    style={{ backgroundColor: selectedSurfaceColor }}
                  />
                ) : null}
                <span>{selectedSurfaceMaterialLabel}</span>
              </dd>
            </div>
            {selectedSurfaceMaterial ? (
              <>
                <div>
                  <dt>Manufacturer</dt>
                  <dd>{selectedSurfaceMaterial.manufacturer}</dd>
                </div>
                <div>
                  <dt>Finish</dt>
                  <dd>
                    {selectedSurfaceMaterial.finish ??
                      selectedSurfaceMaterial.materialType ??
                      selectedSurfaceMaterial.category}
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Scale</dt>
              <dd>{(selectedSurfaceAssignment?.textureScale ?? 1).toFixed(2)}x</dd>
            </div>
            <div>
              <dt>Orientation</dt>
              <dd>{selectedSurfaceAssignment?.textureRotation ?? 0} deg</dd>
            </div>
            {selectedSurfaceAssignment?.coverageHeight !== undefined ? (
              <div>
                <dt>Coverage</dt>
                <dd>{selectedSurfaceAssignment.coverageHeight.toFixed(2)} m</dd>
              </div>
            ) : null}
            {selectedSurfaceMaterial?.pbr.realWorldWidthMeters ||
            selectedSurfaceMaterial?.pbr.realWorldHeightMeters ? (
              <div>
                <dt>Texture size</dt>
                <dd>
                  {selectedSurfaceMaterial.pbr.realWorldWidthMeters?.toFixed(2) ?? '-'} x{' '}
                  {selectedSurfaceMaterial.pbr.realWorldHeightMeters?.toFixed(2) ?? '-'} m
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
        {!selectedSurface ? (
          <>
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
                    selectedModel.definition.width *
                    selectedModel.model.scale *
                    (selectedModel.model.widthScale ?? 1)
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
                    selectedModel.definition.depth *
                    selectedModel.model.scale *
                    (selectedModel.model.depthScale ?? 1)
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
                        1.15
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
                  <dd>
                    {selectedModel.model.scale.toFixed(2)}x /{' '}
                    {(selectedModel.model.widthScale ?? 1).toFixed(2)}w /{' '}
                    {(selectedModel.model.depthScale ?? 1).toFixed(2)}d
                  </dd>
                </div>
                <div>
                  <dt>Rotation</dt>
                  <dd>{Math.round((selectedModel.model.rotation * 180) / Math.PI)} deg</dd>
                </div>
              </>
            )}
            {selectedModelIsDoor ? (
              <div className="context-actions context-door-actions">
                <dt>Door</dt>
                <dd>
                  <button
                    type="button"
                    className="context-secondary-action"
                    aria-pressed={selectedModel.model.flipped === true}
                    title="Switch the door between inward and outward facing"
                    onClick={() =>
                      onUpdateModel(selectedModel.model.id, {
                        flipped: !selectedModel.model.flipped,
                      })
                    }
                  >
                    Flip
                  </button>
                  <button
                    type="button"
                    className="context-secondary-action"
                    aria-pressed={selectedModel.model.mirrored === true}
                    title="Mirror the door to move its hinge to the other side"
                    onClick={() =>
                      onUpdateModel(selectedModel.model.id, {
                        mirrored: !selectedModel.model.mirrored,
                      })
                    }
                  >
                    Mirror
                  </button>
                </dd>
              </div>
            ) : null}
            <div className="context-actions">
              <dt>Actions</dt>
              <dd>
                <button
                  type="button"
                  className="context-danger-action"
                  onClick={() => onDeleteModel(selectedModel.model.id)}
                >
                  Delete
                </button>
              </dd>
            </div>
          </>
        ) : null}
          </>
        ) : null}
      </dl>
    </aside>
  )
}
