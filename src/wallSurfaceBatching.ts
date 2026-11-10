import { type BufferGeometry, type Side } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { indexGeometry } from './indexedGeometry.ts'
import { hasWallMaterialTextures, resolvedWallMaterialBatchKey } from './wallEngine/wallMaterialBatchKey.ts'
import type { SurfaceMaterialAssignment, SurfaceMaterialProduct } from './types.ts'

export type WallSurfaceBatchPart = {
  geometry: BufferGeometry
  floorId: string
  assignment?: SurfaceMaterialAssignment
  material?: SurfaceMaterialProduct
  fallback: 'external' | 'internal'
  side: Side
  shadowSide: Side
  castShadow: boolean
  receiveShadow: boolean
  renderOrder: number
  polygonOffset?: boolean
  solidGable?: boolean
  roofId: string
  wallId?: string
  interior?: boolean
}

export function wallSurfaceBatchKey(part: WallSurfaceBatchPart) {
  return JSON.stringify([part.floorId,
    resolvedWallMaterialBatchKey(part.assignment, part.fallback, !!part.material, !!part.material && hasWallMaterialTextures(part.material)),
    part.side, part.shadowSide, part.castShadow, part.receiveShadow, part.renderOrder,
    !!part.polygonOffset, !!part.solidGable])
}

/** Sources remain independently pickable. Only the visible triangle streams merge. */
export function batchWallSurfaces(parts: readonly WallSurfaceBatchPart[]) {
  const groups = new Map<string, WallSurfaceBatchPart[]>()
  const batches: { key: string; geometry: BufferGeometry; sources: WallSurfaceBatchPart[] }[] = []
  try {
    for (const part of parts) {
      if (!part.geometry.getAttribute('position')?.count) continue
      const key = wallSurfaceBatchKey(part)
      const group = groups.get(key) ?? []
      group.push(part)
      groups.set(key, group)
    }
    for (const [key, sources] of groups) {
      const normalized = sources.map(source => source.geometry.index ? source.geometry.toNonIndexed() : source.geometry)
      let merged: BufferGeometry | null = null
      try {
        merged = mergeGeometries(normalized, false)
        if (!merged) throw new Error('Incompatible wall surface attributes')
        const geometry = indexGeometry(merged)
        batches.push({ key, geometry, sources })
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()
      } finally {
        merged?.dispose()
        normalized.forEach((geometry, i) => { if (geometry !== sources[i].geometry) geometry.dispose() })
      }
    }
    return batches
  } catch (error) {
    batches.forEach(batch => batch.geometry.dispose())
    throw error
  }
}
