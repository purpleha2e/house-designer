/* eslint-disable react-hooks/set-state-in-effect */
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
import type { Stage as KonvaStage } from 'konva/lib/Stage'
import type { FloorLevel, PlacedModel, Point, Wall, WallKind } from '../types'
import {
  getModelAssetUrl,
  modelsById,
} from '../models/modelLibrary'
import { snapStairApertureToWalls } from '../stairPlacement'
import {
  endpointSnapRespectsMinimumJoinAngle,
  wallRespectsMinimumJoinAngles,
} from '../wallJoinConstraints'
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
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

const METERS_TO_PIXELS = 60
const MIN_WALL_LENGTH_METERS = 0.15
const CONNECTION_SNAP_METERS = 0.25
const WALL_JOIN_EPSILON_METERS = 0.03
const ALIGNMENT_GUIDE_TOLERANCE_METERS = 0.5
const WALL_DIRECTION_SNAP_TOLERANCE_METERS = 0.04
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
const MIN_MODEL_SCALE = 0.2
const MAX_MODEL_SCALE = 5
const MODEL_TRANSLATION_STEP_METERS = 0.1
const MODEL_ROTATION_SNAP_RADIANS = (10 * Math.PI) / 180
const MODEL_SCALE_STEP = 0.1
const WALL_DIRECTION_SNAP_RADIANS = Math.PI / 4
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
  internalWallThickness: number
  isAddingWall: boolean
  modelAssetVersion: number
  projectFileName: string
  selectedModelId: string | null
  selectedModelIds: string[]
  selectedRoomSignature: string | null
  selectedWallId: string | null
  selectedWallIds: string[]
  wallHeight: number
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

type TransformMode = 'rotate' | 'scale' | 'translate'

type ModelMoveDragState = {
  axis: 'x' | 'y' | null
  modelId: string
  startPosition: Point
}

type ModelRotateDragState = {
  modelId: string
  startAngle: number
  startRotation: number
}

type ModelScaleDragState = {
  axis: 'x' | 'y' | null
  modelId: string
  startClientX: number
  startClientY: number
  startDepthScale: number
  startDistance: number
  startWidthScale: number
}

type FloorplanRenderOptions = {
  externalDimensions: boolean
  floorAreaSummary: boolean
  internalDimensions: boolean
  roomAreas: boolean
  roomHighlights: boolean
  snapToReferenceFloors: boolean
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
      pendingWall?: Pick<Wall, 'end' | 'start'>
      type: 'wall'
      wallId: string
      startPointer: Point
      startWall: Pick<Wall, 'end' | 'start'>
    }
  | {
      type: 'endpoint'
      endpoint: 'start' | 'end'
      pendingWall?: Pick<Wall, 'end' | 'start'>
      wallId: string
      startPointer: Point
      startWall: Pick<Wall, 'end' | 'start'>
    }

type WallMeasurementEditState = {
  anchorEndpoint: 'end' | 'start'
  movingEndpoint: 'end' | 'start'
  wallId: string
}

type SnapTarget = {
  point: Point
  kind: 'endpoint' | 'junction'
  label?: string
  snapPointRole?: 'external-end-quarter' | 'external-side-quarter' | 'wall-endpoint'
  snapSide?: -1 | 1
  snapWall?: Wall
}

type SnapSegment = {
  start: Point
  end: Point
  endpointsOnly?: boolean
  includeEndpoints?: boolean
  label?: string
  snapPointRole?: 'external-end-quarter' | 'external-side-quarter' | 'wall-endpoint'
  snapSide?: -1 | 1
  snapWall?: Wall
}

type EndpointGuide = {
  endpoint: Point
  projection: Point
  distance: number
  crossDistance: number
}

type AlignmentAxis = 'diagonal-down' | 'diagonal-up' | 'x' | 'y'

type AlignmentGuide = EndpointGuide & {
  axis: AlignmentAxis
}

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
  maxX: number
  maxZ: number
  minX: number
  minZ: number
  width: number
}

const modelPreviewCache = new Map<string, HTMLCanvasElement>()
const modelPreviewPromiseCache = new Map<string, Promise<HTMLCanvasElement>>()
const modelBoundsCache = new Map<string, ModelBounds>()
const modelBoundsPromiseCache = new Map<string, Promise<ModelBounds>>()
const modelGltfPromiseCache = new Map<
  string,
  ReturnType<GLTFLoader['loadAsync']>
>()
const sharedModelKtx2Loader = new KTX2Loader()
let sharedModelKtx2Renderer: WebGLRenderer | null = null

function configureModelGltfLoader(loader: GLTFLoader) {
  if (!sharedModelKtx2Renderer) {
    const canvas = document.createElement('canvas')
    sharedModelKtx2Renderer = new WebGLRenderer({
      canvas,
      powerPreference: 'low-power',
    })
    sharedModelKtx2Loader.detectSupport(sharedModelKtx2Renderer)
  }

  loader.setKTX2Loader(sharedModelKtx2Loader)
}

export function clearFloorplanModelAssetCaches() {
  modelPreviewCache.clear()
  modelPreviewPromiseCache.clear()
  modelBoundsCache.clear()
  modelBoundsPromiseCache.clear()
  modelGltfPromiseCache.clear()
}

function loadModelGltf(sourceUrl: string) {
  const cachedPromise = modelGltfPromiseCache.get(sourceUrl)

  if (cachedPromise) {
    return cachedPromise
  }

  const loader = new GLTFLoader()
  configureModelGltfLoader(loader)
  const promise = loader.loadAsync(sourceUrl)
  modelGltfPromiseCache.set(sourceUrl, promise)
  promise.catch(() => modelGltfPromiseCache.delete(sourceUrl))
  return promise
}

function loadModelBounds(sourceUrl: string) {
  const cachedPromise = modelBoundsPromiseCache.get(sourceUrl)

  if (cachedPromise) {
    return cachedPromise
  }

  const promise = loadModelGltf(sourceUrl).then((gltf) => {
    const bounds = new Box3().setFromObject(gltf.scene)
    const size = new Vector3()
    bounds.getSize(size)
    return {
      depth: Math.max(size.z, 0.1),
      height: Math.max(size.y, 0.1),
      maxX: bounds.max.x,
      maxZ: bounds.max.z,
      minX: bounds.min.x,
      minZ: bounds.min.z,
      width: Math.max(size.x, 0.1),
    }
  })

  modelBoundsPromiseCache.set(sourceUrl, promise)
  promise.catch(() => modelBoundsPromiseCache.delete(sourceUrl))
  return promise
}

function loadModelPreview(sourceUrl: string) {
  const cachedPreview = modelPreviewCache.get(sourceUrl)

  if (cachedPreview) {
    return Promise.resolve(cachedPreview)
  }

  const cachedPromise = modelPreviewPromiseCache.get(sourceUrl)

  if (cachedPromise) {
    return cachedPromise
  }

  const promise = loadModelGltf(sourceUrl).then((gltf) => {
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
    camera.position.set(
      center.x,
      center.y + Math.max(modelSize.y * 2, 10),
      center.z,
    )
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
    return canvas
  })

  modelPreviewPromiseCache.set(sourceUrl, promise)
  promise.then(
    () => modelPreviewPromiseCache.delete(sourceUrl),
    () => modelPreviewPromiseCache.delete(sourceUrl),
  )
  return promise
}

function GLBModelPreview({
  height,
  opacity,
  sourceUrl,
  stroke,
  strokeWidth,
  width,
  x,
  y,
}: {
  height: number
  opacity: number
  sourceUrl: string
  stroke: string
  strokeWidth: number
  width: number
  x: number
  y: number
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
    loadModelPreview(sourceUrl)
      .then((canvas) => {
        if (isMounted) {
          setPreviewImage(canvas)
        }
      })
      .catch(() => undefined)

    return () => {
      isMounted = false
    }
  }, [previewImage, sourceUrl])

  return (
    <>
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#ffffff"
        opacity={0.78}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      {previewImage ? (
        <KonvaImage
          image={previewImage}
          x={x}
          y={y}
          width={width}
          height={height}
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

function dot(first: Point, second: Point) {
  return first.x * second.x + first.y * second.y
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

function getDraftWallThickness(
  wallKind: WallKind,
  internalWallThickness: number,
) {
  return wallKind === 'external'
    ? DRAFT_EXTERNAL_WALL_THICKNESS
    : internalWallThickness
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

function applyMeasuredLengthAndAngleForWall(
  start: Point,
  pointerEnd: Point,
  lengthInput: string | null,
  angleInput: string | null,
  wall: Wall,
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

  const measuredWall: Wall = {
    ...wall,
    start,
    end: initialEnd,
  }
  const centerlineLength = getCenterlineLengthForVisibleLength(
    measuredWall,
    walls,
    typedLength,
  )

  return {
    x: start.x + Math.cos(angle) * centerlineLength,
    y: start.y + Math.sin(angle) * centerlineLength,
  }
}

function applyMeasuredLengthAndAngle(
  start: Point,
  pointerEnd: Point,
  lengthInput: string | null,
  angleInput: string | null,
  wallKind: WallKind,
  internalWallThickness: number,
  roomHeight: number,
  walls: Wall[],
) {
  const draftWall: Wall = {
    id: 'draft-wall',
    kind: wallKind,
    start,
    end: pointerEnd,
    thickness: getDraftWallThickness(wallKind, internalWallThickness),
    height: roomHeight,
  }

  return applyMeasuredLengthAndAngleForWall(
    start,
    pointerEnd,
    lengthInput,
    angleInput,
    draftWall,
    walls,
  )
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

function snapToWallDirection(start: Point, end: Point): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return end
  }

  const snappedAngle =
    Math.round(Math.atan2(dy, dx) / WALL_DIRECTION_SNAP_RADIANS) *
    WALL_DIRECTION_SNAP_RADIANS

  return {
    x: start.x + Math.cos(snappedAngle) * length,
    y: start.y + Math.sin(snappedAngle) * length,
  }
}

function getDistanceFromPointToRay(point: Point, rayStart: Point, rayEnd: Point) {
  const dx = rayEnd.x - rayStart.x
  const dy = rayEnd.y - rayStart.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return distance(point, rayStart)
  }

  return Math.abs((point.x - rayStart.x) * dy - (point.y - rayStart.y) * dx) /
    length
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
  movingWallThickness: number,
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
  const endFaceQuarterThickness = wall.thickness / 4
  const halfThickness = wall.thickness / 2
  const flushInset = movingWallThickness / 2
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
      x: renderedStart.x + normalX * side * endFaceQuarterThickness,
      y: renderedStart.y + normalY * side * endFaceQuarterThickness,
    }
    const endEdgeFinishPoint = {
      x: renderedEnd.x + normalX * side * endFaceQuarterThickness,
      y: renderedEnd.y + normalY * side * endFaceQuarterThickness,
    }
    const sideStartPoint = {
      x: renderedStart.x + unitX * flushInset + normalX * side * halfThickness,
      y: renderedStart.y + unitY * flushInset + normalY * side * halfThickness,
    }
    const sideFinishPoint = {
      x: renderedEnd.x - unitX * flushInset + normalX * side * halfThickness,
      y: renderedEnd.y - unitY * flushInset + normalY * side * halfThickness,
    }

    return [
      { point: endEdgeStartPoint, role: 'external-end-quarter' as const },
      { point: endEdgeFinishPoint, role: 'external-end-quarter' as const },
      { point: sideStartPoint, role: 'external-side-quarter' as const },
      { point: sideFinishPoint, role: 'external-side-quarter' as const },
    ].map(({ point, role }) => ({
        start: point,
        end: point,
        endpointsOnly: true,
        label: '1/4',
        snapPointRole: role,
        snapSide: side,
        snapWall: wall,
      }))
  })
}

function getSnapSegments(
  walls: Wall[],
  wallKind: WallKind,
  movingWallThickness?: number,
): SnapSegment[] {
  return getRenderedWalls(walls).flatMap(({ wall, startExtension, endExtension }) => {
    const centerSegment = getOffsetSegment(wall, 0, startExtension, endExtension)

    if (wallKind !== 'internal' || wall.kind !== 'external') {
      return [
        {
          start: wall.start,
          end: wall.start,
          endpointsOnly: true,
          snapPointRole: 'wall-endpoint',
          snapWall: wall,
        },
        {
          start: wall.end,
          end: wall.end,
          endpointsOnly: true,
          snapPointRole: 'wall-endpoint',
          snapWall: wall,
        },
        centerSegment,
      ]
    }

    return [
      { ...centerSegment, includeEndpoints: false, label: '1/2' },
      ...getInternalToExternalSnapPoints(
        wall,
        startExtension,
        endExtension,
        movingWallThickness ?? wall.thickness,
      ),
    ]
  })
}

function getEndpointSnapPriority(candidate: SnapTarget) {
  return candidate.snapPointRole === 'wall-endpoint' ? 0 : 1
}

function getSnapTarget(point: Point, segments: SnapSegment[]): SnapTarget | null {
  let closestEndpointTarget: SnapTarget | null = null
  let closestEndpointDistance = CONNECTION_SNAP_METERS
  let closestEndpointPriority = Number.POSITIVE_INFINITY
  let closestJunctionTarget: SnapTarget | null = null
  let closestJunctionDistance = CONNECTION_SNAP_METERS

  for (const segment of segments) {
    if (segment.includeEndpoints !== false) {
      const endpointCandidates: SnapTarget[] = [
        {
          point: segment.start,
          kind: 'endpoint',
          label: segment.label,
          snapPointRole: segment.snapPointRole,
          snapSide: segment.snapSide,
          snapWall: segment.snapWall,
        },
        {
          point: segment.end,
          kind: 'endpoint',
          label: segment.label,
          snapPointRole: segment.snapPointRole,
          snapSide: segment.snapSide,
          snapWall: segment.snapWall,
        },
      ]

      for (const candidate of endpointCandidates) {
        const candidateDistance = distance(point, candidate.point)
        const candidatePriority = getEndpointSnapPriority(candidate)

        if (
          candidateDistance < CONNECTION_SNAP_METERS &&
          (candidatePriority < closestEndpointPriority ||
            (candidatePriority === closestEndpointPriority &&
              candidateDistance < closestEndpointDistance))
        ) {
          closestEndpointDistance = candidateDistance
          closestEndpointPriority = candidatePriority
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
      snapPointRole: segment.snapPointRole,
      snapSide: segment.snapSide,
      snapWall: segment.snapWall,
    }
    const junctionDistance = distance(point, junctionCandidate.point)

    if (junctionDistance < closestJunctionDistance) {
      closestJunctionDistance = junctionDistance
      closestJunctionTarget = junctionCandidate
    }
  }

  return closestEndpointTarget ?? closestJunctionTarget
}

function externalSideSnapMatchesMovingWallSide({
  oppositeEndpoint,
  snapTarget,
}: {
  oppositeEndpoint: Point
  snapTarget: SnapTarget
}) {
  if (
    snapTarget.kind !== 'endpoint' ||
    snapTarget.label !== '1/4' ||
    snapTarget.snapSide === undefined ||
    snapTarget.snapWall?.kind !== 'external'
  ) {
    return true
  }

  const wallDx = snapTarget.snapWall.end.x - snapTarget.snapWall.start.x
  const wallDy = snapTarget.snapWall.end.y - snapTarget.snapWall.start.y
  const wallLength = Math.hypot(wallDx, wallDy)

  if (wallLength <= 0.000001) {
    return true
  }

  const movingDirection = {
    x: oppositeEndpoint.x - snapTarget.point.x,
    y: oppositeEndpoint.y - snapTarget.point.y,
  }
  const movingLength = Math.hypot(movingDirection.x, movingDirection.y)

  if (movingLength <= 0.000001) {
    return true
  }

  if (snapTarget.snapPointRole === 'external-end-quarter') {
    const unitWall = {
      x: wallDx / wallLength,
      y: wallDy / wallLength,
    }
    const unitMoving = {
      x: movingDirection.x / movingLength,
      y: movingDirection.y / movingLength,
    }

    return Math.abs(dot(unitMoving, unitWall)) >= Math.cos(Math.PI / 12)
  }

  const normal = {
    x: -wallDy / wallLength * snapTarget.snapSide,
    y: wallDx / wallLength * snapTarget.snapSide,
  }

  return dot(movingDirection, normal) > 0
}

function getDirectionalSnapTarget({
  point,
  rayEnd,
  rayStart,
  segments,
}: {
  point: Point
  rayEnd: Point
  rayStart: Point
  segments: SnapSegment[]
}): SnapTarget | null {
  const rayDx = rayEnd.x - rayStart.x
  const rayDy = rayEnd.y - rayStart.y
  const rayLengthSquared = rayDx * rayDx + rayDy * rayDy

  if (rayLengthSquared <= 0.000001) {
    return getSnapTarget(point, segments)
  }

  let closestEndpointTarget: SnapTarget | null = null
  let closestEndpointDistance = CONNECTION_SNAP_METERS
  let closestEndpointPriority = Number.POSITIVE_INFINITY
  let closestJunctionTarget: SnapTarget | null = null
  let closestJunctionDistance = CONNECTION_SNAP_METERS

  for (const segment of segments) {
    if (segment.includeEndpoints !== false) {
      const endpointCandidates: SnapTarget[] = [
        {
          point: segment.start,
          kind: 'endpoint',
          label: segment.label,
          snapPointRole: segment.snapPointRole,
          snapSide: segment.snapSide,
          snapWall: segment.snapWall,
        },
        {
          point: segment.end,
          kind: 'endpoint',
          label: segment.label,
          snapPointRole: segment.snapPointRole,
          snapSide: segment.snapSide,
          snapWall: segment.snapWall,
        },
      ]

      for (const candidate of endpointCandidates) {
        const candidateRayDistance = getDistanceFromPointToRay(
          candidate.point,
          rayStart,
          rayEnd,
        )
        const candidateDistance = distance(point, candidate.point)
        const candidatePriority = getEndpointSnapPriority(candidate)

        if (
          candidateRayDistance <= WALL_DIRECTION_SNAP_TOLERANCE_METERS &&
          candidateDistance < CONNECTION_SNAP_METERS &&
          (candidatePriority < closestEndpointPriority ||
            (candidatePriority === closestEndpointPriority &&
              candidateDistance < closestEndpointDistance))
        ) {
          closestEndpointDistance = candidateDistance
          closestEndpointPriority = candidatePriority
          closestEndpointTarget = candidate
        }
      }
    }

    if (segment.endpointsOnly) {
      continue
    }

    const segmentDx = segment.end.x - segment.start.x
    const segmentDy = segment.end.y - segment.start.y
    const denominator = rayDx * segmentDy - rayDy * segmentDx

    if (Math.abs(denominator) <= 0.000001) {
      continue
    }

    const startDx = segment.start.x - rayStart.x
    const startDy = segment.start.y - rayStart.y
    const rayT = (startDx * segmentDy - startDy * segmentDx) / denominator
    const segmentT = (startDx * rayDy - startDy * rayDx) / denominator

    if (rayT < 0 || segmentT < 0 || segmentT > 1) {
      continue
    }

    const candidatePoint = {
      x: rayStart.x + rayDx * rayT,
      y: rayStart.y + rayDy * rayT,
    }
    const candidateDistance = distance(point, candidatePoint)

    if (candidateDistance < closestJunctionDistance) {
      closestJunctionDistance = candidateDistance
      closestJunctionTarget = {
        point: candidatePoint,
        kind: 'junction',
        label: segment.label,
        snapPointRole: segment.snapPointRole,
        snapSide: segment.snapSide,
        snapWall: segment.snapWall,
      }
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

function getClosestDirectionalAlignmentGuide({
  directionEnd,
  directionStart,
  point,
  walls,
}: {
  directionEnd: Point
  directionStart: Point
  point: Point
  walls: Wall[]
}): AlignmentGuide | null {
  const dx = directionEnd.x - directionStart.x
  const dy = directionEnd.y - directionStart.y
  const length = Math.hypot(dx, dy)

  if (length <= 0.000001) {
    return null
  }

  const unit = {
    x: dx / length,
    y: dy / length,
  }
  const axis: AlignmentAxis =
    Math.abs(unit.x) > 0.98
      ? 'x'
      : Math.abs(unit.y) > 0.98
        ? 'y'
        : unit.x * unit.y >= 0
          ? 'diagonal-down'
          : 'diagonal-up'
  let closestGuide: AlignmentGuide | null = null
  let closestDistance = ALIGNMENT_GUIDE_TOLERANCE_METERS

  for (const endpoint of walls.flatMap((wall) => [wall.start, wall.end])) {
    const endpointFromStart = {
      x: endpoint.x - directionStart.x,
      y: endpoint.y - directionStart.y,
    }
    const alongDistance =
      endpointFromStart.x * unit.x + endpointFromStart.y * unit.y
    const projection = {
      x: directionStart.x + unit.x * alongDistance,
      y: directionStart.y + unit.y * alongDistance,
    }
    const guideDistance = distance(point, projection)
    const crossDistance = distance(endpoint, projection)

    if (guideDistance <= closestDistance) {
      const closestScore = closestGuide
        ? closestGuide.distance * 2 + closestGuide.crossDistance
        : Number.POSITIVE_INFINITY
      const candidateScore = guideDistance * 2 + crossDistance

      if (candidateScore < closestScore) {
        closestDistance = guideDistance
        closestGuide = {
          axis,
          crossDistance,
          distance: guideDistance,
          endpoint,
          projection,
        }
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
  internalWallThickness,
  isAddingWall,
  modelAssetVersion,
  projectFileName,
  selectedModelId,
  selectedModelIds,
  selectedRoomSignature,
  selectedWallId,
  selectedWallIds,
  wallHeight,
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
  const referenceWalls = useMemo(
    () => referenceFloors.flatMap((floor) => floor.walls),
    [referenceFloors],
  )
  const draftWallThickness = getDraftWallThickness(
    wallKind,
    internalWallThickness,
  )
  const activeSnapSegments = useMemo(
    () => getSnapSegments(walls, wallKind, draftWallThickness),
    [draftWallThickness, walls, wallKind],
  )
  const wallTopology = useMemo(() => buildWallTopology(walls), [walls])
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
    snapToReferenceFloors: false,
  })
  const snapWalls = useMemo(
    () =>
      renderOptions.snapToReferenceFloors
        ? [...walls, ...referenceWalls]
        : walls,
    [referenceWalls, renderOptions.snapToReferenceFloors, walls],
  )
  const stairSnapWalls = useMemo(() => {
    const floorsByElevation = [...floors].sort(
      (firstFloor, secondFloor) => firstFloor.elevation - secondFloor.elevation,
    )
    const activeFloorIndex = floorsByElevation.findIndex(
      (floor) => floor.id === activeFloor.id,
    )
    const upperFloor =
      activeFloorIndex >= 0 ? floorsByElevation[activeFloorIndex + 1] : undefined

    return upperFloor ? [...walls, ...upperFloor.walls] : walls
  }, [activeFloor.id, floors, walls])
  const referenceSnapSegments = useMemo(
    () =>
      renderOptions.snapToReferenceFloors
        ? getSnapSegments(referenceWalls, wallKind, draftWallThickness)
        : [],
    [
      draftWallThickness,
      referenceWalls,
      renderOptions.snapToReferenceFloors,
      wallKind,
    ],
  )
  const [draftWall, setDraftWall] = useState<{ start: Point; end: Point } | null>(
    null,
  )
  const [wallMeasurementEdit, setWallMeasurementEdit] =
    useState<WallMeasurementEditState | null>(null)
  const [hoverSnapTarget, setHoverSnapTarget] = useState<SnapTarget | null>(null)
  const [hoverAlignmentGuide, setHoverAlignmentGuide] =
    useState<AlignmentGuide | null>(null)
  const [draftLengthInput, setDraftLengthInput] = useState<string | null>(null)
  const [draftAngleInput, setDraftAngleInput] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isMiddlePanning, setIsMiddlePanning] = useState(false)
  const [isDraggingModel, setIsDraggingModel] = useState(false)
  const [isDraggingWall, setIsDraggingWall] = useState(false)
  const [transformMode, setTransformMode] =
    useState<TransformMode>('translate')
  const [wallDragPreview, setWallDragPreview] = useState<{
    wall: Pick<Wall, 'end' | 'start'>
    wallId: string
  } | null>(null)
  const [isAxisLocked, setIsAxisLocked] = useState(true)
  const [modelBoundsById, setModelBoundsById] = useState<Record<string, ModelBounds>>(
    {},
  )
  const lengthInputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<KonvaStage | null>(null)
  const middlePanRef = useRef<PanState | null>(null)
  const wallDragRef = useRef<WallDragState | null>(null)
  const modelMoveAxisRef = useRef<'x' | 'y' | null>(null)
  const modelMoveDragRef = useRef<ModelMoveDragState | null>(null)
  const modelRotateDragRef = useRef<ModelRotateDragState | null>(null)
  const modelScaleDragRef = useRef<ModelScaleDragState | null>(null)
  const wallDragPreviewFrameRef = useRef<number | null>(null)
  const pendingWallDragPreviewRef = useRef<typeof wallDragPreview>(null)
  const scheduleWallDragPreview = useCallback(
    (preview: typeof wallDragPreview) => {
      pendingWallDragPreviewRef.current = preview

      if (wallDragPreviewFrameRef.current !== null) {
        return
      }

      wallDragPreviewFrameRef.current = window.requestAnimationFrame(() => {
        wallDragPreviewFrameRef.current = null
        setWallDragPreview(pendingWallDragPreviewRef.current)
      })
    },
    [],
  )
  useEffect(
    () => () => {
      if (wallDragPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(wallDragPreviewFrameRef.current)
        wallDragPreviewFrameRef.current = null
      }
    },
    [],
  )

  useEffect(() => {
    let isMounted = true
    const requiredDefinitions = [
      ...new Map(
        (activeFloor.models ?? [])
          .map((model) => modelsById.get(model.modelId))
          .filter((definition) => definition?.sourceUrl)
          .map((definition) => [definition!.id, definition!] as const),
      ).values(),
    ]
    const cachedBounds = Object.fromEntries(
      requiredDefinitions.flatMap((definition) => {
        const bounds = modelBoundsCache.get(definition.id)
        return bounds ? [[definition.id, bounds] as const] : []
      }),
    ) as Record<string, ModelBounds>
    const missingDefinitions = requiredDefinitions.filter(
      (definition) => !modelBoundsCache.has(definition.id),
    )

    setModelBoundsById(cachedBounds)

    Promise.allSettled(
      missingDefinitions.map(async (definition) => {
        const bounds = await loadModelBounds(
          getModelAssetUrl(definition.sourceUrl!, modelAssetVersion),
        )
        modelBoundsCache.set(definition.id, bounds)
        return [definition.id, bounds] as const
      }),
    ).then((results) => {
      if (!isMounted) {
        return
      }

      const loadedBounds = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )

      if (loadedBounds.length > 0) {
        setModelBoundsById({
          ...cachedBounds,
          ...Object.fromEntries(loadedBounds),
        })
      }
    })

    return () => {
      isMounted = false
    }
  }, [activeFloor.models, modelAssetVersion])

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
              internalWallThickness,
              wallHeight,
              snapWalls,
            ),
          }
        : currentDraftWall,
    )
  }, [
    draftLengthInput,
    draftAngleInput,
    internalWallThickness,
    snapWalls,
    wallHeight,
    wallKind,
  ])

  useEffect(() => {
    if (!wallMeasurementEdit) {
      return
    }

    if (selectedWallId !== wallMeasurementEdit.wallId) {
      closeWallMeasurementEdit()
      return
    }

    const nextWall = getMeasuredSelectedWall(wallMeasurementEdit)

    setWallDragPreview(
      nextWall
        ? {
            wallId: wallMeasurementEdit.wallId,
            wall: nextWall,
          }
        : null,
    )
  }, [draftAngleInput, draftLengthInput, selectedWallId, wallMeasurementEdit, walls])

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
        if (
          distance(draftWall.start, draftWall.end) >= MIN_WALL_LENGTH_METERS &&
          wallRespectsMinimumJoinAngles({
            movingWall: {
              id: '__draft-wall__',
              start: draftWall.start,
              end: draftWall.end,
            },
            tolerance: WALL_JOIN_EPSILON_METERS,
            walls: activeFloor.walls,
          })
        ) {
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
  }, [activeFloor.walls, draftWall, isAddingWall, onAddWall, onExitAddWall])

  useEffect(() => {
    if (isAddingWall || draftWall) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return
      }

      const isLengthKey = /^\d$/.test(event.key) || event.key === '.'
      const selectedWall = selectedWallId
        ? walls.find((wall) => wall.id === selectedWallId)
        : null

      if (!wallMeasurementEdit && (!selectedWall || selectedWallIds.length > 1)) {
        return
      }

      if (
        !isLengthKey &&
        event.key !== 'Backspace' &&
        event.key !== 'Enter' &&
        event.key !== 'Escape'
      ) {
        return
      }

      if (!wallMeasurementEdit && !isLengthKey) {
        return
      }

      event.preventDefault()

      if (event.key === 'Escape') {
        closeWallMeasurementEdit()
        return
      }

      if (event.key === 'Enter') {
        commitWallMeasurementEdit()
        return
      }

      if (!wallMeasurementEdit && selectedWall) {
        const editEndpoints = getWallMeasurementEditEndpoints(selectedWall)

        if (!editEndpoints) {
          return
        }

        setWallMeasurementEdit({
          wallId: selectedWall.id,
          ...editEndpoints,
        })
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
  }, [
    draftWall,
    isAddingWall,
    selectedWallId,
    selectedWallIds.length,
    wallMeasurementEdit,
    walls,
  ])

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

  useEffect(() => {
    if (!isAddingWall) {
      resetDraftWall()
    }
  }, [isAddingWall])

  const getDraftEndPoint = (
    start: Point,
    point: Point,
    event: PointerEvent,
  ) => {
    const basePoint = event.ctrlKey ? point : snapToWallDirection(start, point)

    if (event.shiftKey) {
      return basePoint
    }

    const alignmentGuide = event.ctrlKey
      ? null
      : getClosestDirectionalAlignmentGuide({
          directionEnd: basePoint,
          directionStart: start,
          point: basePoint,
          walls: snapWalls,
        })
    const alignedPoint = applyAlignmentGuide(basePoint, alignmentGuide)
    const preferredSnapTarget = event.ctrlKey
      ? getPreferredSnapTarget(alignedPoint)
      : getPreferredDirectionalSnapTarget({
          point: alignedPoint,
          rayEnd: basePoint,
          rayStart: start,
        })
    const validSnapTarget =
      preferredSnapTarget &&
      externalSideSnapMatchesMovingWallSide({
        oppositeEndpoint: start,
        snapTarget: preferredSnapTarget,
      })
        ? preferredSnapTarget
        : null
    const snappedPoint = validSnapTarget?.point ?? alignedPoint

    return event.ctrlKey ? snappedPoint : snapToWallDirection(start, snappedPoint)
  }

  const getPreferredSnapTarget = (point: Point) =>
    getSnapTarget(point, activeSnapSegments) ??
    getSnapTarget(point, referenceSnapSegments)

  const getPreferredDirectionalSnapTarget = ({
    point,
    rayEnd,
    rayStart,
  }: {
    point: Point
    rayEnd: Point
    rayStart: Point
  }) =>
    getDirectionalSnapTarget({
      point,
      rayEnd,
      rayStart,
      segments: activeSnapSegments,
    }) ??
    getDirectionalSnapTarget({
      point,
      rayEnd,
      rayStart,
      segments: referenceSnapSegments,
    })

  const getPreferredSnapPreviewTarget = (point: Point) =>
    getSnapPreviewTarget(point, activeSnapSegments) ??
    getSnapPreviewTarget(point, referenceSnapSegments)

  const snapToPreferredConnection = (point: Point) =>
    getPreferredSnapTarget(point)?.point ?? point

  const wallEndpointSnapIsValid = ({
    activeWalls,
    endpoint,
    oppositeEndpoint,
    snapTarget,
    wall,
  }: {
    activeWalls: Wall[]
    endpoint: 'end' | 'start'
    oppositeEndpoint: Point
    snapTarget: SnapTarget | null
    wall: Wall
  }) =>
    !(
      snapTarget?.kind === 'endpoint' &&
      (!externalSideSnapMatchesMovingWallSide({
        oppositeEndpoint,
        snapTarget,
      }) ||
        !endpointSnapRespectsMinimumJoinAngle({
          endpoint,
          movingWall: {
            id: wall.id,
            start: endpoint === 'start' ? snapTarget.point : oppositeEndpoint,
            end: endpoint === 'end' ? snapTarget.point : oppositeEndpoint,
          },
          snapPoint: snapTarget.point,
          tolerance: CONNECTION_SNAP_METERS,
          walls: activeWalls,
        }))
    )

  const getWallEndpointSnapTarget = (
    point: Point,
    wall: Wall,
    endpoint: 'end' | 'start',
    oppositeEndpoint: Point,
  ) => {
    const activeWalls = activeFloor.walls.filter(
      (candidateWall) => candidateWall.id !== wall.id,
    )
    const snapSegments = getSnapSegments(activeWalls, wall.kind, wall.thickness)
    const snapTarget = getSnapTarget(point, snapSegments)

    return wallEndpointSnapIsValid({
      activeWalls,
      endpoint,
      oppositeEndpoint,
      snapTarget,
      wall,
    })
      ? snapTarget
      : null
  }

  const getWallEndpointDirectionalSnapTarget = (
    point: Point,
    rayEnd: Point,
    wall: Wall,
    endpoint: 'end' | 'start',
    oppositeEndpoint: Point,
  ) => {
    const activeWalls = activeFloor.walls.filter(
      (candidateWall) => candidateWall.id !== wall.id,
    )
    const snapTarget = getDirectionalSnapTarget({
      point,
      rayEnd,
      rayStart: oppositeEndpoint,
      segments: getSnapSegments(activeWalls, wall.kind, wall.thickness),
    })

    return wallEndpointSnapIsValid({
      activeWalls,
      endpoint,
      oppositeEndpoint,
      snapTarget,
      wall,
    })
      ? snapTarget
      : null
  }

  const getWallMeasurementEditEndpoints = (wall: Wall) => {
    const startAttached =
      getOtherNodeConnections(wallTopology, wall, 'start').length > 0
    const endAttached =
      getOtherNodeConnections(wallTopology, wall, 'end').length > 0

    if (startAttached && endAttached) {
      return null
    }

    return {
      anchorEndpoint: startAttached ? 'start' : endAttached ? 'end' : 'start',
      movingEndpoint: startAttached ? 'end' : endAttached ? 'start' : 'end',
    } satisfies Omit<WallMeasurementEditState, 'wallId'>
  }

  const wallUpdateRespectsMinimumJoinAngles = (
    wallId: string,
    nextWall: Pick<Wall, 'end' | 'start'>,
  ) => {
    const currentWall = activeFloor.walls.find((wall) => wall.id === wallId)

    if (!currentWall) {
      return true
    }

    return wallRespectsMinimumJoinAngles({
      movingWall: {
        id: wallId,
        start: nextWall.start,
        end: nextWall.end,
      },
      tolerance: WALL_JOIN_EPSILON_METERS,
      walls: activeFloor.walls.filter((wall) => wall.id !== wallId),
    })
  }

  const draftWallCanBePlaced = (nextWall: Pick<Wall, 'end' | 'start'>) =>
    wallRespectsMinimumJoinAngles({
      movingWall: {
        id: '__draft-wall__',
        start: nextWall.start,
        end: nextWall.end,
      },
      tolerance: WALL_JOIN_EPSILON_METERS,
      walls: activeFloor.walls,
    })

  const commitDraftWall = (nextWall: Pick<Wall, 'end' | 'start'>) => {
    if (
      distance(nextWall.start, nextWall.end) >= MIN_WALL_LENGTH_METERS &&
      draftWallCanBePlaced(nextWall)
    ) {
      onAddWall(nextWall)
    }
  }

  const getMeasuredSelectedWall = (
    editState: WallMeasurementEditState,
    lengthInput = draftLengthInput,
    angleInput = draftAngleInput,
  ) => {
    const wall = walls.find((candidateWall) => candidateWall.id === editState.wallId)

    if (!wall) {
      return null
    }

    const anchor = wall[editState.anchorEndpoint]
    const currentMovingPoint = wall[editState.movingEndpoint]
    const nextMovingPoint = applyMeasuredLengthAndAngleForWall(
      anchor,
      currentMovingPoint,
      lengthInput,
      angleInput,
      wall,
      walls,
    )
    const nextWall =
      editState.movingEndpoint === 'start'
        ? { start: nextMovingPoint, end: anchor }
        : { start: anchor, end: nextMovingPoint }

    return wallUpdateRespectsMinimumJoinAngles(editState.wallId, nextWall)
      ? nextWall
      : null
  }

  const closeWallMeasurementEdit = () => {
    setWallMeasurementEdit(null)
    setDraftLengthInput(null)
    setDraftAngleInput(null)
    setWallDragPreview(null)
  }

  const commitWallMeasurementEdit = () => {
    if (!wallMeasurementEdit) {
      return
    }

    const nextWall = getMeasuredSelectedWall(wallMeasurementEdit)

    if (nextWall && distance(nextWall.start, nextWall.end) >= MIN_WALL_LENGTH_METERS) {
      onUpdateWall(wallMeasurementEdit.wallId, nextWall)
    }

    closeWallMeasurementEdit()
  }

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
    syncViewportFromStage()
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
                      internalWallThickness,
                      wallHeight,
                      snapWalls,
                    )
                  : pointerEnd
              })(),
            }
          })()
        : draftWall

      commitDraftWall(wallToAdd)

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
      const stage = stageRef.current

      if (stage) {
        stage.position({
          x: stage.x() + deltaX,
          y: stage.y() + deltaY,
        })
        stage.batchDraw()
      }
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
    const basePoint = event.evt.ctrlKey
      ? point
      : snapToWallDirection(draftWall.start, point)
    const alignmentGuide =
      event.evt.ctrlKey || event.evt.shiftKey
        ? null
        : getClosestDirectionalAlignmentGuide({
            directionEnd: basePoint,
            directionStart: draftWall.start,
            point: basePoint,
            walls: snapWalls,
          })
    const snapPreviewPoint = applyAlignmentGuide(basePoint, alignmentGuide)
    const snapPreviewTarget = event.evt.ctrlKey
      ? getPreferredSnapPreviewTarget(snapPreviewPoint)
      : getPreferredDirectionalSnapTarget({
          point: snapPreviewPoint,
          rayEnd: basePoint,
          rayStart: draftWall.start,
        })
    const validSnapPreviewTarget =
      snapPreviewTarget &&
      externalSideSnapMatchesMovingWallSide({
        oppositeEndpoint: draftWall.start,
        snapTarget: snapPreviewTarget,
      })
        ? snapPreviewTarget
        : null

    setIsAxisLocked(!event.evt.ctrlKey)
    setHoverSnapTarget(event.evt.shiftKey ? null : validSnapPreviewTarget)
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
              internalWallThickness,
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

  const syncViewportFromStage = useCallback(() => {
    const stage = stageRef.current

    if (!stage) {
      return
    }

    setViewport((currentViewport) => ({
      ...currentViewport,
      x: stage.x(),
      y: stage.y(),
    }))
  }, [])

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
  const previewWalls = useMemo(
    () =>
      wallDragPreview
        ? walls.map((wall) =>
            wall.id === wallDragPreview.wallId
              ? { ...wall, ...wallDragPreview.wall }
              : wall,
          )
        : walls,
    [wallDragPreview, walls],
  )
  const renderedWalls = useMemo(() => getRenderedWalls(previewWalls), [previewWalls])
  const selectedWallMeasurementPreview =
    wallMeasurementEdit && wallDragPreview?.wallId === wallMeasurementEdit.wallId
      ? wallDragPreview.wall
      : wallMeasurementEdit
        ? walls.find((wall) => wall.id === wallMeasurementEdit.wallId) ?? null
        : null
  const measurementWall = draftWall ?? selectedWallMeasurementPreview
  const measurementAnchor =
    measurementWall && wallMeasurementEdit && !draftWall
      ? measurementWall[wallMeasurementEdit.anchorEndpoint]
      : measurementWall?.start
  const measurementMovingPoint =
    measurementWall && wallMeasurementEdit && !draftWall
      ? measurementWall[wallMeasurementEdit.movingEndpoint]
      : measurementWall?.end
  const draftWallLength = measurementWall
    ? distance(measurementWall.start, measurementWall.end)
    : null
  const angleWidget =
    measurementAnchor && measurementMovingPoint && !isAxisLocked
      ? getAngleWidget(measurementAnchor, measurementMovingPoint)
      : null
  const draftWallMidpoint = measurementWall
    ? toCanvasPoint({
        x: (measurementWall.start.x + measurementWall.end.x) / 2,
        y: (measurementWall.start.y + measurementWall.end.y) / 2,
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
    : measurementAnchor && measurementMovingPoint
      ? draftAngleInput ??
        Math.round(getAngleDegrees(measurementAnchor, measurementMovingPoint)).toString()
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

  const roomRegions = useMemo(
    () =>
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
        : [],
    [
      onSelectRoom,
      renderOptions.roomAreas,
      renderOptions.roomHighlights,
      roomMetadataBySignature,
      selectedRoomSignature,
      wallTopology.rooms,
    ],
  )
  const wallOpeningMarkers = useMemo(() => renderedWalls.flatMap((renderedWall) => {
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
  }), [renderedWalls])
  const modelFootprints = (activeFloor.models ?? []).flatMap((model) => {
    const modelDefinition = modelsById.get(model.modelId)

    if (!modelDefinition) {
      return []
    }

    const center = toCanvasPoint(model.position)
    const modelBounds = modelBoundsById[modelDefinition.id]

    if (modelDefinition.sourceUrl && !modelBounds) {
      return []
    }

    const modelScale = model.scale ?? 1
    const modelWidthScale = model.widthScale ?? 1
    const modelDepthScale = model.depthScale ?? 1
    const nativeWidth = modelBounds?.width ?? modelDefinition.width
    const nativeDepth = modelBounds?.depth ?? modelDefinition.depth
    const targetScaleX =
      modelDefinition.sourceUrl && modelDefinition.normalizeToDimensions
        ? modelDefinition.width / Math.max(nativeWidth, 0.0001)
        : 1
    const targetScaleZ =
      modelDefinition.sourceUrl && modelDefinition.normalizeToDimensions
        ? modelDefinition.depth / Math.max(nativeDepth, 0.0001)
        : 1
    const boundsMinX =
      modelDefinition.sourceUrl && modelBounds
        ? modelBounds.minX * targetScaleX
        : -modelDefinition.width / 2
    const boundsMaxX =
      modelDefinition.sourceUrl && modelBounds
        ? modelBounds.maxX * targetScaleX
        : modelDefinition.width / 2
    const boundsMinZ =
      modelDefinition.sourceUrl && modelBounds
        ? modelBounds.minZ * targetScaleZ
        : -modelDefinition.depth / 2
    const boundsMaxZ =
      modelDefinition.sourceUrl && modelBounds
        ? modelBounds.maxZ * targetScaleZ
        : modelDefinition.depth / 2
    const baseWidth = Math.max(boundsMaxX - boundsMinX, 0.1)
    const baseDepth = Math.max(boundsMaxZ - boundsMinZ, 0.1)
    const width = baseWidth * modelScale * modelWidthScale * METERS_TO_PIXELS
    const height = baseDepth * modelScale * modelDepthScale * METERS_TO_PIXELS
    const footprintX =
      boundsMinX * modelScale * modelWidthScale * METERS_TO_PIXELS
    const footprintY =
      boundsMinZ * modelScale * modelDepthScale * METERS_TO_PIXELS
    const rotation = (model.rotation * 180) / Math.PI
    const isWallMountedModel = Boolean(modelDefinition.wallMount)
    const labelWidth = Math.max(72, width)
    const isSelectedModel =
      model.id === selectedModelId || selectedModelIds.includes(model.id)
    const gizmoScale = 1 / viewport.scale
    const getStairSnap = (
      position: Point,
      nextRotation = model.rotation,
      nextScale = modelScale,
      nextWidthScale = modelWidthScale,
      nextDepthScale = modelDepthScale,
    ) =>
      modelDefinition.objectType === 'stairs'
        ? snapStairApertureToWalls({
            depth: modelDefinition.depth,
            localBounds: {
              maxX: boundsMaxX,
              maxZ: boundsMaxZ,
              minX: boundsMinX,
              minZ: boundsMinZ,
            },
            position,
            rotation: nextRotation,
            scale: nextScale,
            widthScale: nextWidthScale,
            depthScale: nextDepthScale,
            walls: stairSnapWalls,
            width: modelDefinition.width,
          })
        : null
    const getPointerAngleFromModelCenter = (point: Point) =>
      Math.atan2(point.y - model.position.y, point.x - model.position.x)
    const getPointerScaleDistance = (
      point: Point,
      axis: ModelScaleDragState['axis'],
    ) => {
      const localPoint = rotateVector(
        {
          x: point.x - model.position.x,
          y: point.y - model.position.y,
        },
        -model.rotation,
      )

      if (axis === 'x') {
        return Math.abs(localPoint.x)
      }

      if (axis === 'y') {
        return Math.abs(localPoint.y)
      }

      return Math.hypot(localPoint.x, localPoint.y)
    }
    const beginRotateDrag = (point: Point | null) => {
      modelRotateDragRef.current = point
        ? {
            modelId: model.id,
            startAngle: getPointerAngleFromModelCenter(point),
            startRotation: model.rotation,
          }
        : null
    }
    const beginScaleDrag = (
      point: Point | null,
      axis: ModelScaleDragState['axis'],
      event: KonvaEventObject<DragEvent>,
    ) => {
      const fallbackDistance =
        axis === 'x'
          ? baseWidth / 2
          : axis === 'y'
            ? baseDepth / 2
            : Math.hypot(baseWidth / 2, baseDepth / 2)
      const pointerDistance = point
        ? getPointerScaleDistance(point, axis)
        : fallbackDistance * modelScale

      modelScaleDragRef.current = {
        axis,
        modelId: model.id,
        startClientX: event.evt.clientX,
        startClientY: event.evt.clientY,
        startDepthScale: modelDepthScale,
        startDistance: Math.max(pointerDistance, 0.0001),
        startWidthScale: modelWidthScale,
      }
    }
    const updateScaleFromPointer = (
      point: Point | null,
      event: KonvaEventObject<DragEvent>,
    ) => {
      const dragState = modelScaleDragRef.current

      if (!point || !dragState || dragState.modelId !== model.id) {
        return
      }

      const rawScale =
        dragState.axis === null
          ? 1 +
            ((event.evt.clientX - dragState.startClientX) -
              (event.evt.clientY - dragState.startClientY)) /
              120
          : getPointerScaleDistance(point, dragState.axis) /
            dragState.startDistance
      const widthScale =
        dragState.axis === 'y'
          ? dragState.startWidthScale
          : dragState.startWidthScale * rawScale
      const depthScale =
        dragState.axis === 'x'
          ? dragState.startDepthScale
          : dragState.startDepthScale * rawScale
      const nextWidthScale = event.evt.ctrlKey
        ? clamp(widthScale, MIN_MODEL_SCALE, MAX_MODEL_SCALE)
        : clamp(
            Math.round(widthScale / MODEL_SCALE_STEP) * MODEL_SCALE_STEP,
            MIN_MODEL_SCALE,
            MAX_MODEL_SCALE,
          )
      const nextDepthScale = event.evt.ctrlKey
        ? clamp(depthScale, MIN_MODEL_SCALE, MAX_MODEL_SCALE)
        : clamp(
            Math.round(depthScale / MODEL_SCALE_STEP) * MODEL_SCALE_STEP,
            MIN_MODEL_SCALE,
            MAX_MODEL_SCALE,
          )
      const stairSnap = getStairSnap(
        model.position,
        model.rotation,
        modelScale,
        nextWidthScale,
        nextDepthScale,
      )

      onUpdateModel(model.id, {
        position: stairSnap?.position ?? model.position,
        widthScale: nextWidthScale,
        depthScale: nextDepthScale,
      })
    }

    return (
      <Group
        key={model.id}
        x={center.x}
        y={center.y}
        rotation={rotation}
        draggable={!isAddingWall && transformMode === 'translate'}
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
          const rawPosition = toPlanPoint({
            x: event.target.x(),
            y: event.target.y(),
          })
          const dragState = modelMoveDragRef.current
          const rawDelta = dragState
            ? {
                x: rawPosition.x - dragState.startPosition.x,
                y: rawPosition.y - dragState.startPosition.y,
              }
            : { x: 0, y: 0 }
          const constrainedDelta = {
            x: dragState?.axis === 'y' ? 0 : rawDelta.x,
            y: dragState?.axis === 'x' ? 0 : rawDelta.y,
          }
          const delta = event.evt.ctrlKey
            ? constrainedDelta
            : {
                x:
                  Math.round(constrainedDelta.x / MODEL_TRANSLATION_STEP_METERS) *
                  MODEL_TRANSLATION_STEP_METERS,
                y:
                  Math.round(constrainedDelta.y / MODEL_TRANSLATION_STEP_METERS) *
                  MODEL_TRANSLATION_STEP_METERS,
              }
          const pointerPosition = dragState
            ? {
                x: dragState.startPosition.x + delta.x,
                y: dragState.startPosition.y + delta.y,
              }
            : rawPosition
          const wallMount = isWallMountedModel
            ? getWallMountForPoint(pointerPosition, activeFloor.walls)
            : null
          const stairSnap = getStairSnap(pointerPosition)

          if (wallMount) {
            event.target.position(toCanvasPoint(wallMount.position))
            event.target.rotation((wallMount.rotation * 180) / Math.PI)
          } else if (stairSnap) {
            event.target.position(toCanvasPoint(stairSnap.position))
          } else {
            event.target.position(toCanvasPoint(pointerPosition))
          }
        }}
        onDragStart={(event) => {
          event.cancelBubble = true
          setIsDraggingModel(true)
          modelMoveDragRef.current = {
            axis: modelMoveAxisRef.current,
            modelId: model.id,
            startPosition: { ...model.position },
          }
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
          const stairSnap = getStairSnap(pointerPosition)
          const nextPosition =
            wallMount?.position ?? stairSnap?.position ?? pointerPosition
          const updates = {
            position: nextPosition,
            rotation: wallMount?.rotation ?? model.rotation,
            wallAttachment: wallMount?.wallAttachment,
          }

          if (wallMount) {
            event.target.position(toCanvasPoint(wallMount.position))
            event.target.rotation((wallMount.rotation * 180) / Math.PI)
          } else if (stairSnap) {
            event.target.position(toCanvasPoint(stairSnap.position))
          }

          onUpdateModel(model.id, updates)
          modelMoveDragRef.current = null
          modelMoveAxisRef.current = null
          setIsDraggingModel(false)
        }}
      >
        <Group
          rotation={model.flipped ? 180 : 0}
          scaleX={model.mirrored ? -1 : 1}
        >
          {modelDefinition.sourceUrl ? (
            <GLBModelPreview
              height={height}
              opacity={0.92}
              sourceUrl={getModelAssetUrl(
                modelDefinition.sourceUrl,
                modelAssetVersion,
              )}
              stroke={isSelectedModel ? '#2563eb' : '#0f172a'}
              strokeWidth={isSelectedModel ? 3 : 1}
              width={width}
              x={footprintX}
              y={footprintY}
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
        </Group>
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
        {isSelectedModel && transformMode === 'translate' ? (
          <Group rotation={-rotation} scaleX={gizmoScale} scaleY={gizmoScale}>
            <Line
              points={[0, 0, 52, 0]}
              stroke="#dc2626"
              strokeWidth={3}
              hitStrokeWidth={18}
              onPointerDown={() => {
                modelMoveAxisRef.current = 'x'
              }}
            />
            <Line
              points={[52, 0, 42, -6, 42, 6]}
              closed
              fill="#dc2626"
              stroke="#dc2626"
              onPointerDown={() => {
                modelMoveAxisRef.current = 'x'
              }}
            />
            <Line
              points={[0, 0, 0, -52]}
              stroke="#16a34a"
              strokeWidth={3}
              hitStrokeWidth={18}
              onPointerDown={() => {
                modelMoveAxisRef.current = 'y'
              }}
            />
            <Line
              points={[0, -52, -6, -42, 6, -42]}
              closed
              fill="#16a34a"
              stroke="#16a34a"
              onPointerDown={() => {
                modelMoveAxisRef.current = 'y'
              }}
            />
            <Rect
              x={-7}
              y={-7}
              width={14}
              height={14}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={2}
              onPointerDown={() => {
                modelMoveAxisRef.current = null
              }}
            />
          </Group>
        ) : null}
        {isSelectedModel && transformMode === 'rotate' ? (
          <Group rotation={-rotation} scaleX={gizmoScale} scaleY={gizmoScale}>
            <Circle
              x={0}
              y={0}
              radius={13}
              stroke="#111827"
              strokeWidth={1}
              dash={[3, 3]}
              listening={false}
            />
            <Circle
              x={0}
              y={0}
              radius={28}
              stroke="#2563eb"
              strokeWidth={3}
              hitStrokeWidth={18}
              draggable
              onPointerDown={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                beginRotateDrag(getPointerPoint(event))
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                const point = getPointerPoint(event)
                const dragState = modelRotateDragRef.current

                if (!point || !dragState || dragState.modelId !== model.id) {
                  event.target.position({ x: 0, y: 0 })
                  return
                }

                const rotation =
                  dragState.startRotation +
                  getPointerAngleFromModelCenter(point) -
                  dragState.startAngle
                const nextRotation = event.evt.ctrlKey
                  ? rotation
                  : snapRadians(rotation, MODEL_ROTATION_SNAP_RADIANS)
                const stairSnap = getStairSnap(
                  model.position,
                  nextRotation,
                )

                onUpdateModel(model.id, {
                  position: stairSnap?.position ?? model.position,
                  rotation: nextRotation,
                })
                event.target.position({ x: 0, y: 0 })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                modelRotateDragRef.current = null
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(false)
              }}
            />
          </Group>
        ) : null}
        {isSelectedModel && transformMode === 'scale' ? (
          <Group rotation={-rotation} scaleX={gizmoScale} scaleY={gizmoScale}>
            <Line
              points={[0, 0, 52, 0]}
              stroke="#dc2626"
              strokeWidth={3}
              hitStrokeWidth={18}
              draggable
              onPointerDown={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                beginScaleDrag(getPointerPoint(event), 'x', event)
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                updateScaleFromPointer(getPointerPoint(event), event)
                event.target.position({ x: 0, y: 0 })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                modelScaleDragRef.current = null
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(false)
              }}
            />
            <Line
              points={[52, 0, 42, -6, 42, 6]}
              closed
              fill="#dc2626"
              stroke="#dc2626"
              draggable
              onPointerDown={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                beginScaleDrag(getPointerPoint(event), 'x', event)
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                updateScaleFromPointer(getPointerPoint(event), event)
                event.target.position({ x: 0, y: 0 })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                modelScaleDragRef.current = null
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(false)
              }}
            />
            <Line
              points={[0, 0, 0, -52]}
              stroke="#16a34a"
              strokeWidth={3}
              hitStrokeWidth={18}
              draggable
              onPointerDown={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                beginScaleDrag(getPointerPoint(event), 'y', event)
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                updateScaleFromPointer(getPointerPoint(event), event)
                event.target.position({ x: 0, y: 0 })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                modelScaleDragRef.current = null
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(false)
              }}
            />
            <Line
              points={[0, -52, -6, -42, 6, -42]}
              closed
              fill="#16a34a"
              stroke="#16a34a"
              draggable
              onPointerDown={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                beginScaleDrag(getPointerPoint(event), 'y', event)
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                updateScaleFromPointer(getPointerPoint(event), event)
                event.target.position({ x: 0, y: 0 })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                modelScaleDragRef.current = null
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(false)
              }}
            />
            <Rect
              x={-7}
              y={-7}
              width={14}
              height={14}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={2}
              cornerRadius={3}
              draggable
              onPointerDown={(event) => {
                event.cancelBubble = true
              }}
              onDragStart={(event) => {
                event.cancelBubble = true
                beginScaleDrag(getPointerPoint(event), null, event)
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(true)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                updateScaleFromPointer(getPointerPoint(event), event)
                event.target.position({ x: 0, y: 0 })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                modelScaleDragRef.current = null
                event.target.position({ x: 0, y: 0 })
                setIsDraggingModel(false)
              }}
            />
          </Group>
        ) : null}
      </Group>
    )
  })

  const dimensionRulers = useMemo(
    () =>
      walls.flatMap((wall) =>
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
      ),
    [
      renderOptions.externalDimensions,
      renderOptions.internalDimensions,
      viewport.scale,
      wallTopology,
      walls,
    ],
  )

  return (
    <section className="editor-pane">
      <div className="pane-header">
        <h2>{`2D Floorplan (${projectFileName.replace(/(?:\.house)?\.json$/i, '')})`}</h2>
        <span>
          {isAddingWall
            ? draftWall
              ? '45 deg steps, Ctrl for free angle'
              : 'Click to start wall'
            : 'Select Add Wall'}
        </span>
          <div className="floorplan-header-controls">
          <div className="segmented-control compact" aria-label="2D transform mode">
            <button
              type="button"
              className={transformMode === 'translate' ? 'active' : ''}
              onClick={() => setTransformMode('translate')}
            >
              Move
            </button>
            <button
              type="button"
              className={transformMode === 'rotate' ? 'active' : ''}
              onClick={() => setTransformMode('rotate')}
            >
              Rotate
            </button>
            <button
              type="button"
              className={transformMode === 'scale' ? 'active' : ''}
              onClick={() => setTransformMode('scale')}
            >
              Scale
            </button>
          </div>
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
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.snapToReferenceFloors}
                    onChange={() => updateRenderOption('snapToReferenceFloors')}
                  />
                  Snap to other floors
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
          ref={stageRef}
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
          onDragEnd={syncViewportFromStage}
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
                          pendingWall: {
                            start: { ...renderedWall.wall.start },
                            end: { ...renderedWall.wall.end },
                          },
                          startPointer: pointerPoint,
                          startWall: {
                            start: { ...renderedWall.wall.start },
                            end: { ...renderedWall.wall.end },
                          },
                        }
                      : null
                    setWallDragPreview(
                      pointerPoint
                        ? {
                            wallId: renderedWall.wall.id,
                            wall: {
                              start: { ...renderedWall.wall.start },
                              end: { ...renderedWall.wall.end },
                            },
                          }
                        : null,
                    )
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
                    const constrainedDelta =
                      event.evt.shiftKey && Math.abs(rawDelta.x) > Math.abs(rawDelta.y)
                        ? { x: rawDelta.x, y: 0 }
                        : event.evt.shiftKey
                          ? { x: 0, y: rawDelta.y }
                          : rawDelta
                    const delta = event.evt.ctrlKey
                      ? constrainedDelta
                      : {
                          x:
                            Math.round(
                              constrainedDelta.x / MODEL_TRANSLATION_STEP_METERS,
                            ) * MODEL_TRANSLATION_STEP_METERS,
                          y:
                            Math.round(
                              constrainedDelta.y / MODEL_TRANSLATION_STEP_METERS,
                            ) * MODEL_TRANSLATION_STEP_METERS,
                        }

                    const nextWall = {
                      start: {
                        x: dragState.startWall.start.x + delta.x,
                        y: dragState.startWall.start.y + delta.y,
                      },
                      end: {
                        x: dragState.startWall.end.x + delta.x,
                        y: dragState.startWall.end.y + delta.y,
                      },
                    }

                    if (
                      !wallUpdateRespectsMinimumJoinAngles(
                        dragState.wallId,
                        nextWall,
                      )
                    ) {
                      event.target.position({ x: 0, y: 0 })
                      return
                    }

                    dragState.pendingWall = nextWall
                    event.target.position({ x: 0, y: 0 })
                    scheduleWallDragPreview({
                      wallId: dragState.wallId,
                      wall: nextWall,
                    })
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true
                    const dragState = wallDragRef.current

                    if (
                      dragState?.type === 'wall' &&
                      dragState.pendingWall &&
                      wallUpdateRespectsMinimumJoinAngles(
                        dragState.wallId,
                        dragState.pendingWall,
                      )
                    ) {
                      onUpdateWall(dragState.wallId, dragState.pendingWall)
                    }

                    wallDragRef.current = null
                    event.target.position({ x: 0, y: 0 })
                    if (wallDragPreviewFrameRef.current !== null) {
                      window.cancelAnimationFrame(wallDragPreviewFrameRef.current)
                      wallDragPreviewFrameRef.current = null
                    }
                    pendingWallDragPreviewRef.current = null
                    setWallDragPreview(null)
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
                            pendingWall: {
                              start: { ...renderedWall.wall.start },
                              end: { ...renderedWall.wall.end },
                            },
                            startPointer: pointerPoint,
                            startWall: {
                              start: { ...renderedWall.wall.start },
                              end: { ...renderedWall.wall.end },
                            },
                          }
                        : null
                      setWallDragPreview(
                        pointerPoint
                          ? {
                              wallId: renderedWall.wall.id,
                              wall: {
                                start: { ...renderedWall.wall.start },
                                end: { ...renderedWall.wall.end },
                              },
                            }
                          : null,
                      )
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
                      const lockedPoint = event.evt.ctrlKey
                        ? rawPoint
                        : snapToWallDirection(oppositeEndpoint, rawPoint)
                      const alignmentGuide = event.evt.ctrlKey
                        ? null
                        : getClosestDirectionalAlignmentGuide({
                            directionEnd: lockedPoint,
                            directionStart: oppositeEndpoint,
                            point: lockedPoint,
                            walls: activeFloor.walls.filter(
                              (wall) => wall.id !== renderedWall.wall.id,
                            ),
                          })
                      const alignedPoint = applyAlignmentGuide(
                        lockedPoint,
                        alignmentGuide,
                      )
                      const snapTarget = event.evt.ctrlKey
                        ? getWallEndpointSnapTarget(
                            alignedPoint,
                            renderedWall.wall,
                            endpoint,
                            oppositeEndpoint,
                          )
                        : getWallEndpointDirectionalSnapTarget(
                            alignedPoint,
                            alignedPoint,
                            renderedWall.wall,
                            endpoint,
                            oppositeEndpoint,
                          )
                      const nextPoint =
                        snapTarget?.point ?? alignedPoint
                      const nextWall = {
                        start:
                          endpoint === 'start'
                            ? nextPoint
                            : dragState.startWall.start,
                        end:
                          endpoint === 'end' ? nextPoint : dragState.startWall.end,
                      }

                      if (
                        !wallUpdateRespectsMinimumJoinAngles(
                          dragState.wallId,
                          nextWall,
                        )
                      ) {
                        setHoverSnapTarget(null)
                        setHoverAlignmentGuide(null)
                        event.target.position(
                          toCanvasPoint(renderedWall.wall[endpoint]),
                        )
                        return
                      }

                      setHoverSnapTarget(snapTarget)
                      setHoverAlignmentGuide(alignmentGuide)
                      dragState.pendingWall = nextWall
                      event.target.position(toCanvasPoint(nextPoint))
                      scheduleWallDragPreview({
                        wallId: dragState.wallId,
                        wall: nextWall,
                      })
                    }}
                    onDragEnd={(event) => {
                      event.cancelBubble = true
                      const dragState = wallDragRef.current

                      if (dragState?.type === 'endpoint' && dragState.pendingWall) {
                        onUpdateWall(dragState.wallId, dragState.pendingWall)
                      }

                      wallDragRef.current = null
                      setHoverSnapTarget(null)
                      setHoverAlignmentGuide(null)
                      if (wallDragPreviewFrameRef.current !== null) {
                        window.cancelAnimationFrame(wallDragPreviewFrameRef.current)
                        wallDragPreviewFrameRef.current = null
                      }
                      pendingWallDragPreviewRef.current = null
                      setWallDragPreview(null)
                      setIsDraggingWall(false)
                    }}
                  />
                )
              })
            })}

            {wallOpeningMarkers}

            {modelFootprints}

            {dimensionRulers}

            {measurementWall ? (
              <Line
                points={[
                  toCanvasPoint(measurementWall.start).x,
                  toCanvasPoint(measurementWall.start).y,
                  toCanvasPoint(measurementWall.end).x,
                  toCanvasPoint(measurementWall.end).y,
                ]}
                stroke="#2563eb"
                strokeWidth={0.3 * METERS_TO_PIXELS}
                dash={[10, 8]}
                lineCap="butt"
              />
            ) : null}

            {angleWidget && measurementAnchor ? (
              <>
                <Line
                  points={[
                    toCanvasPoint(measurementAnchor).x,
                    toCanvasPoint(measurementAnchor).y,
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
                  x={toCanvasPoint(measurementAnchor).x}
                  y={toCanvasPoint(measurementAnchor).y}
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
                    if (draftWall) {
                      if (
                        distance(draftWall.start, draftWall.end) >=
                          MIN_WALL_LENGTH_METERS
                      ) {
                        commitDraftWall(draftWall)
                      }
                      resetDraftWall()
                    } else {
                      commitWallMeasurementEdit()
                    }
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault()
                    if (draftWall) {
                      resetDraftWall()
                      onExitAddWall()
                    } else {
                      closeWallMeasurementEdit()
                    }
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
                  if (
                    draftAngleInput === null &&
                    measurementAnchor &&
                    measurementMovingPoint
                  ) {
                    setDraftAngleInput(
                      Math.round(
                        getAngleDegrees(measurementAnchor, measurementMovingPoint),
                      ).toString(),
                    )
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (draftWall) {
                      if (
                        distance(draftWall.start, draftWall.end) >=
                          MIN_WALL_LENGTH_METERS
                      ) {
                        commitDraftWall(draftWall)
                      }
                      resetDraftWall()
                    } else {
                      commitWallMeasurementEdit()
                    }
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault()
                    if (draftWall) {
                      resetDraftWall()
                      onExitAddWall()
                    } else {
                      closeWallMeasurementEdit()
                    }
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
