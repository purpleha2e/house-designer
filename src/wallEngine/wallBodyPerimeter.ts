import * as polygonClipping from 'polygon-clipping'
import type { MultiPolygon, Polygon } from 'polygon-clipping'
import type { Point, Wall } from '../types.ts'
import {
  buildWallGraph,
  type WallGraph,
  type WallGraphOptions,
  type WallEndpointKey,
  type WallSide,
} from './wallGraph.ts'

export type WallBodyRing = Point[]

export type WallBodyPerimeter = {
  componentId: string
  holes: WallBodyRing[]
  outline: WallBodyRing
  wallIds: string[]
}

export type WallBodyPolygon = {
  points: WallBodyRing
  wallId: string
}

type WallBodySidePoints = Record<
  WallEndpointKey,
  Record<WallSide, Point>
>

export type WallBodyPerimeterDiagnostic = {
  code: 'degenerate-wall' | 'empty-component' | 'invalid-wall-body'
  componentId: string
  wallIds: string[]
}

export type WallBodyPerimeterPlan = {
  diagnostics: WallBodyPerimeterDiagnostic[]
  perimeters: WallBodyPerimeter[]
  wallBodies: WallBodyPolygon[]
}

export type WallBodyPerimeterOptions = WallGraphOptions & {
  chamferThreshold?: number
}

const POINT_EPSILON = 0.000001
const MIN_WALL_LENGTH = 0.0001
const DEFAULT_CHAMFER_THRESHOLD = 1
const ENDPOINT_ATTACHMENT_TOLERANCE = 0.03
const COORDINATE_PRECISION = 1_000_000_000

const polygonClippingRuntime = polygonClipping as typeof polygonClipping & {
  default?: typeof polygonClipping
}
const unionPolygons =
  polygonClippingRuntime.union ?? polygonClippingRuntime.default?.union
const differencePolygons =
  polygonClippingRuntime.difference ?? polygonClippingRuntime.default?.difference

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function canonicalPoint(point: Point): Point {
  return {
    x: Math.round(point.x * COORDINATE_PRECISION) / COORDINATE_PRECISION,
    y: Math.round(point.y * COORDINATE_PRECISION) / COORDINATE_PRECISION,
  }
}

function signedArea(points: Point[]) {
  return points.reduce((area, point, index) => {
    const nextPoint = points[(index + 1) % points.length]

    return area + point.x * nextPoint.y - nextPoint.x * point.y
  }, 0) / 2
}

function wallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

function getWallDirection(wall: Wall) {
  const length = wallLength(wall)

  return length > POINT_EPSILON
    ? {
        x: (wall.end.x - wall.start.x) / length,
        y: (wall.end.y - wall.start.y) / length,
      }
    : { x: 1, y: 0 }
}

function getWallNormal(wall: Wall) {
  const direction = getWallDirection(wall)

  return { x: -direction.y, y: direction.x }
}

function getWallSidePoint(
  wall: Wall,
  endpoint: 'start' | 'end',
  side: WallSide,
) {
  const point = endpoint === 'start' ? wall.start : wall.end
  const normal = getWallNormal(wall)

  return {
    x: point.x + normal.x * wall.thickness * side / 2,
    y: point.y + normal.y * wall.thickness * side / 2,
  }
}

function getEndpointPoint(wall: Wall, endpoint: WallEndpointKey) {
  return endpoint === 'start' ? wall.start : wall.end
}

function getEndpointOutwardDirection(wall: Wall, endpoint: WallEndpointKey) {
  const direction = getWallDirection(wall)

  return endpoint === 'start'
    ? { x: -direction.x, y: -direction.y }
    : direction
}

function getEndpointInwardDirection(wall: Wall, endpoint: WallEndpointKey) {
  const outward = getEndpointOutwardDirection(wall, endpoint)

  return { x: -outward.x, y: -outward.y }
}

function cross(first: Point, second: Point) {
  return first.x * second.y - first.y * second.x
}

function dot(first: Point, second: Point) {
  return first.x * second.x + first.y * second.y
}

function raySegmentIntersection(
  rayOrigin: Point,
  rayDirection: Point,
  segmentStart: Point,
  segmentEnd: Point,
) {
  const segmentDirection = {
    x: segmentEnd.x - segmentStart.x,
    y: segmentEnd.y - segmentStart.y,
  }
  const denominator = cross(rayDirection, segmentDirection)

  if (Math.abs(denominator) <= POINT_EPSILON) {
    return null
  }

  const delta = {
    x: segmentStart.x - rayOrigin.x,
    y: segmentStart.y - rayOrigin.y,
  }
  const rayDistance = cross(delta, segmentDirection) / denominator
  const segmentT = cross(delta, rayDirection) / denominator

  if (
    rayDistance < POINT_EPSILON ||
    segmentT < -POINT_EPSILON ||
    segmentT > 1 + POINT_EPSILON
  ) {
    return null
  }

  return {
    distance: rayDistance,
    point: {
      x: rayOrigin.x + rayDirection.x * rayDistance,
      y: rayOrigin.y + rayDirection.y * rayDistance,
    },
  }
}

function rayIntersection(
  firstOrigin: Point,
  firstDirection: Point,
  secondOrigin: Point,
  secondDirection: Point,
) {
  const denominator = cross(firstDirection, secondDirection)

  if (Math.abs(denominator) <= POINT_EPSILON) {
    return null
  }

  const delta = {
    x: secondOrigin.x - firstOrigin.x,
    y: secondOrigin.y - firstOrigin.y,
  }
  const firstDistance = cross(delta, secondDirection) / denominator
  const secondDistance = cross(delta, firstDirection) / denominator

  if (firstDistance < POINT_EPSILON || secondDistance < -POINT_EPSILON) {
    return null
  }

  return {
    distance: firstDistance,
    point: {
      x: firstOrigin.x + firstDirection.x * firstDistance,
      y: firstOrigin.y + firstDirection.y * firstDistance,
    },
  }
}

function getRawWallBodyPoints(wall: Wall) {
  return [
    getWallSidePoint(wall, 'start', 1),
    getWallSidePoint(wall, 'end', 1),
    getWallSidePoint(wall, 'end', -1),
    getWallSidePoint(wall, 'start', -1),
  ]
}

function getRawWallBodyEdges(wall: Wall) {
  const points = getRawWallBodyPoints(wall)

  return points.map((start, index) => ({
    end: points[(index + 1) % points.length],
    start,
  }))
}

type EndpointTarget = {
  endpoint?: WallEndpointKey
  point: Point
  side?: WallSide
  source: 'endpoint' | 'side'
  wall: Wall
}

type EndpointTargetCandidate = {
  direction: Point
  target: EndpointTarget
}

type EndpointSideTarget = {
  isReflexTurn: boolean
  target: EndpointTarget
  turn: number
}

function getSideNormal(wall: Wall, side: WallSide) {
  const normal = getWallNormal(wall)

  return {
    x: normal.x * side,
    y: normal.y * side,
  }
}

function getEndpointTargetCandidates(target: EndpointTarget[]) {
  return target.flatMap((candidate): EndpointTargetCandidate[] => {
    if (candidate.endpoint) {
      return [
        {
          direction: getEndpointInwardDirection(candidate.wall, candidate.endpoint),
          target: candidate,
        },
      ]
    }

    const direction = getWallDirection(candidate.wall)

    return [
      {
        direction,
        target: candidate,
      },
      {
        direction: { x: -direction.x, y: -direction.y },
        target: candidate,
      },
    ]
  })
}

function getDirectedTurn(from: Point, to: Point, directionSign: number) {
  const signedAngle = Math.atan2(cross(from, to), dot(from, to))

  if (directionSign >= 0) {
    return signedAngle >= 0 ? signedAngle : Math.PI * 2 + signedAngle
  }

  return signedAngle <= 0 ? -signedAngle : Math.PI * 2 - signedAngle
}

function getEndpointSideHandedness(
  wall: Wall,
  endpoint: WallEndpointKey,
  side: WallSide,
) {
  return cross(
    getEndpointInwardDirection(wall, endpoint),
    getSideNormal(wall, side),
  ) >= 0
    ? 1
    : -1
}

function getOppositeEndpointSide(
  sourceWall: Wall,
  sourceEndpoint: WallEndpointKey,
  sourceSide: WallSide,
  targetWall: Wall,
  targetEndpoint: WallEndpointKey,
) {
  const sourceHandedness = getEndpointSideHandedness(
    sourceWall,
    sourceEndpoint,
    sourceSide,
  )

  return ([1, -1] as WallSide[]).find(
    (targetSide) =>
      getEndpointSideHandedness(targetWall, targetEndpoint, targetSide) ===
      -sourceHandedness,
  ) ?? sourceSide
}

function getMatchingTargetSide(
  sourceWall: Wall,
  sourceEndpoint: WallEndpointKey,
  sourceSide: WallSide,
  targetWall: Wall,
  targetEndpoint: WallEndpointKey | undefined,
  directionSign: number,
  isEndpointJoin: boolean,
) {
  const directionDot = Math.abs(
    dot(getWallDirection(sourceWall), getWallDirection(targetWall)),
  )

  if (
    targetEndpoint &&
    ((targetWall.kind === 'external' &&
      (!isEndpointJoin || sourceWall.kind === 'external')) ||
      (isEndpointJoin &&
        sourceWall.kind === 'internal' &&
        targetWall.kind === 'internal' &&
        directionDot > 0.08 &&
        directionDot <= 0.8))
  ) {
    return getOppositeEndpointSide(
      sourceWall,
      sourceEndpoint,
      sourceSide,
      targetWall,
      targetEndpoint,
    )
  }

  const sourceNormal = getSideNormal(sourceWall, sourceSide)
  const targetNormal = getWallNormal(targetWall)
  const normalDot = dot(sourceNormal, targetNormal)

  if (Math.abs(normalDot) <= POINT_EPSILON) {
    if (isEndpointJoin) {
      return directionSign >= 0 ? 1 : -1
    }

    return directionSign >= 0 ? -1 : 1
  }

  return normalDot > 0 ? 1 : -1
}

function getTargetsForEndpointSide({
  endpoint,
  side,
  targets,
  wall,
}: {
  endpoint: WallEndpointKey
  side: WallSide
  targets: EndpointTarget[]
  wall: Wall
}): EndpointSideTarget[] {
  const inward = getEndpointInwardDirection(wall, endpoint)
  const sideNormal = getSideNormal(wall, side)
  const sideAttachmentDirectionSign = cross(inward, sideNormal) >= 0 ? 1 : -1
  const endpointPoint = getEndpointPoint(wall, endpoint)
  const ranked = getEndpointTargetCandidates(targets)
    .map((candidate) => {
      const directionSign =
        candidate.target.source === 'endpoint'
          ? side === 1 ? -1 : 1
          : sideAttachmentDirectionSign

      return {
        candidate,
        directionSign,
        sourcePriority: candidate.target.source === 'side' ? 0 : 1,
        snapDistance: distance(candidate.target.point, endpointPoint),
        turn: getDirectedTurn(inward, candidate.direction, directionSign),
      }
    })
    .filter(({ turn }) => turn > POINT_EPSILON)
    .sort(
      (first, second) =>
        first.sourcePriority - second.sourcePriority ||
        first.turn - second.turn ||
        first.snapDistance - second.snapDistance ||
        first.candidate.target.wall.id.localeCompare(
          second.candidate.target.wall.id,
        ),
    )

  return ranked.map((selected) => {
    const baseTargetSide =
      selected.candidate.target.side ??
      getMatchingTargetSide(
        wall,
        endpoint,
        side,
        selected.candidate.target.wall,
        selected.candidate.target.endpoint,
        selected.directionSign,
        selected.candidate.target.source === 'endpoint',
      )
    const isReflexTurn = selected.turn > Math.PI + POINT_EPSILON
    const selectedDirectionDot = Math.abs(
      dot(getWallDirection(wall), getWallDirection(selected.candidate.target.wall)),
    )
    const shouldKeepExplicitSide =
      selected.candidate.target.source === 'side' &&
      selected.candidate.target.side !== undefined
    const shouldKeepExternalEndpointOppositeSide =
      selected.candidate.target.source === 'side' &&
      selected.candidate.target.endpoint !== undefined &&
      selected.candidate.target.wall.kind === 'external'
    const shouldKeepExternalEndpointJoinOppositeSide =
      selected.candidate.target.source === 'endpoint' &&
      selected.candidate.target.endpoint !== undefined &&
      ((wall.kind === 'external' &&
        selected.candidate.target.wall.kind === 'external') ||
        (wall.kind === 'internal' &&
          selected.candidate.target.wall.kind === 'internal' &&
          selectedDirectionDot > 0.08 &&
          selectedDirectionDot <= 0.8))

    return {
      isReflexTurn,
      target: {
        ...selected.candidate.target,
        side:
          isReflexTurn &&
          !shouldKeepExplicitSide &&
          !shouldKeepExternalEndpointOppositeSide &&
          !shouldKeepExternalEndpointJoinOppositeSide
            ? ((baseTargetSide * -1) as WallSide)
            : baseTargetSide,
      },
      turn: selected.turn,
    }
  })
}

function getFirstTargetBodyIntersection(
  rayOrigin: Point,
  rayDirection: Point,
  target: EndpointTarget,
) {
  const targetEdges = target.side
    ? [
        {
          start: getWallSidePoint(target.wall, 'start', target.side),
          end: getWallSidePoint(target.wall, 'end', target.side),
        },
        ...(target.endpoint
          ? [
              {
                start: getWallSidePoint(target.wall, target.endpoint, -1),
                end: getWallSidePoint(target.wall, target.endpoint, 1),
              },
            ]
          : []),
      ]
    : getRawWallBodyEdges(target.wall)

  return targetEdges
    .flatMap((edge) => {
      const intersection = raySegmentIntersection(
        rayOrigin,
        rayDirection,
        edge.start,
        edge.end,
      )

      return intersection ? [intersection] : []
    })
    .sort((first, second) => first.distance - second.distance)[0]
}

function getPointOnWallSideClosestToPoint(
  wall: Wall,
  side: WallSide,
  point: Point,
) {
  const direction = getWallDirection(wall)
  const normal = getWallNormal(wall)
  const distanceAlongWall =
    (point.x - wall.start.x) * direction.x +
    (point.y - wall.start.y) * direction.y

  return {
    x:
      wall.start.x +
      direction.x * distanceAlongWall +
      normal.x * wall.thickness * side / 2,
    y:
      wall.start.y +
      direction.y * distanceAlongWall +
      normal.y * wall.thickness * side / 2,
  }
}

function getTargetSideRayIntersections(
  rayOrigin: Point,
  rayDirection: Point,
  target: EndpointTarget,
) {
  const targetDirection = getWallDirection(target.wall)
  const targetDirections = [
    targetDirection,
    { x: -targetDirection.x, y: -targetDirection.y },
  ]
  const targetSides: WallSide[] = target.side
    ? [target.side]
    : ([1, -1] as WallSide[]).sort((firstSide, secondSide) => {
        const firstPoint = getPointOnWallSideClosestToPoint(
          target.wall,
          firstSide,
          target.point,
        )
        const secondPoint = getPointOnWallSideClosestToPoint(
          target.wall,
          secondSide,
          target.point,
        )

        return (
          distance(target.point, firstPoint) - distance(target.point, secondPoint)
        )
      })

  return targetSides
    .flatMap((targetSide, targetSideIndex) => {
      const targetPoint = getPointOnWallSideClosestToPoint(
        target.wall,
        targetSide,
        target.point,
      )
      const sideRayIntersections = targetDirections.flatMap(
        (targetDirection, targetDirectionIndex) => {
          const intersection = rayIntersection(
            rayOrigin,
            rayDirection,
            targetPoint,
            targetDirection,
          )

          return intersection
            ? [
                {
                  ...intersection,
                  targetDirectionIndex,
                  targetSideIndex,
                },
              ]
            : []
        },
      )

      if (!target.endpoint) {
        return sideRayIntersections
      }

      const capStart = getWallSidePoint(target.wall, target.endpoint, targetSide)
      const capEnd = getWallSidePoint(
        target.wall,
        target.endpoint,
        (targetSide * -1) as WallSide,
      )
      const capDirection = {
        x: capEnd.x - capStart.x,
        y: capEnd.y - capStart.y,
      }
      const capLength = Math.hypot(capDirection.x, capDirection.y)

      if (capLength <= POINT_EPSILON) {
        return sideRayIntersections
      }

      const capUnitDirection = {
        x: capDirection.x / capLength,
        y: capDirection.y / capLength,
      }
      const capRayIntersections = [
        {
          direction: capUnitDirection,
          origin: capStart,
        },
      ].flatMap((capRay, capRayIndex) => {
        const intersection = rayIntersection(
          rayOrigin,
          rayDirection,
          capRay.origin,
          capRay.direction,
        )

        return intersection
          ? [
              {
                ...intersection,
                targetDirectionIndex: targetDirections.length + capRayIndex,
                targetSideIndex,
              },
            ]
          : []
      })

      return [...sideRayIntersections, ...capRayIntersections]
    })
    .sort(
      (first, second) =>
        first.distance - second.distance ||
        first.targetDirectionIndex - second.targetDirectionIndex ||
        first.targetSideIndex - second.targetSideIndex,
    )
}

function solveEndpointSidePoint({
  chamferThreshold,
  endpoint,
  side,
  targets,
  wall,
}: {
  chamferThreshold: number
  endpoint: WallEndpointKey
  side: WallSide
  targets: EndpointTarget[]
  wall: Wall
}) {
  const endpointSidePoint = getWallSidePoint(wall, endpoint, side)

  if (targets.length === 0) {
    return endpointSidePoint
  }

  const rayDirection = getEndpointOutwardDirection(wall, endpoint)
  const oppositeEndpoint = endpoint === 'start' ? 'end' : 'start'
  const rayOrigin = getWallSidePoint(wall, oppositeEndpoint, side)
  const selectedTargets = getTargetsForEndpointSide({
    endpoint,
    side,
    targets,
    wall,
  })

  if (selectedTargets.length === 0) {
    return endpointSidePoint
  }

  const intersection = selectedTargets
    .map((selectedTarget) => {
      const target = selectedTarget.target
      const shouldPreferExplicitSide =
        target.source === 'side' && target.side !== undefined
      const directIntersection = getFirstTargetBodyIntersection(
        rayOrigin,
        rayDirection,
        target,
      )
      const shouldCompareTargetRays =
        selectedTarget.isReflexTurn ||
        shouldPreferExplicitSide ||
        Boolean(target.endpoint)
      const fallbackIntersection = shouldCompareTargetRays
        ? getTargetSideRayIntersections(rayOrigin, rayDirection, target)[0] ?? null
        : null

      if (shouldPreferExplicitSide) {
        return fallbackIntersection ?? directIntersection
      }

      if (selectedTarget.isReflexTurn || target.endpoint) {
        return [directIntersection, fallbackIntersection]
          .filter((candidate): candidate is NonNullable<typeof candidate> =>
            Boolean(candidate),
          )
          .sort((first, second) => first.distance - second.distance)[0]
      }

      return directIntersection ?? fallbackIntersection
    })
    .find((candidate) => candidate)

  if (!intersection) {
    return endpointSidePoint
  }

  const signedDistanceFromEndpoint = dot(
    {
      x: intersection.point.x - endpointSidePoint.x,
      y: intersection.point.y - endpointSidePoint.y,
    },
    rayDirection,
  )
  const distanceAlongRay = Math.max(
    -chamferThreshold,
    Math.min(signedDistanceFromEndpoint, chamferThreshold),
  )

  return {
    x: endpointSidePoint.x + rayDirection.x * distanceAlongRay,
    y: endpointSidePoint.y + rayDirection.y * distanceAlongRay,
  }
}

function removeDuplicateAndCollinearPoints(points: Point[]) {
  const deduplicated = points.filter((point, index) => {
    const previousPoint = points[(index - 1 + points.length) % points.length]

    return distance(point, previousPoint) > POINT_EPSILON
  })

  if (deduplicated.length < 3) {
    return deduplicated
  }

  return deduplicated.filter((point, index) => {
    const previousPoint =
      deduplicated[(index - 1 + deduplicated.length) % deduplicated.length]
    const nextPoint = deduplicated[(index + 1) % deduplicated.length]
    const firstX = point.x - previousPoint.x
    const firstY = point.y - previousPoint.y
    const secondX = nextPoint.x - point.x
    const secondY = nextPoint.y - point.y
    const cross = firstX * secondY - firstY * secondX
    const scale = Math.max(1, Math.hypot(firstX, firstY), Math.hypot(secondX, secondY))

    return Math.abs(cross) > POINT_EPSILON * scale
  })
}

function orientRing(points: Point[], clockwise: boolean) {
  const cleaned = removeDuplicateAndCollinearPoints(points)
  const isClockwise = signedArea(cleaned) < 0

  return isClockwise === clockwise ? cleaned : [...cleaned].reverse()
}

function convexHull(points: Point[]) {
  const uniquePoints = points
    .map(canonicalPoint)
    .filter(
      (point, index, allPoints) =>
        allPoints.findIndex(
          (candidate) => distance(candidate, point) <= POINT_EPSILON,
        ) === index,
    )
    .sort((first, second) => first.x - second.x || first.y - second.y)

  if (uniquePoints.length <= 2) {
    return uniquePoints
  }

  const lower: Point[] = []
  uniquePoints.forEach((point) => {
    while (lower.length >= 2) {
      const previous = lower[lower.length - 1]
      const beforePrevious = lower[lower.length - 2]
      const turn = cross(
        {
          x: previous.x - beforePrevious.x,
          y: previous.y - beforePrevious.y,
        },
        {
          x: point.x - previous.x,
          y: point.y - previous.y,
        },
      )

      if (turn > POINT_EPSILON) {
        break
      }

      lower.pop()
    }

    lower.push(point)
  })

  const upper: Point[] = []
  ;[...uniquePoints].reverse().forEach((point) => {
    while (upper.length >= 2) {
      const previous = upper[upper.length - 1]
      const beforePrevious = upper[upper.length - 2]
      const turn = cross(
        {
          x: previous.x - beforePrevious.x,
          y: previous.y - beforePrevious.y,
        },
        {
          x: point.x - previous.x,
          y: point.y - previous.y,
        },
      )

      if (turn > POINT_EPSILON) {
        break
      }

      upper.pop()
    }

    upper.push(point)
  })

  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function getTargetEndpointForSideAttachment(
  attachment: { targetDistance: number },
  targetWall: Wall,
) {
  const targetLength = wallLength(targetWall)
  const endpointAttachmentTolerance = Math.max(
    ENDPOINT_ATTACHMENT_TOLERANCE,
    targetWall.thickness / 2 + ENDPOINT_ATTACHMENT_TOLERANCE,
  )

  if (attachment.targetDistance <= endpointAttachmentTolerance) {
    return 'start'
  }

  if (
    attachment.targetDistance >=
    targetLength - endpointAttachmentTolerance
  ) {
    return 'end'
  }

  return undefined
}

function buildEndpointTargetsByKey(walls: Wall[], graph: WallGraph) {
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const targetsByKey = new Map<string, EndpointTarget[]>()
  const addTarget = (key: string, target: EndpointTarget) => {
    const targets = targetsByKey.get(key) ?? []
    const isDuplicate = targets.some(
      (candidate) =>
        candidate.wall.id === target.wall.id &&
        candidate.endpoint === target.endpoint &&
        candidate.side === target.side &&
        distance(candidate.point, target.point) <= POINT_EPSILON,
    )

    if (!isDuplicate) {
      targets.push(target)
    }

    targetsByKey.set(key, targets)
  }

  graph.endpointNodes.forEach((node) => {
    node.endpoints.forEach((endpoint) => {
      node.endpoints.forEach((otherEndpoint) => {
        const targetWall = wallsById.get(otherEndpoint.wallId)

        if (targetWall && otherEndpoint.wallId !== endpoint.wallId) {
          addTarget(`${endpoint.wallId}:${endpoint.endpoint}`, {
            endpoint: otherEndpoint.endpoint,
            point: node.point,
            source: 'endpoint',
            wall: targetWall,
          })
        }
      })
    })
  })
  graph.sideAttachments.forEach((attachment) => {
    const targetWall = wallsById.get(attachment.targetWallId)
    const attachedWall = wallsById.get(attachment.attachedEndpoint.wallId)

    if (targetWall && attachedWall) {
      const snapPoint = getEndpointPoint(
        attachedWall,
        attachment.attachedEndpoint.endpoint,
      )
      const targetNormal = getWallNormal(targetWall)
      const signedSnapOffset =
        (snapPoint.x - attachment.point.x) * targetNormal.x +
        (snapPoint.y - attachment.point.y) * targetNormal.y
      const snapOffset = Math.abs(signedSnapOffset)
      const snapIsOnTargetCenterline = snapOffset <= POINT_EPSILON
      const snapIsOnTargetFace =
        Math.abs(snapOffset - targetWall.thickness / 2) <=
        ENDPOINT_ATTACHMENT_TOLERANCE
      const targetEndpoint = getTargetEndpointForSideAttachment(
        attachment,
        targetWall,
      )

      const endpointKey =
        `${attachment.attachedEndpoint.wallId}:${attachment.attachedEndpoint.endpoint}`

      // A side attachment records the surface the endpoint was deliberately
      // snapped to. Coincident endpoints at the same quarter point still join
      // the component, but must not redirect edge banking away from that
      // surface.
      addTarget(endpointKey, {
        endpoint: targetEndpoint,
        point: snapPoint,
        side:
          targetEndpoint ||
          snapIsOnTargetCenterline ||
          snapIsOnTargetFace
            ? undefined
            : attachment.side,
        source: 'side',
        wall: targetWall,
      })

    }
  })

  return targetsByKey
}

function buildWallBodySidePoints(
  wall: Wall,
  targetsByEndpointKey: Map<string, EndpointTarget[]>,
  chamferThreshold: number,
): WallBodySidePoints {
  const getSidePoint = (endpoint: WallEndpointKey, side: WallSide) =>
    solveEndpointSidePoint({
      chamferThreshold,
      endpoint,
      side,
      targets: targetsByEndpointKey.get(`${wall.id}:${endpoint}`) ?? [],
      wall,
    })

  return {
    end: {
      [-1]: getSidePoint('end', -1),
      [1]: getSidePoint('end', 1),
    },
    start: {
      [-1]: getSidePoint('start', -1),
      [1]: getSidePoint('start', 1),
    },
  }
}

function buildWallBodyPolygon(
  wall: Wall,
  sidePoints: WallBodySidePoints,
): WallBodyPolygon {
  return {
    points: orientRing(
      [
        sidePoints.start[1],
        sidePoints.end[1],
        sidePoints.end[-1],
        sidePoints.start[-1],
      ].map(canonicalPoint),
      false,
    ),
    wallId: wall.id,
  }
}

function buildExternalEndpointSideAttachmentJoinFills(
  walls: Wall[],
  graph: WallGraph,
  sidePointsByWallId: Map<string, WallBodySidePoints>,
) {
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))

  return graph.sideAttachments.flatMap((attachment) => {
    const targetWall = wallsById.get(attachment.targetWallId)
    const attachedSidePoints = sidePointsByWallId.get(
      attachment.attachedEndpoint.wallId,
    )

    if (
      !targetWall ||
      !attachedSidePoints ||
      targetWall.kind !== 'external'
    ) {
      return []
    }

    const targetEndpoint = getTargetEndpointForSideAttachment(
      attachment,
      targetWall,
    )

    if (!targetEndpoint) {
      return []
    }

    const attachedEndpoint = attachment.attachedEndpoint.endpoint
    const fill = orientRing(
      convexHull([
        attachedSidePoints[attachedEndpoint][1],
        attachedSidePoints[attachedEndpoint][-1],
        getWallSidePoint(targetWall, targetEndpoint, 1),
        getWallSidePoint(targetWall, targetEndpoint, -1),
      ]),
      false,
    )

    return fill.length >= 3 && Math.abs(signedArea(fill)) > POINT_EPSILON
      ? [
          {
            points: fill,
            wallIds: [
              attachment.attachedEndpoint.wallId,
              attachment.targetWallId,
            ],
          },
        ]
      : []
  })
}

function buildEndpointJoinFills(
  walls: Wall[],
  graph: WallGraph,
  sidePointsByWallId: Map<string, WallBodySidePoints>,
) {
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))

  return graph.endpointNodes.flatMap((node) => {
    if (node.endpoints.length < 3) {
      return []
    }

    const points = node.endpoints.flatMap((endpoint) => {
      const sidePoints = sidePointsByWallId.get(endpoint.wallId)
      const wall = wallsById.get(endpoint.wallId)

      return sidePoints && wall
        ? [
            sidePoints[endpoint.endpoint][1],
            sidePoints[endpoint.endpoint][-1],
            getWallSidePoint(wall, endpoint.endpoint, 1),
            getWallSidePoint(wall, endpoint.endpoint, -1),
          ]
        : []
    })
    const fill = orientRing(convexHull(points), false)

    return fill.length >= 3 && Math.abs(signedArea(fill)) > POINT_EPSILON
      ? [
          {
            points: fill,
            wallIds: node.endpoints.map((endpoint) => endpoint.wallId),
          },
        ]
      : []
  })
}

function closeRing(points: Point[]) {
  if (points.length === 0) {
    return []
  }

  return [
    ...points.map((point) => [point.x, point.y] as [number, number]),
    [points[0].x, points[0].y] as [number, number],
  ]
}

function toPolygon(points: Point[]): Polygon {
  return [closeRing(points)]
}

function toPointRing(ring: [number, number][]) {
  const openRing =
    ring.length > 1 &&
    distance(
      { x: ring[0][0], y: ring[0][1] },
      { x: ring.at(-1)![0], y: ring.at(-1)![1] },
    ) <= POINT_EPSILON
      ? ring.slice(0, -1)
      : ring

  return openRing.map(([x, y]) => ({ x, y }))
}

function addConnection(
  connections: Map<string, Set<string>>,
  firstWallId: string,
  secondWallId: string,
) {
  if (firstWallId === secondWallId) {
    return
  }

  connections.get(firstWallId)?.add(secondWallId)
  connections.get(secondWallId)?.add(firstWallId)
}

function getConnectedWallIdComponents(walls: Wall[], graph: WallGraph) {
  const connections = new Map(
    walls.map((wall) => [wall.id, new Set<string>()]),
  )

  graph.endpointNodes.forEach((node) => {
    node.endpoints.forEach((endpoint, index) => {
      node.endpoints.slice(index + 1).forEach((otherEndpoint) =>
        addConnection(connections, endpoint.wallId, otherEndpoint.wallId),
      )
    })
  })
  graph.sideAttachments.forEach((attachment) =>
    addConnection(
      connections,
      attachment.attachedEndpoint.wallId,
      attachment.targetWallId,
    ),
  )
  graph.crossings.forEach((crossing) => {
    crossing.wallIds.forEach((wallId, index) => {
      crossing.wallIds.slice(index + 1).forEach((otherWallId) =>
        addConnection(connections, wallId, otherWallId),
      )
    })
  })

  const visited = new Set<string>()

  return walls.flatMap((wall) => {
    if (visited.has(wall.id)) {
      return []
    }

    const wallIds: string[] = []
    const pending = [wall.id]

    while (pending.length > 0) {
      const wallId = pending.pop()!

      if (visited.has(wallId)) {
        continue
      }

      visited.add(wallId)
      wallIds.push(wallId)
      connections.get(wallId)?.forEach((connectedWallId) => {
        if (!visited.has(connectedWallId)) {
          pending.push(connectedWallId)
        }
      })
    }

    return [wallIds.sort()]
  })
}

function toPerimeters(
  multiPolygon: MultiPolygon,
  componentId: string,
  wallIds: string[],
): WallBodyPerimeter[] {
  return multiPolygon.flatMap((polygon) => {
    const [outline, ...holes] = polygon

    if (!outline) {
      return []
    }

    return [
      {
        componentId,
        holes: holes
          .map(toPointRing)
          .map((ring) => orientRing(ring, false))
          .filter((ring) => ring.length >= 3),
        outline: orientRing(toPointRing(outline), true),
        wallIds,
      },
    ]
  })
}

export function subtractWallBodyPerimeters(
  subject: WallBodyPerimeter,
  clips: WallBodyPerimeter[],
) {
  if (clips.length === 0) {
    return [subject]
  }

  const toPerimeterPolygon = (perimeter: WallBodyPerimeter): Polygon => [
    closeRing(perimeter.outline),
    ...perimeter.holes.map(closeRing),
  ]
  const difference = differencePolygons(
    toPerimeterPolygon(subject),
    ...clips.map(toPerimeterPolygon),
  )

  return toPerimeters(difference, subject.componentId, subject.wallIds).map(
    (perimeter, index) => ({
      ...perimeter,
      componentId: `${subject.componentId}:exposed:${index}`,
    }),
  )
}

export function buildWallBodyPerimeters(
  walls: Wall[],
  options: WallBodyPerimeterOptions = {},
): WallBodyPerimeterPlan {
  const validWalls = walls.filter((wall) => wallLength(wall) >= MIN_WALL_LENGTH)
  const graph = buildWallGraph(validWalls, options)
  const targetsByEndpointKey = buildEndpointTargetsByKey(validWalls, graph)
  const chamferThreshold = options.chamferThreshold ?? DEFAULT_CHAMFER_THRESHOLD
  const diagnostics: WallBodyPerimeterDiagnostic[] = walls
    .filter((wall) => wallLength(wall) < MIN_WALL_LENGTH)
    .map((wall) => ({
      code: 'degenerate-wall',
      componentId: wall.id,
      wallIds: [wall.id],
    }))
  const sidePointsByWallId = new Map(
    validWalls.map((wall) => [
      wall.id,
      buildWallBodySidePoints(
        wall,
        targetsByEndpointKey,
        chamferThreshold,
      ),
    ]),
  )
  const wallBodies = validWalls.flatMap((wall) => {
    const sidePoints = sidePointsByWallId.get(wall.id)
    const body = sidePoints
      ? buildWallBodyPolygon(
          wall,
          sidePoints,
        )
      : buildWallBodyPolygon(
          wall,
          buildWallBodySidePoints(
            wall,
            targetsByEndpointKey,
            chamferThreshold,
          ),
        )

    if (body.points.length < 3 || Math.abs(signedArea(body.points)) <= POINT_EPSILON) {
      diagnostics.push({
        code: 'invalid-wall-body',
        componentId: wall.id,
        wallIds: [wall.id],
      })
      return []
    }

    return [body]
  })
  const bodiesByWallId = new Map(wallBodies.map((body) => [body.wallId, body]))
  const joinFills = buildExternalEndpointSideAttachmentJoinFills(
    validWalls,
    graph,
    sidePointsByWallId,
  ).concat(buildEndpointJoinFills(validWalls, graph, sidePointsByWallId))
  const perimeters = getConnectedWallIdComponents(validWalls, graph).flatMap((wallIds) => {
    const componentId = wallIds.join('|')
    const componentBodies = wallIds.flatMap((wallId) => {
      const body = bodiesByWallId.get(wallId)

      return body ? [body] : []
    })

    if (componentBodies.length === 0) {
      diagnostics.push({
        code: 'empty-component',
        componentId,
        wallIds,
      })
      return []
    }

    const componentWallIds = new Set(wallIds)
    const componentJoinFills = joinFills.filter((fill) =>
      fill.wallIds.every((wallId) => componentWallIds.has(wallId)),
    )
    const polygons = [
      ...componentBodies.map((body) => toPolygon(body.points)),
      ...componentJoinFills.map((fill) => toPolygon(fill.points)),
    ]
    const unioned = unionPolygons(polygons[0], ...polygons.slice(1))

    return toPerimeters(unioned, componentId, wallIds)
  })

  return {
    diagnostics,
    perimeters,
    wallBodies,
  }
}
