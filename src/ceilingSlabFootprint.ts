import * as polygonClipping from 'polygon-clipping'
import type { Polygon } from 'polygon-clipping'
import type { Point, Wall } from './types.ts'
import { buildWallBodyPerimeters } from './wallEngine/wallBodyPerimeter.ts'
import { buildWallTopology } from './wallTopology.ts'

const runtime = polygonClipping as typeof polygonClipping & { default?: typeof polygonClipping }
const union = runtime.union ?? runtime.default!.union

function closeRing(points: Point[]) {
  return [...points, points[0]].map(point => [point.x, point.y] as [number, number])
}

/** Use the same snapped centre lines as prepareRenderedFloorData. */
export function getSlabRenderedWalls(walls: Wall[]): Wall[] {
  return [...buildWallTopology(walls).renderedWallsById.values()].map(rendered => rendered.wall)
}

/**
 * Rooms already describe the INSIDE faces of walls, not their centre lines.
 * Fill them together with the actual rendered wall bodies. Offsetting room
 * loops or projecting their edges to nominal wall planes changes corner joins
 * and can turn a wall branch into a wedge in the slab.
 */
export function buildCeilingSlabFootprints(walls: Wall[], supportingWalls: Wall[] = []): Point[][] {
  if (walls.length === 0) return []
  const topology = buildWallTopology(walls)
  const renderedWalls = [...topology.renderedWallsById.values()].map(rendered => rendered.wall)
  const plan = buildWallBodyPerimeters(renderedWalls)
  const rooms = topology.rooms
  const polygons: Polygon[] = plan.perimeters.map(perimeter => [
    closeRing(perimeter.outline),
    ...perimeter.holes.map(closeRing),
  ])
  polygons.push(...rooms.filter(room => room.polygon.length >= 3).map(room => [closeRing(room.polygon)]))

  // Retain coverage beneath an unfinished upper floor when no room can yet be
  // detected. Never reconstruct the lower boundary with a guessed offset.
  if (rooms.length === 0 && !plan.perimeters.some(perimeter => perimeter.holes.length > 0)) {
    polygons.push(...buildWallBodyPerimeters(getSlabRenderedWalls(supportingWalls)).perimeters
      .filter(perimeter => perimeter.holes.length > 0)
      .map(perimeter => [closeRing(perimeter.outline)]))
  }
  if (polygons.length === 0) return []
  return union(polygons[0], ...polygons.slice(1)).map(polygon =>
    polygon[0].slice(0, -1).map(([x, y]) => ({ x, y })),
  )
}
