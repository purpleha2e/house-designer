import type { DormerWallContact } from './dormerInterior.ts'
import type { PlacedModel, SurfaceMaterialAssignment } from './types.ts'

export const DORMER_INTERIOR_MATERIAL_REGION = 'dormer-interior'

/** Use the same underside fallback as the attached roof itself. */
export function getDormerCeilingAssignment(
  assignments: SurfaceMaterialAssignment[], floorId: string, roofId: string,
) {
  const matches = (assignment: SurfaceMaterialAssignment) =>
    assignment.target.type === 'roof' && assignment.target.floorId === floorId &&
    assignment.target.roofId === roofId
  return assignments.findLast(a => matches(a) && a.target.type === 'roof' && a.target.part === 'underside') ??
    assignments.findLast(a => matches(a) && a.target.type === 'roof' && !a.target.part)
}

/** The wall spanning most of the recess supplies a consistent interior finish. */
export function getDormerWallAssignment(
  assignments: SurfaceMaterialAssignment[], model: PlacedModel, contacts: DormerWallContact[] = [],
): SurfaceMaterialAssignment | undefined {
  const contact = [...contacts].sort((a, b) => b.overlap - a.overlap || a.wallId.localeCompare(b.wallId))[0]
  if (contact) {
    const matches = (a: SurfaceMaterialAssignment) =>
      (a.target.type === 'wall-face' || a.target.type === 'wall-surface-fragment') &&
      a.target.wallId === contact.wallId && (a.target.side === 'both' || a.target.side === contact.side) &&
      (a.coverageHeight ?? Infinity) >= contact.height - 0.001
    return assignments.findLast(a => matches(a) && a.target.type === 'wall-surface-fragment') ??
      assignments.findLast(a => matches(a) && a.target.type === 'wall-face')
  }
  const materialId = model.materialOverrides?.[DORMER_INTERIOR_MATERIAL_REGION]
  return materialId ? {
    id: `${model.id}:interior`, materialId,
    target: { type: 'wall-face', wallId: `${model.id}:interior`, side: 'both' },
  } : undefined
}
