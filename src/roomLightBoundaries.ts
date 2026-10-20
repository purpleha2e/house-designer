import * as polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import type { Point } from './types.ts'

const runtime = polygonClipping as typeof polygonClipping & { default?: typeof polygonClipping }
const { union, difference } = runtime.default ?? runtime
export const ROOM_BOUNDARY_HEADER_SIZE = 255

/** Match mask priority, then merge doorway patches so internal seams never
 * become blockers. Clipping also retains holes occupied by nested rooms. */
export function roomLightBoundaryRecords(rooms: { id: number; polygon: Point[] }[]) {
  const regions = new Map<number, MultiPolygon>()
  let claimed: MultiPolygon = []
  for (const { id, polygon } of rooms) {
    if (polygon.length < 3) continue
    // Doorway patches are rounded to micrometres by the geometry pipeline.
    // Use that same precision for room faces to avoid sub-micrometre seams.
    const shape: Polygon = [polygon.map(p => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6])]
    const remaining = claimed.length ? difference(shape, claimed) : union(shape)
    const previous = regions.get(id) ?? []
    regions.set(id, previous.length ? union(previous, remaining) : remaining)
    claimed = claimed.length ? union(claimed, shape) : union(shape)
  }
  const records = new Array<number>(ROOM_BOUNDARY_HEADER_SIZE * 4).fill(0)
  for (const [id, polygons] of regions) {
    records[id * 4] = records.length / 4
    for (const polygon of polygons) for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) records.push(...ring[i - 1], ...ring[i])
    }
    records[id * 4 + 1] = records.length / 4
  }
  return new Float32Array(records)
}
