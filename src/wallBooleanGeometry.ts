import * as polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import type { Point, Wall } from './types.ts'
import { getWallPolygon, type RenderedWall } from './wallGeometry.ts'

export type WallUnionFootprint = {
  holes: Point[][]
  outline: Point[]
}

export type WallFootprintRenderGroup = {
  footprints: WallUnionFootprint[]
  wallId: string
}

export type WallRenderExtensions = {
  endExtension: number
  startExtension: number
}

const polygonClippingRuntime = polygonClipping as typeof polygonClipping & {
  default?: typeof polygonClipping
}
const unionPolygons =
  polygonClippingRuntime.union ?? polygonClippingRuntime.default?.union
const differencePolygons =
  polygonClippingRuntime.difference ?? polygonClippingRuntime.default?.difference
const MITER_JOIN_EPSILON_METERS = 0.02
const MITER_PARALLEL_EPSILON = 0.000001
const MITER_RIGHT_ANGLE_DOT_TOLERANCE = 0.05

function closeRing(points: Point[]) {
  const firstPoint = points[0]
  const lastPoint = points.at(-1)

  if (!firstPoint || !lastPoint) {
    return []
  }

  const ring = points.map((point) => [point.x, point.y] as [number, number])

  if (
    Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) > 0.000001
  ) {
    ring.push([firstPoint.x, firstPoint.y])
  }

  return ring
}

function toPolygon(renderedWall: RenderedWall): Polygon {
  return [closeRing(getWallPolygon(renderedWall))]
}

function toWallBodyPolygon(wall: Wall): Polygon {
  return [closeRing(getWallBodyPoints(wall))]
}

function getWallBodyPoints(wall: Wall) {
  return getWallPolygon({
    endExtension: 0,
    startExtension: 0,
    wall,
  })
}

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function normalize(dx: number, dy: number) {
  const length = Math.hypot(dx, dy)

  return length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length }
}

function getWallDirection(wall: Wall) {
  return normalize(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
}

function getWallNormal(wall: Wall) {
  const direction = getWallDirection(wall)

  return {
    x: -direction.y,
    y: direction.x,
  }
}

function lineIntersection(
  firstPoint: Point,
  firstDirection: Point,
  secondPoint: Point,
  secondDirection: Point,
) {
  const cross =
    firstDirection.x * secondDirection.y -
    firstDirection.y * secondDirection.x

  if (Math.abs(cross) < MITER_PARALLEL_EPSILON) {
    return null
  }

  const dx = secondPoint.x - firstPoint.x
  const dy = secondPoint.y - firstPoint.y
  const t = (dx * secondDirection.y - dy * secondDirection.x) / cross

  return {
    x: firstPoint.x + firstDirection.x * t,
    y: firstPoint.y + firstDirection.y * t,
  }
}

function endpointTouchesWallEndpoint(endpoint: Point, wall: Wall) {
  return (
    distance(endpoint, wall.start) <= MITER_JOIN_EPSILON_METERS ||
    distance(endpoint, wall.end) <= MITER_JOIN_EPSILON_METERS
  )
}

function getEndpointOutwardDirection(wall: Wall, endpoint: 'start' | 'end') {
  const direction = getWallDirection(wall)

  return endpoint === 'start'
    ? { x: -direction.x, y: -direction.y }
    : direction
}

function getEndpointCornerIndex(endpoint: 'start' | 'end', side: -1 | 1) {
  if (endpoint === 'start') {
    return side === 1 ? 0 : 3
  }

  return side === 1 ? 1 : 2
}

function getWallSidePoint(wall: Wall, side: -1 | 1) {
  const normal = getWallNormal(wall)
  const offset = (wall.thickness / 2) * side

  return {
    x: wall.start.x + normal.x * offset,
    y: wall.start.y + normal.y * offset,
  }
}

function getSideNormal(wall: Wall, side: -1 | 1) {
  const normal = getWallNormal(wall)

  return {
    x: normal.x * side,
    y: normal.y * side,
  }
}

function getMatchingAdjoiningSide(wall: Wall, side: -1 | 1, adjoiningWall: Wall) {
  const sideNormal = getSideNormal(wall, side)
  const adjoiningNormal = getWallNormal(adjoiningWall)
  const sideOneDot =
    sideNormal.x * adjoiningNormal.x + sideNormal.y * adjoiningNormal.y
  const sideTwoDot =
    sideNormal.x * -adjoiningNormal.x + sideNormal.y * -adjoiningNormal.y

  return sideOneDot >= sideTwoDot ? 1 : -1
}

function getSideMiteredWallBodyPoints(wall: Wall, walls: Wall[]) {
  const polygon = [...getWallBodyPoints(wall)] as [Point, Point, Point, Point]
  const wallDirection = getWallDirection(wall)
  const wallNormal = getWallNormal(wall)

  for (const endpoint of ['start', 'end'] as const) {
    const endpointPoint = wall[endpoint]
    const adjoiningWalls = walls.filter(
      (otherWall) =>
        otherWall.id !== wall.id &&
        otherWall.kind === 'external' &&
        endpointTouchesWallEndpoint(endpointPoint, otherWall),
    )

    if (adjoiningWalls.length === 0) {
      continue
    }

    const outwardDirection = getEndpointOutwardDirection(wall, endpoint)
    const rightAngleCapExtension = adjoiningWalls.reduce(
      (extension, adjoiningWall) => {
        const adjoiningDirection = getWallDirection(adjoiningWall)
        const directionDot = Math.abs(
          wallDirection.x * adjoiningDirection.x +
            wallDirection.y * adjoiningDirection.y,
        )

        return directionDot <= MITER_RIGHT_ANGLE_DOT_TOLERANCE
          ? Math.max(extension, adjoiningWall.thickness / 2)
          : extension
      },
      0,
    )

    if (rightAngleCapExtension > 0) {
      for (const side of [1, -1] as const) {
        const cornerIndex = getEndpointCornerIndex(endpoint, side)

        polygon[cornerIndex] = {
          x: polygon[cornerIndex].x + outwardDirection.x * rightAngleCapExtension,
          y: polygon[cornerIndex].y + outwardDirection.y * rightAngleCapExtension,
        }
      }
    }

    for (const side of [1, -1] as const) {
      const cornerIndex = getEndpointCornerIndex(endpoint, side)
      const corner = polygon[cornerIndex]
      let bestCandidate: { extension: number; point: Point } | null = null

      for (const adjoiningWall of adjoiningWalls) {
        const adjoiningDirection = getWallDirection(adjoiningWall)
        const directionDot = Math.abs(
          wallDirection.x * adjoiningDirection.x +
            wallDirection.y * adjoiningDirection.y,
        )
        const isRightAngleJoin =
          directionDot <= MITER_RIGHT_ANGLE_DOT_TOLERANCE
        const adjoiningSide = getMatchingAdjoiningSide(wall, side, adjoiningWall)
        const adjoiningSidePoint = getWallSidePoint(adjoiningWall, adjoiningSide)
        const maxExtension = Math.max(wall.thickness, adjoiningWall.thickness) * 4
        const candidate = lineIntersection(
          corner,
          wallDirection,
          adjoiningSidePoint,
          adjoiningDirection,
        )

        if (!candidate) {
          continue
        }

        const extension =
          (candidate.x - corner.x) * outwardDirection.x +
          (candidate.y - corner.y) * outwardDirection.y
        const sideDistance =
          Math.abs(
            (candidate.x - corner.x) * wallNormal.x +
              (candidate.y - corner.y) * wallNormal.y,
          )

        const invalidExtension = isRightAngleJoin
          ? extension <= 0.0001 || extension > maxExtension
          : Math.abs(extension) > maxExtension

        if (invalidExtension || sideDistance > 0.0001) {
          continue
        }

        if (
          !bestCandidate ||
          Math.abs(extension) < Math.abs(bestCandidate.extension)
        ) {
          bestCandidate = { extension, point: candidate }
        }
      }

      if (bestCandidate) {
        polygon[cornerIndex] = bestCandidate.point
      }
    }
  }

  return polygon
}

function toSideMiteredWallBodyPolygon(wall: Wall, walls: Wall[]): Polygon {
  return [closeRing(getSideMiteredWallBodyPoints(wall, walls))]
}

export function getExternalWallRenderExtensions(
  wall: Wall,
  walls: Wall[],
): WallRenderExtensions {
  if (wall.kind !== 'external') {
    return {
      endExtension: 0,
      startExtension: 0,
    }
  }

  const miteredPolygon = getSideMiteredWallBodyPoints(wall, walls)
  const originalPolygon = getWallBodyPoints(wall)
  const outwardDirections = {
    end: getEndpointOutwardDirection(wall, 'end'),
    start: getEndpointOutwardDirection(wall, 'start'),
  }
  const getEndpointExtension = (endpoint: 'start' | 'end') => {
    const sideOneIndex = getEndpointCornerIndex(endpoint, 1)
    const sideTwoIndex = getEndpointCornerIndex(endpoint, -1)
    const projections = [sideOneIndex, sideTwoIndex].map((cornerIndex) => {
      const originalCorner = originalPolygon[cornerIndex]
      const miteredCorner = miteredPolygon[cornerIndex]

      return (
        (miteredCorner.x - originalCorner.x) * outwardDirections[endpoint].x +
        (miteredCorner.y - originalCorner.y) * outwardDirections[endpoint].y
      )
    })
    const positiveExtension = Math.max(0, ...projections)

    if (positiveExtension > 0.0001) {
      return positiveExtension
    }

    return 0
  }

  return {
    endExtension: getEndpointExtension('end'),
    startExtension: getEndpointExtension('start'),
  }
}

function normalizeExtension(extension: number) {
  return Math.abs(extension) < 0.0001 ? 0 : extension
}

function getWallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

function getDistanceAlongWall(wall: Wall, point: Point) {
  const direction = getWallDirection(wall)

  return (
    (point.x - wall.start.x) * direction.x +
    (point.y - wall.start.y) * direction.y
  )
}

export function getClippedInternalWallRenderExtensions(
  wall: Wall,
  walls: Wall[],
): WallRenderExtensions {
  if (wall.kind !== 'internal') {
    return {
      endExtension: 0,
      startExtension: 0,
    }
  }

  const clippingPolygons = walls
    .filter(
      (otherWall) =>
        otherWall.id !== wall.id &&
        (otherWall.kind === 'external' ||
          (otherWall.kind === 'internal' && otherWall.id.localeCompare(wall.id) < 0)),
    )
    .map(toWallBodyPolygon)
  const footprints = differencePolygonFootprints(
    toWallBodyPolygon(wall),
    clippingPolygons,
  )

  if (footprints.length === 0) {
    return {
      endExtension: 0,
      startExtension: 0,
    }
  }

  const projectedDistances = footprints.flatMap((footprint) =>
    [footprint.outline, ...footprint.holes].flatMap((ring) =>
      ring.map((point) => getDistanceAlongWall(wall, point)),
    ),
  )
  const minDistance = Math.min(...projectedDistances)
  const maxDistance = Math.max(...projectedDistances)
  const wallLength = getWallLength(wall)

  return {
    endExtension: normalizeExtension(maxDistance - wallLength),
    startExtension: normalizeExtension(-minDistance),
  }
}

function toPointRing(ring: [number, number][]) {
  const openRing =
    ring.length > 1 &&
    Math.hypot(ring[0][0] - ring.at(-1)![0], ring[0][1] - ring.at(-1)![1]) <
      0.000001
      ? ring.slice(0, -1)
      : ring

  return openRing.map(([x, y]) => ({ x, y }))
}

function unionPolygonFootprints(wallPolygons: Polygon[]): WallUnionFootprint[] {
  if (wallPolygons.length === 0) {
    return []
  }

  const unionedFootprints = unionPolygons(wallPolygons[0], ...wallPolygons.slice(1))

  return toWallUnionFootprints(unionedFootprints)
}

function normalizeVector(start: Point, end: Point) {
  return normalize(end.x - start.x, end.y - start.y)
}

function getConvergedMiterRing(points: Point[], maxMiterDistance: number) {
  if (points.length < 4) {
    return points
  }

  const convergedPoints: Point[] = []
  let index = 0

  while (index < points.length) {
    const nextIndex = (index + 1) % points.length
    const previousPoint = points[(index - 1 + points.length) % points.length]
    const currentPoint = points[index]
    const nextPoint = points[nextIndex]
    const afterNextPoint = points[(index + 2) % points.length]
    const connectorLength = distance(currentPoint, nextPoint)

    if (connectorLength > maxMiterDistance) {
      convergedPoints.push(currentPoint)
      index += 1
      continue
    }

    const previousDirection = normalizeVector(previousPoint, currentPoint)
    const nextDirection = normalizeVector(nextPoint, afterNextPoint)
    const intersection = lineIntersection(
      currentPoint,
      previousDirection,
      nextPoint,
      nextDirection,
    )

    if (
      !intersection ||
      distance(intersection, currentPoint) > maxMiterDistance ||
      distance(intersection, nextPoint) > maxMiterDistance
    ) {
      convergedPoints.push(currentPoint)
      index += 1
      continue
    }

    convergedPoints.push(intersection)
    index += 2
  }

  return convergedPoints
}

function convergeMiteredFootprintChamfers(
  footprints: WallUnionFootprint[],
  walls: Wall[],
) {
  const maxWallThickness = Math.max(0, ...walls.map((wall) => wall.thickness))
  const maxMiterDistance = Math.max(maxWallThickness * 4, 0.001)

  return footprints.map((footprint) => ({
    holes: footprint.holes,
    outline: getConvergedMiterRing(footprint.outline, maxMiterDistance),
  }))
}

function toWallUnionFootprints(multiPolygon: MultiPolygon): WallUnionFootprint[] {
  return multiPolygon.flatMap((polygon) => {
    const [outline, ...holes] = polygon

    return outline
      ? [
          {
            holes: holes.map(toPointRing),
            outline: toPointRing(outline),
          },
        ]
      : []
  })
}

function differencePolygonFootprints(
  subjectPolygon: Polygon,
  clippingPolygons: Polygon[],
): WallUnionFootprint[] {
  if (clippingPolygons.length === 0) {
    return toWallUnionFootprints([subjectPolygon])
  }

  return toWallUnionFootprints(
    differencePolygons(subjectPolygon, ...clippingPolygons),
  )
}

export function unionRenderedWallFootprints(
  renderedWalls: RenderedWall[],
): WallUnionFootprint[] {
  return unionPolygonFootprints(renderedWalls.map(toPolygon))
}

export function unionWallFootprints(walls: Wall[]) {
  return unionPolygonFootprints(walls.map(toWallBodyPolygon))
}

export function unionMiteredWallFootprints(walls: Wall[], contextWalls = walls) {
  return convergeMiteredFootprintChamfers(
    unionPolygonFootprints(
      walls.map((wall) => toSideMiteredWallBodyPolygon(wall, contextWalls)),
    ),
    contextWalls,
  )
}

export function getClippedInternalWallFootprints(
  walls: Wall[],
  contextWalls = walls,
): WallFootprintRenderGroup[] {
  const externalWallPolygons = contextWalls
    .filter((wall) => wall.kind === 'external')
    .map(toWallBodyPolygon)
  const earlierInternalWallPolygons: Polygon[] = []
  const internalWalls = walls
    .filter((wall) => wall.kind === 'internal')
    .sort((firstWall, secondWall) => firstWall.id.localeCompare(secondWall.id))

  return internalWalls.flatMap((wall) => {
    const wallPolygon = toWallBodyPolygon(wall)
    const earlierContextInternalWallPolygons = contextWalls
      .filter(
        (otherWall) =>
          otherWall.kind === 'internal' &&
          otherWall.id !== wall.id &&
          otherWall.id.localeCompare(wall.id) < 0,
      )
      .map(toWallBodyPolygon)
    const footprints = differencePolygonFootprints(wallPolygon, [
      ...externalWallPolygons,
      ...earlierContextInternalWallPolygons,
      ...earlierInternalWallPolygons,
    ])

    earlierInternalWallPolygons.push(wallPolygon)

    return footprints.length > 0
      ? [
          {
            footprints,
            wallId: wall.id,
          },
        ]
      : []
  })
}

export function getUnionArea(multiPolygon: MultiPolygon) {
  return multiPolygon.reduce(
    (totalArea, polygon) =>
      totalArea +
      polygon.reduce((polygonArea, ring, ringIndex) => {
        const ringArea =
          Math.abs(
            ring.reduce((area, point, index) => {
              const nextPoint = ring[(index + 1) % ring.length]

              return area + point[0] * nextPoint[1] - nextPoint[0] * point[1]
            }, 0),
          ) / 2

        return ringIndex === 0 ? polygonArea + ringArea : polygonArea - ringArea
      }, 0),
    0,
  )
}
