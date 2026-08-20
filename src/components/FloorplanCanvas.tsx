/* eslint-disable react-hooks/set-state-in-effect */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { FloorLevel, PlacedModel, Point, Wall, WallKind } from '../types'
import { modelLibrary, modelsById } from '../models/modelLibrary'
import { getRenderedWalls, getWallPolygon } from '../wallGeometry'
import {
  buildWallTopology,
  getOtherNodeConnections,
  getWallEndpointNode,
  type WallTopology,
} from '../wallTopology'
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const METERS_TO_PIXELS = 60
const MIN_WALL_LENGTH_METERS = 0.15
const CONNECTION_SNAP_METERS = 0.25
const WALL_JOIN_EPSILON_METERS = 0.03
const ALIGNMENT_GUIDE_TOLERANCE_METERS = 0.5
const DIMENSION_OFFSET_METERS = 0.28
const DIMENSION_CHEVRON_LENGTH_METERS = 0.09
const DIMENSION_CHEVRON_MAX_SCREEN_PIXELS = 9
const DIMENSION_CHEVRON_ANGLE_RADIANS = Math.PI / 5
const DIMENSION_TICK_METERS = 0.065
const DIMENSION_TICK_MAX_SCREEN_PIXELS = 10
const MIN_ZOOM = 0.45
const MAX_ZOOM = 4
const ZOOM_STEP = 1.2
const MEASUREMENT_TEXT_SCALE_THRESHOLD = 2
const MEASUREMENT_TEXT_FIT_PADDING_METERS = 0.12
const MIN_MEASUREMENT_TEXT_FIT_SCALE = 0.72
const MEASUREMENT_TEXT_OFFSET_METERS = 0.1
const ANGLE_WIDGET_RADIUS_METERS = 0.65
const SNAP_MARKER_INNER_RADIUS = 3
const SNAP_MARKER_OUTER_RADIUS = 9
const DRAFT_EXTERNAL_WALL_THICKNESS = 0.3
const DRAFT_INTERNAL_WALL_THICKNESS = 0.15
const MIN_MODEL_SCALE = 0.2
const MAX_MODEL_SCALE = 5
const MODEL_ROTATION_SNAP_RADIANS = (5 * Math.PI) / 180
const WALL_MODEL_SNAP_DISTANCE_METERS = 0.65
const ROOM_HIGHLIGHT_COLORS = [
  'rgba(14, 165, 233, 0.12)',
  'rgba(16, 185, 129, 0.12)',
  'rgba(245, 158, 11, 0.12)',
  'rgba(168, 85, 247, 0.12)',
  'rgba(244, 63, 94, 0.1)',
  'rgba(20, 184, 166, 0.12)',
]

type FloorplanCanvasProps = {
  activeFloor: FloorLevel
  children?: ReactNode
  floors: FloorLevel[]
  isAddingWall: boolean
  selectedModelId: string | null
  selectedModelIds: string[]
  selectedRoomSignature: string | null
  selectedWallId: string | null
  selectedWallIds: string[]
  wallKind: WallKind
  onAddWall: (wall: { start: Point; end: Point }) => void
  onDeleteModel: (modelId: string) => void
  onDeleteWall: (wallId: string) => void
  onExitAddWall: () => void
  onSelectModel: (modelId: string | null, additive?: boolean) => void
  onSelectRoom: (roomSignature: string | null) => void
  onSelectWall: (wallId: string | null, additive?: boolean) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
  onUpdateWall: (wallId: string, updates: Pick<Wall, 'end' | 'start'>) => void
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

type FloorplanRenderOptions = {
  externalDimensions: boolean
  floorAreaSummary: boolean
  internalDimensions: boolean
  roomAreas: boolean
  roomHighlights: boolean
}

type ContextMenuState = {
  targetId: string
  targetType: 'model' | 'wall'
  x: number
  y: number
}

type PanState = {
  clientX: number
  clientY: number
}

type WallDragState =
  | {
      type: 'wall'
      wallId: string
      startPointer: Point
      startWall: Pick<Wall, 'end' | 'start'>
    }
  | {
      type: 'endpoint'
      endpoint: 'start' | 'end'
      wallId: string
      startPointer: Point
      startWall: Pick<Wall, 'end' | 'start'>
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
  includeEndpoints?: boolean
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
  tickMode: 'connector' | 'cross' | 'internal'
  text: string
  rotation: number
}

type DimensionCandidate = DimensionGuide & {
  blockerCount: number
  segmentEnd: number
  segmentStart: number
  side: -1 | 1
}

type InternalEndpointOffsetDecision = {
  endpoint: 'start' | 'end'
  otherWallId: string
  otherWallKind: WallKind
  reason: string
  side: -1 | 1
}

type InternalBlockerDiagnostic = {
  blockers: Array<[number, number]>
  side: -1 | 1
}

type AngleWidget = {
  arcPoints: number[]
  baselineEnd: Point
  labelPoint: Point
  label: string
}

type ModelBounds = {
  depth: number
  height: number
  width: number
}

const modelPreviewCache = new Map<string, HTMLCanvasElement>()
const modelBoundsCache = new Map<string, ModelBounds>()

function GLBModelPreview({
  height,
  opacity,
  sourceUrl,
  stroke,
  strokeWidth,
  width,
}: {
  height: number
  opacity: number
  sourceUrl: string
  stroke: string
  strokeWidth: number
  width: number
}) {
  const [previewImage, setPreviewImage] = useState<HTMLCanvasElement | null>(
    () => modelPreviewCache.get(sourceUrl) ?? null,
  )

  useEffect(() => {
    if (previewImage || modelPreviewCache.has(sourceUrl)) {
      setPreviewImage(modelPreviewCache.get(sourceUrl) ?? null)
      return
    }

    let isMounted = true
    const loader = new GLTFLoader()

    loader.load(sourceUrl, (gltf) => {
      if (!isMounted) {
        return
      }

      const canvas = document.createElement('canvas')
      const size = 512
      canvas.width = size
      canvas.height = size

      const scene = new Scene()
      const model = gltf.scene.clone(true)
      scene.add(model)

      const bounds = new Box3().setFromObject(model)
      const modelSize = new Vector3()
      const center = new Vector3()
      bounds.getSize(modelSize)
      bounds.getCenter(center)

      const cameraSize = Math.max(modelSize.x, modelSize.z, 0.1) * 0.65
      const camera = new OrthographicCamera(
        -cameraSize,
        cameraSize,
        cameraSize,
        -cameraSize,
        0.01,
        Math.max(modelSize.y * 4, 20),
      )
      camera.position.set(center.x, center.y + Math.max(modelSize.y * 2, 10), center.z)
      camera.lookAt(center)

      scene.add(new AmbientLight('#ffffff', 1.9))
      const light = new DirectionalLight('#ffffff', 2.6)
      light.position.set(center.x + 3, center.y + 6, center.z + 4)
      scene.add(light)

      const renderer = new WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas,
        preserveDrawingBuffer: true,
      })
      renderer.setClearColor(0x000000, 0)
      renderer.setPixelRatio(1)
      renderer.setSize(size, size, false)
      renderer.render(scene, camera)
      renderer.forceContextLoss()
      renderer.dispose()

      modelPreviewCache.set(sourceUrl, canvas)
      setPreviewImage(canvas)
    })

    return () => {
      isMounted = false
    }
  }, [previewImage, sourceUrl])

  return (
    <>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        offsetX={width / 2}
        offsetY={height / 2}
        fill="#ffffff"
        opacity={0.78}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={4}
      />
      {previewImage ? (
        <KonvaImage
          image={previewImage}
          x={0}
          y={0}
          width={width}
          height={height}
          offsetX={width / 2}
          offsetY={height / 2}
          opacity={opacity}
        />
      ) : null}
    </>
  )
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function snapRadians(angle: number, increment: number) {
  return Math.round(angle / increment) * increment
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
  topology: WallTopology,
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
  const measuredFaceDistance = (wall.thickness / 2) * side

  return walls.flatMap((otherWall) => {
    if (otherWall.id === wall.id) {
      return []
    }

    const polygon = topology.wallPolygonsById.get(otherWall.id)

    if (!polygon) {
      return []
    }

    const axisDistances = polygon.map(
      (point) => (point.x - wall.start.x) * unit.x + (point.y - wall.start.y) * unit.y,
    )
    const normalDistances = polygon.map(
      (point) =>
        (point.x - wall.start.x) * normal.x + (point.y - wall.start.y) * normal.y,
    )
    const minAxisDistance = Math.min(...axisDistances)
    const maxAxisDistance = Math.max(...axisDistances)
    const minNormalDistance = Math.min(...normalDistances)
    const maxNormalDistance = Math.max(...normalDistances)
    const touchesStartEndpoint = minAxisDistance <= CONNECTION_SNAP_METERS
    const touchesEndEndpoint = maxAxisDistance >= length - CONNECTION_SNAP_METERS
    const endpointConnection =
      touchesStartEndpoint || touchesEndEndpoint
        ? getOtherNodeConnections(
            topology,
            wall,
            touchesStartEndpoint ? 'start' : 'end',
          ).find((connection) => connection.wall.id === otherWall.id)
        : null

    if (endpointConnection) {
      const otherDirection =
        endpointConnection.endpoint === 'start'
          ? normalize(
              otherWall.end.x - otherWall.start.x,
              otherWall.end.y - otherWall.start.y,
            )
          : normalize(
              otherWall.start.x - otherWall.end.x,
              otherWall.start.y - otherWall.end.y,
            )
      const leavesIntoMeasuredSide =
        otherDirection.x * faceNormal.x + otherDirection.y * faceNormal.y > 0.08

      if (!leavesIntoMeasuredSide) {
        return []
      }
    }

    const crossesMeasuredFace =
      measuredFaceDistance >= minNormalDistance - WALL_JOIN_EPSILON_METERS &&
      measuredFaceDistance <= maxNormalDistance + WALL_JOIN_EPSILON_METERS
    const overlapsWallSpan =
      maxAxisDistance > WALL_JOIN_EPSILON_METERS &&
      minAxisDistance < length - WALL_JOIN_EPSILON_METERS

    if (!crossesMeasuredFace || !overlapsWallSpan) {
      return []
    }

    return [[minAxisDistance, maxAxisDistance] as [number, number]]
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

function getPolygonCentroid(points: Point[]) {
  const signedArea = getSignedArea(points)

  if (Math.abs(signedArea) < 0.0001) {
    return {
      x: points.reduce((total, point) => total + point.x, 0) / points.length,
      y: points.reduce((total, point) => total + point.y, 0) / points.length,
    }
  }

  const factor = points.reduce(
    (total, point, index) => {
      const nextPoint = points[(index + 1) % points.length]
      const cross = point.x * nextPoint.y - nextPoint.x * point.y

      return {
        x: total.x + (point.x + nextPoint.x) * cross,
        y: total.y + (point.y + nextPoint.y) * cross,
      }
    },
    { x: 0, y: 0 },
  )

  return {
    x: factor.x / (6 * signedArea),
    y: factor.y / (6 * signedArea),
  }
}

function pointIsInPolygon(point: Point, polygon: Point[]) {
  let isInside = false

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previousIndex]
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

function getDistanceToPolygonEdge(point: Point, polygon: Point[]) {
  return polygon.reduce((closestDistance, start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    const closestPoint = getClosestPointOnSegment(point, start, end)

    return Math.min(closestDistance, distance(point, closestPoint))
  }, Number.POSITIVE_INFINITY)
}

function getRoomLabelPoint(polygon: Point[]) {
  const centroid = getPolygonCentroid(polygon)
  const bounds = polygon.reduce(
    (currentBounds, point) => ({
      maxX: Math.max(currentBounds.maxX, point.x),
      maxY: Math.max(currentBounds.maxY, point.y),
      minX: Math.min(currentBounds.minX, point.x),
      minY: Math.min(currentBounds.minY, point.y),
    }),
    {
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
    },
  )
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
  const candidates = [centroid, center]
  const sampleCount = 8

  for (let xIndex = 1; xIndex < sampleCount; xIndex += 1) {
    for (let yIndex = 1; yIndex < sampleCount; yIndex += 1) {
      candidates.push({
        x: bounds.minX + ((bounds.maxX - bounds.minX) * xIndex) / sampleCount,
        y: bounds.minY + ((bounds.maxY - bounds.minY) * yIndex) / sampleCount,
      })
    }
  }

  return candidates
    .filter((point) => pointIsInPolygon(point, polygon))
    .sort((firstPoint, secondPoint) => {
      const firstEdgeDistance = getDistanceToPolygonEdge(firstPoint, polygon)
      const secondEdgeDistance = getDistanceToPolygonEdge(secondPoint, polygon)

      return (
        secondEdgeDistance - firstEdgeDistance ||
        distance(firstPoint, centroid) - distance(secondPoint, centroid)
      )
    })[0] ?? centroid
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
  topology: WallTopology,
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
  const connectedEndpointWalls = getOtherNodeConnections(
    topology,
    wall,
    endpoint,
  ).map((connection) => connection.wall)

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

    const renderedOtherWall = topology.renderedWallsById.get(otherWall.id)

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
  _renderedExtension: number,
  walls: Wall[],
  topology: WallTopology,
  decisions?: InternalEndpointOffsetDecision[],
) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return 0
  }

  const unit = { x: dx / length, y: dy / length }
  const endpointPoint = endpoint === 'start' ? wall.start : wall.end
  const normal = { x: -unit.y, y: unit.x }
  const faceNormal = { x: normal.x * side, y: normal.y * side }
  const endpointAxisDistance = endpoint === 'start' ? 0 : length
  const endpointNormalDistance =
    (endpointPoint.x - wall.start.x) * normal.x +
    (endpointPoint.y - wall.start.y) * normal.y
  let offset = 0

  for (const otherWall of walls) {
    if (otherWall.id === wall.id) {
      continue
    }

    const polygon = topology.wallPolygonsById.get(otherWall.id)

    if (!polygon) {
      continue
    }

    const otherDx = otherWall.end.x - otherWall.start.x
    const otherDy = otherWall.end.y - otherWall.start.y
    const otherLength = Math.hypot(otherDx, otherDy)

    if (otherLength === 0) {
      continue
    }

    const otherDirection = {
      x: otherDx / otherLength,
      y: otherDy / otherLength,
    }
    const otherStartDistance = distance(endpointPoint, otherWall.start)
    const otherEndDistance = distance(endpointPoint, otherWall.end)
    const otherDirectionAwayFromEndpoint =
      otherStartDistance <= CONNECTION_SNAP_METERS
        ? otherDirection
        : otherEndDistance <= CONNECTION_SNAP_METERS
          ? { x: -otherDirection.x, y: -otherDirection.y }
          : null
    const isPerpendicular =
      Math.abs(unit.x * otherDirection.x + unit.y * otherDirection.y) <= 0.08

    if (!isPerpendicular) {
      continue
    }

    const adjoiningWallRunsAwayFromMeasuredSide = otherDirectionAwayFromEndpoint
      ? otherDirectionAwayFromEndpoint.x * faceNormal.x +
          otherDirectionAwayFromEndpoint.y * faceNormal.y <=
        0.08
      : false

    if (adjoiningWallRunsAwayFromMeasuredSide) {
      decisions?.push({
        endpoint,
        otherWallId: otherWall.id,
        otherWallKind: otherWall.kind,
        reason: 'using far end-cap face: adjoining wall runs away from measured side',
        side,
      })
    }

    const axisDistances = polygon.map(
      (point) => (point.x - wall.start.x) * unit.x + (point.y - wall.start.y) * unit.y,
    )
    const normalDistances = polygon.map(
      (point) =>
        (point.x - wall.start.x) * normal.x + (point.y - wall.start.y) * normal.y,
    )
    const minAxisDistance = Math.min(...axisDistances)
    const maxAxisDistance = Math.max(...axisDistances)
    const minNormalDistance = Math.min(...normalDistances)
    const maxNormalDistance = Math.max(...normalDistances)
    const endpointIsInsideOtherWallSpan =
      endpointAxisDistance >= minAxisDistance - CONNECTION_SNAP_METERS &&
      endpointAxisDistance <= maxAxisDistance + CONNECTION_SNAP_METERS &&
      endpointNormalDistance >= minNormalDistance - CONNECTION_SNAP_METERS &&
      endpointNormalDistance <= maxNormalDistance + CONNECTION_SNAP_METERS

    if (!endpointIsInsideOtherWallSpan) {
      continue
    }

    const useFarEndCap =
      adjoiningWallRunsAwayFromMeasuredSide && otherWall.kind === 'internal'
    const faceOffset = useFarEndCap
      ? endpoint === 'start'
        ? -minAxisDistance
        : maxAxisDistance - length
      : endpoint === 'start'
        ? -maxAxisDistance
        : minAxisDistance - length

    decisions?.push({
      endpoint,
      otherWallId: otherWall.id,
      otherWallKind: otherWall.kind,
      reason: `offset ${offset.toFixed(3)} -> ${faceOffset.toFixed(3)}`,
      side,
    })
    offset = faceOffset
  }

  return offset
}

function getDimensionGuides(
  wall: Wall,
  walls: Wall[],
  topology: WallTopology,
): DimensionGuide[] {
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
  const isDiagonalWall = Math.abs(unitX) > 0.001 && Math.abs(unitY) > 0.001

  if (!isInternalWall) {
    const side = getExternalDimensionSide(wall, walls)
    const renderedWall = topology.renderedWallsById.get(wall.id)
    const startExtension = getExternalDimensionEndpointOffset(
      wall,
      'start',
      side,
      renderedWall?.startExtension ?? 0,
      walls,
      topology,
    )
    const endExtension = getExternalDimensionEndpointOffset(
      wall,
      'end',
      side,
      renderedWall?.endExtension ?? 0,
      walls,
      topology,
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

  if (isDiagonalWall) {
    return []
  }

  const sides = ([-1, 1] as const).map((side) => ({
    side,
    blockers: getFaceBlockers(wall, side, walls, topology),
  }))
  const candidates = sides.flatMap<DimensionCandidate>(({ side, blockers }) => {
    const renderedWall = topology.renderedWallsById.get(wall.id)
    const startContinuation = getInternalDimensionEndpointOffset(
      wall,
      'start',
      side,
      renderedWall?.startExtension ?? 0,
      walls,
      topology,
    )
    const endContinuation = getInternalDimensionEndpointOffset(
      wall,
      'end',
      side,
      renderedWall?.endExtension ?? 0,
      walls,
      topology,
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
        tickMode: 'internal',
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

function rotateVector(vector: Point, angle: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  }
}

function getDimensionChevron(
  point: Point,
  rotation: number,
  direction: 1 | -1,
  viewportScale: number,
): [Point, Point, Point] {
  const angle = (rotation * Math.PI) / 180
  const axis = {
    x: Math.cos(angle) * direction,
    y: Math.sin(angle) * direction,
  }
  const chevronLengthMeters = Math.min(
    DIMENSION_CHEVRON_LENGTH_METERS,
    DIMENSION_CHEVRON_MAX_SCREEN_PIXELS / viewportScale / METERS_TO_PIXELS,
  )
  const firstArm = rotateVector(axis, DIMENSION_CHEVRON_ANGLE_RADIANS)
  const secondArm = rotateVector(axis, -DIMENSION_CHEVRON_ANGLE_RADIANS)

  return [
    point,
    {
      x: point.x + firstArm.x * chevronLengthMeters,
      y: point.y + firstArm.y * chevronLengthMeters,
    },
    {
      x: point.x + secondArm.x * chevronLengthMeters,
      y: point.y + secondArm.y * chevronLengthMeters,
    },
  ]
}

function getDimensionEndTick(
  point: Point,
  rotation: number,
  viewportScale: number,
): [Point, Point] {
  const angle = (rotation * Math.PI) / 180
  const normal = {
    x: -Math.sin(angle),
    y: Math.cos(angle),
  }
  const tickLengthMeters = Math.min(
    DIMENSION_TICK_METERS,
    DIMENSION_TICK_MAX_SCREEN_PIXELS / viewportScale / METERS_TO_PIXELS,
  )

  return [
    {
      x: point.x - normal.x * tickLengthMeters,
      y: point.y - normal.y * tickLengthMeters,
    },
    {
      x: point.x + normal.x * tickLengthMeters,
      y: point.y + normal.y * tickLengthMeters,
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

function getWallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

function getWallAngle(wall: Wall) {
  return Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x)
}

function getWallMountForPoint(point: Point, walls: Wall[]) {
  const candidates = walls
    .map((wall) => {
      const projection = getProjectionOnSegment(point, wall.start, wall.end)

      return {
        distance: distance(point, projection.point),
        point: projection.point,
        t: projection.t,
        wall,
      }
    })
    .filter((candidate) => candidate.distance <= WALL_MODEL_SNAP_DISTANCE_METERS)
    .sort((firstCandidate, secondCandidate) => firstCandidate.distance - secondCandidate.distance)

  const closest = candidates[0]

  if (!closest) {
    return null
  }

  return {
    position: closest.point,
    rotation: getWallAngle(closest.wall),
    wallAttachment: {
      wallId: closest.wall.id,
      offset: closest.t * getWallLength(closest.wall),
    },
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

function getInternalToExternalSnapPoints(
  wall: Wall,
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
  const halfThickness = wall.thickness / 2
  const renderedStart = {
    x: wall.start.x - unitX * startExtension,
    y: wall.start.y - unitY * startExtension,
  }
  const renderedEnd = {
    x: wall.end.x + unitX * endExtension,
    y: wall.end.y + unitY * endExtension,
  }

  return ([-1, 1] as const).flatMap((side) => {
    const endEdgeStartPoint = {
      x: renderedStart.x + normalX * side * quarterThickness,
      y: renderedStart.y + normalY * side * quarterThickness,
    }
    const endEdgeFinishPoint = {
      x: renderedEnd.x + normalX * side * quarterThickness,
      y: renderedEnd.y + normalY * side * quarterThickness,
    }
    const sideStartPoint = {
      x: renderedStart.x + unitX * quarterThickness + normalX * side * halfThickness,
      y: renderedStart.y + unitY * quarterThickness + normalY * side * halfThickness,
    }
    const sideFinishPoint = {
      x: renderedEnd.x - unitX * quarterThickness + normalX * side * halfThickness,
      y: renderedEnd.y - unitY * quarterThickness + normalY * side * halfThickness,
    }

    return [endEdgeStartPoint, endEdgeFinishPoint, sideStartPoint, sideFinishPoint].map(
      (point) => ({
        start: point,
        end: point,
        endpointsOnly: true,
        label: '1/4',
      }),
    )
  })
}

function getSnapSegments(walls: Wall[], wallKind: WallKind): SnapSegment[] {
  return getRenderedWalls(walls).flatMap(({ wall, startExtension, endExtension }) => {
    const centerSegment = getOffsetSegment(wall, 0, startExtension, endExtension)

    if (wallKind !== 'internal' || wall.kind !== 'external') {
      return [centerSegment]
    }

    return [
      { ...centerSegment, includeEndpoints: false, label: '1/2' },
      ...getInternalToExternalSnapPoints(
        wall,
        startExtension,
        endExtension,
      ),
    ]
  })
}

function getSnapTarget(point: Point, segments: SnapSegment[]): SnapTarget | null {
  let closestEndpointTarget: SnapTarget | null = null
  let closestEndpointDistance = CONNECTION_SNAP_METERS
  let closestJunctionTarget: SnapTarget | null = null
  let closestJunctionDistance = CONNECTION_SNAP_METERS

  for (const segment of segments) {
    if (segment.includeEndpoints !== false) {
      const endpointCandidates: SnapTarget[] = [
        { point: segment.start, kind: 'endpoint', label: segment.label },
        { point: segment.end, kind: 'endpoint', label: segment.label },
      ]

      for (const candidate of endpointCandidates) {
        const candidateDistance = distance(point, candidate.point)

        if (candidateDistance < closestEndpointDistance) {
          closestEndpointDistance = candidateDistance
          closestEndpointTarget = candidate
        }
      }
    }

    if (segment.endpointsOnly) {
      continue
    }

    const junctionCandidate: SnapTarget = {
      point: getClosestPointOnSegment(point, segment.start, segment.end),
      kind: 'junction',
      label: segment.label,
    }
    const junctionDistance = distance(point, junctionCandidate.point)

    if (junctionDistance < closestJunctionDistance) {
      closestJunctionDistance = junctionDistance
      closestJunctionTarget = junctionCandidate
    }
  }

  return closestEndpointTarget ?? closestJunctionTarget
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
  children,
  floors,
  isAddingWall,
  selectedModelId,
  selectedModelIds,
  selectedRoomSignature,
  selectedWallId,
  selectedWallIds,
  wallKind,
  onAddWall,
  onDeleteModel,
  onDeleteWall,
  onExitAddWall,
  onSelectModel,
  onSelectRoom,
  onSelectWall,
  onUpdateModel,
  onUpdateWall,
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
  const wallTopology = useMemo(() => buildWallTopology(walls), [walls])
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
  const [isRenderMenuOpen, setIsRenderMenuOpen] = useState(false)
  const [renderOptions, setRenderOptions] = useState<FloorplanRenderOptions>({
    externalDimensions: true,
    floorAreaSummary: true,
    internalDimensions: true,
    roomAreas: true,
    roomHighlights: true,
  })
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
  const [isDraggingModel, setIsDraggingModel] = useState(false)
  const [isDraggingWall, setIsDraggingWall] = useState(false)
  const [isAxisLocked, setIsAxisLocked] = useState(true)
  const [modelBoundsById, setModelBoundsById] = useState<Record<string, ModelBounds>>(
    {},
  )
  const lengthInputRef = useRef<HTMLInputElement>(null)
  const middlePanRef = useRef<PanState | null>(null)
  const wallDragRef = useRef<WallDragState | null>(null)

  useEffect(() => {
    let isMounted = true
    const loader = new GLTFLoader()

    for (const modelDefinition of modelLibrary) {
      if (!modelDefinition.sourceUrl || modelBoundsCache.has(modelDefinition.id)) {
        continue
      }

      loader.load(modelDefinition.sourceUrl, (gltf) => {
        if (!isMounted) {
          return
        }

        const bounds = new Box3().setFromObject(gltf.scene)
        const size = new Vector3()
        bounds.getSize(size)

        const modelBounds = {
          depth: Math.max(size.z, 0.1),
          height: Math.max(size.y, 0.1),
          width: Math.max(size.x, 0.1),
        }

        modelBoundsCache.set(modelDefinition.id, modelBounds)
        setModelBoundsById((currentBounds) => ({
          ...currentBounds,
          [modelDefinition.id]: modelBounds,
        }))
      })
    }

    setModelBoundsById(
      Object.fromEntries(modelBoundsCache.entries()) as Record<string, ModelBounds>,
    )

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV || !selectedWallId) {
      return
    }

    const selectedWall = walls.find((wall) => wall.id === selectedWallId)

    if (!selectedWall) {
      return
    }

    const dimensionGuides = getDimensionGuides(
      selectedWall,
      walls,
      wallTopology,
    )
    const internalEndpointOffsetDecisions: InternalEndpointOffsetDecision[] = []
    const internalBlockers: InternalBlockerDiagnostic[] = []

    if (selectedWall.kind === 'internal') {
      const renderedWall = wallTopology.renderedWallsById.get(selectedWall.id)

      for (const side of [-1, 1] as const) {
        internalBlockers.push({
          side,
          blockers: getFaceBlockers(selectedWall, side, walls, wallTopology),
        })
        getInternalDimensionEndpointOffset(
          selectedWall,
          'start',
          side,
          renderedWall?.startExtension ?? 0,
          walls,
          wallTopology,
          internalEndpointOffsetDecisions,
        )
        getInternalDimensionEndpointOffset(
          selectedWall,
          'end',
          side,
          renderedWall?.endExtension ?? 0,
          walls,
          wallTopology,
          internalEndpointOffsetDecisions,
        )
      }
    }
    const endpointSummaries = (['start', 'end'] as const).map((endpoint) => {
      const node = getWallEndpointNode(wallTopology, selectedWall.id, endpoint)

      return {
        endpoint,
        point: selectedWall[endpoint],
        connections:
          node?.connections.map((connection) => ({
            endpoint: connection.endpoint,
            id: connection.wall.id,
            kind: connection.wall.kind,
            start: connection.wall.start,
            end: connection.wall.end,
          })) ?? [],
      }
    })

    const diagnostic = {
      wall: selectedWall,
      endpointNodes: endpointSummaries,
      internalEndpointOffsetDecisions,
      internalBlockers,
      dimensionGuides: dimensionGuides.map((guide) => ({
        endX: guide.end.x.toFixed(3),
        endY: guide.end.y.toFixed(3),
        faceEndX: guide.faceEnd.x.toFixed(3),
        faceEndY: guide.faceEnd.y.toFixed(3),
        faceStartX: guide.faceStart.x.toFixed(3),
        faceStartY: guide.faceStart.y.toFixed(3),
        length: guide.text,
        side: 'side' in guide ? guide.side : '',
        startX: guide.start.x.toFixed(3),
        startY: guide.start.y.toFixed(3),
        tickMode: guide.tickMode,
      })),
    }

    console.groupCollapsed(
      `[floorplan geometry] ${selectedWall.kind} wall ${selectedWall.id}`,
    )
    console.log(JSON.stringify(diagnostic, null, 2))
    console.table(diagnostic.dimensionGuides)
    console.groupEnd()
  }, [selectedWallId, wallTopology, walls])

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

  const getPointerPoint = (
    event: KonvaEventObject<DragEvent> | KonvaEventObject<PointerEvent>,
  ) => {
    const point = event.target.getStage()?.getPointerPosition()
    return point
      ? toPlanPoint({
          x: (point.x - viewport.x) / viewport.scale,
          y: (point.y - viewport.y) / viewport.scale,
        })
      : null
  }

  function resetDraftWall() {
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

  const getWallEndpointSnapTarget = (point: Point, wall: Wall) =>
    getSnapTarget(
      point,
      getSnapSegments(
        activeFloor.walls.filter((candidateWall) => candidateWall.id !== wall.id),
        wall.kind,
      ),
    ) ??
    getSnapTarget(
      point,
      getSnapSegments(
        referenceFloors.flatMap((floor) => floor.walls),
        wall.kind,
      ),
    )

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
      targetId: wallId,
      targetType: 'wall',
      x: event.evt.clientX - containerBounds.left,
      y: event.evt.clientY - containerBounds.top,
    })
  }

  const openModelContextMenu = (
    modelId: string,
    event: KonvaEventObject<PointerEvent>,
  ) => {
    event.evt.preventDefault()
    event.cancelBubble = true
    const containerBounds = containerRef.current?.getBoundingClientRect()

    if (!containerBounds) {
      return
    }

    onSelectModel(modelId)
    setContextMenu({
      targetId: modelId,
      targetType: 'model',
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
        onSelectModel(null)
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

  const updateRenderOption = (option: keyof FloorplanRenderOptions) => {
    setRenderOptions((currentOptions) => ({
      ...currentOptions,
      [option]: !currentOptions[option],
    }))
  }

  const roomMetadataBySignature = useMemo(
    () =>
      new Map(
        (activeFloor.rooms ?? []).map((room) => [room.signature, room.name]),
      ),
    [activeFloor.rooms],
  )

  const floorAreaSummaries = useMemo(
    () =>
      floors.map((floor) => {
        const rooms =
          floor.id === activeFloor.id
            ? wallTopology.rooms
            : buildWallTopology(floor.walls).rooms
        const area = rooms.reduce((total, room) => total + room.area, 0)

        return {
          area,
          id: floor.id,
          name: floor.name,
        }
      }),
    [activeFloor.id, floors, wallTopology.rooms],
  )

  const roomRegions =
    renderOptions.roomAreas || renderOptions.roomHighlights
      ? wallTopology.rooms.map((room, index) => {
          const polygonPoints = room.polygon.flatMap((point) => {
            const canvasPoint = toCanvasPoint(point)
            return [canvasPoint.x, canvasPoint.y]
          })
          const center = toCanvasPoint(getRoomLabelPoint(room.polygon))
          const roomName =
            roomMetadataBySignature.get(room.signature) ?? `Room ${index + 1}`
          const isSelectedRoom = room.signature === selectedRoomSignature

          return (
            <Fragment key={room.signature}>
              {renderOptions.roomHighlights ? (
                <Line
                  points={polygonPoints}
                  closed
                  fill={ROOM_HIGHLIGHT_COLORS[index % ROOM_HIGHLIGHT_COLORS.length]}
                  stroke={isSelectedRoom ? '#2563eb' : '#38bdf8'}
                  strokeWidth={isSelectedRoom ? 2 : 1}
                  dash={[6, 6]}
                  listening
                  onClick={() => onSelectRoom(room.signature)}
                  onTap={() => onSelectRoom(room.signature)}
                />
              ) : null}
              {renderOptions.roomAreas ? (
                <Text
                  x={center.x}
                  y={center.y}
                  width={90}
                  offsetX={45}
                  offsetY={8}
                  align="center"
                  text={`${roomName}\n${room.area.toFixed(1)} m2`}
                  fill="#0369a1"
                  fontSize={11}
                  fontStyle="bold"
                  listening={false}
                />
              ) : null}
            </Fragment>
          )
        })
      : []
  const wallOpeningMarkers = renderedWalls.flatMap((renderedWall) => {
    const { wall } = renderedWall
    const wallLength = getWallLength(wall)

    if (wallLength === 0 || !wall.openings?.length) {
      return []
    }

    const direction = {
      x: (wall.end.x - wall.start.x) / wallLength,
      y: (wall.end.y - wall.start.y) / wallLength,
    }
    const rotation = (getWallAngle(wall) * 180) / Math.PI

    return wall.openings.map((opening) => {
      const center = toCanvasPoint({
        x: wall.start.x + direction.x * opening.center,
        y: wall.start.y + direction.y * opening.center,
      })

      return (
        <Group
          key={`${wall.id}-${opening.id}`}
          x={center.x}
          y={center.y}
          rotation={rotation}
          listening={false}
        >
          <Rect
            x={0}
            y={0}
            width={opening.width * METERS_TO_PIXELS}
            height={(wall.thickness + 0.08) * METERS_TO_PIXELS}
            offsetX={(opening.width * METERS_TO_PIXELS) / 2}
            offsetY={((wall.thickness + 0.08) * METERS_TO_PIXELS) / 2}
            fill="#f8fafc"
          />
          <Line
            points={[
              (-opening.width * METERS_TO_PIXELS) / 2,
              0,
              (opening.width * METERS_TO_PIXELS) / 2,
              0,
            ]}
            stroke="#38bdf8"
            strokeWidth={3}
          />
        </Group>
      )
    })
  })
  const modelFootprints = (activeFloor.models ?? []).flatMap((model) => {
    const modelDefinition = modelsById.get(model.modelId)

    if (!modelDefinition) {
      return []
    }

    const center = toCanvasPoint(model.position)
    const modelBounds = modelBoundsById[modelDefinition.id]
    const baseWidth = modelBounds?.width ?? modelDefinition.width
    const baseDepth = modelBounds?.depth ?? modelDefinition.depth
    const modelScale = model.scale ?? 1
    const width = baseWidth * modelScale * METERS_TO_PIXELS
    const height = baseDepth * modelScale * METERS_TO_PIXELS
    const rotation = (model.rotation * 180) / Math.PI
    const isWallMountedModel = Boolean(modelDefinition.wallMount)
    const labelWidth = Math.max(72, width)
    const isSelectedModel =
      model.id === selectedModelId || selectedModelIds.includes(model.id)
    const rotateHandleY = -height / 2 - 28
    const scaleHandle = {
      x: width / 2 + 22,
      y: height / 2 + 22,
    }
    const baseScaleHandleDistance = Math.hypot(
      baseWidth / 2 + 22 / METERS_TO_PIXELS,
      baseDepth / 2 + 22 / METERS_TO_PIXELS,
    )

    return (
      <Group
        key={model.id}
        x={center.x}
        y={center.y}
        rotation={rotation}
        draggable={!isAddingWall}
        listening={!isAddingWall}
        onClick={(event) => {
          event.cancelBubble = true
          onSelectModel(model.id, event.evt.ctrlKey || event.evt.metaKey)
        }}
        onTap={(event) => {
          event.cancelBubble = true
          onSelectModel(model.id)
        }}
        onContextMenu={(event) => openModelContextMenu(model.id, event)}
        onDragMove={(event) => {
          event.cancelBubble = true
          const pointerPosition = toPlanPoint({
            x: event.target.x(),
            y: event.target.y(),
          })
          const wallMount = isWallMountedModel
            ? getWallMountForPoint(pointerPosition, activeFloor.walls)
            : null
          const nextPosition = wallMount?.position ?? pointerPosition

          if (wallMount) {
            event.target.position(toCanvasPoint(wallMount.position))
            event.target.rotation((wallMount.rotation * 180) / Math.PI)
          }

          onUpdateModel(model.id, {
            position: nextPosition,
            rotation: wallMount?.rotation ?? model.rotation,
            wallAttachment: wallMount?.wallAttachment,
          })
        }}
        onDragStart={(event) => {
          event.cancelBubble = true
          setIsDraggingModel(true)
          if (!selectedModelIds.includes(model.id)) {
            onSelectModel(model.id)
          }
        }}
        onDragEnd={(event) => {
          event.cancelBubble = true
          const pointerPosition = toPlanPoint({
            x: event.target.x(),
            y: event.target.y(),
          })
          const wallMount = isWallMountedModel
            ? getWallMountForPoint(pointerPosition, activeFloor.walls)
            : null

          if (wallMount) {
            event.target.position(toCanvasPoint(wallMount.position))
            event.target.rotation((wallMount.rotation * 180) / Math.PI)
            onUpdateModel(model.id, {
              position: wallMount.position,
              rotation: wallMount.rotation,
              wallAttachment: wallMount.wallAttachment,
            })
          }

          setIsDraggingModel(false)
        }}
      >
        {modelDefinition.sourceUrl ? (
          <GLBModelPreview
            height={height}
            opacity={0.92}
            sourceUrl={modelDefinition.sourceUrl}
            stroke={isSelectedModel ? '#2563eb' : '#0f172a'}
            strokeWidth={isSelectedModel ? 3 : 1}
            width={width}
          />
        ) : modelDefinition.shape === 'round' || modelDefinition.shape === 'light' ? (
          <Circle
            x={0}
            y={0}
            radius={Math.max(width, height) / 2}
            fill={modelDefinition.color}
            opacity={0.72}
            stroke={isSelectedModel ? '#2563eb' : '#0f172a'}
            strokeWidth={isSelectedModel ? 3 : 1}
          />
        ) : (
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            offsetX={width / 2}
            offsetY={height / 2}
            fill={modelDefinition.color}
            opacity={0.72}
            stroke={isSelectedModel ? '#2563eb' : '#0f172a'}
            strokeWidth={isSelectedModel ? 3 : 1}
            cornerRadius={4}
          />
        )}
        {modelDefinition.sourceUrl ? null : (
          <Text
            x={0}
            y={0}
            width={labelWidth}
            offsetX={labelWidth / 2}
            offsetY={6}
            align="center"
            text={modelDefinition.name}
            fill="#ffffff"
            fontSize={10}
            fontStyle="bold"
            listening={false}
          />
        )}
        {isSelectedModel ? (
          <>
            <Line
              points={[0, -height / 2, 0, rotateHandleY]}
              stroke="#2563eb"
              strokeWidth={1.5}
              dash={[4, 4]}
              listening={false}
            />
            <Circle
              x={0}
              y={rotateHandleY}
              radius={7}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={2}
              draggable
              onPointerDown={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                setIsDraggingModel(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                const point = getPointerPoint(event)

                if (!point) {
                  return
                }

                const rotation =
                  Math.atan2(
                    point.y - model.position.y,
                    point.x - model.position.x,
                  ) +
                  Math.PI / 2

                onUpdateModel(model.id, {
                  rotation: event.evt.shiftKey
                    ? snapRadians(rotation, MODEL_ROTATION_SNAP_RADIANS)
                    : rotation,
                })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                setIsDraggingModel(false)
              }}
            />
            <Line
              points={[
                width / 2,
                height / 2,
                scaleHandle.x,
                scaleHandle.y,
              ]}
              stroke="#16a34a"
              strokeWidth={1.5}
              dash={[4, 4]}
              listening={false}
            />
            <Rect
              x={scaleHandle.x}
              y={scaleHandle.y}
              width={14}
              height={14}
              offsetX={7}
              offsetY={7}
              fill="#ffffff"
              stroke="#16a34a"
              strokeWidth={2}
              cornerRadius={3}
              draggable
              onPointerDown={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                setIsDraggingModel(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                const point = getPointerPoint(event)

                if (!point || baseScaleHandleDistance <= 0) {
                  return
                }

                onUpdateModel(model.id, {
                  scale: clamp(
                    distance(point, model.position) / baseScaleHandleDistance,
                    MIN_MODEL_SCALE,
                    MAX_MODEL_SCALE,
                  ),
                })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                setIsDraggingModel(false)
              }}
            />
          </>
        ) : null}
      </Group>
    )
  })

  const dimensionRulers = walls.flatMap((wall) =>
    (wall.kind === 'internal'
      ? renderOptions.internalDimensions
      : renderOptions.externalDimensions)
      ? getDimensionGuides(wall, walls, wallTopology).map((guide, index) => {
      const measurementTextScale =
        viewport.scale > MEASUREMENT_TEXT_SCALE_THRESHOLD
          ? MEASUREMENT_TEXT_SCALE_THRESHOLD / viewport.scale
          : 1
      const guideLengthMeters = distance(guide.faceStart, guide.faceEnd)
      const availableTextWidth = Math.max(
        24,
        (guideLengthMeters - MEASUREMENT_TEXT_FIT_PADDING_METERS) *
          METERS_TO_PIXELS,
      )
      const fitTextScale = Math.max(
        MIN_MEASUREMENT_TEXT_FIT_SCALE,
        Math.min(1, availableTextWidth / 70),
      )
      const finalTextScale = measurementTextScale * fitTextScale
      const measurementTextWidth = 70 * finalTextScale
      const start = toCanvasPoint(guide.start)
      const end = toCanvasPoint(guide.end)
      const faceStart = toCanvasPoint(guide.faceStart)
      const faceEnd = toCanvasPoint(guide.faceEnd)
      const labelPoint = toCanvasPoint(guide.labelPoint)
      const guideDx = guide.end.x - guide.start.x
      const guideDy = guide.end.y - guide.start.y
      const guideLength = Math.hypot(guideDx, guideDy)
      const labelNormal =
        guideLength > 0
          ? {
              x: -guideDy / guideLength,
              y: guideDx / guideLength,
            }
          : { x: 0, y: -1 }
      const labelOffset = MEASUREMENT_TEXT_OFFSET_METERS * METERS_TO_PIXELS
      const offsetLabelPoint = {
        x: labelPoint.x + labelNormal.x * labelOffset,
        y: labelPoint.y + labelNormal.y * labelOffset,
      }
      const [startChevronPoint, startChevronA, startChevronB] = getDimensionChevron(
        guide.start,
        guide.rotation,
        1,
        viewport.scale,
      ).map(toCanvasPoint)
      const [endChevronPoint, endChevronA, endChevronB] = getDimensionChevron(
        guide.end,
        guide.rotation,
        -1,
        viewport.scale,
      ).map(toCanvasPoint)
      const [startTickA, startTickB] = getDimensionEndTick(
        guide.start,
        guide.rotation,
        viewport.scale,
      ).map(toCanvasPoint)
      const [endTickA, endTickB] = getDimensionEndTick(
        guide.end,
        guide.rotation,
        viewport.scale,
      ).map(toCanvasPoint)
      const textRotation =
        guide.rotation > 90 || guide.rotation < -90
          ? guide.rotation + 180
          : guide.rotation
      const showConnectorLines =
        guide.tickMode === 'connector' && wall.kind !== 'internal'
      const showChevrons = guide.tickMode !== 'internal'

      return (
        <Fragment key={`${wall.id}-dimension-${index}`}>
          <Line
            points={[start.x, start.y, end.x, end.y]}
            stroke="#64748b"
            strokeWidth={1}
            dash={[4, 5]}
          />
          {showConnectorLines ? (
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
          ) : null}
          <Line
            points={[startTickA.x, startTickA.y, startTickB.x, startTickB.y]}
            stroke="#64748b"
            strokeWidth={1}
            lineCap="round"
          />
          {showChevrons ? (
            <Line
              points={[
                startChevronA.x,
                startChevronA.y,
                startChevronPoint.x,
                startChevronPoint.y,
                startChevronB.x,
                startChevronB.y,
              ]}
              stroke="#64748b"
              strokeWidth={1}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}
          <Line
            points={[endTickA.x, endTickA.y, endTickB.x, endTickB.y]}
            stroke="#64748b"
            strokeWidth={1}
            lineCap="round"
          />
          {showChevrons ? (
            <Line
              points={[
                endChevronA.x,
                endChevronA.y,
                endChevronPoint.x,
                endChevronPoint.y,
                endChevronB.x,
                endChevronB.y,
              ]}
              stroke="#64748b"
              strokeWidth={1}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}
          <Text
            x={offsetLabelPoint.x}
            y={offsetLabelPoint.y}
            width={measurementTextWidth}
            offsetX={measurementTextWidth / 2}
            offsetY={8 * finalTextScale}
            align="center"
            text={guide.text}
            fill="#475569"
            fontSize={12 * finalTextScale}
            fontStyle="bold"
            rotation={textRotation}
          />
        </Fragment>
      )
    })
      : [],
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
        <div className="floorplan-header-controls">
          <div className="render-options">
            <button
              type="button"
              aria-expanded={isRenderMenuOpen}
              onClick={() => setIsRenderMenuOpen((value) => !value)}
            >
              Render
            </button>
            {isRenderMenuOpen ? (
              <div className="render-options-menu">
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.roomHighlights}
                    onChange={() => updateRenderOption('roomHighlights')}
                  />
                  Highlight rooms
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.roomAreas}
                    onChange={() => updateRenderOption('roomAreas')}
                  />
                  Room areas
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.floorAreaSummary}
                    onChange={() => updateRenderOption('floorAreaSummary')}
                  />
                  Floor area summary
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.externalDimensions}
                    onChange={() => updateRenderOption('externalDimensions')}
                  />
                  External dimensions
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.internalDimensions}
                    onChange={() => updateRenderOption('internalDimensions')}
                  />
                  Internal dimensions
                </label>
              </div>
            ) : null}
          </div>
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
          draggable={
            !isAddingWall &&
            !draftWall &&
            !isMiddlePanning &&
            !isDraggingModel &&
            !isDraggingWall
          }
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
            {roomRegions}

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
              const isSelectedWall =
                renderedWall.wall.id === selectedWallId ||
                selectedWallIds.includes(renderedWall.wall.id)

              return (
                <Line
                  key={renderedWall.wall.id}
                  points={polygon}
                  closed
                  draggable={!isAddingWall}
                  fill="#1e293b"
                  stroke={isSelectedWall ? '#2563eb' : '#0f172a'}
                  strokeWidth={isSelectedWall ? 3 : 1}
                  lineJoin="miter"
                  onClick={(event) =>
                    onSelectWall(
                      renderedWall.wall.id,
                      event.evt.ctrlKey || event.evt.metaKey,
                    )
                  }
                  onContextMenu={(event) =>
                    openWallContextMenu(renderedWall.wall.id, event)
                  }
                  onTap={() => onSelectWall(renderedWall.wall.id)}
                  onDragStart={(event) => {
                    event.cancelBubble = true
                    setHoverSnapTarget(null)
                    setHoverAlignmentGuide(null)
                    const pointerPoint = getPointerPoint(event)
                    wallDragRef.current = pointerPoint
                      ? {
                          type: 'wall',
                          wallId: renderedWall.wall.id,
                          startPointer: pointerPoint,
                          startWall: {
                            start: { ...renderedWall.wall.start },
                            end: { ...renderedWall.wall.end },
                          },
                        }
                      : null
                    setIsDraggingWall(true)
                    if (!selectedWallIds.includes(renderedWall.wall.id)) {
                      onSelectWall(renderedWall.wall.id)
                    }
                  }}
                  onDragMove={(event) => {
                    event.cancelBubble = true
                    const dragState = wallDragRef.current
                    const pointerPoint = getPointerPoint(event)

                    if (
                      !dragState ||
                      dragState.type !== 'wall' ||
                      dragState.wallId !== renderedWall.wall.id ||
                      !pointerPoint
                    ) {
                      event.target.position({ x: 0, y: 0 })
                      return
                    }

                    const rawDelta = {
                      x: pointerPoint.x - dragState.startPointer.x,
                      y: pointerPoint.y - dragState.startPointer.y,
                    }
                    const delta =
                      event.evt.shiftKey && Math.abs(rawDelta.x) > Math.abs(rawDelta.y)
                        ? { x: rawDelta.x, y: 0 }
                        : event.evt.shiftKey
                          ? { x: 0, y: rawDelta.y }
                          : rawDelta

                    event.target.position({ x: 0, y: 0 })
                    onUpdateWall(dragState.wallId, {
                      start: {
                        x: dragState.startWall.start.x + delta.x,
                        y: dragState.startWall.start.y + delta.y,
                      },
                      end: {
                        x: dragState.startWall.end.x + delta.x,
                        y: dragState.startWall.end.y + delta.y,
                      },
                    })
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true
                    wallDragRef.current = null
                    event.target.position({ x: 0, y: 0 })
                    setIsDraggingWall(false)
                  }}
                />
              )
            })}

            {renderedWalls.flatMap((renderedWall) => {
              const isSelectedWall =
                renderedWall.wall.id === selectedWallId ||
                selectedWallIds.includes(renderedWall.wall.id)

              if (!isSelectedWall || isAddingWall) {
                return []
              }

              return (['start', 'end'] as const).map((endpoint) => {
                const point = toCanvasPoint(renderedWall.wall[endpoint])

                return (
                  <Circle
                    key={`${renderedWall.wall.id}-${endpoint}-handle`}
                    x={point.x}
                    y={point.y}
                    radius={7}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={2}
                    draggable
                    onDragStart={(event) => {
                      event.cancelBubble = true
                      setHoverSnapTarget(null)
                      setHoverAlignmentGuide(null)
                      const pointerPoint = getPointerPoint(event)
                      wallDragRef.current = pointerPoint
                        ? {
                            type: 'endpoint',
                            endpoint,
                            wallId: renderedWall.wall.id,
                            startPointer: pointerPoint,
                            startWall: {
                              start: { ...renderedWall.wall.start },
                              end: { ...renderedWall.wall.end },
                            },
                          }
                        : null
                      setIsDraggingWall(true)
                    }}
                    onDragMove={(event) => {
                      event.cancelBubble = true
                      const dragState = wallDragRef.current
                      const pointerPoint = getPointerPoint(event)

                      if (
                        !dragState ||
                        dragState.type !== 'endpoint' ||
                        dragState.wallId !== renderedWall.wall.id ||
                        dragState.endpoint !== endpoint ||
                        !pointerPoint
                      ) {
                        event.target.position(point)
                        return
                      }

                      const draggedStartPoint = dragState.startWall[endpoint]
                      const rawPoint = {
                        x:
                          draggedStartPoint.x +
                          pointerPoint.x -
                          dragState.startPointer.x,
                        y:
                          draggedStartPoint.y +
                          pointerPoint.y -
                          dragState.startPointer.y,
                      }
                      const oppositeEndpoint =
                        endpoint === 'start'
                          ? dragState.startWall.end
                          : dragState.startWall.start
                      const lockedPoint =
                        event.evt.shiftKey &&
                        Math.abs(rawPoint.x - oppositeEndpoint.x) >
                          Math.abs(rawPoint.y - oppositeEndpoint.y)
                          ? { x: rawPoint.x, y: oppositeEndpoint.y }
                          : event.evt.shiftKey
                            ? { x: oppositeEndpoint.x, y: rawPoint.y }
                            : rawPoint
                      const snapTarget = getWallEndpointSnapTarget(
                        lockedPoint,
                        renderedWall.wall,
                      )
                      const nextPoint = snapTarget?.point ?? lockedPoint

                      setHoverSnapTarget(snapTarget)
                      event.target.position(toCanvasPoint(nextPoint))
                      onUpdateWall(dragState.wallId, {
                        start:
                          endpoint === 'start'
                            ? nextPoint
                            : dragState.startWall.start,
                        end:
                          endpoint === 'end' ? nextPoint : dragState.startWall.end,
                      })
                    }}
                    onDragEnd={(event) => {
                      event.cancelBubble = true
                      wallDragRef.current = null
                      setHoverSnapTarget(null)
                      setIsDraggingWall(false)
                    }}
                  />
                )
              })
            })}

            {wallOpeningMarkers}

            {modelFootprints}

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

        {renderOptions.floorAreaSummary ? (
          <div className="floor-area-summary">
            {floorAreaSummaries.map((floor) => (
              <div key={floor.id}>
                {floor.name} internal area:{' '}
                {floor.area >= 10 ? floor.area.toFixed(0) : floor.area.toFixed(1)}
                m2
              </div>
            ))}
          </div>
        ) : null}

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
                if (contextMenu.targetType === 'model') {
                  onDeleteModel(contextMenu.targetId)
                } else {
                  onDeleteWall(contextMenu.targetId)
                }
                closeContextMenu()
              }}
            >
              Delete {contextMenu.targetType}
            </button>
          </div>
        ) : null}
      </div>
      {children}
    </section>
  )
}
