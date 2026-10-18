import { DataTexture, FloatType, NearestFilter, RedFormat, RGBAFormat, UnsignedByteType, Vector2, Vector4 } from 'three'
import type { Point } from './types.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'

export const MAX_LIGHT_PORTAL_PLANES = 16
export type LightPortalPlane = { y: number; openings: Point[][] }

/** Interior/exterior cells use the cheap mask. Boundary cells retain exact
 * polygons: shrinking the void by a texel casts false bands on adjacent walls. */
export function createLightPortalTexture(planes: LightPortalPlane[], bounds: { minX: number; minZ: number; size: number }, size = 512) {
  const layers = planes.slice(0, MAX_LIGHT_PORTAL_PLANES), data = new Uint8Array(size * size * Math.max(1, layers.length))
  const records: number[] = [], edgeRanges = Array.from({ length: MAX_LIGHT_PORTAL_PLANES }, () => new Vector2())
  for (const [layer, plane] of layers.entries()) {
    edgeRanges[layer].x = records.length / 4
    for (const opening of plane.openings) {
      if (opening.length < 3) continue
      records.push(opening.length, 0, 0, 0)
      opening.forEach((a, i) => { const b = opening[(i + 1) % opening.length]; records.push(a.x, a.y, b.x, b.y) })
      const xs = opening.map(p => (p.x - bounds.minX) / bounds.size * size), zs = opening.map(p => (p.y - bounds.minZ) / bounds.size * size)
      const minX = Math.max(0, Math.floor(Math.min(...xs))), maxX = Math.min(size - 1, Math.ceil(Math.max(...xs)))
      const minZ = Math.max(0, Math.floor(Math.min(...zs))), maxZ = Math.min(size - 1, Math.ceil(Math.max(...zs)))
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        const inside = [[.001, .001], [.999, .001], [.999, .999], [.001, .999]].every(([dx, dz]) => plane.openings.some(polygon =>
          pointIsInsideRoomPolygon({ x: bounds.minX + (x + dx) / size * bounds.size, y: bounds.minZ + (z + dz) / size * bounds.size }, polygon)))
        if (inside) data[(layer * size + z) * size + x] = 255
      }
    }
    edgeRanges[layer].y = records.length / 4
    // Every cell touched by an edge takes the exact path, including narrow
    // openings and concave corners whose four cell corners miss the boundary.
    const cell = bounds.size / size, radius = cell / Math.SQRT2
    for (const polygon of plane.openings) for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dz = b.y - a.y
      const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - bounds.minX) / cell) - 1)
      const maxX = Math.min(size - 1, Math.floor((Math.max(a.x, b.x) - bounds.minX) / cell) + 1)
      const minZ = Math.max(0, Math.floor((Math.min(a.y, b.y) - bounds.minZ) / cell) - 1)
      const maxZ = Math.min(size - 1, Math.floor((Math.max(a.y, b.y) - bounds.minZ) / cell) + 1)
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        const px = bounds.minX + (x + .5) * cell - a.x, pz = bounds.minZ + (z + .5) * cell - a.y
        const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / (dx * dx + dz * dz || 1)))
        if (Math.hypot(px - t * dx, pz - t * dz) <= radius + 1e-7) data[(layer * size + z) * size + x] = 128
      }
    }
  }
  const texture = new DataTexture(data, size, size * Math.max(1, layers.length), RedFormat, UnsignedByteType)
  texture.minFilter = texture.magFilter = NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true; texture.unpackAlignment = 1
  const width = Math.min(1024, Math.max(1, records.length / 4)), height = Math.max(1, Math.ceil(records.length / 4 / width))
  const edgeData = new Float32Array(width * height * 4); edgeData.set(records)
  const edges = new DataTexture(edgeData, width, height, RGBAFormat, FloatType)
  edges.minFilter = edges.magFilter = NearestFilter; edges.generateMipmaps = false; edges.needsUpdate = true
  return { texture, edges, edgeRanges, dispose: () => { texture.dispose(); edges.dispose() },
    bounds: new Vector4(bounds.minX, bounds.minZ, bounds.size, Math.max(1, layers.length)),
    heights: Float32Array.from({ length: MAX_LIGHT_PORTAL_PLANES }, (_, i) => layers[i]?.y ?? 0), count: layers.length }
}
