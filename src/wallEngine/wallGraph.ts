import type { Point, Wall, WallKind } from '../types.ts'

export type WallEndpointKey = 'start' | 'end'

export type WallEndpointRef = {
  endpoint: WallEndpointKey
  wallId: string
}

export type WallSide = -1 | 1

export type WallGraphOptions = {
  crossingLeader?: (walls: Wall[]) => string
  endpointSnapTolerance?: number
  sideSnapTolerance?: number
}

export type EndpointJoinNode = {
  endpoints: WallEndpointRef[]
  id: string
  point: Point
  type: 'endpoint'
}

export type SideAttachmentNode = {
  attachedEndpoint: WallEndpointRef
  id: string
  point: Point
  side: WallSide
  targetDistance: number
  targetWallId: string
  type: 'side-attachment'
}

export type CrossingNode = {
  id: string
  leaderWallId: string
  point: Point
  type: 'crossing'
  wallIds: string[]
}

export type WallGraph = {
  crossings: CrossingNode[]
  endpointNodes: EndpointJoinNode[]
  sideAttachments: SideAttachmentNode[]
}

export type PlannedEndpointJoin = {
  endpoint: WallEndpointKey
  joinNodeId: string
  wallId: string
}

export type PlannedSideAttachment = {
  endpoint: WallEndpointKey
  side: WallSide
  targetDistance: number
  targetWallId: string
  wallId: string
}

export type PlannedCrossing = {
  crossingNodeId: string
  isLeader: boolean
  leaderWallId: string
  wallIds: string[]
}

export type WallJoinPlan = {
  crossings: PlannedCrossing[]
  endpointJoins: PlannedEndpointJoin[]
  sideAttachments: PlannedSideAttachment[]
  wallId: string
}

type EndpointCandidate = WallEndpointRef & {
  point: Point
}

type Projection = {
  distance: number
  point: Point
  rawT: number
}

const DEFAULT_ENDPOINT_SNAP_TOLERANCE = 0.03
const DEFAULT_SIDE_SNAP_TOLERANCE = 0.01
const CROSSING_EPSILON = 0.001

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

function getEndpointPoint(wall: Wall, endpoint: WallEndpointKey) {
  return endpoint === 'start' ? wall.start : wall.end
}

function averagePoint(points: Point[]) {
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function getProjectionOnWall(point: Point, wall: Wall): Projection {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return {
      distance: distance(point, wall.start),
      point: wall.start,
      rawT: 0,
    }
  }

  const rawT =
    ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
    lengthSquared
  const t = Math.max(0, Math.min(1, rawT))
  const projectionPoint = {
    x: wall.start.x + dx * t,
    y: wall.start.y + dy * t,
  }

  return {
    distance: distance(point, projectionPoint),
    point: projectionPoint,
    rawT,
  }
}

function projectionIsOnSideAttachmentSnapLine(
  projection: Projection,
  targetWall: Wall,
  sideSnapTolerance: number,
) {
  return (
    projection.distance <= sideSnapTolerance ||
    Math.abs(projection.distance - targetWall.thickness / 2) <=
      sideSnapTolerance
  )
}

function endpointsMatch(
  first: EndpointCandidate,
  second: EndpointCandidate,
  tolerance: number,
) {
  return distance(first.point, second.point) <= tolerance
}

function buildEndpointNodes(
  walls: Wall[],
  endpointSnapTolerance: number,
): {
  endpointNodeKeys: Set<string>
  nodes: EndpointJoinNode[]
} {
  const endpoints = walls.flatMap((wall): EndpointCandidate[] => [
    {
      endpoint: 'start',
      point: wall.start,
      wallId: wall.id,
    },
    {
      endpoint: 'end',
      point: wall.end,
      wallId: wall.id,
    },
  ])
  const visited = new Set<number>()
  const nodes: EndpointJoinNode[] = []
  const endpointNodeKeys = new Set<string>()

  endpoints.forEach((endpoint, index) => {
    if (visited.has(index)) {
      return
    }

    const cluster = endpoints
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate }) =>
        endpointsMatch(endpoint, candidate, endpointSnapTolerance),
      )

    cluster.forEach(({ candidateIndex }) => visited.add(candidateIndex))

    if (cluster.length < 2) {
      return
    }

    const node: EndpointJoinNode = {
      endpoints: cluster.map(({ candidate }) => ({
        endpoint: candidate.endpoint,
        wallId: candidate.wallId,
      })),
      id: `endpoint:${nodes.length}`,
      point: averagePoint(cluster.map(({ candidate }) => candidate.point)),
      type: 'endpoint',
    }

    node.endpoints.forEach((candidate) =>
      endpointNodeKeys.add(`${candidate.wallId}:${candidate.endpoint}`),
    )
    nodes.push(node)
  })

  return { endpointNodeKeys, nodes }
}

function getEndpointAwayDirection(wall: Wall, endpoint: WallEndpointKey) {
  const direction = getWallDirection(wall)

  return endpoint === 'start'
    ? direction
    : {
        x: -direction.x,
        y: -direction.y,
      }
}

function getAttachedSide(
  endpointPoint: Point,
  sourceWall: Wall,
  sourceEndpoint: WallEndpointKey,
  targetWall: Wall,
) {
  const normal = getWallNormal(targetWall)
  const projection = getProjectionOnWall(endpointPoint, targetWall)
  const signedDistance =
    (endpointPoint.x - projection.point.x) * normal.x +
    (endpointPoint.y - projection.point.y) * normal.y

  if (Math.abs(signedDistance) > 0.001) {
    return signedDistance >= 0 ? 1 : -1
  }

  const awayDirection = getEndpointAwayDirection(sourceWall, sourceEndpoint)
  const sideOneDot = awayDirection.x * normal.x + awayDirection.y * normal.y

  return sideOneDot >= 0 ? 1 : -1
}

function buildSideAttachments({
  endpointNodeKeys,
  sideSnapTolerance,
  walls,
}: {
  endpointNodeKeys: Set<string>
  sideSnapTolerance: number
  walls: Wall[]
}) {
  const attachments: SideAttachmentNode[] = []

  for (const wall of walls) {
    for (const endpoint of ['start', 'end'] as const) {
      if (endpointNodeKeys.has(`${wall.id}:${endpoint}`)) {
        continue
      }

      const endpointPoint = getEndpointPoint(wall, endpoint)
      const candidates = walls
        .filter((targetWall) => targetWall.id !== wall.id)
        .map((targetWall) => ({
          projection: getProjectionOnWall(endpointPoint, targetWall),
          targetWall,
        }))
        .filter(
          ({ projection, targetWall }) =>
            projection.rawT > 0.001 &&
            projection.rawT < 1 - 0.001 &&
            projectionIsOnSideAttachmentSnapLine(
              projection,
              targetWall,
              sideSnapTolerance,
            ),
        )
        .sort(
          (first, second) =>
            first.projection.distance - second.projection.distance ||
            first.targetWall.id.localeCompare(second.targetWall.id),
        )

      const bestCandidate = candidates[0]

      if (!bestCandidate) {
        continue
      }

      const { projection, targetWall } = bestCandidate

      attachments.push({
        attachedEndpoint: {
          endpoint,
          wallId: wall.id,
        },
        id: `side:${attachments.length}`,
        point: projection.point,
        side: getAttachedSide(endpointPoint, wall, endpoint, targetWall),
        targetDistance: projection.rawT * wallLength(targetWall),
        targetWallId: targetWall.id,
        type: 'side-attachment',
      })
    }
  }

  return attachments
}

function getSegmentIntersection(firstWall: Wall, secondWall: Wall) {
  const firstDx = firstWall.end.x - firstWall.start.x
  const firstDy = firstWall.end.y - firstWall.start.y
  const secondDx = secondWall.end.x - secondWall.start.x
  const secondDy = secondWall.end.y - secondWall.start.y
  const denominator = firstDx * secondDy - firstDy * secondDx

  if (Math.abs(denominator) <= 0.000001) {
    return null
  }

  const startDx = secondWall.start.x - firstWall.start.x
  const startDy = secondWall.start.y - firstWall.start.y
  const firstT = (startDx * secondDy - startDy * secondDx) / denominator
  const secondT = (startDx * firstDy - startDy * firstDx) / denominator

  if (
    firstT <= CROSSING_EPSILON ||
    firstT >= 1 - CROSSING_EPSILON ||
    secondT <= CROSSING_EPSILON ||
    secondT >= 1 - CROSSING_EPSILON
  ) {
    return null
  }

  return {
    point: {
      x: firstWall.start.x + firstDx * firstT,
      y: firstWall.start.y + firstDy * firstT,
    },
  }
}

function defaultCrossingLeader(walls: Wall[]) {
  const kindRank = (kind: WallKind) => (kind === 'external' ? 0 : 1)

  return [...walls].sort(
    (first, second) =>
      kindRank(first.kind) - kindRank(second.kind) ||
      wallLength(second) - wallLength(first) ||
      first.id.localeCompare(second.id),
  )[0].id
}

function buildCrossings(
  walls: Wall[],
  crossingLeader: (walls: Wall[]) => string,
) {
  const crossingGroups: Array<{ point: Point; walls: Wall[] }> = []

  walls.forEach((wall, wallIndex) => {
    walls.slice(wallIndex + 1).forEach((otherWall) => {
      const intersection = getSegmentIntersection(wall, otherWall)

      if (!intersection) {
        return
      }

      const matchingGroup = crossingGroups.find(
        (group) => distance(group.point, intersection.point) <= CROSSING_EPSILON,
      )

      if (matchingGroup) {
        matchingGroup.walls = Array.from(
          new Map(
            [...matchingGroup.walls, wall, otherWall].map((candidateWall) => [
              candidateWall.id,
              candidateWall,
            ]),
          ).values(),
        )
        return
      }

      crossingGroups.push({
        point: intersection.point,
        walls: [wall, otherWall],
      })
    })
  })

  return crossingGroups.map((group, index): CrossingNode => ({
    id: `crossing:${index}`,
    leaderWallId: crossingLeader(group.walls),
    point: group.point,
    type: 'crossing',
    wallIds: group.walls.map((wall) => wall.id).sort(),
  }))
}

export function buildWallGraph(
  walls: Wall[],
  options: WallGraphOptions = {},
): WallGraph {
  const endpointSnapTolerance =
    options.endpointSnapTolerance ?? DEFAULT_ENDPOINT_SNAP_TOLERANCE
  const sideSnapTolerance =
    options.sideSnapTolerance ?? DEFAULT_SIDE_SNAP_TOLERANCE
  const { endpointNodeKeys, nodes } = buildEndpointNodes(
    walls,
    endpointSnapTolerance,
  )

  return {
    crossings: buildCrossings(
      walls,
      options.crossingLeader ?? defaultCrossingLeader,
    ),
    endpointNodes: nodes,
    sideAttachments: buildSideAttachments({
      endpointNodeKeys,
      sideSnapTolerance,
      walls,
    }),
  }
}

export function buildWallJoinPlans(graph: WallGraph, walls: Wall[]) {
  const plansByWallId = new Map<string, WallJoinPlan>(
    walls.map((wall) => [
      wall.id,
      {
        crossings: [],
        endpointJoins: [],
        sideAttachments: [],
        wallId: wall.id,
      },
    ]),
  )

  graph.endpointNodes.forEach((node) => {
    node.endpoints.forEach((endpoint) => {
      plansByWallId.get(endpoint.wallId)?.endpointJoins.push({
        endpoint: endpoint.endpoint,
        joinNodeId: node.id,
        wallId: endpoint.wallId,
      })
    })
  })

  graph.sideAttachments.forEach((attachment) => {
    plansByWallId.get(attachment.attachedEndpoint.wallId)?.sideAttachments.push({
      endpoint: attachment.attachedEndpoint.endpoint,
      side: attachment.side,
      targetDistance: attachment.targetDistance,
      targetWallId: attachment.targetWallId,
      wallId: attachment.attachedEndpoint.wallId,
    })
  })

  graph.crossings.forEach((crossing) => {
    crossing.wallIds.forEach((wallId) => {
      plansByWallId.get(wallId)?.crossings.push({
        crossingNodeId: crossing.id,
        isLeader: wallId === crossing.leaderWallId,
        leaderWallId: crossing.leaderWallId,
        wallIds: crossing.wallIds,
      })
    })
  })

  return Array.from(plansByWallId.values())
}
