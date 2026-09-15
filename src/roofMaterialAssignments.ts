import type { SurfaceMaterialAssignment, SurfaceTarget } from './types.ts'

type RoofTarget = Extract<SurfaceTarget, { type: 'roof' }>

export function replaceRoofMaterialAssignment(
  assignments: SurfaceMaterialAssignment[],
  target: RoofTarget,
  assignment: Omit<SurfaceMaterialAssignment, 'target'> | null,
): SurfaceMaterialAssignment[] {
  const remaining = assignments.filter(a => !(a.target.type === 'roof' &&
    a.target.floorId === target.floorId && a.target.roofId === target.roofId && a.target.part === target.part))
  return assignment ? [...remaining, { ...assignment, target }] : remaining
}
