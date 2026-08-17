import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { FloorLevel, Point, Wall, WallKind } from '../types'
import { getRenderedWalls, getWallPolygon } from '../wallGeometry'

const METERS_TO_PIXELS = 60
const MIN_WALL_LENGTH_METERS = 0.15
const CONNECTION_SNAP_METERS = 0.25
const WALL_JOIN_EPSILON_METERS = 0.03
const ALIGNMENT_GUIDE_TOLERANCE_METERS = 0.5
const DIMENSION_OFFSET_METERS = 0.28
const DIMENSION_TICK_METERS = 0.1
const MIN_ZOOM = 0.45
const MAX_ZOOM = 4
const ZOOM_STEP = 1.2
const ANGLE_WIDGET_RADIUS_METERS = 0.65
const SNAP_MARKER_INNER_RADIUS = 3
const SNAP_MARKER_OUTER_RADIUS = 9
const DRAFT_EXTERNAL_WALL_THICKNESS = 0.3
const DRAFT_INTERNAL_WALL_THICKNESS = 0.15

type FloorplanCanvasProps = {
  activeFloor: FloorLevel
  floors: FloorLevel[]
  isAddingWall: boolean
  selectedWallId: string | null
  wallKind: WallKind
  onAddWall: (wall: { start: Point; end: Point }) => void
  onDeleteWall: (wallId: string) => void
  onExitAddWall: () => void
  onSelectWall: (wallId: string | null) => void
}

type CanvasSize = {
  width: number
  height: number
}

type Viewport = {
  x: number
  y: number
  scale: number
}

type ContextMenuState = {
  wallId: string
  x: number
  y: number
}

type PanState = {
  clientX: number
  clientY: number
}

type SnapTarget = {
  point: Point
  kind: 'endpoint' | 'junction'
  label?: string
}

type SnapSegment = {
  start: Point
  end: Point
  endpointsOnly?: boolean
  label?: string
}

type EndpointGuide = {
  endpoint: Point
  projection: Point
  distance: number
  crossDistance: number
}

type AlignmentAxis = 'x' | 'y'

type AlignmentGuide = EndpointGuide & {
  axis: AlignmentAxis
}

type Axis = 'horizontal' | 'vertical'

type DimensionGuide = {
  start: Point
  end: Point
  faceStart: Point
  faceEnd: Point
  labelPoint: Point
  tickMode: 'connector' | 'cross'
  text: string
  rotation: number
}

type DimensionCandidate = DimensionGuide & {
  blockerCount: number
  segmentEnd: number
  segmentStart: number
  side: -1 | 1
}

type AngleWidget = {
  arcPoints: number[]
  baselineEnd: Point
  labelPoint: Point
  label: string
}

function toCanvasPoint(point: Point): Point {
  return {
    x: point.x * METERS_TO_PIXELS,
    y: point.y * METERS_TO_PIXELS,
  }
}

function toPlanPoint(point: Point): Point {
  return {
    x: point.x / METERS_TO_PIXELS,
    y: point.y / METERS_TO_PIXELS,
  }
}

function distance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function parseLengthInput(value: string) {
  const length = Number.parseFloat(value)
  return Number.isFinite(length) && length > 0 ? length : null
}

function parseAngleInput(value: string) {
  const angle = Number.parseFloat(value)
  return Number.isFinite(angle) ? angle : null
}

function getAngleDegrees(start: Point, end: Point) {
  return (normalizeAngle(Math.atan2(end.y - start.y, end.x - start.x)) * 180) /
    Math.PI
}

function getDraftWallThickness(wallKind: WallKind) {
  return wallKind === 'external'
    ? DRAFT_EXTERNAL_WALL_THICKNESS
    : DRAFT_INTERNAL_WALL_THICKNESS
}

function normalize(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return { x: 0, y: 0 }
  }

  return { x: dx / length, y: dy / length }
}

function getEndpointDirectionFrom(endpoint: Point, wall: Wall): Point | null {
  if (distance(endpoint, wall.start) <= WALL_JOIN_EPSILON_METERS) {
    return normalize(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
  }

  if (distance(endpoint, wall.end) <= WALL_JOIN_EPSILON_METERS) {
    return normalize(wall.start.x - wall.end.x, wall.start.y - wall.end.y)
  }

  return null
}

function getFaceContinuation(
  wall: Wall,
  endpoint: 'start' | 'end',
  side: -1 | 1,
  walls: Wall[],
) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const centerlineDirection = normalize(dx, dy)
  const directionAwayFromEndpoint =
    endpoint === 'start'
      ? centerlineDirection
      : { x: -centerlineDirection.x, y: -centerlineDirection.y }
  const faceNormal = {
    x: -centerlineDirection.y * side,
    y: centerlineDirection.x * side,
  }
  const endpointPoint = endpoint === 'start' ? wall.start : wall.end
  let continuation = 0

  for (const otherWall of walls) {
    if (otherWall.id === wall.id) {
      continue
    }

    const closestPointOnOtherWall = getClosestPointOnSegment(
      endpointPoint,
      otherWall.start,
      otherWall.end,
    )
    const projectionOnOtherWall = getProjectionOnSegment(
      endpointPoint,
      otherWall.start,
      otherWall.end,
    )
    const distanceToOtherWallCenterline = distance(
      endpointPoint,
      projectionOnOtherWall.point,
    )
    const isWithinOtherWallBody =
      projectionOnOtherWall.t >= 0 &&
      projectionOnOtherWall.t <= 1 &&
      distanceToOtherWallCenterline <=
        otherWall.thickness / 2 + WALL_JOIN_EPSILON_METERS

    if (isWithinOtherWallBody) {
      const otherWallDirection = normalize(
        otherWall.end.x - otherWall.start.x,
        otherWall.end.y - otherWall.start.y,
      )
      const otherWallNormal = {
        x: -otherWallDirection.y,
        y: otherWallDirection.x,
      }
      const directionDotNormal =
        directionAwayFromEndpoint.x * otherWallNormal.x +
        directionAwayFromEndpoint.y * otherWallNormal.y
      const signedDistanceToCenterline =
        (endpointPoint.x - closestPointOnOtherWall.x) * otherWallNormal.x +
        (endpointPoint.y - closestPointOnOtherWall.y) * otherWallNormal.y

      if (Math.abs(directionDotNormal) > 0.08) {
        const faceDistances = [-otherWall.thickness / 2, otherWall.thickness / 2]
          .map((faceDistance) =>
            (faceDistance - signedDistanceToCenterline) / directionDotNormal,
          )
          .filter((faceDistance) => faceDistance >= 0)
        const distanceToNearFace = Math.min(...faceDistances)
        const continuationToWallFace = Number.isFinite(distanceToNearFace)
          ? -distanceToNearFace
          : 0

        if (Math.abs(continuationToWallFace) > Math.abs(continuation)) {
          continuation = continuationToWallFace
        }
      }

      continue
    }

    const otherDirection = getEndpointDirectionFrom(endpointPoint, otherWall)
    if (!otherDirection) {
      continue
    }

    const cross =
      directionAwayFromEndpoint.x * otherDirection.y -
      directionAwayFromEndpoint.y * otherDirection.x

    if (Math.abs(cross) < 0.08) {
      continue
    }

    const adjacentHalfThickness = otherWall.thickness / 2
    const otherWallGoesTowardFace =
      otherDirection.x * faceNormal.x + otherDirection.y * faceNormal.y > 0
    const sideContinuation = otherWallGoesTowardFace
      ? -adjacentHalfThickness
      : adjacentHalfThickness

    if (Math.abs(sideContinuation) > Math.abs(continuation)) {
      continuation = sideContinuation
    }
  }

  return continuation
}

function getVisibleLengthContinuations(wall: Wall, walls: Wall[]) {
  return ([-1, 1] as const).map((side) => ({
    start: getFaceContinuation(wall, 'start', side, walls),
    end: getFaceContinuation(wall, 'end', side, walls),
  }))
}

function getWallEndpointDirectionAway(
  wall: Wall,
  endpoint: 'start' | 'end',
) {
  return endpoint === 'start'
    ? normalize(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    : normalize(wall.start.x - wall.end.x, wall.start.y - wall.end.y)
}

function subtractBlockedIntervals(
  length: number,
  blockedIntervals: Array<[number, number]>,
) {
  return blockedIntervals
    .map(([start, end]) => [
      Math.max(0, Math.min(start, length)),
      Math.max(0, Math.min(end, length)),
    ] as [number, number])
    .filter(([start, end]) => end - start > MIN_WALL_LENGTH_METERS / 2)
    .sort(([firstStart], [secondStart]) => firstStart - secondStart)
    .reduce<Array<[number, number]>>(
      (segments, [blockedStart, blockedEnd]) =>
        segments.flatMap(([segmentStart, segmentEnd]) => {
          if (blockedEnd <= segmentStart || blockedStart >= segmentEnd) {
            return [[segmentStart, segmentEnd]]
          }

          return [
            [segmentStart, Math.max(segmentStart, blockedStart)] as [number, number],
            [Math.min(segmentEnd, blockedEnd), segmentEnd] as [number, number],
          ].filter(([start, end]) => end - start >= MIN_WALL_LENGTH_METERS)
        }),
      [[0, length]],
    )
}

function getFaceBlockers(
  wall: Wall,
  side: -1 | 1,
  walls: Wall[],
): Array<[number, number]> {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return []
  }

  const unit = { x: dx / length, y: dy / length }
  const normal = { x: -unit.y, y: unit.x }
  const faceNormal = { x: normal.x * side, y: normal.y * side }

  return walls.flatMap((otherWall) => {
    if (otherWall.id === wall.id) {
      return []
    }

    return (['start', 'end'] as const).flatMap((endpoint) => {
      const point = endpoint === 'start' ? otherWall.start : otherWall.end
      const projection = getProjectionOnSegment(point, wall.start, wall.end)
      const distanceToCenterline = distance(point, projection.point)
      const projectedDistance = projection.t * length
      const signedDistance =
        (point.x - projection.point.x) * normal.x +
        (point.y - projection.point.y) * normal.y

      if (
        projectedDistance <= WALL_JOIN_EPSILON_METERS ||
        projectedDistance >= length - WALL_JOIN_EPSILON_METERS ||
        distanceToCenterline > wall.thickness / 2 + WALL_JOIN_EPSILON_METERS
      ) {
        return []
      }

      const otherDirection = getWallEndpointDirectionAway(otherWall, endpoint)
      const connectsFromThisSide =
        otherDirection.x * faceNormal.x + otherDirection.y * faceNormal.y > 0.08 ||
        Math.abs(signedDistance - (wall.thickness / 2) * side) <=
          WALL_JOIN_EPSILON_METERS

      if (!connectsFromThisSide) {
        return []
      }

      const otherNormal = {
        x: -otherDirection.y,
        y: otherDirection.x,
      }
      const halfBlockedLength = Math.max(
        otherWall.thickness / 2,
        Math.abs(otherNormal.x * unit.x + otherNormal.y * unit.y) *
          (otherWall.thickness / 2),
      )

      return [[
        projectedDistance - halfBlockedLength,
        projectedDistance + halfBlockedLength,
      ] as [number, number]]
    })
  })
}

function getCenterlineLengthForVisibleLength(
  wall: Wall,
  walls: Wall[],
  visibleLength: number,
) {
  const continuations = getVisibleLengthContinuations(wall, walls)
  const averageContinuation =
    continuations.reduce(
      (total, continuation) => total + continuation.start + continuation.end,
      0,
    ) / continuations.length

  return Math.max(MIN_WALL_LENGTH_METERS, visibleLength - averageContinuation)
}

function getPlanCenter(walls: Wall[]) {
  const points = walls.flatMap((wall) => [wall.start, wall.end])

  if (points.length === 0) {
    return { x: 0, y: 0 }
  }

  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function getSignedArea(points: Point[]) {
  return (
    points.reduce((area, point, index) => {
      const nextPoint = points[(index + 1) % points.length]
      return area + point.x * nextPoint.y - nextPoint.x * point.y
    }, 0) / 2
  )
}

function getLoopPointKey(point: Point) {
  return `${Math.round(point.x / WALL_JOIN_EPSILON_METERS)}:${Math.round(
    point.y / WALL_JOIN_EPSILON_METERS,
  )}`
}

type ExternalLoopEdge = {
  endKey: string
  startKey: string
  wall: Wall
}

function getExternalWallOutsideSide(wall: Wall, walls: Wall[]): -1 | 1 | null {
  const externalWalls = walls.filter((candidateWall) => candidateWall.kind !== 'internal')

  if (externalWalls.length < 3) {
    return null
  }

  const edges = externalWalls.map((candidateWall) => ({
    wall: candidateWall,
    startKey: getLoopPointKey(candidateWall.start),
    endKey: getLoopPointKey(candidateWall.end),
  }))
  const connections = new Map<string, ExternalLoopEdge[]>()
  const pointsByKey = new Map<string, Point>()

  for (const edge of edges) {
    connections.set(edge.startKey, [...(connections.get(edge.startKey) ?? []), edge])
    connections.set(edge.endKey, [...(connections.get(edge.endKey) ?? []), edge])
    pointsByKey.set(edge.startKey, edge.wall.start)
    pointsByKey.set(edge.endKey, edge.wall.end)
  }

  const loops = edges.flatMap((edge) =>
    [
      traceExternalLoop(edge, edge.startKey, edge.endKey, connections, pointsByKey),
      traceExternalLoop(edge, edge.endKey, edge.startKey, connections, pointsByKey),
    ].filter((loop): loop is ExternalLoopEdge[] => Boolean(loop)),
  )
  const bestLoop = loops
    .filter((loop) => loop.some((edge) => edge.wall.id === wall.id))
    .sort((firstLoop, secondLoop) => {
      const firstArea = Math.abs(
        getSignedArea(firstLoop.map((edge) => pointsByKey.get(edge.startKey)!)),
      )
      const secondArea = Math.abs(
        getSignedArea(secondLoop.map((edge) => pointsByKey.get(edge.startKey)!)),
      )

      return secondArea - firstArea
    })[0]

  if (!bestLoop) {
    return null
  }

  const loopPoints = bestLoop.map((edge) => pointsByKey.get(edge.startKey)!)
  const loopArea = getSignedArea(loopPoints)
  const loopEdge = bestLoop.find((edge) => edge.wall.id === wall.id)

  if (!loopEdge) {
    return null
  }

  const wallDirectionMatchesLoop =
    loopEdge.startKey === getLoopPointKey(wall.start) &&
    loopEdge.endKey === getLoopPointKey(wall.end)
  const interiorSideForLoopDirection = loopArea > 0 ? 1 : -1
  const interiorSide = wallDirectionMatchesLoop
    ? interiorSideForLoopDirection
    : ((-interiorSideForLoopDirection) as -1 | 1)

  return (-interiorSide) as -1 | 1
}

function traceExternalLoop(
  firstEdge: ExternalLoopEdge,
  startKey: string,
  endKey: string,
  connections: Map<string, ExternalLoopEdge[]>,
  pointsByKey: Map<string, Point>,
) {
  const loop: ExternalLoopEdge[] = [
    {
      ...firstEdge,
      startKey,
      endKey,
    },
  ]
  const visitedStates = new Set<string>()
  let previousKey = startKey
  let currentKey = endKey
  let currentEdge = firstEdge
  const maxSteps = connections.size * 4

  for (let step = 0; step < maxSteps; step += 1) {
    const stateKey = `${currentEdge.wall.id}:${previousKey}:${currentKey}`

    if (visitedStates.has(stateKey)) {
      return null
    }

    visitedStates.add(stateKey)

    if (currentKey === startKey) {
      return loop.length >= 3 ? loop : null
    }

    const candidates = (connections.get(currentKey) ?? [])
      .map((edge) => {
        const nextKey = edge.startKey === currentKey ? edge.endKey : edge.startKey

        return {
          edge: {
            ...edge,
            startKey: currentKey,
            endKey: nextKey,
          },
          nextKey,
        }
      })
      .filter(
        (candidate) =>
          candidate.edge.wall.id !== currentEdge.wall.id ||
          candidate.nextKey !== previousKey,
      )

    if (candidates.length === 0) {
      return null
    }

    const previousPoint = pointsByKey.get(previousKey)!
    const currentPoint = pointsByKey.get(currentKey)!
    const incomingAngle = Math.atan2(
      currentPoint.y - previousPoint.y,
      currentPoint.x - previousPoint.x,
    )
    const nextCandidate = candidates.reduce((bestCandidate, candidate) => {
      const bestPoint = pointsByKey.get(bestCandidate.nextKey)!
      const candidatePoint = pointsByKey.get(candidate.nextKey)!
      const bestTurn = normalizeAngle(
        incomingAngle -
          Math.atan2(bestPoint.y - currentPoint.y, bestPoint.x - currentPoint.x),
      )
      const candidateTurn = normalizeAngle(
        incomingAngle -
          Math.atan2(
            candidatePoint.y - currentPoint.y,
            candidatePoint.x - currentPoint.x,
          ),
      )

      return candidateTurn < bestTurn ? candidate : bestCandidate
    }, candidates[0])

    loop.push(nextCandidate.edge)
    previousKey = currentKey
    currentKey = nextCandidate.nextKey
    currentEdge = nextCandidate.edge
  }

  return null
}

function applyMeasuredLengthAndAngle(
  start: Point,
  pointerEnd: Point,
  lengthInput: string | null,
  angleInput: string | null,
  wallKind: WallKind,
  roomHeight: number,
  walls: Wall[],
) {
  const typedLength = parseLengthInput(lengthInput ?? '')
  const typedAngle = parseAngleInput(angleInput ?? '')
  const angle = ((typedAngle ?? getAngleDegrees(start, pointerEnd)) * Math.PI) / 180
  const initialLength = typedLength ?? distance(start, pointerEnd)
  const initialEnd = {
    x: start.x + Math.cos(angle) * initialLength,
    y: start.y + Math.sin(angle) * initialLength,
  }

  if (!typedLength) {
    return initialEnd
  }

  const draftWall: Wall = {
    id: 'draft-wall',
    kind: wallKind,
    start,
    end: initialEnd,
    thickness: getDraftWallThickness(wallKind),
    height: roomHeight,
  }
  const centerlineLength = getCenterlineLengthForVisibleLength(
    draftWall,
    walls,
    typedLength,
  )

  return {
    x: start.x + Math.cos(angle) * centerlineLength,
    y: start.y + Math.sin(angle) * centerlineLength,
  }
}

function getExternalDimensionSide(wall: Wall, walls: Wall[]): -1 | 1 {
  const loopOutsideSide = getExternalWallOutsideSide(wall, walls)

  if (loopOutsideSide !== null) {
    return loopOutsideSide
  }

  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return 1
  }

  const normal = { x: -dy / length, y: dx / length }
  const midpoint = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  }
  const planCenter = getPlanCenter(walls)
  const centerSide =
    (planCenter.x - midpoint.x) * normal.x +
    (planCenter.y - midpoint.y) * normal.y

  return centerSide < 0 ? 1 : -1
}

function getExternalDimensionEndpointOffset(
  wall: Wall,
  endpoint: 'start' | 'end',
  side: -1 | 1,
  renderedExtension: number,
  walls: Wall[],
) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return 0
  }

  const unit = { x: dx / length, y: dy / length }
  const endpointPoint = endpoint === 'start' ? wall.start : wall.end
  const faceNormal = {
    x: -unit.y * side,
    y: unit.x * side,
  }
  let offset = renderedExtension
  const connectedEndpointWalls = walls.filter(
    (otherWall) =>
      otherWall.id !== wall.id &&
      (distance(endpointPoint, otherWall.start) <= CONNECTION_SNAP_METERS ||
        distance(endpointPoint, otherWall.end) <= CONNECTION_SNAP_METERS),
  )

  if (connectedEndpointWalls.length >= 2) {
    let hasPerpendicularExternalConnection = false
    let measuredSideStop: number | null = null
    let outsideCornerExtension: number | null = null

    for (const otherWall of connectedEndpointWalls) {
      if (otherWall.kind === 'internal') {
        continue
      }

      const otherDirection =
        distance(endpointPoint, otherWall.start) <= CONNECTION_SNAP_METERS
          ? normalize(
              otherWall.end.x - otherWall.start.x,
              otherWall.end.y - otherWall.start.y,
            )
          : normalize(
              otherWall.start.x - otherWall.end.x,
              otherWall.start.y - otherWall.end.y,
            )
      const isPerpendicular =
        Math.abs(unit.x * otherDirection.x + unit.y * otherDirection.y) <= 0.08

      if (!isPerpendicular) {
        continue
      }

      hasPerpendicularExternalConnection = true

      const turnsIntoMeasuredSide =
        otherDirection.x * faceNormal.x + otherDirection.y * faceNormal.y > 0.08

      if (turnsIntoMeasuredSide) {
        measuredSideStop = Math.min(
          measuredSideStop ?? Number.POSITIVE_INFINITY,
          -otherWall.thickness / 2,
        )
      } else {
        outsideCornerExtension = Math.max(
          outsideCornerExtension ?? Number.NEGATIVE_INFINITY,
          otherWall.thickness / 2,
        )
      }
    }

    if (hasPerpendicularExternalConnection) {
      return measuredSideStop ?? outsideCornerExtension ?? renderedExtension
    }
  }

  for (const otherWall of walls) {
    if (otherWall.id === wall.id || otherWall.kind === 'internal') {
      continue
    }

    const otherDx = otherWall.end.x - otherWall.start.x
    const otherDy = otherWall.end.y - otherWall.start.y
    const otherLength = Math.hypot(otherDx, otherDy)

    if (otherLength === 0) {
      continue
    }

    const otherUnit = {
      x: otherDx / otherLength,
      y: otherDy / otherLength,
    }
    const otherIsPerpendicular =
      Math.abs(unit.x * otherUnit.x + unit.y * otherUnit.y) <= 0.08

    if (!otherIsPerpendicular) {
      continue
    }

    const renderedOtherWall = getRenderedWalls(walls).find(
      (candidateWall) => candidateWall.wall.id === otherWall.id,
    )

    if (renderedOtherWall) {
      const otherPolygon = getWallPolygon(renderedOtherWall)
      const endpointAxisDistance = endpoint === 'start' ? 0 : length
      const endpointNormalDistance =
        (endpointPoint.x - wall.start.x) * faceNormal.x +
        (endpointPoint.y - wall.start.y) * faceNormal.y
      const polygonAxisDistances = otherPolygon.map(
        (point) =>
          (point.x - wall.start.x) * unit.x + (point.y - wall.start.y) * unit.y,
      )
      const polygonNormalDistances = otherPolygon.map(
        (point) =>
          (point.x - wall.start.x) * faceNormal.x +
          (point.y - wall.start.y) * faceNormal.y,
      )
      const minAxisDistance = Math.min(...polygonAxisDistances)
      const maxAxisDistance = Math.max(...polygonAxisDistances)
      const minNormalDistance = Math.min(...polygonNormalDistances)
      const maxNormalDistance = Math.max(...polygonNormalDistances)
      const endpointIsWithinOtherThickness =
        endpointAxisDistance >= minAxisDistance - WALL_JOIN_EPSILON_METERS &&
        endpointAxisDistance <= maxAxisDistance + WALL_JOIN_EPSILON_METERS
      const otherWallCrossesEndpoint =
        endpointNormalDistance > minNormalDistance + otherWall.thickness &&
        endpointNormalDistance < maxNormalDistance - otherWall.thickness

      if (endpointIsWithinOtherThickness && otherWallCrossesEndpoint) {
        const nearFaceDistance =
          endpoint === 'start' ? maxAxisDistance : minAxisDistance

        offset =
          endpoint === 'start'
            ? Math.min(offset, -nearFaceDistance)
            : Math.min(offset, nearFaceDistance - length)
        continue
      }
    }

    const projectionOnOtherWall = getProjectionOnSegment(
      endpointPoint,
      otherWall.start,
      otherWall.end,
    )
    const distanceToOtherCenterline = distance(
      endpointPoint,
      projectionOnOtherWall.point,
    )
    const endpointHitsOtherWallBody =
      projectionOnOtherWall.t > WALL_JOIN_EPSILON_METERS &&
      projectionOnOtherWall.t < 1 - WALL_JOIN_EPSILON_METERS &&
      distanceToOtherCenterline <=
        otherWall.thickness / 2 + WALL_JOIN_EPSILON_METERS

    if (endpointHitsOtherWallBody) {
      const otherNormal = {
        x: -otherUnit.y,
        y: otherUnit.x,
      }
      const extensionDirection =
        endpoint === 'start' ? { x: -unit.x, y: -unit.y } : unit
      const directionDotNormal =
        extensionDirection.x * otherNormal.x +
        extensionDirection.y * otherNormal.y
      const signedDistanceToCenterline =
        (endpointPoint.x - projectionOnOtherWall.point.x) * otherNormal.x +
        (endpointPoint.y - projectionOnOtherWall.point.y) * otherNormal.y
      const faceDistances = [-otherWall.thickness / 2, otherWall.thickness / 2]
        .map((faceDistance) =>
          Math.abs(directionDotNormal) > 0.08
            ? (faceDistance - signedDistanceToCenterline) / directionDotNormal
            : Number.POSITIVE_INFINITY,
        )
        .filter((faceDistance) => faceDistance >= 0)
      const distanceToNearFace = Math.min(...faceDistances)

      if (Number.isFinite(distanceToNearFace)) {
        offset = Math.min(offset, -distanceToNearFace)
      }

      continue
    }

    const otherStartDistance = distance(endpointPoint, otherWall.start)
    const otherEndDistance = distance(endpointPoint, otherWall.end)
    const otherDirection =
      otherStartDistance <= CONNECTION_SNAP_METERS
        ? normalize(
            otherWall.end.x - otherWall.start.x,
            otherWall.end.y - otherWall.start.y,
          )
        : otherEndDistance <= CONNECTION_SNAP_METERS
          ? normalize(
              otherWall.start.x - otherWall.end.x,
              otherWall.start.y - otherWall.end.y,
            )
          : null

    if (!otherDirection) {
      continue
    }

    const isPerpendicular =
      Math.abs(unit.x * otherDirection.x + unit.y * otherDirection.y) <= 0.08

    if (!isPerpendicular) {
      continue
    }

    const turnsIntoMeasuredSide =
      otherDirection.x * faceNormal.x + otherDirection.y * faceNormal.y > 0.08

    if (turnsIntoMeasuredSide) {
      offset = Math.min(offset, -otherWall.thickness / 2)
    } else {
      offset = Math.max(offset, otherWall.thickness / 2)
    }
  }

  return offset
}

function getInternalDimensionEndpointOffset(
  wall: Wall,
  endpoint: 'start' | 'end',
  side: -1 | 1,
  renderedExtension: number,
  walls: Wall[],
) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return 0
  }

  const unit = { x: dx / length, y: dy / length }
  const endpointPoint = endpoint === 'start' ? wall.start : wall.end
  const faceNormal = {
    x: -unit.y * side,
    y: unit.x * side,
  }
  let offset = renderedExtension

  for (const otherWall of walls) {
    if (otherWall.id === wall.id) {
      continue
    }

    const otherStartDistance = distance(endpointPoint, otherWall.start)
    const otherEndDistance = distance(endpointPoint, otherWall.end)
    const otherDirection =
      otherStartDistance <= CONNECTION_SNAP_METERS
        ? normalize(
            otherWall.end.x - otherWall.start.x,
            otherWall.end.y - otherWall.start.y,
          )
        : otherEndDistance <= CONNECTION_SNAP_METERS
          ? normalize(
              otherWall.start.x - otherWall.end.x,
              otherWall.start.y - otherWall.end.y,
            )
          : null

    if (!otherDirection) {
      continue
    }

    const isPerpendicular =
      Math.abs(unit.x * otherDirection.x + unit.y * otherDirection.y) <= 0.08

    if (!isPerpendicular) {
      continue
    }

    const turnsIntoMeasuredSide =
      otherDirection.x * faceNormal.x + otherDirection.y * faceNormal.y > 0.08

    if (turnsIntoMeasuredSide) {
      offset = Math.min(offset, -otherWall.thickness / 2)
    } else {
      offset = Math.max(offset, otherWall.thickness / 2)
    }
  }

  return offset
}

function getDimensionGuides(wall: Wall, walls: Wall[]): DimensionGuide[] {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const centerlineLength = Math.hypot(dx, dy)

  if (centerlineLength === 0) {
    return []
  }

  const unitX = dx / centerlineLength
  const unitY = dy / centerlineLength
  const normalX = -unitY
  const normalY = unitX
  const offset = wall.thickness / 2 + DIMENSION_OFFSET_METERS
  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI
  const isInternalWall = wall.kind === 'internal'

  if (!isInternalWall) {
    const side = getExternalDimensionSide(wall, walls)
    const renderedWall = getRenderedWalls(walls).find(
      (candidateWall) => candidateWall.wall.id === wall.id,
    )
    const startExtension = getExternalDimensionEndpointOffset(
      wall,
      'start',
      side,
      renderedWall?.startExtension ?? 0,
      walls,
    )
    const endExtension = getExternalDimensionEndpointOffset(
      wall,
      'end',
      side,
      renderedWall?.endExtension ?? 0,
      walls,
    )
    const measuredSegment = {
      start: {
        x: wall.start.x - unitX * startExtension,
        y: wall.start.y - unitY * startExtension,
      },
      end: {
        x: wall.end.x + unitX * endExtension,
        y: wall.end.y + unitY * endExtension,
      },
    }
    const centerMidpoint = {
      x: (measuredSegment.start.x + measuredSegment.end.x) / 2,
      y: (measuredSegment.start.y + measuredSegment.end.y) / 2,
    }
    const dimensionOffsetX = normalX * offset * side
    const dimensionOffsetY = normalY * offset * side
    const measuredLength = distance(measuredSegment.start, measuredSegment.end)

    return [
      {
        start: {
          x: measuredSegment.start.x + dimensionOffsetX,
          y: measuredSegment.start.y + dimensionOffsetY,
        },
        end: {
          x: measuredSegment.end.x + dimensionOffsetX,
          y: measuredSegment.end.y + dimensionOffsetY,
        },
        faceStart: measuredSegment.start,
        faceEnd: measuredSegment.end,
        labelPoint: {
          x: centerMidpoint.x + dimensionOffsetX,
          y: centerMidpoint.y + dimensionOffsetY,
        },
        tickMode: 'cross',
        text: `${measuredLength.toFixed(2)} m`,
        rotation,
      },
    ]
  }

  const sides = ([-1, 1] as const).map((side) => ({
    side,
    blockers: getFaceBlockers(wall, side, walls),
  }))
  const candidates = sides.flatMap<DimensionCandidate>(({ side, blockers }) => {
    const renderedWall = getRenderedWalls(walls).find(
      (candidateWall) => candidateWall.wall.id === wall.id,
    )
    const startContinuation = getInternalDimensionEndpointOffset(
      wall,
      'start',
      side,
      renderedWall?.startExtension ?? 0,
      walls,
    )
    const endContinuation = getInternalDimensionEndpointOffset(
      wall,
      'end',
      side,
      renderedWall?.endExtension ?? 0,
      walls,
    )
    const faceStart = {
      x: wall.start.x - unitX * startContinuation,
      y: wall.start.y - unitY * startContinuation,
    }
    const faceEnd = {
      x: wall.end.x + unitX * endContinuation,
      y: wall.end.y + unitY * endContinuation,
    }
    const offsetX = normalX * offset * side
    const offsetY = normalY * offset * side
    const visibleLength = distance(faceStart, faceEnd)

    return subtractBlockedIntervals(
      visibleLength,
      blockers.map(([start, end]) => [
        start + startContinuation,
        end + startContinuation,
      ]),
    ).map(([segmentStart, segmentEnd]) => {
      const segmentFaceStart = {
        x: faceStart.x + unitX * segmentStart,
        y: faceStart.y + unitY * segmentStart,
      }
      const segmentFaceEnd = {
        x: faceStart.x + unitX * segmentEnd,
        y: faceStart.y + unitY * segmentEnd,
      }
      const segmentLength = segmentEnd - segmentStart

      return {
        start: {
          x: segmentFaceStart.x + offsetX,
          y: segmentFaceStart.y + offsetY,
        },
        end: {
          x: segmentFaceEnd.x + offsetX,
          y: segmentFaceEnd.y + offsetY,
        },
        faceStart: segmentFaceStart,
        faceEnd: segmentFaceEnd,
        labelPoint: {
          x: (segmentFaceStart.x + segmentFaceEnd.x) / 2 + offsetX,
          y: (segmentFaceStart.y + segmentFaceEnd.y) / 2 + offsetY,
        },
        blockerCount: blockers.length,
        segmentEnd,
        segmentStart,
        side,
        tickMode: 'connector',
        text: `${segmentLength.toFixed(2)} m`,
        rotation,
      }
    })
  })

  return candidates
}

function snapToAxis(start: Point, end: Point): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: end.x, y: start.y }
  }

  return { x: start.x, y: end.y }
}

function getDimensionCrossTick(point: Point, rotation: number): [Point, Point] {
  const angle = (rotation * Math.PI) / 180
  const normal = {
    x: -Math.sin(angle),
    y: Math.cos(angle),
  }

  return [
    {
      x: point.x - normal.x * DIMENSION_TICK_METERS,
      y: point.y - normal.y * DIMENSION_TICK_METERS,
    },
    {
      x: point.x + normal.x * DIMENSION_TICK_METERS,
      y: point.y + normal.y * DIMENSION_TICK_METERS,
    },
  ]
}

function getDraftAxis(start: Point, end: Point): Axis {
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? 'horizontal'
    : 'vertical'
}

function normalizeAngle(angle: number) {
  return angle < 0 ? angle + Math.PI * 2 : angle
}

function getAngleWidget(start: Point, end: Point): AngleWidget | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const wallLength = Math.hypot(dx, dy)

  if (wallLength < MIN_WALL_LENGTH_METERS) {
    return null
  }

  const angle = normalizeAngle(Math.atan2(dy, dx))
  const steps = Math.max(8, Math.ceil((angle / (Math.PI * 2)) * 48))
  const arcPoints = Array.from({ length: steps + 1 }, (_, index) => {
    const stepAngle = (angle * index) / steps
    return [
      (start.x + Math.cos(stepAngle) * ANGLE_WIDGET_RADIUS_METERS) *
        METERS_TO_PIXELS,
      (start.y + Math.sin(stepAngle) * ANGLE_WIDGET_RADIUS_METERS) *
        METERS_TO_PIXELS,
    ]
  }).flat()
  const labelAngle = angle / 2

  return {
    arcPoints,
    baselineEnd: {
      x: start.x + ANGLE_WIDGET_RADIUS_METERS,
      y: start.y,
    },
    labelPoint: {
      x: start.x + Math.cos(labelAngle) * (ANGLE_WIDGET_RADIUS_METERS + 0.28),
      y: start.y + Math.sin(labelAngle) * (ANGLE_WIDGET_RADIUS_METERS + 0.28),
    },
    label: `${Math.round((angle * 180) / Math.PI)}°`,
  }
}

function getClosestPointOnSegment(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return start
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  )

  return {
    x: start.x + t * dx,
    y: start.y + t * dy,
  }
}

function getProjectionOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return { point: start, t: 0 }
  }

  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const t = Math.max(0, Math.min(1, rawT))

  return {
    point: {
      x: start.x + t * dx,
      y: start.y + t * dy,
    },
    t,
  }
}

function getOffsetSegment(
  wall: Wall,
  offset: number,
  startExtension = 0,
  endExtension = 0,
): SnapSegment {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return { start: wall.start, end: wall.end }
  }

  const normalX = -dy / length
  const normalY = dx / length
  const unitX = dx / length
  const unitY = dy / length

  return {
    start: {
      x: wall.start.x - unitX * startExtension + normalX * offset,
      y: wall.start.y - unitY * startExtension + normalY * offset,
    },
    end: {
      x: wall.end.x + unitX * endExtension + normalX * offset,
      y: wall.end.y + unitY * endExtension + normalY * offset,
    },
  }
}

function getQuarterEndSnapPoints(
  wall: Wall,
  offset: number,
  startExtension: number,
  endExtension: number,
): SnapSegment[] {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return []
  }

  const unitX = dx / length
  const unitY = dy / length
  const normalX = -dy / length
  const normalY = dx / length
  const quarterThickness = wall.thickness / 4
  const sideOffset = Math.sign(offset || 1) * (wall.thickness / 2)
  const insetDistances = [quarterThickness, quarterThickness * 3]
  const startEnd = {
    x: wall.start.x - unitX * startExtension + normalX * sideOffset,
    y: wall.start.y - unitY * startExtension + normalY * sideOffset,
  }
  const finishEnd = {
    x: wall.end.x + unitX * endExtension + normalX * sideOffset,
    y: wall.end.y + unitY * endExtension + normalY * sideOffset,
  }

  return insetDistances.flatMap((insetDistance) => {
    const startPoint = {
      x: startEnd.x + unitX * insetDistance,
      y: startEnd.y + unitY * insetDistance,
    }
    const finishPoint = {
      x: finishEnd.x - unitX * insetDistance,
      y: finishEnd.y - unitY * insetDistance,
    }

    return [
      {
        start: startPoint,
        end: startPoint,
        endpointsOnly: true,
        label: '1/4',
      },
      {
        start: finishPoint,
        end: finishPoint,
        endpointsOnly: true,
        label: '1/4',
      },
    ]
  })
}

function getSnapSegments(walls: Wall[], wallKind: WallKind): SnapSegment[] {
  return getRenderedWalls(walls).flatMap(({ wall, startExtension, endExtension }) => {
    const centerSegment = { start: wall.start, end: wall.end }

    if (wallKind !== 'internal' || wall.kind !== 'external') {
      return [centerSegment]
    }

    const quarterThickness = wall.thickness / 4
    const innerQuarterLane = getOffsetSegment(
      wall,
      -quarterThickness,
      startExtension,
      endExtension,
    )
    const outerQuarterLane = getOffsetSegment(
      wall,
      quarterThickness,
      startExtension,
      endExtension,
    )

    return [
      {
        ...innerQuarterLane,
        endpointsOnly: true,
        label: '1/4',
      },
      ...getQuarterEndSnapPoints(
        wall,
        -quarterThickness,
        startExtension,
        endExtension,
      ),
      { ...centerSegment, label: '1/2' },
      {
        ...outerQuarterLane,
        endpointsOnly: true,
        label: '1/4',
      },
      ...getQuarterEndSnapPoints(
        wall,
        quarterThickness,
        startExtension,
        endExtension,
      ),
    ]
  })
}

function getSnapTarget(point: Point, segments: SnapSegment[]): SnapTarget | null {
  let closestTarget: SnapTarget | null = null
  let closestDistance = CONNECTION_SNAP_METERS

  for (const segment of segments) {
    const candidates: SnapTarget[] = [
      { point: segment.start, kind: 'endpoint', label: segment.label },
      { point: segment.end, kind: 'endpoint', label: segment.label },
      ...(segment.endpointsOnly
        ? []
        : [
            {
              point: getClosestPointOnSegment(point, segment.start, segment.end),
              kind: 'junction' as const,
              label: segment.label,
            },
          ]),
    ]

    for (const candidate of candidates) {
      const candidateDistance = distance(point, candidate.point)

      if (candidateDistance < closestDistance) {
        closestDistance = candidateDistance
        closestTarget = candidate
      }
    }
  }

  return closestTarget
}

function getSnapPreviewTarget(
  point: Point,
  segments: SnapSegment[],
): SnapTarget | null {
  const target = getSnapTarget(point, segments)

  if (!target) {
    return null
  }

  if (target.kind === 'junction' && distance(point, target.point) < 0.01) {
    return null
  }

  return target
}

function getClosestAlignmentGuide(
  point: Point,
  walls: Wall[],
  preferredAxis?: AlignmentAxis,
): AlignmentGuide | null {
  let closestGuide: AlignmentGuide | null = null
  let closestDistance = ALIGNMENT_GUIDE_TOLERANCE_METERS

  for (const endpoint of walls.flatMap((wall) => [wall.start, wall.end])) {
    const candidates: AlignmentGuide[] = [
      {
        axis: 'x',
        endpoint,
        projection: { x: endpoint.x, y: point.y },
        distance: Math.abs(endpoint.x - point.x),
        crossDistance: Math.abs(endpoint.y - point.y),
      },
      {
        axis: 'y',
        endpoint,
        projection: { x: point.x, y: endpoint.y },
        distance: Math.abs(endpoint.y - point.y),
        crossDistance: Math.abs(endpoint.x - point.x),
      },
    ]

    for (const candidate of candidates) {
      if (preferredAxis && candidate.axis !== preferredAxis) {
        continue
      }

      const closestScore = closestGuide
        ? closestGuide.distance * 2 + closestGuide.crossDistance
        : Number.POSITIVE_INFINITY
      const candidateScore = candidate.distance * 2 + candidate.crossDistance

      if (candidate.distance <= closestDistance && candidateScore < closestScore) {
        closestDistance = candidate.distance
        closestGuide = candidate
      }
    }
  }

  return closestGuide
}

function applyAlignmentGuide(point: Point, guide: AlignmentGuide | null): Point {
  return guide?.projection ?? point
}

export function FloorplanCanvas({
  activeFloor,
  floors,
  isAddingWall,
  selectedWallId,
  wallKind,
  onAddWall,
  onDeleteWall,
  onExitAddWall,
  onSelectWall,
}: FloorplanCanvasProps) {
  const walls = activeFloor.walls
  const referenceFloors = useMemo(
    () => floors.filter((floor) => floor.id !== activeFloor.id),
    [activeFloor.id, floors],
  )
  const snapWalls = useMemo(
    () => floors.flatMap((floor) => floor.walls),
    [floors],
  )
  const activeSnapSegments = useMemo(
    () => getSnapSegments(walls, wallKind),
    [walls, wallKind],
  )
  const referenceSnapSegments = useMemo(
    () =>
      getSnapSegments(
        referenceFloors.flatMap((floor) => floor.walls),
        wallKind,
      ),
    [referenceFloors, wallKind],
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<CanvasSize>({ width: 600, height: 600 })
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [draftWall, setDraftWall] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const [hoverSnapTarget, setHoverSnapTarget] = useState<SnapTarget | null>(null)
  const [hoverAlignmentGuide, setHoverAlignmentGuide] =
    useState<AlignmentGuide | null>(null)
  const [draftLengthInput, setDraftLengthInput] = useState<string | null>(null)
  const [draftAngleInput, setDraftAngleInput] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isMiddlePanning, setIsMiddlePanning] = useState(false)
  const [isAxisLocked, setIsAxisLocked] = useState(true)
  const lengthInputRef = useRef<HTMLInputElement>(null)
  const middlePanRef = useRef<PanState | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return
      }

      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const input = lengthInputRef.current
    if (draftLengthInput !== null && input && document.activeElement !== input) {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
  }, [draftLengthInput])

  useEffect(() => {
    const typedLength = parseLengthInput(draftLengthInput ?? '')
    const typedAngle = parseAngleInput(draftAngleInput ?? '')
    if (!typedLength && typedAngle === null) {
      return
    }

    setDraftWall((currentDraftWall) =>
      currentDraftWall
        ? {
            ...currentDraftWall,
            end: applyMeasuredLengthAndAngle(
              currentDraftWall.start,
              currentDraftWall.end,
              draftLengthInput,
              draftAngleInput,
              wallKind,
              activeFloor.roomHeight,
              snapWalls,
            ),
          }
        : currentDraftWall,
    )
  }, [activeFloor.roomHeight, draftLengthInput, draftAngleInput, snapWalls, wallKind])

  useEffect(() => {
    if (!isAddingWall) {
      return
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      resetDraftWall()
      onExitAddWall()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isAddingWall, onExitAddWall])

  useEffect(() => {
    if (!draftWall || !isAddingWall) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) {
        return
      }

      const isLengthKey = /^\d$/.test(event.key) || event.key === '.'

      if (!isLengthKey && event.key !== 'Backspace' && event.key !== 'Enter' && event.key !== 'Escape') {
        return
      }

      event.preventDefault()

      if (event.key === 'Escape') {
        resetDraftWall()
        onExitAddWall()
        return
      }

      if (event.key === 'Enter') {
        if (distance(draftWall.start, draftWall.end) >= MIN_WALL_LENGTH_METERS) {
          onAddWall(draftWall)
        }

        resetDraftWall()
        return
      }

      setDraftLengthInput((currentValue) => {
        if (event.key === 'Backspace') {
          return currentValue ? currentValue.slice(0, -1) : ''
        }

        if (event.key === '.' && currentValue?.includes('.')) {
          return currentValue ?? ''
        }

        return `${currentValue ?? ''}${event.key}`
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [draftWall, isAddingWall, onAddWall, onExitAddWall])

  const getPointerPoint = (event: KonvaEventObject<PointerEvent>) => {
    const point = event.target.getStage()?.getPointerPosition()
    return point
      ? toPlanPoint({
          x: (point.x - viewport.x) / viewport.scale,
          y: (point.y - viewport.y) / viewport.scale,
        })
      : null
  }

  const resetDraftWall = () => {
    setDraftWall(null)
    setHoverSnapTarget(null)
    setHoverAlignmentGuide(null)
    setDraftLengthInput(null)
    setDraftAngleInput(null)
    setIsAxisLocked(true)
  }

  const getDraftEndPoint = (
    start: Point,
    point: Point,
    event: PointerEvent,
  ) => {
    const basePoint = event.ctrlKey ? point : snapToAxis(start, point)

    if (event.shiftKey) {
      return basePoint
    }

    const axis = getDraftAxis(start, point)
    const alignmentGuide = event.ctrlKey
      ? null
      : getClosestAlignmentGuide(
          basePoint,
          snapWalls,
          axis === 'horizontal' ? 'x' : 'y',
        )
    const alignedPoint = applyAlignmentGuide(basePoint, alignmentGuide)
    const snappedPoint = snapToPreferredConnection(alignedPoint)

    return event.ctrlKey ? snappedPoint : snapToAxis(start, snappedPoint)
  }

  const getPreferredSnapTarget = (point: Point) =>
    getSnapTarget(point, activeSnapSegments) ??
    getSnapTarget(point, referenceSnapSegments)

  const getPreferredSnapPreviewTarget = (point: Point) =>
    getSnapPreviewTarget(point, activeSnapSegments) ??
    getSnapPreviewTarget(point, referenceSnapSegments)

  const snapToPreferredConnection = (point: Point) =>
    getPreferredSnapTarget(point)?.point ?? point

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  const openWallContextMenu = (
    wallId: string,
    event: KonvaEventObject<PointerEvent>,
  ) => {
    event.evt.preventDefault()
    const containerBounds = containerRef.current?.getBoundingClientRect()

    if (!containerBounds) {
      return
    }

    onSelectWall(wallId)
    setContextMenu({
      wallId,
      x: event.evt.clientX - containerBounds.left,
      y: event.evt.clientY - containerBounds.top,
    })
  }

  const stopMiddlePan = () => {
    middlePanRef.current = null
    setIsMiddlePanning(false)
  }

  const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    closeContextMenu()

    if (event.evt.button === 1) {
      event.evt.preventDefault()
      middlePanRef.current = {
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
      }
      setIsMiddlePanning(true)
      return
    }

    if (event.evt.button === 2) {
      event.evt.preventDefault()
      return
    }

    if (!isAddingWall) {
      if (event.target === event.target.getStage()) {
        onSelectWall(null)
      }

      return
    }

    if (draftWall) {
      const point = getPointerPoint(event)
      const wallToAdd = point
        ? (() => {
            const pointerEnd = getDraftEndPoint(draftWall.start, point, event.evt)

            return {
              ...draftWall,
              end: (() => {
                const typedLength = parseLengthInput(draftLengthInput ?? '')
                const typedAngle = parseAngleInput(draftAngleInput ?? '')

                return typedLength || typedAngle !== null
                  ? applyMeasuredLengthAndAngle(
                      draftWall.start,
                      pointerEnd,
                      draftLengthInput,
                      draftAngleInput,
                      wallKind,
                      activeFloor.roomHeight,
                      snapWalls,
                    )
                  : pointerEnd
              })(),
            }
          })()
        : draftWall

      if (distance(wallToAdd.start, wallToAdd.end) >= MIN_WALL_LENGTH_METERS) {
        onAddWall(wallToAdd)
      }

      resetDraftWall()
      return
    }

    const point = getPointerPoint(event)
    if (point) {
      const alignmentGuide = event.evt.shiftKey
        ? null
        : hoverAlignmentGuide ?? getClosestAlignmentGuide(point, snapWalls)
      const alignedPoint = applyAlignmentGuide(point, alignmentGuide)
      const snappedPoint = event.evt.shiftKey
        ? point
        : hoverSnapTarget?.point ?? snapToPreferredConnection(alignedPoint)
      setDraftWall({ start: snappedPoint, end: snappedPoint })
      setHoverAlignmentGuide(null)
      setIsAxisLocked(true)
    }
  }

  const handlePointerMove = (event: KonvaEventObject<PointerEvent>) => {
    if (middlePanRef.current) {
      event.evt.preventDefault()

      const deltaX = event.evt.clientX - middlePanRef.current.clientX
      const deltaY = event.evt.clientY - middlePanRef.current.clientY

      middlePanRef.current = {
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
      }
      setViewport((currentViewport) => ({
        ...currentViewport,
        x: currentViewport.x + deltaX,
        y: currentViewport.y + deltaY,
      }))
      return
    }

    if (!isAddingWall) {
      setHoverSnapTarget(null)
      setHoverAlignmentGuide(null)
      setIsAxisLocked(true)
      return
    }

    const point = getPointerPoint(event)
    if (!point) {
      return
    }

    if (!draftWall) {
      setHoverSnapTarget(getPreferredSnapPreviewTarget(point))
      setHoverAlignmentGuide(
        event.evt.shiftKey ? null : getClosestAlignmentGuide(point, snapWalls),
      )
      return
    }

    const pointerEnd = getDraftEndPoint(draftWall.start, point, event.evt)
    const axis = getDraftAxis(draftWall.start, point)
    const basePoint = event.evt.ctrlKey ? point : snapToAxis(draftWall.start, point)
    const alignmentGuide =
      event.evt.ctrlKey || event.evt.shiftKey
        ? null
        : getClosestAlignmentGuide(
            basePoint,
            snapWalls,
            axis === 'horizontal' ? 'x' : 'y',
          )
    const snapPreviewPoint = applyAlignmentGuide(basePoint, alignmentGuide)
    setIsAxisLocked(!event.evt.ctrlKey)
    setHoverSnapTarget(
      event.evt.shiftKey ? null : getPreferredSnapPreviewTarget(snapPreviewPoint),
    )
    setHoverAlignmentGuide(alignmentGuide)
    setDraftWall({
      ...draftWall,
      end: (() => {
        const typedLength = parseLengthInput(draftLengthInput ?? '')
        const typedAngle = parseAngleInput(draftAngleInput ?? '')

        return typedLength || typedAngle !== null
          ? applyMeasuredLengthAndAngle(
              draftWall.start,
              pointerEnd,
              draftLengthInput,
              draftAngleInput,
              wallKind,
              activeFloor.roomHeight,
              snapWalls,
            )
          : pointerEnd
      })(),
    })
  }

  const zoomAroundPoint = (point: Point, nextScale: number) => {
    setViewport((currentViewport) => {
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale))
      const logicalPoint = {
        x: (point.x - currentViewport.x) / currentViewport.scale,
        y: (point.y - currentViewport.y) / currentViewport.scale,
      }

      return {
        scale,
        x: point.x - logicalPoint.x * scale,
        y: point.y - logicalPoint.y * scale,
      }
    })
  }

  const zoomAtCenter = (factor: number) => {
    zoomAroundPoint(
      { x: size.width / 2, y: size.height / 2 },
      viewport.scale * factor,
    )
  }

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const point = event.target.getStage()?.getPointerPosition()
    if (!point) {
      return
    }

    zoomAroundPoint(
      point,
      event.evt.deltaY > 0
        ? viewport.scale / ZOOM_STEP
        : viewport.scale * ZOOM_STEP,
    )
  }

  const visibleBounds = {
    left: -viewport.x / viewport.scale,
    top: -viewport.y / viewport.scale,
    right: (size.width - viewport.x) / viewport.scale,
    bottom: (size.height - viewport.y) / viewport.scale,
  }
  const firstGridX =
    Math.floor(visibleBounds.left / METERS_TO_PIXELS) * METERS_TO_PIXELS
  const lastGridX =
    Math.ceil(visibleBounds.right / METERS_TO_PIXELS) * METERS_TO_PIXELS
  const firstGridY =
    Math.floor(visibleBounds.top / METERS_TO_PIXELS) * METERS_TO_PIXELS
  const lastGridY =
    Math.ceil(visibleBounds.bottom / METERS_TO_PIXELS) * METERS_TO_PIXELS
  const verticalGridLines = Array.from(
    { length: Math.max(0, Math.round((lastGridX - firstGridX) / METERS_TO_PIXELS) + 1) },
    (_, index) => firstGridX + index * METERS_TO_PIXELS,
  )
  const horizontalGridLines = Array.from(
    { length: Math.max(0, Math.round((lastGridY - firstGridY) / METERS_TO_PIXELS) + 1) },
    (_, index) => firstGridY + index * METERS_TO_PIXELS,
  )
  const renderedWalls = getRenderedWalls(walls)
  const draftWallLength = draftWall ? distance(draftWall.start, draftWall.end) : null
  const angleWidget =
    draftWall && !isAxisLocked ? getAngleWidget(draftWall.start, draftWall.end) : null
  const draftWallMidpoint = draftWall
    ? toCanvasPoint({
        x: (draftWall.start.x + draftWall.end.x) / 2,
        y: (draftWall.start.y + draftWall.end.y) / 2,
      })
    : null
  const draftLengthPanelPosition = draftWallMidpoint
    ? {
        left: draftWallMidpoint.x * viewport.scale + viewport.x,
        top: draftWallMidpoint.y * viewport.scale + viewport.y,
      }
    : null
  const draftAngleDisplay = draftWall
    ? draftAngleInput ?? Math.round(getAngleDegrees(draftWall.start, draftWall.end)).toString()
    : ''

  const updateDraftLength = (value: string) => {
    setDraftLengthInput(value)
  }

  const updateDraftAngle = (value: string) => {
    setDraftAngleInput(value)
  }

  const dimensionRulers = walls.flatMap((wall) =>
    getDimensionGuides(wall, walls).map((guide, index) => {
      const start = toCanvasPoint(guide.start)
      const end = toCanvasPoint(guide.end)
      const faceStart = toCanvasPoint(guide.faceStart)
      const faceEnd = toCanvasPoint(guide.faceEnd)
      const labelPoint = toCanvasPoint(guide.labelPoint)
      const [startTickA, startTickB] = getDimensionCrossTick(
        guide.start,
        guide.rotation,
      ).map(toCanvasPoint)
      const [endTickA, endTickB] = getDimensionCrossTick(
        guide.end,
        guide.rotation,
      ).map(toCanvasPoint)
      const textRotation =
        guide.rotation > 90 || guide.rotation < -90
          ? guide.rotation + 180
          : guide.rotation

      return (
        <Fragment key={`${wall.id}-dimension-${index}`}>
          <Line
            points={[start.x, start.y, end.x, end.y]}
            stroke="#64748b"
            strokeWidth={1}
            dash={[4, 5]}
          />
          {guide.tickMode === 'connector' ? (
            <>
              <Line
                points={[faceStart.x, faceStart.y, start.x, start.y]}
                stroke="#64748b"
                strokeWidth={1}
              />
              <Line
                points={[faceEnd.x, faceEnd.y, end.x, end.y]}
                stroke="#64748b"
                strokeWidth={1}
              />
            </>
          ) : (
            <>
              <Line
                points={[startTickA.x, startTickA.y, startTickB.x, startTickB.y]}
                stroke="#64748b"
                strokeWidth={1}
              />
              <Line
                points={[endTickA.x, endTickA.y, endTickB.x, endTickB.y]}
                stroke="#64748b"
                strokeWidth={1}
              />
            </>
          )}
          <Text
            x={labelPoint.x}
            y={labelPoint.y}
            width={70}
            offsetX={35}
            offsetY={8}
            align="center"
            text={guide.text}
            fill="#475569"
            fontSize={12}
            fontStyle="bold"
            rotation={textRotation}
          />
        </Fragment>
      )
    }),
  )

  return (
    <section className="editor-pane">
      <div className="pane-header">
        <h2>2D Floorplan</h2>
        <span>
          {isAddingWall
            ? draftWall
              ? 'Move pointer, Ctrl for free angle'
              : 'Click to start wall'
            : 'Select Add Wall'}
        </span>
        <div className="zoom-controls" aria-label="2D zoom controls">
          <button type="button" onClick={() => zoomAtCenter(1 / ZOOM_STEP)}>
            -
          </button>
          <button
            type="button"
            onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button type="button" onClick={() => zoomAtCenter(ZOOM_STEP)}>
            +
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={isMiddlePanning ? 'canvas-host panning' : 'canvas-host'}
      >
        <Stage
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          draggable={!isAddingWall && !draftWall && !isMiddlePanning}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => {
            if (event.evt.button === 1 || middlePanRef.current) {
              stopMiddlePan()
            }
          }}
          onDragMove={(event) => {
            setViewport((currentViewport) => ({
              ...currentViewport,
              x: event.target.x(),
              y: event.target.y(),
            }))
          }}
          onWheel={handleWheel}
          onPointerLeave={() => {
            if (middlePanRef.current) {
              stopMiddlePan()
            }

            setHoverAlignmentGuide(null)

            if (!draftWall) {
              setHoverSnapTarget(null)
            }
          }}
        >
          <Layer>
            <Rect
              x={visibleBounds.left}
              y={visibleBounds.top}
              width={visibleBounds.right - visibleBounds.left}
              height={visibleBounds.bottom - visibleBounds.top}
              fill="#f8fafc"
            />
            {verticalGridLines.map((position) => (
              <Line
                key={`vertical-${position}`}
                points={[position, visibleBounds.top, position, visibleBounds.bottom]}
                stroke="#e2e8f0"
                strokeWidth={1 / viewport.scale}
              />
            ))}
            {horizontalGridLines.map((position) => (
              <Line
                key={`horizontal-${position}`}
                points={[visibleBounds.left, position, visibleBounds.right, position]}
                stroke="#e2e8f0"
                strokeWidth={1 / viewport.scale}
              />
            ))}
          </Layer>

          <Layer>
            {referenceFloors.flatMap((floor) =>
              getRenderedWalls(floor.walls).map((renderedWall) => {
                const polygon = getWallPolygon(renderedWall).flatMap((point) => {
                  const canvasPoint = toCanvasPoint(point)
                  return [canvasPoint.x, canvasPoint.y]
                })

                return (
                  <Line
                    key={`${floor.id}-${renderedWall.wall.id}`}
                    points={polygon}
                    closed
                    fill="#64748b"
                    opacity={0.2}
                    listening={false}
                  />
                )
              }),
            )}

            {renderedWalls.map((renderedWall) => {
              const polygon = getWallPolygon(renderedWall).flatMap((point) => {
                const canvasPoint = toCanvasPoint(point)
                return [canvasPoint.x, canvasPoint.y]
              })

              return (
                <Line
                  key={renderedWall.wall.id}
                  points={polygon}
                  closed
                  fill="#1e293b"
                  stroke={
                    renderedWall.wall.id === selectedWallId ? '#2563eb' : '#0f172a'
                  }
                  strokeWidth={renderedWall.wall.id === selectedWallId ? 3 : 1}
                  lineJoin="miter"
                  onClick={() => onSelectWall(renderedWall.wall.id)}
                  onContextMenu={(event) =>
                    openWallContextMenu(renderedWall.wall.id, event)
                  }
                  onTap={() => onSelectWall(renderedWall.wall.id)}
                />
              )
            })}

            {dimensionRulers}

            {draftWall ? (
              <Line
                points={[
                  toCanvasPoint(draftWall.start).x,
                  toCanvasPoint(draftWall.start).y,
                  toCanvasPoint(draftWall.end).x,
                  toCanvasPoint(draftWall.end).y,
                ]}
                stroke="#2563eb"
                strokeWidth={0.3 * METERS_TO_PIXELS}
                dash={[10, 8]}
                lineCap="butt"
              />
            ) : null}

            {angleWidget && draftWall ? (
              <>
                <Line
                  points={[
                    toCanvasPoint(draftWall.start).x,
                    toCanvasPoint(draftWall.start).y,
                    toCanvasPoint(angleWidget.baselineEnd).x,
                    toCanvasPoint(angleWidget.baselineEnd).y,
                  ]}
                  stroke="#f97316"
                  strokeWidth={1.25}
                  dash={[4, 4]}
                />
                <Line
                  points={angleWidget.arcPoints}
                  stroke="#f97316"
                  strokeWidth={2}
                />
                <Circle
                  x={toCanvasPoint(draftWall.start).x}
                  y={toCanvasPoint(draftWall.start).y}
                  radius={4}
                  fill="#ffffff"
                  stroke="#f97316"
                  strokeWidth={2}
                />
                <Rect
                  x={toCanvasPoint(angleWidget.labelPoint).x - 22}
                  y={toCanvasPoint(angleWidget.labelPoint).y - 12}
                  width={44}
                  height={24}
                  fill="#ffffff"
                  stroke="#fed7aa"
                  strokeWidth={1}
                  cornerRadius={4}
                  shadowColor="#0f172a"
                  shadowOpacity={0.1}
                  shadowBlur={6}
                  shadowOffsetY={2}
                />
                <Text
                  x={toCanvasPoint(angleWidget.labelPoint).x - 20}
                  y={toCanvasPoint(angleWidget.labelPoint).y - 7}
                  width={40}
                  align="center"
                  text={angleWidget.label}
                  fill="#c2410c"
                  fontSize={12}
                  fontStyle="bold"
                />
              </>
            ) : null}

            {draftWallLength !== null && draftWallMidpoint ? (
              <>
                <Rect
                  x={draftWallMidpoint.x + 10}
                  y={draftWallMidpoint.y - 27}
                  width={76}
                  height={24}
                  fill="#ffffff"
                  stroke="#bfdbfe"
                  strokeWidth={1}
                  cornerRadius={4}
                  shadowColor="#0f172a"
                  shadowOpacity={0.12}
                  shadowBlur={8}
                  shadowOffsetY={2}
                />
                <Text
                  x={draftWallMidpoint.x + 18}
                  y={draftWallMidpoint.y - 21}
                  width={60}
                  align="center"
                  text={`${draftWallLength.toFixed(2)} m`}
                  fill="#1d4ed8"
                  fontSize={13}
                  fontStyle="bold"
                />
              </>
            ) : null}

            {hoverAlignmentGuide ? (
              <Line
                points={[
                  toCanvasPoint(hoverAlignmentGuide.endpoint).x,
                  toCanvasPoint(hoverAlignmentGuide.endpoint).y,
                  toCanvasPoint(hoverAlignmentGuide.projection).x,
                  toCanvasPoint(hoverAlignmentGuide.projection).y,
                ]}
                stroke="#16a34a"
                strokeWidth={1.5}
                dash={[5, 6]}
              />
            ) : null}

            {hoverSnapTarget ? (
              <>
                {[
                  [-1, -1],
                  [1, -1],
                  [1, 1],
                  [-1, 1],
                ].map(([xDirection, yDirection]) => {
                  const snapPoint = toCanvasPoint(hoverSnapTarget.point)
                  const markerColor =
                    hoverSnapTarget.label || hoverSnapTarget.kind === 'endpoint'
                      ? '#16a34a'
                      : '#f97316'

                  return (
                    <Line
                      key={`${xDirection}-${yDirection}`}
                      points={[
                        snapPoint.x + xDirection * SNAP_MARKER_INNER_RADIUS,
                        snapPoint.y + yDirection * SNAP_MARKER_INNER_RADIUS,
                        snapPoint.x + xDirection * SNAP_MARKER_OUTER_RADIUS,
                        snapPoint.y + yDirection * SNAP_MARKER_OUTER_RADIUS,
                      ]}
                      stroke={markerColor}
                      strokeWidth={2}
                      lineCap="round"
                      listening={false}
                    />
                  )
                })}
                {hoverSnapTarget.label ? (
                  <Text
                    x={toCanvasPoint(hoverSnapTarget.point).x - 13}
                    y={toCanvasPoint(hoverSnapTarget.point).y - 23}
                    width={26}
                    align="center"
                    text={hoverSnapTarget.label}
                    fill="#15803d"
                    fontSize={8}
                    fontStyle="bold"
                    listening={false}
                  />
                ) : null}
              </>
            ) : null}

            {walls.length === 0 && !draftWall ? (
              <Text
                x={24}
                y={24}
                text="Click Add Wall, then drag on the grid."
                fill="#64748b"
                fontSize={15}
              />
            ) : null}
          </Layer>
        </Stage>

        {(draftLengthInput !== null || draftAngleInput !== null) &&
        draftLengthPanelPosition ? (
          <div
            className="draft-length-panel"
            style={{
              left: draftLengthPanelPosition.left,
              top: draftLengthPanelPosition.top,
            }}
          >
            <label>
              <span>Length</span>
              <input
                ref={lengthInputRef}
                value={draftLengthInput ?? ''}
                inputMode="decimal"
                onChange={(event) => updateDraftLength(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (
                      draftWall &&
                      distance(draftWall.start, draftWall.end) >=
                        MIN_WALL_LENGTH_METERS
                    ) {
                      onAddWall(draftWall)
                    }
                    resetDraftWall()
                  }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  resetDraftWall()
                  onExitAddWall()
                }
              }}
              />
              <span>m</span>
            </label>

            <label>
              <span>Angle</span>
              <input
                value={draftAngleDisplay}
                inputMode="decimal"
                onChange={(event) => updateDraftAngle(event.target.value)}
                onFocus={() => {
                  if (draftAngleInput === null && draftWall) {
                    setDraftAngleInput(
                      Math.round(
                        getAngleDegrees(draftWall.start, draftWall.end),
                      ).toString(),
                    )
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (
                      draftWall &&
                      distance(draftWall.start, draftWall.end) >=
                        MIN_WALL_LENGTH_METERS
                    ) {
                      onAddWall(draftWall)
                    }
                    resetDraftWall()
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault()
                    resetDraftWall()
                    onExitAddWall()
                  }
                }}
              />
              <span>deg</span>
            </label>
          </div>
        ) : null}

        {contextMenu ? (
          <div
            className="canvas-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => {
                onDeleteWall(contextMenu.wallId)
                closeContextMenu()
              }}
            >
              Delete wall
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
