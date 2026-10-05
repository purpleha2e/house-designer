import type { FloorLevel, SelectableSurface } from './types.ts'

/** A loft can use the underside of a roof owned by the storey below it.
 * Selecting that ceiling must not switch the editing floor (and its lights).
 * The surface itself keeps the owner's floorId for material assignments. */
export function getSurfaceSelectionFloorId(
  surface: SelectableSurface,
  activeFloorId: string,
  floors: readonly Pick<FloorLevel, 'id' | 'elevation' | 'roofs'>[],
) {
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
