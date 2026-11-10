import { BufferGeometry } from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const DEFAULT_SKIRTING_MATERIAL = {
  key: 'default-skirting',
  color: '#f8fafc',
  roughness: 0.58,
} as const

export type SkirtingGeometryPart = {
  geometry: BufferGeometry
  /** The complete finish identity, including texture/UV settings when supported. */
  materialKey: string
}

/** Call once per floor. Inputs remain owned by the caller; outputs by the renderer. */
export function batchSkirtingByMaterial(parts: readonly SkirtingGeometryPart[]) {
  const byMaterial = new Map<string, BufferGeometry[]>()
  const batches = new Map<string, BufferGeometry>()
  try {
    for (const { geometry, materialKey } of parts) {
      if (!geometry.getAttribute('position')?.count) continue
      const group = byMaterial.get(materialKey) ?? []
      byMaterial.set(materialKey, group)
      // Include normals and UVs in the vertex key: hard corners and future
      // texture seams must survive indexing. Clipping may return triangle soup.
      group.push(mergeVertices(geometry, 1e-6))
    }
    for (const [materialKey, geometries] of byMaterial) {
      // No geometry groups: one material and one indexed draw per batch.
      const batch = mergeGeometries(geometries, false)
      if (!batch) throw new Error(`Incompatible skirting attributes for ${materialKey}`)
      batches.set(materialKey, batch)
      batch.computeBoundingBox()
      batch.computeBoundingSphere()
    }
    return batches
  } catch (error) {
    batches.forEach(geometry => geometry.dispose())
    throw error
  } finally {
    byMaterial.forEach(geometries => geometries.forEach(geometry => geometry.dispose()))
  }
}
