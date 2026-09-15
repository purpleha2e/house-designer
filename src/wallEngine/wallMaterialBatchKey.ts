import type { SurfaceMaterialAssignment } from '../types.ts'

/** Selection identity and coverage have already been resolved before batching. */
export function wallMaterialBatchKey(
  assignment: SurfaceMaterialAssignment | undefined,
  fallback: 'external' | 'internal',
) {
  // Retain the fallback kind even for assigned finishes: unavailable catalog
  // materials must still render with the correct wall's default material.
  return JSON.stringify([fallback, assignment?.materialId ?? null,
    assignment?.customColor ?? null, assignment?.textureScale ?? 1,
    assignment?.textureRotation ?? 0])
}
