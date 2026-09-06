import type { FloorLevel, Point, Wall } from './types.ts'
import {
  getClippedInternalWallFootprints,
  getExternalWallRenderExtensions,
  getClippedInternalWallRenderExtensions,
  unionMiteredWallFootprints,
  type WallFootprintRenderGroup,
  type WallUnionFootprint,
} from './wallBooleanGeometry.ts'
import { getWallPolygon, type RenderedWall } from './wallGeometry.ts'
import { buildWallTopology, type DetectedRoom } from './wallTopology.ts'
import { buildRoomSurfaceFloorPolygons } from './wallEngine/roomSurfaceMesh.ts'

export type RoomPortal = {
  bottom: number
  center: Point
  fromRoomSignature: string
  openingId: string
  toRoomSignature: string
  top: number
  wallId: string
  width: number
}

export type WallBodyOccluder = {
  kind: Wall['kind']
  polygon: Point[]
  renderedWall: RenderedWall
  wallId: string
}

export type RenderedFloorData = {
  externalWallFootprintGroups: WallFootprintRenderGroup[]
  externalWallUnionFootprints: WallUnionFootprint[]
  externalWallUnionWallIds: string[]
  externalWallUnionWalls: Wall[]
  floor: FloorLevel
  geometryContextWalls: Wall[]
  internalWallFootprintGroups: WallFootprintRenderGroup[]
  roomPortals: RoomPortal[]
  roomSurfacePolygonsBySignature: Map<string, Point[]>
  wallBodyOccluders: WallBodyOccluder[]
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
}

function isPointOnSegment(
  point: Point,
  segmentStart: Point,
  segmentEnd: Point,
  tolerance = 0.0001,
) {
  const segmentDx = segmentEnd.x - segmentStart.x
  const segmentDy = segmentEnd.y - segmentStart.y
  const segmentLength = Math.hypot(segmentDx, segmentDy)

  if (segmentLength < tolerance) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y) <= tolerance
  }

  const cross =
    (point.x - segmentStart.x) * segmentDy -
    (point.y - segmentStart.y) * segmentDx

  if (Math.abs(cross) > tolerance * segmentLength) {
    return false
  }

  const dot =
    (point.x - segmentStart.x) * segmentDx +
    (point.y - segmentStart.y) * segmentDy

  return dot >= -tolerance && dot <= segmentLength * segmentLength + tolerance
}

function isPointInsidePolygon(point: Point, polygon: Point[]) {
  let inside = false

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function isPointInsideOrOnPolygon(point: Point, polygon: Point[]) {
  return (
    polygon.some((polygonPoint, index) =>
      isPointOnSegment(
        point,
        polygonPoint,
        polygon[(index + 1) % polygon.length],
      ),
    ) || isPointInsidePolygon(point, polygon)
  )
}

function getRoomContainingPoint(rooms: DetectedRoom[], point: Point) {
  return (
    rooms.find((room) => isPointInsideOrOnPolygon(point, room.polygon)) ?? null
  )
}

function getWallPointAtDistance(wall: Wall, distanceAlongWall: number) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const wallLength = Math.hypot(dx, dy)

  if (wallLength === 0) {
    return wall.start
  }

  const t = Math.max(0, Math.min(1, distanceAlongWall / wallLength))

  return {
    x: wall.start.x + dx * t,
    y: wall.start.y + dy * t,
  }
}

function getWallNormal(wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const wallLength = Math.hypot(dx, dy)

  if (wallLength === 0) {
    return { x: 0, y: 1 }
  }

  return {
    x: -dy / wallLength,
    y: dx / wallLength,
  }
}

function buildRoomPortals(floor: FloorLevel, rooms: DetectedRoom[]) {
  const portals: RoomPortal[] = []
  const portalKeys = new Set<string>()

  for (const wall of floor.walls) {
    if (!wall.openings?.length) {
      continue
    }

    const normal = getWallNormal(wall)
    const sampleOffset = wall.thickness / 2 + 0.12

    for (const opening of wall.openings) {
      const center = getWallPointAtDistance(wall, opening.center)
      const firstRoom = getRoomContainingPoint(rooms, {
        x: center.x + normal.x * sampleOffset,
        y: center.y + normal.y * sampleOffset,
      })
      const secondRoom = getRoomContainingPoint(rooms, {
        x: center.x - normal.x * sampleOffset,
        y: center.y - normal.y * sampleOffset,
      })

      if (
        !firstRoom ||
        !secondRoom ||
        firstRoom.signature === secondRoom.signature
      ) {
        continue
      }

      const key = [
        wall.id,
        opening.id,
        firstRoom.signature,
        secondRoom.signature,
      ]
        .sort()
        .join(':')

      if (portalKeys.has(key)) {
        continue
      }

      portalKeys.add(key)
      portals.push({
        bottom: opening.bottom,
        center,
        fromRoomSignature: firstRoom.signature,
        openingId: opening.id,
        top: opening.bottom + opening.height,
        toRoomSignature: secondRoom.signature,
        wallId: wall.id,
        width: opening.width,
      })
      portals.push({
        bottom: opening.bottom,
        center,
        fromRoomSignature: secondRoom.signature,
        openingId: opening.id,
        top: opening.bottom + opening.height,
        toRoomSignature: firstRoom.signature,
        wallId: wall.id,
        width: opening.width,
      })
    }
  }

  return portals
}

function hasWallOpenings(wall: Wall) {
  return (wall.openings ?? []).length > 0
}

function wallTouchesDetectedRoom(wall: Wall, rooms: DetectedRoom[]) {
  const midpoint = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  }
  const normal = getWallNormal(wall)
  const sampleOffset = wall.thickness / 2 + 0.08

  return [
    getRoomContainingPoint(rooms, {
      x: midpoint.x + normal.x * sampleOffset,
      y: midpoint.y + normal.y * sampleOffset,
    }),
    getRoomContainingPoint(rooms, {
      x: midpoint.x - normal.x * sampleOffset,
      y: midpoint.y - normal.y * sampleOffset,
    }),
  ].some(Boolean)
}

function getPointDistance(firstPoint: Point, secondPoint: Point) {
  return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y)
}

function pointsAreConnected(firstPoint: Point, secondPoint: Point) {
  return getPointDistance(firstPoint, secondPoint) <= 0.02
}

function externalWallsAreConnected(firstWall: Wall, secondWall: Wall) {
  return (
    pointsAreConnected(firstWall.start, secondWall.start) ||
    pointsAreConnected(firstWall.start, secondWall.end) ||
    pointsAreConnected(firstWall.end, secondWall.start) ||
    pointsAreConnected(firstWall.end, secondWall.end)
  )
}

function getExternalWallUnionWallGroups(walls: Wall[]) {
  const externalWalls = walls.filter((wall) => wall.kind === 'external')
  const visitedWallIds = new Set<string>()
  const unionWallGroups: Wall[][] = []

  for (const wall of externalWalls) {
    if (visitedWallIds.has(wall.id)) {
      continue
    }

    const component: Wall[] = []
    const pendingWalls = [wall]
    visitedWallIds.add(wall.id)

    while (pendingWalls.length > 0) {
      const currentWall = pendingWalls.pop()!
      component.push(currentWall)

      for (const candidateWall of externalWalls) {
        if (
          visitedWallIds.has(candidateWall.id) ||
          !externalWallsAreConnected(currentWall, candidateWall)
        ) {
          continue
        }

        visitedWallIds.add(candidateWall.id)
        pendingWalls.push(candidateWall)
      }
    }

    if (component.length > 1) {
      unionWallGroups.push(component)
    }
  }

  return unionWallGroups
}

export function prepareRenderedFloorData(floor: FloorLevel): RenderedFloorData {
  const topology = buildWallTopology(floor.walls)
  const baseRenderedWalls = floor.walls
    .map((wall) => topology.renderedWallsById.get(wall.id))
    .filter((renderedWall): renderedWall is RenderedWall =>
      Boolean(renderedWall),
    )
  const topologyWalls = baseRenderedWalls.map((renderedWall) => renderedWall.wall)
  const renderedWalls = baseRenderedWalls.map((renderedWall) => {
    if (renderedWall.wall.kind === 'internal') {
      return {
        ...renderedWall,
        ...getClippedInternalWallRenderExtensions(
          renderedWall.wall,
          topologyWalls,
        ),
      }
    }

    if (!hasWallOpenings(renderedWall.wall)) {
      return renderedWall
    }

    if (renderedWall.wall.kind !== 'external') {
      return renderedWall
    }

    return {
      ...renderedWall,
      ...getExternalWallRenderExtensions(renderedWall.wall, topologyWalls),
    }
  })
  const externalWallFootprintGroups = getExternalWallUnionWallGroups(
    topologyWalls,
  ).flatMap((walls) => {
    if (
      !walls.some((wall) =>
        wallTouchesDetectedRoom(wall, topology.rooms),
      )
    ) {
      return []
    }

    const footprints = unionMiteredWallFootprints(walls, topologyWalls)

    return footprints.length > 0
      ? [
          {
            footprints,
            wallId: walls[0].id,
            wallIds: walls.map((wall) => wall.id),
          },
        ]
      : []
  })
  const externalWallUnionFootprints =
    externalWallFootprintGroups.flatMap((group) => group.footprints)
  const externalWallUnionWallIds = externalWallFootprintGroups.flatMap(
    (group) => group.wallIds ?? [group.wallId],
  )
  const wallsById = new Map(topologyWalls.map((wall) => [wall.id, wall]))
  const externalWallUnionWalls = externalWallUnionWallIds
    .map((wallId) => wallsById.get(wallId))
    .filter((wall): wall is Wall => Boolean(wall))
  const internalWallFootprintGroups = getClippedInternalWallFootprints(
    topologyWalls.filter((wall) => wall.kind === 'internal'),
    topologyWalls,
  )
  const wallBodyOccluders = renderedWalls.map((renderedWall) => ({
    kind: renderedWall.wall.kind,
    polygon: getWallPolygon(renderedWall),
    renderedWall,
    wallId: renderedWall.wall.id,
  }))
  const roomPortals = buildRoomPortals(floor, topology.rooms)
  const roomSurfacePolygonsBySignature = buildRoomSurfaceFloorPolygons({
    renderedWalls,
    rooms: topology.rooms,
  })

  return {
    externalWallFootprintGroups,
    externalWallUnionFootprints,
    externalWallUnionWallIds,
    externalWallUnionWalls,
    floor,
    geometryContextWalls: topologyWalls,
    internalWallFootprintGroups,
    roomPortals,
    roomSurfacePolygonsBySignature,
    renderedWalls,
    rooms: topology.rooms,
    wallBodyOccluders,
  }
}

