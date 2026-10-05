import type { RoofGable, RoofGableFace } from './roofGableGeometry.ts'
import type { SelectableSurface } from './types.ts'

/** The supporting wall supplies default finishes and UVs, not the pick identity.
 * Each interior gable end belongs to the room level that faces it. */
export function getGableSurface(gable: RoofGable, face: RoofGableFace): Extract<SelectableSurface, { type: 'roof' }> {
  return face.interior ? {
    type: 'roof', floorId: gable.floorId, roofId: gable.roofId,
    part: 'gable-interior', gableEnd: gable.end, spaceFloorId: face.spaceFloorId ?? gable.floorId,
  } : { type: 'roof', floorId: gable.floorId, roofId: gable.roofId, part: 'gable' }
}
