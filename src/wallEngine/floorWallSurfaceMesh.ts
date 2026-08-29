import type { Wall } from '../types.ts'
import type { RenderedWall } from '../wallGeometry.ts'
import type { DetectedRoom } from '../wallTopology.ts'
import {
  buildRoomSurfaceFaceSpans,
  buildRoomSurfaceWallFacesFromSpans,
  getRoomSurfaceKey,
} from './roomSurfaceMesh.ts'
import {
  buildWallBodyPerimeterMeshFaces,
  buildWallMeshFaces,
  type WallMeshFace,
} from './wallMesh.ts'

export type FloorWallSurfaceFace = WallMeshFace

export type FloorWallSurfaceMeshOptions = {
  externalFootprintWallIds?: ReadonlySet<string>
  contextRenderedWalls?: RenderedWall[]
  renderedWalls: RenderedWall[]
  roomSurfaceRendererEnabled?: boolean
  rooms: DetectedRoom[]
  useWallBodyPerimeterMesh?: boolean
}

type WallFaceCoverageInterval = {
  end: number
  start: number
}

function distance(first: { x: number; y: number }, second: { x: number; y: number }) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getDistanceAlongWall(wall: Wall, point: { x: number; y: number }) {
  const length = distance(wall.start, wall.end)

  if (length <= 0.000001) {
    return 0
  }

  return (
    ((point.x - wall.start.x) * (wall.end.x - wall.start.x) +
      (point.y - wall.start.y) * (wall.end.y - wall.start.y)) /
    length
  )
}

function getWallNormal(wall: Wall) {
  const length = distance(wall.start, wall.end)

  if (length <= 0.000001) {
    return { x: 0, y: 1 }
  }

  return {
    x: -(wall.end.y - wall.start.y) / length,
    y: (wall.end.x - wall.start.x) / length,
  }
}

function getWallFaceHorizontalInterval(
  face: FloorWallSurfaceFace,
  wallsById: Map<string, Wall>,
) {
  const wall = wallsById.get(face.wallId)
  const distanceValues = wall
    ? face.vertices.map((vertex) =>
        getDistanceAlongWall(wall, {
          x: vertex.position[0],
          y: vertex.position[2],
        }),
      )
    : face.vertices.map((vertex) => vertex.uv[0])

  return {
    end: Math.max(...distanceValues),
    start: Math.min(...distanceValues),
  }
}

function getWallFaceHorizontalIntervalOnWall(
  face: FloorWallSurfaceFace,
  wall: Wall,
) {
  const distanceValues = face.vertices.map((vertex) =>
    getDistanceAlongWall(wall, {
      x: vertex.position[0],
      y: vertex.position[2],
    }),
  )

  return {
    end: Math.max(...distanceValues),
    start: Math.min(...distanceValues),
  }
}

function mergeWallFaceCoverageIntervals(intervals: WallFaceCoverageInterval[]) {
  return intervals
    .sort((first, second) => first.start - second.start || first.end - second.end)
    .reduce<WallFaceCoverageInterval[]>((merged, interval) => {
      const previous = merged[merged.length - 1]

      if (previous && interval.start <= previous.end + 0.01) {
        previous.end = Math.max(previous.end, interval.end)
        return merged
      }

      merged.push({ ...interval })
      return merged
    }, [])
}

function getWallFaceCoverageByKey(
  faces: FloorWallSurfaceFace[],
  wallsById: Map<string, Wall>,
) {
  const coverage = new Map<string, WallFaceCoverageInterval[]>()

  faces.forEach((face) => {
    const key = getRoomSurfaceKey(face)

    if (!key) {
      return
    }

    const intervals = coverage.get(key) ?? []
    const interval = getWallFaceHorizontalInterval(face, wallsById)

    intervals.push(interval)
    coverage.set(key, intervals)
  })

  coverage.forEach((intervals, key) => {
    coverage.set(key, mergeWallFaceCoverageIntervals(intervals))
  })

  return coverage
}

function getMaterialWallSideKey(face: FloorWallSurfaceFace) {
  return face.materialSource.side
    ? `${face.materialSource.wallId}:${face.materialSource.side}`
    : null
}

function faceIsCoplanarWithWallSide(
  face: FloorWallSurfaceFace,
  wall: Wall,
  side: -1 | 1,
) {
  const normal = getWallNormal(wall)
  const sideNormal = {
    x: normal.x * side,
    y: normal.y * side,
  }
  const faceSideDot = face.normal[0] * sideNormal.x + face.normal[2] * sideNormal.y

  if (Math.abs(faceSideDot) < 0.98) {
    return false
  }

  const firstPoint = face.vertices[0].position
  const sidePlanePoint = {
    x: wall.start.x + sideNormal.x * wall.thickness / 2,
    y: wall.start.y + sideNormal.y * wall.thickness / 2,
  }
  const planeDistance = Math.abs(
    (firstPoint[0] - sidePlanePoint.x) * sideNormal.x +
      (firstPoint[2] - sidePlanePoint.y) * sideNormal.y,
  )

  return planeDistance <= 0.012
}

function getSideAttachmentCapCoverageByKey(
  faces: FloorWallSurfaceFace[],
  wallsById: Map<string, Wall>,
) {
  const coverage = new Map<string, WallFaceCoverageInterval[]>()

  faces.forEach((face) => {
    if (
      face.kind !== 'cap' ||
      face.materialSource.role === 'cap' ||
      !face.materialSource.side
    ) {
      return
    }

    const wall = wallsById.get(face.materialSource.wallId)
    const key = getMaterialWallSideKey(face)

    if (!wall || !key) {
      return
    }

    if (
      !faceIsCoplanarWithWallSide(
        face,
        wall,
        face.materialSource.side as 1 | -1,
      )
    ) {
      return
    }

    const intervals = coverage.get(key) ?? []

    intervals.push(getWallFaceHorizontalIntervalOnWall(face, wall))
    coverage.set(key, intervals)
  })

  coverage.forEach((intervals, key) => {
    coverage.set(key, mergeWallFaceCoverageIntervals(intervals))
  })

  return coverage
}

function subtractWallFaceCoverage(
  coverage: Map<string, WallFaceCoverageInterval[]>,
  key: string,
  face: FloorWallSurfaceFace,
  wallsById: Map<string, Wall>,
) {
  if (face.kind !== 'side') {
    return []
  }

  const interval = getWallFaceHorizontalInterval(face, wallsById)
  const coveredIntervals = coverage.get(key) ?? []
  let remainingIntervals = [interval]

  coveredIntervals.forEach((coveredInterval) => {
    remainingIntervals = remainingIntervals.flatMap((remainingInterval) => {
      if (
        coveredInterval.end <= remainingInterval.start + 0.01 ||
        coveredInterval.start >= remainingInterval.end - 0.01
      ) {
        return [remainingInterval]
      }

      return [
        {
          end: Math.min(coveredInterval.start, remainingInterval.end),
          start: remainingInterval.start,
        },
        {
          end: remainingInterval.end,
          start: Math.max(coveredInterval.end, remainingInterval.start),
        },
      ].filter((nextInterval) => nextInterval.end > nextInterval.start + 0.01)
    })
  })

  return remainingIntervals
}

function interpolateWallFaceVertex(
  firstVertex: FloorWallSurfaceFace['vertices'][number],
  secondVertex: FloorWallSurfaceFace['vertices'][number],
  distanceValue: number,
) {
  const firstDistance = firstVertex.uv[0]
  const secondDistance = secondVertex.uv[0]
  const denominator = secondDistance - firstDistance
  const t =
    Math.abs(denominator) > 0.000001
      ? (distanceValue - firstDistance) / denominator
      : 0

  return {
    position: [
      firstVertex.position[0] +
        (secondVertex.position[0] - firstVertex.position[0]) * t,
      firstVertex.position[1] +
        (secondVertex.position[1] - firstVertex.position[1]) * t,
      firstVertex.position[2] +
        (secondVertex.position[2] - firstVertex.position[2]) * t,
    ] as [number, number, number],
    uv: [
      distanceValue,
      firstVertex.uv[1] + (secondVertex.uv[1] - firstVertex.uv[1]) * t,
    ] as [number, number],
  }
}

function clipWallSideFaceToInterval(
  face: FloorWallSurfaceFace,
  interval: WallFaceCoverageInterval,
  index: number,
  wallsById: Map<string, Wall>,
): FloorWallSurfaceFace {
  const sourceInterval = getWallFaceHorizontalInterval(face, wallsById)

  if (
    interval.start <= sourceInterval.start + 0.001 &&
    interval.end >= sourceInterval.end - 0.001
  ) {
    return face
  }

  const [bottomStart, bottomEnd, topEnd, topStart] = face.vertices

  return {
    ...face,
    faceId: `${face.faceId}:uncovered:${index}:${interval.start.toFixed(3)}:${interval.end.toFixed(3)}`,
    vertices: [
      interpolateWallFaceVertex(bottomStart, bottomEnd, interval.start),
      interpolateWallFaceVertex(bottomStart, bottomEnd, interval.end),
      interpolateWallFaceVertex(topStart, topEnd, interval.end),
      interpolateWallFaceVertex(topStart, topEnd, interval.start),
    ],
  }
}

function subtractRoomSurfaceCoverageFromFace(
  coverage: Map<string, WallFaceCoverageInterval[]>,
  face: FloorWallSurfaceFace,
  wallsById: Map<string, Wall>,
) {
  const faceKey = getRoomSurfaceKey(face)

  if (!faceKey) {
    return [face]
  }

  if (face.kind !== 'side') {
    return coverage.has(faceKey) ? [] : [face]
  }

  return subtractWallFaceCoverage(coverage, faceKey, face, wallsById).map(
    (interval, index) =>
      clipWallSideFaceToInterval(face, interval, index, wallsById),
  )
}

function subtractSideAttachmentCapCoverageFromRoomSurfaceFace(
  coverage: Map<string, WallFaceCoverageInterval[]>,
  face: FloorWallSurfaceFace,
  wallsById: Map<string, Wall>,
) {
  const faceKey = getRoomSurfaceKey(face)

  if (!faceKey || face.materialSource.role !== 'room-surface') {
    return [face]
  }

  return subtractWallFaceCoverage(coverage, faceKey, face, wallsById).map(
    (interval, index) =>
      clipWallSideFaceToInterval(face, interval, index, wallsById),
  )
}

function dotWallFaceNormals(
  firstFace: FloorWallSurfaceFace,
  secondFace: FloorWallSurfaceFace,
) {
  return (
    firstFace.normal[0] * secondFace.normal[0] +
    firstFace.normal[1] * secondFace.normal[1] +
    firstFace.normal[2] * secondFace.normal[2]
  )
}

function getFaceVerticalBounds(face: FloorWallSurfaceFace) {
  const yValues = face.vertices.map((vertex) => vertex.position[1])

  return {
    max: Math.max(...yValues),
    min: Math.min(...yValues),
  }
}

function facePlaneDistance(
  firstFace: FloorWallSurfaceFace,
  secondFace: FloorWallSurfaceFace,
) {
  const firstPoint = firstFace.vertices[0].position
  const secondPoint = secondFace.vertices[0].position

  return Math.abs(
    (firstPoint[0] - secondPoint[0]) * secondFace.normal[0] +
      (firstPoint[1] - secondPoint[1]) * secondFace.normal[1] +
      (firstPoint[2] - secondPoint[2]) * secondFace.normal[2],
  )
}

function structuralFaceOverlapsRoomSurfaceFace(
  structuralFace: FloorWallSurfaceFace,
  roomSurfaceFace: FloorWallSurfaceFace,
  wallsById: Map<string, Wall>,
) {
  if (
    structuralFace.kind === 'cap' ||
    structuralFace.materialSource.role === 'cap'
  ) {
    return false
  }

  if (roomSurfaceFace.materialSource.role !== 'room-surface') {
    return false
  }

  if (Math.abs(dotWallFaceNormals(structuralFace, roomSurfaceFace)) < 0.98) {
    return false
  }

  if (facePlaneDistance(structuralFace, roomSurfaceFace) > 0.012) {
    return false
  }

  const structuralVerticalBounds = getFaceVerticalBounds(structuralFace)
  const surfaceVerticalBounds = getFaceVerticalBounds(roomSurfaceFace)

  if (
    structuralVerticalBounds.max <= surfaceVerticalBounds.min + 0.01 ||
    structuralVerticalBounds.min >= surfaceVerticalBounds.max - 0.01
  ) {
    return false
  }

  const wall = wallsById.get(roomSurfaceFace.wallId)

  if (!wall) {
    return false
  }

  const structuralInterval = getWallFaceHorizontalIntervalOnWall(
    structuralFace,
    wall,
  )
  const surfaceInterval = getWallFaceHorizontalIntervalOnWall(roomSurfaceFace, wall)

  return (
    structuralInterval.end > surfaceInterval.start + 0.01 &&
    structuralInterval.start < surfaceInterval.end - 0.01
  )
}

function structuralFaceOverlapsAnyRoomSurfaceFace(
  structuralFace: FloorWallSurfaceFace,
  roomSurfaceFaces: FloorWallSurfaceFace[],
  wallsById: Map<string, Wall>,
) {
  return roomSurfaceFaces.some((roomSurfaceFace) =>
    structuralFaceOverlapsRoomSurfaceFace(
      structuralFace,
      roomSurfaceFace,
      wallsById,
    ),
  )
}

function capIsCoplanarWithTargetWallSide(
  face: FloorWallSurfaceFace,
  targetWall: Wall,
  side: -1 | 1,
) {
  const normal = getWallNormal(targetWall)
  const sideNormal = {
    x: normal.x * side,
    y: normal.y * side,
  }
  const normalDot = face.normal[0] * sideNormal.x + face.normal[2] * sideNormal.y

  if (Math.abs(normalDot) < 0.98) {
    return false
  }

  const firstPoint = face.vertices[0].position
  const sidePlanePoint = {
    x: targetWall.start.x + sideNormal.x * targetWall.thickness / 2,
    y: targetWall.start.y + sideNormal.y * targetWall.thickness / 2,
  }
  const planeDistance = Math.abs(
    (firstPoint[0] - sidePlanePoint.x) * sideNormal.x +
      (firstPoint[2] - sidePlanePoint.y) * sideNormal.y,
  )

  return planeDistance <= 0.012
}

function wallDirectionsArePerpendicular(firstWall: Wall, secondWall: Wall) {
  const firstLength = distance(firstWall.start, firstWall.end)
  const secondLength = distance(secondWall.start, secondWall.end)

  if (firstLength <= 0.000001 || secondLength <= 0.000001) {
    return false
  }

  const firstDirection = {
    x: (firstWall.end.x - firstWall.start.x) / firstLength,
    y: (firstWall.end.y - firstWall.start.y) / firstLength,
  }
  const secondDirection = {
    x: (secondWall.end.x - secondWall.start.x) / secondLength,
    y: (secondWall.end.y - secondWall.start.y) / secondLength,
  }

  return Math.abs(
    firstDirection.x * secondDirection.x +
      firstDirection.y * secondDirection.y,
  ) <= 0.08
}

function sideAttachmentCapIsCoveredByRoomSurface(
  face: FloorWallSurfaceFace,
  roomSurfaceFaces: FloorWallSurfaceFace[],
  wallsById: Map<string, Wall>,
) {
  if (
    face.kind !== 'cap' ||
    face.materialSource.role === 'cap' ||
    !face.materialSource.side
  ) {
    return false
  }

  const sourceWall = wallsById.get(face.wallId)
  const targetWall = wallsById.get(face.materialSource.wallId)

  if (!sourceWall || !targetWall) {
    return false
  }

  if (sourceWall.kind === 'internal' && targetWall.kind === 'external') {
    return false
  }

  if (!wallDirectionsArePerpendicular(sourceWall, targetWall)) {
    return false
  }

  if (sourceWall.kind === 'internal' && targetWall.kind === 'internal') {
    return roomSurfaceFaces.some(
      (roomSurfaceFace) =>
        roomSurfaceFace.materialSource.role === 'room-surface' &&
        roomSurfaceFace.wallId === targetWall.id,
    )
  }

  return (
    capIsCoplanarWithTargetWallSide(
      face,
      targetWall,
      face.materialSource.side as -1 | 1,
    ) &&
    roomSurfaceFaces.some(
      (roomSurfaceFace) =>
        roomSurfaceFace.materialSource.role === 'room-surface' &&
        roomSurfaceFace.wallId === targetWall.id &&
        Math.abs(dotWallFaceNormals(face, roomSurfaceFace)) > 0.98 &&
        facePlaneDistance(face, roomSurfaceFace) <= 0.012,
    )
  )
}

export function buildFloorWallSurfaceFaces({
  contextRenderedWalls,
  externalFootprintWallIds,
  renderedWalls,
  roomSurfaceRendererEnabled = true,
  rooms,
  useWallBodyPerimeterMesh = false,
}: FloorWallSurfaceMeshOptions): FloorWallSurfaceFace[] {
  const walls = renderedWalls.map((renderedWall) => renderedWall.wall)
  const contextWalls = (contextRenderedWalls ?? renderedWalls).map(
    (renderedWall) => renderedWall.wall,
  )
  const renderedWallIdSet = new Set(walls.map((wall) => wall.id))
  const wallsById = new Map(contextWalls.map((wall) => [wall.id, wall]))
  const roomSurfaceSpans = roomSurfaceRendererEnabled
    ? buildRoomSurfaceFaceSpans({
        requireCompleteRoomPlans: true,
        renderedWalls: contextRenderedWalls ?? renderedWalls,
        rooms,
      })
    : []
  const rawRoomSurfaceFaces = roomSurfaceRendererEnabled
    ? buildRoomSurfaceWallFacesFromSpans({
        renderedWalls: contextRenderedWalls ?? renderedWalls,
        spans: roomSurfaceSpans,
      })
    : []
  const roomSurfaceKeys = new Set(
    rawRoomSurfaceFaces
      .map(getRoomSurfaceKey)
      .filter((key): key is string => Boolean(key)),
  )
  const structuralFaces = (useWallBodyPerimeterMesh
    ? buildWallBodyPerimeterMeshFaces(walls)
    : buildWallMeshFaces(contextWalls, {
        omitEndpointJoinSideFacesForWallIds:
          externalFootprintWallIds && externalFootprintWallIds.size > 0
            ? externalFootprintWallIds
            : undefined,
      })
  ).filter((face) => renderedWallIdSet.has(face.wallId))

  if (useWallBodyPerimeterMesh) {
    return structuralFaces
  }

  const sideAttachmentCapCoverage = getSideAttachmentCapCoverageByKey(
    structuralFaces,
    wallsById,
  )
  const roomSurfaceFaces = rawRoomSurfaceFaces.flatMap((face) =>
    subtractSideAttachmentCapCoverageFromRoomSurfaceFace(
      sideAttachmentCapCoverage,
      face,
      wallsById,
    ),
  )
  const roomSurfaceCoverage = getWallFaceCoverageByKey(roomSurfaceFaces, wallsById)

  if (!roomSurfaceRendererEnabled || roomSurfaceKeys.size === 0) {
    return structuralFaces
  }

  return [
    ...structuralFaces.flatMap((face) =>
      sideAttachmentCapIsCoveredByRoomSurface(
        face,
        roomSurfaceFaces,
        wallsById,
      ) ||
      structuralFaceOverlapsAnyRoomSurfaceFace(
        face,
        roomSurfaceFaces,
        wallsById,
      )
        ? []
        : subtractRoomSurfaceCoverageFromFace(
            roomSurfaceCoverage,
            face,
            wallsById,
          ),
    ),
    ...roomSurfaceFaces,
  ]
}
