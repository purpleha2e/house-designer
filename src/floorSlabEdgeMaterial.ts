import type { Point, SurfaceWallSide, Wall } from './types.ts'
import { getCanonicalWallUvDistance } from './wallEngine/wallUv.ts'

export type FloorSlabSupportingWall = {
  normalSign: -1 | 1
  side: Exclude<SurfaceWallSide, 'both'>
  uvEnd: number
  uvStart: number
  wall: Wall
}

const MINIMUM_EDGE_LENGTH = 0.001
const MAXIMUM_DIRECTION_ERROR = 0.025
const MINIMUM_LONGITUDINAL_OVERLAP = 0.02
const MINIMUM_LATERAL_TOLERANCE = 0.2

function distanceOutsideInterval(value: number, minimum: number, maximum: number) {
  if (value < minimum) {
    return minimum - value
  }

  if (value > maximum) {
    return value - maximum
  }

  return 0
}

/**
 * Matches an outer slab edge to the external wall face directly below it.
 * Returned UV distances use the wall's metre-based coordinate frame.
 */
export function findFloorSlabSupportingWall(
  point: Point,
  nextPoint: Point,
  walls: readonly Wall[],
): FloorSlabSupportingWall | null {
  const edgeDx = nextPoint.x - point.x
  const edgeDy = nextPoint.y - point.y
  const edgeLength = Math.hypot(edgeDx, edgeDy)

  if (edgeLength <= MINIMUM_EDGE_LENGTH) {
    return null
  }

  const edgeUnit = {
    x: edgeDx / edgeLength,
    y: edgeDy / edgeLength,
  }
  const midpoint = {
    x: (point.x + nextPoint.x) / 2,
    y: (point.y + nextPoint.y) / 2,
  }
  let bestMatch: (FloorSlabSupportingWall & { score: number }) | null = null

  for (const wall of walls) {
    if (wall.kind !== 'external') {
      continue
    }

    const wallDx = wall.end.x - wall.start.x
    const wallDy = wall.end.y - wall.start.y
    const wallLength = Math.hypot(wallDx, wallDy)

    if (wallLength <= MINIMUM_EDGE_LENGTH) {
      continue
    }

    const wallUnit = {
      x: wallDx / wallLength,
      y: wallDy / wallLength,
    }
    const directionError = Math.abs(
      edgeUnit.x * wallUnit.y - edgeUnit.y * wallUnit.x,
    )

    if (directionError > MAXIMUM_DIRECTION_ERROR) {
      continue
    }

    const normal = { x: -wallUnit.y, y: wallUnit.x }
    const midpointOffset = {
      x: midpoint.x - wall.start.x,
      y: midpoint.y - wall.start.y,
    }
    const midpointDistance =
      midpointOffset.x * wallUnit.x + midpointOffset.y * wallUnit.y
    const signedFaceDistance =
      midpointOffset.x * normal.x + midpointOffset.y * normal.y
    const edgeStartDistance =
      (point.x - wall.start.x) * wallUnit.x +
      (point.y - wall.start.y) * wallUnit.y
    const edgeEndDistance =
      (nextPoint.x - wall.start.x) * wallUnit.x +
      (nextPoint.y - wall.start.y) * wallUnit.y
    const edgeDistanceStart = Math.min(edgeStartDistance, edgeEndDistance)
    const edgeDistanceEnd = Math.max(edgeStartDistance, edgeEndDistance)
    const expectedFaceDistance = wall.thickness / 2
    const lateralError = Math.abs(
      Math.abs(signedFaceDistance) - expectedFaceDistance,
    )
    const lateralTolerance = Math.max(
      MINIMUM_LATERAL_TOLERANCE,
      wall.thickness * 0.75,
    )
    const longitudinalTolerance = Math.max(0.05, wall.thickness)
    const overlapStart = Math.max(edgeDistanceStart, -longitudinalTolerance)
    const overlapEnd = Math.min(edgeDistanceEnd, wallLength + longitudinalTolerance)
    const longitudinalOverlap = Math.max(0, overlapEnd - overlapStart)
    const longitudinalError =
      longitudinalOverlap > 0
        ? 0
        : distanceOutsideInterval(
            midpointDistance,
            -longitudinalTolerance,
            wallLength + longitudinalTolerance,
          )

    if (
      lateralError > lateralTolerance ||
      (longitudinalOverlap < MINIMUM_LONGITUDINAL_OVERLAP &&
        longitudinalError > longitudinalTolerance)
    ) {
      continue
    }

    const uvStart = getCanonicalWallUvDistance(wall, point)
    const uvEnd = getCanonicalWallUvDistance(wall, nextPoint)
    const score =
      lateralError +
      longitudinalError * 2 +
      directionError * wall.thickness +
      Math.max(0, edgeLength - longitudinalOverlap) / edgeLength
    const edgeLeftNormal = { x: -edgeUnit.y, y: edgeUnit.x }
    const outwardNormalSign = signedFaceDistance >= 0 ? 1 : -1
    const outwardNormal = {
      x: normal.x * outwardNormalSign,
      y: normal.y * outwardNormalSign,
    }
    const match = {
      normalSign: (edgeLeftNormal.x * outwardNormal.x +
        edgeLeftNormal.y * outwardNormal.y >=
      0
        ? 1
        : -1) as -1 | 1,
      score,
      side: outwardNormalSign as Exclude<
        SurfaceWallSide,
        'both'
      >,
      uvEnd,
      uvStart,
      wall,
    }

    if (!bestMatch || match.score < bestMatch.score) {
      bestMatch = match
    }
  }

  if (!bestMatch) {
    return null
  }

  const { score: _score, ...match } = bestMatch
  return match
}
