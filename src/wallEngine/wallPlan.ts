import type { Point, Wall } from '../types.ts'
import {
  buildWallGraph,
  buildWallJoinPlans,
  type WallEndpointKey,
  type WallGraph,
  type WallGraphOptions,
  type WallSide,
} from './wallGraph.ts'

export type WallEndpointJoinKind = 'chamfer' | 'converge'

export type WallEndpointSidePlan = {
  distanceFromEndpoint: number
  point: Point
  side: WallSide
  type: WallEndpointJoinKind
}

export type WallFreeEndpointPlan = {
  endpoint: WallEndpointKey
  type: 'free'
}

export type WallJoinedEndpointPlan = {
  endpoint: WallEndpointKey
  joinNodeId: string
  point: Point
  sidePlans: WallEndpointSidePlan[]
  type: 'endpoint-join'
}

export type WallSideAttachmentEndpointPlan = {
  capMaterialSource: {
    side: WallSide
    wallId: string
  }
  capCoveredByRenderedTarget: boolean
  capUvSource: {
    side: WallSide
    wallId: string
  }
  endpoint: WallEndpointKey
  point: Point
  sidePoints: WallEndpointSidePlan[]
  targetDistance: number
  targetWallId: string
  trimDistance: number
  type: 'side-attachment'
}

export type WallEndpointPlan =
  | WallFreeEndpointPlan
  | WallJoinedEndpointPlan
  | WallSideAttachmentEndpointPlan

export type WallCrossingPlan = {
  crossingNodeId: string
  distance: number
  leaderWallId: string
  role: 'cut-around-leader' | 'leader'
}

export type WallFaceInterval = {
  end: number
  start: number
}

export type WallFacePlan = {
  intervals: WallFaceInterval[]
  side: WallSide
  uvSource: {
    side: WallSide
    wallId: string
  }
  wallId: string
}

export type WallGeometryPlan = {
  crossings: WallCrossingPlan[]
  end: WallEndpointPlan
  faces: WallFacePlan[]
  length: number
  start: WallEndpointPlan
  wallId: string
}

export type WallGeometryPlanOptions = WallGraphOptions & {
  chamferThreshold?: number
  graph?: WallGraph
}

const DEFAULT_CHAMFER_THRESHOLD = 1
const MIN_SIDE_ATTACHMENT_ANGLE_RADIANS = Math.PI / 4
const SIDE_ATTACHMENT_CUT_EXTENSION_FACTOR = 1.5

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function wallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

function getWallDirection(wall: Wall) {
  const length = wallLength(wall)

  return length > 0
    ? {
        x: (wall.end.x - wall.start.x) / length,
        y: (wall.end.y - wall.start.y) / length,
      }
    : { x: 1, y: 0 }
}

function getWallNormal(wall: Wall) {
  const direction = getWallDirection(wall)

  return {
    x: -direction.y,
    y: direction.x,
  }
}

function wallMeetsSideAttachmentAngle(sourceWall: Wall, targetWall: Wall) {
  const sourceDirection = getWallDirection(sourceWall)
  const targetDirection = getWallDirection(targetWall)
  const absoluteDot = Math.abs(
    sourceDirection.x * targetDirection.x +
      sourceDirection.y * targetDirection.y,
  )

  return absoluteDot <= Math.cos(MIN_SIDE_ATTACHMENT_ANGLE_RADIANS)
}

function wallIsPerpendicularToTarget(sourceWall: Wall, targetWall: Wall) {
  const sourceDirection = getWallDirection(sourceWall)
  const targetDirection = getWallDirection(targetWall)
  const absoluteDot = Math.abs(
    sourceDirection.x * targetDirection.x +
      sourceDirection.y * targetDirection.y,
  )

  return absoluteDot <= 0.08
}

function getWallSideNormal(wall: Wall, side: WallSide) {
  const normal = getWallNormal(wall)

  return {
    x: normal.x * side,
    y: normal.y * side,
  }
}

function clampPointToTargetAttachmentSpan({
  attachmentPoint,
  point,
  targetWall,
  wall,
}: {
  attachmentPoint: Point
  point: Point
  targetWall: Wall
  wall: Wall
}) {
  const targetDirection = getWallDirection(targetWall)
  const projectedDistance =
    (point.x - attachmentPoint.x) * targetDirection.x +
    (point.y - attachmentPoint.y) * targetDirection.y
  const maximumDistance =
    Math.max(wall.thickness, targetWall.thickness) *
    SIDE_ATTACHMENT_CUT_EXTENSION_FACTOR

  if (Math.abs(projectedDistance) <= maximumDistance) {
    return point
  }

  const clampedDistance = Math.sign(projectedDistance) * maximumDistance

  return {
    x: attachmentPoint.x + targetDirection.x * clampedDistance,
    y: attachmentPoint.y + targetDirection.y * clampedDistance,
  }
}

function getEndpointPoint(wall: Wall, endpoint: WallEndpointKey) {
  return endpoint === 'start' ? wall.start : wall.end
}

function getEndpointOutwardDirection(wall: Wall, endpoint: WallEndpointKey) {
  const direction = getWallDirection(wall)

  return endpoint === 'start'
    ? {
        x: -direction.x,
        y: -direction.y,
      }
    : direction
}

function getWallSideLinePoint(wall: Wall, side: WallSide, endpoint: WallEndpointKey) {
  const normal = getWallNormal(wall)
  const endpointPoint = getEndpointPoint(wall, endpoint)

  return {
    x: endpointPoint.x + normal.x * wall.thickness * side / 2,
    y: endpointPoint.y + normal.y * wall.thickness * side / 2,
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

  if (Math.abs(cross) < 0.000001) {
    return null
  }

  const dx = secondPoint.x - firstPoint.x
  const dy = secondPoint.y - firstPoint.y
  const t = (dx * secondDirection.y - dy * secondDirection.x) / cross

  return {
    point: {
      x: firstPoint.x + firstDirection.x * t,
      y: firstPoint.y + firstDirection.y * t,
    },
    t,
  }
}

function getProjectedDistanceAlongWall(wall: Wall, point: Point) {
  const direction = getWallDirection(wall)

  return (
    (point.x - wall.start.x) * direction.x +
    (point.y - wall.start.y) * direction.y
  )
}

function getPointAlongWall(wall: Wall, distanceAlongWall: number) {
  const direction = getWallDirection(wall)

  return {
    x: wall.start.x + direction.x * distanceAlongWall,
    y: wall.start.y + direction.y * distanceAlongWall,
  }
}

function getDistanceAlongTargetWall(targetWall: Wall, point: Point) {
  const direction = getWallDirection(targetWall)

  return (
    (point.x - targetWall.start.x) * direction.x +
    (point.y - targetWall.start.y) * direction.y
  )
}

function shiftPointAlongWall(wall: Wall, point: Point, distanceAlongWall: number) {
  const direction = getWallDirection(wall)

  return {
    x: point.x + direction.x * distanceAlongWall,
    y: point.y + direction.y * distanceAlongWall,
  }
}

function getSideAttachmentTargetSpanShift(
  targetWall: Wall,
  sidePoints: WallEndpointSidePlan[],
) {
  const targetLength = wallLength(targetWall)
  const targetDistances = sidePoints.map((sidePoint) =>
    getDistanceAlongTargetWall(targetWall, sidePoint.point),
  )
  const minimumDistance = Math.min(...targetDistances)
  const maximumDistance = Math.max(...targetDistances)

  if (minimumDistance < 0) {
    return -minimumDistance
  }

  if (maximumDistance > targetLength) {
    return targetLength - maximumDistance
  }

  return 0
}

function getEndpointDistance(
  wall: Wall,
  endpoint: WallEndpointKey,
  point: Point,
) {
  const endpointPoint = getEndpointPoint(wall, endpoint)
  const outward = getEndpointOutwardDirection(wall, endpoint)

  return (
    (point.x - endpointPoint.x) * outward.x +
    (point.y - endpointPoint.y) * outward.y
  )
}

function getMatchingOtherEndpoint(
  wall: Wall,
  joinPoint: Point,
): WallEndpointKey {
  return distance(wall.start, joinPoint) <= distance(wall.end, joinPoint)
    ? 'start'
    : 'end'
}

function buildEndpointSidePlans({
  chamferThreshold,
  endpoint,
  joinNodeId,
  graph,
  wall,
  wallsById,
}: {
  chamferThreshold: number
  endpoint: WallEndpointKey
  graph: WallGraph
  joinNodeId: string
  wall: Wall
  wallsById: Map<string, Wall>
}): WallEndpointSidePlan[] {
  const node = graph.endpointNodes.find((candidateNode) => candidateNode.id === joinNodeId)
  const wallJoinEndpoint = node?.endpoints.find(
    (candidateEndpoint) =>
      candidateEndpoint.wallId === wall.id &&
      candidateEndpoint.endpoint === endpoint,
  )

  if (!node || !wallJoinEndpoint) {
    return []
  }

  const wallOutward = getEndpointOutwardDirection(wall, endpoint)
  const otherEndpointRefs = node.endpoints.filter(
    (candidateEndpoint) => candidateEndpoint.wallId !== wall.id,
  )

  return ([1, -1] as const).map((side): WallEndpointSidePlan => {
    const sideLinePoint = getWallSideLinePoint(wall, side, endpoint)
    const bestIntersection = otherEndpointRefs
      .flatMap((otherEndpointRef) => {
        const otherWall = wallsById.get(otherEndpointRef.wallId)

        if (!otherWall) {
          return []
        }

        const otherEndpoint = getMatchingOtherEndpoint(otherWall, node.point)
        const wallDirection = getWallDirection(wall)
        const otherDirection = getWallDirection(otherWall)
        const directionDot = Math.abs(
          wallDirection.x * otherDirection.x +
            wallDirection.y * otherDirection.y,
        )
        const otherSides =
          directionDot > 0.8
            ? ([1, -1] as const)
                .map((otherSide) => ({
                  dot:
                    getWallSideNormal(wall, side).x *
                      getWallSideNormal(otherWall, otherSide).x +
                    getWallSideNormal(wall, side).y *
                      getWallSideNormal(otherWall, otherSide).y,
                  otherSide,
                }))
                .sort((first, second) => second.dot - first.dot)
                .slice(0, 1)
                .map(({ otherSide }) => otherSide)
            : ([1, -1] as const)

        return otherSides.flatMap((otherSide) => {
          const otherSideLinePoint = getWallSideLinePoint(
            otherWall,
            otherSide,
            otherEndpoint,
          )
          const intersection = lineIntersection(
            sideLinePoint,
            wallOutward,
            otherSideLinePoint,
            getEndpointOutwardDirection(otherWall, otherEndpoint),
          )

          if (!intersection || intersection.t < 0.001) {
            return []
          }

          return [intersection]
        })
      })
      .sort((first, second) => first.t - second.t)[0]

    if (!bestIntersection || bestIntersection.t > chamferThreshold) {
      return {
        distanceFromEndpoint: chamferThreshold,
        point: {
          x: sideLinePoint.x + wallOutward.x * chamferThreshold,
          y: sideLinePoint.y + wallOutward.y * chamferThreshold,
        },
        side,
        type: 'chamfer',
      }
    }

    return {
      distanceFromEndpoint: bestIntersection.t,
      point: bestIntersection.point,
      side,
      type: 'converge',
    }
  })
}

function buildEndpointPlan({
  chamferThreshold,
  endpoint,
  graph,
  joinNodeIdByEndpointKey,
  sideAttachmentByEndpointKey,
  wall,
  wallsById,
}: {
  chamferThreshold: number
  endpoint: WallEndpointKey
  graph: WallGraph
  joinNodeIdByEndpointKey: Map<string, string>
  sideAttachmentByEndpointKey: Map<string, WallGraph['sideAttachments'][number]>
  wall: Wall
  wallsById: Map<string, Wall>
}): WallEndpointPlan {
  const endpointKey = `${wall.id}:${endpoint}`
  const attachment = sideAttachmentByEndpointKey.get(endpointKey)

  if (attachment) {
    const targetWall = wallsById.get(attachment.targetWallId)

    if (targetWall && !wallMeetsSideAttachmentAngle(wall, targetWall)) {
      return {
        endpoint,
        type: 'free',
      }
    }

    const targetFacePoint =
      targetWall
        ? {
            x:
              attachment.point.x +
              getWallNormal(targetWall).x * targetWall.thickness * attachment.side / 2,
            y:
              attachment.point.y +
              getWallNormal(targetWall).y * targetWall.thickness * attachment.side / 2,
          }
        : attachment.point
    const targetFaceIntersection =
      targetWall &&
      lineIntersection(
        wall.start,
        getWallDirection(wall),
        getWallSideLinePoint(targetWall, attachment.side, 'start'),
        getWallDirection(targetWall),
      )
    const rawSidePoints = ([1, -1] as const).map((side): WallEndpointSidePlan => {
      const sideLinePoint = getWallSideLinePoint(wall, side, endpoint)
      const intersection =
        targetWall &&
        lineIntersection(
          sideLinePoint,
          getWallDirection(wall),
          getWallSideLinePoint(targetWall, attachment.side, 'start'),
          getWallDirection(targetWall),
        )
      const unclampedPoint =
        intersection?.point ?? getWallSideLinePoint(wall, side, endpoint)
      const point =
        targetWall && intersection
          ? clampPointToTargetAttachmentSpan({
              attachmentPoint: targetFacePoint,
              point: unclampedPoint,
              targetWall,
              wall,
            })
          : unclampedPoint

      return {
        distanceFromEndpoint: Math.abs(
          getEndpointDistance(
            wall,
            endpoint,
            point,
          ),
        ),
        point,
        side,
        type: 'converge',
      }
    })
    const targetSpanShift = targetWall && targetWall.kind === 'external' && wall.kind === 'internal'
      ? getSideAttachmentTargetSpanShift(targetWall, rawSidePoints)
      : 0
    const sidePoints =
      targetWall && Math.abs(targetSpanShift) > 0.000001
        ? rawSidePoints.map((sidePoint) => ({
            ...sidePoint,
            distanceFromEndpoint: Math.abs(
              getEndpointDistance(
                wall,
                endpoint,
                shiftPointAlongWall(targetWall, sidePoint.point, targetSpanShift),
              ),
            ),
            point: shiftPointAlongWall(targetWall, sidePoint.point, targetSpanShift),
          }))
        : rawSidePoints
    const adjustedTargetFacePoint =
      targetWall && Math.abs(targetSpanShift) > 0.000001
        ? shiftPointAlongWall(targetWall, targetFacePoint, targetSpanShift)
        : targetFacePoint
    const adjustedTargetFaceIntersectionPoint =
      targetWall &&
      targetFaceIntersection &&
      Math.abs(targetSpanShift) > 0.000001
        ? shiftPointAlongWall(targetWall, targetFaceIntersection.point, targetSpanShift)
        : targetFaceIntersection?.point
    const sideTrimDistances = sidePoints.map((sidePoint) =>
      getProjectedDistanceAlongWall(wall, sidePoint.point),
    )
    const trimDistanceAlongWall =
      endpoint === 'start'
        ? Math.max(
            0,
            Math.max(
              adjustedTargetFaceIntersectionPoint
                ? getProjectedDistanceAlongWall(wall, adjustedTargetFaceIntersectionPoint)
                : getProjectedDistanceAlongWall(wall, adjustedTargetFacePoint),
              ...sideTrimDistances,
            ),
          )
        : Math.min(
            wallLength(wall),
            Math.min(
              adjustedTargetFaceIntersectionPoint
                ? getProjectedDistanceAlongWall(wall, adjustedTargetFaceIntersectionPoint)
                : getProjectedDistanceAlongWall(wall, adjustedTargetFacePoint),
              ...sideTrimDistances,
            ),
          )

    return {
      capMaterialSource: {
        side: attachment.side,
        wallId: attachment.targetWallId,
      },
      capCoveredByRenderedTarget: targetWall
        ? wallIsPerpendicularToTarget(wall, targetWall)
        : true,
      capUvSource: {
        side: attachment.side,
        wallId: attachment.targetWallId,
      },
      endpoint,
      point: getPointAlongWall(wall, trimDistanceAlongWall),
      sidePoints,
      targetDistance: targetWall
        ? Math.max(0, Math.min(wallLength(targetWall), attachment.targetDistance + targetSpanShift))
        : attachment.targetDistance,
      targetWallId: attachment.targetWallId,
      trimDistance:
        endpoint === 'start'
          ? trimDistanceAlongWall
          : wallLength(wall) - trimDistanceAlongWall,
      type: 'side-attachment',
    }
  }

  const joinNodeId = joinNodeIdByEndpointKey.get(endpointKey)

  if (!joinNodeId) {
    return {
      endpoint,
      type: 'free',
    }
  }

  const node = graph.endpointNodes.find((candidateNode) => candidateNode.id === joinNodeId)

  return {
    endpoint,
    joinNodeId,
    point: node?.point ?? getEndpointPoint(wall, endpoint),
    sidePlans: buildEndpointSidePlans({
      chamferThreshold,
      endpoint,
      graph,
      joinNodeId,
      wall,
      wallsById,
    }),
    type: 'endpoint-join',
  }
}

function getFaceIntervals({
  endDistance,
  startDistance,
}: {
  endDistance: number
  startDistance: number
}) {
  return endDistance > startDistance + 0.0001
    ? [
        {
          end: endDistance,
          start: startDistance,
        },
      ]
    : []
}

function getEndpointTrimDistance(plan: WallEndpointPlan) {
  return plan.type === 'side-attachment' ? Math.max(0, plan.trimDistance) : 0
}

function buildCrossingPlans(wall: Wall, graph: WallGraph): WallCrossingPlan[] {
  return graph.crossings
    .filter((crossing) => crossing.wallIds.includes(wall.id))
    .map((crossing) => ({
      crossingNodeId: crossing.id,
      distance: getProjectedDistanceAlongWall(wall, crossing.point),
      leaderWallId: crossing.leaderWallId,
      role:
        crossing.leaderWallId === wall.id
          ? 'leader'
          : 'cut-around-leader',
    }))
}

export function buildWallGeometryPlans(
  walls: Wall[],
  options: WallGeometryPlanOptions = {},
): WallGeometryPlan[] {
  const graph = options.graph ?? buildWallGraph(walls, options)
  const joinPlans = buildWallJoinPlans(graph, walls)
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
  const joinNodeIdByEndpointKey = new Map<string, string>()
  const sideAttachmentByEndpointKey = new Map<
    string,
    WallGraph['sideAttachments'][number]
  >()
  const chamferThreshold = options.chamferThreshold ?? DEFAULT_CHAMFER_THRESHOLD

  graph.endpointNodes.forEach((node) => {
    node.endpoints.forEach((endpoint) => {
      joinNodeIdByEndpointKey.set(`${endpoint.wallId}:${endpoint.endpoint}`, node.id)
    })
  })
  graph.sideAttachments.forEach((attachment) => {
    sideAttachmentByEndpointKey.set(
      `${attachment.attachedEndpoint.wallId}:${attachment.attachedEndpoint.endpoint}`,
      attachment,
    )
  })

  return walls.map((wall) => {
    const length = wallLength(wall)
    const crossings = buildCrossingPlans(wall, graph)
    const joinPlan = joinPlans.find((candidatePlan) => candidatePlan.wallId === wall.id)
    const start = buildEndpointPlan({
      chamferThreshold,
      endpoint: 'start',
      graph,
      joinNodeIdByEndpointKey,
      sideAttachmentByEndpointKey,
      wall,
      wallsById,
    })
    const end = buildEndpointPlan({
      chamferThreshold,
      endpoint: 'end',
      graph,
      joinNodeIdByEndpointKey,
      sideAttachmentByEndpointKey,
      wall,
      wallsById,
    })
    const startDistance = Math.min(length, getEndpointTrimDistance(start))
    const endDistance = Math.max(
      startDistance,
      length - getEndpointTrimDistance(end),
    )
    const intervals = getFaceIntervals({
      endDistance,
      startDistance,
    })

    return {
      crossings,
      end,
      faces: ([1, -1] as const).map((side) => ({
        intervals,
        side,
        uvSource: {
          side,
          wallId: wall.id,
        },
        wallId: wall.id,
      })),
      length,
      start,
      wallId: joinPlan?.wallId ?? wall.id,
    }
  })
}
