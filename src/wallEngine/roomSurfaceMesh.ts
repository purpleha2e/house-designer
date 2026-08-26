import type { Point, Wall } from '../types.ts'
import type { RenderedWall } from '../wallGeometry.ts'
import type { DetectedRoom } from '../wallTopology.ts'
import { buildWallGraph } from './wallGraph.ts'
import type { WallMeshFace, WallMeshVertex } from './wallMesh.ts'
import type { WallSide } from './wallGraph.ts'

const MATCH_EPSILON_METERS = 0.025
const MIN_FACE_LENGTH_METERS = 0.01
const PARALLEL_DOT_THRESHOLD = 0.98
const CORNER_GAP_MIN_MAX_LENGTH_METERS = 0.12
const GAP_KEY_EPSILON_METERS = MATCH_EPSILON_METERS

export type RoomWallSurfaceSegment = {
  edgeEndDistance: number
  edgeIndex: number
  edgeStartDistance: number
  endPoint: Point
  normal: Point
  roomSignature: string
  side: WallSide
  startPoint: Point
  wall: Wall
}

export type RoomWallSurfaceGap = {
  edgeEndDistance: number
  edgeIndex: number
  edgeStartDistance: number
  endPoint: Point
  reason: 'corner' | 'duplicate' | 'unmatched'
  roomSignature: string
  startPoint: Point
}

export type RoomWallSurfacePlan = {
  gaps: RoomWallSurfaceGap[]
  room: DetectedRoom
  segments: RoomWallSurfaceSegment[]
}

export type RoomWallSurfaceRenderEntry =
  | {
      afterSegment: RoomWallSurfaceSegment
      beforeSegment: RoomWallSurfaceSegment
      edgeEndDistance: number
      edgeIndex: number
      edgeStartDistance: number
      gap: RoomWallSurfaceGap
      materialSegment: RoomWallSurfaceSegment
      type: 'corner'
    }
  | {
      edgeEndDistance: number
      edgeIndex: number
      edgeStartDistance: number
      segment: RoomWallSurfaceSegment
      type: 'segment'
    }

export type RoomWallSurfaceRenderPlan = {
  entries: RoomWallSurfaceRenderEntry[]
  problems: RoomWallSurfaceGap[]
  room: DetectedRoom
  suppressedDuplicates: RoomWallSurfaceGap[]
}

function distance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getWallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

function getWallDirection(wall: Wall) {
  const length = getWallLength(wall)

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

function getWallSideNormal(wall: Wall, side: WallSide) {
  const normal = getWallNormal(wall)

  return {
    x: normal.x * side,
    y: normal.y * side,
  }
}

function getRenderedWallEndpoint(renderedWall: RenderedWall, endpoint: 'end' | 'start') {
  const direction = getWallDirection(renderedWall.wall)
  const extension =
    endpoint === 'start' ? -renderedWall.startExtension : renderedWall.endExtension
  const sourcePoint = renderedWall.wall[endpoint]

  return {
    x: sourcePoint.x + direction.x * extension,
    y: sourcePoint.y + direction.y * extension,
  }
}

function getWallSideLine(renderedWall: RenderedWall, side: WallSide) {
  const normal = getWallNormal(renderedWall.wall)
  const offset = renderedWall.wall.thickness * side / 2
  const start = getRenderedWallEndpoint(renderedWall, 'start')
  const end = getRenderedWallEndpoint(renderedWall, 'end')

  return {
    end: {
      x: end.x + normal.x * offset,
      y: end.y + normal.y * offset,
    },
    start: {
      x: start.x + normal.x * offset,
      y: start.y + normal.y * offset,
    },
  }
}

function getProjectionDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return 0
  }

  return ((point.x - start.x) * dx + (point.y - start.y) * dy) / Math.sqrt(lengthSquared)
}

function getPointAtDistance(start: Point, end: Point, distanceAlongLine: number) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return start
  }

  return {
    x: start.x + (dx / length) * distanceAlongLine,
    y: start.y + (dy / length) * distanceAlongLine,
  }
}

function getDistanceToLine(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return distance(point, start)
  }

  return Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / length
}

function getSegmentIntersection(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point) {
  const firstDx = firstEnd.x - firstStart.x
  const firstDy = firstEnd.y - firstStart.y
  const secondDx = secondEnd.x - secondStart.x
  const secondDy = secondEnd.y - secondStart.y
  const denominator = firstDx * secondDy - firstDy * secondDx

  if (Math.abs(denominator) <= 0.000001) {
    return null
  }

  const startDx = secondStart.x - firstStart.x
  const startDy = secondStart.y - firstStart.y
  const firstT = (startDx * secondDy - startDy * secondDx) / denominator
  const secondT = (startDx * firstDy - startDy * firstDx) / denominator

  if (
    firstT <= MIN_FACE_LENGTH_METERS ||
    firstT >= 1 - MIN_FACE_LENGTH_METERS ||
    secondT < -MIN_FACE_LENGTH_METERS ||
    secondT > 1 + MIN_FACE_LENGTH_METERS
  ) {
    return null
  }

  return {
    point: {
      x: firstStart.x + firstDx * firstT,
      y: firstStart.y + firstDy * firstT,
    },
    t: firstT,
  }
}

function toVertex(point: Point, y: number, uv: [number, number]): WallMeshVertex {
  return {
    position: [point.x, y, point.y],
    uv,
  }
}

function cleanZero(value: number) {
  return Object.is(value, -0) ? 0 : value
}

function getDistanceAlongWall(wall: Wall, point: Point) {
  const direction = getWallDirection(wall)

  return (
    (point.x - wall.start.x) * direction.x +
    (point.y - wall.start.y) * direction.y
  )
}

function getWorldUvDirection(wall: Wall) {
  const direction = getWallDirection(wall)

  if (
    direction.x < -MATCH_EPSILON_METERS ||
    (Math.abs(direction.x) <= MATCH_EPSILON_METERS &&
      direction.y < -MATCH_EPSILON_METERS)
  ) {
    return {
      x: -direction.x,
      y: -direction.y,
    }
  }

  return direction
}

function getWorldUvDistance(wall: Wall, point: Point) {
  const direction = getWorldUvDirection(wall)

  return point.x * direction.x + point.y * direction.y
}

function getWallOpeningRects(wall: Wall) {
  const length = getWallLength(wall)

  return (wall.openings ?? [])
    .map((opening) => {
      const left = Math.max(0, opening.center - opening.width / 2)
      const right = Math.min(length, opening.center + opening.width / 2)
      const bottom = Math.max(0, Math.min(wall.height, opening.bottom))
      const top = Math.max(
        bottom,
        Math.min(wall.height, opening.bottom + opening.height),
      )

      return right > left + MIN_FACE_LENGTH_METERS &&
        top > bottom + MIN_FACE_LENGTH_METERS
        ? {
            bottom,
            id: opening.id,
            left,
            right,
            top,
          }
        : null
    })
    .filter(
      (
        opening,
      ): opening is {
        bottom: number
        id: string
        left: number
        right: number
        top: number
      } => Boolean(opening),
    )
}

function findMatchingWallSideSegments(
  start: Point,
  end: Point,
  renderedWalls: RenderedWall[],
) {
  const edgeLength = distance(start, end)

  if (edgeLength <= MIN_FACE_LENGTH_METERS) {
    return []
  }

  const edgeDirection = {
    x: (end.x - start.x) / edgeLength,
    y: (end.y - start.y) / edgeLength,
  }

  const matches: {
    distanceToSide: number
    edgeEndDistance: number
    edgeStartDistance: number
    endPoint: Point
    renderedWall: RenderedWall
    side: WallSide
    startPoint: Point
  }[] = []

  for (const renderedWall of renderedWalls) {
    const wallDirection = getWallDirection(renderedWall.wall)
    const parallelDot = Math.abs(
      edgeDirection.x * wallDirection.x + edgeDirection.y * wallDirection.y,
    )

    if (parallelDot < PARALLEL_DOT_THRESHOLD) {
      continue
    }

    for (const side of [-1, 1] as const) {
      const sideLine = getWallSideLine(renderedWall, side)
      const sideLength = distance(sideLine.start, sideLine.end)

      if (sideLength <= MIN_FACE_LENGTH_METERS) {
        continue
      }

      const startProjection = getProjectionDistance(start, sideLine.start, sideLine.end)
      const endProjection = getProjectionDistance(end, sideLine.start, sideLine.end)
      const minProjection = Math.min(startProjection, endProjection)
      const maxProjection = Math.max(startProjection, endProjection)

      const distanceToSide = Math.max(
        getDistanceToLine(start, sideLine.start, sideLine.end),
        getDistanceToLine(end, sideLine.start, sideLine.end),
      )

      if (distanceToSide > MATCH_EPSILON_METERS) {
        continue
      }

      const overlapStart = Math.max(0, minProjection)
      const overlapEnd = Math.min(sideLength, maxProjection)

      if (overlapEnd <= overlapStart + MIN_FACE_LENGTH_METERS) {
        continue
      }

      const sideStartPoint = getPointAtDistance(
        sideLine.start,
        sideLine.end,
        overlapStart,
      )
      const sideEndPoint = getPointAtDistance(
        sideLine.start,
        sideLine.end,
        overlapEnd,
      )
      const edgeStartDistance = getProjectionDistance(sideStartPoint, start, end)
      const edgeEndDistance = getProjectionDistance(sideEndPoint, start, end)

      if (
        Math.min(edgeStartDistance, edgeEndDistance) < -MATCH_EPSILON_METERS ||
        Math.max(edgeStartDistance, edgeEndDistance) > edgeLength + MATCH_EPSILON_METERS
      ) {
        continue
      }

      matches.push({
        distanceToSide,
        edgeEndDistance,
        edgeStartDistance,
        endPoint: edgeStartDistance <= edgeEndDistance ? sideEndPoint : sideStartPoint,
        renderedWall,
        side,
        startPoint: edgeStartDistance <= edgeEndDistance ? sideStartPoint : sideEndPoint,
      })
    }
  }

  return matches.sort(
    (first, second) =>
      Math.min(first.edgeStartDistance, first.edgeEndDistance) -
        Math.min(second.edgeStartDistance, second.edgeEndDistance) ||
      first.distanceToSide - second.distanceToSide ||
      first.renderedWall.wall.id.localeCompare(second.renderedWall.wall.id) ||
      first.side - second.side,
  )
}

function classifyCornerGaps({
  gaps,
  room,
  segments,
}: {
  gaps: RoomWallSurfaceGap[]
  room: DetectedRoom
  segments: RoomWallSurfaceSegment[]
}) {
  return gaps.map((gap) => {
    if (gap.reason !== 'unmatched') {
      return gap
    }

    const gapLength = gap.edgeEndDistance - gap.edgeStartDistance
    const touchesEdgeStart = gap.edgeStartDistance <= MATCH_EPSILON_METERS
    const touchesEdgeEnd =
      gap.edgeEndDistance >=
      distance(
        room.polygon[gap.edgeIndex],
        room.polygon[(gap.edgeIndex + 1) % room.polygon.length],
      ) -
        MATCH_EPSILON_METERS

    if (!touchesEdgeStart && !touchesEdgeEnd) {
      return gap
    }

    const previousSegment = findPreviousSegmentForGap(gap, segments)
    const nextSegment = findNextSegmentForGap(gap, segments)

    if (
      !previousSegment ||
      !nextSegment ||
      (previousSegment.wall.id === nextSegment.wall.id &&
        previousSegment.side === nextSegment.side)
    ) {
      return gap
    }

    const cornerGapMaxLength = Math.max(
      CORNER_GAP_MIN_MAX_LENGTH_METERS,
      previousSegment.wall.thickness,
      nextSegment.wall.thickness,
    ) + MATCH_EPSILON_METERS

    if (gapLength > cornerGapMaxLength) {
      return gap
    }

    return {
      ...gap,
      reason: 'corner' as const,
    }
  })
}

function findPreviousSegmentForGap(
  gap: RoomWallSurfaceGap,
  segments: RoomWallSurfaceSegment[],
) {
  const touchesEdgeStart = gap.edgeStartDistance <= MATCH_EPSILON_METERS

  return touchesEdgeStart
    ? segments
        .filter((segment) => segment.edgeIndex < gap.edgeIndex)
        .sort(
          (first, second) =>
            second.edgeIndex - first.edgeIndex ||
            second.edgeEndDistance - first.edgeEndDistance,
        )[0] ??
      [...segments]
        .sort(
          (first, second) =>
            second.edgeIndex - first.edgeIndex ||
            second.edgeEndDistance - first.edgeEndDistance,
        )[0] ??
      null
    : segments
        .filter(
          (segment) =>
            segment.edgeIndex === gap.edgeIndex &&
            segment.edgeEndDistance <= gap.edgeStartDistance + MATCH_EPSILON_METERS,
        )
        .sort((first, second) => second.edgeEndDistance - first.edgeEndDistance)[0] ??
      null
}

function findNextSegmentForGap(
  gap: RoomWallSurfaceGap,
  segments: RoomWallSurfaceSegment[],
) {
  const sameEdgeNextSegment =
    segments
      .filter(
        (segment) =>
          segment.edgeIndex === gap.edgeIndex &&
          segment.edgeStartDistance >= gap.edgeEndDistance - MATCH_EPSILON_METERS,
      )
      .sort((first, second) => first.edgeStartDistance - second.edgeStartDistance)[0] ??
    null

  return (
    sameEdgeNextSegment ??
    segments
      .filter((segment) => segment.edgeIndex > gap.edgeIndex)
      .sort(
        (first, second) =>
          first.edgeIndex - second.edgeIndex ||
          first.edgeStartDistance - second.edgeStartDistance,
      )[0] ??
    [...segments]
      .sort(
        (first, second) =>
          first.edgeIndex - second.edgeIndex ||
          first.edgeStartDistance - second.edgeStartDistance,
      )[0] ??
    null
  )
}

function pointKey(point: Point) {
  return `${Math.round(point.x / GAP_KEY_EPSILON_METERS)}:${Math.round(
    point.y / GAP_KEY_EPSILON_METERS,
  )}`
}

function gapGeometryKey(gap: RoomWallSurfaceGap) {
  return [pointKey(gap.startPoint), pointKey(gap.endPoint)].sort().join('>')
}

function classifyDuplicatePhysicalGaps(gaps: RoomWallSurfaceGap[]) {
  const seenGapKeys = new Set<string>()

  return gaps.map((gap) => {
    if (gap.reason !== 'unmatched') {
      return gap
    }

    const key = gapGeometryKey(gap)

    if (seenGapKeys.has(key)) {
      return {
        ...gap,
        reason: 'duplicate' as const,
      }
    }

    seenGapKeys.add(key)
    return gap
  })
}

export function getRoomSurfaceKey(face: WallMeshFace) {
  return face.materialSource.side
    ? `${face.wallId}:${face.materialSource.side}`
    : null
}

export function buildRoomWallSurfacePlans({
  renderedWalls,
  rooms,
}: {
  includeWallsWithOpenings?: boolean
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
}) {
  return rooms.map((room): RoomWallSurfacePlan => {
    const gaps: RoomWallSurfaceGap[] = []
    const segments: RoomWallSurfaceSegment[] = []

    for (const [edgeIndex, start] of room.polygon.entries()) {
      const end = room.polygon[(edgeIndex + 1) % room.polygon.length]
      const edgeLength = distance(start, end)

      if (edgeLength <= MIN_FACE_LENGTH_METERS) {
        continue
      }

      const matches = findMatchingWallSideSegments(start, end, renderedWalls)
      const intervals = matches
        .map((match) => ({
          ...match,
          endDistance: Math.min(
            edgeLength,
            Math.max(match.edgeStartDistance, match.edgeEndDistance),
          ),
          startDistance: Math.max(
            0,
            Math.min(match.edgeStartDistance, match.edgeEndDistance),
          ),
        }))
        .filter(
          (match) =>
            match.endDistance > match.startDistance + MIN_FACE_LENGTH_METERS,
        )
        .sort(
          (first, second) =>
            first.startDistance - second.startDistance ||
            first.distanceToSide - second.distanceToSide ||
            first.renderedWall.wall.id.localeCompare(second.renderedWall.wall.id),
        )
      let coveredUntil = 0

      intervals.forEach((match) => {
        if (match.startDistance > coveredUntil + MIN_FACE_LENGTH_METERS) {
          gaps.push({
            edgeEndDistance: match.startDistance,
            edgeIndex,
            edgeStartDistance: coveredUntil,
            endPoint: getPointAtDistance(start, end, match.startDistance),
            reason: 'unmatched',
            roomSignature: room.signature,
            startPoint: getPointAtDistance(start, end, coveredUntil),
          })
        }

        if (match.startDistance < coveredUntil - MATCH_EPSILON_METERS) {
          gaps.push({
            edgeEndDistance: Math.min(coveredUntil, match.endDistance),
            edgeIndex,
            edgeStartDistance: match.startDistance,
            endPoint: getPointAtDistance(
              start,
              end,
              Math.min(coveredUntil, match.endDistance),
            ),
            reason: 'duplicate',
            roomSignature: room.signature,
            startPoint: getPointAtDistance(start, end, match.startDistance),
          })
        }

        if (match.endDistance <= coveredUntil + MIN_FACE_LENGTH_METERS) {
          return
        }

        segments.push({
          edgeEndDistance: match.endDistance,
          edgeIndex,
          edgeStartDistance: Math.max(match.startDistance, coveredUntil),
          endPoint: getPointAtDistance(start, end, match.endDistance),
          normal: getWallSideNormal(match.renderedWall.wall, match.side),
          roomSignature: room.signature,
          side: match.side,
          startPoint: getPointAtDistance(
            start,
            end,
            Math.max(match.startDistance, coveredUntil),
          ),
          wall: match.renderedWall.wall,
        })
        coveredUntil = Math.max(coveredUntil, match.endDistance)
      })

      if (coveredUntil < edgeLength - MIN_FACE_LENGTH_METERS) {
        gaps.push({
          edgeEndDistance: edgeLength,
          edgeIndex,
          edgeStartDistance: coveredUntil,
          endPoint: end,
          reason: 'unmatched',
          roomSignature: room.signature,
          startPoint: getPointAtDistance(start, end, coveredUntil),
        })
      }
    }

    const cornerClassifiedGaps = classifyCornerGaps({
        gaps,
        room,
        segments,
      })

    return {
      gaps: classifyDuplicatePhysicalGaps(cornerClassifiedGaps),
      room,
      segments,
    }
  })
}

function compareRenderEntries(
  first: RoomWallSurfaceRenderEntry,
  second: RoomWallSurfaceRenderEntry,
) {
  return (
    first.edgeIndex - second.edgeIndex ||
    first.edgeStartDistance - second.edgeStartDistance ||
    first.edgeEndDistance - second.edgeEndDistance ||
    (first.type === 'segment' ? 0 : 1) -
      (second.type === 'segment' ? 0 : 1)
  )
}

export function buildRoomWallSurfaceRenderPlans(options: {
  includeWallsWithOpenings?: boolean
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
}) {
  return buildRoomWallSurfacePlans(options).map(
    (plan): RoomWallSurfaceRenderPlan => {
      const segmentEntries = plan.segments.map(
        (segment): RoomWallSurfaceRenderEntry => ({
          edgeEndDistance: segment.edgeEndDistance,
          edgeIndex: segment.edgeIndex,
          edgeStartDistance: segment.edgeStartDistance,
          segment,
          type: 'segment',
        }),
      )
      const cornerEntries = plan.gaps
        .filter((gap) => gap.reason === 'corner')
        .flatMap((gap): RoomWallSurfaceRenderEntry[] => {
          const beforeSegment = findPreviousSegmentForGap(gap, plan.segments)
          const afterSegment = findNextSegmentForGap(gap, plan.segments)

          if (!beforeSegment || !afterSegment) {
            return []
          }

          const materialSegment =
            gap.edgeStartDistance <= MATCH_EPSILON_METERS
              ? afterSegment
              : beforeSegment

          return [
            {
              afterSegment,
              beforeSegment,
              edgeEndDistance: gap.edgeEndDistance,
              edgeIndex: gap.edgeIndex,
              edgeStartDistance: gap.edgeStartDistance,
              gap,
              materialSegment,
              type: 'corner',
            },
          ]
        })

      return {
        entries: [...segmentEntries, ...cornerEntries].sort(compareRenderEntries),
        problems: plan.gaps.filter((gap) => gap.reason === 'unmatched'),
        room: plan.room,
        suppressedDuplicates: plan.gaps.filter(
          (gap) => gap.reason === 'duplicate',
        ),
      }
    },
  )
}

type RoomSurfaceFaceSpan = {
  edgeEndDistance: number
  edgeIndex: number
  edgeStartDistance: number
  endPoint: Point
  normal: Point
  roomSignature: string
  sourceSegment: RoomWallSurfaceSegment
  startPoint: Point
}

function getWallSideSplitDistances(walls: Wall[]) {
  const splitDistances = new Map<string, number[]>()
  const graph = buildWallGraph(walls)
  const addSplitDistance = (wallId: string, side: WallSide, distanceValue: number) => {
    const key = `${wallId}:${side}`
    const distances = splitDistances.get(key) ?? []

    distances.push(distanceValue)
    splitDistances.set(key, distances)
  }

  graph.sideAttachments.forEach((attachment) => {
    addSplitDistance(attachment.targetWallId, attachment.side, attachment.targetDistance)
  })

  walls.forEach((targetWall) => {
    const targetLength = getWallLength(targetWall)
    const targetDirection = getWallDirection(targetWall)
    const targetNormal = getWallNormal(targetWall)

    if (targetLength <= MIN_FACE_LENGTH_METERS) {
      return
    }

    walls
      .filter((wall) => wall.id !== targetWall.id)
      .forEach((wall) => {
        ;([wall.start, wall.end] as const).forEach((endpointPoint) => {
          const alongTarget =
            (endpointPoint.x - targetWall.start.x) * targetDirection.x +
            (endpointPoint.y - targetWall.start.y) * targetDirection.y

          if (
            alongTarget <= MIN_FACE_LENGTH_METERS ||
            alongTarget >= targetLength - MIN_FACE_LENGTH_METERS
          ) {
            return
          }

          const sideOffset =
            (endpointPoint.x - targetWall.start.x) * targetNormal.x +
            (endpointPoint.y - targetWall.start.y) * targetNormal.y
          const side = sideOffset >= 0 ? 1 : -1

          if (Math.abs(Math.abs(sideOffset) - targetWall.thickness / 2) > 0.04) {
            return
          }

          addSplitDistance(targetWall.id, side, alongTarget)
        })
      })

    ;([-1, 1] as const).forEach((side) => {
      const sideOffset = targetWall.thickness * side / 2
      const sideStart = {
        x: targetWall.start.x + targetNormal.x * sideOffset,
        y: targetWall.start.y + targetNormal.y * sideOffset,
      }
      const sideEnd = {
        x: targetWall.end.x + targetNormal.x * sideOffset,
        y: targetWall.end.y + targetNormal.y * sideOffset,
      }

      walls
        .filter((wall) => wall.id !== targetWall.id)
        .forEach((wall) => {
          const intersection = getSegmentIntersection(
            sideStart,
            sideEnd,
            wall.start,
            wall.end,
          )

          if (!intersection) {
            return
          }

          const alongTarget =
            (intersection.point.x - targetWall.start.x) * targetDirection.x +
            (intersection.point.y - targetWall.start.y) * targetDirection.y

          addSplitDistance(targetWall.id, side, alongTarget)
        })
    })
  })

  splitDistances.forEach((distances, key) => {
    splitDistances.set(
      key,
      distances
        .sort((first, second) => first - second)
        .filter(
          (distanceValue, index) =>
            index === 0 ||
            Math.abs(distanceValue - distances[index - 1]) > MIN_FACE_LENGTH_METERS,
        ),
    )
  })

  return splitDistances
}

function getRoomSurfaceFaceSpan(
  entry: RoomWallSurfaceRenderEntry,
): RoomSurfaceFaceSpan {
  if (entry.type === 'segment') {
    return {
      edgeEndDistance: entry.edgeEndDistance,
      edgeIndex: entry.edgeIndex,
      edgeStartDistance: entry.edgeStartDistance,
      endPoint: entry.segment.endPoint,
      normal: entry.segment.normal,
      roomSignature: entry.segment.roomSignature,
      sourceSegment: entry.segment,
      startPoint: entry.segment.startPoint,
    }
  }

  return {
    edgeEndDistance: entry.edgeEndDistance,
    edgeIndex: entry.edgeIndex,
    edgeStartDistance: entry.edgeStartDistance,
    endPoint: entry.gap.endPoint,
    normal: entry.materialSegment.normal,
    roomSignature: entry.gap.roomSignature,
    sourceSegment: entry.materialSegment,
    startPoint: entry.gap.startPoint,
  }
}

function canMergeRoomSurfaceFaceSpans(
  first: RoomSurfaceFaceSpan,
  second: RoomSurfaceFaceSpan,
) {
  const firstSource = first.sourceSegment
  const secondSource = second.sourceSegment
  const normalDot =
    first.normal.x * second.normal.x + first.normal.y * second.normal.y
  const firstStart = getRoomSurfaceSpanStartDistance(first)
  const firstEnd = getRoomSurfaceSpanEndDistance(first)
  const secondStart = getRoomSurfaceSpanStartDistance(second)
  const secondEnd = getRoomSurfaceSpanEndDistance(second)

  return (
    firstSource.wall.id === secondSource.wall.id &&
    firstSource.side === secondSource.side &&
    Math.abs(firstSource.wall.height - secondSource.wall.height) <=
      MATCH_EPSILON_METERS &&
    normalDot > PARALLEL_DOT_THRESHOLD &&
    secondStart <= firstEnd + MATCH_EPSILON_METERS &&
    secondEnd >= firstStart - MATCH_EPSILON_METERS
  )
}

function getRoomSurfaceSpanStartDistance(span: RoomSurfaceFaceSpan) {
  return getDistanceAlongWall(span.sourceSegment.wall, span.startPoint)
}

function getRoomSurfaceSpanEndDistance(span: RoomSurfaceFaceSpan) {
  return getDistanceAlongWall(span.sourceSegment.wall, span.endPoint)
}

function compareRoomSurfaceFaceSpans(
  first: RoomSurfaceFaceSpan,
  second: RoomSurfaceFaceSpan,
) {
  return (
    first.sourceSegment.wall.id.localeCompare(second.sourceSegment.wall.id) ||
    first.sourceSegment.side - second.sourceSegment.side ||
    getRoomSurfaceSpanStartDistance(first) -
      getRoomSurfaceSpanStartDistance(second) ||
    getRoomSurfaceSpanEndDistance(first) - getRoomSurfaceSpanEndDistance(second)
  )
}

function normalizeRoomSurfaceFaceSpan(span: RoomSurfaceFaceSpan) {
  const startDistance = getRoomSurfaceSpanStartDistance(span)
  const endDistance = getRoomSurfaceSpanEndDistance(span)

  if (startDistance <= endDistance) {
    return span
  }

  return {
    ...span,
    edgeEndDistance: span.edgeStartDistance,
    edgeStartDistance: span.edgeEndDistance,
    endPoint: span.startPoint,
    startPoint: span.endPoint,
  }
}

function mergeRoomSurfaceFaceSpans(spans: RoomSurfaceFaceSpan[]) {
  return spans
    .map(normalizeRoomSurfaceFaceSpan)
    .sort(compareRoomSurfaceFaceSpans)
    .reduce<RoomSurfaceFaceSpan[]>((mergedSpans, span) => {
      const previousSpan = mergedSpans[mergedSpans.length - 1]

      if (previousSpan && canMergeRoomSurfaceFaceSpans(previousSpan, span)) {
        const previousEnd = getRoomSurfaceSpanEndDistance(previousSpan)
        const spanEnd = getRoomSurfaceSpanEndDistance(span)

        mergedSpans[mergedSpans.length - 1] = {
          ...previousSpan,
          edgeEndDistance:
            spanEnd > previousEnd
              ? span.edgeEndDistance
              : previousSpan.edgeEndDistance,
          endPoint: spanEnd > previousEnd ? span.endPoint : previousSpan.endPoint,
        }
        return mergedSpans
      }

      mergedSpans.push(span)
      return mergedSpans
    }, [])
}

function buildRoomSurfaceFaceQuad({
  endPoint,
  endUv,
  faceId,
  normal,
  source,
  startPoint,
  startUv,
  wall,
  yBottom,
  yTop,
}: {
  endPoint: Point
  endUv: number
  faceId: string
  normal: Point
  source: { role: 'room-surface'; side: WallSide; wallId: string }
  startPoint: Point
  startUv: number
  wall: Wall
  yBottom: number
  yTop: number
}) {
  const wallSideSource = {
    side: source.side,
    wallId: source.wallId,
  }

  return {
    faceId,
    kind: 'side',
    materialSource: source,
    normal: [
      cleanZero(normal.x),
      0,
      cleanZero(normal.y),
    ] as [number, number, number],
    pickSource: wallSideSource,
    uvSource: wallSideSource,
    vertices: [
      toVertex(startPoint, yBottom, [startUv, yBottom]),
      toVertex(endPoint, yBottom, [endUv, yBottom]),
      toVertex(endPoint, yTop, [endUv, yTop]),
      toVertex(startPoint, yTop, [startUv, yTop]),
    ],
    wallId: wall.id,
  } satisfies WallMeshFace
}

function buildRoomSurfaceFacesFromSpan(
  span: RoomSurfaceFaceSpan,
  index: number,
  splitDistancesByWallSide: Map<string, number[]>,
) {
  const { sourceSegment } = span
  const startDistance = getDistanceAlongWall(sourceSegment.wall, span.startPoint)
  const endDistance = getDistanceAlongWall(sourceSegment.wall, span.endPoint)
  const firstPoint =
    startDistance <= endDistance ? span.startPoint : span.endPoint
  const secondPoint =
    startDistance <= endDistance ? span.endPoint : span.startPoint
  const firstDistance = Math.min(startDistance, endDistance)
  const secondDistance = Math.max(startDistance, endDistance)
  const source = {
    role: 'room-surface' as const,
    side: sourceSegment.side,
    wallId: sourceSegment.wall.id,
  }
  const splitDistances =
    splitDistancesByWallSide.get(`${sourceSegment.wall.id}:${sourceSegment.side}`) ?? []
  const endpointSplitBuffer = Math.max(
    MIN_FACE_LENGTH_METERS,
    sourceSegment.wall.thickness * 0.55,
  )
  const spanSplitDistances = splitDistances.filter(
    (distanceValue) =>
      distanceValue > firstDistance + endpointSplitBuffer &&
      distanceValue < secondDistance - endpointSplitBuffer,
  )
  const openings = getWallOpeningRects(sourceSegment.wall).filter(
    (opening) =>
      opening.left < secondDistance - MIN_FACE_LENGTH_METERS &&
      opening.right > firstDistance + MIN_FACE_LENGTH_METERS,
  )

  const xBreaks = [
    firstDistance,
    secondDistance,
    ...spanSplitDistances,
    ...openings.flatMap((opening) => [
      Math.max(firstDistance, opening.left),
      Math.min(secondDistance, opening.right),
    ]),
  ]
    .filter(
      (value) =>
        value >= firstDistance - MIN_FACE_LENGTH_METERS &&
        value <= secondDistance + MIN_FACE_LENGTH_METERS,
    )
    .sort((first, second) => first - second)
  const uniqueXBreaks = xBreaks.filter(
    (value, breakIndex) =>
      breakIndex === 0 ||
      Math.abs(value - xBreaks[breakIndex - 1]) > MIN_FACE_LENGTH_METERS,
  )
  const direction = {
    x: (secondPoint.x - firstPoint.x) / Math.max(secondDistance - firstDistance, 0.001),
    y: (secondPoint.y - firstPoint.y) / Math.max(secondDistance - firstDistance, 0.001),
  }
  const faces: WallMeshFace[] = []

  uniqueXBreaks.slice(0, -1).forEach((xStart, xIndex) => {
    const xEnd = uniqueXBreaks[xIndex + 1]

    if (xEnd <= xStart + MIN_FACE_LENGTH_METERS) {
      return
    }

    const midpointDistance = (xStart + xEnd) / 2
    const overlappingOpenings = openings.filter(
      (opening) =>
        opening.left < xEnd - MIN_FACE_LENGTH_METERS &&
        opening.right > xStart + MIN_FACE_LENGTH_METERS,
    )
    const yBreaks = [
      0,
      sourceSegment.wall.height,
      ...overlappingOpenings.flatMap((opening) => [
        opening.bottom,
        opening.top,
      ]),
    ]
      .filter(
        (value) =>
          value >= -MIN_FACE_LENGTH_METERS &&
          value <= sourceSegment.wall.height + MIN_FACE_LENGTH_METERS,
      )
      .sort((first, second) => first - second)
    const uniqueYBreaks = yBreaks.filter(
      (value, breakIndex) =>
        breakIndex === 0 ||
        Math.abs(value - yBreaks[breakIndex - 1]) > MIN_FACE_LENGTH_METERS,
    )
    const subStartPoint = {
      x: firstPoint.x + direction.x * (xStart - firstDistance),
      y: firstPoint.y + direction.y * (xStart - firstDistance),
    }
    const subEndPoint = {
      x: firstPoint.x + direction.x * (xEnd - firstDistance),
      y: firstPoint.y + direction.y * (xEnd - firstDistance),
    }

    uniqueYBreaks.slice(0, -1).forEach((yBottom, yIndex) => {
      const yTop = uniqueYBreaks[yIndex + 1]

      if (yTop <= yBottom + MIN_FACE_LENGTH_METERS) {
        return
      }

      const midpointY = (yBottom + yTop) / 2
      const isInsideOpening = overlappingOpenings.some(
        (opening) =>
          midpointDistance > opening.left + MIN_FACE_LENGTH_METERS &&
          midpointDistance < opening.right - MIN_FACE_LENGTH_METERS &&
          midpointY > opening.bottom + MIN_FACE_LENGTH_METERS &&
          midpointY < opening.top - MIN_FACE_LENGTH_METERS,
      )

      if (isInsideOpening) {
        return
      }

      faces.push(
        buildRoomSurfaceFaceQuad({
          endPoint: subEndPoint,
          endUv: getWorldUvDistance(sourceSegment.wall, subEndPoint),
          faceId: `room-surface:${span.roomSignature}:${sourceSegment.wall.id}:${sourceSegment.side}:${span.edgeIndex}:${index}:${xStart.toFixed(3)}:${xEnd.toFixed(3)}:${yBottom.toFixed(3)}:${yTop.toFixed(3)}:${xIndex}:${yIndex}`,
          normal: span.normal,
          source,
          startPoint: subStartPoint,
          startUv: getWorldUvDistance(sourceSegment.wall, subStartPoint),
          wall: sourceSegment.wall,
          yBottom,
          yTop,
        }),
      )
    })
  })

  return faces
}

export function buildRoomSurfaceWallFaces(options: {
  includeWallsWithOpenings?: boolean
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
}) {
  const splitDistancesByWallSide = getWallSideSplitDistances(
    options.renderedWalls.map((renderedWall) => renderedWall.wall),
  )
  const spans = buildRoomWallSurfaceRenderPlans(options).flatMap((plan) =>
    plan.entries.map((entry) =>
      getRoomSurfaceFaceSpan(entry),
    ),
  )

  return mergeRoomSurfaceFaceSpans(spans).flatMap((span, index) =>
    buildRoomSurfaceFacesFromSpan(span, index, splitDistancesByWallSide),
  )
}
