import type { Box3 } from 'three'

export type ModelAssetBounds = Readonly<{
  depth: number; height: number; width: number
  minX: number; minZ: number; maxX: number; maxZ: number
}>

// Scalar metadata only: never retain a mounted scene, geometry or material.
// The complete asset URL includes the explicit refresh revision.
const boundsByUrl = new Map<string, ModelAssetBounds>()
export const getModelAssetBounds = (url: string) => boundsByUrl.get(url)
export const clearModelAssetBounds = () => boundsByUrl.clear()
export function rememberModelAssetBounds(url: string, box: Box3): ModelAssetBounds {
  const bounds = Object.freeze({
    depth: Math.max(box.max.z - box.min.z, 0.1),
    height: Math.max(box.max.y - box.min.y, 0.1),
    width: Math.max(box.max.x - box.min.x, 0.1),
    minX: box.min.x, minZ: box.min.z, maxX: box.max.x, maxZ: box.max.z,
  })
  boundsByUrl.set(url, bounds)
  return bounds
}
