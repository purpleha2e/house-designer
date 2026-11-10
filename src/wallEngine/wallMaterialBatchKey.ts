import type { SurfaceMaterialAssignment, SurfaceMaterialProduct } from '../types.ts'

export function hasWallMaterialTextures(material: SurfaceMaterialProduct) {
  const pbr = material.pbr
  return !!(pbr.baseColorTextureUrl || pbr.normalTextureUrl || pbr.roughnessTextureUrl ||
    pbr.metalnessTextureUrl || pbr.ambientOcclusionTextureUrl)
}

/** Selection identity and coverage have already been resolved before batching. */
export function wallMaterialBatchKey(
  assignment: SurfaceMaterialAssignment | undefined,
  fallback: 'external' | 'internal',
  materialAvailable = false,
  usesTextures = true,
) {
  // Legacy callers retain the fallback kind until catalog availability is
  // known. Resolved assignments share a finish across internal/external walls.
  return JSON.stringify([materialAvailable && assignment ? 'assigned' : fallback, assignment?.materialId ?? null,
    assignment?.customColor ?? null, usesTextures ? assignment?.textureScale ?? 1 : 1,
    usesTextures ? assignment?.textureRotation ?? 0 : 0])
}

/** Resolve catalog misses before batching: the fallback itself is the finish. */
export function resolvedWallMaterialBatchKey(
  assignment: SurfaceMaterialAssignment | undefined,
  fallback: 'external' | 'internal',
  materialAvailable: boolean,
  usesTextures = true,
) {
  return wallMaterialBatchKey(materialAvailable ? assignment : undefined, fallback, materialAvailable, usesTextures)
}
