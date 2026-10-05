import type { SurfaceMaterialAssignment, SurfaceTarget } from './types.ts'

type RoofTarget = Extract<SurfaceTarget, { type: 'roof' }>

export function roofSurfaceTargetsMatch(first: RoofTarget, second: RoofTarget) {
  return first.floorId === second.floorId && first.roofId === second.roofId && first.part === second.part &&
    first.gableEnd === second.gableEnd && first.spaceFloorId === second.spaceFloorId
}

export function replaceRoofMaterialAssignment(
  assignments: SurfaceMaterialAssignment[],
  target: RoofTarget,
  assignment: Omit<SurfaceMaterialAssignment, 'target'> | null,
): SurfaceMaterialAssignment[] {
  const remaining = assignments.filter(a => !(a.target.type === 'roof' &&
    roofSurfaceTargetsMatch(a.target, target)))
  return assignment ? [...remaining, { ...assignment, target }] : remaining
}
