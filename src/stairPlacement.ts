import { getStairOpeningPolygon } from './stairSlabOpenings.ts'
import type { ModelHorizontalBounds } from './models/modelLibrary.ts'
import type { Point, Wall } from './types.ts'

export const STAIR_WALL_SNAP_TOLERANCE_METERS = 0.2

type StairWallSnapOptions = {
  depth: number
  localBounds?: ModelHorizontalBounds | null
  position: Point
  rotation: number
  scale: number
  widthScale?: number
  depthScale?: number
  tolerance?: number
  walls: readonly Wall[]
  width: number
}

export type StairWallSnap = {
  distance: number
  position: Point
  wallId: string
}

const dot = (point: Point, origin: Point, axis: Point) =>
  (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y

/**
 * Aligns the nearest supporting edge of a stair aperture with a wall face.
 * Existing wall overlap is always corrected; clear apertures only snap within
 * the configured tolerance.
 */
export function snapStairApertureToWalls({
  depth,
  localBounds,
  position,
  rotation,
  scale,
  widthScale = 1,
  depthScale = 1,
  tolerance = STAIR_WALL_SNAP_TOLERANCE_METERS,
  walls,
  width,
}: StairWallSnapOptions): StairWallSnap | null {
  const aperture = getStairOpeningPolygon(
    position,
    rotation,
    width,
    depth,
    scale,
    localBounds ?? undefined,
    widthScale,
    depthScale,
  )
  let bestSnap: StairWallSnap | null = null

  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x
    const dy = wall.end.y - wall.start.y
    const length = Math.hypot(dx, dy)

    if (length <= 0.000001) {
      continue
    }

    const direction = { x: dx / length, y: dy / length }
    const normal = { x: -direction.y, y: direction.x }
    const along = aperture.map((point) => dot(point, wall.start, direction))
    const across = aperture.map((point) => dot(point, wall.start, normal))
    const minAlong = Math.min(...along)
    const maxAlong = Math.max(...along)

    if (maxAlong < -tolerance || minAlong > length + tolerance) {
      continue
    }

    const minAcross = Math.min(...across)
    const maxAcross = Math.max(...across)
    const halfThickness = wall.thickness / 2
    const overlapsWall =
      minAcross < halfThickness && maxAcross > -halfThickness
    const centerAcross = dot(position, wall.start, normal)
    const positiveDelta = halfThickness - minAcross
    const negativeDelta = -halfThickness - maxAcross
    const delta = overlapsWall
      ? Math.abs(positiveDelta) <= Math.abs(negativeDelta)
        ? positiveDelta
        : negativeDelta
      : centerAcross >= 0
        ? positiveDelta
        : negativeDelta
    const clearance = overlapsWall ? 0 : Math.abs(delta)

    if (!overlapsWall && clearance > tolerance) {
      continue
    }

    const distance = Math.abs(delta)

    if (bestSnap && distance >= bestSnap.distance) {
      continue
    }

    bestSnap = {
      distance,
      position: {
        x: position.x + normal.x * delta,
        y: position.y + normal.y * delta,
      },
      wallId: wall.id,
    }
  }

  return bestSnap
}
