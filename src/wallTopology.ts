import type { Point, Wall } from './types'
import { getRenderedWalls, getWallPolygon, type RenderedWall } from './wallGeometry.ts'

const NODE_EPSILON_METERS = 0.25
const GRAPH_EPSILON_METERS = 0.03
const MIN_ROOM_AREA_SQUARE_METERS = 0.5

export type WallEndpoint = 'start' | 'end'

export type WallNodeConnection = {
  endpoint: WallEndpoint
  wall: Wall
}

export type WallNode = {
  id: string
  point: Point
  connections: WallNodeConnection[]
}

export type WallTopology = {
  nodes: WallNode[]
  rooms: DetectedRoom[]
  nodesByEndpoint: Map<string, WallNode>
  renderedWallsById: Map<string, RenderedWall>
  wallPolygonsById: Map<string, Point[]>
}

export type DetectedRoom = {
  area: number
  id: string
  polygon: Point[]
  signature: string
}

function distance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function getPointKey(point: Point, epsilon = GRAPH_EPSILON_METERS) {
  return `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}`
}

function pointsEqual(firstPoint: Point, secondPoint: Point) {
  return distance(firstPoint, secondPoint) <= GRAPH_EPSILON_METERS
}

function getProjectionOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return { point: start, rawT: 0, t: 0 }
  }

  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const t = Math.max(0, Math.min(1, rawT))

  return {
    point: {
      x: start.x + dx * t,
      y: start.y + dy * t,
    },
    rawT,
    t,
  }
}

function pointIsOnSegment(point: Point, start: Point, end: Point) {
  const projection = getProjectionOnSegment(point, start, end)

  return (
    projection.rawT >= -GRAPH_EPSILON_METERS &&
    projection.rawT <= 1 + GRAPH_EPSILON_METERS &&
    distance(point, projection.point) <= GRAPH_EPSILON_METERS
  )
}

function pointIsInPolygon(point: Point, polygon: Point[]) {
  let isInside = false

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previousIndex]

    if (pointIsOnSegment(point, previousPoint, currentPoint)) {
      return true
    }

    const intersects =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x

    if (intersects) {
      isInside = !isInside
    }
  }

  return isInside
}

type WallPolygonEdgeSide = -1 | 1 | null

function getPolygonEdgeSide(index: number): WallPolygonEdgeSide {
  if (index === 0) {
    return 1
  }

  if (index === 2) {
    return -1
  }

  return null
}

function getPolygonEdges(polygon: Point[], wallId: string) {
  return polygon.map((start, index) => ({
    end: polygon[(index + 1) % polygon.length],
    side: getPolygonEdgeSide(index),
    start,
    wallId,
  }))
}

function getSignedArea(points: Point[]) {
  return (
    points.reduce((area, point, index) => {
      const nextPoint = points[(index + 1) % points.length]
      return area + point.x * nextPoint.y - nextPoint.x * point.y
    }, 0) / 2
  )
}

function getPolygonCentroid(points: Point[]) {
  if (points.length === 0) {
    return { x: 0, y: 0 }
  }

  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function getRoomKey(points: Point[]) {
  return points
    .map((point) => getPointKey(point))
    .sort()
    .join('|')
}

function getSegmentIntersection(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  const firstDx = firstEnd.x - firstStart.x
  const firstDy = firstEnd.y - firstStart.y
  const secondDx = secondEnd.x - secondStart.x
  const secondDy = secondEnd.y - secondStart.y
  const denominator = firstDx * secondDy - firstDy * secondDx

  if (Math.abs(denominator) <= 1e-9) {
    return null
  }

  const startDx = secondStart.x - firstStart.x
  const startDy = secondStart.y - firstStart.y
  const firstT = (startDx * secondDy - startDy * secondDx) / denominator
  const secondT = (startDx * firstDy - startDy * firstDx) / denominator

  if (
    firstT < -GRAPH_EPSILON_METERS ||
    firstT > 1 + GRAPH_EPSILON_METERS ||
    secondT < -GRAPH_EPSILON_METERS ||
    secondT > 1 + GRAPH_EPSILON_METERS
  ) {
    return null
  }

  return {
    firstT: Math.max(0, Math.min(1, firstT)),
    point: {
      x: firstStart.x + firstDx * firstT,
      y: firstStart.y + firstDy * firstT,
    },
    secondT: Math.max(0, Math.min(1, secondT)),
  }
}

type GraphEdge = {
  from: string
  side: WallPolygonEdgeSide
  wallId: string
  to: string
}

function loopUsesBothSidesOfAnyWall(
  wallSidesByWallId: Map<string, Set<WallPolygonEdgeSide>>,
) {
  return [...wallSidesByWallId.values()].some(
    (sides) => sides.has(1) && sides.has(-1),
  )
}

function buildDetectedRooms(walls: Wall[]): DetectedRoom[] {
  const renderedWalls = getRenderedWalls(walls)
  const wallPolygons = renderedWalls.map(getWallPolygon)
  const sourceSegments = renderedWalls.flatMap((renderedWall) =>
    getPolygonEdges(getWallPolygon(renderedWall), renderedWall.wall.id),
  )
  const splitPointsBySegment = sourceSegments.map((segment) => [
    { ...segment.start, t: 0 },
    { ...segment.end, t: 1 },
  ])

  for (const [segmentIndex, segment] of sourceSegments.entries()) {
    const splitPoints = splitPointsBySegment[segmentIndex]

    for (const [otherSegmentIndex, otherSegment] of sourceSegments.entries()) {
      if (otherSegmentIndex === segmentIndex) {
        continue
      }

      for (const point of [otherSegment.start, otherSegment.end]) {
        const projection = getProjectionOnSegment(point, segment.start, segment.end)

        if (
          projection.rawT >= -GRAPH_EPSILON_METERS &&
          projection.rawT <= 1 + GRAPH_EPSILON_METERS &&
          distance(point, projection.point) <= GRAPH_EPSILON_METERS
        ) {
          splitPoints.push({ ...projection.point, t: projection.t })
        }
      }

      for (const point of [segment.start, segment.end]) {
        const projection = getProjectionOnSegment(
          point,
          otherSegment.start,
          otherSegment.end,
        )

        if (
          projection.rawT >= -GRAPH_EPSILON_METERS &&
          projection.rawT <= 1 + GRAPH_EPSILON_METERS &&
          distance(point, projection.point) <= GRAPH_EPSILON_METERS
        ) {
          splitPoints.push({ ...point, t: getProjectionOnSegment(point, segment.start, segment.end).t })
        }
      }

      const intersection = getSegmentIntersection(
        segment.start,
        segment.end,
        otherSegment.start,
        otherSegment.end,
      )

      if (intersection) {
        splitPoints.push({ ...intersection.point, t: intersection.firstT })
      }
    }
  }

  const pointsByKey = new Map<string, Point>()
  const edges: GraphEdge[] = []
  const edgeKeys = new Set<string>()

  for (const [segmentIndex] of sourceSegments.entries()) {
    const uniqueSplitPoints = splitPointsBySegment[segmentIndex]
      .sort((firstPoint, secondPoint) => firstPoint.t - secondPoint.t)
      .reduce<Array<Point & { t: number }>>((points, point) => {
        if (!points.some((candidatePoint) => pointsEqual(candidatePoint, point))) {
          points.push(point)
        }

        return points
      }, [])

    for (let index = 0; index < uniqueSplitPoints.length - 1; index += 1) {
      const start = uniqueSplitPoints[index]
      const end = uniqueSplitPoints[index + 1]

      if (distance(start, end) <= GRAPH_EPSILON_METERS) {
        continue
      }

      const startKey = getPointKey(start)
      const endKey = getPointKey(end)
      const edgeKey = [startKey, endKey].sort().join('>')

      if (edgeKeys.has(edgeKey)) {
        continue
      }

      edgeKeys.add(edgeKey)
      pointsByKey.set(startKey, { x: start.x, y: start.y })
      pointsByKey.set(endKey, { x: end.x, y: end.y })
      edges.push({
        from: startKey,
        side: sourceSegments[segmentIndex].side,
        to: endKey,
        wallId: sourceSegments[segmentIndex].wallId,
      })
      edges.push({
        from: endKey,
        side: sourceSegments[segmentIndex].side,
        to: startKey,
        wallId: sourceSegments[segmentIndex].wallId,
      })
    }
  }

  const outgoingEdgesByPoint = new Map<string, GraphEdge[]>()

  for (const edge of edges) {
    outgoingEdgesByPoint.set(edge.from, [
      ...(outgoingEdgesByPoint.get(edge.from) ?? []),
      edge,
    ])
  }

  for (const outgoingEdges of outgoingEdgesByPoint.values()) {
    outgoingEdges.sort((firstEdge, secondEdge) => {
      const fromPoint = pointsByKey.get(firstEdge.from)!
      const firstToPoint = pointsByKey.get(firstEdge.to)!
      const secondToPoint = pointsByKey.get(secondEdge.to)!
      return (
        Math.atan2(firstToPoint.y - fromPoint.y, firstToPoint.x - fromPoint.x) -
        Math.atan2(secondToPoint.y - fromPoint.y, secondToPoint.x - fromPoint.x)
      )
    })
  }

  const visited = new Set<string>()
  const roomsByKey = new Map<string, DetectedRoom>()

  for (const edge of edges) {
    const startState = `${edge.from}>${edge.to}`

    if (visited.has(startState)) {
      continue
    }

    const loop: Point[] = []
    const loopWallIds = new Set<string>()
    const loopWallSidesByWallId = new Map<string, Set<WallPolygonEdgeSide>>()
    let currentEdge = edge

    for (let step = 0; step < edges.length + 1; step += 1) {
      const state = `${currentEdge.from}>${currentEdge.to}`

      if (visited.has(state)) {
        break
      }

      visited.add(state)
      loop.push(pointsByKey.get(currentEdge.from)!)
      loopWallIds.add(currentEdge.wallId)
      loopWallSidesByWallId.set(
        currentEdge.wallId,
        loopWallSidesByWallId.get(currentEdge.wallId) ?? new Set(),
      )
      loopWallSidesByWallId.get(currentEdge.wallId)!.add(currentEdge.side)

      const outgoingEdges = outgoingEdgesByPoint.get(currentEdge.to) ?? []
      const reverseEdgeIndex = outgoingEdges.findIndex(
        (candidateEdge) => candidateEdge.to === currentEdge.from,
      )

      if (reverseEdgeIndex === -1) {
        break
      }

      const nextEdge =
        outgoingEdges[(reverseEdgeIndex - 1 + outgoingEdges.length) % outgoingEdges.length]

      currentEdge = nextEdge

      if (currentEdge.from === edge.from && currentEdge.to === edge.to) {
        const area = getSignedArea(loop)
        const absoluteArea = Math.abs(area)

        if (
          absoluteArea >= MIN_ROOM_AREA_SQUARE_METERS &&
          loopWallIds.size >= 3 &&
          !loopUsesBothSidesOfAnyWall(loopWallSidesByWallId)
        ) {
          const roomKey = getRoomKey(loop)

          if (!roomsByKey.has(roomKey)) {
            roomsByKey.set(roomKey, {
              area: absoluteArea,
              id: `room-${roomsByKey.size + 1}`,
              polygon: loop,
              signature: roomKey,
            })
          }
        }

        break
      }
    }
  }

  const rooms = [...roomsByKey.values()].filter((room) => {
    const centroid = getPolygonCentroid(room.polygon)
    return !wallPolygons.some((wallPolygon) => pointIsInPolygon(centroid, wallPolygon))
  })
  const largestArea = Math.max(...rooms.map((room) => room.area), 0)
  const roomsWithoutOutsideFace =
    rooms.length > 1
      ? rooms.filter((room) => room.area < largestArea - GRAPH_EPSILON_METERS)
      : rooms

  return roomsWithoutOutsideFace
    .sort((firstRoom, secondRoom) => {
      const firstCentroid = getPolygonCentroid(firstRoom.polygon)
      const secondCentroid = getPolygonCentroid(secondRoom.polygon)

      return firstCentroid.y - secondCentroid.y || firstCentroid.x - secondCentroid.x
    })
    .map((room, index) => ({
      ...room,
      id: `room-${index + 1}`,
    }))
}

function getEndpointKey(wallId: string, endpoint: WallEndpoint) {
  return `${wallId}:${endpoint}`
}

function createNodeId(point: Point) {
  return `${Math.round(point.x / NODE_EPSILON_METERS)}:${Math.round(
    point.y / NODE_EPSILON_METERS,
  )}`
}

function endpointNodeMergeDistance(wall: Wall, node: WallNode) {
  const nodeHasExternalWall = node.connections.some(
    (connection) => connection.wall.kind !== 'internal',
  )
  const nodeHasInternalWall = node.connections.some(
    (connection) => connection.wall.kind === 'internal',
  )
  const wallIsExternal = wall.kind !== 'internal'
  const wallIsInternal = wall.kind === 'internal'

  if (
    (wallIsInternal && nodeHasExternalWall) ||
    (wallIsExternal && nodeHasInternalWall)
  ) {
    return GRAPH_EPSILON_METERS
  }

  return NODE_EPSILON_METERS
}

function findNode(nodes: WallNode[], point: Point, wall: Wall) {
  return nodes.find(
    (node) => distance(node.point, point) <= endpointNodeMergeDistance(wall, node),
  )
}

function getTopologySnappedWalls(
  walls: Wall[],
  nodesByEndpoint: Map<string, WallNode>,
) {
  return walls.map((wall) => ({
    ...wall,
    start: nodesByEndpoint.get(getEndpointKey(wall.id, 'start'))?.point ?? wall.start,
    end: nodesByEndpoint.get(getEndpointKey(wall.id, 'end'))?.point ?? wall.end,
  }))
}

export function buildWallTopology(walls: Wall[]): WallTopology {
  const nodes: WallNode[] = []
  const nodesByEndpoint = new Map<string, WallNode>()

  for (const wall of walls) {
    for (const endpoint of ['start', 'end'] as const) {
      const point = wall[endpoint]
      const existingNode = findNode(nodes, point, wall)
      const node =
        existingNode ??
        ({
          id: createNodeId(point),
          point,
          connections: [],
        } satisfies WallNode)

      if (!existingNode) {
        nodes.push(node)
      }

      node.connections.push({ endpoint, wall })
      nodesByEndpoint.set(getEndpointKey(wall.id, endpoint), node)
    }
  }

  const topologyWalls = getTopologySnappedWalls(walls, nodesByEndpoint)
  const renderedWalls = getRenderedWalls(topologyWalls)
  const renderedWallsById = new Map(
    renderedWalls.map((renderedWall) => [renderedWall.wall.id, renderedWall]),
  )
  const wallPolygonsById = new Map(
    renderedWalls.map((renderedWall) => [
      renderedWall.wall.id,
      getWallPolygon(renderedWall),
    ]),
  )

  return {
    nodes,
    rooms: buildDetectedRooms(topologyWalls),
    nodesByEndpoint,
    renderedWallsById,
    wallPolygonsById,
  }
}

export function getWallEndpointNode(
  topology: WallTopology,
  wallId: string,
  endpoint: WallEndpoint,
) {
  return topology.nodesByEndpoint.get(getEndpointKey(wallId, endpoint)) ?? null
}

export function getOtherNodeConnections(
  topology: WallTopology,
  wall: Wall,
  endpoint: WallEndpoint,
) {
  return (
    getWallEndpointNode(topology, wall.id, endpoint)?.connections.filter(
      (connection) => connection.wall.id !== wall.id,
    ) ?? []
  )
}
