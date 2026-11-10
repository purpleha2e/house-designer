import type { FloorLevel, SelectableSurface } from './types.ts'

/** Selection owns the properties context; the plan's active floor stays put. */
export function getSelectionContextFloor(floors: readonly FloorLevel[], activeFloor: FloorLevel, selection: {
  modelId: string | null; wallId: string | null; roofId: string | null; surface: SelectableSurface | null
}) {
  if (selection.modelId) return floors.find(floor => floor.models.some(model => model.id === selection.modelId)) ?? activeFloor
  if (selection.surface) {
    const id = getSurfaceSelectionFloorId(selection.surface, activeFloor.id, floors)
    return floors.find(floor => floor.id === id) ?? activeFloor
  }
  if (selection.wallId) return floors.find(floor => floor.walls.some(wall => wall.id === selection.wallId)) ?? activeFloor
  if (selection.roofId) return floors.find(floor => floor.roofs?.some(roof => roof.id === selection.roofId)) ?? activeFloor
  return activeFloor
}

/** A loft can use the underside of a roof owned by the storey below it.
 * Selecting that ceiling must not switch the editing floor (and its lights).
 * The surface itself keeps the owner's floorId for material assignments. */
export function getSurfaceSelectionFloorId(
  surface: SelectableSurface,
  activeFloorId: string,
  floors: readonly Pick<FloorLevel, 'id' | 'elevation' | 'roofs'>[],
) {
  // A slab edge belongs to the ceiling of the lower storey. Editing its finish
  // from the stairwell above must keep that view and its selection in place.
  if (surface.type === 'floor-slab-edge') {
    const sorted = [...floors].sort((a, b) => a.elevation - b.elevation)
    const owner = sorted.findIndex(floor => floor.id === surface.floorId)
    if (owner >= 0 && sorted[owner + 1]?.id === activeFloorId) return activeFloorId
  }
  if (surface.type === 'roof' && surface.part === 'gable-interior' &&
    floors.some(floor => floor.id === surface.spaceFloorId)) return surface.spaceFloorId!
  if (surface.type === 'roof' && surface.part === 'underside') {
    const active = floors.find(floor => floor.id === activeFloorId)
    const owner = floors.find(floor => floor.id === surface.floorId)
    if (active && owner && active.elevation > owner.elevation &&
      owner.roofs?.some(roof => roof.id === surface.roofId)) return activeFloorId
  }
  return surface.floorId
}
