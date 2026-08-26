/* eslint-disable react-hooks/immutability */
import {
  Edges,
  TransformControls,
  useGLTF,
  useProgress,
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO } from '@react-three/postprocessing'
import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Material,
  Matrix3,
  NearestFilter,
  NoColorSpace,
  Object3D,
  Path,
  PointLight,
  Raycaster,
  RawShaderMaterial,
  RepeatWrapping,
  Shape,
  ShapeUtils,
  Box3,
  SRGBColorSpace,
  Spherical,
  SpotLight,
  TextureLoader,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Light,
  type Side,
  type Texture,
  type WebGLRenderer,
} from 'three'
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type {
  FloorLevel,
  PlacedModel,
  Point,
  SelectableSurface,
  SurfaceMaterialAssignment,
  SurfaceMaterialProduct,
  SurfaceWallSide,
  Wall,
  WallKind,
} from '../types'
import { surfaceMaterialsById } from '../materials/materialCatalog'
import { getModelAssetUrl, modelsById } from '../models/modelLibrary'
import {
  getClippedInternalWallRenderExtensions,
  getClippedInternalWallFootprints,
  getExternalWallRenderExtensions,
  unionMiteredWallFootprints,
  type WallFootprintRenderGroup,
  type WallUnionFootprint,
} from '../wallBooleanGeometry'
import { getRenderedWalls, getWallPolygon, type RenderedWall } from '../wallGeometry'
import { buildWallTopology, type DetectedRoom } from '../wallTopology'
import { buildWallBufferGeometryPayload } from '../wallEngine/wallBuffer'
import { buildWallGeometryPlans } from '../wallEngine/wallPlan'
import {
  buildRoomWallSurfacePlans,
  buildRoomSurfaceWallFaces,
  getRoomSurfaceKey,
  type RoomWallSurfacePlan,
} from '../wallEngine/roomSurfaceMesh'
import { buildWallMeshFaces } from '../wallEngine/wallMesh'
import { createWallBufferGeometry } from '../wallEngine/wallThreeGeometry'
import { buildWallGraph, type WallSide } from '../wallEngine/wallGraph'

export function clearThreeDModelAssetCaches() {
  ;(useGLTF as unknown as { clear?: () => void }).clear?.()
}

const WALL_ENGINE_RENDERER_ENABLED = true
const ROOM_SURFACE_WALL_RENDERER_ENABLED = true
const ROOM_SURFACE_DEBUG_OVERLAY_ENABLED = false
const ROOM_BOUNDARY_DEBUG_OVERLAY_ENABLED = false

type ThreeDViewProps = {
  activeFloorId: string
  floors: FloorLevel[]
  modelAssetVersion: number
  onClearSelection: () => void
  onSelectModel: (modelId: string, floorId: string) => void
  onSelectSurface: (surface: SelectableSurface) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
  selectedModelId: string | null
  selectedSurface: SelectableSurface | null
  selectedWallId: string | null
  sceneRevision: number
  showAllFloors: boolean
  surfaceAssignments: SurfaceMaterialAssignment[]
}

type RenderOptions = {
  ambientOcclusion: boolean
  ambientOcclusionIntensity: number
  ambientTerm: number
  daylight: boolean
  floorSlabs: boolean
  groundPlane: boolean
  lightMarkers: boolean
  lightShadows: boolean
  lights: boolean
  nightFill: boolean
  occlusionCulling: boolean
  referenceFloors: boolean
  shadows: boolean
  skybox: boolean
  windowDaylight: boolean
  wireframe: boolean
}

type RenderToggleOption = Exclude<
  keyof RenderOptions,
  'ambientOcclusionIntensity' | 'ambientTerm'
>

type RenderedFloorData = {
  externalWallUnionFootprints: WallUnionFootprint[]
  externalWallUnionWallIds: string[]
  externalWallUnionWalls: Wall[]
  floor: FloorLevel
  geometryContextWalls: Wall[]
  internalWallFootprintGroups: WallFootprintRenderGroup[]
  roomPortals: RoomPortal[]
  wallBodyOccluders: WallBodyOccluder[]
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
}

type RoomPortal = {
  bottom: number
  center: Point
  fromRoomSignature: string
  openingId: string
  toRoomSignature: string
  top: number
  wallId: string
  width: number
}

type FloorVisibilityState = {
  currentRoomSignature: string | null
  floorId: string
  visibleRoomSignatures: string[]
}

type WallBodyOccluder = {
  kind: WallKind
  polygon: Point[]
  renderedWall: RenderedWall
  wallId: string
}

type LocalLightSlot = {
  angle: number
  color: string
  distance: number
  falloff: number
  id: string
  kind: 'point' | 'spot'
  penumbra: number
  position: [number, number, number]
  power: number
  target: [number, number, number]
}

type RendererStats = {
  calls: number
  geometries: number
  programs: number
  textures: number
  triangles: number
}

type EngineActivityMessage = {
  message: string
  minimumVisibleMs?: number
}

type EngineLogEntry = {
  detail?: string
  index: number
  snapshot?: string
  timeMs: number
  type: string
}

type HouseDesignerEngineLogApi = {
  clear: () => void
  current?: () => EngineLogEntry[]
  entries: EngineLogEntry[]
  geometryDump?: (floorId?: string) => WallGeometryDumpEntry[]
  recent: (count?: number) => EngineLogEntry[]
  roomPlans?: () => RoomWallSurfacePlanDebugEntry[]
  roomPlanProblemDetails?: () => RoomWallSurfacePlanProblemDetailEntry[]
  roomPlanProblems?: () => RoomWallSurfacePlanProblemEntry[]
  roomPlanSummary?: () => RoomWallSurfacePlanSummaryEntry[]
  roomSurfaceFaces?: () => RoomSurfaceFaceDebugEntry[]
  roomSurfaceFaceSummary?: () => RoomSurfaceFaceSummaryEntry[]
  wallFaces?: () => WallFaceDebugEntry[]
  routes?: () => WallRenderRouteDebugEntry[]
  summary?: () => Array<{ detail?: string; type: string }>
  tableCurrent?: () => void
  tableGeometryDump?: (floorId?: string) => void
  tableRoomSurfaceFaces?: () => void
  tableRoomSurfaceFaceSummary?: () => void
  tableWallFaces?: () => void
  tableRoomPlanProblemDetails?: () => void
  tableRoomPlans?: () => void
  tableRoomPlanProblems?: () => void
  tableRoomPlanSummary?: () => void
  tableRoutes?: () => void
  table: (count?: number) => void
}

type HouseDesignerWallRenderDebugApi = HouseDesignerEngineLogApi

type WallRenderRouteDebugEntry = {
  engineExclusionReasons?: string[]
  floorId?: string
  kind?: WallKind
  route: string
  wallId: string
}

type WallGeometryDumpEntry = {
  faceCount: number
  faces: Array<{
    bounds: {
      max: [number, number, number]
      min: [number, number, number]
    }
    faceId: string
    kind: string
    materialSource: { role?: string; side?: WallSide; wallId: string }
    pickSource: { role?: string; side?: WallSide; wallId: string }
    wallId: string
  }>
  floorId: string
  graph: {
    crossings: Array<{
      id: string
      leaderWallId: string
      point: [number, number]
      wallIds: string[]
    }>
    endpointNodes: Array<{
      endpoints: Array<{ endpoint: string; wallId: string }>
      id: string
      point: [number, number]
    }>
    sideAttachments: Array<{
      attachedEndpoint: { endpoint: string; wallId: string }
      id: string
      point: [number, number]
      side: WallSide
      targetDistance: number
      targetWallId: string
    }>
  }
  plans: Array<{
    crossings: Array<{ distance: number; leaderWallId: string; role: string }>
    end: Record<string, unknown>
    faces: Array<{ intervals: Array<{ end: number; start: number }>; side: WallSide }>
    length: number
    start: Record<string, unknown>
    wallId: string
  }>
  rooms: Array<{
    area: number
    id: string
    polygon: Array<[number, number]>
    signature: string
    touchedWallIds: string[]
  }>
  walls: Array<{
    end: [number, number]
    endExtension: number
    height: number
    id: string
    kind: WallKind
    length: number
    start: [number, number]
    startExtension: number
    thickness: number
  }>
}

type RoomWallSurfacePlanDebugEntry = {
  floorId: string
  gapCount: number
  gaps: Array<{
    edgeIndex: number
    end: number
    endPoint: [number, number]
    reason: string
    start: number
    startPoint: [number, number]
  }>
  roomId: string
  roomSignature: string
  segmentCount: number
  segments: Array<{
    edgeIndex: number
    end: number
    endPoint: [number, number]
    side: WallSide
    start: number
    startPoint: [number, number]
    wallId: string
  }>
}

type RoomWallSurfacePlanSummaryEntry = {
  cornerGaps: number
  duplicateGaps: number
  floorId: string
  roomId: string
  segmentCount: number
  unmatchedGaps: number
}

type RoomWallSurfacePlanProblemEntry = {
  edgeIndex: number
  end: number
  floorId: string
  reason: string
  roomId: string
  start: number
}

type RoomWallSurfacePlanProblemDetailEntry = RoomWallSurfacePlanProblemEntry & {
  endX: number
  endY: number
  nextSegment?: string
  previousSegment?: string
  startX: number
  startY: number
}

type RoomSurfaceFaceDebugEntry = {
  faceId: string
  floorId: string
  materialRole?: string
  materialSide?: WallSide
  materialWallId: string
  maxX: number
  maxY: number
  minX: number
  minY: number
  pickSide?: WallSide
  pickWallId: string
  uvEnd: number
  uvStart: number
  wallId: string
}

type RoomSurfaceFaceSummaryEntry = {
  faceCount: number
  floorId: string
  materialRole?: string
  materialSide?: WallSide
  materialWallId: string
  pickSide?: WallSide
  pickWallId: string
}

type WallFaceDebugEntry = {
  faceId: string
  floorId: string
  kind: string
  materialRole?: string
  materialSide?: WallSide
  materialWallId: string
  maxX: number
  maxY: number
  minX: number
  minY: number
  normalX: number
  normalY: number
  normalZ: number
  pickSide?: WallSide
  pickWallId: string
  uvEnd: number
  uvStart: number
  wallId: string
}

const ambientOcclusionColor = new Color('black')
const FLOOR_PLANE_MARGIN = 5
const SHADOW_MARGIN = 8
const FOOTPRINT_EPSILON = 0.04
const WALK_CAMERA_SPEED = 4.2
const WALK_CAMERA_SHIFT_MULTIPLIER = 2
const WALK_HEAD_HEIGHT_METERS = 1.8
const WALK_LOOK_SENSITIVITY = 0.002
const WALK_MAX_PITCH_RADIANS = Math.PI / 2 - 0.05
const WINDOW_SILL_HEIGHT_METERS = 0.9
const SUN_MIN_ELEVATION = 0.08
const SUN_MAX_ELEVATION = 1.2
const LIGHT_GIMBAL_KNOB_RADIUS = 42
const MODEL_OUTLINE_COLOR = '#f97316'
const MODEL_BOUNDS_SCALE = 1.035
const MODEL_BOUNDS_LINE_THICKNESS = 0.010
const MODEL_WALL_SNAP_DISTANCE_METERS = 0.75
const FALLBACK_REALTIME_LOCAL_LIGHTS = 8
const MAX_REALTIME_LOCAL_LIGHTS = 11
const MAX_WINDOW_DAYLIGHT_PORTALS = 8
const LOCAL_LIGHT_RENDER_POWER_SCALE = 0.08
const DEFAULT_LOCAL_LIGHT_DISTANCE = 10
const DEFAULT_LOCAL_LIGHT_FALLOFF = 1.15
const WINDOW_DAYLIGHT_PORTAL_DISTANCE = 5.5
const WINDOW_DAYLIGHT_PORTAL_TARGET_DISTANCE = 2.6
const WINDOW_DAYLIGHT_PORTAL_WALL_CLEARANCE = 0.08
const LOCAL_LIGHT_CEILING_CLEARANCE_METERS = 0.55
const PICK_CLICK_TOLERANCE_PIXELS = 3
const MAIN_THREAD_STALL_THRESHOLD_MS = 450
const SKIRTING_HEIGHT_METERS = 0.09
const SKIRTING_DEPTH_METERS = 0.018
const SKIRTING_MIN_SEGMENT_METERS = 0.05
const SKIRTING_OPENING_FLOOR_TOLERANCE_METERS = 0.03
const SKIRTING_OPENING_EDGE_CLEARANCE_METERS = 0.025
const SKIRTING_WALL_MATCH_TOLERANCE_METERS = 0.08
const SKIRTING_DOOR_PROJECTION_TOLERANCE_METERS = 0.18

type AspectRatioMode = 'normal' | 'super-wide' | 'wide'
type TransformMode = 'rotate' | 'scale' | 'translate'

type LightDirection = {
  azimuth: number
  elevation: number
}

type WindowDaylightPortalSlot = {
  angle: number
  color: string
  distance: number
  id: string
  position: [number, number, number]
  power: number
  target: [number, number, number]
}

type WalkNavigationMode = 'look' | 'orbit'

type PickGesture = {
  pointerId: number
  x: number
  y: number
}

type LookGesture = PickGesture

type PickTarget =
  | {
      blocksCollision: boolean
      floorId: string
      kind: 'model'
      modelId: string
      object: Object3D
    }
  | {
      blocksCollision: false
      floorId: string
      groupTargets: Map<number, SelectableSurface>
      kind: 'material-groups'
      object: Object3D
      pickOnly?: boolean
    }
  | {
      blocksCollision: false
      floorId: string
      kind: 'surface'
      object: Object3D
      pickSide?: Side
      surface: SelectableSurface
    }
  | {
      blocksCollision: false
      floorId: string
      kind: 'room-surface-area'
      object: Object3D
      pickSide: Side
      rooms: DetectedRoom[]
      surfaceType: 'ceiling' | 'room-floor'
    }

type ModelHorizontalBounds = {
  maxX: number
  maxZ: number
  minX: number
  minZ: number
}

type PlanAabb = {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

type ObjectTransformSnapshot = {
  position: Vector3
  rotationY: number
  scale: Vector3
}

type WallRenderSegment = {
  leftCapAssignment?: SurfaceMaterialAssignment
  leftCapUvProjector?: WallCapUvProjector
  center: number
  height: number
  length: number
  rightCapAssignment?: SurfaceMaterialAssignment
  rightCapUvProjector?: WallCapUvProjector
  revealBottom: boolean
  revealLeft: boolean
  revealRight: boolean
  skipLeftEndCap: boolean
  skipRightEndCap: boolean
  revealTop: boolean
  y: number
}

type WallCapUvProjector = {
  renderedWall: RenderedWall
}

class ModelLoadBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.warn('Failed to render model in 3D view.', error, errorInfo)
  }

  render() {
    return this.state.hasError ? null : this.props.children
  }
}

class FloorRenderBoundary extends Component<
  { children: ReactNode; floorId: string; resetKey: string },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.warn(
      `Failed to render floor ${this.props.floorId} in 3D view.`,
      error,
      errorInfo,
    )
  }

  componentDidUpdate(previousProps: { resetKey: string }) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  render() {
    return this.state.hasError ? null : this.props.children
  }
}

function getFloorRenderResetKey(
  floor: FloorLevel,
  surfaceAssignments: SurfaceMaterialAssignment[],
) {
  const topology = buildWallTopology(floor.walls)
  const wallKey = floor.walls
    .map((wall) => {
      const renderedWall = topology.renderedWallsById.get(wall.id)
      const topologyWall = renderedWall?.wall ?? wall

      return [
        topologyWall.id,
        topologyWall.start.x,
        topologyWall.start.y,
        topologyWall.end.x,
        topologyWall.end.y,
        topologyWall.thickness,
        topologyWall.height,
        renderedWall?.startExtension ?? '',
        renderedWall?.endExtension ?? '',
        topologyWall.openings
          ?.map((opening) =>
            [
              opening.id,
              opening.modelId,
              opening.center,
              opening.width,
              opening.height,
              opening.bottom,
            ].join(':'),
          )
          .join(';') ?? '',
      ].join(',')
    })
    .join('|')
  const modelKey = (floor.models ?? [])
    .map((model) =>
      [
        model.id,
        model.modelId,
        model.position.x,
        model.position.y,
        model.rotation ?? '',
        model.scale ?? '',
        model.height ?? '',
        model.wallAttachment?.wallId ?? '',
        model.wallAttachment?.offset ?? '',
        model.lightEnabled ?? '',
        model.lightPower ?? '',
        model.lightColor ?? '',
        model.lightDistance ?? '',
        model.lightSpread ?? '',
        model.lightFalloff ?? '',
      ].join(','),
    )
    .join('|')
  const materialKey = surfaceAssignments
    .filter(
      (assignment) =>
        assignment.target.type !== 'room-floor' ||
        assignment.target.floorId === floor.id,
    )
    .map((assignment) =>
      [
        assignment.id,
        assignment.materialId,
        assignment.coverageHeight ?? '',
        assignment.textureScale ?? '',
        assignment.textureRotation ?? '',
      ].join(','),
    )
    .join('|')

  return `${floor.id}:${wallKey}:${modelKey}:${materialKey}`
}

function getCameraFov(aspectRatioMode: AspectRatioMode) {
  if (aspectRatioMode === 'super-wide') {
    return 78
  }

  if (aspectRatioMode === 'wide') {
    return 62
  }

  return 45
}

function createCountrysideSkyTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024

  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  const skyGradient = context.createLinearGradient(0, 0, 0, canvas.height)
  skyGradient.addColorStop(0, '#7cb7f2')
  skyGradient.addColorStop(0.42, '#c7e3ff')
  skyGradient.addColorStop(0.58, '#eef7ff')
  skyGradient.addColorStop(1, '#bfdc9b')
  context.fillStyle = skyGradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.fillStyle = 'rgba(255, 255, 255, 0.72)'
  for (const cloud of [
    [220, 190, 72],
    [720, 140, 58],
    [1220, 210, 86],
    [1720, 165, 66],
  ] as const) {
    const [x, y, radius] = cloud
    context.beginPath()
    context.ellipse(x, y, radius * 1.35, radius * 0.55, 0, 0, Math.PI * 2)
    context.ellipse(x + radius * 0.8, y + 8, radius, radius * 0.48, 0, 0, Math.PI * 2)
    context.ellipse(x - radius * 0.9, y + 12, radius * 0.95, radius * 0.42, 0, 0, Math.PI * 2)
    context.fill()
  }

  const drawHills = (color: string, baseline: number, amplitude: number, phase: number) => {
    context.beginPath()
    context.moveTo(0, canvas.height)

    for (let x = 0; x <= canvas.width; x += 32) {
      const wave =
        Math.sin(x / 170 + phase) * amplitude +
        Math.sin(x / 83 + phase * 0.7) * amplitude * 0.35
      context.lineTo(x, baseline + wave)
    }

    context.lineTo(canvas.width, canvas.height)
    context.closePath()
    context.fillStyle = color
    context.fill()
  }

  drawHills('#8ebf73', 590, 34, 0.6)
  drawHills('#6aa85e', 650, 42, 2.1)
  drawHills('#4d8f49', 730, 30, 4.4)

  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

type FootprintEdge = {
  wall: Wall
  startKey: string
  endKey: string
}

type FootprintCandidate = {
  edge: FootprintEdge
  nextKey: string
}

function getFloorPlaneBounds(floor: FloorLevel) {
  if (floor.walls.length === 0) {
    return null
  }

  const points = floor.walls.flatMap((wall) => [wall.start, wall.end])
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.y))
  const maxZ = Math.max(...points.map((point) => point.y))
  const width = maxX - minX + FLOOR_PLANE_MARGIN * 2
  const depth = maxZ - minZ + FLOOR_PLANE_MARGIN * 2
  const size = Math.max(width, depth, FLOOR_PLANE_MARGIN * 2)

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size,
  }
}

function getFloorsPlaneBounds(floors: FloorLevel[]) {
  const walls = floors.flatMap((floor) => floor.walls)

  if (walls.length === 0) {
    return null
  }

  const points = walls.flatMap((wall) => [wall.start, wall.end])
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.y))
  const maxZ = Math.max(...points.map((point) => point.y))
  const width = maxX - minX + FLOOR_PLANE_MARGIN * 2
  const depth = maxZ - minZ + FLOOR_PLANE_MARGIN * 2
  const size = Math.max(width, depth, FLOOR_PLANE_MARGIN * 2)

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size,
  }
}

function getPointKey(point: Point) {
  return `${Math.round(point.x / FOOTPRINT_EPSILON)}:${Math.round(point.y / FOOTPRINT_EPSILON)}`
}

function getSignedArea(points: Point[]) {
  return (
    points.reduce((area, point, index) => {
      const nextPoint = points[(index + 1) % points.length]
      return area + point.x * nextPoint.y - nextPoint.x * point.y
    }, 0) / 2
  )
}

function pointIsOnSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= FOOTPRINT_EPSILON
  }

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared

  if (t < -FOOTPRINT_EPSILON || t > 1 + FOOTPRINT_EPSILON) {
    return false
  }

  const projectedPoint = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  }

  return Math.hypot(point.x - projectedPoint.x, point.y - projectedPoint.y) <= FOOTPRINT_EPSILON
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

function normalizeAngleRadians(angle: number) {
  const fullCircle = Math.PI * 2
  let normalized = angle % fullCircle

  if (normalized < 0) {
    normalized += fullCircle
  }

  return normalized
}

function getLineIntersection(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  const x1 = firstStart.x
  const y1 = firstStart.y
  const x2 = firstEnd.x
  const y2 = firstEnd.y
  const x3 = secondStart.x
  const y3 = secondStart.y
  const x4 = secondEnd.x
  const y4 = secondEnd.y
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)

  if (Math.abs(denominator) < 0.0001) {
    return null
  }

  const firstDeterminant = x1 * y2 - y1 * x2
  const secondDeterminant = x3 * y4 - y3 * x4

  return {
    x:
      (firstDeterminant * (x3 - x4) - (x1 - x2) * secondDeterminant) /
      denominator,
    y:
      (firstDeterminant * (y3 - y4) - (y1 - y2) * secondDeterminant) /
      denominator,
  }
}

function getExternalWallLoop(walls: Wall[]) {
  const externalWalls = walls.filter((wall) => wall.kind !== 'internal')

  if (externalWalls.length < 3) {
    return null
  }

  const edges = externalWalls.map((wall) => ({
    wall,
    startKey: getPointKey(wall.start),
    endKey: getPointKey(wall.end),
  }))
  const connections = new Map<string, FootprintEdge[]>()
  const pointGroups = new Map<string, Point[]>()

  for (const edge of edges) {
    connections.set(edge.startKey, [...(connections.get(edge.startKey) ?? []), edge])
    connections.set(edge.endKey, [...(connections.get(edge.endKey) ?? []), edge])
    pointGroups.set(edge.startKey, [
      ...(pointGroups.get(edge.startKey) ?? []),
      edge.wall.start,
    ])
    pointGroups.set(edge.endKey, [
      ...(pointGroups.get(edge.endKey) ?? []),
      edge.wall.end,
    ])
  }

  const pointsByKey = new Map(
    [...pointGroups.entries()].map(([key, points]) => [
      key,
      {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      },
    ]),
  )
  const loops: Point[][] = []

  for (const edge of edges) {
    for (const [startKey, endKey] of [
      [edge.startKey, edge.endKey],
      [edge.endKey, edge.startKey],
    ] as const) {
      const rightTurnLoop = traceWallLoop(
        edge,
        startKey,
        endKey,
        connections,
        pointsByKey,
        true,
      )

      if (rightTurnLoop) {
        loops.push(rightTurnLoop)
      }

      const leftTurnLoop = traceWallLoop(
        edge,
        startKey,
        endKey,
        connections,
        pointsByKey,
        false,
      )

      if (leftTurnLoop) {
        loops.push(leftTurnLoop)
      }
    }
  }

  return loops.reduce<Point[] | null>((bestLoop, loop) => {
    const area = Math.abs(getSignedArea(loop))

    if (area < 0.01 || loop.length < 3) {
      return bestLoop
    }

    return !bestLoop || area > Math.abs(getSignedArea(bestLoop)) ? loop : bestLoop
  }, null)
}

function traceWallLoop(
  firstEdge: FootprintEdge,
  startKey: string,
  endKey: string,
  connections: Map<string, FootprintEdge[]>,
  pointsByKey: Map<string, Point>,
  preferRightTurn: boolean,
) {
  const loopKeys = [startKey]
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
    loopKeys.push(currentKey)

    if (currentKey === startKey) {
      const uniqueKeys = new Set(loopKeys.slice(0, -1))

      return uniqueKeys.size >= 3
        ? loopKeys.slice(0, -1).map((key) => pointsByKey.get(key)!)
        : null
    }

    const candidates = (connections.get(currentKey) ?? [])
      .map((edge): FootprintCandidate => {
        const nextKey = edge.startKey === currentKey ? edge.endKey : edge.startKey
        return { edge, nextKey }
      })
      .filter(
        (candidate) =>
          candidate.edge.wall.id !== currentEdge.wall.id ||
          candidate.nextKey !== previousKey,
      )

    if (candidates.length === 0) {
      return null
    }

    const nextCandidate = chooseNextFootprintEdge(
      previousKey,
      currentKey,
      candidates,
      pointsByKey,
      preferRightTurn,
    )

    previousKey = currentKey
    currentKey = nextCandidate.nextKey
    currentEdge = nextCandidate.edge
  }

  return null
}

function chooseNextFootprintEdge(
  previousKey: string,
  currentKey: string,
  candidates: FootprintCandidate[],
  pointsByKey: Map<string, Point>,
  preferRightTurn: boolean,
) {
  const previousPoint = pointsByKey.get(previousKey)!
  const currentPoint = pointsByKey.get(currentKey)!
  const incomingAngle = Math.atan2(
    currentPoint.y - previousPoint.y,
    currentPoint.x - previousPoint.x,
  )

  return candidates.reduce((bestCandidate, candidate) => {
    const bestPoint = pointsByKey.get(bestCandidate.nextKey)!
    const candidatePoint = pointsByKey.get(candidate.nextKey)!
    const bestOutgoingAngle = Math.atan2(
      bestPoint.y - currentPoint.y,
      bestPoint.x - currentPoint.x,
    )
    const candidateOutgoingAngle = Math.atan2(
      candidatePoint.y - currentPoint.y,
      candidatePoint.x - currentPoint.x,
    )
    const bestTurn = preferRightTurn
      ? normalizeAngleRadians(incomingAngle - bestOutgoingAngle)
      : normalizeAngleRadians(bestOutgoingAngle - incomingAngle)
    const candidateTurn = preferRightTurn
      ? normalizeAngleRadians(incomingAngle - candidateOutgoingAngle)
      : normalizeAngleRadians(candidateOutgoingAngle - incomingAngle)

    return candidateTurn < bestTurn ? candidate : bestCandidate
  }, candidates[0])
}

function getOffsetFootprint(loop: Point[], offset: number) {
  const isCounterClockwise = getSignedArea(loop) > 0

  return loop.map((point, index) => {
    const previousPoint = loop[(index - 1 + loop.length) % loop.length]
    const nextPoint = loop[(index + 1) % loop.length]
    const previousDirection = {
      x: point.x - previousPoint.x,
      y: point.y - previousPoint.y,
    }
    const nextDirection = {
      x: nextPoint.x - point.x,
      y: nextPoint.y - point.y,
    }
    const previousLength = Math.hypot(previousDirection.x, previousDirection.y)
    const nextLength = Math.hypot(nextDirection.x, nextDirection.y)

    if (previousLength === 0 || nextLength === 0) {
      return point
    }

    const previousUnit = {
      x: previousDirection.x / previousLength,
      y: previousDirection.y / previousLength,
    }
    const nextUnit = {
      x: nextDirection.x / nextLength,
      y: nextDirection.y / nextLength,
    }
    const getOutwardNormal = (unit: Point) =>
      isCounterClockwise
        ? { x: unit.y, y: -unit.x }
        : { x: -unit.y, y: unit.x }
    const previousNormal = getOutwardNormal(previousUnit)
    const nextNormal = getOutwardNormal(nextUnit)
    const previousOffsetStart = {
      x: previousPoint.x + previousNormal.x * offset,
      y: previousPoint.y + previousNormal.y * offset,
    }
    const previousOffsetEnd = {
      x: point.x + previousNormal.x * offset,
      y: point.y + previousNormal.y * offset,
    }
    const nextOffsetStart = {
      x: point.x + nextNormal.x * offset,
      y: point.y + nextNormal.y * offset,
    }
    const nextOffsetEnd = {
      x: nextPoint.x + nextNormal.x * offset,
      y: nextPoint.y + nextNormal.y * offset,
    }

    return (
      getLineIntersection(
        previousOffsetStart,
        previousOffsetEnd,
        nextOffsetStart,
        nextOffsetEnd,
      ) ?? {
        x: point.x + (previousNormal.x + nextNormal.x) * offset,
        y: point.y + (previousNormal.y + nextNormal.y) * offset,
      }
    )
  })
}

function getFloorFootprint(floor: FloorLevel) {
  const loop = getExternalWallLoop(floor.walls)
  const externalThickness =
    floor.walls.find((wall) => wall.kind !== 'internal')?.thickness ?? 0

  return loop ? getOffsetFootprint(loop, externalThickness / 2) : null
}

function getNearestFloorFootprint(floor: FloorLevel, floors: FloorLevel[]) {
  const ownFootprint = getFloorFootprint(floor)

  if (ownFootprint) {
    return ownFootprint
  }

  for (const candidateFloor of [...floors]
    .filter((candidateFloor) => candidateFloor.elevation < floor.elevation)
    .sort((firstFloor, secondFloor) => secondFloor.elevation - firstFloor.elevation)) {
    const candidateFootprint = getFloorFootprint(candidateFloor)

    if (candidateFootprint) {
      return candidateFootprint
    }
  }

  return null
}

function getWallClipSegmentIntersection(
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

  if (Math.abs(denominator) <= 0.000001) {
    return null
  }

  const startDx = secondStart.x - firstStart.x
  const startDy = secondStart.y - firstStart.y
  const firstT = (startDx * secondDy - startDy * secondDx) / denominator
  const secondT = (startDx * firstDy - startDy * firstDx) / denominator

  if (
    firstT < -FOOTPRINT_EPSILON ||
    firstT > 1 + FOOTPRINT_EPSILON ||
    secondT < -FOOTPRINT_EPSILON ||
    secondT > 1 + FOOTPRINT_EPSILON
  ) {
    return null
  }

  return {
    x: firstStart.x + firstDx * firstT,
    y: firstStart.y + firstDy * firstT,
  }
}

function getPolygonIntersectionCandidates(firstPolygon: Point[], secondPolygon: Point[]) {
  const candidates: Point[] = [
    ...firstPolygon.filter((point) => pointIsInPolygon(point, secondPolygon)),
    ...secondPolygon.filter((point) => pointIsInPolygon(point, firstPolygon)),
  ]

  for (let firstIndex = 0; firstIndex < firstPolygon.length; firstIndex += 1) {
    const firstStart = firstPolygon[firstIndex]
    const firstEnd = firstPolygon[(firstIndex + 1) % firstPolygon.length]

    for (let secondIndex = 0; secondIndex < secondPolygon.length; secondIndex += 1) {
      const secondStart = secondPolygon[secondIndex]
      const secondEnd = secondPolygon[(secondIndex + 1) % secondPolygon.length]
      const intersection = getWallClipSegmentIntersection(
        firstStart,
        firstEnd,
        secondStart,
        secondEnd,
      )

      if (intersection) {
        candidates.push(intersection)
      }
    }
  }

  return candidates.reduce<Point[]>((uniquePoints, point) => {
    if (
      !uniquePoints.some(
        (uniquePoint) =>
          Math.hypot(uniquePoint.x - point.x, uniquePoint.y - point.y) <=
          FOOTPRINT_EPSILON,
      )
    ) {
      uniquePoints.push(point)
    }

    return uniquePoints
  }, [])
}

function getConvexHull(points: Point[]) {
  if (points.length <= 3) {
    return points
  }

  const sortedPoints = [...points].sort(
    (firstPoint, secondPoint) =>
      firstPoint.x - secondPoint.x || firstPoint.y - secondPoint.y,
  )
  const cross = (origin: Point, firstPoint: Point, secondPoint: Point) =>
    (firstPoint.x - origin.x) * (secondPoint.y - origin.y) -
    (firstPoint.y - origin.y) * (secondPoint.x - origin.x)
  const lowerHull: Point[] = []
  const upperHull: Point[] = []

  for (const point of sortedPoints) {
    while (
      lowerHull.length >= 2 &&
      cross(lowerHull[lowerHull.length - 2], lowerHull[lowerHull.length - 1], point) <= 0
    ) {
      lowerHull.pop()
    }

    lowerHull.push(point)
  }

  for (const point of [...sortedPoints].reverse()) {
    while (
      upperHull.length >= 2 &&
      cross(upperHull[upperHull.length - 2], upperHull[upperHull.length - 1], point) <= 0
    ) {
      upperHull.pop()
    }

    upperHull.push(point)
  }

  return [...lowerHull.slice(0, -1), ...upperHull.slice(0, -1)]
}

function getFloorRoomFootprints(floor: FloorLevel) {
  return buildWallTopology(floor.walls).rooms.map((room) => room.polygon)
}

function getFloorWallBodyFootprints(floor: FloorLevel) {
  return getRenderedWalls(floor.walls).map((renderedWall) => getWallPolygon(renderedWall))
}

function getUpperFloorCoverageFootprints(floor: FloorLevel) {
  const floorFootprint = getFloorFootprint(floor)

  if (floorFootprint) {
    return [floorFootprint]
  }

  return [...getFloorRoomFootprints(floor), ...getFloorWallBodyFootprints(floor)]
}

function getIntersectionFootprint(firstFootprint: Point[], secondFootprint: Point[]) {
  if (secondFootprint.every((point) => pointIsInPolygon(point, firstFootprint))) {
    return secondFootprint
  }

  if (firstFootprint.every((point) => pointIsInPolygon(point, secondFootprint))) {
    return firstFootprint
  }

  const intersectionPoints = getPolygonIntersectionCandidates(
    firstFootprint,
    secondFootprint,
  )

  return intersectionPoints.length >= 3 ? getConvexHull(intersectionPoints) : null
}

function getSlabFootprints(
  lowerFloor: FloorLevel,
  upperFloor: FloorLevel | null,
  floors: FloorLevel[],
) {
  const lowerFootprint = getNearestFloorFootprint(lowerFloor, floors)

  if (!upperFloor) {
    return lowerFootprint ? [lowerFootprint] : []
  }

  const upperFootprints = getUpperFloorCoverageFootprints(upperFloor)

  if (!lowerFootprint) {
    return upperFootprints
  }

  if (upperFootprints.length === 0) {
    return []
  }

  return upperFootprints
    .map((upperFootprint) => getIntersectionFootprint(lowerFootprint, upperFootprint))
    .filter((footprint): footprint is Point[] => Boolean(footprint))
}

function getSceneBounds(floors: FloorLevel[]) {
  const walls = floors.flatMap((floor) => floor.walls)

  if (walls.length === 0) {
    return {
      centerX: 0,
      centerZ: 0,
      size: 20,
      maxElevation: 8,
    }
  }

  const points = walls.flatMap((wall) => [wall.start, wall.end])
  const maxTop = Math.max(
    ...floors.flatMap((floor) =>
      floor.walls.map((wall) => floor.elevation + wall.height),
    ),
    8,
  )
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.y))
  const maxZ = Math.max(...points.map((point) => point.y))
  const size = Math.max(maxX - minX, maxZ - minZ, maxTop) + SHADOW_MARGIN * 2

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size,
    maxElevation: maxTop,
  }
}

function SunLight({
  enabled,
  lightDirection,
  sceneBounds,
  shadows,
}: {
  enabled: boolean
  lightDirection: LightDirection
  sceneBounds: ReturnType<typeof getSceneBounds>
  shadows: boolean
}) {
  const lightRef = useRef<DirectionalLight>(null)
  const targetRef = useRef<Object3D>(null)

  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [sceneBounds])
  const horizontalDistance = Math.max(sceneBounds.size * 0.9, 12)
  const verticalDistance = Math.max(sceneBounds.maxElevation + 8, 8)
  const lightHeight = Math.max(
    0.8,
    Math.sin(lightDirection.elevation) * verticalDistance,
  )
  const lightRadius =
    horizontalDistance * Math.max(0.08, Math.cos(lightDirection.elevation))
  const lightPosition = [
    sceneBounds.centerX + Math.cos(lightDirection.azimuth) * lightRadius,
    lightHeight,
    sceneBounds.centerZ + Math.sin(lightDirection.azimuth) * lightRadius,
  ] as const
  const shadowCameraFar =
    horizontalDistance + verticalDistance + sceneBounds.size + sceneBounds.maxElevation

  return (
    <>
      <object3D
        ref={targetRef}
        position={[sceneBounds.centerX, 0, sceneBounds.centerZ]}
      />
      <directionalLight
        ref={lightRef}
        position={lightPosition}
        intensity={enabled ? 1.3 : 0}
        castShadow={enabled && shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-sceneBounds.size / 2}
        shadow-camera-right={sceneBounds.size / 2}
        shadow-camera-top={sceneBounds.size / 2}
        shadow-camera-bottom={-sceneBounds.size / 2}
        shadow-camera-near={0.5}
        shadow-camera-far={shadowCameraFar}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      />
    </>
  )
}

function ExternalWallMaterial({
  attach,
  side,
  wireframe,
}: {
  attach?: string
  side?: Side
  wireframe: boolean
}) {
  return (
    <meshStandardMaterial
      attach={attach}
      color="#94a3b8"
      roughness={0.82}
      shadowSide={FrontSide}
      side={side}
      wireframe={wireframe}
    />
  )
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

function getWindowDaylightPortalSlots(
  renderedFloors: RenderedFloorData[],
  lightDirection: LightDirection,
) {
  const sunHorizontalDirection = {
    x: Math.cos(lightDirection.azimuth),
    y: Math.sin(lightDirection.azimuth),
  }
  const sunElevationFactor = Math.max(0.15, Math.sin(lightDirection.elevation))
  const slots: WindowDaylightPortalSlot[] = []

  for (const renderedFloor of renderedFloors) {
    const { floor, renderedWalls, rooms } = renderedFloor

    for (const renderedWall of renderedWalls) {
      const wall = renderedWall.wall

      if (wall.kind !== 'external' || !wall.openings?.length) {
        continue
      }

      const wallBasis = getWallBasis(wall)
      const sampleOffset = wall.thickness / 2 + 0.12

      for (const opening of wall.openings) {
        const modelDefinition = modelsById.get(opening.modelId)

        if (modelDefinition?.wallMount !== 'window') {
          continue
        }

        const center = getWallPointAtDistance(wall, opening.center)
        const positiveNormalRoom = getRoomContainingPoint(rooms, {
          x: center.x + wallBasis.normal.x * sampleOffset,
          y: center.y + wallBasis.normal.y * sampleOffset,
        })
        const negativeNormalRoom = getRoomContainingPoint(rooms, {
          x: center.x - wallBasis.normal.x * sampleOffset,
          y: center.y - wallBasis.normal.y * sampleOffset,
        })
        const inwardNormal = positiveNormalRoom
          ? wallBasis.normal
          : negativeNormalRoom
            ? { x: -wallBasis.normal.x, y: -wallBasis.normal.y }
            : null

        if (!inwardNormal) {
          continue
        }

        const outwardNormal = {
          x: -inwardNormal.x,
          y: -inwardNormal.y,
        }
        const directSunFactor = Math.max(
          0,
          outwardNormal.x * sunHorizontalDirection.x +
            outwardNormal.y * sunHorizontalDirection.y,
        )
        const windowArea = Math.max(0.35, opening.width * opening.height)
        const centerY = floor.elevation + opening.bottom + opening.height / 2
        const targetY = Math.max(
          floor.elevation + 0.25,
          centerY - 0.25 - sunElevationFactor * 1.4,
        )
        const outsideOffset =
          wall.thickness / 2 + WINDOW_DAYLIGHT_PORTAL_WALL_CLEARANCE
        const insideOffset = WINDOW_DAYLIGHT_PORTAL_TARGET_DISTANCE
        const position: [number, number, number] = [
          center.x - inwardNormal.x * outsideOffset,
          centerY,
          center.y - inwardNormal.y * outsideOffset,
        ]
        const target: [number, number, number] = [
          center.x + inwardNormal.x * insideOffset,
          targetY,
          center.y + inwardNormal.y * insideOffset,
        ]
        const angle = Math.max(
          0.32,
          Math.min(
            0.85,
            Math.atan((Math.max(opening.width, opening.height) * 0.85) / insideOffset),
          ),
        )
        const power = windowArea * (2.4 + directSunFactor * sunElevationFactor * 7.5)

        slots.push({
          angle,
          color: '#dcecff',
          distance: WINDOW_DAYLIGHT_PORTAL_DISTANCE,
          id: `${floor.id}:${wall.id}:${opening.id}`,
          position,
          power,
          target,
        })
      }
    }
  }

  return slots
    .sort((firstSlot, secondSlot) => secondSlot.power - firstSlot.power)
    .slice(0, MAX_WINDOW_DAYLIGHT_PORTALS)
}

function getVisibleRoomSignatures(
  currentRoomSignature: string | null,
  rooms: DetectedRoom[],
  roomPortals: RoomPortal[],
) {
  if (!currentRoomSignature) {
    return new Set(rooms.map((room) => room.signature))
  }

  const visibleRoomSignatures = new Set([currentRoomSignature])
  const frontier = [currentRoomSignature]

  while (frontier.length > 0) {
    const roomSignature = frontier.shift()!

    for (const portal of roomPortals) {
      if (portal.fromRoomSignature !== roomSignature) {
        continue
      }

      if (!visibleRoomSignatures.has(portal.toRoomSignature)) {
        visibleRoomSignatures.add(portal.toRoomSignature)
        frontier.push(portal.toRoomSignature)
      }
    }
  }

  return visibleRoomSignatures
}

function modelIsInVisibleRooms(
  model: PlacedModel,
  rooms: DetectedRoom[],
  visibleRoomSignatures: ReadonlySet<string> | null | undefined,
) {
  if (!visibleRoomSignatures) {
    return true
  }

  const room = getRoomContainingPoint(rooms, model.position)

  return !room || visibleRoomSignatures.has(room.signature)
}

function wallTouchesVisibleRoom(
  wall: Wall,
  rooms: DetectedRoom[],
  visibleRoomSignatures: ReadonlySet<string> | null | undefined,
) {
  if (!visibleRoomSignatures) {
    return true
  }

  const midpoint = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  }
  const normal = getWallNormal(wall)
  const sampleOffset = wall.thickness / 2 + 0.08
  const sampledRooms = [
    getRoomContainingPoint(rooms, {
      x: midpoint.x + normal.x * sampleOffset,
      y: midpoint.y + normal.y * sampleOffset,
    }),
    getRoomContainingPoint(rooms, {
      x: midpoint.x - normal.x * sampleOffset,
      y: midpoint.y - normal.y * sampleOffset,
    }),
  ]

  return sampledRooms.some(
    (room) => !room || visibleRoomSignatures.has(room.signature),
  )
}

function getRenderedWallLocalPoint(
  { wall, startExtension }: RenderedWall,
  distanceAlongWall: number,
) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return wall.start
  }

  const unit = {
    x: dx / length,
    y: dy / length,
  }

  return {
    x: wall.start.x + unit.x * (distanceAlongWall - startExtension),
    y: wall.start.y + unit.y * (distanceAlongWall - startExtension),
  }
}

function getDistanceAlongRenderedWall(renderedWall: RenderedWall, point: Point) {
  const { wall, startExtension } = renderedWall
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return 0
  }

  const unit = {
    x: dx / length,
    y: dy / length,
  }
  const renderedStart = {
    x: wall.start.x - unit.x * startExtension,
    y: wall.start.y - unit.y * startExtension,
  }

  return (point.x - renderedStart.x) * unit.x + (point.y - renderedStart.y) * unit.y
}

function pointTouchesWallBodyForOverlap(point: Point, wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(point.x - wall.start.x, point.y - wall.start.y) <=
      wall.thickness / 2 + 0.02
  }

  const rawT =
    ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
    lengthSquared
  const t = Math.max(0, Math.min(1, rawT))
  const projection = {
    x: wall.start.x + dx * t,
    y: wall.start.y + dy * t,
  }

  return (
    rawT >= -0.02 &&
    rawT <= 1 + 0.02 &&
    Math.hypot(point.x - projection.x, point.y - projection.y) <=
      wall.thickness / 2 + 0.02
  )
}

function getDistanceToPolygonBoundary(point: Point, polygon: Point[]) {
  if (polygon.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  return polygon.reduce((bestDistance, segmentStart, index) => {
    const segmentEnd = polygon[(index + 1) % polygon.length]

    return Math.min(
      bestDistance,
      getDistanceToSegment(point, segmentStart, segmentEnd),
    )
  }, Number.POSITIVE_INFINITY)
}

function internalWallOwnsOverlap(ownerWall: Wall, clippedWall: Wall) {
  const clippedEndpointTouchesOwner =
    pointTouchesWallBodyForOverlap(clippedWall.start, ownerWall) ||
    pointTouchesWallBodyForOverlap(clippedWall.end, ownerWall)
  const ownerEndpointTouchesClipped =
    pointTouchesWallBodyForOverlap(ownerWall.start, clippedWall) ||
    pointTouchesWallBodyForOverlap(ownerWall.end, clippedWall)

  if (clippedEndpointTouchesOwner !== ownerEndpointTouchesClipped) {
    return clippedEndpointTouchesOwner
  }

  return ownerWall.id.localeCompare(clippedWall.id) < 0
}

function wallBodyOccluderOwnsOverlap(wall: Wall, occluder: WallBodyOccluder) {
  if (wall.kind !== 'internal' && occluder.kind !== 'internal') {
    return false
  }

  if (wall.kind !== 'internal' && occluder.kind === 'internal') {
    return false
  }

  if (wall.kind === 'internal' && occluder.kind !== 'internal') {
    return true
  }

  return internalWallOwnsOverlap(occluder.renderedWall.wall, wall)
}

function getRenderedWallDirection({ wall }: RenderedWall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)

  return length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length }
}

function getWallFaceNormal(renderedWall: RenderedWall, side: Exclude<SurfaceWallSide, 'both'>) {
  const direction = getRenderedWallDirection(renderedWall)
  const sideOneNormal = {
    x: -direction.y,
    y: direction.x,
  }

  return side === 1
    ? sideOneNormal
    : {
        x: -sideOneNormal.x,
        y: -sideOneNormal.y,
      }
}

function getWallSideFacingDirection(
  renderedWall: RenderedWall,
  direction: Point,
): Exclude<SurfaceWallSide, 'both'> {
  const sideOneNormal = getWallFaceNormal(renderedWall, 1)
  const sideTwoNormal = getWallFaceNormal(renderedWall, -1)
  const sideOneDot = sideOneNormal.x * direction.x + sideOneNormal.y * direction.y
  const sideTwoDot = sideTwoNormal.x * direction.x + sideTwoNormal.y * direction.y

  return sideOneDot >= sideTwoDot ? 1 : -1
}

function getWallBodyOcclusionBreaks(
  renderedWall: RenderedWall,
  renderedLength: number,
  wallBodyOccluders: WallBodyOccluder[],
) {
  const wallPolygon = getWallPolygon(renderedWall)

  return wallBodyOccluders.flatMap((occluder) => {
    if (
      occluder.wallId === renderedWall.wall.id ||
      !wallBodyOccluderOwnsOverlap(renderedWall.wall, occluder)
    ) {
      return []
    }

    const intersectionFootprint = getIntersectionFootprint(
      wallPolygon,
      occluder.polygon,
    )

    if (!intersectionFootprint) {
      return []
    }

    return intersectionFootprint
      .map((point) => getDistanceAlongRenderedWall(renderedWall, point))
      .filter(
        (distanceAlongWall) =>
          distanceAlongWall > 0 && distanceAlongWall < renderedLength,
      )
  })
}

function isWallSegmentOccluded(
  renderedWall: RenderedWall,
  midpoint: number,
  wallBodyOccluders: WallBodyOccluder[],
) {
  const midpointWorld = getRenderedWallLocalPoint(renderedWall, midpoint)

  return wallBodyOccluders.some(
    (occluder) =>
      occluder.wallId !== renderedWall.wall.id &&
      wallBodyOccluderOwnsOverlap(renderedWall.wall, occluder) &&
      isPointInsideOrOnPolygon(midpointWorld, occluder.polygon),
  )
}

function createWallSegmentGeometry({
  centerX,
  centerZ,
  rotationY,
  segment,
  wallTopMaterialSlot,
  wallHeight,
  wallThickness,
}: {
  centerX: number
  centerZ: number
  rotationY: number
  segment: WallRenderSegment
  wallTopMaterialSlot: 0 | 1 | 2
  wallHeight: number
  wallThickness: number
}) {
  const geometry = new BufferGeometry()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const halfLength = segment.length / 2
  const halfHeight = segment.height / 2
  const halfThickness = wallThickness / 2
  const segmentLocalStart = segment.center - halfLength
  const materialIndex = {
    base: 0,
    leftCap: 3,
    rightCap: 4,
    sideOne: 1,
    sideTwo: 2,
  } as const
  const addQuad = (
    corners: Array<[number, number, number]>,
    normal: [number, number, number],
    materialSlot: number,
    uvCorners: Array<[number, number]>,
  ) => {
    const startVertex = positions.length / 3
    const indices = [0, 1, 2, 0, 2, 3]

    indices.forEach((cornerIndex) => {
      positions.push(...corners[cornerIndex])
      normals.push(...normal)
      uvs.push(...uvCorners[cornerIndex])
    })
    geometry.addGroup(startVertex, 6, materialSlot)
  }
  const xToWallDistance = (x: number) => segmentLocalStart + x + halfLength
  const yToWallHeight = (y: number) => segment.y + y
  const zToDepth = (z: number) => z + halfThickness
  const localToWorldPlan = (x: number, z: number) => {
    const groupLocalX = segment.center - halfLength + x
    const cos = Math.cos(rotationY)
    const sin = Math.sin(rotationY)

    return {
      x: centerX + groupLocalX * cos + z * sin,
      y: centerZ - groupLocalX * sin + z * cos,
    }
  }
  const getWallProjectedUv = (
    projector: WallCapUvProjector | undefined,
    localX: number,
    localY: number,
    localZ: number,
    fallbackUv: [number, number],
  ): [number, number] => {
    if (!projector) {
      return fallbackUv
    }

    return [
      getDistanceAlongRenderedWall(
        projector.renderedWall,
        localToWorldPlan(localX, localZ),
      ),
      yToWallHeight(localY),
    ]
  }
  const addRightFace = (zMin: number, zMax: number, materialSlot: number) =>
    addQuad(
      [
        [halfLength, -halfHeight, zMax],
        [halfLength, -halfHeight, zMin],
        [halfLength, halfHeight, zMin],
        [halfLength, halfHeight, zMax],
      ],
      [1, 0, 0],
      materialSlot,
      [
        getWallProjectedUv(segment.rightCapUvProjector, halfLength, -halfHeight, zMax, [
          zToDepth(zMax),
          yToWallHeight(-halfHeight),
        ]),
        getWallProjectedUv(segment.rightCapUvProjector, halfLength, -halfHeight, zMin, [
          zToDepth(zMin),
          yToWallHeight(-halfHeight),
        ]),
        getWallProjectedUv(segment.rightCapUvProjector, halfLength, halfHeight, zMin, [
          zToDepth(zMin),
          yToWallHeight(halfHeight),
        ]),
        getWallProjectedUv(segment.rightCapUvProjector, halfLength, halfHeight, zMax, [
          zToDepth(zMax),
          yToWallHeight(halfHeight),
        ]),
      ],
    )
  const addLeftFace = (zMin: number, zMax: number, materialSlot: number) =>
    addQuad(
      [
        [-halfLength, -halfHeight, zMin],
        [-halfLength, -halfHeight, zMax],
        [-halfLength, halfHeight, zMax],
        [-halfLength, halfHeight, zMin],
      ],
      [-1, 0, 0],
      materialSlot,
      [
        getWallProjectedUv(segment.leftCapUvProjector, -halfLength, -halfHeight, zMin, [
          zToDepth(zMin),
          yToWallHeight(-halfHeight),
        ]),
        getWallProjectedUv(segment.leftCapUvProjector, -halfLength, -halfHeight, zMax, [
          zToDepth(zMax),
          yToWallHeight(-halfHeight),
        ]),
        getWallProjectedUv(segment.leftCapUvProjector, -halfLength, halfHeight, zMax, [
          zToDepth(zMax),
          yToWallHeight(halfHeight),
        ]),
        getWallProjectedUv(segment.leftCapUvProjector, -halfLength, halfHeight, zMin, [
          zToDepth(zMin),
          yToWallHeight(halfHeight),
        ]),
      ],
    )
  const addTopFace = (zMin: number, zMax: number, materialSlot: number) =>
    addQuad(
      [
        [-halfLength, halfHeight, zMax],
        [halfLength, halfHeight, zMax],
        [halfLength, halfHeight, zMin],
        [-halfLength, halfHeight, zMin],
      ],
      [0, 1, 0],
      materialSlot,
      [
        [xToWallDistance(-halfLength), zToDepth(zMax)],
        [xToWallDistance(halfLength), zToDepth(zMax)],
        [xToWallDistance(halfLength), zToDepth(zMin)],
        [xToWallDistance(-halfLength), zToDepth(zMin)],
      ],
    )
  const addBottomFace = (zMin: number, zMax: number, materialSlot: number) =>
    addQuad(
      [
        [-halfLength, -halfHeight, zMin],
        [halfLength, -halfHeight, zMin],
        [halfLength, -halfHeight, zMax],
        [-halfLength, -halfHeight, zMax],
      ],
      [0, -1, 0],
      materialSlot,
      [
        [xToWallDistance(-halfLength), zToDepth(zMin)],
        [xToWallDistance(halfLength), zToDepth(zMin)],
        [xToWallDistance(halfLength), zToDepth(zMax)],
        [xToWallDistance(-halfLength), zToDepth(zMax)],
      ],
    )
  const addZSplitFace = (
    addFace: (zMin: number, zMax: number, materialSlot: number) => void,
    positiveMaterialSlot: number,
    negativeMaterialSlot: number,
  ) => {
    addFace(0, halfThickness, positiveMaterialSlot)
    addFace(-halfThickness, 0, negativeMaterialSlot)
  }

  if (segment.skipRightEndCap) {
    // Artificial clip boundary: the adjacent wall owns this volume.
  } else if (segment.revealRight) {
    addZSplitFace(addRightFace, materialIndex.sideOne, materialIndex.sideTwo)
  } else {
    addRightFace(-halfThickness, halfThickness, materialIndex.rightCap)
  }

  if (segment.skipLeftEndCap) {
    // Artificial clip boundary: the adjacent wall owns this volume.
  } else if (segment.revealLeft) {
    addZSplitFace(addLeftFace, materialIndex.sideOne, materialIndex.sideTwo)
  } else {
    addLeftFace(-halfThickness, halfThickness, materialIndex.leftCap)
  }

  const segmentTop = segment.y + halfHeight

  if (segment.revealBottom) {
    addZSplitFace(addTopFace, materialIndex.sideOne, materialIndex.sideTwo)
  } else if (segmentTop >= wallHeight - 0.001) {
    addTopFace(
      -halfThickness,
      halfThickness,
      wallTopMaterialSlot,
    )
  } else {
    addTopFace(-halfThickness, halfThickness, materialIndex.base)
  }

  if (segment.revealTop) {
    addZSplitFace(addBottomFace, materialIndex.sideOne, materialIndex.sideTwo)
  } else {
    addBottomFace(-halfThickness, halfThickness, materialIndex.base)
  }

  addQuad(
    [
      [-halfLength, -halfHeight, halfThickness],
      [halfLength, -halfHeight, halfThickness],
      [halfLength, halfHeight, halfThickness],
      [-halfLength, halfHeight, halfThickness],
    ],
    [0, 0, 1],
    materialIndex.sideOne,
    [
      [xToWallDistance(-halfLength), yToWallHeight(-halfHeight)],
      [xToWallDistance(halfLength), yToWallHeight(-halfHeight)],
      [xToWallDistance(halfLength), yToWallHeight(halfHeight)],
      [xToWallDistance(-halfLength), yToWallHeight(halfHeight)],
    ],
  )
  addQuad(
    [
      [halfLength, -halfHeight, -halfThickness],
      [-halfLength, -halfHeight, -halfThickness],
      [-halfLength, halfHeight, -halfThickness],
      [halfLength, halfHeight, -halfThickness],
    ],
    [0, 0, -1],
    materialIndex.sideTwo,
    [
      [xToWallDistance(halfLength), yToWallHeight(-halfHeight)],
      [xToWallDistance(-halfLength), yToWallHeight(-halfHeight)],
      [xToWallDistance(-halfLength), yToWallHeight(halfHeight)],
      [xToWallDistance(halfLength), yToWallHeight(halfHeight)],
    ],
  )

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return geometry
}

function WallSegmentMesh({
  castsShadow,
  centerX,
  centerZ,
  floorId,
  onRegisterPickTarget,
  selectedWallId,
  selectedSurface,
  wallMaterialAssignments,
  renderedLength,
  rotationY,
  segment,
  wall,
  wallId,
  wallHeight,
  wallKind,
  wallThickness,
  wireframe,
}: {
  castsShadow: boolean
  centerX: number
  centerZ: number
  floorId: string
  onRegisterPickTarget: (target: PickTarget) => () => void
  selectedWallId: string | null
  selectedSurface: SelectableSurface | null
  wallMaterialAssignments: SurfaceMaterialAssignment[]
  renderedLength: number
  rotationY: number
  segment: WallRenderSegment
  wall: Wall
  wallId: string
  wallHeight: number
  wallKind: WallKind
  wallThickness: number
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const segmentTop = segment.y + segment.height / 2
  const sideOneAssignment = getWallMaterialAssignmentForSide(
    wallMaterialAssignments,
    1,
    segmentTop,
  )
  const sideTwoAssignment = getWallMaterialAssignmentForSide(
    wallMaterialAssignments,
    -1,
    segmentTop,
  )
  const leftCapAssignment =
    segment.leftCapAssignment ?? sideOneAssignment ?? sideTwoAssignment
  const rightCapAssignment =
    segment.rightCapAssignment ?? sideOneAssignment ?? sideTwoAssignment
  const sideAssignmentsMatch = Boolean(
    sideOneAssignment &&
      sideTwoAssignment &&
      wallMaterialAssignmentsMatch(sideOneAssignment, sideTwoAssignment),
  )
  const wallTopMaterialSlot = sideAssignmentsMatch ? 1 : 0
  const geometry = useMemo(
    () =>
      createWallSegmentGeometry({
        centerX,
        centerZ,
        rotationY,
        segment,
        wallTopMaterialSlot,
        wallHeight,
        wallThickness,
      }),
    [
      centerX,
      centerZ,
      rotationY,
      segment,
      wallHeight,
      wallThickness,
      wallTopMaterialSlot,
    ],
  )

  useEffect(() => () => geometry.dispose(), [geometry])
  const pickGroupTargets = useMemo(
    () =>
      new Map<number, SelectableSurface>([
        [
          1,
          {
            floorId,
            side: 1,
            type: 'wall-face',
            wallId,
          },
        ],
        [
          2,
          {
            floorId,
            side: -1,
            type: 'wall-face',
            wallId,
          },
        ],
        [
          3,
          {
            floorId,
            side: 1,
            type: 'wall-face',
            wallId,
          },
        ],
        [
          4,
          {
            floorId,
            side: -1,
            type: 'wall-face',
            wallId,
          },
        ],
      ]),
    [floorId, wallId],
  )

  useEffect(() => {
    const object = meshRef.current

    if (!object) {
      return undefined
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      groupTargets: pickGroupTargets,
      kind: 'material-groups',
      object,
    })
  }, [floorId, onRegisterPickTarget, pickGroupTargets])

  const sideOneMaterial = sideOneAssignment
    ? surfaceMaterialsById.get(sideOneAssignment.materialId)
    : null
  const sideTwoMaterial = sideTwoAssignment
    ? surfaceMaterialsById.get(sideTwoAssignment.materialId)
    : null
  const leftCapMaterial = leftCapAssignment
    ? surfaceMaterialsById.get(leftCapAssignment.materialId)
    : null
  const rightCapMaterial = rightCapAssignment
    ? surfaceMaterialsById.get(rightCapAssignment.materialId)
    : null
  const renderBaseMaterial = (attach: string) =>
    wallKind === 'external' ? (
      <ExternalWallMaterial attach={attach} wireframe={wireframe} />
    ) : (
      <InternalWallMaterial attach={attach} wireframe={wireframe} />
    )
  const renderSurfaceMaterial = (
    attach: string,
    assignment: SurfaceMaterialAssignment | undefined,
    material: SurfaceMaterialProduct | null | undefined,
  ) =>
    assignment && material ? (
      <SurfaceMeshStandardMaterial
        attach={attach}
        assignment={assignment}
        displacementEnabled={false}
        material={material}
        polygonOffsetFactor={0}
        polygonOffsetUnits={0}
        side={DoubleSide}
        textureQuality={getWallSurfaceTextureQuality(material)}
        wireframe={wireframe}
      />
    ) : (
      renderBaseMaterial(attach)
    )

  const meshPosition = [
    segment.center - renderedLength / 2,
    segment.y - wallHeight / 2,
    0,
  ] as const
  const selectedWallSide =
    selectedSurface?.type === 'wall-face' &&
    selectedSurface.wallId === wallId &&
    (!selectedWallId || selectedWallId === wallId)
      ? selectedSurface.side
      : null
  const wallIsSelected = selectedWallSide !== null || selectedWallId === wallId

  if (wireframe) {
    return (
      <mesh
        ref={meshRef}
        castShadow={false}
        geometry={geometry}
        position={meshPosition}
        receiveShadow={false}
      >
        <meshBasicMaterial
          color={wallKind === 'external' ? '#94a3b8' : '#cbd5e1'}
          depthWrite={false}
          opacity={0.02}
          transparent
        />
        <Edges color="#334155" threshold={15} />
      </mesh>
    )
  }

  return (
    <>
      <mesh
        ref={meshRef}
        castShadow={castsShadow}
        geometry={geometry}
        position={meshPosition}
        receiveShadow={castsShadow}
      >
        {renderBaseMaterial('material-0')}
        {renderSurfaceMaterial('material-1', sideOneAssignment, sideOneMaterial)}
        {renderSurfaceMaterial('material-2', sideTwoAssignment, sideTwoMaterial)}
        {renderSurfaceMaterial('material-3', leftCapAssignment, leftCapMaterial)}
        {renderSurfaceMaterial('material-4', rightCapAssignment, rightCapMaterial)}
      </mesh>
      {wallIsSelected ? (
        <mesh geometry={geometry} position={meshPosition} renderOrder={9}>
          <FootprintMaterialGroupHighlight
            materialCount={5}
            selectedMaterialIndices={
              selectedWallSide === 1
                ? [1, 3]
                : selectedWallSide === -1
                  ? [2, 4]
                  : [1, 2, 3, 4]
            }
          />
        </mesh>
      ) : null}
    </>
  )
}

function InternalWallMaterial({
  attach,
  side = FrontSide,
  wireframe,
}: {
  attach?: string
  side?: Side
  wireframe: boolean
}) {
  return (
    <meshStandardMaterial
      attach={attach}
      color="#cbd5e1"
      roughness={0.72}
      shadowSide={FrontSide}
      side={side}
      wireframe={wireframe}
    />
  )
}

type WallFaceCoverageInterval = {
  end: number
  start: number
}

type WallEngineFace = ReturnType<typeof buildWallMeshFaces>[number]

function getWallFaceHorizontalInterval(
  face: WallEngineFace,
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

function getWallFaceHorizontalIntervalOnWall(face: WallEngineFace, wall: Wall) {
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
  faces: ReturnType<typeof buildRoomSurfaceWallFaces>,
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

function subtractWallFaceCoverage(
  coverage: Map<string, WallFaceCoverageInterval[]>,
  key: string,
  face: WallEngineFace,
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
  firstVertex: WallEngineFace['vertices'][number],
  secondVertex: WallEngineFace['vertices'][number],
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
  face: WallEngineFace,
  interval: WallFaceCoverageInterval,
  index: number,
  wallsById: Map<string, Wall>,
): WallEngineFace {
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
  face: WallEngineFace,
  wallsById: Map<string, Wall>,
) {
  const faceKey = getRoomSurfaceKey(face)

  if (!faceKey) {
    return [face]
  }

  if (face.kind !== 'side') {
    return coverage.has(faceKey) ? [] : [face]
  }

  return subtractWallFaceCoverage(coverage, faceKey, face, wallsById).map((interval, index) =>
    clipWallSideFaceToInterval(face, interval, index, wallsById),
  )
}

function dotWallFaceNormals(firstFace: WallEngineFace, secondFace: WallEngineFace) {
  return (
    firstFace.normal[0] * secondFace.normal[0] +
    firstFace.normal[1] * secondFace.normal[1] +
    firstFace.normal[2] * secondFace.normal[2]
  )
}

function getFaceVerticalBounds(face: WallEngineFace) {
  const yValues = face.vertices.map((vertex) => vertex.position[1])

  return {
    max: Math.max(...yValues),
    min: Math.min(...yValues),
  }
}

function facePlaneDistance(firstFace: WallEngineFace, secondFace: WallEngineFace) {
  const firstPoint = firstFace.vertices[0].position
  const secondPoint = secondFace.vertices[0].position

  return Math.abs(
    (firstPoint[0] - secondPoint[0]) * secondFace.normal[0] +
      (firstPoint[1] - secondPoint[1]) * secondFace.normal[1] +
      (firstPoint[2] - secondPoint[2]) * secondFace.normal[2],
  )
}

function structuralFaceOverlapsRoomSurfaceFace(
  structuralFace: WallEngineFace,
  roomSurfaceFace: WallEngineFace,
  wallsById: Map<string, Wall>,
) {
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

  const structuralInterval = getWallFaceHorizontalIntervalOnWall(structuralFace, wall)
  const surfaceInterval = getWallFaceHorizontalIntervalOnWall(roomSurfaceFace, wall)

  return (
    structuralInterval.end > surfaceInterval.start + 0.01 &&
    structuralInterval.start < surfaceInterval.end - 0.01
  )
}

function structuralFaceOverlapsAnyRoomSurfaceFace(
  structuralFace: WallEngineFace,
  roomSurfaceFaces: ReturnType<typeof buildRoomSurfaceWallFaces>,
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

function WallEngineWallMeshes({
  castsShadow,
  elevation,
  externalFootprintWallIds,
  floorId,
  onRegisterPickTarget,
  renderedWalls,
  roomSurfaceDebugRenderedWalls,
  rooms,
  selectedSurface,
  selectedWallId,
  surfaceAssignments,
  wireframe,
}: {
  castsShadow: boolean
  elevation: number
  externalFootprintWallIds?: ReadonlySet<string>
  floorId: string
  onRegisterPickTarget: (target: PickTarget) => () => void
  renderedWalls: RenderedWall[]
  roomSurfaceDebugRenderedWalls?: RenderedWall[]
  rooms: DetectedRoom[]
  selectedSurface: SelectableSurface | null
  selectedWallId: string | null
  surfaceAssignments: SurfaceMaterialAssignment[]
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const pickMeshRef = useRef<Object3D>(null!)
  const walls = useMemo(
    () => renderedWalls.map((renderedWall) => renderedWall.wall),
    [renderedWalls],
  )
  const wallsById = useMemo(
    () => new Map(walls.map((wall) => [wall.id, wall])),
    [walls],
  )
  const faces = useMemo(() => {
    const roomSurfaceFaces = ROOM_SURFACE_WALL_RENDERER_ENABLED
      ? buildRoomSurfaceWallFaces({
          renderedWalls,
          rooms,
        })
      : []
    const roomSurfaceKeys = new Set(
      roomSurfaceFaces
        .map(getRoomSurfaceKey)
        .filter((key): key is string => Boolean(key)),
    )
    const roomSurfaceCoverage = getWallFaceCoverageByKey(roomSurfaceFaces, wallsById)
    const omittedSideAttachmentCapTargetIds = new Set([
      ...(externalFootprintWallIds ?? []),
      ...roomSurfaceFaces.map((face) => face.materialSource.wallId),
    ])
    const structuralFaces = buildWallMeshFaces(walls, {
      omitSideAttachmentCapsForTargetWallIds:
        omittedSideAttachmentCapTargetIds.size > 0
          ? omittedSideAttachmentCapTargetIds
          : undefined,
    })

    if (!ROOM_SURFACE_WALL_RENDERER_ENABLED) {
      return structuralFaces
    }

    if (roomSurfaceKeys.size === 0) {
      return structuralFaces
    }

    return [
      ...structuralFaces.flatMap((face) =>
        structuralFaceOverlapsAnyRoomSurfaceFace(face, roomSurfaceFaces, wallsById)
          ? []
          : subtractRoomSurfaceCoverageFromFace(roomSurfaceCoverage, face, wallsById),
      ),
      ...roomSurfaceFaces,
    ]
  }, [externalFootprintWallIds, renderedWalls, rooms, walls, wallsById])
  const roomSurfaceDebugFaces = useMemo(
    () =>
      ROOM_SURFACE_DEBUG_OVERLAY_ENABLED
        ? buildRoomSurfaceWallFaces({
            includeWallsWithOpenings: true,
            renderedWalls: roomSurfaceDebugRenderedWalls ?? renderedWalls,
            rooms,
          })
        : [],
    [renderedWalls, roomSurfaceDebugRenderedWalls, rooms],
  )
  const roomSurfaceDebugPlans = useMemo(
    () =>
      buildRoomWallSurfacePlans({
        includeWallsWithOpenings: true,
        renderedWalls: roomSurfaceDebugRenderedWalls ?? renderedWalls,
        rooms,
      }),
    [renderedWalls, roomSurfaceDebugRenderedWalls, rooms],
  )
  useEffect(() => {
    recordRoomWallSurfacePlans(floorId, roomSurfaceDebugPlans)
  }, [floorId, roomSurfaceDebugPlans])
  useEffect(() => {
    recordRoomSurfaceFaces(floorId, faces)
  }, [faces, floorId])
  useEffect(() => {
    recordWallFaces(floorId, faces)
  }, [faces, floorId])
  useEffect(() => {
    recordWallGeometryDump({
      faces,
      floorId,
      renderedWalls,
      rooms,
    })
  }, [faces, floorId, renderedWalls, rooms])
  const payload = useMemo(
    () =>
      buildWallBufferGeometryPayload(faces, {
        floorId,
      }),
    [faces, floorId],
  )
  const pickPayload = useMemo(
    () =>
      buildWallBufferGeometryPayload(faces, {
        floorId,
        groupBy: 'face',
      }),
    [faces, floorId],
  )
  const geometry = useMemo(() => createWallBufferGeometry(payload), [payload])
  const pickGeometry = useMemo(
    () => createWallBufferGeometry(pickPayload),
    [pickPayload],
  )
  const selectedFaces = useMemo(() => {
    if (selectedSurface?.type === 'wall-surface-fragment') {
      return faces.filter((face) => face.faceId === selectedSurface.fragmentId)
    }

    if (selectedWallId) {
      return faces.filter((face) => face.pickSource.wallId === selectedWallId)
    }

    if (selectedSurface?.type !== 'wall-face') {
      return []
    }

    return faces
      .filter(
        (face) =>
          face.pickSource.wallId === selectedSurface.wallId &&
          face.pickSource.side === selectedSurface.side,
      )
  }, [faces, selectedSurface, selectedWallId])
  const selectedGeometry = useMemo(() => {
    if (selectedFaces.length === 0) {
      return null
    }

    return createWallBufferGeometry(
      buildWallBufferGeometryPayload(selectedFaces, {
        floorId,
      }),
    )
  }, [floorId, selectedFaces])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => pickGeometry.dispose(), [pickGeometry])
  useEffect(() => () => selectedGeometry?.dispose(), [selectedGeometry])
  useEffect(() => {
    recordWallRenderDebug(
      'wall-renderer:engine',
      `floor=${floorId} walls=${walls.map((wall) => wall.id).join(',')}`,
      WALL_RENDER_DEBUG_SNAPSHOTS_ENABLED
        ? JSON.stringify({
            faceCount: faces.length,
            faces: faces.map((face) => ({
              id: face.faceId,
              kind: face.kind,
              wallId: face.wallId,
              vertices: face.vertices.map((vertex) =>
                vertex.position.map((value) => Number(value.toFixed(3))),
              ),
            })),
            materialSlots: payload.materialSlots.map((slot) => slot.source),
          })
        : JSON.stringify({
            faceCount: faces.length,
            materialSlotCount: payload.materialSlots.length,
            pickMaterialSlotCount: pickPayload.materialSlots.length,
            wallCount: walls.length,
          }),
    )
  }, [faces, floorId, payload.materialSlots, pickPayload.materialSlots, walls])
  useEffect(() => {
    const object = pickMeshRef.current

    if (!object || pickPayload.pickTargets.size === 0) {
      return undefined
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      groupTargets: pickPayload.pickTargets,
      kind: 'material-groups',
      object,
      pickOnly: true,
    })
  }, [floorId, onRegisterPickTarget, pickGeometry, pickPayload.pickTargets])

  if (payload.materialSlots.length === 0) {
    return null
  }

  return (
    <>
      <mesh
        ref={meshRef}
        castShadow={castsShadow}
        geometry={geometry}
        position={[0, elevation, 0]}
        receiveShadow={castsShadow}
        renderOrder={2}
      >
        {payload.materialSlots.map((slot) => (
          <WallEngineMaterialSlot
            key={slot.index}
            attach={`material-${slot.index}`}
            source={slot.source}
            surfaceAssignments={surfaceAssignments}
            wallsById={wallsById}
            wireframe={wireframe}
          />
        ))}
      </mesh>
      <mesh
        ref={pickMeshRef}
        geometry={pickGeometry}
        position={[0, elevation, 0]}
        renderOrder={1}
      >
        <meshBasicMaterial
          color="#000000"
          side={DoubleSide}
          visible={false}
        />
      </mesh>
      {selectedGeometry && !wireframe ? (
        <mesh geometry={selectedGeometry} position={[0, elevation, 0]} renderOrder={9}>
          <meshBasicMaterial
            color={MODEL_OUTLINE_COLOR}
            colorWrite
            depthWrite={false}
            opacity={0.26}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
            side={DoubleSide}
            transparent
          />
        </mesh>
      ) : null}
      {ROOM_SURFACE_DEBUG_OVERLAY_ENABLED ? (
        <RoomSurfaceDebugOverlay
          elevation={elevation}
          faces={roomSurfaceDebugFaces}
        />
      ) : null}
      {ROOM_BOUNDARY_DEBUG_OVERLAY_ENABLED ? (
        <RoomBoundaryDebugOverlay elevation={elevation} rooms={rooms} />
      ) : null}
      {ROOM_SURFACE_DEBUG_OVERLAY_ENABLED ? (
        <RoomSurfaceGapDebugOverlay
          elevation={elevation}
          reason="unmatched"
          renderOrder={15}
          y={0.095}
          plans={roomSurfaceDebugPlans}
        />
      ) : null}
      {ROOM_SURFACE_DEBUG_OVERLAY_ENABLED ? (
        <RoomSurfaceGapDebugOverlay
          color="#d946ef"
          elevation={elevation}
          reason="corner"
          renderOrder={14}
          y={0.075}
          plans={roomSurfaceDebugPlans}
        />
      ) : null}
    </>
  )
}

function createRoomSurfaceDebugGeometry(faces: ReturnType<typeof buildRoomSurfaceWallFaces>) {
  const positions: number[] = []

  faces.forEach((face) => {
    const offset = {
      x: face.normal[0] * 0.012,
      z: face.normal[2] * 0.012,
    }
    const vertices = face.vertices.map((vertex) => [
      vertex.position[0] + offset.x,
      vertex.position[1],
      vertex.position[2] + offset.z,
    ])
    const edgeIndices = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]

    edgeIndices.forEach(([startIndex, endIndex]) => {
      positions.push(...vertices[startIndex], ...vertices[endIndex])
    })
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return geometry
}

function RoomSurfaceDebugOverlay({
  elevation,
  faces,
}: {
  elevation: number
  faces: ReturnType<typeof buildRoomSurfaceWallFaces>
}) {
  const geometry = useMemo(() => createRoomSurfaceDebugGeometry(faces), [faces])

  useEffect(() => () => geometry.dispose(), [geometry])

  if (faces.length === 0) {
    return null
  }

  return (
    <lineSegments geometry={geometry} position={[0, elevation, 0]} renderOrder={12}>
      <lineBasicMaterial
        color="#06b6d4"
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.95}
      />
    </lineSegments>
  )
}

function createRoomBoundaryDebugGeometry(rooms: DetectedRoom[]) {
  const positions: number[] = []
  const y = 0.035

  rooms.forEach((room) => {
    room.polygon.forEach((start, index) => {
      const end = room.polygon[(index + 1) % room.polygon.length]

      positions.push(start.x, y, start.y, end.x, y, end.y)
    })
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return geometry
}

function RoomBoundaryDebugOverlay({
  elevation,
  rooms,
}: {
  elevation: number
  rooms: DetectedRoom[]
}) {
  const geometry = useMemo(() => createRoomBoundaryDebugGeometry(rooms), [rooms])

  useEffect(() => () => geometry.dispose(), [geometry])

  if (rooms.length === 0) {
    return null
  }

  return (
    <lineSegments geometry={geometry} position={[0, elevation, 0]} renderOrder={13}>
      <lineBasicMaterial
        color="#facc15"
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.95}
      />
    </lineSegments>
  )
}

function createRoomSurfaceGapDebugGeometry(
  plans: ReturnType<typeof buildRoomWallSurfacePlans>,
  reason: 'corner' | 'unmatched',
  y: number,
) {
  const positions: number[] = []

  plans.forEach((plan) => {
    plan.gaps
      .filter((gap) => gap.reason === reason)
      .forEach((gap) => {
        positions.push(
          gap.startPoint.x,
          y,
          gap.startPoint.y,
          gap.endPoint.x,
          y,
          gap.endPoint.y,
        )
      })
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return geometry
}

function RoomSurfaceGapDebugOverlay({
  color = '#ef4444',
  elevation,
  plans,
  reason,
  renderOrder,
  y,
}: {
  color?: string
  elevation: number
  plans: ReturnType<typeof buildRoomWallSurfacePlans>
  reason: 'corner' | 'unmatched'
  renderOrder: number
  y: number
}) {
  const geometry = useMemo(
    () => createRoomSurfaceGapDebugGeometry(plans, reason, y),
    [plans, reason, y],
  )
  const gapCount = plans.reduce(
    (count, plan) =>
      count + plan.gaps.filter((gap) => gap.reason === reason).length,
    0,
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  if (gapCount === 0) {
    return null
  }

  return (
    <lineSegments geometry={geometry} position={[0, elevation, 0]} renderOrder={renderOrder}>
      <lineBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.95}
      />
    </lineSegments>
  )
}

function WallEngineMaterialSlot({
  attach,
  source,
  surfaceAssignments,
  wallsById,
  wireframe,
}: {
  attach: string
  source: { role?: 'cap' | 'room-surface'; side?: WallSide; wallId: string }
  surfaceAssignments: SurfaceMaterialAssignment[]
  wallsById: Map<string, Wall>
  wireframe: boolean
}) {
  const wall = wallsById.get(source.wallId)
  const wallMaterialAssignments = wall
    ? getWallMaterialAssignments(surfaceAssignments, wall.id)
    : []
  const ownSideAssignment =
    wall && typeof source.side === 'number'
      ? getWallMaterialAssignmentForSide(
          wallMaterialAssignments,
          source.side,
          wall.height,
        )
      : undefined
  const capSideOneAssignment =
    wall && source.role === 'cap'
      ? getWallMaterialAssignmentForSide(wallMaterialAssignments, 1, wall.height)
      : undefined
  const capSideTwoAssignment =
    wall && source.role === 'cap'
      ? getWallMaterialAssignmentForSide(wallMaterialAssignments, -1, wall.height)
      : undefined
  const capSharedAssignment =
    capSideOneAssignment && capSideTwoAssignment
      ? wallMaterialAssignmentsMatch(capSideOneAssignment, capSideTwoAssignment)
        ? capSideOneAssignment
        : undefined
      : capSideOneAssignment ?? capSideTwoAssignment
  const assignment =
    source.role === 'cap'
      ? capSharedAssignment ?? ownSideAssignment
      : ownSideAssignment
  const material = assignment
    ? surfaceMaterialsById.get(assignment.materialId)
    : undefined

  if (assignment && material) {
    return (
      <SurfaceMeshStandardMaterial
        attach={attach}
        assignment={assignment}
        displacementEnabled={false}
        material={material}
        polygonOffsetFactor={0}
        polygonOffsetUnits={0}
        side={DoubleSide}
        textureQuality={getWallSurfaceTextureQuality(material)}
        wireframe={wireframe}
      />
    )
  }

  return wall?.kind === 'external' ? (
    <ExternalWallMaterial attach={attach} side={DoubleSide} wireframe={wireframe} />
  ) : (
    <InternalWallMaterial attach={attach} side={DoubleSide} wireframe={wireframe} />
  )
}

function getWallMaterialAssignments(
  surfaceAssignments: SurfaceMaterialAssignment[],
  wallId: string,
) {
  return surfaceAssignments.filter(
    (assignment) =>
      assignment.target.type === 'wall-face' && assignment.target.wallId === wallId,
  )
}

function getWallMaterialAssignmentForSide(
  wallMaterialAssignments: SurfaceMaterialAssignment[],
  side: Exclude<SurfaceWallSide, 'both'>,
  height: number,
) {
  return wallMaterialAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-face' &&
      (assignment.coverageHeight ?? Number.POSITIVE_INFINITY) >= height - 0.001 &&
      (assignment.target.side === 'both' || assignment.target.side === side),
  )
}

function wallMaterialAssignmentsMatch(
  firstAssignment: SurfaceMaterialAssignment,
  secondAssignment: SurfaceMaterialAssignment,
) {
  return (
    firstAssignment.materialId === secondAssignment.materialId &&
    (firstAssignment.customColor ?? '') === (secondAssignment.customColor ?? '') &&
    (firstAssignment.textureRotation ?? 0) ===
      (secondAssignment.textureRotation ?? 0) &&
    (firstAssignment.textureScale ?? 1) === (secondAssignment.textureScale ?? 1)
  )
}

type LoadedSurfaceTextures = {
  aoMap?: Texture
  displacementMap?: Texture
  map?: Texture
  metalnessMap?: Texture
  normalMap?: Texture
  roughnessMap?: Texture
}

type SurfaceTextureQuality = 'base-only' | 'pbr'

type SurfaceTextureEntry = readonly [
  keyof LoadedSurfaceTextures,
  string | undefined,
  boolean,
]
type LoadedSurfaceTextureEntry = readonly [
  keyof LoadedSurfaceTextures,
  string,
  boolean,
]

type SurfaceTextureRequest = {
  entriesToLoad: LoadedSurfaceTextureEntry[]
  maxTextureSize?: number
  repeatX: number
  repeatY: number
  rotationRadians: number
  textureCacheKey: string
}

const surfaceTextureCache = new Map<string, LoadedSurfaceTextures>()
const surfaceTexturePromiseCache = new Map<string, Promise<LoadedSurfaceTextures>>()
const sharedSurfaceTextureLoader = new TextureLoader()
const WALL_TEXTURE_MAX_SIZE = 1024
const engineActivityListeners = new Set<
  (activity: EngineActivityMessage) => void
>()
const ENGINE_LOG_LIMIT = 600
const WALL_RENDER_DEBUG_LIMIT = 300
const WALL_RENDER_DEBUG_SNAPSHOTS_ENABLED = false
const engineLogEntries: EngineLogEntry[] = []
const wallRenderDebugEntries: EngineLogEntry[] = []
const wallRenderDebugCurrentEntries = new Map<string, EngineLogEntry>()
const roomWallSurfacePlanDebugEntries = new Map<
  string,
  RoomWallSurfacePlanDebugEntry
>()
const roomSurfaceFaceDebugEntries = new Map<string, RoomSurfaceFaceDebugEntry[]>()
const wallFaceDebugEntries = new Map<string, WallFaceDebugEntry[]>()
const wallGeometryDebugEntries = new Map<string, WallGeometryDumpEntry>()
let engineLogSequence = 0
let surfaceTextureLoadsInFlight = 0

declare global {
  interface Window {
    houseDesignerEngineLog?: HouseDesignerEngineLogApi
    houseDesignerWallRenderDebug?: HouseDesignerWallRenderDebugApi
    houseDesignerLastPickPng?: string
  }
}

function getEngineLogApi(): HouseDesignerEngineLogApi {
  return {
    clear: () => {
      engineLogEntries.length = 0
    },
    entries: engineLogEntries,
    recent: (count = 80) => engineLogEntries.slice(-count),
    table: (count = 80) => {
      console.table(engineLogEntries.slice(-count))
    },
  }
}

function getDebugDetailValue(detail: string | undefined, key: string) {
  return detail
    ?.split(' ')
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1)
}

function getWallRenderRouteEntries(): WallRenderRouteDebugEntry[] {
  const routeEntries = new Map<string, WallRenderRouteDebugEntry>()
  const exclusionEntries = new Map<
    string,
    {
      kind?: WallKind
      reasons: string[]
    }
  >()

  Array.from(wallRenderDebugCurrentEntries.values()).forEach((entry) => {
    const floorId = getDebugDetailValue(entry.detail, 'floor')
    const wallId = getDebugDetailValue(entry.detail, 'wall')
    const wallIds =
      getDebugDetailValue(entry.detail, 'walls') ??
      getDebugDetailValue(entry.detail, 'sourceWalls')
    const route = entry.type.replace(/^wall-renderer:/, '')
    const addRouteEntry = (candidateWallId: string) => {
      routeEntries.set(`${floorId ?? ''}:${candidateWallId}`, {
        floorId,
        route,
        wallId: candidateWallId,
      })
    }

    if (wallId) {
      if (route === 'engine-excluded') {
        const snapshot =
          entry.snapshot
            ? JSON.parse(entry.snapshot) as {
                kind?: WallKind
                reasons?: string[]
              }
            : {}

        exclusionEntries.set(`${floorId ?? ''}:${wallId}`, {
          kind: snapshot.kind,
          reasons: snapshot.reasons ?? [],
        })
      } else {
        addRouteEntry(wallId)
      }

      return
    }

    if (wallIds) {
      wallIds.split(',').filter(Boolean).forEach(addRouteEntry)
    }
  })

  exclusionEntries.forEach((exclusion, key) => {
    const existingEntry = routeEntries.get(key)

    if (!existingEntry) {
      const [, wallId] = key.split(':')

      routeEntries.set(key, {
        engineExclusionReasons: exclusion.reasons,
        floorId: key.split(':')[0] || undefined,
        kind: exclusion.kind,
        route: 'not-rendered',
        wallId,
      })
      return
    }

    existingEntry.engineExclusionReasons = exclusion.reasons
    existingEntry.kind = exclusion.kind
  })

  return Array.from(routeEntries.values()).sort(
    (first, second) =>
      (first.floorId ?? '').localeCompare(second.floorId ?? '') ||
      first.wallId.localeCompare(second.wallId) ||
      first.route.localeCompare(second.route),
  )
}

function roundDebugMeters(value: number) {
  return Number(value.toFixed(3))
}

function roundDebugPoint(point: Point): [number, number] {
  return [roundDebugMeters(point.x), roundDebugMeters(point.y)]
}

function simplifyEndpointPlanForDebug(
  plan: ReturnType<typeof buildWallGeometryPlans>[number]['start'],
) {
  if (plan.type === 'side-attachment') {
    return {
      endpoint: plan.endpoint,
      sidePoints: plan.sidePoints.map((sidePoint) => ({
        distanceFromEndpoint: roundDebugMeters(sidePoint.distanceFromEndpoint),
        point: roundDebugPoint(sidePoint.point),
        side: sidePoint.side,
        type: sidePoint.type,
      })),
      targetDistance: roundDebugMeters(plan.targetDistance),
      targetWallId: plan.targetWallId,
      trimDistance: roundDebugMeters(plan.trimDistance),
      type: plan.type,
    }
  }

  if (plan.type === 'endpoint-join') {
    return {
      endpoint: plan.endpoint,
      joinNodeId: plan.joinNodeId,
      point: roundDebugPoint(plan.point),
      sidePlans: plan.sidePlans.map((sidePlan) => ({
        distanceFromEndpoint: roundDebugMeters(sidePlan.distanceFromEndpoint),
        point: roundDebugPoint(sidePlan.point),
        side: sidePlan.side,
        type: sidePlan.type,
      })),
      type: plan.type,
    }
  }

  return {
    endpoint: plan.endpoint,
    type: plan.type,
  }
}

function getFaceBoundsForDebug(
  vertices: Array<{ position: [number, number, number] }>,
) {
  const xs = vertices.map((vertex) => vertex.position[0])
  const ys = vertices.map((vertex) => vertex.position[1])
  const zs = vertices.map((vertex) => vertex.position[2])

  return {
    max: [
      roundDebugMeters(Math.max(...xs)),
      roundDebugMeters(Math.max(...ys)),
      roundDebugMeters(Math.max(...zs)),
    ] as [number, number, number],
    min: [
      roundDebugMeters(Math.min(...xs)),
      roundDebugMeters(Math.min(...ys)),
      roundDebugMeters(Math.min(...zs)),
    ] as [number, number, number],
  }
}

function getRoomTouchedWallIdsForDebug(
  room: DetectedRoom,
  renderedWalls: RenderedWall[],
) {
  const wallIds = new Set<string>()
  const edgeTolerance = 0.04

  room.polygon.forEach((start, index) => {
    const end = room.polygon[(index + 1) % room.polygon.length]
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }

    renderedWalls.forEach((renderedWall) => {
      const polygon = getWallPolygon(renderedWall)
      const touchesWall = polygon.some((polygonStart, polygonIndex) => {
        const polygonEnd = polygon[(polygonIndex + 1) % polygon.length]

        return (
          getDistanceToSegment(midpoint, polygonStart, polygonEnd) <= edgeTolerance
        )
      })

      if (touchesWall) {
        wallIds.add(renderedWall.wall.id)
      }
    })
  })

  return Array.from(wallIds).sort()
}

function recordWallGeometryDump({
  faces,
  floorId,
  renderedWalls,
  rooms,
}: {
  faces: WallEngineFace[]
  floorId: string
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
}) {
  const walls = renderedWalls.map((renderedWall) => renderedWall.wall)
  const graph = buildWallGraph(walls)
  const plans = buildWallGeometryPlans(walls, { graph })

  wallGeometryDebugEntries.set(floorId, {
    faceCount: faces.length,
    faces: faces.map((face) => ({
      bounds: getFaceBoundsForDebug(face.vertices),
      faceId: face.faceId,
      kind: face.kind,
      materialSource: face.materialSource,
      pickSource: face.pickSource,
      wallId: face.wallId,
    })),
    floorId,
    graph: {
      crossings: graph.crossings.map((crossing) => ({
        id: crossing.id,
        leaderWallId: crossing.leaderWallId,
        point: roundDebugPoint(crossing.point),
        wallIds: crossing.wallIds,
      })),
      endpointNodes: graph.endpointNodes.map((node) => ({
        endpoints: node.endpoints,
        id: node.id,
        point: roundDebugPoint(node.point),
      })),
      sideAttachments: graph.sideAttachments.map((attachment) => ({
        attachedEndpoint: attachment.attachedEndpoint,
        id: attachment.id,
        point: roundDebugPoint(attachment.point),
        side: attachment.side,
        targetDistance: roundDebugMeters(attachment.targetDistance),
        targetWallId: attachment.targetWallId,
      })),
    },
    plans: plans.map((plan) => ({
      crossings: plan.crossings.map((crossing) => ({
        distance: roundDebugMeters(crossing.distance),
        leaderWallId: crossing.leaderWallId,
        role: crossing.role,
      })),
      end: simplifyEndpointPlanForDebug(plan.end),
      faces: plan.faces.map((face) => ({
        intervals: face.intervals.map((interval) => ({
          end: roundDebugMeters(interval.end),
          start: roundDebugMeters(interval.start),
        })),
        side: face.side,
      })),
      length: roundDebugMeters(plan.length),
      start: simplifyEndpointPlanForDebug(plan.start),
      wallId: plan.wallId,
    })),
    rooms: rooms.map((room) => ({
      area: roundDebugMeters(room.area),
      id: room.id,
      polygon: room.polygon.map(roundDebugPoint),
      signature: room.signature,
      touchedWallIds: getRoomTouchedWallIdsForDebug(room, renderedWalls),
    })),
    walls: renderedWalls.map((renderedWall) => ({
      end: roundDebugPoint(renderedWall.wall.end),
      endExtension: roundDebugMeters(renderedWall.endExtension),
      height: roundDebugMeters(renderedWall.wall.height),
      id: renderedWall.wall.id,
      kind: renderedWall.wall.kind,
      length: roundDebugMeters(
        Math.hypot(
          renderedWall.wall.end.x - renderedWall.wall.start.x,
          renderedWall.wall.end.y - renderedWall.wall.start.y,
        ),
      ),
      start: roundDebugPoint(renderedWall.wall.start),
      startExtension: roundDebugMeters(renderedWall.startExtension),
      thickness: roundDebugMeters(renderedWall.wall.thickness),
    })),
  })
}

function getWallGeometryDumpEntries(floorId?: string) {
  const entries = Array.from(wallGeometryDebugEntries.values())

  return floorId
    ? entries.filter((entry) => entry.floorId === floorId)
    : entries
}

function serializeRoomWallSurfacePlan(
  floorId: string,
  plan: RoomWallSurfacePlan,
): RoomWallSurfacePlanDebugEntry {
  return {
    floorId,
    gapCount: plan.gaps.length,
    gaps: plan.gaps.map((gap) => ({
      edgeIndex: gap.edgeIndex,
      end: roundDebugMeters(gap.edgeEndDistance),
      endPoint: [
        roundDebugMeters(gap.endPoint.x),
        roundDebugMeters(gap.endPoint.y),
      ],
      reason: gap.reason,
      start: roundDebugMeters(gap.edgeStartDistance),
      startPoint: [
        roundDebugMeters(gap.startPoint.x),
        roundDebugMeters(gap.startPoint.y),
      ],
    })),
    roomId: plan.room.id,
    roomSignature: plan.room.signature,
    segmentCount: plan.segments.length,
    segments: plan.segments.map((segment) => ({
      edgeIndex: segment.edgeIndex,
      end: roundDebugMeters(segment.edgeEndDistance),
      endPoint: [
        roundDebugMeters(segment.endPoint.x),
        roundDebugMeters(segment.endPoint.y),
      ],
      side: segment.side,
      start: roundDebugMeters(segment.edgeStartDistance),
      startPoint: [
        roundDebugMeters(segment.startPoint.x),
        roundDebugMeters(segment.startPoint.y),
      ],
      wallId: segment.wall.id,
    })),
  }
}

function recordRoomWallSurfacePlans(
  floorId: string,
  plans: RoomWallSurfacePlan[],
) {
  Array.from(roomWallSurfacePlanDebugEntries.keys())
    .filter((key) => key.startsWith(`${floorId}:`))
    .forEach((key) => {
      roomWallSurfacePlanDebugEntries.delete(key)
    })

  plans.forEach((plan) => {
    roomWallSurfacePlanDebugEntries.set(
      `${floorId}:${plan.room.signature}`,
      serializeRoomWallSurfacePlan(floorId, plan),
    )
  })
}

function serializeRoomSurfaceFace(
  floorId: string,
  face: ReturnType<typeof buildRoomSurfaceWallFaces>[number],
): RoomSurfaceFaceDebugEntry {
  const xs = face.vertices.map((vertex) => vertex.position[0])
  const ys = face.vertices.map((vertex) => vertex.position[2])
  const us = face.vertices.map((vertex) => vertex.uv[0])

  return {
    faceId: face.faceId,
    floorId,
    materialRole: face.materialSource.role,
    materialSide: face.materialSource.side,
    materialWallId: face.materialSource.wallId,
    maxX: roundDebugMeters(Math.max(...xs)),
    maxY: roundDebugMeters(Math.max(...ys)),
    minX: roundDebugMeters(Math.min(...xs)),
    minY: roundDebugMeters(Math.min(...ys)),
    pickSide: face.pickSource.side,
    pickWallId: face.pickSource.wallId,
    uvEnd: roundDebugMeters(Math.max(...us)),
    uvStart: roundDebugMeters(Math.min(...us)),
    wallId: face.wallId,
  }
}

function recordRoomSurfaceFaces(
  floorId: string,
  faces: ReturnType<typeof buildRoomSurfaceWallFaces>,
) {
  roomSurfaceFaceDebugEntries.set(
    floorId,
    faces
      .filter((face) => face.materialSource.role === 'room-surface')
      .map((face) => serializeRoomSurfaceFace(floorId, face)),
  )
}

function serializeWallFace(
  floorId: string,
  face: WallEngineFace,
): WallFaceDebugEntry {
  const xs = face.vertices.map((vertex) => vertex.position[0])
  const ys = face.vertices.map((vertex) => vertex.position[2])
  const us = face.vertices.map((vertex) => vertex.uv[0])

  return {
    faceId: face.faceId,
    floorId,
    kind: face.kind,
    materialRole: face.materialSource.role,
    materialSide: face.materialSource.side,
    materialWallId: face.materialSource.wallId,
    maxX: roundDebugMeters(Math.max(...xs)),
    maxY: roundDebugMeters(Math.max(...ys)),
    minX: roundDebugMeters(Math.min(...xs)),
    minY: roundDebugMeters(Math.min(...ys)),
    normalX: roundDebugMeters(face.normal[0]),
    normalY: roundDebugMeters(face.normal[1]),
    normalZ: roundDebugMeters(face.normal[2]),
    pickSide: face.pickSource.side,
    pickWallId: face.pickSource.wallId,
    uvEnd: roundDebugMeters(Math.max(...us)),
    uvStart: roundDebugMeters(Math.min(...us)),
    wallId: face.wallId,
  }
}

function recordWallFaces(floorId: string, faces: WallEngineFace[]) {
  wallFaceDebugEntries.set(
    floorId,
    faces.map((face) => serializeWallFace(floorId, face)),
  )
}

function getRoomWallSurfacePlanDebugEntries() {
  return Array.from(roomWallSurfacePlanDebugEntries.values()).sort(
    (first, second) =>
      first.floorId.localeCompare(second.floorId) ||
      first.roomId.localeCompare(second.roomId),
  )
}

function getRoomWallSurfacePlanSummaryEntries(): RoomWallSurfacePlanSummaryEntry[] {
  return getRoomWallSurfacePlanDebugEntries().map((entry) => ({
    cornerGaps: entry.gaps.filter((gap) => gap.reason === 'corner').length,
    duplicateGaps: entry.gaps.filter((gap) => gap.reason === 'duplicate').length,
    floorId: entry.floorId,
    roomId: entry.roomId,
    segmentCount: entry.segmentCount,
    unmatchedGaps: entry.gaps.filter((gap) => gap.reason === 'unmatched').length,
  }))
}

function getRoomSurfaceFaceDebugEntries() {
  return Array.from(roomSurfaceFaceDebugEntries.values())
    .flat()
    .sort(
      (first, second) =>
        first.floorId.localeCompare(second.floorId) ||
        first.pickWallId.localeCompare(second.pickWallId) ||
        (first.pickSide ?? 0) - (second.pickSide ?? 0) ||
        first.uvStart - second.uvStart ||
      first.faceId.localeCompare(second.faceId),
    )
}

function getWallFaceDebugEntries() {
  return Array.from(wallFaceDebugEntries.values())
    .flat()
    .sort(
      (first, second) =>
        first.floorId.localeCompare(second.floorId) ||
        first.wallId.localeCompare(second.wallId) ||
        first.kind.localeCompare(second.kind) ||
        first.uvStart - second.uvStart ||
        first.faceId.localeCompare(second.faceId),
    )
}

function getRoomSurfaceFaceSummaryEntries(): RoomSurfaceFaceSummaryEntry[] {
  const summaries = new Map<string, RoomSurfaceFaceSummaryEntry>()

  getRoomSurfaceFaceDebugEntries().forEach((face) => {
    const key = [
      face.floorId,
      face.materialWallId,
      face.materialSide ?? 'body',
      face.materialRole ?? 'surface',
      face.pickWallId,
      face.pickSide ?? 'body',
    ].join(':')
    const existing = summaries.get(key)

    if (existing) {
      existing.faceCount += 1
      return
    }

    summaries.set(key, {
      faceCount: 1,
      floorId: face.floorId,
      materialRole: face.materialRole,
      materialSide: face.materialSide,
      materialWallId: face.materialWallId,
      pickSide: face.pickSide,
      pickWallId: face.pickWallId,
    })
  })

  return Array.from(summaries.values()).sort(
    (first, second) =>
      first.floorId.localeCompare(second.floorId) ||
      first.pickWallId.localeCompare(second.pickWallId) ||
      (first.pickSide ?? 0) - (second.pickSide ?? 0),
  )
}

function getRoomWallSurfacePlanProblemEntries(): RoomWallSurfacePlanProblemEntry[] {
  return getRoomWallSurfacePlanDebugEntries()
    .flatMap((entry) =>
      entry.gaps
        .filter((gap) => gap.reason === 'unmatched' || gap.reason === 'duplicate')
        .map((gap) => ({
          edgeIndex: gap.edgeIndex,
          end: gap.end,
          floorId: entry.floorId,
          reason: gap.reason,
          roomId: entry.roomId,
          start: gap.start,
        })),
    )
    .sort(
      (first, second) =>
        first.floorId.localeCompare(second.floorId) ||
        first.roomId.localeCompare(second.roomId) ||
        first.edgeIndex - second.edgeIndex ||
        first.start - second.start ||
        first.reason.localeCompare(second.reason),
    )
}

function segmentDebugLabel(
  segment: RoomWallSurfacePlanDebugEntry['segments'][number] | undefined,
) {
  return segment
    ? `${segment.wallId}:${segment.side} edge=${segment.edgeIndex} ${segment.start}-${segment.end}`
    : undefined
}

function findPreviousRoomPlanSegment(
  entry: RoomWallSurfacePlanDebugEntry,
  gap: RoomWallSurfacePlanDebugEntry['gaps'][number],
) {
  return (
    entry.segments
      .filter(
        (segment) =>
          segment.edgeIndex === gap.edgeIndex &&
          segment.end <= gap.start + 0.001,
      )
      .sort((first, second) => second.end - first.end)[0] ??
    entry.segments
      .filter((segment) => segment.edgeIndex < gap.edgeIndex)
      .sort(
        (first, second) =>
          second.edgeIndex - first.edgeIndex || second.end - first.end,
      )[0]
  )
}

function findNextRoomPlanSegment(
  entry: RoomWallSurfacePlanDebugEntry,
  gap: RoomWallSurfacePlanDebugEntry['gaps'][number],
) {
  return (
    entry.segments
      .filter(
        (segment) =>
          segment.edgeIndex === gap.edgeIndex &&
          segment.start >= gap.end - 0.001,
      )
      .sort((first, second) => first.start - second.start)[0] ??
    entry.segments
      .filter((segment) => segment.edgeIndex > gap.edgeIndex)
      .sort(
        (first, second) =>
          first.edgeIndex - second.edgeIndex || first.start - second.start,
      )[0]
  )
}

function getRoomWallSurfacePlanProblemDetailEntries(): RoomWallSurfacePlanProblemDetailEntry[] {
  return getRoomWallSurfacePlanDebugEntries()
    .flatMap((entry) =>
      entry.gaps
        .filter((gap) => gap.reason === 'unmatched' || gap.reason === 'duplicate')
        .map((gap) => ({
          edgeIndex: gap.edgeIndex,
          end: gap.end,
          endX: gap.endPoint[0],
          endY: gap.endPoint[1],
          floorId: entry.floorId,
          nextSegment: segmentDebugLabel(findNextRoomPlanSegment(entry, gap)),
          previousSegment: segmentDebugLabel(findPreviousRoomPlanSegment(entry, gap)),
          reason: gap.reason,
          roomId: entry.roomId,
          start: gap.start,
          startX: gap.startPoint[0],
          startY: gap.startPoint[1],
        })),
    )
    .sort(
      (first, second) =>
        first.floorId.localeCompare(second.floorId) ||
        first.roomId.localeCompare(second.roomId) ||
        first.edgeIndex - second.edgeIndex ||
        first.start - second.start ||
        first.reason.localeCompare(second.reason),
    )
}

function getWallRenderDebugApi(): HouseDesignerWallRenderDebugApi {
  return {
    clear: () => {
      wallRenderDebugEntries.length = 0
      wallRenderDebugCurrentEntries.clear()
      roomWallSurfacePlanDebugEntries.clear()
      roomSurfaceFaceDebugEntries.clear()
      wallFaceDebugEntries.clear()
    },
    current: () => Array.from(wallRenderDebugCurrentEntries.values()),
    entries: wallRenderDebugEntries,
    geometryDump: getWallGeometryDumpEntries,
    recent: (count = 80) => wallRenderDebugEntries.slice(-count),
    roomPlans: getRoomWallSurfacePlanDebugEntries,
    roomPlanProblemDetails: getRoomWallSurfacePlanProblemDetailEntries,
    roomPlanProblems: getRoomWallSurfacePlanProblemEntries,
    roomPlanSummary: getRoomWallSurfacePlanSummaryEntries,
    roomSurfaceFaces: getRoomSurfaceFaceDebugEntries,
    roomSurfaceFaceSummary: getRoomSurfaceFaceSummaryEntries,
    wallFaces: getWallFaceDebugEntries,
    routes: getWallRenderRouteEntries,
    summary: () =>
      Array.from(wallRenderDebugCurrentEntries.values()).map((entry) => ({
        detail: entry.detail,
        type: entry.type,
      })),
    tableCurrent: () => {
      console.table(Array.from(wallRenderDebugCurrentEntries.values()))
    },
    tableGeometryDump: (floorId?: string) => {
      console.table(
        getWallGeometryDumpEntries(floorId).flatMap((entry) =>
          entry.walls.map((wall) => ({
            end: wall.end.join(','),
            endExtension: wall.endExtension,
            floorId: entry.floorId,
            graphCrossings: entry.graph.crossings.length,
            graphEndpoints: entry.graph.endpointNodes.length,
            graphSideAttachments: entry.graph.sideAttachments.length,
            id: wall.id,
            kind: wall.kind,
            length: wall.length,
            planEnd:
              entry.plans.find((plan) => plan.wallId === wall.id)?.end.type,
            planStart:
              entry.plans.find((plan) => plan.wallId === wall.id)?.start.type,
            start: wall.start.join(','),
            startExtension: wall.startExtension,
            thickness: wall.thickness,
          })),
        ),
      )
    },
    tableRoomSurfaceFaces: () => {
      console.table(getRoomSurfaceFaceDebugEntries())
    },
    tableRoomSurfaceFaceSummary: () => {
      console.table(getRoomSurfaceFaceSummaryEntries())
    },
    tableWallFaces: () => {
      console.table(getWallFaceDebugEntries())
    },
    tableRoomPlans: () => {
      console.table(getRoomWallSurfacePlanDebugEntries())
    },
    tableRoomPlanProblemDetails: () => {
      console.table(getRoomWallSurfacePlanProblemDetailEntries())
    },
    tableRoomPlanProblems: () => {
      console.table(getRoomWallSurfacePlanProblemEntries())
    },
    tableRoomPlanSummary: () => {
      console.table(getRoomWallSurfacePlanSummaryEntries())
    },
    tableRoutes: () => {
      console.table(getWallRenderRouteEntries())
    },
    table: (count = 80) => {
      console.table(wallRenderDebugEntries.slice(-count))
    },
  }
}

function ensureEngineLogApi() {
  if (typeof window === 'undefined') {
    return
  }

  if (!window.houseDesignerEngineLog) {
    window.houseDesignerEngineLog = getEngineLogApi()
  }

  if (
    !window.houseDesignerWallRenderDebug ||
    typeof window.houseDesignerWallRenderDebug.geometryDump !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.summary !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableGeometryDump !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.routes !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.roomSurfaceFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.roomSurfaceFaceSummary !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.wallFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableRoomSurfaceFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableRoomSurfaceFaceSummary !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableWallFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.roomPlanProblemDetails !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.roomPlanProblems !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableRoomPlanProblemDetails !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableRoomPlanProblems !== 'function'
  ) {
    window.houseDesignerWallRenderDebug = getWallRenderDebugApi()
  }
}

function recordEngineLog(
  type: string,
  detail?: string,
  snapshot?: string,
) {
  const entry: EngineLogEntry = {
    detail,
    index: ++engineLogSequence,
    snapshot,
    timeMs: Math.round(performance.now()),
    type,
  }

  engineLogEntries.push(entry)

  if (engineLogEntries.length > ENGINE_LOG_LIMIT) {
    engineLogEntries.splice(0, engineLogEntries.length - ENGINE_LOG_LIMIT)
  }

  return entry
}

function recordWallRenderDebug(
  type: string,
  detail?: string,
  snapshot?: string,
) {
  ensureEngineLogApi()
  const entry = recordEngineLog(type, detail, snapshot)

  wallRenderDebugCurrentEntries.set(`${type}:${detail ?? ''}`, entry)
  wallRenderDebugEntries.push(entry)

  if (wallRenderDebugEntries.length > WALL_RENDER_DEBUG_LIMIT) {
    wallRenderDebugEntries.splice(
      0,
      wallRenderDebugEntries.length - WALL_RENDER_DEBUG_LIMIT,
    )
  }

  return entry
}

function emitEngineActivity(activity: EngineActivityMessage) {
  recordEngineLog('activity', activity.message)
  engineActivityListeners.forEach((listener) => listener(activity))
}

function subscribeEngineActivity(
  listener: (activity: EngineActivityMessage) => void,
) {
  engineActivityListeners.add(listener)

  return () => {
    engineActivityListeners.delete(listener)
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function getWallSurfaceTextureQuality(material: SurfaceMaterialProduct) {
  const detailedWallCategories = new Set<SurfaceMaterialProduct['category']>([
    'tile',
    'wall-covering',
  ])
  const detailedWallTypes = ['brick', 'wallpaper']
  const materialType = material.materialType?.toLowerCase() ?? ''

  return detailedWallCategories.has(material.category) ||
    detailedWallTypes.some((type) => materialType.includes(type))
    ? 'pbr'
    : 'base-only'
}

function getTextureImageSize(image: unknown) {
  if (
    image &&
    typeof image === 'object' &&
    'width' in image &&
    'height' in image &&
    typeof image.width === 'number' &&
    typeof image.height === 'number'
  ) {
    return {
      height: image.height,
      width: image.width,
    }
  }

  return null
}

function downscaleTextureImage(texture: Texture, maxSize: number | undefined) {
  if (!maxSize || typeof document === 'undefined') {
    return
  }

  const size = getTextureImageSize(texture.image)

  if (!size || Math.max(size.width, size.height) <= maxSize) {
    return
  }

  const scale = maxSize / Math.max(size.width, size.height)
  const canvas = document.createElement('canvas')

  canvas.width = Math.max(1, Math.round(size.width * scale))
  canvas.height = Math.max(1, Math.round(size.height * scale))
  canvas
    .getContext('2d')
    ?.drawImage(texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height)
  texture.image = canvas
}

function configureSurfaceTexture(
  texture: Texture,
  {
    isColorMap = false,
    maxSize,
    repeatX,
    repeatY,
    rotationRadians,
  }: {
    isColorMap?: boolean
    maxSize?: number
    repeatX: number
    repeatY: number
    rotationRadians: number
  },
) {
  downscaleTextureImage(texture, maxSize)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  texture.center.set(0.5, 0.5)
  texture.rotation = rotationRadians

  if (isColorMap) {
    texture.colorSpace = SRGBColorSpace
  }

  texture.needsUpdate = true
  return texture
}

function loadSurfaceTexture(
  textureUrl: string,
  {
    isColorMap,
    maxSize,
    repeatX,
    repeatY,
    rotationRadians,
  }: {
    isColorMap: boolean
    maxSize?: number
    repeatX: number
    repeatY: number
    rotationRadians: number
  },
) {
  return new Promise<Texture>((resolve) => {
    sharedSurfaceTextureLoader.load(
      textureUrl,
      (texture) =>
        resolve(
          configureSurfaceTexture(texture, {
            isColorMap,
            maxSize,
            repeatX,
            repeatY,
            rotationRadians,
          }),
        ),
      undefined,
      () => resolve(undefined as unknown as Texture),
    )
  })
}

function getSurfaceTextureRequest(
  material: SurfaceMaterialProduct,
  assignment: SurfaceMaterialAssignment,
  displacementEnabled: boolean,
  textureQuality: SurfaceTextureQuality,
  repeatOverride?: { repeatX: number; repeatY: number },
): SurfaceTextureRequest {
  const {
    ambientOcclusionTextureUrl,
    baseColorTextureUrl,
    displacementTextureUrl,
    metalnessTextureUrl,
    normalTextureUrl,
    repeatX = 1,
    repeatY = 1,
    roughnessTextureUrl,
  } = material.pbr
  const textureScale = assignment.textureScale ?? 1
  const rotationRadians = ((assignment.textureRotation ?? 0) * Math.PI) / 180
  const effectiveRepeatX = (repeatOverride?.repeatX ?? repeatX) / textureScale
  const effectiveRepeatY = (repeatOverride?.repeatY ?? repeatY) / textureScale
  const activeAmbientOcclusionTextureUrl =
    textureQuality === 'pbr' ? ambientOcclusionTextureUrl : undefined
  const activeDisplacementTextureUrl = displacementEnabled
    ? displacementTextureUrl
    : undefined
  const activeMetalnessTextureUrl =
    textureQuality === 'pbr' ? metalnessTextureUrl : undefined
  const activeNormalTextureUrl =
    textureQuality === 'pbr' ? normalTextureUrl : undefined
  const activeRoughnessTextureUrl =
    textureQuality === 'pbr' ? roughnessTextureUrl : undefined
  const maxTextureSize =
    textureQuality === 'base-only' ? WALL_TEXTURE_MAX_SIZE : undefined
  const textureEntries: SurfaceTextureEntry[] = [
    ['map', baseColorTextureUrl, true],
    ['normalMap', activeNormalTextureUrl, false],
    ['roughnessMap', activeRoughnessTextureUrl, false],
    ['metalnessMap', activeMetalnessTextureUrl, false],
    ['aoMap', activeAmbientOcclusionTextureUrl, false],
    ['displacementMap', activeDisplacementTextureUrl, false],
  ]
  const entriesToLoad = textureEntries.filter(
    (entry): entry is LoadedSurfaceTextureEntry => Boolean(entry[1]),
  )
  const textureCacheKey = [
    activeAmbientOcclusionTextureUrl ?? '',
    baseColorTextureUrl ?? '',
    activeDisplacementTextureUrl ?? '',
    activeMetalnessTextureUrl ?? '',
    activeNormalTextureUrl ?? '',
    activeRoughnessTextureUrl ?? '',
    effectiveRepeatX,
    effectiveRepeatY,
    maxTextureSize ?? '',
    rotationRadians,
  ].join('|')

  return {
    entriesToLoad,
    maxTextureSize,
    repeatX: effectiveRepeatX,
    repeatY: effectiveRepeatY,
    rotationRadians,
    textureCacheKey,
  }
}

function getOrLoadSurfaceTextures(request: SurfaceTextureRequest) {
  const cachedTextures = surfaceTextureCache.get(request.textureCacheKey)

  if (cachedTextures) {
    return Promise.resolve(cachedTextures)
  }

  const cachedTexturePromise = surfaceTexturePromiseCache.get(request.textureCacheKey)

  if (cachedTexturePromise) {
    return cachedTexturePromise
  }

  const texturePromise = Promise.all(
    request.entriesToLoad.map(async ([key, textureUrl, isColorMap]) => {
      const texture = await loadSurfaceTexture(textureUrl, {
        isColorMap,
        maxSize: request.maxTextureSize,
        repeatX: request.repeatX,
        repeatY: request.repeatY,
        rotationRadians: request.rotationRadians,
      })

      return [key, texture] as const
    }),
  ).then((loadedTextureEntries) => {
    const nextTextures: LoadedSurfaceTextures = {}

    loadedTextureEntries.forEach(([key, texture]) => {
      if (texture) {
        nextTextures[key] = texture
      }
    })
    surfaceTextureCache.set(request.textureCacheKey, nextTextures)
    surfaceTexturePromiseCache.delete(request.textureCacheKey)
    return nextTextures
  })

  surfaceTexturePromiseCache.set(request.textureCacheKey, texturePromise)
  return texturePromise
}

function useSurfaceMaterialTextures(
  material: SurfaceMaterialProduct,
  assignment: SurfaceMaterialAssignment,
  displacementEnabled: boolean,
  textureQuality: SurfaceTextureQuality,
  repeatOverride?: { repeatX: number; repeatY: number },
) {
  const [textures, setTextures] = useState<LoadedSurfaceTextures>({})
  const textureRequest = useMemo(
    () =>
      getSurfaceTextureRequest(
        material,
        assignment,
        displacementEnabled,
        textureQuality,
        repeatOverride,
      ),
    [
      assignment,
      displacementEnabled,
      material,
      repeatOverride,
      textureQuality,
    ],
  )

  useEffect(() => {
    let cancelled = false

    if (textureRequest.entriesToLoad.length === 0) {
      queueMicrotask(() => {
        if (!cancelled) {
          setTextures({})
        }
      })
      return
    }

    const cachedTextures = surfaceTextureCache.get(textureRequest.textureCacheKey)

    if (cachedTextures) {
      queueMicrotask(() => {
        if (!cancelled) {
          setTextures(cachedTextures)
        }
      })
      return
    }

    const cachedTexturePromise = surfaceTexturePromiseCache.get(
      textureRequest.textureCacheKey,
    )
    const texturePromise = getOrLoadSurfaceTextures(textureRequest)

    if (!cachedTexturePromise) {
      surfaceTextureLoadsInFlight += textureRequest.entriesToLoad.length
      emitEngineActivity({
        message: `Loading ${pluralize(surfaceTextureLoadsInFlight, 'texture')}...`,
      })
      texturePromise.finally(() => {
        surfaceTextureLoadsInFlight = Math.max(
          0,
          surfaceTextureLoadsInFlight - textureRequest.entriesToLoad.length,
        )

        if (surfaceTextureLoadsInFlight > 0) {
          emitEngineActivity({
            message: `Loading ${pluralize(surfaceTextureLoadsInFlight, 'texture')}...`,
          })
        }
      })
      surfaceTexturePromiseCache.set(textureRequest.textureCacheKey, texturePromise)
    }

    texturePromise.then((nextTextures) => {
      if (!cancelled) {
        setTextures(nextTextures)
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    textureRequest,
  ])

  return textures
}

function SurfaceMeshStandardMaterial({
  attach,
  displacementEnabled = true,
  material,
  assignment,
  polygonOffsetFactor,
  polygonOffsetUnits,
  repeatOverride,
  side,
  textureQuality = 'pbr',
  wireframe,
}: {
  attach?: string
  displacementEnabled?: boolean
  material: SurfaceMaterialProduct
  assignment: SurfaceMaterialAssignment
  polygonOffsetFactor: number
  polygonOffsetUnits: number
  repeatOverride?: { repeatX: number; repeatY: number }
  side?: Side
  textureQuality?: SurfaceTextureQuality
  wireframe: boolean
}) {
  const textures = useSurfaceMaterialTextures(
    material,
    assignment,
    displacementEnabled,
    textureQuality,
    repeatOverride,
  )
  const hasBaseColorTexture = Boolean(textures.map)
  const baseColor = assignment.customColor ?? material.pbr.baseColor ?? '#e2e8f0'

  return (
    <meshStandardMaterial
      attach={attach}
      {...textures}
      color={hasBaseColorTexture ? '#ffffff' : baseColor}
      displacementScale={displacementEnabled ? material.pbr.displacementScale ?? 0 : 0}
      metalness={material.pbr.metalness ?? 0}
      polygonOffset
      polygonOffsetFactor={polygonOffsetFactor}
      polygonOffsetUnits={polygonOffsetUnits}
      roughness={material.pbr.roughness ?? 0.7}
      shadowSide={FrontSide}
      side={side}
      wireframe={wireframe}
    />
  )
}

function getSurfaceRepeatForDimensions(
  material: SurfaceMaterialProduct,
  width: number,
  height: number,
) {
  const realWorldWidth = material.pbr.realWorldWidthMeters
  const realWorldHeight = material.pbr.realWorldHeightMeters

  if (!realWorldWidth || !realWorldHeight) {
    return undefined
  }

  return {
    repeatX: Math.max(width / realWorldWidth, 0.001),
    repeatY: Math.max(height / realWorldHeight, 0.001),
  }
}

function SceneResourcePreloader({
  floors,
  modelAssetVersion,
  onPendingChange,
  renderedFloors,
  surfaceAssignments,
}: {
  floors: FloorLevel[]
  modelAssetVersion: number
  onPendingChange: (isPending: boolean) => void
  renderedFloors: RenderedFloorData[]
  surfaceAssignments: SurfaceMaterialAssignment[]
}) {
  useEffect(() => {
    const modelUrls = new Set(
      floors.flatMap((floor) =>
        (floor.models ?? []).flatMap((model) => {
          const sourceUrl = modelsById.get(model.modelId)?.sourceUrl

          return sourceUrl ? [getModelAssetUrl(sourceUrl, modelAssetVersion)] : []
        }),
      ),
    )

    modelUrls.forEach((sourceUrl) => {
      useGLTF.preload(sourceUrl)
    })
  }, [floors, modelAssetVersion])

  useEffect(() => {
    const textureRequests = new Map<string, SurfaceTextureRequest>()
    const addRequest = (
      assignment: SurfaceMaterialAssignment,
      material: SurfaceMaterialProduct | undefined,
      {
        displacementEnabled,
        repeatOverride,
        textureQuality,
      }: {
        displacementEnabled: boolean
        repeatOverride?: { repeatX: number; repeatY: number }
        textureQuality: SurfaceTextureQuality
      },
    ) => {
      if (!material) {
        return
      }

      const request = getSurfaceTextureRequest(
        material,
        assignment,
        displacementEnabled,
        textureQuality,
        repeatOverride,
      )

      if (
        request.entriesToLoad.length > 0 &&
        !surfaceTextureCache.has(request.textureCacheKey)
      ) {
        textureRequests.set(request.textureCacheKey, request)
      }
    }

    surfaceAssignments.forEach((assignment) => {
      const material = surfaceMaterialsById.get(assignment.materialId)

      if (!material) {
        return
      }

      if (assignment.target.type === 'wall-face') {
        addRequest(assignment, material, {
          displacementEnabled: false,
          textureQuality: getWallSurfaceTextureQuality(material),
        })
        return
      }

      if (
        assignment.target.type === 'room-floor' ||
        assignment.target.type === 'ceiling'
      ) {
        addRequest(assignment, material, {
          displacementEnabled: true,
          textureQuality: 'pbr',
        })
        return
      }

      if (assignment.target.type === 'floor-slab-edge') {
        const floorSlabEdgeTarget = assignment.target

        addRequest(assignment, material, {
          displacementEnabled: false,
          textureQuality: getWallSurfaceTextureQuality(material),
        })

        const renderedFloor = renderedFloors.find(
          ({ floor }) => floor.id === floorSlabEdgeTarget.floorId,
        )

        if (!renderedFloor) {
          return
        }

        const floorIndex = renderedFloors.findIndex(
          ({ floor }) => floor.id === renderedFloor.floor.id,
        )
        const upperFloor = renderedFloors[floorIndex + 1]?.floor ?? null
        const slabFootprints = getSlabFootprints(
          renderedFloor.floor,
          upperFloor,
          floors,
        )

        slabFootprints.forEach((footprint) => {
          footprint.forEach((point, pointIndex) => {
            const nextPoint = footprint[(pointIndex + 1) % footprint.length]
            const length = Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y)

            addRequest(assignment, material, {
              displacementEnabled: false,
              repeatOverride: getSurfaceRepeatForDimensions(
                material,
                length,
                renderedFloor.floor.slabThickness,
              ),
              textureQuality: getWallSurfaceTextureQuality(material),
            })
          })
        })
      }
    })

    const uncachedRequests = [...textureRequests.values()].filter(
      (request) => !surfaceTexturePromiseCache.has(request.textureCacheKey),
    )
    const textureCount = uncachedRequests.reduce(
      (count, request) => count + request.entriesToLoad.length,
      0,
    )

    if (textureCount === 0) {
      onPendingChange(false)
      return
    }

    let cancelled = false
    onPendingChange(true)
    emitEngineActivity({
      message: `Preloading ${pluralize(textureCount, 'texture')}...`,
      minimumVisibleMs: 1400,
    })
    Promise.all(uncachedRequests.map(getOrLoadSurfaceTextures)).then(() => {
      if (cancelled) {
        return
      }

      onPendingChange(false)
      emitEngineActivity({
        message: 'Scene textures ready',
        minimumVisibleMs: 900,
      })
    })

    return () => {
      cancelled = true
      onPendingChange(false)
    }
  }, [floors, onPendingChange, renderedFloors, surfaceAssignments])

  return null
}

const WallMesh = memo(function WallMesh({
  castsShadow,
  elevation,
  floorId,
  isActive,
  onRegisterPickTarget,
  renderedWall,
  selectedWallId,
  selectedSurface,
  surfaceAssignments,
  wallBodyOccluders,
  wireframe,
}: {
  castsShadow: boolean
  elevation: number
  floorId: string
  isActive: boolean
  onRegisterPickTarget: (target: PickTarget) => () => void
  renderedWall: RenderedWall
  selectedWallId: string | null
  selectedSurface: SelectableSurface | null
  surfaceAssignments: SurfaceMaterialAssignment[]
  wallBodyOccluders: WallBodyOccluder[]
  wireframe: boolean
}) {
  const { wall, startExtension, endExtension } = renderedWall
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dz)
  const renderedLength = Math.max(0.01, length + startExtension + endExtension)
  const unitX = length === 0 ? 0 : dx / length
  const unitZ = length === 0 ? 0 : dz / length
  const centerX =
    (wall.start.x + wall.end.x) / 2 + unitX * ((endExtension - startExtension) / 2)
  const centerZ =
    (wall.start.y + wall.end.y) / 2 + unitZ * ((endExtension - startExtension) / 2)
  const rotationY = -Math.atan2(dz, dx)
  const openings = (wall.openings ?? [])
    .map((opening) => {
      const center = startExtension + opening.center
      const left = Math.max(0, center - opening.width / 2)
      const right = Math.min(renderedLength, center + opening.width / 2)
      const bottom = Math.max(0, Math.min(wall.height, opening.bottom))
      const top = Math.max(bottom, Math.min(wall.height, opening.bottom + opening.height))

      return right > left && top > bottom
        ? {
            bottom,
            left,
            right,
            top,
          }
        : null
    })
    .filter(
      (
        opening,
      ): opening is { bottom: number; left: number; right: number; top: number } =>
        Boolean(opening),
    )
  const wallMaterialAssignments = getWallMaterialAssignments(
    surfaceAssignments,
    wall.id,
  )
  useEffect(() => {
    recordWallRenderDebug(
      'wall-renderer:legacy-wall',
      `floor=${floorId} wall=${wall.id}`,
      JSON.stringify({
        center: [Number(centerX.toFixed(3)), Number(centerZ.toFixed(3))],
        end: [
          Number(wall.end.x.toFixed(3)),
          Number(wall.end.y.toFixed(3)),
        ],
        endExtension: Number(endExtension.toFixed(3)),
        kind: wall.kind,
        openings: openings.length,
        renderedLength: Number(renderedLength.toFixed(3)),
        start: [
          Number(wall.start.x.toFixed(3)),
          Number(wall.start.y.toFixed(3)),
        ],
        startExtension: Number(startExtension.toFixed(3)),
      }),
    )
  }, [
    centerX,
    centerZ,
    endExtension,
    floorId,
    openings.length,
    renderedLength,
    startExtension,
    wall.end.x,
    wall.end.y,
    wall.id,
    wall.kind,
    wall.start.x,
    wall.start.y,
  ])
  const getCapMaterialReference = (
    distanceAlongWall: number,
    capDirection: Point,
    height: number,
  ) => {
    const capPoint = getRenderedWallLocalPoint(renderedWall, distanceAlongWall)
    const adjoiningWall = wallBodyOccluders
      .filter((occluder) => occluder.wallId !== wall.id)
      .map((occluder) => {
        const inside = isPointInsideOrOnPolygon(capPoint, occluder.polygon)
        const boundaryDistance = getDistanceToPolygonBoundary(
          capPoint,
          occluder.polygon,
        )
        const touchTolerance = Math.max(
          0.03,
          Math.min(wall.thickness, occluder.renderedWall.wall.thickness) * 0.35,
        )

        return {
          boundaryDistance,
          inside,
          occluder,
          touches: inside || boundaryDistance <= touchTolerance,
        }
      })
      .filter((candidate) => candidate.touches)
      .sort(
        (first, second) =>
          Number(second.inside) - Number(first.inside) ||
          first.boundaryDistance - second.boundaryDistance ||
          first.occluder.wallId.localeCompare(second.occluder.wallId),
      )[0]?.occluder

    if (!adjoiningWall) {
      return undefined
    }

    const adjoiningSide = getWallSideFacingDirection(
      adjoiningWall.renderedWall,
      capDirection,
    )

    return {
      assignment: getWallMaterialAssignmentForSide(
        getWallMaterialAssignments(surfaceAssignments, adjoiningWall.wallId),
        adjoiningSide,
        height,
      ),
      uvProjector: {
        renderedWall: adjoiningWall.renderedWall,
      },
    }
  }
  const activeWallSegments = (() => {
    const tolerance = 0.001
    const occlusionBreaks = getWallBodyOcclusionBreaks(
      renderedWall,
      renderedLength,
      wallBodyOccluders,
    )
    const isOcclusionBreak = (position: number) =>
      occlusionBreaks.some(
        (occlusionBreak) => Math.abs(occlusionBreak - position) <= tolerance,
      )
    const xBreaks = [
      0,
      renderedLength,
      ...occlusionBreaks,
      ...openings.flatMap((opening) => [opening.left, opening.right]),
    ]
      .filter((position) => position >= 0 && position <= renderedLength)
      .sort((firstPosition, secondPosition) => firstPosition - secondPosition)
    const uniqueBreaks = xBreaks.filter(
      (position, index) => index === 0 || Math.abs(position - xBreaks[index - 1]) > 0.001,
    )
    const yBreaks = [
      0,
      wall.height,
      ...openings.flatMap((opening) => [opening.bottom, opening.top]),
      ...wallMaterialAssignments.flatMap((assignment) => {
        const coverageHeight = assignment.coverageHeight ?? wall.height

        return coverageHeight > tolerance && coverageHeight < wall.height - tolerance
          ? [coverageHeight]
          : []
      }),
    ]
      .filter((position) => position >= 0 && position <= wall.height)
      .sort((firstPosition, secondPosition) => firstPosition - secondPosition)
    const uniqueYBreaks = yBreaks.filter(
      (position, index) =>
        index === 0 || Math.abs(position - yBreaks[index - 1]) > tolerance,
    )
    const overlaps = (
      firstStart: number,
      firstEnd: number,
      secondStart: number,
      secondEnd: number,
    ) => firstStart < secondEnd - tolerance && firstEnd > secondStart + tolerance
    const equals = (first: number, second: number) =>
      Math.abs(first - second) <= tolerance

    return uniqueBreaks.slice(0, -1).flatMap((start, xIndex) => {
      const end = uniqueBreaks[xIndex + 1]
      const segmentLength = end - start

      if (segmentLength <= 0.001) {
        return []
      }

      const midpoint = (start + end) / 2

      if (isWallSegmentOccluded(renderedWall, midpoint, wallBodyOccluders)) {
        return []
      }

      const skipLeftEndCap =
        start > tolerance &&
        (isOcclusionBreak(start) ||
          isWallSegmentOccluded(
            renderedWall,
            Math.max(0, start - tolerance * 2),
            wallBodyOccluders,
          ))
      const skipRightEndCap =
        end < renderedLength - tolerance &&
        (isOcclusionBreak(end) ||
          isWallSegmentOccluded(
            renderedWall,
            Math.min(renderedLength, end + tolerance * 2),
            wallBodyOccluders,
          ))
      const leftCapReference = getCapMaterialReference(start, {
        x: -unitX,
        y: -unitZ,
      }, wall.height)
      const rightCapReference = getCapMaterialReference(end, {
        x: unitX,
        y: unitZ,
      }, wall.height)

      return uniqueYBreaks.slice(0, -1).flatMap((bottom, yIndex) => {
        const top = uniqueYBreaks[yIndex + 1]
        const segmentHeight = top - bottom

        if (segmentHeight <= tolerance) {
          return []
        }

        const verticalMidpoint = (bottom + top) / 2
        const segmentTop = bottom + segmentHeight
        const isOpeningVoid = openings.some(
          (opening) =>
            midpoint > opening.left + tolerance &&
            midpoint < opening.right - tolerance &&
            verticalMidpoint > opening.bottom + tolerance &&
            verticalMidpoint < opening.top - tolerance,
        )

        if (isOpeningVoid) {
          return []
        }

        return [
          {
            center: midpoint,
            height: segmentHeight,
            leftCapAssignment:
              leftCapReference?.assignment &&
              (leftCapReference.assignment.coverageHeight ?? wall.height) >=
                segmentTop - tolerance
                ? leftCapReference.assignment
                : undefined,
            leftCapUvProjector: leftCapReference?.uvProjector,
            length: segmentLength,
            rightCapAssignment:
              rightCapReference?.assignment &&
              (rightCapReference.assignment.coverageHeight ?? wall.height) >=
                segmentTop - tolerance
                ? rightCapReference.assignment
                : undefined,
            rightCapUvProjector: rightCapReference?.uvProjector,
            revealBottom: openings.some(
              (opening) =>
                equals(top, opening.bottom) &&
                overlaps(start, end, opening.left, opening.right),
            ),
            revealLeft: openings.some(
              (opening) =>
                equals(start, opening.right) &&
                overlaps(bottom, top, opening.bottom, opening.top),
            ),
            revealRight: openings.some(
              (opening) =>
                equals(end, opening.left) &&
                overlaps(bottom, top, opening.bottom, opening.top),
            ),
            skipLeftEndCap,
            skipRightEndCap,
            revealTop: openings.some(
              (opening) =>
                equals(bottom, opening.top) &&
                overlaps(start, end, opening.left, opening.right),
            ),
            y: bottom + segmentHeight / 2,
          },
        ]
      })
    })
  })()
  const visibleWallSegments: WallRenderSegment[] =
    activeWallSegments.length > 0
      ? activeWallSegments
      : [
          {
            center: renderedLength / 2,
            height: wall.height,
            length: renderedLength,
            revealBottom: false,
            revealLeft: false,
            revealRight: false,
            revealTop: false,
            skipLeftEndCap: false,
            skipRightEndCap: false,
            y: wall.height / 2,
          },
        ]
  return (
    <>
      <group
        position={[centerX, elevation + wall.height / 2, centerZ]}
        rotation={[0, rotationY, 0]}
        renderOrder={isActive ? 2 : 1}
      >
        {isActive ? (
          <>
            {visibleWallSegments.map((segment, index) => (
              <WallSegmentMesh
                key={index}
                castsShadow={castsShadow}
                centerX={centerX}
                centerZ={centerZ}
                floorId={floorId}
                onRegisterPickTarget={onRegisterPickTarget}
                renderedLength={renderedLength}
                rotationY={rotationY}
                selectedWallId={selectedWallId}
                selectedSurface={selectedSurface}
                segment={segment}
                wall={wall}
                wallId={wall.id}
                wallMaterialAssignments={wallMaterialAssignments}
                wallHeight={wall.height}
                wallKind={wall.kind}
                wallThickness={wall.thickness}
                wireframe={wireframe}
              />
            ))}
          </>
        ) : (
          <mesh castShadow={castsShadow} receiveShadow={castsShadow}>
            <boxGeometry args={[renderedLength, wall.height, wall.thickness]} />
            <meshBasicMaterial
              color="#94a3b8"
              depthWrite={false}
              opacity={0.015}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
              transparent
              wireframe={wireframe}
            />
            <Edges color="#64748b" threshold={15} />
          </mesh>
        )}
      </group>
    </>
  )
})

type SkirtingWallFace = {
  end: Point
  length: number
  renderedWall: RenderedWall
  start: Point
  unit: Point
}

function getDistanceToSegment(point: Point, segmentStart: Point, segmentEnd: Point) {
  const dx = segmentEnd.x - segmentStart.x
  const dy = segmentEnd.y - segmentStart.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y)
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) /
        lengthSquared,
    ),
  )
  const projection = {
    x: segmentStart.x + dx * t,
    y: segmentStart.y + dy * t,
  }

  return Math.hypot(point.x - projection.x, point.y - projection.y)
}

function pointAtDistanceOnSkirtingFace(face: SkirtingWallFace, distance: number) {
  return {
    x: face.start.x + face.unit.x * distance,
    y: face.start.y + face.unit.y * distance,
  }
}

function getDistanceAlongSkirtingFace(face: SkirtingWallFace, point: Point) {
  return (
    (point.x - face.start.x) * face.unit.x +
    (point.y - face.start.y) * face.unit.y
  )
}

function getSkirtingWallFace(
  edgeStart: Point,
  edgeEnd: Point,
  renderedWalls: RenderedWall[],
): SkirtingWallFace | null {
  for (const renderedWall of renderedWalls) {
    const polygon = getWallPolygon(renderedWall)
    const faces = [
      [polygon[0], polygon[1]],
      [polygon[3], polygon[2]],
    ] as const

    for (const [faceStart, faceEnd] of faces) {
      const faceDx = faceEnd.x - faceStart.x
      const faceDy = faceEnd.y - faceStart.y
      const faceLength = Math.hypot(faceDx, faceDy)

      if (
        faceLength < SKIRTING_MIN_SEGMENT_METERS ||
        getDistanceToSegment(edgeStart, faceStart, faceEnd) >
          SKIRTING_WALL_MATCH_TOLERANCE_METERS ||
        getDistanceToSegment(edgeEnd, faceStart, faceEnd) >
          SKIRTING_WALL_MATCH_TOLERANCE_METERS
      ) {
        continue
      }

      return {
        end: faceEnd,
        length: faceLength,
        renderedWall,
        start: faceStart,
        unit: {
          x: faceDx / faceLength,
          y: faceDy / faceLength,
        },
      }
    }
  }

  return null
}

function getSkirtingSegmentsAroundOpenings(
  edgeStart: Point,
  edgeEnd: Point,
  face: SkirtingWallFace,
  models: PlacedModel[],
) {
  const edgeStartDistance = getDistanceAlongSkirtingFace(face, edgeStart)
  const edgeEndDistance = getDistanceAlongSkirtingFace(face, edgeEnd)
  const startDistance = Math.max(0, Math.min(edgeStartDistance, edgeEndDistance))
  const endDistance = Math.min(face.length, Math.max(edgeStartDistance, edgeEndDistance))
  const { renderedWall } = face
  const doorwayIntervals = (renderedWall.wall.openings ?? [])
    .filter(
      (opening) =>
        opening.bottom <= SKIRTING_OPENING_FLOOR_TOLERANCE_METERS &&
        opening.height > SKIRTING_HEIGHT_METERS,
    )
    .map((opening) => {
      const openingCenter = renderedWall.startExtension + opening.center
      return {
        end: Math.min(
          endDistance,
          openingCenter + opening.width / 2 + SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
        ),
        start: Math.max(
          startDistance,
          openingCenter - opening.width / 2 - SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
        ),
      }
    })
    .concat(
      models
        .filter((model) => model.wallAttachment?.wallId === renderedWall.wall.id)
        .flatMap((model) => {
          const definition = modelsById.get(model.modelId)

          if (!definition?.wallMount || definition.wallMount === 'window') {
            return []
          }

          const scale = model.scale ?? 1
          const width = Math.max(
            (definition.openingWidth ?? definition.width) * scale,
            0.3,
          )
          const openingCenter =
            renderedWall.startExtension +
            getProjectedModelOffsetOnWall(model, renderedWall.wall) +
            (definition.openingCenterOffset ?? 0) * scale

          return [
            {
              end: Math.min(
                endDistance,
                openingCenter + width / 2 + SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
              ),
              start: Math.max(
                startDistance,
                openingCenter - width / 2 - SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
              ),
            },
          ]
        }),
    )
    .filter((interval) => interval.end > interval.start)
    .sort((firstInterval, secondInterval) => firstInterval.start - secondInterval.start)

  if (doorwayIntervals.length === 0) {
    return [{ end: edgeEnd, start: edgeStart }]
  }

  const segments: Array<{ end: Point; start: Point }> = []
  let cursor = startDistance

  for (const interval of doorwayIntervals) {
    if (interval.start - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
      segments.push({
        end: pointAtDistanceOnSkirtingFace(face, interval.start),
        start: pointAtDistanceOnSkirtingFace(face, cursor),
      })
    }

    cursor = Math.max(cursor, interval.end)
  }

  if (endDistance - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
    segments.push({
      end: pointAtDistanceOnSkirtingFace(face, endDistance),
      start: pointAtDistanceOnSkirtingFace(face, cursor),
    })
  }

  return segments
}

function getPointAtSegmentDistance(start: Point, unit: Point, distance: number) {
  return {
    x: start.x + unit.x * distance,
    y: start.y + unit.y * distance,
  }
}

function getDistanceAlongSegment(start: Point, unit: Point, point: Point) {
  return (point.x - start.x) * unit.x + (point.y - start.y) * unit.y
}

function getProjectedModelOffsetOnWall(model: PlacedModel, wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= 0.000001) {
    return 0
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((model.position.x - wall.start.x) * dx +
        (model.position.y - wall.start.y) * dy) /
        lengthSquared,
    ),
  )

  return Math.sqrt(lengthSquared) * t
}

function getDoorwayClipIntervalsForSkirtingSegment(
  segmentStart: Point,
  segmentEnd: Point,
  renderedWalls: RenderedWall[],
  models: PlacedModel[],
) {
  const segmentDx = segmentEnd.x - segmentStart.x
  const segmentDy = segmentEnd.y - segmentStart.y
  const segmentLength = Math.hypot(segmentDx, segmentDy)

  if (segmentLength < SKIRTING_MIN_SEGMENT_METERS) {
    return []
  }

  const segmentUnit = {
    x: segmentDx / segmentLength,
    y: segmentDy / segmentLength,
  }
  const getProjectedInterval = (
    wall: Wall,
    centerDistance: number,
    width: number,
  ) => {
    const wallLength = Math.hypot(
      wall.end.x - wall.start.x,
      wall.end.y - wall.start.y,
    )

    if (wallLength < SKIRTING_MIN_SEGMENT_METERS) {
      return null
    }

    const wallUnit = {
      x: (wall.end.x - wall.start.x) / wallLength,
      y: (wall.end.y - wall.start.y) / wallLength,
    }
    const parallel = Math.abs(
      wallUnit.x * segmentUnit.x + wallUnit.y * segmentUnit.y,
    )

    if (parallel < 0.94) {
      return null
    }

    const centerPoint = getPointAtSegmentDistance(
      wall.start,
      wallUnit,
      centerDistance,
    )
    const maxDistanceFromWallFace =
      wall.thickness / 2 + SKIRTING_DOOR_PROJECTION_TOLERANCE_METERS

    if (
      getDistanceToSegment(centerPoint, segmentStart, segmentEnd) >
      maxDistanceFromWallFace
    ) {
      return null
    }

    const openingStart = getPointAtSegmentDistance(
      wall.start,
      wallUnit,
      centerDistance - width / 2 - SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
    )
    const openingEnd = getPointAtSegmentDistance(
      wall.start,
      wallUnit,
      centerDistance + width / 2 + SKIRTING_OPENING_EDGE_CLEARANCE_METERS,
    )
    const firstDistance = getDistanceAlongSegment(
      segmentStart,
      segmentUnit,
      openingStart,
    )
    const secondDistance = getDistanceAlongSegment(
      segmentStart,
      segmentUnit,
      openingEnd,
    )

    return {
      end: Math.min(segmentLength, Math.max(firstDistance, secondDistance)),
      start: Math.max(0, Math.min(firstDistance, secondDistance)),
    }
  }
  const openingIntervals = renderedWalls.flatMap((renderedWall) =>
    (renderedWall.wall.openings ?? []).flatMap((opening) => {
      if (
        opening.bottom > SKIRTING_OPENING_FLOOR_TOLERANCE_METERS ||
        opening.height <= SKIRTING_HEIGHT_METERS
      ) {
        return []
      }

      const interval = getProjectedInterval(
        renderedWall.wall,
        opening.center,
        opening.width,
      )

      return interval ? [interval] : []
    }),
  )
  const modelIntervals = models.flatMap((model) => {
    const definition = modelsById.get(model.modelId)

    if (!definition?.wallMount || definition.wallMount === 'window') {
      return []
    }

    const renderedWall = renderedWalls.find(
      (candidateWall) =>
        candidateWall.wall.id === model.wallAttachment?.wallId,
    )

    if (!renderedWall || !model.wallAttachment) {
      return []
    }

    const scale = model.scale ?? 1
    const width = Math.max(
      (definition.openingWidth ?? definition.width) * scale,
      0.3,
    )
    const interval = getProjectedInterval(
      renderedWall.wall,
      getProjectedModelOffsetOnWall(model, renderedWall.wall) +
        (definition.openingCenterOffset ?? 0) * scale,
      width,
    )

    return interval ? [interval] : []
  })

  return [...openingIntervals, ...modelIntervals]
    .filter((interval) => interval.end - interval.start >= SKIRTING_MIN_SEGMENT_METERS)
    .sort((firstInterval, secondInterval) => firstInterval.start - secondInterval.start)
}

function clipSkirtingSegmentsForDoorways(
  segments: Array<{ end: Point; start: Point }>,
  renderedWalls: RenderedWall[],
  models: PlacedModel[],
) {
  return segments.flatMap((segment) => {
    const segmentDx = segment.end.x - segment.start.x
    const segmentDy = segment.end.y - segment.start.y
    const segmentLength = Math.hypot(segmentDx, segmentDy)

    if (segmentLength < SKIRTING_MIN_SEGMENT_METERS) {
      return []
    }

    const unit = {
      x: segmentDx / segmentLength,
      y: segmentDy / segmentLength,
    }
    const intervals = getDoorwayClipIntervalsForSkirtingSegment(
      segment.start,
      segment.end,
      renderedWalls,
      models,
    )

    if (intervals.length === 0) {
      return [segment]
    }

    const clippedSegments: Array<{ end: Point; start: Point }> = []
    let cursor = 0

    for (const interval of intervals) {
      if (interval.start - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
        clippedSegments.push({
          end: getPointAtSegmentDistance(segment.start, unit, interval.start),
          start: getPointAtSegmentDistance(segment.start, unit, cursor),
        })
      }

      cursor = Math.max(cursor, interval.end)
    }

    if (segmentLength - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
      clippedSegments.push({
        end: getPointAtSegmentDistance(segment.start, unit, segmentLength),
        start: getPointAtSegmentDistance(segment.start, unit, cursor),
      })
    }

    return clippedSegments
  })
}

function getMatchingFootprintSkirtingSegment(
  start: Point,
  end: Point,
  footprints: WallUnionFootprint[],
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length < SKIRTING_MIN_SEGMENT_METERS) {
    return null
  }

  const unit = {
    x: dx / length,
    y: dy / length,
  }
  const normal = {
    x: -unit.y,
    y: unit.x,
  }
  const lineTolerance = 0.06
  const projectionTolerance = 0.2
  let bestMatch: { distance: number; edge: PlanFootprintEdge; reversed: boolean } | null =
    null

  for (const edge of getFootprintEdges(footprints)) {
    const metrics = getEdgeMetrics(edge)

    if (!metrics || metrics.length < SKIRTING_MIN_SEGMENT_METERS) {
      continue
    }

    const parallel = metrics.unit.x * unit.x + metrics.unit.y * unit.y

    if (Math.abs(parallel) < 0.94) {
      continue
    }

    const startDistance =
      Math.abs((start.x - edge.start.x) * normal.x + (start.y - edge.start.y) * normal.y)
    const endDistance =
      Math.abs((end.x - edge.start.x) * normal.x + (end.y - edge.start.y) * normal.y)
    const averageDistance = (startDistance + endDistance) / 2

    if (averageDistance > lineTolerance) {
      continue
    }

    const edgeStartProjection =
      (edge.start.x - start.x) * unit.x + (edge.start.y - start.y) * unit.y
    const edgeEndProjection =
      (edge.end.x - start.x) * unit.x + (edge.end.y - start.y) * unit.y
    const minProjection = Math.min(edgeStartProjection, edgeEndProjection)
    const maxProjection = Math.max(edgeStartProjection, edgeEndProjection)

    if (
      maxProjection < -projectionTolerance ||
      minProjection > length + projectionTolerance
    ) {
      continue
    }

    if (!bestMatch || averageDistance < bestMatch.distance) {
      bestMatch = {
        distance: averageDistance,
        edge,
        reversed: parallel < 0,
      }
    }
  }

  if (!bestMatch) {
    return null
  }

  return bestMatch.reversed
    ? { end: bestMatch.edge.start, start: bestMatch.edge.end }
    : { end: bestMatch.edge.end, start: bestMatch.edge.start }
}

const SkirtingBoards = memo(function SkirtingBoards({
  elevation,
  externalWallUnionFootprints,
  models,
  renderedWalls,
  rooms,
  wireframe,
}: {
  elevation: number
  externalWallUnionFootprints: WallUnionFootprint[]
  models: PlacedModel[]
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
  wireframe: boolean
}) {
  const skirtingRuns = useMemo(
    () =>
      rooms.flatMap((room, roomIndex) => {
        const isCounterClockwise = getSignedArea(room.polygon) > 0

        return room.polygon.flatMap((start, edgeIndex) => {
          const end = room.polygon[(edgeIndex + 1) % room.polygon.length]
          const dx = end.x - start.x
          const dz = end.y - start.y
          const length = Math.hypot(dx, dz)

          if (length < SKIRTING_MIN_SEGMENT_METERS) {
            return []
          }

          const inwardNormal = isCounterClockwise
            ? { x: -dz / length, z: dx / length }
            : { x: dz / length, z: -dx / length }
          const wallFace = getSkirtingWallFace(start, end, renderedWalls)
          const footprintSegment = getMatchingFootprintSkirtingSegment(
            start,
            end,
            externalWallUnionFootprints,
          )
          const baseSegments = wallFace
            ? getSkirtingSegmentsAroundOpenings(
                footprintSegment?.start ?? start,
                footprintSegment?.end ?? end,
                wallFace,
                models,
              )
            : [footprintSegment ?? { end, start }]
          const segments = clipSkirtingSegmentsForDoorways(
            baseSegments,
            renderedWalls,
            models,
          )

          return segments
            .filter(
              (segment) =>
                Math.hypot(
                  segment.end.x - segment.start.x,
                  segment.end.y - segment.start.y,
                ) >= SKIRTING_MIN_SEGMENT_METERS,
            )
            .map((segment, segmentIndex) => ({
              end: segment.end,
              inwardNormal,
              key: `${room.signature}-${roomIndex}-${edgeIndex}-${segmentIndex}`,
              start: segment.start,
            }))
        })
      }),
    [externalWallUnionFootprints, models, renderedWalls, rooms],
  )

  return (
    <group renderOrder={3}>
      {skirtingRuns.map((run) => {
          const dx = run.end.x - run.start.x
          const dz = run.end.y - run.start.y
          const length = Math.hypot(dx, dz)
          const centerX =
            (run.start.x + run.end.x) / 2 +
            run.inwardNormal.x * (SKIRTING_DEPTH_METERS / 2)
          const centerZ =
            (run.start.y + run.end.y) / 2 +
            run.inwardNormal.z * (SKIRTING_DEPTH_METERS / 2)
          const rotationY = -Math.atan2(dz, dx)

          return (
            <mesh
              key={run.key}
              position={[
                centerX,
                elevation + SKIRTING_HEIGHT_METERS / 2,
                centerZ,
              ]}
              receiveShadow
              rotation={[0, rotationY, 0]}
            >
              <boxGeometry
                args={[length, SKIRTING_HEIGHT_METERS, SKIRTING_DEPTH_METERS]}
              />
              <meshStandardMaterial
                color="#f8fafc"
                roughness={0.58}
                wireframe={wireframe}
              />
            </mesh>
          )
      })}
    </group>
  )
})

function FloorSlabEdgeFace({
  assignment,
  edgeIndex,
  floorId,
  floor,
  isSelected,
  material,
  onRegisterPickTarget,
  point,
  nextPoint,
  wireframe,
}: {
  assignment?: SurfaceMaterialAssignment
  edgeIndex: number
  floorId: string
  floor: FloorLevel
  isSelected: boolean
  material?: SurfaceMaterialProduct
  nextPoint: Point
  onRegisterPickTarget?: (target: PickTarget) => () => void
  point: Point
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const dx = nextPoint.x - point.x
  const dz = nextPoint.y - point.y
  const length = Math.hypot(dx, dz)
  const centerX = (point.x + nextPoint.x) / 2
  const centerZ = (point.y + nextPoint.y) / 2
  const rotationY = -Math.atan2(dz, dx)
  const y = floor.elevation + floor.roomHeight - floor.slabThickness / 2
  const surface: SelectableSurface = useMemo(
    () => ({
      floorId,
      type: 'floor-slab-edge',
    }),
    [floorId],
  )

  useEffect(() => {
    const object = meshRef.current

    if (!object || !onRegisterPickTarget) {
      return undefined
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      kind: 'surface',
      object,
      surface,
    })
  }, [floorId, onRegisterPickTarget, surface])

  if (length <= 0.001) {
    return null
  }

  return (
    <group
      key={edgeIndex}
      position={[centerX, y, centerZ]}
      rotation={[0, rotationY, 0]}
      renderOrder={isSelected ? 7 : assignment ? 4 : -1}
    >
      <mesh ref={meshRef}>
        <planeGeometry args={[length, floor.slabThickness]} />
        {assignment && material ? (
          <SurfaceMeshStandardMaterial
            assignment={assignment}
            displacementEnabled={false}
            material={material}
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            repeatOverride={getSurfaceRepeatForDimensions(
              material,
              length,
              floor.slabThickness,
            )}
            side={DoubleSide}
            textureQuality={getWallSurfaceTextureQuality(material)}
            wireframe={wireframe}
          />
        ) : (
          <meshBasicMaterial
            color="#f97316"
            depthTest={false}
            depthWrite={false}
            opacity={isSelected ? 0.3 : 0}
            side={DoubleSide}
            transparent
          />
        )}
      </mesh>
      {assignment && material && isSelected ? (
        <mesh position={[0, 0, 0.004]}>
          <planeGeometry args={[length, floor.slabThickness]} />
          <meshBasicMaterial
            color="#f97316"
            depthTest={false}
            depthWrite={false}
            opacity={0.22}
            side={DoubleSide}
            transparent
          />
        </mesh>
      ) : null}
    </group>
  )
}

const SUN_SHADOW_BLOCKER_USER_DATA = 'houseDesignerSunShadowBlocker'

function FloorSlab({
  castsShadow,
  floor,
  floors,
  isSolid,
  onRegisterPickTarget,
  selectedSurface,
  sunShadowBlocker,
  surfaceAssignments,
  upperFloor,
  wireframe,
}: {
  castsShadow: boolean
  floor: FloorLevel
  floors: FloorLevel[]
  isSolid: boolean
  onRegisterPickTarget?: (target: PickTarget) => () => void
  selectedSurface?: SelectableSurface | null
  sunShadowBlocker?: boolean
  surfaceAssignments?: SurfaceMaterialAssignment[]
  upperFloor: FloorLevel | null
  wireframe: boolean
}) {
  const footprints = getSlabFootprints(floor, upperFloor, floors)
  const edgeAssignment = getFloorSlabEdgeMaterialAssignment(
    surfaceAssignments ?? [],
    floor.id,
  )
  const edgeMaterial = edgeAssignment
    ? surfaceMaterialsById.get(edgeAssignment.materialId)
    : undefined
  const edgeSurface = useMemo<SelectableSurface>(
    () => ({
      floorId: floor.id,
      type: 'floor-slab-edge',
    }),
    [floor.id],
  )
  const edgeIsSelected = surfacesMatch(selectedSurface ?? null, edgeSurface)
  const slabShapes = useMemo(
    () =>
      footprints.map((footprint) => {
        const [firstPoint, ...remainingPoints] = footprint
        const shape = new Shape()
        shape.moveTo(firstPoint.x, -firstPoint.y)

        for (const point of remainingPoints) {
          shape.lineTo(point.x, -point.y)
        }

        shape.closePath()
        return shape
      }),
    [footprints],
  )

  if (slabShapes.length === 0) {
    return null
  }

  return (
    <group>
      {slabShapes.map((slabShape, index) => (
        <group key={index}>
          <mesh
            castShadow={castsShadow && (isSolid || Boolean(sunShadowBlocker))}
            receiveShadow={isSolid}
            position={[0, floor.elevation + floor.roomHeight, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={0}
            userData={{
              [SUN_SHADOW_BLOCKER_USER_DATA]: !isSolid && Boolean(sunShadowBlocker),
            }}
          >
            <extrudeGeometry
              args={[
                slabShape,
                {
                  bevelEnabled: false,
                  depth: floor.slabThickness,
                },
              ]}
            />
            {isSolid ? (
              <meshStandardMaterial
                color="#cbd5e1"
                roughness={0.82}
                shadowSide={DoubleSide}
                side={DoubleSide}
                wireframe={wireframe}
              />
            ) : (
              <meshStandardMaterial
                colorWrite={false}
                depthWrite={false}
                shadowSide={DoubleSide}
                wireframe={wireframe}
              />
            )}
          </mesh>
          {isSolid ? (
            <mesh
              position={[0, floor.elevation + floor.roomHeight - 0.002, 0]}
              receiveShadow
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={1}
            >
              <shapeGeometry args={[slabShape]} />
              <meshStandardMaterial
                color="#e2e8f0"
                roughness={0.82}
                side={DoubleSide}
                wireframe={wireframe}
              />
            </mesh>
          ) : null}
          {slabShape.getPoints().map((point, edgeIndex, points) => (
            <FloorSlabEdgeFace
              key={edgeIndex}
              assignment={edgeAssignment}
              edgeIndex={edgeIndex}
              floor={floor}
              floorId={floor.id}
              isSelected={edgeIsSelected}
              material={edgeMaterial}
              nextPoint={{
                x: points[(edgeIndex + 1) % points.length].x,
                y: -points[(edgeIndex + 1) % points.length].y,
              }}
              onRegisterPickTarget={onRegisterPickTarget}
              point={{ x: point.x, y: -point.y }}
              wireframe={wireframe}
            />
          ))}
        </group>
      ))}
    </group>
  )
}

function createPlanShape(points: Point[]) {
  const [firstPoint, ...remainingPoints] = points
  const shape = new Shape()

  shape.moveTo(firstPoint.x, -firstPoint.y)

  for (const point of remainingPoints) {
    shape.lineTo(point.x, -point.y)
  }

  shape.closePath()
  return shape
}

function createPlanShapeWithHoles({ holes, outline }: WallUnionFootprint) {
  const shape = createPlanShape(outline)

  for (const hole of holes) {
    const [firstPoint, ...remainingPoints] = hole

    if (!firstPoint) {
      continue
    }

    const path = new Path()
    path.moveTo(firstPoint.x, -firstPoint.y)

    for (const point of remainingPoints) {
      path.lineTo(point.x, -point.y)
    }

    path.closePath()
    shape.holes.push(path)
  }

  return shape
}

function hasWallOpenings(wall: Wall) {
  return (wall.openings ?? []).length > 0
}

function getWallEngineCandidateRenderedWalls(
  renderedWalls: RenderedWall[],
  surfaceAssignments: SurfaceMaterialAssignment[],
) {
  if (!WALL_ENGINE_RENDERER_ENABLED) {
    return []
  }

  return renderedWalls.filter(
    (renderedWall) =>
      (renderedWall.wall.kind === 'internal' ||
        renderedWall.wall.kind === 'external') &&
      getBaseWallEngineExclusionReasons(
        renderedWall.wall,
        surfaceAssignments,
      ).length === 0,
  )
}

function getUnsupportedWallEngineMaterialAssignments(
  wall: Wall,
  surfaceAssignments: SurfaceMaterialAssignment[],
) {
  return getWallMaterialAssignments(surfaceAssignments, wall.id).filter(
    (assignment) => (assignment.coverageHeight ?? wall.height) < wall.height - 0.001,
  )
}

function getBaseWallEngineExclusionReasons(
  wall: Wall,
  surfaceAssignments: SurfaceMaterialAssignment[],
) {
  const reasons: string[] = []

  if (!WALL_ENGINE_RENDERER_ENABLED) {
    reasons.push('engine-disabled')
  }

  if (
    getUnsupportedWallEngineMaterialAssignments(wall, surfaceAssignments).length > 0
  ) {
    reasons.push('has-partial-material-assignments')
  }

  return reasons
}

function wallCanUseEngineRenderer(
  wall: Wall,
  surfaceAssignments: SurfaceMaterialAssignment[],
) {
  return getBaseWallEngineExclusionReasons(wall, surfaceAssignments).length === 0
}

function getWallIdsForEngineHandledInternalFootprintGroups(
  internalWallFootprintGroups: WallFootprintRenderGroup[],
  wallEngineCandidateWallIds: Set<string>,
) {
  return new Set(
    internalWallFootprintGroups.flatMap((group) => {
      const wallIds = group.wallIds && group.wallIds.length > 1 ? group.wallIds : []

      return wallIds.length > 0 &&
        wallIds.every((wallId) => wallEngineCandidateWallIds.has(wallId))
        ? wallIds
        : []
    }),
  )
}

function getWallIdsForLegacyInternalFootprintGroups(
  internalWallFootprintGroups: WallFootprintRenderGroup[],
  wallEngineCandidateWallIds: Set<string>,
) {
  return new Set(
    internalWallFootprintGroups.flatMap((group) => {
      const wallIds = group.wallIds && group.wallIds.length > 1 ? group.wallIds : []

      return wallIds.length > 0 &&
        !wallIds.every((wallId) => wallEngineCandidateWallIds.has(wallId))
        ? wallIds
        : []
    }),
  )
}

function internalFootprintGroupUsesWallEngine(
  group: WallFootprintRenderGroup,
  wallEngineHandledInternalFootprintWallIds: Set<string>,
) {
  const wallIds = group.wallIds && group.wallIds.length > 1 ? group.wallIds : []

  return (
    wallIds.length > 0 &&
    wallIds.every((wallId) =>
      wallEngineHandledInternalFootprintWallIds.has(wallId),
    )
  )
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

function getExternalWallUnionWalls(
  walls: Wall[],
  surfaceAssignments: SurfaceMaterialAssignment[],
) {
  const externalWalls = walls.filter((wall) => wall.kind === 'external')
  const visitedWallIds = new Set<string>()
  const unionWalls: Wall[] = []

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
      unionWalls.push(
        ...component.filter(
          (componentWall) =>
            !wallCanUseEngineRenderer(componentWall, surfaceAssignments),
        ),
      )
    }
  }

  return unionWalls
}

function createUnionFootprintEdgeGeometry(
  footprint: WallUnionFootprint,
  elevation: number,
  height: number,
) {
  const geometry = new BufferGeometry()
  const positions: number[] = []
  const addSegment = (start: [number, number, number], end: [number, number, number]) => {
    positions.push(...start, ...end)
  }
  const addRing = (ring: Point[]) => {
    if (ring.length < 2) {
      return
    }

    ring.forEach((point, index) => {
      const nextPoint = ring[(index + 1) % ring.length]
      const bottom: [number, number, number] = [point.x, elevation, point.y]
      const nextBottom: [number, number, number] = [
        nextPoint.x,
        elevation,
        nextPoint.y,
      ]
      const top: [number, number, number] = [point.x, elevation + height, point.y]
      const nextTop: [number, number, number] = [
        nextPoint.x,
        elevation + height,
        nextPoint.y,
      ]

      addSegment(bottom, nextBottom)
      addSegment(top, nextTop)
      addSegment(bottom, top)
    })
  }

  addRing(footprint.outline)
  footprint.holes.forEach(addRing)
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}

function getWallBasis(wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  const unit = length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 }
  const normal = { x: -unit.y, y: unit.x }

  return { length, normal, unit }
}

function getDistanceAlongWall(wall: Wall, point: Point) {
  const { unit } = getWallBasis(wall)

  return (
    (point.x - wall.start.x) * unit.x +
    (point.y - wall.start.y) * unit.y
  )
}

function getOpeningRectanglesForEdge({
  edge,
  edgeLength,
  edgeUnit,
  height,
  wall,
}: {
  edge: PlanFootprintEdge
  edgeLength: number
  edgeUnit: Point
  height: number
  wall: Wall
}) {
  const wallBasis = getWallBasis(wall)
  const edgeStartWallDistance =
    (edge.start.x - wall.start.x) * wallBasis.unit.x +
    (edge.start.y - wall.start.y) * wallBasis.unit.y
  const edgeEndWallDistance =
    (edge.end.x - wall.start.x) * wallBasis.unit.x +
    (edge.end.y - wall.start.y) * wallBasis.unit.y
  const edgeWallDistanceDelta = edgeEndWallDistance - edgeStartWallDistance
  const edgeRunsWithWall = edgeUnit.x * wallBasis.unit.x + edgeUnit.y * wallBasis.unit.y >= 0
  const wallDistanceToEdgeDistance = (wallDistance: number) => {
    if (Math.abs(edgeWallDistanceDelta) > 0.001) {
      return (
        ((wallDistance - edgeStartWallDistance) / edgeWallDistanceDelta) *
        edgeLength
      )
    }

    return edgeRunsWithWall
      ? wallDistance - edgeStartWallDistance
      : edgeStartWallDistance - wallDistance
  }
  const edgeWallMin = Math.min(edgeStartWallDistance, edgeEndWallDistance)
  const edgeWallMax = Math.max(edgeStartWallDistance, edgeEndWallDistance)
  const openings = (wall.openings ?? [])
    .map((opening) => {
      const openingWallLeft = opening.center - opening.width / 2
      const openingWallRight = opening.center + opening.width / 2
      const clippedWallLeft = Math.max(edgeWallMin, openingWallLeft)
      const clippedWallRight = Math.min(edgeWallMax, openingWallRight)

      if (clippedWallRight <= clippedWallLeft) {
        return null
      }

      const leftDistance = wallDistanceToEdgeDistance(clippedWallLeft)
      const rightDistance = wallDistanceToEdgeDistance(clippedWallRight)
      const bottom = Math.max(0, Math.min(height, opening.bottom))
      const top = Math.max(
        bottom,
        Math.min(height, opening.bottom + opening.height),
      )

      return {
        bottom,
        left: Math.max(0, Math.min(leftDistance, rightDistance)),
        right: Math.min(edgeLength, Math.max(leftDistance, rightDistance)),
        top,
      }
    })
    .filter(
      (
        opening,
      ): opening is {
        bottom: number
        left: number
        right: number
        top: number
      } => {
        if (!opening) {
          return false
        }

        return (
          opening.right - opening.left > 0.001 &&
          opening.top - opening.bottom > 0.001
        )
      },
    )

  if (openings.length === 0) {
    return [{ bottom: 0, left: 0, right: edgeLength, top: height }]
  }

  const xBreaks = [
    0,
    edgeLength,
    ...openings.flatMap((opening) => [opening.left, opening.right]),
  ]
    .filter((value) => value >= 0 && value <= edgeLength)
    .sort((first, second) => first - second)
  const yBreaks = [
    0,
    height,
    ...openings.flatMap((opening) => [opening.bottom, opening.top]),
  ]
    .filter((value) => value >= 0 && value <= height)
    .sort((first, second) => first - second)
  const uniqueXBreaks = xBreaks.filter(
    (value, index) => index === 0 || Math.abs(value - xBreaks[index - 1]) > 0.001,
  )
  const uniqueYBreaks = yBreaks.filter(
    (value, index) => index === 0 || Math.abs(value - yBreaks[index - 1]) > 0.001,
  )

  return uniqueXBreaks.slice(0, -1).flatMap((left, xIndex) => {
    const right = uniqueXBreaks[xIndex + 1]
    const centerX = (left + right) / 2

    return uniqueYBreaks.slice(0, -1).flatMap((bottom, yIndex) => {
      const top = uniqueYBreaks[yIndex + 1]
      const centerY = (bottom + top) / 2
      const insideOpening = openings.some(
        (opening) =>
          centerX > opening.left + 0.001 &&
          centerX < opening.right - 0.001 &&
          centerY > opening.bottom + 0.001 &&
          centerY < opening.top - 0.001,
      )

      return insideOpening ? [] : [{ bottom, left, right, top }]
    })
  })
}

function UnionFootprintWireframe({
  elevation,
  footprint,
  height,
}: {
  elevation: number
  footprint: WallUnionFootprint
  height: number
}) {
  const geometry = useMemo(
    () => createUnionFootprintEdgeGeometry(footprint, elevation, height),
    [elevation, footprint, height],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry} renderOrder={8}>
      <lineBasicMaterial color="#334155" depthTest={false} depthWrite={false} />
    </lineSegments>
  )
}

function WallFootprintMeshes({
  castsShadow,
  elevation,
  floorId,
  footprints,
  geometryContextRenderedWalls,
  geometryContextWalls,
  height,
  includeVerticalFaces,
  onRegisterPickTarget,
  selectedWallId,
  selectedSurface,
  sourceWalls,
  surfaceAssignments = [],
  wallKind,
  wireframe,
}: {
  castsShadow: boolean
  elevation: number
  floorId: string
  footprints: WallUnionFootprint[]
  geometryContextRenderedWalls?: RenderedWall[]
  geometryContextWalls?: Wall[]
  height: number
  includeVerticalFaces?: boolean
  onRegisterPickTarget: (target: PickTarget) => () => void
  selectedWallId: string | null
  selectedSurface: SelectableSurface | null
  sourceWalls?: Wall[]
  surfaceAssignments?: SurfaceMaterialAssignment[]
  wallKind: WallKind
  wireframe: boolean
}) {
  const explicitMeshRef = useRef<Object3D>(null!)
  const contextWalls = useMemo(
    () => geometryContextWalls ?? sourceWalls ?? [],
    [geometryContextWalls, sourceWalls],
  )
  const contextRenderedWallsById = useMemo(
    () =>
      new Map(
        (geometryContextRenderedWalls ?? []).map((renderedWall) => [
          renderedWall.wall.id,
          renderedWall,
        ]),
      ),
    [geometryContextRenderedWalls],
  )
  const revealContextWalls = useMemo(() => sourceWalls ?? [], [sourceWalls])
  const wallFaceMaterialIndices = useMemo(() => {
    const materialIndices = new Map<string, number>()

    contextWalls.forEach((wall) => {
      ;([1, -1] as const).forEach((side) => {
        materialIndices.set(`${wall.id}:${side}`, materialIndices.size + 1)
      })
    })

    return materialIndices
  }, [contextWalls])
  const wallFaceMaterialSlots = useMemo(
    () =>
      Array.from(wallFaceMaterialIndices.entries())
        .map(([slotKey, materialIndex]) => {
          const [wallId, sideText] = slotKey.split(':')
          const side = Number(sideText) as Exclude<SurfaceWallSide, 'both'>
          const wall = contextWalls.find(
            (candidateWall) => candidateWall.id === wallId,
          )
          const assignment = wall
            ? getWallMaterialAssignmentForSide(
                getWallMaterialAssignments(surfaceAssignments, wall.id),
                side,
                wall.height,
              )
            : undefined
          const material = assignment
            ? surfaceMaterialsById.get(assignment.materialId)
            : undefined

          return {
            assignment,
            key: slotKey,
            material,
            materialIndex,
          }
        })
        .sort(
          (firstSlot, secondSlot) =>
            firstSlot.materialIndex - secondSlot.materialIndex,
        ),
    [contextWalls, wallFaceMaterialIndices, surfaceAssignments],
  )
  const pickGroupTargets = useMemo(() => {
    const targets = new Map<number, SelectableSurface>()

    wallFaceMaterialIndices.forEach((materialIndex, slotKey) => {
      const [wallId, sideText] = slotKey.split(':')
      const side = Number(sideText) as Exclude<SurfaceWallSide, 'both'>

      targets.set(materialIndex, {
        floorId,
        side,
        type: 'wall-face',
        wallId,
      })
    })

    return targets
  }, [floorId, wallFaceMaterialIndices])
  const selectedWallForHighlight =
    selectedWallId
      ? contextWalls.find((wall) => wall.id === selectedWallId) ?? null
      : selectedSurface?.type === 'wall-face'
        ? contextWalls.find((wall) => wall.id === selectedSurface.wallId) ?? null
        : null
  const selectedMaterialIndex =
    selectedSurface?.type === 'wall-face'
      ? wallFaceMaterialIndices.get(
          `${selectedSurface.wallId}:${selectedSurface.side}`,
        ) ?? null
      : null
  const materialGroupCount = Math.max(1, 1 + Math.max(0, ...wallFaceMaterialIndices.values()))
  const hasExternalWallFaceAssignments =
    wallKind === 'external' &&
    (sourceWalls ?? []).some((wall) =>
      getWallMaterialAssignments(surfaceAssignments, wall.id).length > 0,
    )
  const hasSourceWalls = (sourceWalls ?? []).length > 0
  const useExplicitGeometry =
    wallKind === 'internal' ||
    hasSourceWalls ||
    (wallKind === 'external' &&
      ((sourceWalls ?? []).some(hasWallOpenings) || hasExternalWallFaceAssignments))
  const explicitGeometry = useMemo(
    () =>
      useExplicitGeometry
        ? createWallFootprintGeometryWithOpenings(
            footprints,
            height,
            contextWalls,
            contextRenderedWallsById,
            wallFaceMaterialIndices,
            surfaceAssignments,
            revealContextWalls,
            includeVerticalFaces ?? wallKind !== 'internal',
          )
        : null,
    [
      footprints,
      height,
      contextWalls,
      contextRenderedWallsById,
      revealContextWalls,
      surfaceAssignments,
      includeVerticalFaces,
      useExplicitGeometry,
      wallFaceMaterialIndices,
    ],
  )
  const selectedHighlightMaterialIndices = useMemo(() => {
    const presentMaterialIndices = new Set(
      explicitGeometry?.groups.map((group) => group.materialIndex ?? 0) ?? [],
    )

    if (
      selectedSurface?.type === 'wall-face' &&
      (!selectedWallId || selectedSurface.wallId === selectedWallId) &&
      selectedMaterialIndex !== null &&
      presentMaterialIndices.has(selectedMaterialIndex)
    ) {
      return [selectedMaterialIndex]
    }

    const wallId =
      selectedWallId ??
      (selectedSurface?.type === 'wall-face' ? selectedSurface.wallId : null)

    if (!wallId) {
      return []
    }

    return Array.from(wallFaceMaterialIndices.entries())
      .filter(
        ([slotKey, materialIndex]) =>
          slotKey.startsWith(`${wallId}:`) &&
          presentMaterialIndices.has(materialIndex),
      )
      .map(([, materialIndex]) => materialIndex)
  }, [
    explicitGeometry,
    selectedMaterialIndex,
    selectedSurface,
    selectedWallId,
    wallFaceMaterialIndices,
  ])
  const unionMeshes = useMemo(
    () =>
      footprints
        .filter((footprint) => footprint.outline.length >= 3)
        .map((footprint) => ({
          footprint,
          shape: createPlanShapeWithHoles(footprint),
        })),
    [footprints],
  )

  useEffect(
    () => () => {
      explicitGeometry?.dispose()
    },
    [explicitGeometry],
  )
  useEffect(() => {
    const materialSources = [
      { materialIndex: 0, source: 'generic' },
      ...Array.from(wallFaceMaterialIndices.entries()).map(
        ([slotKey, materialIndex]) => ({
          materialIndex,
          source: slotKey,
        }),
      ),
    ].sort(
      (firstSource, secondSource) =>
        firstSource.materialIndex - secondSource.materialIndex,
    )
    const positionAttribute = explicitGeometry?.getAttribute('position')
    const geometryGroups =
      explicitGeometry && positionAttribute instanceof Float32BufferAttribute
        ? explicitGeometry.groups.slice(0, 80).map((group) => {
            const vertices = Array.from(
              { length: Math.min(group.count, 6) },
              (_, vertexOffset) => {
                const index = group.start + vertexOffset

                return [
                  Number(positionAttribute.getX(index).toFixed(3)),
                  Number(positionAttribute.getY(index).toFixed(3)),
                  Number(positionAttribute.getZ(index).toFixed(3)),
                ]
              },
            )

            return {
              count: group.count,
              materialIndex: group.materialIndex ?? 0,
              source:
                materialSources.find(
                  (candidateSource) =>
                    candidateSource.materialIndex === (group.materialIndex ?? 0),
                )?.source ?? 'unknown',
              start: group.start,
              vertices,
            }
          })
        : []

    recordWallRenderDebug(
      'wall-renderer:footprint',
      `floor=${floorId} kind=${wallKind} sourceWalls=${(sourceWalls ?? []).map((wall) => wall.id).join(',')}`,
      JSON.stringify({
        groupCount: explicitGeometry?.groups.length ?? 0,
        groups: geometryGroups,
        includeVerticalFaces: includeVerticalFaces ?? wallKind !== 'internal',
        materialSources,
        materialGroupCount,
        outlines: footprints.map((footprint) =>
          footprint.outline.map((point) => [
            Number(point.x.toFixed(3)),
            Number(point.y.toFixed(3)),
          ]),
        ),
        useExplicitGeometry,
      }),
    )
  }, [
    explicitGeometry,
    floorId,
    footprints,
    includeVerticalFaces,
    materialGroupCount,
    sourceWalls,
    useExplicitGeometry,
    wallFaceMaterialIndices,
    wallKind,
  ])
  useEffect(() => {
    const object = explicitMeshRef.current

    if (!useExplicitGeometry || !explicitGeometry || pickGroupTargets.size === 0) {
      return undefined
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      groupTargets: pickGroupTargets,
      kind: 'material-groups',
      object,
    })
  }, [
    explicitGeometry,
    floorId,
    onRegisterPickTarget,
    pickGroupTargets,
    useExplicitGeometry,
  ])

  if (useExplicitGeometry && explicitGeometry) {
    return (
      <group>
        <mesh
          ref={explicitMeshRef}
          castShadow={castsShadow}
          geometry={explicitGeometry}
          position={[0, elevation, 0]}
          receiveShadow={castsShadow}
          renderOrder={2}
        >
          {wireframe ? (
            <meshBasicMaterial
              color="#94a3b8"
              depthWrite={false}
              opacity={0.02}
              transparent
            />
          ) : wallKind === 'external' ? (
            <>
              <ExternalWallMaterial
                attach="material-0"
                side={DoubleSide}
                wireframe={false}
              />
              {wallFaceMaterialSlots.map((slot) =>
                slot.assignment && slot.material ? (
                  <SurfaceMeshStandardMaterial
                    key={slot.key}
                    attach={`material-${slot.materialIndex}`}
                    assignment={slot.assignment}
                    displacementEnabled={false}
                    material={slot.material}
                    polygonOffsetFactor={0}
                    polygonOffsetUnits={0}
                    side={DoubleSide}
                    textureQuality={getWallSurfaceTextureQuality(slot.material)}
                    wireframe={wireframe}
                  />
                ) : (
                  <ExternalWallMaterial
                    key={slot.key}
                    attach={`material-${slot.materialIndex}`}
                    side={DoubleSide}
                    wireframe={false}
                  />
                ),
              )}
            </>
          ) : (
            <>
              <InternalWallMaterial
                attach="material-0"
                side={DoubleSide}
                wireframe={false}
              />
              {wallFaceMaterialSlots.map((slot) =>
                slot.assignment && slot.material ? (
                  <SurfaceMeshStandardMaterial
                    key={slot.key}
                    attach={`material-${slot.materialIndex}`}
                    assignment={slot.assignment}
                    displacementEnabled={false}
                    material={slot.material}
                    polygonOffsetFactor={0}
                    polygonOffsetUnits={0}
                    side={DoubleSide}
                    textureQuality={getWallSurfaceTextureQuality(slot.material)}
                    wireframe={wireframe}
                  />
                ) : (
                  <InternalWallMaterial
                    key={slot.key}
                    attach={`material-${slot.materialIndex}`}
                    side={DoubleSide}
                    wireframe={false}
                  />
                ),
              )}
            </>
          )}
        </mesh>
        {selectedWallForHighlight && selectedHighlightMaterialIndices.length > 0 ? (
          <mesh
            geometry={explicitGeometry}
            position={[0, elevation, 0]}
            renderOrder={9}
          >
            <FootprintMaterialGroupHighlight
              materialCount={materialGroupCount}
              selectedMaterialIndices={selectedHighlightMaterialIndices}
            />
          </mesh>
        ) : null}
        {wireframe
          ? footprints.map((footprint, index) => (
              <UnionFootprintWireframe
                key={index}
                elevation={elevation}
                footprint={footprint}
                height={height}
              />
            ))
          : null}
      </group>
    )
  }

  if (unionMeshes.length === 0) {
    return null
  }

  return (
    <group>
      {unionMeshes.map(({ footprint, shape }, index) => (
        <group key={index}>
          <mesh
            castShadow={castsShadow}
            position={[0, elevation, 0]}
            receiveShadow={castsShadow}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={2}
          >
            <extrudeGeometry
              args={[
                shape,
                {
                  bevelEnabled: false,
                  depth: height,
                },
              ]}
            />
            {wireframe ? (
              <meshBasicMaterial
                color="#94a3b8"
                depthWrite={false}
                opacity={0.02}
                transparent
              />
            ) : (
              wallKind === 'external' ? (
                <ExternalWallMaterial wireframe={false} />
              ) : (
                <InternalWallMaterial wireframe={false} />
              )
            )}
          </mesh>
          {wireframe ? (
            <UnionFootprintWireframe
              elevation={elevation}
              footprint={footprint}
              height={height}
            />
          ) : null}
        </group>
      ))}
    </group>
  )
}

type PlanFootprintEdge = {
  end: Point
  start: Point
}

type FootprintEdgeWallSideMatch = {
  coverage: number
  offsetError: number
  projectUvFromWall?: boolean
  side: Exclude<SurfaceWallSide, 'both'>
  wall: Wall
}

type FootprintEdgeWallSideSegment = {
  left: number
  match: FootprintEdgeWallSideMatch | null
  right: number
}

function FootprintMaterialGroupHighlight({
  materialCount,
  selectedMaterialIndices,
}: {
  materialCount: number
  selectedMaterialIndices: number[]
}) {
  const selectedMaterialIndexSet = new Set(selectedMaterialIndices)

  return (
    <>
      {Array.from({ length: materialCount }).map((_, index) =>
        selectedMaterialIndexSet.has(index) ? (
          <meshBasicMaterial
            key={index}
            attach={`material-${index}`}
            color={MODEL_OUTLINE_COLOR}
            colorWrite
            depthWrite={false}
            opacity={0.26}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
            side={DoubleSide}
            transparent
          />
        ) : (
          <meshBasicMaterial
            key={index}
            attach={`material-${index}`}
            color="#000000"
            colorWrite={false}
            depthWrite={false}
            opacity={0}
            side={DoubleSide}
            transparent
          />
        ),
      )}
    </>
  )
}

function getFootprintEdges(footprints: WallUnionFootprint[]) {
  return footprints.flatMap((footprint) =>
    [footprint.outline, ...footprint.holes].flatMap((ring) =>
      ring.map((start, index): PlanFootprintEdge => ({
        end: ring[(index + 1) % ring.length],
        start,
      })),
    ),
  )
}

function getEdgeMetrics(edge: PlanFootprintEdge) {
  const dx = edge.end.x - edge.start.x
  const dy = edge.end.y - edge.start.y
  const length = Math.hypot(dx, dy)

  return length > 0
    ? {
        dx,
        dy,
        length,
        unit: {
          x: dx / length,
          y: dy / length,
        },
      }
    : null
}

function getFootprintEdgeWallSideMatch(
  edge: PlanFootprintEdge,
  wall: Wall,
  side: Exclude<SurfaceWallSide, 'both'>,
  minimumCoverage = 0.55,
) {
  const metrics = getEdgeMetrics(edge)
  const { length: wallLength, normal, unit } = getWallBasis(wall)

  if (!metrics || wallLength < 0.001) {
    return null
  }

  const parallel = Math.abs(metrics.unit.x * unit.x + metrics.unit.y * unit.y)

  if (parallel < 0.94) {
    return null
  }

  const midpoint = {
    x: (edge.start.x + edge.end.x) / 2,
    y: (edge.start.y + edge.end.y) / 2,
  }
  const sideOffset =
    (midpoint.x - wall.start.x) * normal.x +
    (midpoint.y - wall.start.y) * normal.y
  const targetSideOffset = side * wall.thickness / 2
  const offsetError = Math.abs(sideOffset - targetSideOffset)

  if (offsetError > Math.max(0.02, wall.thickness * 0.2)) {
    return null
  }

  const startDistance =
    (edge.start.x - wall.start.x) * unit.x +
    (edge.start.y - wall.start.y) * unit.y
  const endDistance =
    (edge.end.x - wall.start.x) * unit.x +
    (edge.end.y - wall.start.y) * unit.y
  const minDistance = Math.min(startDistance, endDistance)
  const maxDistance = Math.max(startDistance, endDistance)
  const extensionTolerance = Math.max(0.02, wall.thickness * 1.5)
  const overlapStart = Math.max(minDistance, -extensionTolerance)
  const overlapEnd = Math.min(maxDistance, wallLength + extensionTolerance)
  const overlapLength = Math.max(0, overlapEnd - overlapStart)
  const coverage = overlapLength / metrics.length

  if (coverage < minimumCoverage) {
    return null
  }

  return {
    coverage,
    offsetError,
    side,
    wall,
  }
}

function footprintEdgeMatchesWallSide(
  edge: PlanFootprintEdge,
  wall: Wall,
  side: Exclude<SurfaceWallSide, 'both'>,
) {
  return Boolean(getFootprintEdgeWallSideMatch(edge, wall, side))
}

function getFootprintEdgeOpeningContext(
  edge: PlanFootprintEdge,
  walls: Wall[],
) {
  for (const wall of walls) {
    if (!hasWallOpenings(wall)) {
      continue
    }

    for (const side of [1, -1] as const) {
      if (footprintEdgeMatchesWallSide(edge, wall, side)) {
        return { side, wall }
      }
    }
  }

  return null
}

function getFootprintEdgeWallSideContext(
  edge: PlanFootprintEdge,
  walls: Wall[],
) {
  let bestMatch: FootprintEdgeWallSideMatch | null = null

  for (const wall of walls) {
    for (const side of [1, -1] as const) {
      const match = getFootprintEdgeWallSideMatch(edge, wall, side)

      if (!match) {
        continue
      }

      if (
        !bestMatch ||
        match.coverage > bestMatch.coverage + 0.001 ||
        (Math.abs(match.coverage - bestMatch.coverage) <= 0.001 &&
          match.offsetError < bestMatch.offsetError)
      ) {
        bestMatch = match
      }
    }
  }

  return bestMatch
}

function getShortFootprintEdgeAdjacentWallSideContext(
  edge: PlanFootprintEdge,
  walls: Wall[],
  options: { shortOnly?: boolean } = {},
): FootprintEdgeWallSideMatch | null {
  const metrics = getEdgeMetrics(edge)

  if (!metrics || metrics.length < 0.001) {
    return null
  }

  const maxThickness = Math.max(0, ...walls.map((wall) => wall.thickness))

  if (options.shortOnly !== false && metrics.length > Math.max(0.04, maxThickness * 1.35)) {
    return null
  }

  const midpoint = {
    x: (edge.start.x + edge.end.x) / 2,
    y: (edge.start.y + edge.end.y) / 2,
  }
  let bestMatch: FootprintEdgeWallSideMatch | null = null

  walls.forEach((wall) => {
    const { length, normal, unit } = getWallBasis(wall)

    if (length < 0.001) {
      return
    }

    ;([1, -1] as const).forEach((side) => {
      const sideOffset = side * wall.thickness / 2
      const sideStart = {
        x: wall.start.x + normal.x * sideOffset,
        y: wall.start.y + normal.y * sideOffset,
      }
      const sideEnd = {
        x: wall.end.x + normal.x * sideOffset,
        y: wall.end.y + normal.y * sideOffset,
      }
      const distanceToSide = getDistanceToSegment(midpoint, sideStart, sideEnd)
      const distanceAlongSide =
        (midpoint.x - sideStart.x) * unit.x +
        (midpoint.y - sideStart.y) * unit.y
      const tolerance = Math.max(0.025, wall.thickness * 0.75)

      if (
        distanceToSide > tolerance ||
        distanceAlongSide < -wall.thickness ||
        distanceAlongSide > length + wall.thickness
      ) {
        return
      }

      const match: FootprintEdgeWallSideMatch = {
        coverage: 1,
        offsetError: distanceToSide,
        projectUvFromWall: true,
        side,
        wall,
      }

      if (
        !bestMatch ||
        match.offsetError < bestMatch.offsetError ||
        (Math.abs(match.offsetError - bestMatch.offsetError) <= 0.001 &&
          match.wall.id.localeCompare(bestMatch.wall.id) < 0)
      ) {
        bestMatch = match
      }
    })
  })

  return bestMatch
}

function getFootprintEdgeWallSideSegments(
  edge: PlanFootprintEdge,
  walls: Wall[],
): FootprintEdgeWallSideSegment[] {
  const metrics = getEdgeMetrics(edge)

  if (!metrics || metrics.length < 0.001) {
    return []
  }

  const edgeNormal = { x: -metrics.unit.y, y: metrics.unit.x }
  const candidates: Array<FootprintEdgeWallSideMatch & {
    left: number
    right: number
  }> = []

  const collectCandidates = (allowAbuttingEndpointExtension: boolean) => {
    for (const wall of walls) {
      const { length: wallLength, normal, unit } = getWallBasis(wall)

      if (wallLength < 0.001) {
        continue
      }

      const parallel = Math.abs(metrics.unit.x * unit.x + metrics.unit.y * unit.y)

      if (parallel < 0.94) {
        continue
      }

      for (const side of [1, -1] as const) {
        const sideOffset = side * wall.thickness / 2
        const sideStart = {
          x: wall.start.x + normal.x * sideOffset,
          y: wall.start.y + normal.y * sideOffset,
        }
        const sideEnd = {
          x: wall.end.x + normal.x * sideOffset,
          y: wall.end.y + normal.y * sideOffset,
        }
        const offsetError = Math.abs(
          (sideStart.x - edge.start.x) * edgeNormal.x +
            (sideStart.y - edge.start.y) * edgeNormal.y,
        )

        if (offsetError > Math.max(0.02, wall.thickness * 0.2)) {
          continue
        }

        const startDistance =
          (sideStart.x - edge.start.x) * metrics.unit.x +
          (sideStart.y - edge.start.y) * metrics.unit.y
        const endDistance =
          (sideEnd.x - edge.start.x) * metrics.unit.x +
          (sideEnd.y - edge.start.y) * metrics.unit.y
        const endpointDistances = [sideStart, sideEnd].map((point) => ({
          along:
            (point.x - edge.start.x) * metrics.unit.x +
            (point.y - edge.start.y) * metrics.unit.y,
          offset: Math.abs(
            (point.x - edge.start.x) * edgeNormal.x +
              (point.y - edge.start.y) * edgeNormal.y,
          ),
        }))
        const endpointTouchesEdge = endpointDistances.some(
          (endpointDistance) =>
            endpointDistance.offset <= Math.max(0.02, wall.thickness * 0.2) &&
            endpointDistance.along >= -wall.thickness &&
            endpointDistance.along <= metrics.length + wall.thickness,
        )
        const extensionTolerance =
          allowAbuttingEndpointExtension && endpointTouchesEdge
            ? Math.max(0.02, wall.thickness)
            : Math.max(0.005, wall.thickness * 0.05)
        const left = Math.max(
          0,
          Math.min(startDistance, endDistance) - extensionTolerance,
        )
        const right = Math.min(
          metrics.length,
          Math.max(startDistance, endDistance) + extensionTolerance,
        )
        const overlapLength = right - left

        if (overlapLength <= 0.001) {
          continue
        }

        candidates.push({
          coverage: overlapLength / metrics.length,
          left,
          offsetError,
          projectUvFromWall: allowAbuttingEndpointExtension && endpointTouchesEdge,
          right,
          side,
          wall,
        })
      }
    }
  }

  collectCandidates(false)

  if (candidates.length === 0) {
    collectCandidates(true)
  }

  if (candidates.length === 0) {
    return [
      {
        left: 0,
        match: null,
        right: metrics.length,
      },
    ]
  }

  const breaks = [0, metrics.length, ...candidates.flatMap((candidate) => [
    candidate.left,
    candidate.right,
  ])]
    .filter((value) => value >= 0 && value <= metrics.length)
    .sort((first, second) => first - second)
  const uniqueBreaks = breaks.filter(
    (value, index) => index === 0 || Math.abs(value - breaks[index - 1]) > 0.001,
  )

  return uniqueBreaks.slice(0, -1).flatMap((left, index) => {
    const right = uniqueBreaks[index + 1]

    if (right - left <= 0.001) {
      return []
    }

    const midpoint = (left + right) / 2
    const match =
      candidates
        .filter(
          (candidate) =>
            midpoint >= candidate.left - 0.001 &&
            midpoint <= candidate.right + 0.001,
        )
        .sort(
          (first, second) =>
            first.offsetError - second.offsetError ||
            second.coverage - first.coverage ||
            first.wall.id.localeCompare(second.wall.id),
        )[0] ?? null

    return [
      {
        left,
        match,
        right,
      },
    ]
  })
}

function isPointInsideFootprintSolid(point: Point, footprint: WallUnionFootprint) {
  return (
    isPointInsidePolygon(point, footprint.outline) &&
    !footprint.holes.some((hole) => isPointInsidePolygon(point, hole))
  )
}

function getFootprintEdgeOutwardNormal(
  edge: PlanFootprintEdge,
  metrics: NonNullable<ReturnType<typeof getEdgeMetrics>>,
  footprint: WallUnionFootprint,
) {
  const leftNormal = { x: -metrics.unit.y, y: metrics.unit.x }
  const rightNormal = { x: metrics.unit.y, y: -metrics.unit.x }
  const midpoint = {
    x: (edge.start.x + edge.end.x) / 2,
    y: (edge.start.y + edge.end.y) / 2,
  }
  const sampleDistance = 0.02
  const leftSample = {
    x: midpoint.x + leftNormal.x * sampleDistance,
    y: midpoint.y + leftNormal.y * sampleDistance,
  }

  return isPointInsideFootprintSolid(leftSample, footprint)
    ? rightNormal
    : leftNormal
}

function createWallFootprintGeometryWithOpenings(
  footprints: WallUnionFootprint[],
  height: number,
  walls: Wall[],
  renderedWallsById = new Map<string, RenderedWall>(),
  wallFaceMaterialIndices = new Map<string, number>(),
  surfaceAssignments: SurfaceMaterialAssignment[] = [],
  revealWalls = walls,
  includeVerticalFaces = true,
) {
  const geometry = new BufferGeometry()
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const addVertex = (
    position: [number, number, number],
    normal: [number, number, number],
    uv: [number, number],
  ) => {
    positions.push(...position)
    normals.push(...normal)
    uvs.push(...uv)
  }
  const addQuad = (
    corners: Array<[number, number, number]>,
    normal: [number, number, number],
    uvCorners: Array<[number, number]>,
    materialIndex = 0,
  ) => {
    const firstEdge = [
      corners[1][0] - corners[0][0],
      corners[1][1] - corners[0][1],
      corners[1][2] - corners[0][2],
    ]
    const secondEdge = [
      corners[2][0] - corners[0][0],
      corners[2][1] - corners[0][1],
      corners[2][2] - corners[0][2],
    ]
    const geometricNormal = [
      firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
      firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2],
      firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0],
    ]
    const normalDot =
      geometricNormal[0] * normal[0] +
      geometricNormal[1] * normal[1] +
      geometricNormal[2] * normal[2]
    const indices = normalDot >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
    const startVertex = positions.length / 3

    indices.forEach((cornerIndex) =>
      addVertex(corners[cornerIndex], normal, uvCorners[cornerIndex]),
    )
    geometry.addGroup(startVertex, indices.length, materialIndex)
  }
  const addTriangle = (
    corners: Array<[number, number, number]>,
    normal: [number, number, number],
    uvCorners: Array<[number, number]>,
    materialIndex = 0,
  ) => {
    const firstEdge = [
      corners[1][0] - corners[0][0],
      corners[1][1] - corners[0][1],
      corners[1][2] - corners[0][2],
    ]
    const secondEdge = [
      corners[2][0] - corners[0][0],
      corners[2][1] - corners[0][1],
      corners[2][2] - corners[0][2],
    ]
    const geometricNormal = [
      firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
      firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2],
      firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0],
    ]
    const normalDot =
      geometricNormal[0] * normal[0] +
      geometricNormal[1] * normal[1] +
      geometricNormal[2] * normal[2]
    const indices = normalDot >= 0 ? [0, 1, 2] : [0, 2, 1]
    const startVertex = positions.length / 3

    indices.forEach((cornerIndex) =>
      addVertex(corners[cornerIndex], normal, uvCorners[cornerIndex]),
    )
    geometry.addGroup(startVertex, indices.length, materialIndex)
  }

  for (const footprint of footprints) {
    const holes = footprint.holes.map((hole) =>
      hole.map((point) => new Vector2(point.x, point.y)),
    )
    const capPoints = [
      ...footprint.outline,
      ...footprint.holes.flatMap((hole) => hole),
    ]
    const triangles = ShapeUtils.triangulateShape(
      footprint.outline.map((point) => new Vector2(point.x, point.y)),
      holes,
    )

    triangles.forEach(([firstIndex, secondIndex, thirdIndex]) => {
      const first = capPoints[firstIndex]
      const second = capPoints[secondIndex]
      const third = capPoints[thirdIndex]

      addTriangle(
        [
          [first.x, height, first.y],
          [second.x, height, second.y],
          [third.x, height, third.y],
        ],
        [0, 1, 0],
        [
          [first.x, first.y],
          [second.x, second.y],
          [third.x, third.y],
        ],
      )
    })

    if (includeVerticalFaces) {
      ;[footprint.outline, ...footprint.holes].forEach((ring) => {
        ring.forEach((start, index) => {
          const end = ring[(index + 1) % ring.length]
          const edge = { end, start }
          const metrics = getEdgeMetrics(edge)

          if (!metrics || metrics.length < 0.001) {
            return
          }

          const outward = getFootprintEdgeOutwardNormal(edge, metrics, footprint)
          const edgeSegments = getFootprintEdgeWallSideSegments(edge, walls)

          edgeSegments.forEach((edgeSegment) => {
            const segmentLength = edgeSegment.right - edgeSegment.left

            if (segmentLength <= 0.001) {
              return
            }

            const segmentEdge = {
              start: {
                x: start.x + metrics.unit.x * edgeSegment.left,
                y: start.y + metrics.unit.y * edgeSegment.left,
              },
              end: {
                x: start.x + metrics.unit.x * edgeSegment.right,
                y: start.y + metrics.unit.y * edgeSegment.right,
              },
            }
            const wallSideContext =
              edgeSegment.match ??
              getFootprintEdgeWallSideContext(segmentEdge, walls) ??
              getShortFootprintEdgeAdjacentWallSideContext(segmentEdge, walls, {
                shortOnly: false,
              })
            const openingContext =
              wallSideContext && hasWallOpenings(wallSideContext.wall)
                ? { side: wallSideContext.side, wall: wallSideContext.wall }
                : getFootprintEdgeOpeningContext(segmentEdge, walls)
            const rectangles = openingContext
              ? getOpeningRectanglesForEdge({
                  edge: segmentEdge,
                  edgeLength: segmentLength,
                  edgeUnit: metrics.unit,
                  height,
                  wall: openingContext.wall,
                })
              : [{ bottom: 0, left: 0, right: segmentLength, top: height }]
            const wallMaterialAssignments = wallSideContext
              ? getWallMaterialAssignments(surfaceAssignments, wallSideContext.wall.id)
              : []

            rectangles.forEach((rectangle) => {
              const yBreaks = [
                rectangle.bottom,
                rectangle.top,
                ...wallMaterialAssignments.flatMap((assignment) => {
                  const coverageHeight = assignment.coverageHeight ?? height

                  return coverageHeight > rectangle.bottom + 0.001 &&
                    coverageHeight < rectangle.top - 0.001
                    ? [coverageHeight]
                    : []
                }),
              ].sort((firstBreak, secondBreak) => firstBreak - secondBreak)
              const uniqueYBreaks = yBreaks.filter(
                (value, valueIndex) =>
                  valueIndex === 0 ||
                  Math.abs(value - yBreaks[valueIndex - 1]) > 0.001,
              )

              uniqueYBreaks.slice(0, -1).forEach((bottom, yIndex) => {
                const top = uniqueYBreaks[yIndex + 1]
                const materialIndex = wallSideContext
                  ? wallFaceMaterialIndices.get(
                      `${wallSideContext.wall.id}:${wallSideContext.side}`,
                    ) ?? 0
                  : 0
                const uvLeft = edgeSegment.left + rectangle.left
                const uvRight = edgeSegment.left + rectangle.right
                const leftBottom = {
                  x: start.x + metrics.unit.x * uvLeft,
                  y: start.y + metrics.unit.y * uvLeft,
                }
                const rightBottom = {
                  x: start.x + metrics.unit.x * uvRight,
                  y: start.y + metrics.unit.y * uvRight,
                }
                const getWallSideUvCoordinate = (
                  point: Point,
                  fallbackUv: number,
                ) => {
                  if (!wallSideContext) {
                    return fallbackUv
                  }

                  const renderedWall = renderedWallsById.get(
                    wallSideContext.wall.id,
                  )

                  return renderedWall
                    ? getDistanceAlongRenderedWall(renderedWall, point)
                    : getDistanceAlongWall(wallSideContext.wall, point)
                }
                const uvLeftCoordinate = getWallSideUvCoordinate(leftBottom, uvLeft)
                const uvRightCoordinate = getWallSideUvCoordinate(rightBottom, uvRight)

                addQuad(
                  [
                    [leftBottom.x, bottom, leftBottom.y],
                    [rightBottom.x, bottom, rightBottom.y],
                    [rightBottom.x, top, rightBottom.y],
                    [leftBottom.x, top, leftBottom.y],
                  ],
                  [outward.x, 0, outward.y],
                  [
                    [uvLeftCoordinate, bottom],
                    [uvRightCoordinate, bottom],
                    [uvRightCoordinate, top],
                    [uvLeftCoordinate, top],
                  ],
                  materialIndex,
                )
              })
            })
          })
        })
      })
    }
  }

  ;(includeVerticalFaces ? revealWalls.filter(hasWallOpenings) : [])
    .forEach((wall) => {
      const { normal, unit } = getWallBasis(wall)
      const halfThickness = wall.thickness / 2
      const toPosition = (
        distanceAlongWall: number,
        y: number,
        sideOffset: number,
      ): [number, number, number] => [
        wall.start.x + unit.x * distanceAlongWall + normal.x * sideOffset,
        y,
        wall.start.y + unit.y * distanceAlongWall + normal.y * sideOffset,
      ]

      ;(wall.openings ?? []).forEach((opening) => {
        const left = opening.center - opening.width / 2
        const right = opening.center + opening.width / 2
        const bottom = Math.max(0, Math.min(height, opening.bottom))
        const top = Math.max(bottom, Math.min(height, opening.bottom + opening.height))

        if (right <= left || top <= bottom) {
          return
        }

        ;([-1, 1] as const).forEach((side) => {
          const depthStart = side === 1 ? 0 : -halfThickness
          const depthEnd = side === 1 ? halfThickness : 0
          const revealDepth = Math.abs(depthEnd - depthStart)
          const materialIndex = wallFaceMaterialIndices.get(`${wall.id}:${side}`) ?? 0

          addQuad(
            [
              toPosition(left, bottom, depthStart),
              toPosition(left, bottom, depthEnd),
              toPosition(left, top, depthEnd),
              toPosition(left, top, depthStart),
            ],
            [unit.x, 0, unit.y],
            [[0, bottom], [revealDepth, bottom], [revealDepth, top], [0, top]],
            materialIndex,
          )
          addQuad(
            [
              toPosition(right, bottom, depthEnd),
              toPosition(right, bottom, depthStart),
              toPosition(right, top, depthStart),
              toPosition(right, top, depthEnd),
            ],
            [-unit.x, 0, -unit.y],
            [[0, bottom], [revealDepth, bottom], [revealDepth, top], [0, top]],
            materialIndex,
          )
          addQuad(
            [
              toPosition(left, top, depthEnd),
              toPosition(right, top, depthEnd),
              toPosition(right, top, depthStart),
              toPosition(left, top, depthStart),
            ],
            [0, -1, 0],
            [[left, 0], [right, 0], [right, revealDepth], [left, revealDepth]],
            materialIndex,
          )
          if (bottom > SKIRTING_OPENING_FLOOR_TOLERANCE_METERS) {
            addQuad(
              [
                toPosition(left, bottom, depthStart),
                toPosition(right, bottom, depthStart),
                toPosition(right, bottom, depthEnd),
                toPosition(left, bottom, depthEnd),
              ],
              [0, 1, 0],
              [[left, 0], [right, 0], [right, revealDepth], [left, revealDepth]],
              materialIndex,
            )
          }
        })
      })
    })

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function getRoomFloorMaterialAssignment(
  surfaceAssignments: SurfaceMaterialAssignment[],
  floorId: string,
  roomSignature: string,
) {
  return surfaceAssignments.find(
    (assignment) =>
      assignment.target.type === 'room-floor' &&
      assignment.target.floorId === floorId &&
      assignment.target.roomSignature === roomSignature,
  )
}

function getRoomCeilingMaterialAssignment(
  surfaceAssignments: SurfaceMaterialAssignment[],
  floorId: string,
  roomSignature: string,
) {
  return surfaceAssignments.find(
    (assignment) =>
      assignment.target.type === 'ceiling' &&
      assignment.target.floorId === floorId &&
      assignment.target.roomSignature === roomSignature,
  )
}

function getFloorSlabEdgeMaterialAssignment(
  surfaceAssignments: SurfaceMaterialAssignment[],
  floorId: string,
) {
  return surfaceAssignments.find(
    (assignment) =>
      assignment.target.type === 'floor-slab-edge' &&
      assignment.target.floorId === floorId,
  )
}

function surfacesMatch(
  firstSurface: SelectableSurface | null,
  secondSurface: SelectableSurface,
) {
  if (!firstSurface || firstSurface.type !== secondSurface.type) {
    return false
  }

  if (firstSurface.type === 'wall-face' && secondSurface.type === 'wall-face') {
    return (
      firstSurface.floorId === secondSurface.floorId &&
      firstSurface.side === secondSurface.side &&
      firstSurface.wallId === secondSurface.wallId
    )
  }

  if (
    firstSurface.type === 'wall-surface-fragment' &&
    secondSurface.type === 'wall-surface-fragment'
  ) {
    return (
      firstSurface.floorId === secondSurface.floorId &&
      firstSurface.fragmentId === secondSurface.fragmentId
    )
  }

  if (
    firstSurface.type === 'floor-slab-edge' &&
    secondSurface.type === 'floor-slab-edge'
  ) {
    return firstSurface.floorId === secondSurface.floorId
  }

  if (
    firstSurface.type !== 'wall-face' &&
    secondSurface.type !== 'wall-face' &&
    firstSurface.type !== 'wall-surface-fragment' &&
    secondSurface.type !== 'wall-surface-fragment'
  ) {
    if (
      firstSurface.type === 'floor-slab-edge' ||
      secondSurface.type === 'floor-slab-edge'
    ) {
      return false
    }

    return (
      firstSurface.floorId === secondSurface.floorId &&
      firstSurface.roomSignature === secondSurface.roomSignature
    )
  }

  return false
}

function SelectableRoomSurfaceMesh({
  elevation,
  floorId,
  onRegisterPickTarget,
  room,
  roomHeight,
  selectedSurface,
  type,
}: {
  elevation: number
  floorId: string
  onRegisterPickTarget: (target: PickTarget) => () => void
  room: DetectedRoom
  roomHeight: number
  selectedSurface: SelectableSurface | null
  type: 'ceiling' | 'room-floor'
}) {
  const meshRef = useRef<Object3D>(null!)
  const shape = useMemo(() => createPlanShape(room.polygon), [room.polygon])
  const surface: SelectableSurface = useMemo(
    () => ({
      floorId,
      roomSignature: room.signature,
      type,
    }),
    [floorId, room.signature, type],
  )
  const isSelected = surfacesMatch(selectedSurface, surface)
  const y =
    type === 'room-floor'
      ? elevation + 0.03
      : elevation + roomHeight - 0.03
  const pickSide = type === 'ceiling' ? BackSide : FrontSide

  useHorizontalSurfaceVisibility(
    meshRef,
    y,
    type === 'room-floor' ? 'above' : 'below',
  )

  useEffect(() => {
    const object = meshRef.current

    if (!object) {
      return
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      kind: 'surface',
      object,
      pickSide,
      surface,
    })
  }, [floorId, onRegisterPickTarget, pickSide, surface])

  return (
    <mesh
      ref={meshRef}
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={isSelected ? 6 : -1}
    >
      <shapeGeometry args={[shape]} />
      <meshBasicMaterial
        color="#f97316"
        depthTest={false}
        depthWrite={false}
        opacity={isSelected ? 0.28 : 0}
        side={pickSide}
        transparent
      />
    </mesh>
  )
}

function SelectableRoomSurfaces({
  elevation,
  floorPlane,
  floorId,
  onRegisterPickTarget,
  roomHeight,
  rooms,
  selectedSurface,
  visibleRoomSignatures,
}: {
  elevation: number
  floorPlane?: ReturnType<typeof getFloorPlaneBounds> | null
  floorId: string
  onRegisterPickTarget: (target: PickTarget) => () => void
  roomHeight: number
  rooms: DetectedRoom[]
  selectedSurface: SelectableSurface | null
  visibleRoomSignatures?: ReadonlySet<string> | null
}) {
  return (
    <>
      {floorPlane ? (
        <>
          <SelectableRoomSurfaceAreaMesh
            elevation={elevation}
            floorId={floorId}
            floorPlane={floorPlane}
            onRegisterPickTarget={onRegisterPickTarget}
            rooms={rooms}
            type="room-floor"
          />
          <SelectableRoomSurfaceAreaMesh
            elevation={elevation}
            floorId={floorId}
            floorPlane={floorPlane}
            onRegisterPickTarget={onRegisterPickTarget}
            roomHeight={roomHeight}
            rooms={rooms}
            type="ceiling"
          />
        </>
      ) : null}
      {rooms
        .filter(
          (room) =>
            !visibleRoomSignatures ||
            visibleRoomSignatures.has(room.signature),
        )
        .flatMap((room) => [
          <SelectableRoomSurfaceMesh
            key={`${room.signature}:floor`}
            elevation={elevation}
            floorId={floorId}
            onRegisterPickTarget={onRegisterPickTarget}
            room={room}
            roomHeight={roomHeight}
            selectedSurface={selectedSurface}
            type="room-floor"
          />,
          <SelectableRoomSurfaceMesh
            key={`${room.signature}:ceiling`}
            elevation={elevation}
            floorId={floorId}
            onRegisterPickTarget={onRegisterPickTarget}
            room={room}
            roomHeight={roomHeight}
            selectedSurface={selectedSurface}
            type="ceiling"
          />,
        ])}
    </>
  )
}

function SelectableRoomSurfaceAreaMesh({
  elevation,
  floorId,
  floorPlane,
  onRegisterPickTarget,
  roomHeight = 0,
  rooms,
  type,
}: {
  elevation: number
  floorId: string
  floorPlane: NonNullable<ReturnType<typeof getFloorPlaneBounds>>
  onRegisterPickTarget: (target: PickTarget) => () => void
  roomHeight?: number
  rooms: DetectedRoom[]
  type: 'ceiling' | 'room-floor'
}) {
  const meshRef = useRef<Object3D>(null!)
  const y = type === 'room-floor' ? elevation + 0.015 : elevation + roomHeight - 0.015
  const pickSide = type === 'ceiling' ? BackSide : FrontSide

  useHorizontalSurfaceVisibility(
    meshRef,
    y,
    type === 'room-floor' ? 'above' : 'below',
  )

  useEffect(() => {
    const object = meshRef.current

    if (!object) {
      return undefined
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      kind: 'room-surface-area',
      object,
      pickSide,
      rooms,
      surfaceType: type,
    })
  }, [floorId, onRegisterPickTarget, pickSide, rooms, type])

  return (
    <mesh
      ref={meshRef}
      position={[floorPlane.centerX, y, floorPlane.centerZ]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-2}
    >
      <planeGeometry args={[floorPlane.size, floorPlane.size]} />
      <meshBasicMaterial
        color="#000000"
        depthWrite={false}
        opacity={0}
        side={pickSide}
        transparent
      />
    </mesh>
  )
}

function useHorizontalSurfaceVisibility(
  surfaceRef: MutableRefObject<Object3D>,
  y: number,
  visibleFrom: 'above' | 'below',
) {
  useFrame(({ camera }) => {
    const surface = surfaceRef.current

    if (!surface) {
      return
    }

    surface.visible =
      visibleFrom === 'above' ? camera.position.y >= y : camera.position.y <= y
  })
}

function RoomFloorFinishMesh({
  assignment,
  elevation,
  materialId,
  room,
  wireframe,
}: {
  assignment: SurfaceMaterialAssignment
  elevation: number
  materialId: string
  room: DetectedRoom
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const material = surfaceMaterialsById.get(materialId)
  const shape = useMemo(() => createPlanShape(room.polygon), [room.polygon])
  const y = elevation + 0.004

  useHorizontalSurfaceVisibility(meshRef, y, 'above')

  if (!material) {
    return null
  }

  return (
    <mesh
      ref={meshRef}
      position={[0, y, 0]}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
    >
      <shapeGeometry args={[shape]} />
      <SurfaceMeshStandardMaterial
        assignment={assignment}
        material={material}
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        side={FrontSide}
        wireframe={wireframe}
      />
    </mesh>
  )
}

function RoomFloorFinishes({
  elevation,
  floorId,
  rooms,
  surfaceAssignments,
  visibleRoomSignatures,
  wireframe,
}: {
  elevation: number
  floorId: string
  rooms: DetectedRoom[]
  surfaceAssignments: SurfaceMaterialAssignment[]
  visibleRoomSignatures?: ReadonlySet<string> | null
  wireframe: boolean
}) {
  return (
    <group>
      {rooms
        .filter(
          (room) =>
            !visibleRoomSignatures ||
            visibleRoomSignatures.has(room.signature),
        )
        .map((room) => {
        const assignment = getRoomFloorMaterialAssignment(
          surfaceAssignments,
          floorId,
          room.signature,
        )

        return assignment ? (
          <RoomFloorFinishMesh
            key={room.signature}
            assignment={assignment}
            elevation={elevation}
            materialId={assignment.materialId}
            room={room}
            wireframe={wireframe}
          />
        ) : null
      })}
    </group>
  )
}

function RoomCeilingFinishMesh({
  assignment,
  elevation,
  materialId,
  room,
  roomHeight,
  wireframe,
}: {
  assignment: SurfaceMaterialAssignment
  elevation: number
  materialId: string
  room: DetectedRoom
  roomHeight: number
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const material = surfaceMaterialsById.get(materialId)
  const shape = useMemo(() => createPlanShape(room.polygon), [room.polygon])
  const y = elevation + roomHeight - 0.006

  useHorizontalSurfaceVisibility(meshRef, y, 'below')

  if (!material) {
    return null
  }

  return (
    <mesh
      ref={meshRef}
      position={[0, y, 0]}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
    >
      <shapeGeometry args={[shape]} />
      <SurfaceMeshStandardMaterial
        assignment={assignment}
        material={material}
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        side={BackSide}
        wireframe={wireframe}
      />
    </mesh>
  )
}

function RoomCeilingFinishes({
  elevation,
  floorId,
  roomHeight,
  rooms,
  surfaceAssignments,
  visibleRoomSignatures,
  wireframe,
}: {
  elevation: number
  floorId: string
  roomHeight: number
  rooms: DetectedRoom[]
  surfaceAssignments: SurfaceMaterialAssignment[]
  visibleRoomSignatures?: ReadonlySet<string> | null
  wireframe: boolean
}) {
  return (
    <group>
      {rooms
        .filter(
          (room) =>
            !visibleRoomSignatures ||
            visibleRoomSignatures.has(room.signature),
        )
        .map((room) => {
        const assignment = getRoomCeilingMaterialAssignment(
          surfaceAssignments,
          floorId,
          room.signature,
        )

        return assignment ? (
          <RoomCeilingFinishMesh
            key={room.signature}
            assignment={assignment}
            elevation={elevation}
            materialId={assignment.materialId}
            room={room}
            roomHeight={roomHeight}
            wireframe={wireframe}
          />
        ) : null
      })}
    </group>
  )
}

function getPlanAabbFromBox(box: Box3): PlanAabb {
  return {
    maxX: box.max.x,
    maxY: box.max.z,
    minX: box.min.x,
    minY: box.min.z,
  }
}

function getPlanAabbFromPoints(points: Point[]): PlanAabb {
  return points.reduce<PlanAabb>(
    (bounds, point) => ({
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
    }),
    {
      maxX: -Infinity,
      maxY: -Infinity,
      minX: Infinity,
      minY: Infinity,
    },
  )
}

function planAabbsOverlap(
  firstBounds: PlanAabb,
  secondBounds: PlanAabb,
  tolerance = 0,
) {
  return (
    firstBounds.minX < secondBounds.maxX - tolerance &&
    firstBounds.maxX > secondBounds.minX + tolerance &&
    firstBounds.minY < secondBounds.maxY - tolerance &&
    firstBounds.maxY > secondBounds.minY + tolerance
  )
}

function getModelWallSnap(
  position: Point,
  localBounds: ModelHorizontalBounds | null,
  localForwardAngle: number | null,
  walls: Wall[],
) {
  const getOutwardProjection = (rotationY: number, localPoint: Point, outwardDirection: Point) => {
    const cos = Math.cos(rotationY)
    const sin = Math.sin(rotationY)
    const worldX = localPoint.x * cos + localPoint.y * sin
    const worldZ = -localPoint.x * sin + localPoint.y * cos

    return worldX * outwardDirection.x + worldZ * outwardDirection.y
  }
  const getWallInset = (rotationY: number, outwardDirection: Point) => {
    if (!localBounds) {
      return 0
    }

    const localCorners = [
      { x: localBounds.minX, y: localBounds.minZ },
      { x: localBounds.minX, y: localBounds.maxZ },
      { x: localBounds.maxX, y: localBounds.minZ },
      { x: localBounds.maxX, y: localBounds.maxZ },
    ]
    const minOutwardProjection = Math.min(
      ...localCorners.map((corner) =>
        getOutwardProjection(rotationY, corner, outwardDirection),
      ),
    )

    return Math.max(0, -minOutwardProjection)
  }

  return walls
    .map((wall) => {
      const dx = wall.end.x - wall.start.x
      const dy = wall.end.y - wall.start.y
      const lengthSquared = dx * dx + dy * dy

      if (lengthSquared === 0) {
        return null
      }

      const length = Math.sqrt(lengthSquared)
      const unit = { x: dx / length, y: dy / length }
      const normal = { x: -unit.y, y: unit.x }
      const t =
        ((position.x - wall.start.x) * dx + (position.y - wall.start.y) * dy) /
        lengthSquared

      if (t < 0 || t > 1) {
        return null
      }

      const projection = {
        x: wall.start.x + dx * t,
        y: wall.start.y + dy * t,
      }
      const signedDistance =
        (position.x - projection.x) * normal.x +
        (position.y - projection.y) * normal.y
      const side = signedDistance < 0 ? -1 : 1
      const outwardDirection = {
        x: normal.x * side,
        y: normal.y * side,
      }
      const outwardAngle = Math.atan2(outwardDirection.y, outwardDirection.x)
      const rotation =
        localForwardAngle === null
          ? Math.atan2(dy, dx) + (side < 0 ? Math.PI : 0)
          : outwardAngle - localForwardAngle
      const wallInset = getWallInset(-rotation, {
        x: outwardDirection.x,
        y: outwardDirection.y,
      })
      const targetDistance = wall.thickness / 2 + wallInset
      const distanceToWallFace = Math.max(0, Math.abs(signedDistance) - wall.thickness / 2)
      const snapDistance = distanceToWallFace

      if (distanceToWallFace > MODEL_WALL_SNAP_DISTANCE_METERS) {
        return null
      }

      return {
        distance: snapDistance,
        position: {
          x: projection.x + normal.x * side * targetDistance,
          y: projection.y + normal.y * side * targetDistance,
        },
        rotation,
        wallId: wall.id,
      }
    })
    .filter(
      (
        snap,
      ): snap is { distance: number; position: Point; rotation: number; wallId: string } =>
        Boolean(snap),
    )
    .sort((firstSnap, secondSnap) => firstSnap.distance - secondSnap.distance)[0] ?? null
}

function ModelMesh({
  daylightEnabled,
  elevation,
  floorId,
  frustumCullingEnabled,
  isActive,
  isSelected,
  lightMarkersVisible,
  model,
  modelAssetVersion,
  pickTargetsRef,
  onRegisterPickTarget,
  onTransformActiveChange,
  onUpdateModel,
  shadowsEnabled,
  transformEnabled,
  transformMode,
  walls,
  wireframe,
}: {
  daylightEnabled: boolean
  elevation: number
  floorId: string
  frustumCullingEnabled: boolean
  isActive: boolean
  isSelected: boolean
  lightMarkersVisible: boolean
  model: PlacedModel
  modelAssetVersion: number
  pickTargetsRef: MutableRefObject<PickTarget[]>
  onRegisterPickTarget: (target: PickTarget) => () => void
  onTransformActiveChange: (isActive: boolean) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
  shadowsEnabled: boolean
  transformEnabled: boolean
  transformMode: TransformMode
  walls: Wall[]
  wireframe: boolean
}) {
  const groupRef = useRef<Object3D>(null!)
  const lastValidTransformRef = useRef<ObjectTransformSnapshot | null>(null)
  const [importedLocalBounds, setImportedLocalBounds] =
    useState<ModelHorizontalBounds | null>(null)
  const modelDefinition = modelsById.get(model.modelId)

  if (!modelDefinition) {
    return null
  }

  const verticalOffset =
    modelDefinition.isLight
      ? model.height ?? modelDefinition.height
      : modelDefinition.wallMount === 'window'
        ? WINDOW_SILL_HEIGHT_METERS
        : 0
  const castsShadow =
    shadowsEnabled &&
    isActive &&
    !modelDefinition.isLight &&
    modelDefinition.wallMount !== 'window' &&
    modelDefinition.wallMount !== 'patio-door'
  const floorSnapY = elevation + verticalOffset
  const snapObjectToFloor = () => {
    const object = groupRef.current

    if (object && !modelDefinition.isLight) {
      object.position.y = floorSnapY
    }
  }
  const getObjectUniformScale = (object: Object3D) =>
    Math.max(
      0.2,
      (Math.abs(object.scale.x) + Math.abs(object.scale.y) + Math.abs(object.scale.z)) / 3,
    )
  const importedForwardAngle = modelDefinition.sourceUrl ? -Math.PI / 2 : null
  const getObjectTransformSnapshot = (object: Object3D): ObjectTransformSnapshot => ({
    position: object.position.clone(),
    rotationY: object.rotation.y,
    scale: object.scale.clone(),
  })
  const restoreObjectTransform = (
    object: Object3D,
    snapshot: ObjectTransformSnapshot,
  ) => {
    object.position.copy(snapshot.position)
    object.rotation.y = snapshot.rotationY
    object.scale.copy(snapshot.scale)
    object.updateWorldMatrix(true, true)
  }
  const updateLastValidTransform = () => {
    const object = groupRef.current

    if (!object) {
      return
    }

    lastValidTransformRef.current = getObjectTransformSnapshot(object)
  }
  const objectCollides = (ignoredWallId?: string) => {
    const object = groupRef.current

    if (!object || modelDefinition.isLight) {
      return false
    }

    object.updateWorldMatrix(true, true)

    const collisionTarget =
      pickTargetsRef.current.find(
        (target) => target.kind === 'model' && target.modelId === model.id,
      )
        ?.object ?? object
    collisionTarget.updateWorldMatrix(true, false)

    const objectBox = new Box3().setFromObject(collisionTarget)
    const objectBounds = getPlanAabbFromBox(objectBox)
    const collidesWithWall = walls.some((wall) => {
      if (wall.id === ignoredWallId) {
        return false
      }

      return planAabbsOverlap(
        objectBounds,
        getPlanAabbFromPoints(getWallPolygon({ wall, startExtension: 0, endExtension: 0 })),
      )
    })

    if (collidesWithWall) {
      return true
    }

    return pickTargetsRef.current.some((target) => {
      if (
        !target.blocksCollision ||
        target.kind !== 'model' ||
        target.modelId === model.id ||
        target.floorId !== floorId
      ) {
        return false
      }

      target.object.updateWorldMatrix(true, false)

      return planAabbsOverlap(
        objectBounds,
        getPlanAabbFromBox(new Box3().setFromObject(target.object)),
      )
    })
  }
  const applyObjectSnaps = () => {
    const object = groupRef.current

    if (!object) {
      return null
    }

    snapObjectToFloor()

    const uniformScale = getObjectUniformScale(object)
    const transformedPosition = {
      x: object.position.x,
      y: object.position.z,
    }
    const wallSnap = modelDefinition.wallMount || modelDefinition.isLight
      ? null
      : getModelWallSnap(
          transformedPosition,
          modelDefinition.sourceUrl ? importedLocalBounds : null,
          importedForwardAngle,
          walls,
        )

    if (wallSnap) {
      object.position.x = wallSnap.position.x
      object.position.z = wallSnap.position.y
      object.rotation.y = -wallSnap.rotation
    }

    if (objectCollides(wallSnap?.wallId)) {
      const lastValidTransform = lastValidTransformRef.current

      if (lastValidTransform) {
        restoreObjectTransform(object, lastValidTransform)
      }

      return null
    }

    updateLastValidTransform()

    return {
      height: modelDefinition.isLight
        ? Math.max(0.05, object.position.y - elevation)
        : undefined,
      position: wallSnap?.position ?? transformedPosition,
      rotation: wallSnap?.rotation ?? -object.rotation.y,
      scale: uniformScale,
    }
  }
  const commitObjectTransform = () => {
    const snappedTransform = applyObjectSnaps()

    if (!snappedTransform) {
      return
    }

    onUpdateModel(model.id, {
      height: snappedTransform.height,
      position: snappedTransform.position,
      rotation: snappedTransform.rotation,
      scale: snappedTransform.scale,
      wallAttachment: undefined,
    })
  }
  const modelGroup = (
    <group
      ref={groupRef}
      position={[model.position.x, floorSnapY, model.position.y]}
      rotation={[0, -model.rotation, 0]}
      scale={model.scale}
      renderOrder={isActive ? 3 : 1}
    >
      {modelDefinition.isLight ? (
        <LightModelContent
          floorId={floorId}
          frustumCullingEnabled={frustumCullingEnabled}
          isActive={isActive}
          isSelected={isSelected}
          markersVisible={lightMarkersVisible}
          model={model}
          onRegisterPickTarget={onRegisterPickTarget}
        />
      ) : modelDefinition.sourceUrl ? (
        <ImportedModelContent
          castsShadow={castsShadow}
          daylightEnabled={daylightEnabled}
          floorId={floorId}
          frustumCullingEnabled={frustumCullingEnabled}
          isActive={isActive}
          isSelected={isSelected}
          blocksCollision={!modelDefinition.wallMount}
          modelId={model.id}
          onBoundsChange={setImportedLocalBounds}
          onRegisterPickTarget={onRegisterPickTarget}
          sourceUrl={getModelAssetUrl(
            modelDefinition.sourceUrl,
            modelAssetVersion,
          )}
          wireframe={wireframe}
        />
      ) : (
        <FallbackModelContent
          castsShadow={castsShadow}
          frustumCullingEnabled={frustumCullingEnabled}
          isActive={isActive}
          isSelected={isSelected}
          model={model}
          floorId={floorId}
          onRegisterPickTarget={onRegisterPickTarget}
          wireframe={wireframe}
        />
      )}
    </group>
  )

  if (isSelected && isActive && transformEnabled) {
    return (
      <>
        {modelGroup}
        <TransformControls
          object={groupRef}
          mode={transformMode}
          onMouseDown={() => {
            updateLastValidTransform()
            onTransformActiveChange(true)
          }}
          onObjectChange={() => {
            if (transformMode === 'translate') {
              applyObjectSnaps()
            }
          }}
          onMouseUp={() => {
            commitObjectTransform()
            onTransformActiveChange(false)
          }}
        />
      </>
    )
  }

  return modelGroup
}

function WallEngineExclusionDebugRecorder({
  externalWallUnionWallIds,
  floorId,
  legacyInternalWallFootprintWallIds,
  renderedWalls,
  surfaceAssignments,
}: {
  externalWallUnionWallIds: string[]
  floorId: string
  legacyInternalWallFootprintWallIds: string[]
  renderedWalls: RenderedWall[]
  surfaceAssignments: SurfaceMaterialAssignment[]
}) {
  useEffect(() => {
    const externalWallUnionWallIdSet = new Set(externalWallUnionWallIds)
    const legacyInternalWallFootprintWallIdSet = new Set(
      legacyInternalWallFootprintWallIds,
    )

    renderedWalls.forEach((renderedWall) => {
      const reasons = getBaseWallEngineExclusionReasons(
        renderedWall.wall,
        surfaceAssignments,
      )

      if (externalWallUnionWallIdSet.has(renderedWall.wall.id)) {
        reasons.push('external-union-footprint')
      }

      if (legacyInternalWallFootprintWallIdSet.has(renderedWall.wall.id)) {
        reasons.push('legacy-internal-footprint-group')
      }

      if (reasons.length === 0) {
        return
      }

      recordWallRenderDebug(
        'wall-renderer:engine-excluded',
        `floor=${floorId} wall=${renderedWall.wall.id}`,
        JSON.stringify({
          kind: renderedWall.wall.kind,
          reasons,
        }),
      )
    })
  }, [
    externalWallUnionWallIds,
    floorId,
    legacyInternalWallFootprintWallIds,
    renderedWalls,
    surfaceAssignments,
  ])

  return null
}

function SolidFloorScene({
  daylightEnabled,
  externalWallUnionFootprints,
  externalWallUnionWallIds,
  externalWallUnionWalls,
  floor,
  frustumCullingEnabled,
  internalWallFootprintGroups,
  isSelectedModel,
  lightMarkersVisible,
  modelAssetVersion,
  onRegisterPickTarget,
  onTransformActiveChange,
  onUpdateModel,
  pickTargetsRef,
  renderedWalls,
  rooms,
  selectedWallId,
  selectedSurface,
  shadowsEnabled,
  surfaceAssignments,
  transformEnabled,
  transformMode,
  visibleRoomSignatures,
  wallBodyOccluders,
  wireframe,
}: {
  daylightEnabled: boolean
  externalWallUnionFootprints: WallUnionFootprint[]
  externalWallUnionWallIds: string[]
  externalWallUnionWalls: Wall[]
  floor: FloorLevel
  frustumCullingEnabled: boolean
  internalWallFootprintGroups: WallFootprintRenderGroup[]
  isSelectedModel: (modelId: string) => boolean
  lightMarkersVisible: boolean
  modelAssetVersion: number
  onRegisterPickTarget: (target: PickTarget) => () => void
  onTransformActiveChange: (isActive: boolean) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
  pickTargetsRef: MutableRefObject<PickTarget[]>
  renderedWalls: RenderedWall[]
  rooms: DetectedRoom[]
  selectedWallId: string | null
  selectedSurface: SelectableSurface | null
  shadowsEnabled: boolean
  surfaceAssignments: SurfaceMaterialAssignment[]
  transformEnabled: boolean
  transformMode: TransformMode
  visibleRoomSignatures?: ReadonlySet<string> | null
  wallBodyOccluders: WallBodyOccluder[]
  wireframe: boolean
}) {
  const usesExternalWallUnion = externalWallUnionFootprints.length > 0
  const externalWallUnionWallIdSet = useMemo(
    () => new Set(externalWallUnionWallIds),
    [externalWallUnionWallIds],
  )
  const geometryContextWalls = useMemo(
    () => renderedWalls.map((renderedWall) => renderedWall.wall),
    [renderedWalls],
  )
  const wallsById = useMemo(
    () => new Map(geometryContextWalls.map((wall) => [wall.id, wall])),
    [geometryContextWalls],
  )
  const externalUnionFilteredRenderedWalls = usesExternalWallUnion
    ? renderedWalls.filter(
        (renderedWall) =>
          !externalWallUnionWallIdSet.has(renderedWall.wall.id),
      )
    : renderedWalls
  const wallEngineCandidateRenderedWalls = getWallEngineCandidateRenderedWalls(
    externalUnionFilteredRenderedWalls,
    surfaceAssignments,
  )
  const wallEngineCandidateWallIds = new Set(
    wallEngineCandidateRenderedWalls.map((renderedWall) => renderedWall.wall.id),
  )
  const wallEngineHandledInternalFootprintWallIds =
    getWallIdsForEngineHandledInternalFootprintGroups(
      internalWallFootprintGroups,
      wallEngineCandidateWallIds,
    )
  const legacyInternalWallFootprintWallIdSet =
    getWallIdsForLegacyInternalFootprintGroups(
      internalWallFootprintGroups,
      wallEngineCandidateWallIds,
    )
  const visibleRenderedWalls = externalUnionFilteredRenderedWalls.filter(
    (renderedWall) =>
      !legacyInternalWallFootprintWallIdSet.has(renderedWall.wall.id),
  )
  const wallEngineRenderedWalls = wallEngineCandidateRenderedWalls.filter(
    (renderedWall) =>
      !legacyInternalWallFootprintWallIdSet.has(renderedWall.wall.id),
  )
  const wallEngineRenderedWallIds = new Set(
    wallEngineRenderedWalls.map((renderedWall) => renderedWall.wall.id),
  )
  const legacyVisibleRenderedWalls = wallEngineRenderedWalls.length > 0
    ? visibleRenderedWalls.filter(
        (renderedWall) => !wallEngineRenderedWallIds.has(renderedWall.wall.id),
      )
    : visibleRenderedWalls
  useEffect(() => {
    renderedWalls.forEach((renderedWall) => {
      const reasons = getBaseWallEngineExclusionReasons(
        renderedWall.wall,
        surfaceAssignments,
      )

      if (externalWallUnionWallIdSet.has(renderedWall.wall.id)) {
        reasons.push('external-union-footprint')
      }

      if (legacyInternalWallFootprintWallIdSet.has(renderedWall.wall.id)) {
        reasons.push('legacy-internal-footprint-group')
      }

      if (reasons.length === 0) {
        return
      }

      recordWallRenderDebug(
        'wall-renderer:engine-excluded',
        `floor=${floor.id} wall=${renderedWall.wall.id}`,
        JSON.stringify({
          kind: renderedWall.wall.kind,
          reasons,
        }),
      )
    })
  }, [
    externalWallUnionWallIdSet,
    floor.id,
    legacyInternalWallFootprintWallIdSet,
    renderedWalls,
    surfaceAssignments,
  ])
  const visibleModels = useMemo(
    () =>
      (floor.models ?? []).filter((model) => {
        if (!visibleRoomSignatures || isSelectedModel(model.id)) {
          return true
        }

        return modelIsInVisibleRooms(model, rooms, visibleRoomSignatures)
      }),
    [
      floor.models,
      isSelectedModel,
      rooms,
      visibleRoomSignatures,
    ],
  )

  return (
    <>
      {usesExternalWallUnion ? (
        <>
          <WallFootprintMeshes
            castsShadow={shadowsEnabled}
            elevation={floor.elevation}
            floorId={floor.id}
            footprints={externalWallUnionFootprints}
            geometryContextRenderedWalls={renderedWalls}
            geometryContextWalls={geometryContextWalls}
            height={floor.roomHeight}
            onRegisterPickTarget={onRegisterPickTarget}
            selectedWallId={selectedWallId}
            selectedSurface={selectedSurface}
            sourceWalls={externalWallUnionWalls}
            surfaceAssignments={surfaceAssignments}
            wallKind="external"
            wireframe={wireframe}
          />
        </>
      ) : null}
      {internalWallFootprintGroups
        .filter((group) => group.wallIds && group.wallIds.length > 1)
        .filter(
          (group) =>
            !internalFootprintGroupUsesWallEngine(
              group,
              wallEngineHandledInternalFootprintWallIds,
            ),
        )
        .map((group) => (
        <WallFootprintMeshes
          key={group.wallId}
          castsShadow={shadowsEnabled}
          elevation={floor.elevation}
          floorId={floor.id}
          footprints={group.footprints}
          geometryContextRenderedWalls={renderedWalls}
          geometryContextWalls={geometryContextWalls}
          height={floor.roomHeight}
          includeVerticalFaces={Boolean(group.wallIds && group.wallIds.length > 1)}
          onRegisterPickTarget={onRegisterPickTarget}
          selectedWallId={selectedWallId}
          selectedSurface={selectedSurface}
          sourceWalls={(group.wallIds ?? [group.wallId])
            .map((wallId) => wallsById.get(wallId))
            .filter((wall): wall is Wall => Boolean(wall))}
          surfaceAssignments={surfaceAssignments}
          wallKind="internal"
          wireframe={wireframe}
        />
      ))}
      {wallEngineRenderedWalls.length > 0 ? (
        <WallEngineWallMeshes
          castsShadow={shadowsEnabled}
          elevation={floor.elevation}
          externalFootprintWallIds={externalWallUnionWallIdSet}
          floorId={floor.id}
          onRegisterPickTarget={onRegisterPickTarget}
          renderedWalls={wallEngineRenderedWalls}
          roomSurfaceDebugRenderedWalls={renderedWalls}
          rooms={rooms}
          selectedSurface={selectedSurface}
          selectedWallId={selectedWallId}
          surfaceAssignments={surfaceAssignments}
          wireframe={wireframe}
        />
      ) : null}
      {legacyVisibleRenderedWalls.map((renderedWall) => (
        <WallMesh
          key={renderedWall.wall.id}
          castsShadow={shadowsEnabled}
          elevation={floor.elevation}
          floorId={floor.id}
          isActive
          onRegisterPickTarget={onRegisterPickTarget}
          renderedWall={renderedWall}
          selectedWallId={selectedWallId}
          selectedSurface={selectedSurface}
          surfaceAssignments={surfaceAssignments}
          wallBodyOccluders={wallBodyOccluders}
          wireframe={wireframe}
        />
      ))}
      <SkirtingBoards
        elevation={floor.elevation}
        externalWallUnionFootprints={externalWallUnionFootprints}
        models={visibleModels}
        renderedWalls={renderedWalls}
        rooms={rooms}
        wireframe={wireframe}
      />
      <Suspense fallback={null}>
        {visibleModels.map((model) => (
          <ModelLoadBoundary key={`${model.id}:${modelAssetVersion}`}>
            <ModelMesh
              daylightEnabled={daylightEnabled}
              elevation={floor.elevation}
              floorId={floor.id}
              frustumCullingEnabled={frustumCullingEnabled}
              isActive
              isSelected={isSelectedModel(model.id)}
              lightMarkersVisible={lightMarkersVisible}
              model={model}
              modelAssetVersion={modelAssetVersion}
              pickTargetsRef={pickTargetsRef}
              onRegisterPickTarget={onRegisterPickTarget}
              onTransformActiveChange={onTransformActiveChange}
              onUpdateModel={onUpdateModel}
              shadowsEnabled={shadowsEnabled}
              transformEnabled={transformEnabled}
              transformMode={transformMode}
              walls={floor.walls}
              wireframe={wireframe}
            />
          </ModelLoadBoundary>
        ))}
      </Suspense>
    </>
  )
}

function SelectionBoundsBox({
  center,
  size,
}: {
  center: [number, number, number]
  size: [number, number, number]
}) {
  const scaledSize = [
    Math.max(size[0] * MODEL_BOUNDS_SCALE, 0.04),
    Math.max(size[1] * MODEL_BOUNDS_SCALE, 0.04),
    Math.max(size[2] * MODEL_BOUNDS_SCALE, 0.04),
  ] as const
  const halfX = scaledSize[0] / 2
  const halfY = scaledSize[1] / 2
  const halfZ = scaledSize[2] / 2
  const thickness = Math.min(
    MODEL_BOUNDS_LINE_THICKNESS,
    Math.min(scaledSize[0], scaledSize[1], scaledSize[2]) / 3,
  )
  const edges = [
    { position: [0, halfY, halfZ], size: [scaledSize[0], thickness, thickness] },
    { position: [0, halfY, -halfZ], size: [scaledSize[0], thickness, thickness] },
    { position: [0, -halfY, halfZ], size: [scaledSize[0], thickness, thickness] },
    { position: [0, -halfY, -halfZ], size: [scaledSize[0], thickness, thickness] },
    { position: [halfX, 0, halfZ], size: [thickness, scaledSize[1], thickness] },
    { position: [halfX, 0, -halfZ], size: [thickness, scaledSize[1], thickness] },
    { position: [-halfX, 0, halfZ], size: [thickness, scaledSize[1], thickness] },
    { position: [-halfX, 0, -halfZ], size: [thickness, scaledSize[1], thickness] },
    { position: [halfX, halfY, 0], size: [thickness, thickness, scaledSize[2]] },
    { position: [halfX, -halfY, 0], size: [thickness, thickness, scaledSize[2]] },
    { position: [-halfX, halfY, 0], size: [thickness, thickness, scaledSize[2]] },
    { position: [-halfX, -halfY, 0], size: [thickness, thickness, scaledSize[2]] },
  ] as const

  return (
    <group position={center} renderOrder={6}>
      {edges.map((edge, index) => (
        <mesh key={index} position={edge.position}>
          <boxGeometry args={edge.size} />
          <meshBasicMaterial
            color={MODEL_OUTLINE_COLOR}
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

function FallbackModelContent({
  castsShadow,
  floorId,
  isActive,
  isSelected,
  frustumCullingEnabled,
  model,
  onRegisterPickTarget,
  wireframe,
}: {
  castsShadow: boolean
  floorId: string
  frustumCullingEnabled: boolean
  isActive: boolean
  isSelected: boolean
  model: PlacedModel
  onRegisterPickTarget: (target: PickTarget) => () => void
  wireframe: boolean
}) {
  const modelMeshRef = useRef<Object3D>(null!)
  const modelDefinition = modelsById.get(model.modelId)

  useEffect(() => {
    const object = modelMeshRef.current

    if (!object) {
      return
    }

    return onRegisterPickTarget({
      blocksCollision: !modelDefinition?.wallMount,
      floorId,
      kind: 'model',
      modelId: model.id,
      object,
    })
  }, [floorId, model.id, modelDefinition?.wallMount, onRegisterPickTarget])

  if (!modelDefinition) {
    return null
  }

  return (
    <>
      {isSelected && isActive ? (
        <SelectionBoundsBox
          center={[
            0,
            modelDefinition.height / 2,
            modelDefinition.depth / 2,
          ]}
          size={[
            modelDefinition.width,
            modelDefinition.height,
            modelDefinition.depth,
          ]}
        />
      ) : null}
      <mesh
        ref={modelMeshRef}
        position={[
          0,
          modelDefinition.height / 2,
          modelDefinition.depth / 2,
        ]}
        castShadow={castsShadow}
        frustumCulled={frustumCullingEnabled}
        receiveShadow={isActive}
      >
        {modelDefinition.shape === 'round' ? (
          <cylinderGeometry
            args={[
              Math.max(modelDefinition.width, modelDefinition.depth) / 2,
              Math.max(modelDefinition.width, modelDefinition.depth) / 2,
              modelDefinition.height,
              32,
            ]}
          />
        ) : (
          <boxGeometry
            args={[
              modelDefinition.width,
              modelDefinition.height,
              modelDefinition.depth,
            ]}
          />
        )}
        <meshStandardMaterial
          color={modelDefinition.color}
          opacity={isActive ? 1 : 0.24}
          transparent={!isActive}
          roughness={0.68}
          wireframe={wireframe}
        />
      </mesh>
    </>
  )
}

function LightModelContent({
  floorId,
  frustumCullingEnabled,
  isActive,
  isSelected,
  markersVisible,
  model,
  onRegisterPickTarget,
}: {
  floorId: string
  frustumCullingEnabled: boolean
  isActive: boolean
  isSelected: boolean
  markersVisible: boolean
  model: PlacedModel
  onRegisterPickTarget: (target: PickTarget) => () => void
}) {
  const markerRef = useRef<Object3D>(null!)
  const modelDefinition = modelsById.get(model.modelId)
  const lightColor =
    model.lightColor ?? modelDefinition?.lightColor ?? modelDefinition?.color ?? '#fff3c4'
  const lightKind = modelDefinition?.lightKind ?? 'point'
  const showMarker = isSelected || markersVisible

  useEffect(() => {
    const object = markerRef.current

    if (!showMarker || !object) {
      return undefined
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      kind: 'model',
      modelId: model.id,
      object,
    })
  }, [floorId, model.id, onRegisterPickTarget, showMarker])

  return (
    <>
      {isSelected && isActive ? (
        <SelectionBoundsBox center={[0, 0, 0]} size={[0.42, 0.42, 0.42]} />
      ) : null}
      {showMarker ? (
        <group ref={markerRef}>
          <mesh frustumCulled={frustumCullingEnabled}>
            <sphereGeometry args={[0.12, 24, 16]} />
            <meshBasicMaterial color={lightColor} toneMapped={false} />
          </mesh>
          <mesh
            frustumCulled={frustumCullingEnabled}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.18, 0.2, 32]} />
            <meshBasicMaterial color={lightColor} toneMapped={false} />
          </mesh>
          {lightKind === 'spot' ? (
            <mesh
              frustumCulled={frustumCullingEnabled}
              position={[0, -0.18, 0]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <coneGeometry args={[0.16, 0.24, 24, 1, true]} />
              <meshBasicMaterial
                color={lightColor}
                opacity={0.38}
                transparent
                toneMapped={false}
                wireframe
              />
            </mesh>
          ) : null}
        </group>
      ) : null}
    </>
  )
}

function ImportedModelContent({
  blocksCollision,
  castsShadow,
  daylightEnabled,
  floorId,
  frustumCullingEnabled,
  isActive,
  isSelected,
  modelId,
  onBoundsChange,
  onRegisterPickTarget,
  sourceUrl,
  wireframe,
}: {
  blocksCollision: boolean
  castsShadow: boolean
  daylightEnabled: boolean
  floorId: string
  frustumCullingEnabled: boolean
  isActive: boolean
  isSelected: boolean
  modelId: string
  onBoundsChange: (bounds: ModelHorizontalBounds) => void
  onRegisterPickTarget: (target: PickTarget) => () => void
  sourceUrl: string
  wireframe: boolean
}) {
  const gltf = useGLTF(sourceUrl)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const bounds = useMemo(() => {
    const box = new Box3().setFromObject(scene)
    const size = new Vector3()
    const center = new Vector3()

    box.getSize(size)
    box.getCenter(center)

    return {
      box,
      center,
      size,
    }
  }, [scene])

  useEffect(() => {
    onBoundsChange({
      maxX: bounds.box.max.x,
      maxZ: bounds.box.max.z,
      minX: bounds.box.min.x,
      minZ: bounds.box.min.z,
    })
  }, [bounds, onBoundsChange])

  useEffect(() => {
    return onRegisterPickTarget({
      blocksCollision,
      floorId,
      kind: 'model',
      modelId,
      object: scene,
    })
  }, [blocksCollision, floorId, modelId, onRegisterPickTarget, scene])

  useEffect(() => {
    scene.traverse((object) => {
      if ('castShadow' in object) {
        object.castShadow = castsShadow
      }

      object.frustumCulled = frustumCullingEnabled

      if ('receiveShadow' in object) {
        object.receiveShadow = isActive
      }

      if ('material' in object) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material]

        for (const material of materials) {
          if (!material) {
            continue
          }

          const materialName = 'name' in material ? String(material.name) : ''
          const objectName = 'name' in object ? String(object.name) : ''
          const isGlassMaterial = /glass/i.test(`${objectName} ${materialName}`)

          if (
            isGlassMaterial &&
            'color' in material &&
            material.color instanceof Color &&
            'opacity' in material &&
            'transparent' in material &&
            'userData' in material
          ) {
            const originalGlass = material.userData.originalGlass as
              | { color: number; opacity: number; transparent: boolean }
              | undefined

            if (!originalGlass) {
              material.userData.originalGlass = {
                color: material.color.getHex(),
                opacity: material.opacity,
                transparent: material.transparent,
              }
            }

            const glass =
              (material.userData.originalGlass as {
                color: number
                opacity: number
                transparent: boolean
              }) ?? {
                color: material.color.getHex(),
                opacity: material.opacity,
                transparent: material.transparent,
              }

            if (daylightEnabled) {
              material.color.setHex(glass.color)
              material.opacity = glass.opacity
              material.transparent = glass.transparent
            } else {
              material.color.set('#020617')
              material.opacity = Math.min(glass.opacity, 0.1)
              material.transparent = true
            }

            material.needsUpdate = true
          }

          if (
            'metalness' in material &&
            'roughness' in material &&
            'map' in material &&
            'normalMap' in material &&
            'roughnessMap' in material &&
            'metalnessMap' in material &&
            material.metalness > 0.8 &&
            !material.map &&
            !material.normalMap &&
            !material.roughnessMap &&
            !material.metalnessMap
          ) {
            material.metalness = 0
            material.roughness = Math.max(material.roughness, 0.55)
            material.needsUpdate = true
          }

          if ('side' in material) {
            material.side = DoubleSide
          }

          if ('opacity' in material && material.opacity <= 0.001) {
            material.opacity = 1
            material.transparent = false
          }

          if ('wireframe' in material) {
            material.wireframe = wireframe
            material.needsUpdate = true
          }
        }
      }
    })
  }, [
    castsShadow,
    daylightEnabled,
    frustumCullingEnabled,
    isActive,
    scene,
    wireframe,
  ])

  return (
    <>
      {isSelected && isActive ? (
        <SelectionBoundsBox
          center={[bounds.center.x, bounds.center.y, bounds.center.z]}
          size={[bounds.size.x, bounds.size.y, bounds.size.z]}
        />
      ) : null}
      <primitive object={scene} />
    </>
  )
}

function CameraFovController({ fov }: { fov: number }) {
  const { camera } = useThree()

  useEffect(() => {
    if ('fov' in camera) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }, [camera, fov])

  return null
}

function setIdsEqual(firstIds: ReadonlySet<string>, secondIds: ReadonlySet<string>) {
  if (firstIds.size !== secondIds.size) {
    return false
  }

  for (const id of firstIds) {
    if (!secondIds.has(id)) {
      return false
    }
  }

  return true
}

function estimateRealtimeLocalLightLimit(maxFragmentUniforms: number) {
  if (maxFragmentUniforms >= 1024) {
    return MAX_REALTIME_LOCAL_LIGHTS
  }

  if (maxFragmentUniforms >= 512) {
    return 8
  }

  return 4
}

function RendererLightCapabilities({
  onLocalLightLimitChange,
}: {
  onLocalLightLimitChange: (lightLimit: number) => void
}) {
  const { gl } = useThree()

  useEffect(() => {
    onLocalLightLimitChange(
      estimateRealtimeLocalLightLimit(gl.capabilities.maxFragmentUniforms),
    )
  }, [gl, onLocalLightLimitChange])

  return null
}

function getStableLocalLightIds({
  activeFloorId,
  limit,
  selectedModelId,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  limit: number
  selectedModelId?: string | null
  visibleRenderedFloors: RenderedFloorData[]
}) {
  const selectedLightIds: string[] = []
  const otherLightIds: string[] = []

  for (const renderedFloor of visibleRenderedFloors) {
    const floor = renderedFloor.floor

    if (floor.id !== activeFloorId) {
      continue
    }

    for (const model of floor.models ?? []) {
      const modelDefinition = modelsById.get(model.modelId)

      if (
        !modelDefinition?.isLight ||
        model.lightEnabled === false
      ) {
        continue
      }

      if (model.id === selectedModelId) {
        selectedLightIds.push(model.id)
      } else {
        otherLightIds.push(model.id)
      }
    }
  }

  return new Set(
    [...selectedLightIds, ...otherLightIds]
      .slice(0, limit)
  )
}

function LocalLightBudgetController({
  activeFloorId,
  enabled,
  localLightLimit,
  onLocalLightIdsChange,
  selectedModelId,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  enabled: boolean
  localLightLimit: number
  onLocalLightIdsChange: (lightIds: ReadonlySet<string>) => void
  selectedModelId: string | null
  visibleRenderedFloors: RenderedFloorData[]
}) {
  const lastIdsRef = useRef<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const nextIds = enabled
      ? getStableLocalLightIds({
          activeFloorId,
          limit: localLightLimit,
          selectedModelId,
          visibleRenderedFloors,
        })
      : new Set<string>()

    if (!setIdsEqual(lastIdsRef.current, nextIds)) {
      lastIdsRef.current = nextIds
      onLocalLightIdsChange(nextIds)
    }
  }, [
    activeFloorId,
    enabled,
    localLightLimit,
    onLocalLightIdsChange,
    selectedModelId,
    visibleRenderedFloors,
  ])

  return null
}

function getLocalLightSlots({
  activeFloorId,
  localLightIds,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  localLightIds: ReadonlySet<string>
  visibleRenderedFloors: RenderedFloorData[]
}) {
  const slots: LocalLightSlot[] = []

  for (const renderedFloor of visibleRenderedFloors) {
    const floor = renderedFloor.floor

    if (floor.id !== activeFloorId) {
      continue
    }

    for (const model of floor.models ?? []) {
      const modelDefinition = modelsById.get(model.modelId)

      if (
        !modelDefinition?.isLight ||
        model.lightEnabled === false ||
        !localLightIds.has(model.id)
      ) {
        continue
      }

      const height = model.height ?? modelDefinition.height
      const lightKind = modelDefinition.lightKind ?? 'point'
      const spreadDegrees =
        lightKind === 'spot'
          ? Math.max(5, Math.min(120, model.lightSpread ?? modelDefinition.lightSpread ?? 36))
          : 120
      const lightY = floor.elevation + height
      const maxLightY =
        floor.elevation +
        Math.max(0.2, floor.roomHeight - LOCAL_LIGHT_CEILING_CLEARANCE_METERS)
      const y = Math.min(lightY, maxLightY)

      slots.push({
        angle: (spreadDegrees * Math.PI) / 360,
        color: model.lightColor ?? modelDefinition.lightColor ?? modelDefinition.color,
        distance: Math.max(
          0.5,
          Math.min(
            30,
            model.lightDistance ??
              modelDefinition.lightDistance ??
              DEFAULT_LOCAL_LIGHT_DISTANCE,
          ),
        ),
        falloff: Math.max(
          0.5,
          Math.min(
            2,
            model.lightFalloff ??
              modelDefinition.lightFalloff ??
              DEFAULT_LOCAL_LIGHT_FALLOFF,
          ),
        ),
        id: model.id,
        kind: lightKind,
        penumbra: lightKind === 'spot' ? 0.45 : 0.75,
        position: [model.position.x, y, model.position.y],
        power:
          (model.lightPower ?? modelDefinition.lightPower ?? 450) *
          LOCAL_LIGHT_RENDER_POWER_SCALE,
        target: [model.position.x, y - 1, model.position.y],
      })
    }
  }

  return slots.slice(0, MAX_REALTIME_LOCAL_LIGHTS)
}

function PooledLocalSpotLight({
  castShadow,
  slot,
}: {
  castShadow: boolean
  slot: LocalLightSlot | null
}) {
  const lightRef = useRef<SpotLight>(null!)
  const targetRef = useRef<Object3D>(null!)
  const isActiveSlot = Boolean(slot)
  const position = slot?.position ?? ([0, -1000, 0] as [number, number, number])
  const target = slot?.target ?? ([0, -1001, 0] as [number, number, number])

  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [])

  return (
    <>
      <spotLight
        ref={lightRef}
        angle={slot?.angle ?? Math.PI / 3}
        castShadow={isActiveSlot && castShadow}
        color={slot?.color ?? '#ffffff'}
        decay={slot?.falloff ?? DEFAULT_LOCAL_LIGHT_FALLOFF}
        distance={slot?.distance ?? 1}
        penumbra={slot?.penumbra ?? 0.75}
        position={position}
        power={slot ? slot.power : 0}
        shadow-bias={-0.0008}
        shadow-camera-far={slot?.distance ?? 12}
        shadow-camera-near={0.25}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-normalBias={0.1}
        shadow-radius={2}
        visible={isActiveSlot}
      />
      <object3D ref={targetRef} position={target} />
    </>
  )
}

function PooledLocalPointLight({
  castShadow,
  slot,
}: {
  castShadow: boolean
  slot: LocalLightSlot | null
}) {
  const lightRef = useRef<PointLight>(null!)
  const isActiveSlot = Boolean(slot)
  const position = slot?.position ?? ([0, -1000, 0] as [number, number, number])

  return (
    <pointLight
      ref={lightRef}
      castShadow={isActiveSlot && castShadow}
      color={slot?.color ?? '#ffffff'}
      decay={slot?.falloff ?? DEFAULT_LOCAL_LIGHT_FALLOFF}
      distance={slot?.distance ?? 1}
      position={position}
      power={slot ? slot.power : 0}
      shadow-bias={-0.0008}
      shadow-camera-far={slot?.distance ?? 18}
      shadow-camera-near={0.25}
      shadow-mapSize-width={1024}
      shadow-mapSize-height={1024}
      shadow-normalBias={0.1}
      shadow-radius={2}
      visible={isActiveSlot}
    />
  )
}

function PooledWindowDaylightPortal({
  enabled,
  slot,
}: {
  enabled: boolean
  slot: WindowDaylightPortalSlot | null
}) {
  const lightRef = useRef<SpotLight>(null!)
  const targetRef = useRef<Object3D>(null!)
  const isActiveSlot = enabled && Boolean(slot)
  const position = slot?.position ?? ([0, -1000, 0] as [number, number, number])
  const target = slot?.target ?? ([0, -1001, 0] as [number, number, number])

  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [])

  return (
    <>
      <spotLight
        ref={lightRef}
        angle={slot?.angle ?? 0.5}
        castShadow={isActiveSlot}
        color={slot?.color ?? '#dcecff'}
        decay={1.4}
        distance={slot?.distance ?? WINDOW_DAYLIGHT_PORTAL_DISTANCE}
        penumbra={0.92}
        position={position}
        power={isActiveSlot && slot ? slot.power : 0}
        shadow-bias={-0.0004}
        shadow-camera-far={slot?.distance ?? WINDOW_DAYLIGHT_PORTAL_DISTANCE}
        shadow-camera-near={0.08}
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-normalBias={0.08}
        shadow-radius={3}
        visible={isActiveSlot}
      />
      <object3D ref={targetRef} position={target} />
    </>
  )
}

function WindowDaylightPortalPool({
  enabled,
  slots,
}: {
  enabled: boolean
  slots: WindowDaylightPortalSlot[]
}) {
  return (
    <>
      {Array.from({ length: MAX_WINDOW_DAYLIGHT_PORTALS }, (_, index) => (
        <PooledWindowDaylightPortal
          key={index}
          enabled={enabled}
          slot={slots[index] ?? null}
        />
      ))}
    </>
  )
}

function FixedLocalLightPool({
  activeFloorId,
  localLightIds,
  lightShadowsEnabled,
  shadowsEnabled,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  localLightIds: ReadonlySet<string>
  lightShadowsEnabled: boolean
  shadowsEnabled: boolean
  visibleRenderedFloors: RenderedFloorData[]
}) {
  const slots = useMemo(
    () =>
      getLocalLightSlots({
        activeFloorId,
        localLightIds,
        visibleRenderedFloors,
      }),
    [
      activeFloorId,
      localLightIds,
      visibleRenderedFloors,
    ],
  )
  const pointSlots = useMemo(
    () =>
      slots
        .filter((slot) => slot.kind === 'point')
        .slice(0, MAX_REALTIME_LOCAL_LIGHTS),
    [slots],
  )
  const spotSlots = useMemo(
    () =>
      slots
        .filter((slot) => slot.kind === 'spot')
        .slice(0, MAX_REALTIME_LOCAL_LIGHTS),
    [slots],
  )
  const pointPoolSlots = useMemo(
    () =>
      Array.from(
        { length: MAX_REALTIME_LOCAL_LIGHTS },
        (_, index) => pointSlots[index] ?? null,
      ),
    [pointSlots],
  )
  const spotPoolSlots = useMemo(
    () =>
      Array.from(
        { length: MAX_REALTIME_LOCAL_LIGHTS },
        (_, index) => spotSlots[index] ?? null,
      ),
    [spotSlots],
  )
  const castPooledShadows = shadowsEnabled && lightShadowsEnabled

  return (
    <>
      {pointPoolSlots.map((slot, index) => (
        <PooledLocalPointLight
          key={`point-${index}`}
          castShadow={castPooledShadows}
          slot={slot}
        />
      ))}
      {spotPoolSlots.map((slot, index) => (
        <PooledLocalSpotLight
          key={`spot-${index}`}
          castShadow={castPooledShadows}
          slot={slot}
        />
      ))}
    </>
  )
}

function FpsCounter({ onFpsChange }: { onFpsChange: (fps: number) => void }) {
  const frameCountRef = useRef(0)
  const elapsedRef = useRef(0)

  useFrame((_, delta) => {
    frameCountRef.current += 1
    elapsedRef.current += delta

    if (elapsedRef.current < 0.35) {
      return
    }

    onFpsChange(Math.round(frameCountRef.current / elapsedRef.current))
    frameCountRef.current = 0
    elapsedRef.current = 0
  })

  return null
}

function RendererStatsSampler({
  onStatsChange,
}: {
  onStatsChange: (stats: RendererStats) => void
}) {
  const { gl } = useThree()
  const elapsedRef = useRef(0)
  const frameCountRef = useRef(0)

  useFrame((_, delta) => {
    elapsedRef.current += delta
    frameCountRef.current += 1

    if (elapsedRef.current < 0.35) {
      return
    }

    const frameCount = Math.max(1, frameCountRef.current)
    onStatsChange({
      calls: Math.round(gl.info.render.calls / frameCount),
      geometries: gl.info.memory.geometries,
      programs: gl.info.programs?.length ?? 0,
      textures: gl.info.memory.textures,
      triangles: Math.round(gl.info.render.triangles / frameCount),
    })
    gl.info.reset()
    elapsedRef.current = 0
    frameCountRef.current = 0
  })

  return null
}

type ShadowMapWithRender = WebGLRenderer['shadowMap'] & {
  render: (lights: Light[], scene: Object3D, camera: Camera) => void
}

function SunShadowBlockerFilter() {
  const { camera, gl, scene } = useThree()

  useEffect(() => {
    const shadowMap = gl.shadowMap as ShadowMapWithRender
    const originalRender = shadowMap.render.bind(shadowMap)

    const patchedRender: ShadowMapWithRender['render'] = (
      lights,
      renderScene,
      renderCamera,
    ) => {
      const blockers: Object3D[] = []

      renderScene.traverse((object) => {
        if (object.userData[SUN_SHADOW_BLOCKER_USER_DATA]) {
          blockers.push(object)
        }
      })

      if (blockers.length === 0) {
        originalRender(lights, renderScene, renderCamera)
        return
      }

      const directionalLights: Light[] = []
      const otherLights: Light[] = []

      lights.forEach((light) => {
        if ('isDirectionalLight' in light && light.isDirectionalLight === true) {
          directionalLights.push(light)
        } else {
          otherLights.push(light)
        }
      })

      const originalVisibility = blockers.map((object) => object.visible)
      const setBlockerVisibility = (visible: boolean) => {
        blockers.forEach((object) => {
          object.visible = visible
        })
      }

      try {
        if (directionalLights.length > 0) {
          setBlockerVisibility(true)
          originalRender(directionalLights, renderScene, renderCamera)
        }

        if (otherLights.length > 0) {
          setBlockerVisibility(false)
          originalRender(otherLights, renderScene, renderCamera)
        }
      } finally {
        blockers.forEach((object, index) => {
          object.visible = originalVisibility[index]
        })
      }
    }

    shadowMap.render = patchedRender

    return () => {
      if (shadowMap.render === patchedRender) {
        shadowMap.render = originalRender
      }
    }
  }, [camera, gl, scene])

  return null
}

function ShaderWarmup({
  blocked,
  onPendingChange,
  warmupKey,
}: {
  blocked: boolean
  onPendingChange: (isPending: boolean) => void
  warmupKey: string
}) {
  const { camera, gl, scene } = useThree()

  useEffect(() => {
    if (blocked) {
      onPendingChange(false)
      return undefined
    }

    let cancelled = false
    onPendingChange(true)
    let compileTimeoutId: number | null = window.setTimeout(() => {
      compileTimeoutId = null
      recordEngineLog(
        'shader-warmup-start',
        `key ${warmupKey.length} chars`,
      )
      emitEngineActivity({
        message: 'Compiling scene shaders...',
        minimumVisibleMs: 1200,
      })

      const frustumStates: Array<{ frustumCulled: boolean; object: Object3D }> = []
      scene.traverse((object) => {
        frustumStates.push({
          frustumCulled: object.frustumCulled,
          object,
        })
        object.frustumCulled = false
      })

      gl.compileAsync(scene, camera)
        .catch(() => {
          gl.compile(scene, camera)
        })
        .finally(() => {
          frustumStates.forEach(({ frustumCulled, object }) => {
            object.frustumCulled = frustumCulled
          })

          if (!cancelled) {
            recordEngineLog('shader-warmup-complete')
            gl.render(scene, camera)
            window.requestAnimationFrame(() => {
              if (!cancelled) {
                onPendingChange(false)
                emitEngineActivity({
                  message: 'Scene shaders ready',
                  minimumVisibleMs: 700,
                })
              }
            })
          }
        })
    }, 120)

    return () => {
      cancelled = true

      if (compileTimeoutId !== null) {
        window.clearTimeout(compileTimeoutId)
      }

      onPendingChange(false)
    }
  }, [blocked, camera, gl, onPendingChange, scene, warmupKey])

  return null
}

function SceneAssetLoadTracker({
  onPendingChange,
}: {
  onPendingChange: (isPending: boolean) => void
}) {
  const { active } = useProgress()

  useEffect(() => {
    onPendingChange(active)
  }, [active, onPendingChange])

  return null
}

function CountrysideSkybox() {
  const { camera } = useThree()
  const groupRef = useRef<Object3D>(null)
  const texture = useMemo(() => createCountrysideSkyTexture(), [])

  useEffect(
    () => () => {
      texture?.dispose()
    },
    [texture],
  )

  useFrame(() => {
    groupRef.current?.position.copy(camera.position)
  })

  if (!texture) {
    return null
  }

  return (
    <group ref={groupRef} renderOrder={-1000}>
      <mesh>
        <sphereGeometry args={[120, 64, 32]} />
        <meshBasicMaterial
          map={texture}
          side={BackSide}
          fog={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

function LightGimbal({
  lightDirection,
  onLightDirectionChange,
}: {
  lightDirection: LightDirection
  onLightDirectionChange: (lightDirection: LightDirection) => void
}) {
  const controlRef = useRef<HTMLDivElement>(null)
  const handlePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = controlRef.current?.getBoundingClientRect()

    if (!bounds) {
      return
    }

    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    const dx = event.clientX - centerX
    const dy = event.clientY - centerY
    const radius = Math.max(bounds.width, bounds.height) / 2
    const distanceFromCenter = Math.min(1, Math.hypot(dx, dy) / radius)

    onLightDirectionChange({
      azimuth: Math.atan2(dy, dx),
      elevation:
        SUN_MIN_ELEVATION +
        (1 - distanceFromCenter) * (SUN_MAX_ELEVATION - SUN_MIN_ELEVATION),
    })
  }
  const normalizedElevation =
    (lightDirection.elevation - SUN_MIN_ELEVATION) /
    (SUN_MAX_ELEVATION - SUN_MIN_ELEVATION)
  const knobDistance =
    (1 - Math.min(1, Math.max(0, normalizedElevation))) *
    LIGHT_GIMBAL_KNOB_RADIUS
  const knobX = Math.cos(lightDirection.azimuth) * knobDistance
  const knobY = Math.sin(lightDirection.azimuth) * knobDistance

  return (
    <div className="light-gimbal" aria-label="Light direction control">
      <div
        ref={controlRef}
        className="light-gimbal-pad"
        role="slider"
        aria-label="Move light source"
        aria-valuetext={`${Math.round((lightDirection.azimuth * 180) / Math.PI)} degrees`}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          handlePointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            handlePointer(event)
          }
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
      >
        <span className="light-gimbal-ring" />
        <span
          className="light-gimbal-knob"
          style={{
            transform: `translate(${knobX}px, ${knobY}px)`,
          }}
        />
      </div>
    </div>
  )
}

function isTextEntryElement(target: EventTarget | null) {
  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }

  if (!(target instanceof HTMLInputElement)) {
    return false
  }

  return !['button', 'checkbox', 'radio', 'range'].includes(target.type)
}

function roomVisibilityStatesMatch(
  firstState: FloorVisibilityState | null,
  secondState: FloorVisibilityState,
) {
  if (
    !firstState ||
    firstState.floorId !== secondState.floorId ||
    firstState.currentRoomSignature !== secondState.currentRoomSignature ||
    firstState.visibleRoomSignatures.length !== secondState.visibleRoomSignatures.length
  ) {
    return false
  }

  return firstState.visibleRoomSignatures.every(
    (roomSignature, index) =>
      roomSignature === secondState.visibleRoomSignatures[index],
  )
}

function CameraRoomVisibilityTracker({
  activeFloor,
  enabled,
  onVisibilityChange,
  renderedFloor,
}: {
  activeFloor: FloorLevel | null
  enabled: boolean
  onVisibilityChange: (visibilityState: FloorVisibilityState) => void
  renderedFloor: RenderedFloorData | null
}) {
  const { camera } = useThree()
  const lastStateRef = useRef<FloorVisibilityState | null>(null)

  useFrame(() => {
    if (!enabled || !activeFloor || !renderedFloor) {
      return
    }

    const cameraPoint = {
      x: camera.position.x,
      y: camera.position.z,
    }
    const currentRoom = getRoomContainingPoint(renderedFloor.rooms, cameraPoint)
    const visibleRoomSignatures = [
      ...getVisibleRoomSignatures(
        currentRoom?.signature ?? null,
        renderedFloor.rooms,
        renderedFloor.roomPortals,
      ),
    ].sort()
    const nextState: FloorVisibilityState = {
      currentRoomSignature: currentRoom?.signature ?? null,
      floorId: activeFloor.id,
      visibleRoomSignatures,
    }

    if (!roomVisibilityStatesMatch(lastStateRef.current, nextState)) {
      lastStateRef.current = nextState
      onVisibilityChange(nextState)
    }
  })

  return null
}

function WalkCameraControls({
  enabled,
  headHeightEnabled,
  headHeightY,
  isTransformingRef,
  movementEnabled,
  navigationLocked,
  pickTargetsRef,
  selectedModelId,
}: {
  enabled: boolean
  headHeightEnabled: boolean
  headHeightY: number
  isTransformingRef: MutableRefObject<boolean>
  movementEnabled: boolean
  navigationLocked: boolean
  pickTargetsRef: MutableRefObject<PickTarget[]>
  selectedModelId: string | null
}) {
  const { camera, gl } = useThree()
  const keysRef = useRef(new Set<string>())
  const isShiftPressedRef = useRef(false)
  const isLookingRef = useRef(false)
  const ignoreNextLookMoveRef = useRef(false)
  const navigationModeRef = useRef<WalkNavigationMode>('look')
  const orbitTargetRef = useRef(new Vector3())
  const orbitOffsetRef = useRef(new Vector3())
  const orbitSphericalRef = useRef(new Spherical())
  const pendingLookGestureRef = useRef<LookGesture | null>(null)

  useEffect(() => {
    if (!enabled || navigationLocked) {
      keysRef.current.clear()
      isShiftPressedRef.current = false
      isLookingRef.current = false
      ignoreNextLookMoveRef.current = false
      pendingLookGestureRef.current = null
      return
    }

    if (!movementEnabled) {
      keysRef.current.clear()
      isShiftPressedRef.current = false
    }

    const focusCanvas = () => {
      gl.domElement.focus({ preventScroll: true })
    }
    const beginLooking = (ctrlKey: boolean) => {
      if (navigationLocked || isTransformingRef.current) {
        return
      }

      focusCanvas()
      navigationModeRef.current = 'look'

      if (ctrlKey && selectedModelId) {
        const pickTarget = pickTargetsRef.current.find(
          (target) =>
            target.kind === 'model' && target.modelId === selectedModelId,
        )

        if (pickTarget) {
          pickTarget.object.updateWorldMatrix(true, false)
          pickTarget.object.getWorldPosition(orbitTargetRef.current)
          navigationModeRef.current = 'orbit'
        }
      }

      if (document.pointerLockElement !== gl.domElement) {
        gl.domElement.requestPointerLock()
      }

      pendingLookGestureRef.current = null
      isLookingRef.current = true
      ignoreNextLookMoveRef.current = true
    }
    const stopLooking = () => {
      if (document.pointerLockElement === gl.domElement) {
        document.exitPointerLock()
      }

      isLookingRef.current = false
      ignoreNextLookMoveRef.current = false
      navigationModeRef.current = 'look'
      pendingLookGestureRef.current = null
    }
    const isAltKey = (event: KeyboardEvent) =>
      event.key === 'Alt' ||
      event.code === 'AltLeft' ||
      event.code === 'AltRight'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!movementEnabled) {
        return
      }

      if (isTextEntryElement(event.target)) {
        return
      }

      if (isAltKey(event)) {
        event.preventDefault()

        if (!event.repeat) {
          beginLooking(event.ctrlKey)
        }

        return
      }

      if (event.key === 'Shift' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        event.preventDefault()
        isShiftPressedRef.current = true
        return
      }

      if (['KeyA', 'KeyD', 'KeyS', 'KeyW'].includes(event.code)) {
        event.preventDefault()
        keysRef.current.add(event.code)
        isShiftPressedRef.current = event.shiftKey || isShiftPressedRef.current
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!movementEnabled) {
        return
      }

      keysRef.current.delete(event.code)

      if (isAltKey(event)) {
        event.preventDefault()
        stopLooking()
        return
      }

      if (event.key === 'Shift' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        isShiftPressedRef.current = false
      }
    }
    const isLookPointerButton = (event: globalThis.PointerEvent) =>
      event.button === 2
    const startLooking = (event: globalThis.PointerEvent) => {
      if (
        !isLookPointerButton(event) ||
        navigationLocked ||
        isTransformingRef.current
      ) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      beginLooking(event.ctrlKey)
    }
    const maybeLockForLook = (event: globalThis.PointerEvent) => {
      const pendingLookGesture = pendingLookGestureRef.current

      if (
        !pendingLookGesture ||
        pendingLookGesture.pointerId !== event.pointerId ||
        navigationLocked ||
        isTransformingRef.current ||
        document.pointerLockElement === gl.domElement
      ) {
        return
      }

      if (
        event.clientX === pendingLookGesture.x &&
        event.clientY === pendingLookGesture.y
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      gl.domElement.requestPointerLock()
      pendingLookGestureRef.current = null
      isLookingRef.current = true
      ignoreNextLookMoveRef.current = true
    }
    const updateLooking = (event: MouseEvent) => {
      if (!isLookingRef.current || document.pointerLockElement !== gl.domElement) {
        return
      }

      if (ignoreNextLookMoveRef.current) {
        ignoreNextLookMoveRef.current = false
        return
      }

      if (navigationModeRef.current === 'orbit') {
        orbitOffsetRef.current.subVectors(camera.position, orbitTargetRef.current)
        orbitSphericalRef.current.setFromVector3(orbitOffsetRef.current)
        orbitSphericalRef.current.theta -= event.movementX * WALK_LOOK_SENSITIVITY
        orbitSphericalRef.current.phi = Math.max(
          0.05,
          Math.min(
            Math.PI - 0.05,
            orbitSphericalRef.current.phi -
              event.movementY * WALK_LOOK_SENSITIVITY,
          ),
        )
        orbitOffsetRef.current.setFromSpherical(orbitSphericalRef.current)
        camera.position.copy(orbitTargetRef.current).add(orbitOffsetRef.current)
        camera.lookAt(orbitTargetRef.current)
        return
      }

      camera.rotation.order = 'YXZ'
      camera.rotation.y -= event.movementX * WALK_LOOK_SENSITIVITY
      camera.rotation.x = Math.max(
        -WALK_MAX_PITCH_RADIANS,
        Math.min(
          WALK_MAX_PITCH_RADIANS,
          camera.rotation.x - event.movementY * WALK_LOOK_SENSITIVITY,
        ),
      )
      camera.rotation.z = 0
    }
    const handlePointerLockChange = () => {
      const isLocked = document.pointerLockElement === gl.domElement

      isLookingRef.current = isLocked
      ignoreNextLookMoveRef.current = isLocked
      focusCanvas()

      if (!isLocked) {
        isLookingRef.current = false
        ignoreNextLookMoveRef.current = false
      }
    }
    const handleBlur = () => {
      keysRef.current.clear()
      isShiftPressedRef.current = false
      stopLooking()
    }
    const handleMouseUp = () => {
      pendingLookGestureRef.current = null
      stopLooking()
    }
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }
    const handlePointerPresence = () => {
      if (!isTextEntryElement(document.activeElement)) {
        focusCanvas()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('mousemove', updateLooking)
    window.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    gl.domElement.addEventListener('pointerdown', startLooking, true)
    gl.domElement.addEventListener('pointerenter', handlePointerPresence)
    gl.domElement.addEventListener('pointermove', maybeLockForLook, true)
    gl.domElement.addEventListener('pointermove', handlePointerPresence)
    gl.domElement.addEventListener('contextmenu', handleContextMenu)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('mousemove', updateLooking)
      window.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      gl.domElement.removeEventListener('pointerdown', startLooking, true)
      gl.domElement.removeEventListener('pointerenter', handlePointerPresence)
      gl.domElement.removeEventListener('pointermove', maybeLockForLook, true)
      gl.domElement.removeEventListener('pointermove', handlePointerPresence)
      gl.domElement.removeEventListener('contextmenu', handleContextMenu)
      stopLooking()
    }
  }, [
    camera,
    enabled,
    gl.domElement,
    isTransformingRef,
    movementEnabled,
    navigationLocked,
    pickTargetsRef,
    selectedModelId,
  ])

  useFrame((_, delta) => {
    if (
      !enabled ||
      !movementEnabled ||
      navigationLocked ||
      keysRef.current.size === 0
    ) {
      return
    }

    const forward = new Vector3()
    const right = new Vector3()
    const movement = new Vector3()

    camera.getWorldDirection(forward)
    right.setFromMatrixColumn(camera.matrix, 0).normalize()

    if (headHeightEnabled) {
      forward.y = 0
      right.y = 0

      if (forward.lengthSq() > 0) {
        forward.normalize()
      }

      if (right.lengthSq() > 0) {
        right.normalize()
      }
    }

    if (keysRef.current.has('KeyW')) {
      movement.add(forward)
    }

    if (keysRef.current.has('KeyS')) {
      movement.sub(forward)
    }

    if (keysRef.current.has('KeyD')) {
      movement.add(right)
    }

    if (keysRef.current.has('KeyA')) {
      movement.sub(right)
    }

    if (movement.lengthSq() > 0) {
      const speedMultiplier = isShiftPressedRef.current
        ? WALK_CAMERA_SHIFT_MULTIPLIER
        : 1

      camera.position.add(
        movement
          .normalize()
          .multiplyScalar(WALK_CAMERA_SPEED * speedMultiplier * delta),
      )
    }

    if (headHeightEnabled) {
      camera.position.y = headHeightY
    }
  })

  return null
}

type PickRenderableObject = Object3D & {
  geometry?: BufferGeometry
  isMesh?: boolean
  material?: Material | Material[] | null
}

function getPickTargetPriority(target: PickTarget) {
  if (target.kind === 'model') {
    return 4
  }

  if (target.kind === 'material-groups') {
    return 2
  }

  if (target.kind === 'room-surface-area') {
    return 0
  }

  if (target.surface.type === 'floor-slab-edge') {
    return 3
  }

  if (
    target.surface.type === 'wall-face' ||
    target.surface.type === 'wall-surface-fragment'
  ) {
    return 2
  }

  return 1
}

function getSurfacePickKey(surface: SelectableSurface) {
  if (surface.type === 'wall-face') {
    return `${surface.floorId}:wall:${surface.wallId}:${surface.side}`
  }

  if (surface.type === 'wall-surface-fragment') {
    return `${surface.floorId}:wall-fragment:${surface.fragmentId}`
  }

  if (surface.type === 'room-floor' || surface.type === 'ceiling') {
    return `${surface.floorId}:${surface.type}:${surface.roomSignature}`
  }

  return `${surface.floorId}:${surface.type}`
}

function getPickMaterialSide(target: PickTarget) {
  if (target.kind === 'model') {
    return DoubleSide
  }

  if (target.kind === 'material-groups') {
    return DoubleSide
  }

  if (target.kind === 'room-surface-area') {
    return target.pickSide
  }

  if (target.kind === 'surface' && target.pickSide !== undefined) {
    return target.pickSide
  }

  return FrontSide
}

function collectRenderableObjects(object: Object3D) {
  const renderables: PickRenderableObject[] = []

  object.traverse((candidateObject) => {
    const renderableObject = candidateObject as PickRenderableObject

    if (renderableObject.isMesh && renderableObject.material) {
      renderables.push(renderableObject)
    }
  })

  return renderables
}

function materialIsVisibleInViewport(material: Material | null | undefined) {
  if (!material || !material.visible) {
    return false
  }

  if ('opacity' in material && material.opacity <= 0.001) {
    return false
  }

  return true
}

function renderableIsVisibleInViewport(object: PickRenderableObject) {
  const materials = Array.isArray(object.material)
    ? object.material
    : object.material
      ? [object.material]
      : []

  return materials.some(materialIsVisibleInViewport)
}

function objectIsVisibleInHierarchy(object: Object3D) {
  let currentObject: Object3D | null = object

  while (currentObject) {
    if (!currentObject.visible) {
      return false
    }

    currentObject = currentObject.parent
  }

  return true
}

function createPickMaterial(colorId: number, side: Side) {
  return new RawShaderMaterial({
    depthTest: true,
    depthWrite: true,
    fragmentShader: `
      precision highp float;
      uniform vec3 pickColor;
      void main() {
        gl_FragColor = vec4(pickColor, 1.0);
      }
    `,
    side,
    toneMapped: false,
    uniforms: {
      pickColor: {
        value: new Vector3(
          ((colorId >> 16) & 255) / 255,
          ((colorId >> 8) & 255) / 255,
          (colorId & 255) / 255,
        ),
      },
    },
    vertexShader: `
      precision highp float;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      attribute vec3 position;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
  })
}

function getDebugPickColorId(colorId: number) {
  if (colorId === 0) {
    return 0
  }

  const color = new Color().setHSL(((colorId * 137) % 360) / 360, 0.78, 0.55)

  return (
    (Math.round(color.r * 255) << 16) +
    (Math.round(color.g * 255) << 8) +
    Math.round(color.b * 255)
  )
}

function downloadPngFile(dataUrl: string, filename: string) {
  const link = document.createElement('a')

  link.href = dataUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  recordEngineLog('color-pick-buffer-download-requested', filename)
}

type PickRenderCamera = Camera & {
  clearViewOffset?: () => void
  setViewOffset?: (
    fullWidth: number,
    fullHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void
}

function withColorPickRender<T>({
  camera,
  debugColors = false,
  gl,
  pickTarget,
  scene,
  read,
}: {
  camera: PickRenderCamera
  debugColors?: boolean
  gl: WebGLRenderer
  pickTarget: MutableRefObject<PickTarget[]>
  read: (context: {
    renderTarget: WebGLRenderTarget
    targetByColorId: Map<number, PickTarget>
    width: number
    height: number
  }) => T
  scene: Object3D
}) {
  const targets = pickTarget.current.slice(0, 0xfffffe)

  if (targets.length === 0) {
    return null
  }

  const drawingBufferSize = new Vector2()
  gl.getDrawingBufferSize(drawingBufferSize)
  const width = Math.max(1, Math.floor(drawingBufferSize.x))
  const height = Math.max(1, Math.floor(drawingBufferSize.y))
  const renderables = new Set<PickRenderableObject>()
  const originalStates: Array<{
    material?: Material | Material[] | null
    materialVisible: boolean
    object: PickRenderableObject
    renderOrder: number
    visible: boolean
    visibleInHierarchy: boolean
  }> = []
  const originalStatesByObject = new Map<
    PickRenderableObject,
    { materialVisible: boolean; visible: boolean; visibleInHierarchy: boolean }
  >()
  const targetByColorId = new Map<number, PickTarget>()
  const pickMaterials: Material[] = []
  const renderTarget = new WebGLRenderTarget(
    width,
    height,
    {
      depthBuffer: true,
      format: RGBAFormat,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
      samples: 0,
      stencilBuffer: false,
      type: UnsignedByteType,
    },
  )
  renderTarget.texture.colorSpace = NoColorSpace
  const previousRenderTarget = gl.getRenderTarget()
  const previousClearColor = new Color()
  const previousClearAlpha = gl.getClearAlpha()
  const previousScissorTest = gl.getScissorTest()
  const previousViewport = new Vector4()
  const previousScissor = new Vector4()

  gl.getClearColor(previousClearColor)
  gl.getViewport(previousViewport)
  gl.getScissor(previousScissor)

  scene.traverse((object) => {
    const renderableObject = object as PickRenderableObject

    if (!renderableObject.isMesh || !renderableObject.material) {
      return
    }

    renderables.add(renderableObject)
  })

  renderables.forEach((object) => {
    originalStates.push({
      material: object.material,
      materialVisible: renderableIsVisibleInViewport(object),
      object,
      renderOrder: object.renderOrder,
      visible: object.visible,
      visibleInHierarchy: objectIsVisibleInHierarchy(object),
    })
    object.visible = false
  })
  originalStates.forEach((state) => {
    originalStatesByObject.set(state.object, {
      materialVisible: state.materialVisible,
      visible: state.visible,
      visibleInHierarchy: state.visibleInHierarchy,
    })
  })

  let nextColorId = 1
  const surfacePickMaterials = new Map<string, Material>()
  const allocatePickMaterial = (target: PickTarget, side: Side) => {
    const colorId = nextColorId
    nextColorId += 1

    if (colorId > 0xfffffe) {
      return null
    }

    const material = createPickMaterial(
      debugColors ? getDebugPickColorId(colorId) : colorId,
      side,
    )

    pickMaterials.push(material)
    targetByColorId.set(colorId, target)

    return material
  }
  const getSurfacePickMaterial = (surfaceTarget: PickTarget, side: Side) => {
    if (surfaceTarget.kind !== 'surface') {
      return allocatePickMaterial(surfaceTarget, side)
    }

    const key = getSurfacePickKey(surfaceTarget.surface)
    const existingMaterial = surfacePickMaterials.get(key)

    if (existingMaterial) {
      return existingMaterial
    }

    const material = allocatePickMaterial(surfaceTarget, side)

    if (material) {
      surfacePickMaterials.set(key, material)
    }

    return material
  }
  const missMaterial = createPickMaterial(0, DoubleSide)

  pickMaterials.push(missMaterial)

  targets.forEach((target) => {
    const renderOrder = getPickTargetPriority(target) * 100

    collectRenderableObjects(target.object).forEach((object) => {
      const originalState = originalStatesByObject.get(object)
      const shouldRender =
        originalState?.visible &&
        originalState.visibleInHierarchy &&
        (target.kind === 'surface' ||
          target.kind === 'room-surface-area' ||
          (target.kind === 'material-groups' && target.pickOnly) ||
          originalState.materialVisible)

      object.visible = Boolean(shouldRender)
      object.renderOrder = renderOrder

      if (!shouldRender) {
        return
      }

      if (target.kind !== 'material-groups') {
        const material = allocatePickMaterial(target, getPickMaterialSide(target))

        if (material) {
          object.material = material
        }

        return
      }

      const groups = object.geometry?.groups ?? []
      const materialCount = Math.max(
        1,
        ...groups.map((group) => group.materialIndex ?? 0),
      ) + 1
      const groupMaterials = Array.from({ length: materialCount }, (_, index) => {
        const surface = target.groupTargets.get(index)

        if (!surface) {
          return missMaterial
        }

        return getSurfacePickMaterial(
          {
            blocksCollision: false,
            floorId: target.floorId,
            kind: 'surface',
            object: target.object,
            surface,
          },
          getPickMaterialSide(target),
        ) ?? missMaterial
      })

      object.material = groupMaterials
    })
  })

  try {
    gl.setRenderTarget(renderTarget)
    gl.setScissorTest(false)
    gl.setViewport(0, 0, width, height)
    gl.setClearColor(0x000000, 0)
    gl.clear()
    gl.render(scene, camera)
    return read({
      height,
      renderTarget,
      targetByColorId,
      width,
    })
  } finally {
    gl.setRenderTarget(previousRenderTarget)
    gl.setClearColor(previousClearColor, previousClearAlpha)
    gl.setScissorTest(previousScissorTest)
    gl.setViewport(previousViewport)
    gl.setScissor(previousScissor)
    originalStates.forEach(({ material, object, renderOrder, visible }) => {
      object.material = material
      object.renderOrder = renderOrder
      object.visible = visible
    })
    pickMaterials.forEach((material) => material.dispose())
    renderTarget.dispose()
  }
}

function performColorPick({
  camera,
  clientX,
  clientY,
  element,
  gl,
  pickTarget,
  scene,
}: {
  camera: PickRenderCamera
  clientX: number
  clientY: number
  element: HTMLCanvasElement
  gl: WebGLRenderer
  pickTarget: MutableRefObject<PickTarget[]>
  scene: Object3D
}) {
  const bounds = element.getBoundingClientRect()

  if (bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const pickResult = withColorPickRender({
    camera,
    gl,
    pickTarget,
    scene,
    read: ({ height, renderTarget, targetByColorId, width }) => {
      const pixelX = Math.max(
        0,
        Math.min(
          width - 1,
          Math.floor(((clientX - bounds.left) / bounds.width) * width),
        ),
      )
      const pixelY = Math.max(
        0,
        Math.min(
          height - 1,
          Math.floor(((bounds.bottom - clientY) / bounds.height) * height),
        ),
      )
      const pixel = new Uint8Array(4)

      gl.readRenderTargetPixels(renderTarget, pixelX, pixelY, 1, 1, pixel)

      const colorId = pixel[0] * 65536 + pixel[1] * 256 + pixel[2]

      return {
        colorId,
        pixel,
        target: targetByColorId.get(colorId) ?? null,
      }
    },
  })

  if (!pickResult) {
    return null
  }

  const { colorId, pixel, target } = pickResult

  recordEngineLog(
    'color-pick',
    target
      ? `${colorId} -> ${target.kind}${
          target.kind === 'surface'
            ? target.surface.type === 'wall-face' ||
              target.surface.type === 'wall-surface-fragment'
              ? `:${target.surface.type}:${target.surface.wallId}:${target.surface.side}`
              : `:${target.surface.type}`
            : target.kind === 'model'
              ? `:${target.modelId}`
              : ''
        }`
      : `miss color ${colorId} rgb(${pixel[0]},${pixel[1]},${pixel[2]}) targets ${pickTarget.current.length}`,
  )

  return target
}

function resolveRoomSurfaceAreaPick({
  camera,
  clientX,
  clientY,
  element,
  target,
}: {
  camera: PickRenderCamera
  clientX: number
  clientY: number
  element: HTMLCanvasElement
  target: Extract<PickTarget, { kind: 'room-surface-area' }>
}): PickTarget | null {
  const bounds = element.getBoundingClientRect()

  if (bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const pointer = new Vector2(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    -(((clientY - bounds.top) / bounds.height) * 2 - 1),
  )
  const raycaster = new Raycaster()

  raycaster.setFromCamera(pointer, camera)

  const [intersection] = raycaster.intersectObject(target.object, false)

  if (!intersection) {
    return null
  }

  const areaCenter = new Vector3()
  target.object.getWorldPosition(areaCenter)
  const planPoint = {
    x: intersection.point.x,
    y: areaCenter.z * 2 - intersection.point.z,
  }
  const room = getRoomContainingPoint(target.rooms, {
    x: planPoint.x,
    y: planPoint.y,
  })

  if (!room) {
    recordEngineLog(
      'room-surface-pick',
      `miss:${target.surfaceType}:${planPoint.x.toFixed(2)},${planPoint.y.toFixed(2)}`,
    )
    return null
  }

  return {
    blocksCollision: false,
    floorId: target.floorId,
    kind: 'surface',
    object: target.object,
    pickSide: target.pickSide,
    surface: {
      floorId: target.floorId,
      roomSignature: room.signature,
      type: target.surfaceType,
    },
  }
}

function performGeometryPickFallback({
  camera,
  clientX,
  clientY,
  element,
  pickTarget,
}: {
  camera: PickRenderCamera
  clientX: number
  clientY: number
  element: HTMLCanvasElement
  pickTarget: MutableRefObject<PickTarget[]>
}) {
  const bounds = element.getBoundingClientRect()

  if (bounds.width <= 0 || bounds.height <= 0) {
    return null
  }

  const pointer = new Vector2(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    -(((clientY - bounds.top) / bounds.height) * 2 - 1),
  )
  const raycaster = new Raycaster()

  raycaster.setFromCamera(pointer, camera)
  const intersectionMatchesPickSide = (
    intersection: ReturnType<Raycaster['intersectObject']>[number],
    side: Side,
  ) => {
    if (side === DoubleSide || !intersection.face) {
      return true
    }

    const normalMatrix = new Matrix3().getNormalMatrix(
      intersection.object.matrixWorld,
    )
    const worldNormal = intersection.face.normal
      .clone()
      .applyMatrix3(normalMatrix)
      .normalize()
    const facing = raycaster.ray.direction.dot(worldNormal)

    return side === FrontSide ? facing < 0 : facing > 0
  }

  const candidates = pickTarget.current
    .flatMap((target) =>
      raycaster
        .intersectObject(target.object, true)
        .filter((intersection) =>
          intersectionMatchesPickSide(
            intersection,
            getPickMaterialSide(target),
          ),
        )
        .map((intersection) => ({
          intersection,
          target,
        })),
    )
    .sort((first, second) => {
      const distanceDelta = first.intersection.distance - second.intersection.distance

      if (Math.abs(distanceDelta) > 0.0001) {
        return distanceDelta
      }

      return getPickTargetPriority(second.target) - getPickTargetPriority(first.target)
    })

  for (const candidate of candidates) {
    const { target } = candidate

    if (target.kind === 'model' || target.kind === 'surface') {
      recordEngineLog(
        'geometry-pick-fallback',
        target.kind === 'model'
          ? `model:${target.modelId}`
          : `surface:${target.surface.type}`,
      )
      return target
    }

    if (target.kind === 'room-surface-area') {
      const areaCenter = new Vector3()
      target.object.getWorldPosition(areaCenter)
      const room = getRoomContainingPoint(target.rooms, {
        x: candidate.intersection.point.x,
        y: areaCenter.z * 2 - candidate.intersection.point.z,
      })

      if (!room) {
        continue
      }

      recordEngineLog(
        'geometry-pick-fallback',
        `surface:${target.surfaceType}:${room.signature}`,
      )
      return {
        blocksCollision: false,
        floorId: target.floorId,
        kind: 'surface',
        object: target.object,
        pickSide: target.pickSide,
        surface: {
          floorId: target.floorId,
          roomSignature: room.signature,
          type: target.surfaceType,
        },
      } satisfies PickTarget
    }

    const materialIndex = candidate.intersection.face?.materialIndex ?? -1
    const surface = target.groupTargets.get(materialIndex)

    if (surface) {
      recordEngineLog(
        'geometry-pick-fallback',
        surface.type === 'wall-face'
          ? `surface:${surface.type}:${surface.wallId}:${surface.side}:mat${materialIndex}`
          : surface.type === 'wall-surface-fragment'
            ? `surface:${surface.type}:${surface.wallId}:${surface.side}:${surface.fragmentId}:mat${materialIndex}`
            : `surface:${surface.type}`,
      )
      return {
        blocksCollision: false,
        floorId: target.floorId,
        kind: 'surface',
        object: target.object,
        surface,
      } satisfies PickTarget
    }
  }

  recordEngineLog(
    'geometry-pick-fallback',
    `miss targets ${pickTarget.current.length}`,
  )

  return null
}

function downloadColorPickBuffer({
  camera,
  gl,
  onImage,
  pickTarget,
  scene,
}: {
  camera: PickRenderCamera
  gl: WebGLRenderer
  onImage?: (image: { dataUrl: string; filename: string }) => void
  pickTarget: MutableRefObject<PickTarget[]>
  scene: Object3D
}) {
  try {
    const exported = withColorPickRender({
      camera,
      debugColors: true,
      gl,
      pickTarget,
      scene,
      read: ({ height, renderTarget, width }) => {
        const pixels = new Uint8Array(width * height * 4)
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        if (!context) {
          return false
        }

        gl.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels)

        canvas.width = width
        canvas.height = height

        const imageData = context.createImageData(width, height)

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const sourceIndex = ((height - 1 - y) * width + x) * 4
            const targetIndex = (y * width + x) * 4

            imageData.data[targetIndex] = pixels[sourceIndex]
            imageData.data[targetIndex + 1] = pixels[sourceIndex + 1]
            imageData.data[targetIndex + 2] = pixels[sourceIndex + 2]
            imageData.data[targetIndex + 3] = 255
          }
        }

        context.putImageData(imageData, 0, 0)

        const dataUrl = canvas.toDataURL('image/png')
        const filename = `house-designer-pick-buffer-${Date.now()}.png`

        window.houseDesignerLastPickPng = dataUrl
        onImage?.({ dataUrl, filename })
        downloadPngFile(dataUrl, filename)

        recordEngineLog(
          'color-pick-buffer-exported',
          `${width}x${height}, ${pickTarget.current.length} targets`,
        )

        return true
      },
    })

    if (!exported) {
      recordEngineLog('color-pick-buffer-export-failed')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    console.error('[HouseDesigner] Pick PNG export failed', error)
    recordEngineLog('color-pick-buffer-export-failed', message)
  }
}

function ModelPicker({
  active,
  isTransformingRef,
  onClearSelection,
  onSelectModel,
  onSelectSurface,
  pickTargetsRef,
}: {
  active: boolean
  isTransformingRef: MutableRefObject<boolean>
  onClearSelection: () => void
  onSelectModel: (modelId: string, floorId: string) => void
  onSelectSurface: (surface: SelectableSurface) => void
  pickTargetsRef: MutableRefObject<PickTarget[]>
}) {
  const { camera, gl, scene } = useThree()
  const pickGestureRef = useRef<PickGesture | null>(null)

  useEffect(() => {
    const element = gl.domElement

    const handlePointerDown = (event: PointerEvent) => {
      if (
        !active ||
        event.button !== 0 ||
        event.altKey ||
        isTransformingRef.current
      ) {
        return
      }

      pickGestureRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const pickGesture = pickGestureRef.current

      pickGestureRef.current = null

      if (
        !active ||
        isTransformingRef.current ||
        !pickGesture ||
        pickGesture.pointerId !== event.pointerId
      ) {
        return
      }

      const pointerDeltaX = event.clientX - pickGesture.x
      const pointerDeltaY = event.clientY - pickGesture.y

      if (
        Math.abs(pointerDeltaX) > PICK_CLICK_TOLERANCE_PIXELS ||
        Math.abs(pointerDeltaY) > PICK_CLICK_TOLERANCE_PIXELS
      ) {
        recordEngineLog(
          'pick-skipped',
          `pointer moved ${pointerDeltaX},${pointerDeltaY}`,
        )
        return
      }

      const rawPickedTarget =
        performColorPick({
          camera,
          clientX: pickGesture.x,
          clientY: pickGesture.y,
          element,
          gl,
          pickTarget: pickTargetsRef,
          scene,
        }) ??
        performGeometryPickFallback({
        camera,
        clientX: pickGesture.x,
        clientY: pickGesture.y,
        element,
        pickTarget: pickTargetsRef,
      })
      const pickedTarget =
        rawPickedTarget?.kind === 'room-surface-area'
          ? resolveRoomSurfaceAreaPick({
              camera,
              clientX: pickGesture.x,
              clientY: pickGesture.y,
              element,
              target: rawPickedTarget,
            })
          : rawPickedTarget

      if (!pickedTarget) {
        emitEngineActivity({
          message: 'Pick missed',
          minimumVisibleMs: 900,
        })
        onClearSelection()
        return
      }

      if (pickedTarget.kind === 'surface') {
        emitEngineActivity({
          message:
            pickedTarget.surface.type === 'wall-face' ||
            pickedTarget.surface.type === 'wall-surface-fragment'
              ? `Picked wall ${pickedTarget.surface.side === 1 ? 'side A' : 'side B'}`
              : `Picked ${pickedTarget.surface.type}`,
          minimumVisibleMs: 900,
        })
        onSelectSurface(pickedTarget.surface)
      } else if (pickedTarget.kind === 'model') {
        emitEngineActivity({
          message: 'Picked object',
          minimumVisibleMs: 900,
        })
        onSelectModel(pickedTarget.modelId, pickedTarget.floorId)
      } else {
        emitEngineActivity({
          message: 'Pick missed',
          minimumVisibleMs: 900,
        })
        onClearSelection()
      }
    }

    element.addEventListener('pointerdown', handlePointerDown, true)
    element.addEventListener('pointerup', handlePointerUp, true)

    return () => {
      element.removeEventListener('pointerdown', handlePointerDown, true)
      element.removeEventListener('pointerup', handlePointerUp, true)
    }
  }, [
    camera,
    gl.domElement,
    gl,
    scene,
    active,
    isTransformingRef,
    onClearSelection,
    onSelectModel,
    onSelectSurface,
    pickTargetsRef,
  ])

  return null
}

function PickBufferExporter({
  onImage,
  onReady,
  pickTargetsRef,
}: {
  onImage: (image: { dataUrl: string; filename: string }) => void
  onReady: (capture: () => void) => void
  pickTargetsRef: MutableRefObject<PickTarget[]>
}) {
  const { camera, gl, scene } = useThree()
  const capture = useCallback(() => {
    downloadColorPickBuffer({
      camera,
      gl,
      onImage,
      pickTarget: pickTargetsRef,
      scene,
    })
  }, [camera, gl, onImage, pickTargetsRef, scene])

  useEffect(() => {
    onReady(capture)

    return () => onReady(() => undefined)
  }, [capture, onReady])

  return null
}

export function ThreeDView({
  activeFloorId,
  floors,
  modelAssetVersion,
  onClearSelection,
  onSelectModel,
  onSelectSurface,
  onUpdateModel,
  selectedModelId,
  selectedSurface,
  selectedWallId,
  sceneRevision,
  showAllFloors,
  surfaceAssignments,
}: ThreeDViewProps) {
  const [isRenderMenuOpen, setIsRenderMenuOpen] = useState(false)
  const [transformMode, setTransformMode] = useState<TransformMode>('translate')
  const [pickBufferDownload, setPickBufferDownload] = useState<{
    dataUrl: string
    filename: string
  } | null>(null)
  const pickBufferCaptureRef = useRef<(() => void) | null>(null)
  const [isTransformingModel, setIsTransformingModel] = useState(false)
  const engineStatusRef = useRef<HTMLDivElement>(null)
  const engineStatusTimerRef = useRef<number | null>(null)
  const latestEngineActivityIdRef = useRef(0)
  const lastEngineActivityRef = useRef({
    message: 'startup',
    time: 0,
  })
  const latestRendererStatsRef = useRef<RendererStats | null>(null)
  const lastLoggedRendererStatsRef = useRef<RendererStats | null>(null)
  const previousShaderProgramCountRef = useRef<number | null>(null)
  const renderOptionFrameIdsRef = useRef<number[]>([])
  const stallSnapshotRef = useRef('')
  const fpsIndicatorRef = useRef<HTMLDivElement>(null)
  const shaderIndicatorRef = useRef<HTMLDivElement>(null)
  const callsIndicatorRef = useRef<HTMLDivElement>(null)
  const resourcesIndicatorRef = useRef<HTMLDivElement>(null)
  const trianglesIndicatorRef = useRef<HTMLDivElement>(null)
  const isTransformingModelRef = useRef(false)
  const pickTargetsRef = useRef<PickTarget[]>([])
  const [aspectRatioMode, setAspectRatioMode] =
    useState<AspectRatioMode>('normal')
  const [headHeightEnabled, setHeadHeightEnabled] = useState(false)
  const [localLightLimit, setLocalLightLimit] = useState(FALLBACK_REALTIME_LOCAL_LIGHTS)
  const [localLightIds, setLocalLightIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [isShaderWarmupPending, setIsShaderWarmupPending] = useState(true)
  const [isTexturePreloadPending, setIsTexturePreloadPending] = useState(false)
  const [isAssetLoadPending, setIsAssetLoadPending] = useState(false)
  const [lightDirection, setLightDirection] = useState<LightDirection>({
    azimuth: Math.atan2(6, 4),
    elevation: 0.78,
  })
  const [, setRoomVisibilityState] =
    useState<FloorVisibilityState | null>(null)
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({
    ambientOcclusion: false,
    ambientOcclusionIntensity: 0.85,
    ambientTerm: 0.32,
    daylight: true,
    floorSlabs: true,
    groundPlane: true,
    lightMarkers: false,
    lightShadows: false,
    lights: true,
    nightFill: true,
    occlusionCulling: true,
    referenceFloors: false,
    shadows: true,
    skybox: false,
    windowDaylight: true,
    wireframe: false,
  })
  const sceneBounds = useMemo(() => getSceneBounds(floors), [floors])
  const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? null
  const cameraFov = getCameraFov(aspectRatioMode)
  const headHeightY = (activeFloor?.elevation ?? 0) + WALK_HEAD_HEIGHT_METERS
  const floorsByElevation = useMemo(
    () =>
      [...floors].sort(
        (firstFloor, secondFloor) => firstFloor.elevation - secondFloor.elevation,
      ),
    [floors],
  )
  const floorBelowActive = activeFloor
    ? floorsByElevation
        .filter((floor) => floor.elevation < activeFloor.elevation)
        .at(-1) ?? null
    : null
  const renderedFloors = useMemo<RenderedFloorData[]>(
    () =>
      floors.map((floor) => {
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
        const externalWallUnionWalls = getExternalWallUnionWalls(
          topologyWalls,
          surfaceAssignments,
        )
        const externalWallUnionFootprints = unionMiteredWallFootprints(
          externalWallUnionWalls,
          topologyWalls,
        )
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

        return {
          externalWallUnionFootprints,
          externalWallUnionWallIds: externalWallUnionWalls.map((wall) => wall.id),
          externalWallUnionWalls,
          floor,
          geometryContextWalls: topologyWalls,
          internalWallFootprintGroups,
          roomPortals,
          renderedWalls,
          rooms: topology.rooms,
          wallBodyOccluders,
        }
      }),
    [floors, surfaceAssignments],
  )
  const renderedFloorsById = useMemo(
    () =>
      new Map(
        renderedFloors.map((renderedFloor) => [
          renderedFloor.floor.id,
          renderedFloor,
        ]),
      ),
    [renderedFloors],
  )
  const activeRenderedFloor = renderedFloorsById.get(activeFloorId) ?? null
  const objectFrustumCullingEnabled = renderOptions.occlusionCulling
  const occlusionCullingEnabled = false
  const visibleRenderedFloors = useMemo(
    () =>
      showAllFloors
        ? renderedFloors
        : (renderOptions.referenceFloors
            ? floors.filter(
                (floor) =>
                  floor.id === activeFloorId || floor.id === floorBelowActive?.id,
              )
            : floors.filter((floor) => floor.id === activeFloorId)
          )
            .map((floor) => renderedFloorsById.get(floor.id))
            .filter((floor): floor is RenderedFloorData => Boolean(floor)),
    [
      activeFloorId,
      floorBelowActive?.id,
      floors,
      renderedFloors,
      renderedFloorsById,
      renderOptions.referenceFloors,
      showAllFloors,
    ],
  )
  const allFloorsPlane = useMemo(
    () =>
      showAllFloors && renderOptions.groundPlane
        ? getFloorsPlaneBounds(visibleRenderedFloors.map((renderedFloor) => renderedFloor.floor))
        : null,
    [renderOptions.groundPlane, showAllFloors, visibleRenderedFloors],
  )
  const windowDaylightPortalSlots = useMemo(
    () => getWindowDaylightPortalSlots(visibleRenderedFloors, lightDirection),
    [lightDirection, visibleRenderedFloors],
  )
  const floorGeometryStatusKey = useMemo(
    () =>
      JSON.stringify(
        floors.map((floor) => ({
          elevation: floor.elevation,
          id: floor.id,
          roomHeight: floor.roomHeight,
          slabThickness: floor.slabThickness,
          walls: floor.walls.map((wall) => ({
            end: wall.end,
            height: wall.height,
            id: wall.id,
            kind: wall.kind,
            openings: wall.openings,
            start: wall.start,
            thickness: wall.thickness,
          })),
        })),
      ),
    [floors],
  )
  const shaderWarmupKey = useMemo(
    () =>
      JSON.stringify({
        floorCount: showAllFloors
          ? floors.length
          : floors.some((floor) => floor.id === activeFloorId)
            ? 1
            : 0,
        modelVariants: Array.from(
          new Set(
            (showAllFloors
              ? floors
              : floors.filter((floor) => floor.id === activeFloorId)
            ).flatMap((floor) =>
              (floor.models ?? []).map((model) => {
                const definition = modelsById.get(model.modelId)

                return [
                  model.modelId,
                  definition?.lightKind ?? '',
                  definition?.isLight ? model.lightEnabled !== false : false,
                ].join(':')
              }),
            ),
          ),
        ).sort(),
        renderOptions: {
          ambientOcclusion: renderOptions.ambientOcclusion,
          floorSlabs: renderOptions.floorSlabs,
          lightMarkers: renderOptions.lightMarkers,
          lightShadows: renderOptions.lightShadows,
          lights: renderOptions.lights,
          referenceFloors: renderOptions.referenceFloors,
          shadows: renderOptions.shadows,
          skybox: renderOptions.skybox,
          windowDaylight: renderOptions.windowDaylight,
          wireframe: renderOptions.wireframe,
        },
        showAllFloors,
        surfaceMaterialVariants: Array.from(
          new Set(
            surfaceAssignments.map((assignment) => {
              const material = surfaceMaterialsById.get(assignment.materialId)

              return [
                assignment.materialId,
                Boolean(material?.pbr.baseColorTextureUrl),
                Boolean(material?.pbr.normalTextureUrl),
                Boolean(material?.pbr.roughnessTextureUrl),
                Boolean(material?.pbr.displacementTextureUrl),
                material ? getWallSurfaceTextureQuality(material) : 'none',
              ].join(':')
            }),
          ),
        ).sort(),
        wallKinds: Array.from(
          new Set(
            (showAllFloors
              ? floors
              : floors.filter((floor) => floor.id === activeFloorId)
            ).flatMap((floor) => floor.walls.map((wall) => wall.kind)),
          ),
        ).sort(),
      }),
    [
      activeFloorId,
      floors,
      renderOptions.ambientOcclusion,
      renderOptions.floorSlabs,
      renderOptions.lightMarkers,
      renderOptions.lightShadows,
      renderOptions.lights,
      renderOptions.referenceFloors,
      renderOptions.shadows,
      renderOptions.skybox,
      renderOptions.windowDaylight,
      renderOptions.wireframe,
      showAllFloors,
      surfaceAssignments,
    ],
  )
  const lightIndicator = useMemo(() => {
    const scopedFloors = showAllFloors
      ? floors
      : floors.filter((floor) => floor.id === activeFloorId)
    const scopedLightModels = scopedFloors.flatMap((floor) =>
      (floor.models ?? []).filter((model) =>
        Boolean(modelsById.get(model.modelId)?.isLight),
      ),
    )

    return {
      contributing: scopedLightModels.filter(
        (model) => model.lightEnabled !== false && localLightIds.has(model.id),
      ).length,
      total: scopedLightModels.length,
    }
  }, [activeFloorId, floors, localLightIds, showAllFloors])
  useEffect(() => {
    const latestStats = latestRendererStatsRef.current

    stallSnapshotRef.current = [
      `lights ${lightIndicator.contributing}/${lightIndicator.total}`,
      `limit ${localLightLimit}`,
      `floors ${visibleRenderedFloors.length}`,
      renderOptions.shadows ? 'scene shadows on' : 'scene shadows off',
      renderOptions.lightShadows ? 'light shadows on' : 'light shadows off',
      renderOptions.ambientOcclusion
        ? `AO ${renderOptions.ambientOcclusionIntensity.toFixed(2)}`
        : 'AO off',
      renderOptions.windowDaylight
        ? `window daylight ${windowDaylightPortalSlots.length}`
        : 'window daylight off',
      objectFrustumCullingEnabled
        ? 'object frustum culling on'
        : 'object frustum culling off',
      `ambient ${renderOptions.ambientTerm.toFixed(2)}`,
      renderOptions.lights ? 'lights on' : 'lights off',
      latestStats
        ? `${latestStats.programs} shaders, ${latestStats.calls} calls, ${latestStats.textures} tex`
        : 'stats pending',
    ].join(' | ')
  }, [
    lightIndicator.contributing,
    lightIndicator.total,
    localLightLimit,
    renderOptions.ambientOcclusion,
    renderOptions.ambientOcclusionIntensity,
    renderOptions.ambientTerm,
    renderOptions.lightShadows,
    renderOptions.lights,
    objectFrustumCullingEnabled,
    renderOptions.shadows,
    renderOptions.windowDaylight,
    visibleRenderedFloors.length,
    windowDaylightPortalSlots.length,
  ])
  const scenePreparationPending =
    isShaderWarmupPending || isTexturePreloadPending || isAssetLoadPending
  const shaderWarmupBlocked = isTexturePreloadPending || isAssetLoadPending
  const transformEnabled = true
  const navigationLocked = isTransformingModel || scenePreparationPending
  const updateShaderWarmupPending = useCallback((isPending: boolean) => {
    setIsShaderWarmupPending(isPending)
  }, [])
  const updateTexturePreloadPending = useCallback((isPending: boolean) => {
    setIsTexturePreloadPending(isPending)
  }, [])
  const updateAssetLoadPending = useCallback((isPending: boolean) => {
    setIsAssetLoadPending(isPending)
  }, [])

  const showEngineStatus = useCallback(
    (message: string, minimumVisibleMs = 1100) => {
      latestEngineActivityIdRef.current += 1
      const activityId = latestEngineActivityIdRef.current
      const indicator = engineStatusRef.current

      if (message !== 'Engine idle') {
        lastEngineActivityRef.current = {
          message,
          time: performance.now(),
        }
      }

      recordEngineLog('status', message, stallSnapshotRef.current)

      if (indicator) {
        indicator.textContent = message
        indicator.classList.toggle('is-idle', message === 'Engine idle')
      }

      if (engineStatusTimerRef.current !== null) {
        window.clearTimeout(engineStatusTimerRef.current)
      }

      engineStatusTimerRef.current = window.setTimeout(() => {
        if (latestEngineActivityIdRef.current === activityId) {
          const currentIndicator = engineStatusRef.current

          if (currentIndicator) {
            currentIndicator.textContent = 'Engine idle'
            currentIndicator.classList.add('is-idle')
          }

          engineStatusTimerRef.current = null
        }
      }, minimumVisibleMs)
    },
    [],
  )
  const updateRenderOption = (option: RenderToggleOption) => {
    const nextEnabled = !renderOptions[option]
    const activityMessage = (() => {
      if (option === 'lightShadows') {
        return nextEnabled
          ? 'Preparing light shadow maps...'
          : 'Disabling light shadow maps...'
      }

      if (option === 'shadows') {
        return nextEnabled
          ? 'Preparing scene shadows...'
          : 'Disabling scene shadows...'
      }

      if (option === 'ambientOcclusion') {
        return nextEnabled
          ? 'Preparing ambient occlusion pass...'
          : 'Disabling ambient occlusion pass...'
      }

      if (option === 'windowDaylight') {
        return nextEnabled
          ? 'Preparing window daylight portals...'
          : 'Disabling window daylight portals...'
      }

      if (option === 'lights') {
        return nextEnabled
          ? 'Preparing local lights...'
          : 'Disabling local lights...'
      }

      return null
    })()

    const applyRenderOptionUpdate = () => {
      renderOptionFrameIdsRef.current = []
      recordEngineLog(
        'render-option-applied',
        `${option} -> ${nextEnabled ? 'on' : 'off'}`,
        stallSnapshotRef.current,
      )
      setRenderOptions((currentOptions) => ({
        ...currentOptions,
        [option]: !currentOptions[option],
      }))
    }

    renderOptionFrameIdsRef.current.forEach((frameId) => {
      window.cancelAnimationFrame(frameId)
    })
    renderOptionFrameIdsRef.current = []

    if (!activityMessage) {
      applyRenderOptionUpdate()
      return
    }

    recordEngineLog(
      'render-option-requested',
      `${option} -> ${nextEnabled ? 'on' : 'off'}`,
      stallSnapshotRef.current,
    )

    showEngineStatus(activityMessage, 2500)

    const firstFrameId = window.requestAnimationFrame(() => {
      const secondFrameId = window.requestAnimationFrame(applyRenderOptionUpdate)
      renderOptionFrameIdsRef.current = [secondFrameId]
    })
    renderOptionFrameIdsRef.current = [firstFrameId]
  }
  const updateAmbientTerm = (ambientTerm: number) => {
    const clampedAmbientTerm = Math.max(0, Math.min(0.85, ambientTerm))

    recordEngineLog(
      'render-option-applied',
      `ambientTerm -> ${clampedAmbientTerm.toFixed(2)}`,
      stallSnapshotRef.current,
    )
    setRenderOptions((currentOptions) => ({
      ...currentOptions,
      ambientTerm: clampedAmbientTerm,
    }))
  }
  const updateAmbientOcclusionIntensity = (ambientOcclusionIntensity: number) => {
    const clampedAmbientOcclusionIntensity = Math.max(
      0,
      Math.min(3, ambientOcclusionIntensity),
    )

    recordEngineLog(
      'render-option-applied',
      `ambientOcclusionIntensity -> ${clampedAmbientOcclusionIntensity.toFixed(2)}`,
      stallSnapshotRef.current,
    )
    setRenderOptions((currentOptions) => ({
      ...currentOptions,
      ambientOcclusionIntensity: clampedAmbientOcclusionIntensity,
    }))
  }
  const setTransformingModel = useCallback((isTransforming: boolean) => {
    isTransformingModelRef.current = isTransforming
    setIsTransformingModel(isTransforming)
  }, [])
  const updateFps = useCallback((nextFps: number) => {
    const indicator = fpsIndicatorRef.current

    if (indicator) {
      indicator.textContent = `${nextFps} FPS`
    }
  }, [])
  const updateRendererStats = useCallback(
    (nextStats: RendererStats) => {
      latestRendererStatsRef.current = nextStats
      const lastLoggedRendererStats = lastLoggedRendererStatsRef.current

      if (
        !lastLoggedRendererStats ||
        Math.abs(nextStats.programs - lastLoggedRendererStats.programs) > 0 ||
        Math.abs(nextStats.textures - lastLoggedRendererStats.textures) >= 2 ||
        Math.abs(nextStats.geometries - lastLoggedRendererStats.geometries) >= 3 ||
        Math.abs(nextStats.calls - lastLoggedRendererStats.calls) >= 8
      ) {
        recordEngineLog(
          'renderer-stats',
          `${nextStats.programs} shaders, ${nextStats.calls} calls, ${nextStats.geometries} geo, ${nextStats.textures} tex, ${nextStats.triangles.toLocaleString()} tris`,
          stallSnapshotRef.current,
        )
        lastLoggedRendererStatsRef.current = nextStats
      }

      const previousShaderProgramCount = previousShaderProgramCountRef.current

      if (
        previousShaderProgramCount !== null &&
        nextStats.programs > previousShaderProgramCount
      ) {
        const addedPrograms = nextStats.programs - previousShaderProgramCount

        recordEngineLog(
          'shader-programs-added',
          `${addedPrograms} added; total ${nextStats.programs}`,
          stallSnapshotRef.current,
        )
        showEngineStatus(`Compiling ${pluralize(addedPrograms, 'shader')}...`, 1400)
      }

      previousShaderProgramCountRef.current = nextStats.programs

      if (shaderIndicatorRef.current) {
        shaderIndicatorRef.current.textContent = `${nextStats.programs} shaders`
      }

      if (callsIndicatorRef.current) {
        callsIndicatorRef.current.textContent = `${nextStats.calls} calls`
      }

      if (resourcesIndicatorRef.current) {
        resourcesIndicatorRef.current.textContent =
          `${nextStats.geometries} geo / ${nextStats.textures} tex`
      }

      if (trianglesIndicatorRef.current) {
        trianglesIndicatorRef.current.textContent =
          `${nextStats.triangles.toLocaleString()} tris`
      }
    },
    [showEngineStatus],
  )
  const updateLocalLightIds = useCallback((nextLightIds: ReadonlySet<string>) => {
    setLocalLightIds((currentLightIds) =>
      setIdsEqual(currentLightIds, nextLightIds) ? currentLightIds : nextLightIds,
    )
  }, [])
  const updateLocalLightLimit = useCallback((nextLightLimit: number) => {
    setLocalLightLimit((currentLightLimit) =>
      currentLightLimit === nextLightLimit ? currentLightLimit : nextLightLimit,
    )
  }, [])
  const registerPickTarget = useCallback((target: PickTarget) => {
    pickTargetsRef.current = [...pickTargetsRef.current, target]

    return () => {
      pickTargetsRef.current = pickTargetsRef.current.filter(
        (candidateTarget) => candidateTarget.object !== target.object,
      )
    }
  }, [])

  useEffect(() => {
    ensureEngineLogApi()
    recordEngineLog(
      'engine-log-ready',
      'Use window.houseDesignerEngineLog.table() or window.houseDesignerWallRenderDebug.table()',
    )
  }, [])

  useEffect(
    () =>
      subscribeEngineActivity(({ message, minimumVisibleMs }) => {
        showEngineStatus(message, minimumVisibleMs)
      }),
    [showEngineStatus],
  )

  useEffect(() => {
    let frameId = 0
    let lastFrameTime = performance.now()

    const detectStall = (frameTime: number) => {
      const stalledMs = frameTime - lastFrameTime

      if (stalledMs >= MAIN_THREAD_STALL_THRESHOLD_MS) {
        const lastActivity = lastEngineActivityRef.current
        const lastActivityAgeSeconds = Math.max(
          0,
          (performance.now() - lastActivity.time) / 1000,
        )
        const stallSeconds = (stalledMs / 1000).toFixed(1)
        const activityContext =
          lastActivityAgeSeconds < 12
            ? ` after ${lastActivity.message.replace(/\.\.\.$/, '')}`
            : ''

        recordEngineLog(
          'main-thread-stall',
          `${stallSeconds}s${activityContext}`,
          stallSnapshotRef.current,
        )
        console.warn(
          `[HouseDesigner] Main thread stalled for ${stallSeconds}s${activityContext}. ${stallSnapshotRef.current}`,
        )
        showEngineStatus(
          `Main thread stalled for ${stallSeconds}s${activityContext}`,
          4200,
        )
      }

      lastFrameTime = frameTime
      frameId = window.requestAnimationFrame(detectStall)
    }

    frameId = window.requestAnimationFrame(detectStall)

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [showEngineStatus])

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') {
      return undefined
    }

    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.duration < MAIN_THREAD_STALL_THRESHOLD_MS) {
          return
        }

        const duration = `${entry.duration.toFixed(0)}ms`

        recordEngineLog('browser-long-task', duration, stallSnapshotRef.current)
        console.warn(`[HouseDesigner] Browser long task ${duration}. ${stallSnapshotRef.current}`)
      })
    })

    try {
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      return undefined
    }

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(
    () => () => {
      if (engineStatusTimerRef.current !== null) {
        window.clearTimeout(engineStatusTimerRef.current)
      }

      renderOptionFrameIdsRef.current.forEach((frameId) => {
        window.cancelAnimationFrame(frameId)
      })
      renderOptionFrameIdsRef.current = []
    },
    [],
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      showEngineStatus('Constructing geometry...', 900)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [floorGeometryStatusKey, showEngineStatus])

  return (
    <section className="editor-pane">
      <div className="pane-header">
        <h2>3D View</h2>
        <div className="three-header-controls">
          <label className="aspect-ratio-select">
            <span>Aspect</span>
            <select
              value={aspectRatioMode}
              onChange={(event) =>
                setAspectRatioMode(event.target.value as AspectRatioMode)
              }
            >
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
              <option value="super-wide">Super-wide</option>
            </select>
          </label>
          <div className="segmented-control compact" aria-label="3D transform mode">
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
          <label className="head-height-toggle">
            <input
              type="checkbox"
              checked={headHeightEnabled}
              onChange={(event) => {
                setHeadHeightEnabled(event.target.checked)
                event.currentTarget.blur()
              }}
            />
            Head height
          </label>
          <button
            type="button"
            onClick={() => {
              const capturePickBuffer = pickBufferCaptureRef.current

              if (!capturePickBuffer) {
                showEngineStatus('Pick capture not ready', 1800)
                recordEngineLog('color-pick-buffer-export-failed', 'capture not ready')
                return
              }

              showEngineStatus(
                `Exporting pick buffer (${pickTargetsRef.current.length} targets)...`,
                1800,
              )
              capturePickBuffer()
            }}
          >
            Pick PNG
          </button>
          {pickBufferDownload ? (
            <a
              className="pick-buffer-download-link"
              href={pickBufferDownload.dataUrl}
              download={pickBufferDownload.filename}
            >
              Download PNG
            </a>
          ) : null}
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
                    checked={renderOptions.ambientOcclusion}
                    onChange={() => updateRenderOption('ambientOcclusion')}
                  />
                  Ambient occlusion
                </label>
                <label className="render-options-slider">
                  <span>AO strength</span>
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="0.05"
                    value={renderOptions.ambientOcclusionIntensity}
                    onChange={(event) =>
                      updateAmbientOcclusionIntensity(
                        Number(event.currentTarget.value),
                      )
                    }
                  />
                  <span>
                    {renderOptions.ambientOcclusionIntensity.toFixed(2)}
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.shadows}
                    onChange={() => updateRenderOption('shadows')}
                  />
                  Shadows
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.daylight}
                    onChange={() => updateRenderOption('daylight')}
                  />
                  Daylight
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.windowDaylight}
                    onChange={() => updateRenderOption('windowDaylight')}
                  />
                  Window daylight
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.nightFill}
                    onChange={() => updateRenderOption('nightFill')}
                  />
                  Night fill
                </label>
                <label className="render-options-slider">
                  <span>Ambient term</span>
                  <input
                    type="range"
                    min="0"
                    max="0.85"
                    step="0.01"
                    value={renderOptions.ambientTerm}
                    onChange={(event) =>
                      updateAmbientTerm(Number(event.currentTarget.value))
                    }
                  />
                  <span>{renderOptions.ambientTerm.toFixed(2)}</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.lights}
                    onChange={() => updateRenderOption('lights')}
                  />
                  Lights
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.occlusionCulling}
                    onChange={() => updateRenderOption('occlusionCulling')}
                  />
                  Object frustum culling
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.lightShadows}
                    onChange={() => updateRenderOption('lightShadows')}
                  />
                  Light shadows
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.lightMarkers}
                    onChange={() => updateRenderOption('lightMarkers')}
                  />
                  Light markers
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.skybox}
                    onChange={() => updateRenderOption('skybox')}
                  />
                  Countryside skybox
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.wireframe}
                    onChange={() => updateRenderOption('wireframe')}
                  />
                  Wireframe
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.referenceFloors}
                    onChange={() => updateRenderOption('referenceFloors')}
                  />
                  Reference floors
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.groundPlane}
                    onChange={() => updateRenderOption('groundPlane')}
                  />
                  Ground plane
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={renderOptions.floorSlabs}
                    onChange={() => updateRenderOption('floorSlabs')}
                  />
                  Floor slabs
                </label>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className={
          scenePreparationPending ? 'three-host is-preparing' : 'three-host'
        }
      >
        <Canvas
          shadows={renderOptions.shadows}
          camera={{ position: [6, 5, 8], fov: cameraFov }}
          dpr={renderOptions.ambientOcclusion ? 1 : [1, 1.5]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.info.autoReset = false
          }}
          tabIndex={0}
        >
          <ModelPicker
            active
            isTransformingRef={isTransformingModelRef}
            onClearSelection={onClearSelection}
            onSelectModel={onSelectModel}
            onSelectSurface={onSelectSurface}
            pickTargetsRef={pickTargetsRef}
          />
          <PickBufferExporter
            onImage={setPickBufferDownload}
            onReady={(capture) => {
              pickBufferCaptureRef.current = capture
            }}
            pickTargetsRef={pickTargetsRef}
          />
          <FpsCounter onFpsChange={updateFps} />
          <RendererStatsSampler onStatsChange={updateRendererStats} />
          <SunShadowBlockerFilter />
          <CameraRoomVisibilityTracker
            activeFloor={activeFloor}
            enabled={occlusionCullingEnabled}
            onVisibilityChange={setRoomVisibilityState}
            renderedFloor={activeRenderedFloor}
          />
          <SceneAssetLoadTracker onPendingChange={updateAssetLoadPending} />
          <SceneResourcePreloader
            floors={floors}
            modelAssetVersion={modelAssetVersion}
            onPendingChange={updateTexturePreloadPending}
            renderedFloors={renderedFloors}
            surfaceAssignments={surfaceAssignments}
          />
          <ShaderWarmup
            blocked={shaderWarmupBlocked}
            onPendingChange={updateShaderWarmupPending}
            warmupKey={shaderWarmupKey}
          />
          <CameraFovController fov={cameraFov} />
            <RendererLightCapabilities
              onLocalLightLimitChange={updateLocalLightLimit}
            />
            <LocalLightBudgetController
              activeFloorId={activeFloorId}
              enabled={renderOptions.lights}
              localLightLimit={localLightLimit}
              onLocalLightIdsChange={updateLocalLightIds}
              selectedModelId={selectedModelId}
              visibleRenderedFloors={visibleRenderedFloors}
            />
            <color
              attach="background"
              args={[renderOptions.daylight ? '#eef2f7' : '#020617']}
            />
            {renderOptions.daylight && renderOptions.skybox ? (
              <CountrysideSkybox />
            ) : null}
            <ambientLight
              intensity={
                renderOptions.daylight
                  ? 0.45 + renderOptions.ambientTerm
                  : renderOptions.nightFill
                    ? renderOptions.ambientTerm
                    : 0
              }
            />
            <SunLight
              enabled={renderOptions.daylight}
              lightDirection={lightDirection}
              sceneBounds={sceneBounds}
              shadows={renderOptions.shadows}
            />
            <WindowDaylightPortalPool
              enabled={
                renderOptions.daylight &&
                renderOptions.shadows &&
                renderOptions.windowDaylight
              }
              slots={windowDaylightPortalSlots}
            />
            <FixedLocalLightPool
              activeFloorId={activeFloorId}
              localLightIds={localLightIds}
              lightShadowsEnabled={renderOptions.lightShadows}
              shadowsEnabled={renderOptions.shadows}
              visibleRenderedFloors={visibleRenderedFloors}
            />

            {allFloorsPlane ? (
              <>
                <mesh
                  position={[
                    allFloorsPlane.centerX,
                    -0.01,
                    allFloorsPlane.centerZ,
                  ]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  receiveShadow={renderOptions.shadows}
                  renderOrder={0}
                >
                  <planeGeometry args={[allFloorsPlane.size, allFloorsPlane.size]} />
                  <meshStandardMaterial
                    color="#f8fafc"
                    depthWrite
                    wireframe={renderOptions.wireframe}
                  />
                </mesh>
              </>
            ) : null}

            {visibleRenderedFloors.map((renderedFloor) => {
              const {
                externalWallUnionFootprints,
                externalWallUnionWallIds,
                externalWallUnionWalls,
                floor,
                geometryContextWalls,
                internalWallFootprintGroups,
                renderedWalls,
                rooms,
                wallBodyOccluders,
              } = renderedFloor
              const isActive = floor.id === activeFloorId
              const usesExternalWallUnion =
                isActive && externalWallUnionFootprints.length > 0
              const externalWallUnionWallIdSet = new Set(
                externalWallUnionWallIds,
              )
              const wallsByIdForFloor = new Map(
                geometryContextWalls.map((wall) => [wall.id, wall]),
              )
              const activeVisibleRoomSignatures: ReadonlySet<string> | null = null
              const externalUnionFilteredRenderedWallsForFloor = usesExternalWallUnion
                ? renderedWalls.filter(
                    (renderedWall) =>
                      !externalWallUnionWallIdSet.has(renderedWall.wall.id) &&
                      wallTouchesVisibleRoom(
                        renderedWall.wall,
                        rooms,
                        activeVisibleRoomSignatures,
                      ),
                  )
                : renderedWalls.filter(
                    (renderedWall) =>
                      wallTouchesVisibleRoom(
                        renderedWall.wall,
                        rooms,
                        activeVisibleRoomSignatures,
                      ),
                  )
              const wallEngineCandidateRenderedWalls =
                getWallEngineCandidateRenderedWalls(
                  externalUnionFilteredRenderedWallsForFloor,
                  surfaceAssignments,
                )
              const wallEngineCandidateWallIds = new Set(
                wallEngineCandidateRenderedWalls.map(
                  (renderedWall) => renderedWall.wall.id,
                ),
              )
              const wallEngineHandledInternalFootprintWallIds =
                getWallIdsForEngineHandledInternalFootprintGroups(
                  internalWallFootprintGroups,
                  wallEngineCandidateWallIds,
                )
              const legacyInternalWallFootprintWallIdSet =
                getWallIdsForLegacyInternalFootprintGroups(
                  internalWallFootprintGroups,
                  wallEngineCandidateWallIds,
                )
              const visibleRenderedWallsForFloor =
                externalUnionFilteredRenderedWallsForFloor.filter(
                  (renderedWall) =>
                    !legacyInternalWallFootprintWallIdSet.has(
                      renderedWall.wall.id,
                    ),
                )
              const wallEngineRenderedWalls = wallEngineCandidateRenderedWalls.filter(
                (renderedWall) =>
                  !legacyInternalWallFootprintWallIdSet.has(renderedWall.wall.id),
              )
              const wallEngineRenderedWallIds = new Set(
                wallEngineRenderedWalls.map((renderedWall) => renderedWall.wall.id),
              )
              const legacyVisibleRenderedWallsForFloor =
                wallEngineRenderedWalls.length > 0
                  ? visibleRenderedWallsForFloor.filter(
                      (renderedWall) =>
                        !wallEngineRenderedWallIds.has(renderedWall.wall.id),
                    )
                  : visibleRenderedWallsForFloor
              const slabIsSolid = floor.id === floorBelowActive?.id
              const floorIndex = floorsByElevation.findIndex(
                (candidateFloor) => candidateFloor.id === floor.id,
              )
              const upperFloor =
                floorIndex >= 0 ? floorsByElevation[floorIndex + 1] ?? null : null
              const hasShadowSurface = renderOptions.shadows && isActive
              const visibleRoomsForFloor = rooms
              const visibleModelsForFloor = floor.models ?? []
              const floorPlane =
                renderOptions.groundPlane && !showAllFloors && isActive
                  ? getFloorPlaneBounds(floor)
                  : null
              const needsSunShadowBlocker =
                renderOptions.shadows &&
                renderOptions.daylight &&
                floor.id === activeFloorId
              const shouldRenderSlab =
                !showAllFloors &&
                (renderOptions.floorSlabs || needsSunShadowBlocker) &&
                (floor.id === activeFloorId || floor.id === floorBelowActive?.id)

              if (showAllFloors) {
                return (
                  <group key={`${sceneRevision}:${floor.id}`}>
                      <FloorRenderBoundary
                        floorId={floor.id}
                        resetKey={getFloorRenderResetKey(
                          floor,
                          surfaceAssignments,
                        )}
                      >
                      {renderOptions.floorSlabs ? (
                        <FloorSlab
                          castsShadow={renderOptions.shadows}
                          floor={floor}
                          floors={floors}
                          isSolid
                          onRegisterPickTarget={registerPickTarget}
                          selectedSurface={selectedSurface}
                          surfaceAssignments={surfaceAssignments}
                          upperFloor={upperFloor}
                          wireframe={renderOptions.wireframe}
                        />
                      ) : null}
                      <RoomFloorFinishes
                        elevation={floor.elevation}
                        floorId={floor.id}
                        rooms={rooms}
                        surfaceAssignments={surfaceAssignments}
                        visibleRoomSignatures={null}
                        wireframe={renderOptions.wireframe}
                      />
                      <RoomCeilingFinishes
                        elevation={floor.elevation}
                        floorId={floor.id}
                        roomHeight={floor.roomHeight}
                        rooms={rooms}
                        surfaceAssignments={surfaceAssignments}
                        visibleRoomSignatures={null}
                        wireframe={renderOptions.wireframe}
                      />
                      <SelectableRoomSurfaces
                        elevation={floor.elevation}
                        floorPlane={getFloorPlaneBounds(floor)}
                        floorId={floor.id}
                        onRegisterPickTarget={registerPickTarget}
                        roomHeight={floor.roomHeight}
                        rooms={rooms}
                        selectedSurface={selectedSurface}
                        visibleRoomSignatures={null}
                      />
                      <SolidFloorScene
                        daylightEnabled={renderOptions.daylight}
                        externalWallUnionFootprints={externalWallUnionFootprints}
                        externalWallUnionWallIds={externalWallUnionWallIds}
                        externalWallUnionWalls={externalWallUnionWalls}
                        floor={floor}
                        frustumCullingEnabled={objectFrustumCullingEnabled}
                        internalWallFootprintGroups={internalWallFootprintGroups}
                        isSelectedModel={(modelId) => modelId === selectedModelId}
                        lightMarkersVisible={renderOptions.lightMarkers}
                        modelAssetVersion={modelAssetVersion}
                        onRegisterPickTarget={registerPickTarget}
                        onTransformActiveChange={setTransformingModel}
                        onUpdateModel={onUpdateModel}
                        pickTargetsRef={pickTargetsRef}
                        renderedWalls={renderedWalls}
                        rooms={rooms}
                        selectedWallId={selectedWallId}
                        selectedSurface={selectedSurface}
                        shadowsEnabled={renderOptions.shadows}
                        surfaceAssignments={surfaceAssignments}
                        transformEnabled={transformEnabled}
                        transformMode={transformMode}
                        visibleRoomSignatures={null}
                        wallBodyOccluders={wallBodyOccluders}
                        wireframe={renderOptions.wireframe}
                      />
                    </FloorRenderBoundary>
                  </group>
                )
              }

              return (
                <group key={`${sceneRevision}:${floor.id}`}>
                  <FloorRenderBoundary
                    floorId={floor.id}
                    resetKey={getFloorRenderResetKey(
                      floor,
                      surfaceAssignments,
                    )}
                  >
                    {shouldRenderSlab ? (
                      <FloorSlab
                        castsShadow={renderOptions.shadows}
                        floor={floor}
                        floors={floors}
                        isSolid={slabIsSolid}
                        onRegisterPickTarget={registerPickTarget}
                        selectedSurface={selectedSurface}
                        sunShadowBlocker={!slabIsSolid && needsSunShadowBlocker}
                        surfaceAssignments={surfaceAssignments}
                        upperFloor={upperFloor}
                        wireframe={renderOptions.wireframe}
                      />
                    ) : null}
                    {floorPlane ? (
                      <>
                        <mesh
                          position={[
                            floorPlane.centerX,
                            -0.01,
                            floorPlane.centerZ,
                          ]}
                          rotation={[-Math.PI / 2, 0, 0]}
                          receiveShadow={hasShadowSurface}
                          renderOrder={isActive ? 0 : -1}
                        >
                          <planeGeometry args={[floorPlane.size, floorPlane.size]} />
                          <meshStandardMaterial
                            color={isActive ? '#f8fafc' : '#eef2f7'}
                            depthWrite={isActive}
                            opacity={isActive ? 1 : 0.035}
                            polygonOffset={!isActive}
                            polygonOffsetFactor={2}
                            polygonOffsetUnits={2}
                            transparent={!isActive}
                            wireframe={renderOptions.wireframe}
                          />
                        </mesh>
                      </>
                    ) : null}
                    {isActive ? (
                      <>
                        <RoomFloorFinishes
                          elevation={floor.elevation}
                          floorId={floor.id}
                          rooms={rooms}
                          surfaceAssignments={surfaceAssignments}
                          visibleRoomSignatures={activeVisibleRoomSignatures}
                          wireframe={renderOptions.wireframe}
                        />
                        <RoomCeilingFinishes
                          elevation={floor.elevation}
                          floorId={floor.id}
                          roomHeight={floor.roomHeight}
                          rooms={rooms}
                          surfaceAssignments={surfaceAssignments}
                          visibleRoomSignatures={activeVisibleRoomSignatures}
                          wireframe={renderOptions.wireframe}
                        />
                        <SelectableRoomSurfaces
                          elevation={floor.elevation}
                          floorPlane={floorPlane}
                          floorId={floor.id}
                          onRegisterPickTarget={registerPickTarget}
                          roomHeight={floor.roomHeight}
                          rooms={rooms}
                          selectedSurface={selectedSurface}
                          visibleRoomSignatures={activeVisibleRoomSignatures}
                        />
                      </>
                    ) : null}
                    <WallEngineExclusionDebugRecorder
                      externalWallUnionWallIds={
                        usesExternalWallUnion ? externalWallUnionWallIds : []
                      }
                      floorId={floor.id}
                      legacyInternalWallFootprintWallIds={Array.from(
                        legacyInternalWallFootprintWallIdSet,
                      )}
                      renderedWalls={renderedWalls}
                      surfaceAssignments={surfaceAssignments}
                    />
                    {usesExternalWallUnion ? (
                      <>
                        <WallFootprintMeshes
                          castsShadow={hasShadowSurface}
                          elevation={floor.elevation}
                          floorId={floor.id}
                          footprints={externalWallUnionFootprints}
                          geometryContextRenderedWalls={renderedWalls}
                          geometryContextWalls={geometryContextWalls}
                          height={floor.roomHeight}
                          onRegisterPickTarget={registerPickTarget}
                          selectedWallId={selectedWallId}
                          selectedSurface={selectedSurface}
                          sourceWalls={externalWallUnionWalls}
                          surfaceAssignments={surfaceAssignments}
                          wallKind="external"
                          wireframe={renderOptions.wireframe}
                        />
                      </>
                    ) : null}
                    {isActive
                      ? internalWallFootprintGroups
                          .filter((group) => group.wallIds && group.wallIds.length > 1)
                          .filter(
                            (group) =>
                              !internalFootprintGroupUsesWallEngine(
                                group,
                                wallEngineHandledInternalFootprintWallIds,
                              ),
                          )
                          .map((group) => ({
                            group,
                            sourceWalls: (group.wallIds ?? [group.wallId])
                              .map((wallId) => wallsByIdForFloor.get(wallId))
                              .filter((wall): wall is Wall => Boolean(wall)),
                          }))
                          .filter(({ sourceWalls }) =>
                            sourceWalls.some((wall) =>
                              wallTouchesVisibleRoom(
                                wall,
                                rooms,
                                activeVisibleRoomSignatures,
                              ),
                            ),
                          )
                          .map(({ group, sourceWalls }) => (
                            <WallFootprintMeshes
                              key={group.wallId}
                              castsShadow={hasShadowSurface}
                              elevation={floor.elevation}
                              floorId={floor.id}
                              footprints={group.footprints}
                              geometryContextRenderedWalls={renderedWalls}
                              geometryContextWalls={geometryContextWalls}
                              height={floor.roomHeight}
                              includeVerticalFaces={Boolean(
                                group.wallIds && group.wallIds.length > 1,
                              )}
                              onRegisterPickTarget={registerPickTarget}
                              selectedWallId={selectedWallId}
                              selectedSurface={selectedSurface}
                              sourceWalls={sourceWalls}
                              surfaceAssignments={surfaceAssignments}
                              wallKind="internal"
                              wireframe={renderOptions.wireframe}
                            />
                          ))
                      : null}
                    {wallEngineRenderedWalls.length > 0 ? (
                      <WallEngineWallMeshes
                        castsShadow={hasShadowSurface}
                        elevation={floor.elevation}
                        externalFootprintWallIds={externalWallUnionWallIdSet}
                        floorId={floor.id}
                        onRegisterPickTarget={registerPickTarget}
                        renderedWalls={wallEngineRenderedWalls}
                        roomSurfaceDebugRenderedWalls={renderedWalls}
                        rooms={visibleRoomsForFloor}
                        selectedSurface={selectedSurface}
                        selectedWallId={selectedWallId}
                        surfaceAssignments={surfaceAssignments}
                        wireframe={renderOptions.wireframe}
                      />
                    ) : null}
                    {legacyVisibleRenderedWallsForFloor.map((renderedWall) => (
                      <WallMesh
                        key={renderedWall.wall.id}
                        castsShadow={hasShadowSurface}
                        elevation={floor.elevation}
                        floorId={floor.id}
                        isActive={isActive}
                        onRegisterPickTarget={registerPickTarget}
                        renderedWall={renderedWall}
                        selectedWallId={selectedWallId}
                        selectedSurface={selectedSurface}
                        surfaceAssignments={surfaceAssignments}
                        wallBodyOccluders={wallBodyOccluders}
                        wireframe={renderOptions.wireframe}
                      />
                    ))}
                    {isActive ? (
                      <SkirtingBoards
                        elevation={floor.elevation}
                        externalWallUnionFootprints={externalWallUnionFootprints}
                        models={visibleModelsForFloor}
                        renderedWalls={renderedWalls}
                        rooms={visibleRoomsForFloor}
                        wireframe={renderOptions.wireframe}
                      />
                    ) : null}
                    {isActive ? (
                      <Suspense fallback={null}>
                        {visibleModelsForFloor.map((model) => (
                          <ModelLoadBoundary key={`${model.id}:${modelAssetVersion}`}>
                            <ModelMesh
                              daylightEnabled={renderOptions.daylight}
                              elevation={floor.elevation}
                              floorId={floor.id}
                              frustumCullingEnabled={objectFrustumCullingEnabled}
                              isActive={isActive}
                              isSelected={model.id === selectedModelId}
                              lightMarkersVisible={renderOptions.lightMarkers}
                              model={model}
                              modelAssetVersion={modelAssetVersion}
                              pickTargetsRef={pickTargetsRef}
                              onRegisterPickTarget={registerPickTarget}
                              onTransformActiveChange={setTransformingModel}
                              onUpdateModel={onUpdateModel}
                              shadowsEnabled={renderOptions.shadows}
                              transformEnabled={transformEnabled}
                              transformMode={transformMode}
                              walls={floor.walls}
                              wireframe={renderOptions.wireframe}
                            />
                          </ModelLoadBoundary>
                        ))}
                      </Suspense>
                    ) : null}
                  </FloorRenderBoundary>
                </group>
              )
            })}

            <WalkCameraControls
              enabled={!navigationLocked}
              headHeightEnabled={headHeightEnabled}
              headHeightY={headHeightY}
              isTransformingRef={isTransformingModelRef}
              movementEnabled
              navigationLocked={navigationLocked}
              pickTargetsRef={pickTargetsRef}
              selectedModelId={selectedModelId}
            />
            {renderOptions.ambientOcclusion ? (
              <EffectComposer
                multisampling={0}
                resolutionScale={0.75}
              >
                <N8AO
                  aoRadius={0.28}
                  distanceFalloff={1}
                  intensity={renderOptions.ambientOcclusionIntensity}
                  quality="low"
                  aoSamples={6}
                  denoiseSamples={3}
                  denoiseRadius={3}
                  color={ambientOcclusionColor}
                />
              </EffectComposer>
            ) : null}
        </Canvas>
        <div
          ref={engineStatusRef}
          className="viewport-engine-status is-idle"
          aria-live="polite"
          aria-label="3D engine status"
        >
          Engine idle
        </div>
        {scenePreparationPending ? (
          <div className="viewport-preparing-overlay" aria-live="polite">
            <div className="viewport-preparing-panel">
              Preparing 3D scene...
            </div>
          </div>
        ) : null}
        <div className="viewport-indicators">
          <div
            ref={fpsIndicatorRef}
            className="viewport-indicator"
            aria-label="3D frames per second"
          >
            -- FPS
          </div>
          <div className="viewport-indicator" aria-label="Contributing lights">
            {lightIndicator.contributing}/{lightIndicator.total} lights
          </div>
          <div
            ref={shaderIndicatorRef}
            className="viewport-indicator"
            aria-label="Compiled shader programs"
          >
            0 shaders
          </div>
          <div
            ref={callsIndicatorRef}
            className="viewport-indicator"
            aria-label="3D draw calls"
          >
            0 calls
          </div>
          <div
            ref={resourcesIndicatorRef}
            className="viewport-indicator"
            aria-label="3D scene resources"
          >
            0 geo / 0 tex
          </div>
          <div
            ref={trianglesIndicatorRef}
            className="viewport-indicator"
            aria-label="3D rendered triangles"
          >
            0 tris
          </div>
        </div>
        <LightGimbal
          lightDirection={lightDirection}
          onLightDirectionChange={setLightDirection}
        />
      </div>
    </section>
  )
}
