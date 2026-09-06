/* eslint-disable react-hooks/immutability */
import {
  Edges,
  TransformControls,
  useGLTF,
  useProgress,
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO } from '@react-three/postprocessing'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js'
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'
import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  AdditiveBlending,
  Material,
  Matrix3,
  Matrix4,
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
  SunPosition,
  SurfaceMaterialAssignment,
  SurfaceMaterialProduct,
  SurfaceWallSide,
  Wall,
  WallKind,
} from '../types'
import { surfaceMaterialsById } from '../materials/materialCatalog'
import {
  getModelAssetUrl,
  modelsById,
  type ModelDefinition,
} from '../models/modelLibrary'
import { subtractPlanCutouts } from '../planarCutouts'
import { snapStairApertureToWalls } from '../stairPlacement'
import {
  getModelHorizontalBounds,
  getStairOpeningPolygon,
  getStairSlabOpenings,
} from '../stairSlabOpenings'
import {
  createCeilingSlabGeometry,
  offsetEdgeTowardPoint,
} from '../ceilingSlabGeometry'
import {
  type WallFootprintRenderGroup,
  type WallUnionFootprint,
} from '../wallBooleanGeometry'
import { getWallPolygon, type RenderedWall } from '../wallGeometry'
import { buildWallTopology, type DetectedRoom } from '../wallTopology'
import { buildWallBufferGeometryPayload } from '../wallEngine/wallBuffer'
import {
  findFloorSlabSupportingWall,
  type FloorSlabSupportingWall,
} from '../floorSlabEdgeMaterial'
import { buildWallGeometryPlans } from '../wallEngine/wallPlan'
import {
  buildRoomWallSurfacePlans,
  buildRoomSurfaceWallFaces,
  type RoomWallSurfacePlan,
} from '../wallEngine/roomSurfaceMesh'
import {
  buildFloorWallSurfaceFaces,
  type FloorWallSurfaceFace,
} from '../wallEngine/floorWallSurfaceMesh'
import { createWallBufferGeometry } from '../wallEngine/wallThreeGeometry'
import { buildWallGraph, type WallSide } from '../wallEngine/wallGraph'
import { buildCoplanarWallSurfaceGroups } from '../wallEngine/wallSurfaceGroups'
import {
  buildWallBodyPerimeters,
  type WallBodyPerimeter,
} from '../wallEngine/wallBodyPerimeter'
import type {
  RenderedFloorData,
  RoomPortal,
  WallBodyOccluder,
} from '../threeDLevelPreparation'
import {
  prepareRenderedFloorsInWorkers,
  prepareRenderedFloorsSync,
} from '../threeDLevelPreparationClient'

export function clearThreeDModelAssetCaches() {
  ;(useGLTF as unknown as { clear?: () => void }).clear?.()
}

const WALL_ENGINE_RENDERER_ENABLED = true
const WALL_BODY_PERIMETER_MESH_ENABLED = true
const ROOM_SURFACE_WALL_RENDERER_ENABLED = true
const ROOM_SURFACE_DEBUG_OVERLAY_ENABLED = false
const ROOM_BOUNDARY_DEBUG_OVERLAY_ENABLED = false
const SHADER_WARMUP_ENABLED = true
const CEILING_VISUAL_OVERLAP_METERS = 0.035
const CEILING_VERTICAL_OVERLAP_METERS = 0.02
const CEILING_SLAB_CAP_INSET_METERS = 0.001
const FLOOR_BASE_VERTICAL_OFFSET_METERS = 0.008
const FLOOR_FINISH_VERTICAL_OFFSET_METERS = 0.012

type WallEngineFace = FloorWallSurfaceFace

type ThreeDViewProps = {
  activeFloorId: string
  floors: FloorLevel[]
  isEngineConsoleOpen: boolean
  lightDirection: SunPosition
  modelAssetVersion: number
  onClearSelection: () => void
  onEngineConsoleOpenChange: (isOpen: boolean) => void
  onLightDirectionChange: (lightDirection: SunPosition) => void
  onSelectFloor: (floorId: string) => void
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
  ambientOcclusionQuality: AmbientOcclusionQuality
  ambientTerm: number
  bakedLightmaps: boolean
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
  wallPerimeter: boolean
  wireframe: boolean
}

type RenderToggleOption = Exclude<
  keyof RenderOptions,
  'ambientOcclusionIntensity' | 'ambientOcclusionQuality' | 'ambientTerm'
>

type AmbientOcclusionQuality = 'fast' | 'balanced'

type PortalFloorGeometry = {
  center: Point
  depth: number
  direction: Point
  openingId: string
  wallId: string
  width: number
}

type FloorVisibilityState = {
  currentRoomSignature: string | null
  floorId: string
  visibleRoomSignatures: string[]
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

type EngineConsoleLine = {
  entry: EngineLogEntry
  text: string
}

type SceneObjectDebugEntry = {
  geometryGroups?: number
  materialCount: number
  name: string
  positionCount?: number
  renderOrder: number
  role?: string
  type: string
  visible: boolean
}

type SceneObjectDebugSummary = {
  meshCount: number
  visibleMeshCount: number
  wallLikeMeshes: SceneObjectDebugEntry[]
}

type CeilingSlabDebugEntry = {
  floorId: string
  highestWallTop: number | null
  lowestWallTop: number | null
  slabBottom: number
  slabTop: number
  upperFloorElevation: number | null
  upperFloorId: string | null
  upperFloorGap: number | null
  wallGap: number | null
}

type CeilingSlabEdgeDebugEntry = {
  edgeIndex: number
  floorId: string
  lowerPlaneError: number | null
  lowerWallId: string | null
  upperPlaneError: number | null
  upperWallId: string | null
  x1: number
  x2: number
  z1: number
  z2: number
}

type HouseDesignerEngineLogApi = {
  clear: () => void
  current?: () => EngineLogEntry[]
  entries: EngineLogEntry[]
  footprintFaces?: (floorId?: string) => FootprintFaceDebugEntry[]
  footprintEdges?: (floorId?: string) => FootprintEdgeDebugEntry[]
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
  sceneObjects?: () => SceneObjectDebugSummary | null
  ceilingSlabs?: () => CeilingSlabDebugEntry[]
  ceilingSlabEdges?: () => CeilingSlabEdgeDebugEntry[]
  summary?: () => Array<{ detail?: string; type: string }>
  tableCurrent?: () => void
  tableFootprintFaces?: (floorId?: string) => void
  tableFootprintEdges?: (floorId?: string) => void
  tableGeometryDump?: (floorId?: string) => void
  tableRoomSurfaceFaces?: () => void
  tableRoomSurfaceFaceSummary?: () => void
  tableWallFaces?: () => void
  tableRoomPlanProblemDetails?: () => void
  tableRoomPlans?: () => void
  tableRoomPlanProblems?: () => void
  tableRoomPlanSummary?: () => void
  tableRoutes?: () => void
  tableSceneObjects?: () => void
  tableCeilingSlabs?: () => void
  tableCeilingSlabEdges?: () => void
  setRoleVisible?: (role: string, visible: boolean) => number
  table: (count?: number) => void
}

type HouseDesignerWallRenderDebugApi = HouseDesignerEngineLogApi

type FootprintEdgeDebugEntry = {
  edgeIndex: number
  floorId: string
  isHole: boolean
  kind: WallKind
  length: number
  matchSide?: WallSide
  matchWallId?: string
  normalX: number
  normalY: number
  ringIndex: number
  sourceWalls: string
  startX: number
  startY: number
  endX: number
  endY: number
}

type FootprintFaceDebugEntry = {
  count: number
  floorId: string
  kind: WallKind
  materialIndex: number
  maxX: number
  maxY: number
  maxZ: number
  minX: number
  minY: number
  minZ: number
  source: string
  start: number
}

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
    materialSource: {
      fragmentId?: string
      role?: string
      side?: WallSide
      wallId: string
    }
    pickSource: {
      fragmentId?: string
      role?: string
      side?: WallSide
      wallId: string
    }
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
const AMBIENT_OCCLUSION_SETTINGS: Record<
  AmbientOcclusionQuality,
  {
    aoSamples: number
    denoiseRadius: number
    denoiseSamples: number
    halfRes: boolean
    resolutionScale: number
  }
> = {
  fast: {
    aoSamples: 4,
    denoiseRadius: 2,
    denoiseSamples: 1,
    halfRes: true,
    resolutionScale: 0.5,
  },
  balanced: {
    aoSamples: 6,
    denoiseRadius: 3,
    denoiseSamples: 3,
    halfRes: false,
    resolutionScale: 0.75,
  },
}
const FLOOR_PLANE_MARGIN = 5
const SHADOW_MARGIN = 8
const FOOTPRINT_EPSILON = 0.04
const WALK_CAMERA_SPEED = 4.2
const WALK_CAMERA_SHIFT_MULTIPLIER = 2
const WALK_HEAD_HEIGHT_METERS = 1.8
const WALK_LOOK_SENSITIVITY = 0.002
const WALK_MAX_PITCH_RADIANS = Math.PI / 2 - 0.05
const XR_STEP_DISTANCE_METERS = 0.45
const XR_SNAP_TURN_RADIANS = Math.PI / 12
const XR_STICK_DEADZONE = 0.35
const XR_FRAMEBUFFER_SCALE_FACTOR = 0.65
const XR_FOVEATION = 1
const XR_MAX_REALTIME_LOCAL_LIGHTS = 2
const XR_SUN_SHADOW_MAP_SIZE = 1024
const XR_EXIT_BUTTON_INDEX = 5
const XR_STAIRS_BUTTON_INSET_METERS = 0.35
const XR_STAIRS_BUTTON_HEIGHT_METERS = 1
const XR_PUSH_BUTTON_RADIUS_METERS = 0.025
const XR_PUSH_BUTTON_CONTACT_RADIUS_METERS = 0.045
const XR_PUSH_BUTTON_PRESS_DEPTH_METERS = 0.03
const XR_PUSH_BUTTON_RELEASE_DEPTH_METERS = 0.07
const FAKE_AO_FLOOR_DEPTH_METERS = 0.18
const FAKE_AO_WALL_HEIGHT_METERS = 0.28
const FAKE_AO_SURFACE_OFFSET_METERS = 0.008
const FAKE_AO_FLOOR_Y_OFFSET_METERS = 0.012
const BAKED_FLOOR_LIGHTMAP_SIZE = 512
const BAKED_FLOOR_CONTACT_SHADOW_ALPHA = 0.28
const BAKED_FLOOR_LIGHT_MAX_ALPHA = 0.36
const WINDOW_SILL_HEIGHT_METERS = 0.9
const SUN_MIN_ELEVATION = 0.08
const SUN_MAX_ELEVATION = 1.2
const LIGHT_GIMBAL_KNOB_RADIUS = 42
const MODEL_OUTLINE_COLOR = '#f97316'
const MODEL_BOUNDS_SCALE = 1.035
const MODEL_BOUNDS_LINE_THICKNESS = 0.010
const MODEL_WALL_SNAP_DISTANCE_METERS = 0.75
const MODEL_EDGE_SNAP_DISTANCE_METERS = 0.28
const MODEL_EDGE_SNAP_OVERLAP_METERS = 0.35
const MODEL_EDGE_SNAP_MIN_OVERLAP_METERS = 0.05
const WINDOW_WALL_OFFSET_SNAP_DISTANCE_METERS = 0.18
const WINDOW_WALL_OFFSET_STEP_METERS = 0.05
const WINDOW_WALL_FACE_INSET_METERS = 0.02
const WALL_MOUNT_FRAME_ANCHOR_DEPTH_METERS = 0.08
const FALLBACK_REALTIME_LOCAL_LIGHTS = 8
const MAX_REALTIME_LOCAL_LIGHTS = 11
const LOCAL_LIGHT_RENDER_POWER_SCALE = 0.08
const DEFAULT_LOCAL_LIGHT_DISTANCE = 10
const DEFAULT_LOCAL_LIGHT_FALLOFF = 1.15
const LOCAL_LIGHT_CEILING_CLEARANCE_METERS = 0.55
const PICK_CLICK_TOLERANCE_PIXELS = 3
const MAIN_THREAD_STALL_THRESHOLD_MS = 450
const MAIN_THREAD_STALL_STATUS_COOLDOWN_MS = 6000
const SCENE_PREPARATION_TIMEOUT_MS = 15000
const SHADER_WARMUP_TIMEOUT_MS = 10000
const SKIRTING_HEIGHT_METERS = 0.09
const SKIRTING_DEPTH_METERS = 0.018
const SKIRTING_DOOR_CHAMFER_METERS = SKIRTING_DEPTH_METERS
const SKIRTING_MIN_SEGMENT_METERS = 0.05
const SKIRTING_OPENING_FLOOR_TOLERANCE_METERS = 0.03
const SKIRTING_OPENING_EDGE_CLEARANCE_METERS = 0
const SKIRTING_DOOR_PROJECTION_TOLERANCE_METERS = 0.18
const SKIRTING_MITER_LIMIT_METERS = 0.12

type AspectRatioMode = 'normal' | 'super-wide' | 'wide'
type TransformMode = 'rotate' | 'scale' | 'translate'

type LightDirection = SunPosition

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
      roomSurfacePolygonsBySignature?: Map<string, Point[]>
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

type OpeningRectangle = {
  bottom: number
  id?: string
  left: number
  modelId?: string
  right: number
  top: number
}

type OpeningBoundarySegment =
  | {
      bottom: number
      edge: 'left' | 'right'
      id: string
      openingId?: string
      top: number
      x: number
    }
  | {
      edge: 'bottom' | 'top'
      id: string
      left: number
      openingId?: string
      right: number
      y: number
    }

class ModelLoadBoundary extends Component<
  { children: ReactNode; modelId: string },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.warn('Failed to render model in 3D view.', error, errorInfo)
    recordEngineLog(
      'model-load-failed',
      `${this.props.modelId}: ${error instanceof Error ? error.message : String(error)}`,
    )
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
        model.wallOpeningBottom ?? '',
        model.widthScale ?? '',
        model.depthScale ?? '',
        model.flipped ?? '',
        model.mirrored ?? '',
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
        assignment.customColor ?? '',
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

function getLoopKey(loop: Point[]) {
  return loop
    .map((point) => getPointKey(point))
    .sort()
    .join('|')
}

function getExternalWallLoops(walls: Wall[]) {
  const externalWalls = walls.filter((wall) => wall.kind !== 'internal')

  if (externalWalls.length < 3) {
    return []
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

  const uniqueLoops = new Map<string, Point[]>()

  loops.forEach((loop) => {
    const area = Math.abs(getSignedArea(loop))

    if (area < 0.01 || loop.length < 3) {
      return
    }

    const loopKey = getLoopKey(loop)
    const existingLoop = uniqueLoops.get(loopKey)

    if (!existingLoop || area > Math.abs(getSignedArea(existingLoop))) {
      uniqueLoops.set(loopKey, loop)
    }
  })

  return Array.from(uniqueLoops.values()).sort(
    (firstLoop, secondLoop) =>
      Math.abs(getSignedArea(secondLoop)) - Math.abs(getSignedArea(firstLoop)),
  )
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

function getFloorFootprints(floor: FloorLevel) {
  const loops = getExternalWallLoops(floor.walls)
  const externalThickness =
    floor.walls.find((wall) => wall.kind !== 'internal')?.thickness ?? 0

  return loops.map((loop) => getOffsetFootprint(loop, externalThickness / 2))
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

function getCeilingSlabFootprints(upperFloor: FloorLevel | null) {
  return upperFloor ? getFloorFootprints(upperFloor) : []
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

function smoothstep(minimum: number, maximum: number, value: number) {
  const normalized = Math.max(
    0,
    Math.min(1, (value - minimum) / (maximum - minimum)),
  )

  return normalized * normalized * (3 - 2 * normalized)
}

function getSunAppearance(elevation: number) {
  const daylightBlend = smoothstep(SUN_MIN_ELEVATION, 0.55, elevation)
  const intensityBlend = smoothstep(SUN_MIN_ELEVATION, 0.42, elevation)
  const color = new Color('#ff5a2f').lerp(
    new Color('#fff8ee'),
    daylightBlend,
  )

  return {
    color,
    intensity: 0.55 + intensityBlend * 0.75,
    warmth: 1 - daylightBlend,
  }
}

function SunLight({
  enabled,
  lightDirection,
  sceneBounds,
  shadowMapSize = 2048,
  shadows,
}: {
  enabled: boolean
  lightDirection: LightDirection
  sceneBounds: ReturnType<typeof getSceneBounds>
  shadowMapSize?: number
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
  const sunAppearance = getSunAppearance(lightDirection.elevation)
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
        color={sunAppearance.color}
        position={lightPosition}
        intensity={enabled ? sunAppearance.intensity : 0}
        castShadow={enabled && shadows}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
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

function getRenderableRoomContainingPoint(
  rooms: DetectedRoom[],
  point: Point,
  roomSurfacePolygonsBySignature?: Map<string, Point[]>,
) {
  const containingRooms = rooms
    .flatMap((room) => {
      const polygon = getRenderableRoomPolygon(
        room,
        roomSurfacePolygonsBySignature,
      )

      return polygon && isPointInsideOrOnPolygon(point, polygon)
        ? [{ polygon, room }]
        : []
    })
    .sort(
      (first, second) =>
        Math.abs(getSignedArea(first.polygon)) -
        Math.abs(getSignedArea(second.polygon)),
    )

  return containingRooms[0]?.room ?? getRoomContainingPoint(rooms, point)
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
  const sideOneAssignment = getWallFaceMaterialAssignmentForSide(
    wallMaterialAssignments,
    1,
    segmentTop,
  )
  const sideTwoAssignment = getWallFaceMaterialAssignmentForSide(
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
  showWallPerimeter,
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
  showWallPerimeter: boolean
  surfaceAssignments: SurfaceMaterialAssignment[]
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const pickMeshRef = useRef<Object3D>(null!)
  const walls = useMemo(
    () =>
      (roomSurfaceDebugRenderedWalls ?? renderedWalls).map(
        (renderedWall) => renderedWall.wall,
      ),
    [renderedWalls, roomSurfaceDebugRenderedWalls],
  )
  const wallsById = useMemo(
    () => new Map(walls.map((wall) => [wall.id, wall])),
    [walls],
  )
  const exteriorWallSidesByWallId = useMemo(
    () => getExteriorWallSidesByWallId(walls, rooms),
    [rooms, walls],
  )
  const wallOpeningDepthsByModelId = useMemo(
    () => getWallOpeningDepthsByModelId(walls),
    [walls],
  )
  const faces = useMemo(() => {
    return buildFloorWallSurfaceFaces({
      contextRenderedWalls: roomSurfaceDebugRenderedWalls,
      externalFootprintWallIds,
      exteriorWallSidesByWallId,
      renderedWalls,
      roomSurfaceRendererEnabled: ROOM_SURFACE_WALL_RENDERER_ENABLED,
      rooms,
      useWallBodyPerimeterMesh: WALL_BODY_PERIMETER_MESH_ENABLED,
      wallOpeningDepthsByModelId,
    })
  }, [
    exteriorWallSidesByWallId,
    externalFootprintWallIds,
    renderedWalls,
    roomSurfaceDebugRenderedWalls,
    rooms,
    wallOpeningDepthsByModelId,
  ])
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
      WALL_RENDER_DEBUG_ENABLED
        ? buildRoomWallSurfacePlans({
            includeWallsWithOpenings: true,
            renderedWalls: roomSurfaceDebugRenderedWalls ?? renderedWalls,
            rooms,
          })
        : [],
    [renderedWalls, roomSurfaceDebugRenderedWalls, rooms],
  )
  useEffect(() => {
    if (!WALL_RENDER_DEBUG_ENABLED) {
      return
    }

    recordRoomWallSurfacePlans(floorId, roomSurfaceDebugPlans)
  }, [floorId, roomSurfaceDebugPlans])
  useEffect(() => {
    if (!WALL_RENDER_DEBUG_ENABLED) {
      return
    }

    recordRoomSurfaceFaces(floorId, faces)
  }, [faces, floorId])
  useEffect(() => {
    if (!WALL_RENDER_DEBUG_ENABLED) {
      return
    }

    recordWallFaces(floorId, faces)
  }, [faces, floorId])
  useEffect(() => {
    if (!WALL_RENDER_DEBUG_ENABLED) {
      return
    }

    recordWallGeometryDump({
      faces,
      floorId,
      renderedWalls,
      rooms,
    })
  }, [faces, floorId, renderedWalls, rooms])
  const renderFaces = useMemo(
    () => applyFragmentMaterialSources(faces, surfaceAssignments),
    [faces, surfaceAssignments],
  )
  const payload = useMemo(
    () =>
      buildWallBufferGeometryPayload(renderFaces, {
        floorId,
      }),
    [floorId, renderFaces],
  )
  const coplanarSurfaceGroups = useMemo(
    () => buildCoplanarWallSurfaceGroups(faces),
    [faces],
  )
  const pickPayload = useMemo(
    () => {
      const nextPayload = buildWallBufferGeometryPayload(faces, {
        floorId,
        groupBy: 'face',
      })
      const pickTargets = new Map<number, SelectableSurface>()

      nextPayload.pickTargets.forEach((target, materialIndex) => {
          if (target.type !== 'wall-surface-fragment') {
            pickTargets.set(materialIndex, target)
            return
          }

          const fragments = coplanarSurfaceGroups.get(target.fragmentId)

          if (!fragments || fragments.length === 0) {
            pickTargets.set(materialIndex, target)
            return
          }

          const primaryFragment = fragments[0]

          pickTargets.set(
            materialIndex,
            {
              ...target,
              ...primaryFragment,
              fragments,
            },
          )
        })

      return {
        ...nextPayload,
        pickTargets,
      }
    },
    [coplanarSurfaceGroups, faces, floorId],
  )
  const geometry = useMemo(() => createWallBufferGeometry(payload), [payload])
  const pickGeometry = useMemo(
    () => createWallBufferGeometry(pickPayload),
    [pickPayload],
  )
  const selectedFaces = useMemo(() => {
    if (selectedSurface?.type === 'wall-surface-fragment') {
      const selectedFragmentKeys = new Set(
        (selectedSurface.fragments ?? [selectedSurface]).map(
          (fragment) =>
            `${fragment.wallId}:${fragment.side}:${fragment.fragmentId}`,
        ),
      )

      return faces.filter(
        (face) =>
          typeof face.pickSource.side === 'number' &&
          selectedFragmentKeys.has(
            `${face.pickSource.wallId}:${face.pickSource.side}:${face.faceId}`,
          ),
      )
    }

    if (selectedSurface?.type === 'wall-face') {
      return faces.filter(
        (face) =>
          face.pickSource.wallId === selectedSurface.wallId &&
          face.pickSource.side === selectedSurface.side,
      )
    }

    if (selectedWallId) {
      return faces.filter((face) => face.pickSource.wallId === selectedWallId)
    }

    return []
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
        frustumCulled={false}
        geometry={geometry}
        position={[0, elevation, 0]}
        receiveShadow={castsShadow}
        renderOrder={2}
        userData={{ houseDesignerRole: 'wall-engine-render' }}
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
        frustumCulled={false}
        geometry={pickGeometry}
        position={[0, elevation, 0]}
        renderOrder={1}
        userData={{ houseDesignerRole: 'wall-engine-pick' }}
      >
        <meshBasicMaterial
          color="#000000"
          side={DoubleSide}
          visible={false}
        />
      </mesh>
      {selectedGeometry && !wireframe ? (
        <mesh
          frustumCulled={false}
          geometry={selectedGeometry}
          position={[0, elevation, 0]}
          renderOrder={9}
          userData={{ houseDesignerRole: 'wall-engine-highlight' }}
        >
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
      {showWallPerimeter ? (
        <WallPerimeterDebugOverlay
          elevation={elevation}
          height={Math.max(...walls.map((wall) => wall.height), 0)}
          walls={walls}
        />
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

function createWallPerimeterDebugGeometry(
  footprints: Pick<WallBodyPerimeter, 'holes' | 'outline'>[],
  y: number,
) {
  const positions: number[] = []
  const addRing = (ring: Point[]) => {
    if (ring.length < 2) {
      return
    }

    ring.forEach((start, index) => {
      const end = ring[(index + 1) % ring.length]

      positions.push(start.x, y, start.y, end.x, y, end.y)
    })
  }

  footprints.forEach((footprint) => {
    addRing(footprint.outline)
    footprint.holes.forEach(addRing)
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return geometry
}

function WallPerimeterDebugOverlay({
  elevation,
  height,
  walls,
}: {
  elevation: number
  height: number
  walls: Wall[]
}) {
  const plan = useMemo(() => buildWallBodyPerimeters(walls), [walls])
  const geometry = useMemo(
    () => createWallPerimeterDebugGeometry(plan.perimeters, height + 0.08),
    [height, plan.perimeters],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  if (plan.perimeters.length === 0) {
    return null
  }

  return (
    <lineSegments geometry={geometry} position={[0, elevation, 0]} renderOrder={16}>
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
  source: {
    fragmentId?: string
    role?: 'cap' | 'room-surface'
    side?: WallSide
    wallId: string
  }
  surfaceAssignments: SurfaceMaterialAssignment[]
  wallsById: Map<string, Wall>
  wireframe: boolean
}) {
  const wall = wallsById.get(source.wallId)
  const wallMaterialAssignments = wall
    ? getWallSurfaceMaterialAssignments(surfaceAssignments, wall.id)
    : []
  const ownSideAssignment =
    wall
      ? getWallMaterialAssignmentForSource(
          wallMaterialAssignments,
          source,
          wall.height,
        )
      : undefined
  const capSideAssignment =
    wall && (source.side === 1 || source.side === -1)
      ? getExternalWallSlabEdgeMaterialAssignment(
          surfaceAssignments,
          wall,
          source.side,
        )
      : undefined
  const capSideOneAssignment =
    wall && source.role === 'cap'
      ? getExternalWallSlabEdgeMaterialAssignment(surfaceAssignments, wall, 1)
      : undefined
  const capSideTwoAssignment =
    wall && source.role === 'cap'
      ? getExternalWallSlabEdgeMaterialAssignment(surfaceAssignments, wall, -1)
      : undefined
  const capSharedAssignment =
    capSideOneAssignment && capSideTwoAssignment
      ? wallMaterialAssignmentsMatch(capSideOneAssignment, capSideTwoAssignment)
        ? capSideOneAssignment
        : undefined
      : capSideOneAssignment ?? capSideTwoAssignment
  const assignment =
    source.role === 'cap'
      ? capSideAssignment ?? capSharedAssignment ?? ownSideAssignment
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

function getWallSurfaceMaterialAssignments(
  surfaceAssignments: SurfaceMaterialAssignment[],
  wallId: string,
) {
  return surfaceAssignments.filter(
    (assignment) =>
      (assignment.target.type === 'wall-face' ||
        assignment.target.type === 'wall-surface-fragment') &&
      assignment.target.wallId === wallId,
  )
}

function getWallFaceMaterialAssignmentForSide(
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

function getExternalWallSlabEdgeMaterialAssignment(
  surfaceAssignments: SurfaceMaterialAssignment[],
  wall: Wall,
  side: Exclude<SurfaceWallSide, 'both'>,
) {
  const wallAssignments = getWallSurfaceMaterialAssignments(
    surfaceAssignments,
    wall.id,
  )
  const fragmentAssignment = wallAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      (assignment.coverageHeight ?? Number.POSITIVE_INFINITY) >=
        wall.height - 0.001 &&
      (assignment.target.side === 'both' || assignment.target.side === side),
  )

  return (
    fragmentAssignment ??
    getWallFaceMaterialAssignmentForSide(wallAssignments, side, wall.height)
  )
}

function getWallFragmentMaterialAssignmentForSide(
  wallMaterialAssignments: SurfaceMaterialAssignment[],
  fragmentId: string,
  side: Exclude<SurfaceWallSide, 'both'>,
  height: number,
) {
  return wallMaterialAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      assignment.target.fragmentId === fragmentId &&
      (assignment.coverageHeight ?? Number.POSITIVE_INFINITY) >= height - 0.001 &&
      (assignment.target.side === 'both' || assignment.target.side === side),
  )
}

function getWallMaterialAssignmentForSource(
  wallMaterialAssignments: SurfaceMaterialAssignment[],
  source: {
    fragmentId?: string
    side?: WallSide
  },
  height: number,
) {
  if (typeof source.side !== 'number') {
    return undefined
  }

  return (
    (source.fragmentId
      ? getWallFragmentMaterialAssignmentForSide(
          wallMaterialAssignments,
          source.fragmentId,
          source.side,
          height,
        )
      : undefined) ??
    getWallFaceMaterialAssignmentForSide(
      wallMaterialAssignments,
      source.side,
      height,
    )
  )
}

function getWallFragmentMaterialAssignmentForFace(
  surfaceAssignments: SurfaceMaterialAssignment[],
  face: WallEngineFace,
  currentFaceIds?: ReadonlySet<string>,
) {
  if (typeof face.pickSource.side !== 'number') {
    return undefined
  }

  const exactAssignment = surfaceAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      assignment.target.wallId === face.pickSource.wallId &&
      (assignment.target.fragmentId === face.faceId ||
        face.faceId.startsWith(`${assignment.target.fragmentId}:uncovered:`)) &&
      (assignment.target.side === 'both' ||
        assignment.target.side === face.pickSource.side),
  )

  if (exactAssignment) {
    return exactAssignment
  }

  const sameSideAssignments = surfaceAssignments.filter(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      assignment.target.wallId === face.pickSource.wallId &&
      (assignment.target.side === 'both' ||
        assignment.target.side === face.pickSource.side),
  )

  if (sameSideAssignments.length === 1) {
    return sameSideAssignments[0]
  }

  return surfaceAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      assignment.target.wallId === face.pickSource.wallId &&
      !currentFaceIds?.has(assignment.target.fragmentId) &&
      (assignment.target.side === 'both' ||
        assignment.target.side === face.pickSource.side),
  )
}

function applyFragmentMaterialSources(
  faces: WallEngineFace[],
  surfaceAssignments: SurfaceMaterialAssignment[],
) {
  const currentFaceIds = new Set(faces.map((face) => face.faceId))

  return faces.map((face) => {
    const fragmentAssignment = getWallFragmentMaterialAssignmentForFace(
      surfaceAssignments,
      face,
      currentFaceIds,
    )
    const fragmentId =
      fragmentAssignment?.target.type === 'wall-surface-fragment'
        ? fragmentAssignment.target.fragmentId
        : undefined

    return fragmentId
      ? {
          ...face,
          materialSource: {
            ...face.materialSource,
            fragmentId,
          },
        }
      : face
  })
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
const sharedSurfaceKtx2Loader = new KTX2Loader()
let sharedSurfaceKtx2LoaderRenderer: WebGLRenderer | null = null
const WALL_TEXTURE_MAX_SIZE = 1024
const engineActivityListeners = new Set<
  (activity: EngineActivityMessage) => void
>()
const ENGINE_LOG_LIMIT = 600
const WALL_RENDER_DEBUG_LIMIT = 300
const WALL_RENDER_DEBUG_ENABLED = false
const WALL_RENDER_DEBUG_SNAPSHOTS_ENABLED = false
const ENGINE_CONSOLE_LINE_LIMIT = 200
const engineLogEntries: EngineLogEntry[] = []
const engineLogListeners = new Set<(entry: EngineLogEntry) => void>()
const wallRenderDebugEntries: EngineLogEntry[] = []
const wallRenderDebugCurrentEntries = new Map<string, EngineLogEntry>()
const roomWallSurfacePlanDebugEntries = new Map<
  string,
  RoomWallSurfacePlanDebugEntry
>()
const roomSurfaceFaceDebugEntries = new Map<string, RoomSurfaceFaceDebugEntry[]>()
const wallFaceDebugEntries = new Map<string, WallFaceDebugEntry[]>()
const wallGeometryDebugEntries = new Map<string, WallGeometryDumpEntry>()
const footprintFaceDebugEntries = new Map<string, FootprintFaceDebugEntry[]>()
const footprintEdgeDebugEntries = new Map<string, FootprintEdgeDebugEntry[]>()
const ceilingSlabDebugEntries = new Map<string, CeilingSlabDebugEntry>()
const ceilingSlabEdgeDebugEntries = new Map<string, CeilingSlabEdgeDebugEntry[]>()
let engineLogSequence = 0

function getSharedKtx2Loader(gl: WebGLRenderer) {
  if (sharedSurfaceKtx2LoaderRenderer !== gl) {
    sharedSurfaceKtx2Loader.detectSupport(gl)
    sharedSurfaceKtx2LoaderRenderer = gl
  }

  return sharedSurfaceKtx2Loader
}

function setGltfKtx2Loader(
  loader: { setKTX2Loader: (ktx2Loader: never) => unknown },
  gl: WebGLRenderer,
) {
  loader.setKTX2Loader(getSharedKtx2Loader(gl) as never)
}
let surfaceTextureLoadsInFlight = 0
let sceneObjectDebugProvider: (() => SceneObjectDebugSummary) | null = null
let sceneRoleVisibilityController:
  | ((role: string, visible: boolean) => number)
  | null = null

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

function getFootprintEdgeDebugEntries(floorId?: string) {
  return Array.from(footprintEdgeDebugEntries.values())
    .flat()
    .filter((entry) => !floorId || entry.floorId === floorId)
    .sort(
      (first, second) =>
        first.floorId.localeCompare(second.floorId) ||
        first.kind.localeCompare(second.kind) ||
        first.sourceWalls.localeCompare(second.sourceWalls) ||
        first.ringIndex - second.ringIndex ||
        first.edgeIndex - second.edgeIndex ||
        first.startX - second.startX ||
        first.startY - second.startY,
    )
}

function getFootprintFaceDebugEntries(floorId?: string) {
  return Array.from(footprintFaceDebugEntries.values())
    .flat()
    .filter((entry) => !floorId || entry.floorId === floorId)
    .sort(
      (first, second) =>
        first.floorId.localeCompare(second.floorId) ||
        first.kind.localeCompare(second.kind) ||
        first.minX - second.minX ||
        first.minZ - second.minZ ||
        first.start - second.start,
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
      footprintFaceDebugEntries.clear()
      footprintEdgeDebugEntries.clear()
    },
    current: () => Array.from(wallRenderDebugCurrentEntries.values()),
    entries: wallRenderDebugEntries,
    footprintFaces: getFootprintFaceDebugEntries,
    footprintEdges: getFootprintEdgeDebugEntries,
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
    sceneObjects: () => sceneObjectDebugProvider?.() ?? null,
    ceilingSlabs: () => Array.from(ceilingSlabDebugEntries.values()),
    ceilingSlabEdges: () =>
      Array.from(ceilingSlabEdgeDebugEntries.values()).flat(),
    summary: () =>
      Array.from(wallRenderDebugCurrentEntries.values()).map((entry) => ({
        detail: entry.detail,
        type: entry.type,
      })),
    tableCurrent: () => {
      console.table(Array.from(wallRenderDebugCurrentEntries.values()))
    },
    tableFootprintFaces: (floorId?: string) => {
      console.table(getFootprintFaceDebugEntries(floorId))
    },
    tableFootprintEdges: (floorId?: string) => {
      console.table(getFootprintEdgeDebugEntries(floorId))
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
    tableSceneObjects: () => {
      const summary = sceneObjectDebugProvider?.()

      console.table(summary?.wallLikeMeshes ?? [])
      return summary
    },
    tableCeilingSlabs: () => {
      console.table(Array.from(ceilingSlabDebugEntries.values()))
    },
    tableCeilingSlabEdges: () => {
      console.table(Array.from(ceilingSlabEdgeDebugEntries.values()).flat())
    },
    setRoleVisible: (role, visible) =>
      sceneRoleVisibilityController?.(role, visible) ?? 0,
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
    typeof window.houseDesignerWallRenderDebug.footprintFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableFootprintFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.footprintEdges !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableFootprintEdges !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.routes !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.roomSurfaceFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.roomSurfaceFaceSummary !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.wallFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.ceilingSlabs !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.ceilingSlabEdges !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.sceneObjects !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableRoomSurfaceFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableRoomSurfaceFaceSummary !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableWallFaces !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableCeilingSlabs !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableCeilingSlabEdges !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.setRoleVisible !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.roomPlanProblemDetails !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.roomPlanProblems !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableRoomPlanProblemDetails !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableRoomPlanProblems !== 'function' ||
    typeof window.houseDesignerWallRenderDebug.tableSceneObjects !== 'function'
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

  engineLogListeners.forEach((listener) => listener(entry))

  return entry
}

function subscribeEngineLog(listener: (entry: EngineLogEntry) => void) {
  engineLogListeners.add(listener)

  return () => {
    engineLogListeners.delete(listener)
  }
}

function formatEngineLogTime(timeMs: number) {
  return `${(timeMs / 1000).toFixed(1)}s`
}

function formatEngineConsoleLine(entry: EngineLogEntry) {
  const detail = entry.detail ? ` ${entry.detail}` : ''

  if (entry.type === 'renderer-stats') {
    return `[${formatEngineLogTime(entry.timeMs)}] renderer:${detail}`
  }

  if (entry.type === 'shader-programs-added') {
    return `[${formatEngineLogTime(entry.timeMs)}] shaders:${detail}`
  }

  if (entry.type === 'model-loaded') {
    return `[${formatEngineLogTime(entry.timeMs)}] model:${detail}`
  }

  if (entry.type === 'texture-loaded' || entry.type === 'texture-load-failed') {
    return `[${formatEngineLogTime(entry.timeMs)}] texture:${detail}`
  }

  if (entry.type === 'shader-warmup-start') {
    return `[${formatEngineLogTime(entry.timeMs)}] shaders: compiling scene`
  }

  if (entry.type === 'shader-warmup-complete') {
    return `[${formatEngineLogTime(entry.timeMs)}] shaders: scene ready`
  }

  if (entry.type === 'shader-warmup-timeout') {
    return `[${formatEngineLogTime(entry.timeMs)}] shaders: warmup timeout${detail}`
  }

  if (entry.type === 'activity') {
    return `[${formatEngineLogTime(entry.timeMs)}]${detail}`
  }

  return `[${formatEngineLogTime(entry.timeMs)}] ${entry.type}:${detail}`
}

function getAssetFileName(assetUrl: string) {
  try {
    return new URL(assetUrl, window.location.href).pathname.split('/').pop() ??
      assetUrl
  } catch {
    return assetUrl.split(/[\\/]/).pop() ?? assetUrl
  }
}

function formatMeters(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}m`
}

function formatDimensions(width: number, height: number, depth: number) {
  return `${formatMeters(width)} x ${formatMeters(height)} x ${formatMeters(depth)}`
}

function getPlacedPortalModelIds(floors: FloorLevel[]) {
  return Array.from(
    new Set(
      floors.flatMap((floor) =>
        (floor.models ?? [])
          .map((model) => model.modelId)
          .filter((modelId) => modelId.startsWith('portal-model-')),
      ),
    ),
  ).sort()
}

function getRegisteredPortalModelCount() {
  return Array.from(modelsById.keys()).filter((modelId) =>
    modelId.startsWith('portal-model-'),
  ).length
}

function recordWallRenderDebug(
  type: string,
  detail?: string,
  snapshot?: string,
) {
  if (!WALL_RENDER_DEBUG_ENABLED) {
    return null
  }

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
    gl,
    isColorMap,
    maxSize,
    repeatX,
    repeatY,
    rotationRadians,
  }: {
    gl?: WebGLRenderer
    isColorMap: boolean
    maxSize?: number
    repeatX: number
    repeatY: number
    rotationRadians: number
  },
) {
  return new Promise<Texture>((resolve) => {
    const isKtx2 = textureUrl.toLowerCase().includes('.ktx2')

    if (isKtx2 && !gl) {
      resolve(undefined as unknown as Texture)
      return
    }

    const loader = isKtx2
      ? (() => {
          return getSharedKtx2Loader(gl as WebGLRenderer)
        })()
      : sharedSurfaceTextureLoader

    try {
      loader.load(
        textureUrl,
        (texture) => {
          const configuredTexture = configureSurfaceTexture(texture, {
              isColorMap,
              maxSize,
              repeatX,
              repeatY,
              rotationRadians,
            })
          const size = getTextureImageSize(configuredTexture.image)
          const sizeDetail = size ? ` ${size.width}x${size.height}` : ''

          recordEngineLog(
            'texture-loaded',
            `${getAssetFileName(textureUrl)}${sizeDetail}`,
          )
          resolve(configuredTexture)
        },
        undefined,
        () => {
          recordEngineLog(
            'texture-load-failed',
            getAssetFileName(textureUrl),
          )
          resolve(undefined as unknown as Texture)
        },
      )
    } catch {
      recordEngineLog('texture-load-failed', getAssetFileName(textureUrl))
      resolve(undefined as unknown as Texture)
    }
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

function getOrLoadSurfaceTextures(
  request: SurfaceTextureRequest,
  gl?: WebGLRenderer,
) {
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
        gl,
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
  const { gl } = useThree()
  const [textureState, setTextureState] = useState<{
    key: string
    textures: LoadedSurfaceTextures
  }>({ key: '', textures: {} })
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
          setTextureState({
            key: textureRequest.textureCacheKey,
            textures: {},
          })
        }
      })
      return
    }

    const cachedTextures = surfaceTextureCache.get(textureRequest.textureCacheKey)

    if (cachedTextures) {
      queueMicrotask(() => {
        if (!cancelled) {
          setTextureState({
            key: textureRequest.textureCacheKey,
            textures: cachedTextures,
          })
        }
      })
      return
    }

    const cachedTexturePromise = surfaceTexturePromiseCache.get(
      textureRequest.textureCacheKey,
    )
    const texturePromise = getOrLoadSurfaceTextures(textureRequest, gl)

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
        setTextureState({
          key: textureRequest.textureCacheKey,
          textures: nextTextures,
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    gl,
    textureRequest,
  ])

  return textureState.key === textureRequest.textureCacheKey
    ? textureState.textures
    : {}
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
  polygonOffsetFactor?: number
  polygonOffsetUnits?: number
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
  const baseColor = assignment.customColor ?? material.pbr.baseColor ?? '#e2e8f0'

  return (
    <meshStandardMaterial
      attach={attach}
      aoMap={textures.aoMap ?? null}
      color={baseColor}
      displacementMap={textures.displacementMap ?? null}
      displacementScale={displacementEnabled ? material.pbr.displacementScale ?? 0 : 0}
      map={textures.map ?? null}
      metalness={material.pbr.metalness ?? 0}
      metalnessMap={textures.metalnessMap ?? null}
      normalMap={textures.normalMap ?? null}
      polygonOffset={
        polygonOffsetFactor !== undefined || polygonOffsetUnits !== undefined
      }
      polygonOffsetFactor={polygonOffsetFactor}
      polygonOffsetUnits={polygonOffsetUnits}
      roughness={material.pbr.roughness ?? 0.7}
      roughnessMap={textures.roughnessMap ?? null}
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
  const { gl } = useThree()

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
      useGLTF.preload(sourceUrl, true, true, (loader) => {
        setGltfKtx2Loader(loader, gl)
      })
    })
  }, [floors, gl, modelAssetVersion])

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

      if (
        assignment.target.type === 'wall-face' ||
        assignment.target.type === 'wall-surface-fragment'
      ) {
        addRequest(assignment, material, {
          displacementEnabled: false,
          textureQuality: getWallSurfaceTextureQuality(material),
        })
        return
      }

      if (
        assignment.target.type === 'room-floor' ||
        assignment.target.type === 'ceiling' ||
        assignment.target.type === 'portal-floor'
      ) {
        addRequest(assignment, material, {
          displacementEnabled: false,
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

        const upperFloor = renderedFloors
          .map(({ floor }) => floor)
          .filter((floor) => floor.elevation > renderedFloor.floor.elevation)
          .sort((first, second) => first.elevation - second.elevation)[0]
        const slabFootprints = getCeilingSlabFootprints(upperFloor ?? null)

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
    Promise.all(
      uncachedRequests.map((request) => getOrLoadSurfaceTextures(request, gl)),
    )
      .catch((error) => {
        recordEngineLog(
          'texture-preload-failed',
          error instanceof Error ? error.message : String(error),
        )
      })
      .finally(() => {
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
  }, [floors, gl, onPendingChange, renderedFloors, surfaceAssignments])

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
    if (!WALL_RENDER_DEBUG_ENABLED) {
      return
    }

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
      assignment: getWallFaceMaterialAssignmentForSide(
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
    const widthScale = model.widthScale ?? 1
    const width = Math.max(
      (definition.openingWidth ?? definition.width) * scale * widthScale,
      0.3,
    )
    const interval = getProjectedInterval(
      renderedWall.wall,
      getProjectedModelOffsetOnWall(model, renderedWall.wall) +
        (definition.openingCenterOffset ?? 0) * scale * widthScale,
      width,
    )

    return interval ? [interval] : []
  })

  return [...openingIntervals, ...modelIntervals]
    .filter((interval) => interval.end - interval.start >= SKIRTING_MIN_SEGMENT_METERS)
    .sort((firstInterval, secondInterval) => firstInterval.start - secondInterval.start)
}

type SkirtingSegment = {
  chamferEnd?: boolean
  chamferStart?: boolean
  end: Point
  start: Point
}

function clipSkirtingSegmentsForDoorways(
  segments: SkirtingSegment[],
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

    const clippedSegments: SkirtingSegment[] = []
    let cursor = 0

    for (const interval of intervals) {
      if (interval.start - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
        clippedSegments.push({
          chamferEnd: true,
          chamferStart: cursor === 0 ? segment.chamferStart : true,
          end: getPointAtSegmentDistance(segment.start, unit, interval.start),
          start: getPointAtSegmentDistance(segment.start, unit, cursor),
        })
      }

      cursor = Math.max(cursor, interval.end)
    }

    if (segmentLength - cursor >= SKIRTING_MIN_SEGMENT_METERS) {
      clippedSegments.push({
        chamferEnd: segment.chamferEnd,
        chamferStart: true,
        end: getPointAtSegmentDistance(segment.start, unit, segmentLength),
        start: getPointAtSegmentDistance(segment.start, unit, cursor),
      })
    }

    return clippedSegments
  })
}

function getSkirtingOffsetEdge({
  end,
  inwardNormal,
  start,
}: {
  end: Point
  inwardNormal: { x: number; z: number }
  start: Point
}) {
  const offset = SKIRTING_DEPTH_METERS

  return {
    end: {
      x: end.x + inwardNormal.x * offset,
      y: end.y + inwardNormal.z * offset,
    },
    start: {
      x: start.x + inwardNormal.x * offset,
      y: start.y + inwardNormal.z * offset,
    },
  }
}

function getSkirtingMiterPoint(
  currentRun: {
    end: Point
    inwardNormal: { x: number; z: number }
    start: Point
  },
  adjacentRun: {
    end: Point
    inwardNormal: { x: number; z: number }
    start: Point
  },
  endpoint: 'end' | 'start',
) {
  const currentOffset = getSkirtingOffsetEdge(currentRun)
  const adjacentOffset = getSkirtingOffsetEdge(adjacentRun)
  const intersection = getLineIntersection(
    currentOffset.start,
    currentOffset.end,
    adjacentOffset.start,
    adjacentOffset.end,
  )

  if (!intersection) {
    return null
  }

  const corner = endpoint === 'start' ? currentRun.start : currentRun.end

  return getPointDistance(corner, intersection) <= SKIRTING_MITER_LIMIT_METERS
    ? intersection
    : null
}

function createSkirtingPrismGeometry({
  elevation,
  end,
  endInner,
  start,
  startInner,
}: {
  elevation: number
  end: Point
  endInner: Point
  start: Point
  startInner: Point
}) {
  const bottom = elevation
  const top = elevation + SKIRTING_HEIGHT_METERS
  const positions = [
    [start.x, bottom, start.y],
    [end.x, bottom, end.y],
    [endInner.x, bottom, endInner.y],
    [startInner.x, bottom, startInner.y],
    [start.x, top, start.y],
    [end.x, top, end.y],
    [endInner.x, top, endInner.y],
    [startInner.x, top, startInner.y],
  ] as const
  const indices = [
    0, 5, 1, 0, 4, 5,
    1, 6, 2, 1, 5, 6,
    2, 7, 3, 2, 6, 7,
    3, 4, 0, 3, 7, 4,
    4, 6, 5, 4, 7, 6,
    0, 2, 3, 0, 1, 2,
  ]
  const indexedGeometry = new BufferGeometry()

  indexedGeometry.setAttribute(
    'position',
    new Float32BufferAttribute(positions.flat(), 3),
  )
  indexedGeometry.setIndex(indices)
  const geometry = indexedGeometry.toNonIndexed()

  indexedGeometry.dispose()
  geometry.computeVertexNormals()

  return geometry
}

type SkirtingRun = {
  chamferEnd?: boolean
  chamferStart?: boolean
  edgeIndex: number
  end: Point
  inwardNormal: { x: number; z: number }
  key: string
  polygon: Point[]
  segmentCount: number
  segmentIndex: number
  start: Point
}

const SkirtingRunMesh = memo(function SkirtingRunMesh({
  elevation,
  run,
  skirtingRuns,
  wireframe,
}: {
  elevation: number
  run: SkirtingRun
  skirtingRuns: SkirtingRun[]
  wireframe: boolean
}) {
  const geometry = useMemo(() => {
    const offsetEdge = getSkirtingOffsetEdge(run)
    const runDx = run.end.x - run.start.x
    const runDy = run.end.y - run.start.y
    const runLength = Math.hypot(runDx, runDy)
    const chamferDistance = Math.min(
      SKIRTING_DOOR_CHAMFER_METERS,
      Math.max(0, runLength / 2 - 0.001),
    )
    const runUnit =
      runLength > 0
        ? {
            x: runDx / runLength,
            y: runDy / runLength,
          }
        : { x: 1, y: 0 }
    const previousRun = [...skirtingRuns].reverse().find(
      (candidateRun) =>
        candidateRun.polygon === run.polygon &&
        candidateRun.edgeIndex ===
          (run.edgeIndex - 1 + run.polygon.length) % run.polygon.length,
    )
    const nextRun = skirtingRuns.find(
      (candidateRun) =>
        candidateRun.polygon === run.polygon &&
        candidateRun.edgeIndex === (run.edgeIndex + 1) % run.polygon.length,
    )
    const startInner =
      run.chamferStart
        ? {
            x: offsetEdge.start.x + runUnit.x * chamferDistance,
            y: offsetEdge.start.y + runUnit.y * chamferDistance,
          }
        : run.segmentIndex === 0 && previousRun
        ? getSkirtingMiterPoint(run, previousRun, 'start') ?? offsetEdge.start
        : offsetEdge.start
    const endInner =
      run.chamferEnd
        ? {
            x: offsetEdge.end.x - runUnit.x * chamferDistance,
            y: offsetEdge.end.y - runUnit.y * chamferDistance,
          }
        : nextRun && run.segmentIndex === run.segmentCount - 1
        ? getSkirtingMiterPoint(run, nextRun, 'end') ?? offsetEdge.end
        : offsetEdge.end

    return createSkirtingPrismGeometry({
      elevation,
      end: run.end,
      endInner,
      start: run.start,
      startInner,
    })
  }, [elevation, run, skirtingRuns])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color="#f8fafc"
        flatShading
        roughness={0.58}
        wireframe={wireframe}
      />
    </mesh>
  )
})

const SkirtingBoards = memo(function SkirtingBoards({
  elevation,
  geometryContextWalls,
  models,
  renderedWalls,
  roomSurfacePolygonsBySignature,
  rooms,
  wireframe,
}: {
  elevation: number
  geometryContextWalls: Wall[]
  models: PlacedModel[]
  renderedWalls: RenderedWall[]
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
  rooms: DetectedRoom[]
  wireframe: boolean
}) {
  const wallBodyPerimeters = useMemo(
    () => buildWallBodyPerimeters(geometryContextWalls).perimeters,
    [geometryContextWalls],
  )
  const roomPolygons = useMemo(
    () =>
      rooms
        .map((room) =>
          getRenderableRoomPolygon(room, roomSurfacePolygonsBySignature),
        )
        .filter((polygon): polygon is Point[] => Boolean(polygon)),
    [roomSurfacePolygonsBySignature, rooms],
  )
  const skirtingRuns = useMemo(
    () => {
      const renderedSideKeys = new Set<string>()
      const getSideNormal = (wall: Wall, side: Exclude<SurfaceWallSide, 'both'>) => {
        const { normal } = getWallBasis(wall)

        return {
          x: normal.x * side,
          y: normal.y * side,
        }
      }
      const sideFacesRoom = (
        wall: Wall,
        side: Exclude<SurfaceWallSide, 'both'>,
        start: Point,
        end: Point,
      ) => {
        if (wall.kind === 'internal') {
          return true
        }

        const sideNormal = getSideNormal(wall, side)
        const sample = {
          x: (start.x + end.x) / 2 + sideNormal.x * Math.max(0.04, wall.thickness * 0.15),
          y: (start.y + end.y) / 2 + sideNormal.y * Math.max(0.04, wall.thickness * 0.15),
        }

        return roomPolygons.some((polygon) => isPointInsideOrOnPolygon(sample, polygon))
      }
      const getBestWallSideMatch = (start: Point, end: Point) =>
        geometryContextWalls
          .flatMap((wall) =>
            ([-1, 1] as const).flatMap((side) => {
              const match = getFootprintEdgeWallSideMatch(
                { end, start },
                wall,
                side,
                0.2,
              )

              if (!match || !sideFacesRoom(wall, side, start, end)) {
                return []
              }

              return [match]
            }),
          )
          .sort(
            (first, second) =>
              second.coverage - first.coverage ||
              first.offsetError - second.offsetError ||
              first.wall.id.localeCompare(second.wall.id) ||
              first.side - second.side,
          )[0] ?? null
      const createRunsForSegment = ({
        edgeIndex,
        keyPrefix,
        polygon,
        segmentEnd,
        segmentStart,
        side,
        wall,
      }: {
        edgeIndex: number
        keyPrefix: string
        polygon: Point[]
        segmentEnd: Point
        segmentStart: Point
        side: Exclude<SurfaceWallSide, 'both'>
        wall: Wall
      }) => {
        const sideNormal = getSideNormal(wall, side)
        const segments = clipSkirtingSegmentsForDoorways(
          [{ end: segmentEnd, start: segmentStart }],
          renderedWalls,
          models,
        )
        const sideKey = `${wall.id}:${side}`

        return segments
          .filter(
            (segment) =>
              Math.hypot(
                segment.end.x - segment.start.x,
                segment.end.y - segment.start.y,
              ) >= SKIRTING_MIN_SEGMENT_METERS,
          )
          .map((segment, segmentIndex, segmentList) => {
            renderedSideKeys.add(sideKey)

            return {
              chamferEnd: segment.chamferEnd,
              chamferStart: segment.chamferStart,
              edgeIndex,
              end: segment.end,
              inwardNormal: { x: sideNormal.x, z: sideNormal.y },
              key: `${keyPrefix}-${segmentIndex}`,
              polygon,
              segmentCount: segmentList.length,
              segmentIndex,
              start: segment.start,
            }
          })
      }
      const perimeterRuns = wallBodyPerimeters.flatMap((perimeter) => {
        const rings = [
          { kind: 'outline', points: perimeter.outline },
          ...perimeter.holes.map((points, index) => ({
            kind: `hole-${index}`,
            points,
          })),
        ]

        return rings.flatMap((ring) =>
          ring.points.flatMap((start, edgeIndex) => {
            const end = ring.points[(edgeIndex + 1) % ring.points.length]
            const match = getBestWallSideMatch(start, end)

            if (!match) {
              return []
            }

            return createRunsForSegment({
              edgeIndex,
              keyPrefix: `${perimeter.componentId}-${ring.kind}-${edgeIndex}`,
              polygon: ring.points,
              segmentEnd: end,
              segmentStart: start,
              side: match.side,
              wall: match.wall,
            })
          }),
        )
      })
      const fallbackRuns = geometryContextWalls.flatMap((wall, wallIndex) =>
        ([-1, 1] as const).flatMap((side) => {
          const sideKey = `${wall.id}:${side}`
          const { normal } = getWallBasis(wall)
          const start = {
            x: wall.start.x + normal.x * wall.thickness * side / 2,
            y: wall.start.y + normal.y * wall.thickness * side / 2,
          }
          const end = {
            x: wall.end.x + normal.x * wall.thickness * side / 2,
            y: wall.end.y + normal.y * wall.thickness * side / 2,
          }
          const length = Math.hypot(end.x - start.x, end.y - start.y)

          if (
            renderedSideKeys.has(sideKey) ||
            length < SKIRTING_MIN_SEGMENT_METERS ||
            !sideFacesRoom(wall, side, start, end)
          ) {
            return []
          }

          return createRunsForSegment({
            edgeIndex: wallIndex * 2 + (side === 1 ? 1 : 0),
            keyPrefix: `fallback-${wall.id}-${side}`,
            polygon: [start, end],
            segmentEnd: end,
            segmentStart: start,
            side,
            wall,
          })
        }),
      )

      return [...perimeterRuns, ...fallbackRuns]
    },
    [
      geometryContextWalls,
      models,
      renderedWalls,
      roomPolygons,
      wallBodyPerimeters,
    ],
  )

  return (
    <group renderOrder={3}>
      {skirtingRuns.map((run) => (
        <SkirtingRunMesh
          key={run.key}
          elevation={elevation}
          run={run}
          skirtingRuns={skirtingRuns}
          wireframe={wireframe}
        />
      ))}
    </group>
  )
})

function createFakeAmbientOcclusionGeometry({
  depth,
  elevation,
  geometryContextWalls,
  roomPolygons,
  wallHeight,
}: {
  depth: number
  elevation: number
  geometryContextWalls: Wall[]
  roomPolygons: Point[][]
  wallHeight: number
}) {
  const floorGeometry = new BufferGeometry()
  const wallGeometry = new BufferGeometry()
  const floorPositions: number[] = []
  const wallPositions: number[] = []
  const floorY = elevation + FAKE_AO_FLOOR_Y_OFFSET_METERS
  const wallBottomY = elevation + FAKE_AO_FLOOR_Y_OFFSET_METERS
  const wallTopY = elevation + wallHeight
  const sideFacesRoom = (
    wall: Wall,
    side: Exclude<SurfaceWallSide, 'both'>,
    start: Point,
    end: Point,
  ) => {
    if (wall.kind === 'internal') {
      return true
    }

    const { normal } = getWallBasis(wall)
    const sideNormal = {
      x: normal.x * side,
      y: normal.y * side,
    }
    const sample = {
      x: (start.x + end.x) / 2 + sideNormal.x * Math.max(0.04, wall.thickness * 0.15),
      y: (start.y + end.y) / 2 + sideNormal.y * Math.max(0.04, wall.thickness * 0.15),
    }

    return roomPolygons.some((polygon) => isPointInsideOrOnPolygon(sample, polygon))
  }

  geometryContextWalls.forEach((wall) => {
    const { length, normal } = getWallBasis(wall)

    if (length < SKIRTING_MIN_SEGMENT_METERS) {
      return
    }

    ;([-1, 1] as const).forEach((side) => {
      const sideNormal = {
        x: normal.x * side,
        y: normal.y * side,
      }
      const start = {
        x: wall.start.x + sideNormal.x * wall.thickness / 2,
        y: wall.start.y + sideNormal.y * wall.thickness / 2,
      }
      const end = {
        x: wall.end.x + sideNormal.x * wall.thickness / 2,
        y: wall.end.y + sideNormal.y * wall.thickness / 2,
      }

      if (!sideFacesRoom(wall, side, start, end)) {
        return
      }

      const outerStart = {
        x: start.x + sideNormal.x * depth,
        y: start.y + sideNormal.y * depth,
      }
      const outerEnd = {
        x: end.x + sideNormal.x * depth,
        y: end.y + sideNormal.y * depth,
      }
      const wallStart = {
        x: start.x + sideNormal.x * FAKE_AO_SURFACE_OFFSET_METERS,
        y: start.y + sideNormal.y * FAKE_AO_SURFACE_OFFSET_METERS,
      }
      const wallEnd = {
        x: end.x + sideNormal.x * FAKE_AO_SURFACE_OFFSET_METERS,
        y: end.y + sideNormal.y * FAKE_AO_SURFACE_OFFSET_METERS,
      }

      floorPositions.push(
        start.x,
        floorY,
        start.y,
        end.x,
        floorY,
        end.y,
        outerEnd.x,
        floorY,
        outerEnd.y,
        start.x,
        floorY,
        start.y,
        outerEnd.x,
        floorY,
        outerEnd.y,
        outerStart.x,
        floorY,
        outerStart.y,
      )
      wallPositions.push(
        wallStart.x,
        wallBottomY,
        wallStart.y,
        wallEnd.x,
        wallBottomY,
        wallEnd.y,
        wallEnd.x,
        wallTopY,
        wallEnd.y,
        wallStart.x,
        wallBottomY,
        wallStart.y,
        wallEnd.x,
        wallTopY,
        wallEnd.y,
        wallStart.x,
        wallTopY,
        wallStart.y,
      )
    })
  })

  floorGeometry.setAttribute(
    'position',
    new Float32BufferAttribute(floorPositions, 3),
  )
  wallGeometry.setAttribute(
    'position',
    new Float32BufferAttribute(wallPositions, 3),
  )

  return { floorGeometry, wallGeometry }
}

const FakeAmbientOcclusion = memo(function FakeAmbientOcclusion({
  depth = FAKE_AO_FLOOR_DEPTH_METERS,
  elevation,
  geometryContextWalls,
  intensity,
  roomSurfacePolygonsBySignature,
  rooms,
  visible,
  wallHeight = FAKE_AO_WALL_HEIGHT_METERS,
}: {
  depth?: number
  elevation: number
  geometryContextWalls: Wall[]
  intensity: number
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
  rooms: DetectedRoom[]
  visible: boolean
  wallHeight?: number
}) {
  const roomPolygons = useMemo(
    () =>
      rooms
        .map((room) =>
          getRenderableRoomPolygon(room, roomSurfacePolygonsBySignature),
        )
        .filter((polygon): polygon is Point[] => Boolean(polygon)),
    [roomSurfacePolygonsBySignature, rooms],
  )
  const { floorGeometry, wallGeometry } = useMemo(
    () =>
      createFakeAmbientOcclusionGeometry({
        depth,
        elevation,
        geometryContextWalls,
        roomPolygons,
        wallHeight,
      }),
    [depth, elevation, geometryContextWalls, roomPolygons, wallHeight],
  )
  const floorOpacity = Math.min(0.16, 0.075 * intensity)
  const wallOpacity = Math.min(0.11, 0.052 * intensity)

  useEffect(
    () => () => {
      floorGeometry.dispose()
      wallGeometry.dispose()
    },
    [floorGeometry, wallGeometry],
  )

  if (!visible || roomPolygons.length === 0) {
    return null
  }

  return (
    <>
      <mesh
        frustumCulled={false}
        geometry={floorGeometry}
        renderOrder={4}
        userData={{ houseDesignerRole: 'fake-ambient-occlusion-floor' }}
      >
        <meshBasicMaterial
          color="#020617"
          depthWrite={false}
          opacity={floorOpacity}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          side={DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>
      <mesh
        frustumCulled={false}
        geometry={wallGeometry}
        renderOrder={4}
        userData={{ houseDesignerRole: 'fake-ambient-occlusion-wall' }}
      >
        <meshBasicMaterial
          color="#020617"
          depthWrite={false}
          opacity={wallOpacity}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          side={DoubleSide}
          toneMapped={false}
          transparent
        />
      </mesh>
    </>
  )
})

function createFloorSlabEdgeUvGeometry({
  faceHeight,
  length,
  normalSign,
  uvBottom,
  uvEnd,
  uvStart,
}: {
  faceHeight: number
  length: number
  normalSign: -1 | 1
  uvBottom: number
  uvEnd: number
  uvStart: number
}) {
  const halfLength = length / 2
  const halfHeight = faceHeight / 2
  const geometry = new BufferGeometry()
  const vertices = [
    { position: [-halfLength, -halfHeight, 0], uv: [uvStart, uvBottom] },
    { position: [halfLength, -halfHeight, 0], uv: [uvEnd, uvBottom] },
    {
      position: [halfLength, halfHeight, 0],
      uv: [uvEnd, uvBottom + faceHeight],
    },
    {
      position: [-halfLength, halfHeight, 0],
      uv: [uvStart, uvBottom + faceHeight],
    },
  ]
  const triangleIndices =
    normalSign === 1 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]

  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      triangleIndices.flatMap((index) => vertices[index].position),
      3,
    ),
  )
  geometry.setAttribute(
    'uv',
    new Float32BufferAttribute(
      triangleIndices.flatMap((index) => vertices[index].uv),
      2,
    ),
  )
  geometry.computeVertexNormals()
  return geometry
}

const FLOOR_SLAB_EDGE_WALL_OVERLAP_METERS = CEILING_VERTICAL_OVERLAP_METERS
const FLOOR_SLAB_EDGE_UPPER_WALL_OVERLAP_METERS = 0.02
const FLOOR_SLAB_REVEAL_PLAN_OVERLAP_METERS = 0.002
const FLOOR_SLAB_REVEAL_TOP_OVERLAP_METERS = 0.002

function FloorSlabEdgeFace({
  assignment,
  centerY,
  edgeIndex,
  height,
  floorId,
  floor,
  isSelected,
  material,
  onRegisterPickTarget,
  point,
  pickOnly = false,
  showDefaultSurface = false,
  nextPoint,
  uvFrame,
  wireframe,
}: {
  assignment?: SurfaceMaterialAssignment
  centerY?: number
  edgeIndex: number
  height?: number
  floorId: string
  floor: FloorLevel
  isSelected: boolean
  material?: SurfaceMaterialProduct
  nextPoint: Point
  onRegisterPickTarget?: (target: PickTarget) => () => void
  point: Point
  pickOnly?: boolean
  showDefaultSurface?: boolean
  uvFrame?: {
    bottom: number
    end: number
    normalSign: -1 | 1
    start: number
  }
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const dx = nextPoint.x - point.x
  const dz = nextPoint.y - point.y
  const length = Math.hypot(dx, dz)
  const centerX = (point.x + nextPoint.x) / 2
  const centerZ = (point.y + nextPoint.y) / 2
  const rotationY = -Math.atan2(dz, dx)
  const lowerWallOverlap = uvFrame ? FLOOR_SLAB_EDGE_WALL_OVERLAP_METERS : 0
  const upperWallOverlap = 0
  const faceHeight =
    (height ?? floor.slabThickness) + lowerWallOverlap + upperWallOverlap
  const y =
    (centerY ?? floor.elevation + floor.roomHeight + floor.slabThickness / 2) +
    (upperWallOverlap - lowerWallOverlap) / 2
  const uvGeometry = useMemo(
    () =>
      uvFrame
        ? createFloorSlabEdgeUvGeometry({
            faceHeight,
            length,
            normalSign: uvFrame.normalSign,
            uvBottom: uvFrame.bottom - lowerWallOverlap,
            uvEnd: uvFrame.end,
            uvStart: uvFrame.start,
          })
        : null,
    [faceHeight, length, lowerWallOverlap, uvFrame],
  )
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
  useEffect(() => () => uvGeometry?.dispose(), [uvGeometry])

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
      <mesh
        castShadow={!pickOnly && (showDefaultSurface || Boolean(assignment))}
        receiveShadow={!pickOnly && (showDefaultSurface || Boolean(assignment))}
        ref={meshRef}
        userData={{ houseDesignerRole: 'ceiling-slab-edge' }}
      >
        {uvGeometry ? (
          <primitive attach="geometry" object={uvGeometry} />
        ) : (
          <planeGeometry args={[length, faceHeight]} />
        )}
        {pickOnly ? (
          <meshBasicMaterial
            colorWrite={false}
            depthWrite={false}
            side={DoubleSide}
          />
        ) : assignment && material ? (
          <SurfaceMeshStandardMaterial
            assignment={assignment}
            displacementEnabled={false}
            material={material}
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            repeatOverride={
              uvFrame
                ? undefined
                : getSurfaceRepeatForDimensions(material, length, faceHeight)
            }
            side={DoubleSide}
            textureQuality={getWallSurfaceTextureQuality(material)}
            wireframe={wireframe}
          />
        ) : showDefaultSurface ? (
          <meshStandardMaterial
            color="#cbd5e1"
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            roughness={0.82}
            side={DoubleSide}
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
      {(pickOnly || showDefaultSurface || (assignment && material)) &&
      isSelected ? (
        <mesh position={[0, 0, 0.004]}>
          <planeGeometry args={[length, faceHeight]} />
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

type CeilingSlabOuterEdge = {
  assignment?: SurfaceMaterialAssignment
  material?: SurfaceMaterialProduct
  nextPoint: Point
  point: Point
  uvFrame?: {
    bottom: number
    end: number
    normalSign: -1 | 1
    start: number
  }
}

function CeilingSlabSolid({
  castsShadow,
  depth,
  edges,
  shape,
  wireframe,
}: {
  castsShadow: boolean
  depth: number
  edges: readonly CeilingSlabOuterEdge[]
  shape: Shape
  wireframe: boolean
}) {
  const geometry = useMemo(
    () =>
      createCeilingSlabGeometry(
        shape,
        depth,
        edges.map((edge, edgeIndex) => {
          const dx = edge.nextPoint.x - edge.point.x
          const dz = edge.nextPoint.y - edge.point.y
          const length = Math.hypot(dx, dz)

          return {
            materialIndex: edgeIndex + 1,
            nextPoint: edge.nextPoint,
            normalSign: edge.uvFrame?.normalSign ?? 1,
            point: edge.point,
            topOverlap: FLOOR_SLAB_EDGE_UPPER_WALL_OVERLAP_METERS,
            uvBottom:
              (edge.uvFrame?.bottom ?? 0) -
              (edge.uvFrame ? FLOOR_SLAB_EDGE_WALL_OVERLAP_METERS : 0),
            uvEnd: edge.uvFrame?.end ?? length,
            uvStart: edge.uvFrame?.start ?? 0,
          }
        }),
        CEILING_SLAB_CAP_INSET_METERS,
      ),
    [depth, edges, shape],
  )

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      castShadow={castsShadow}
      receiveShadow
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={0}
      userData={{ houseDesignerRole: 'ceiling-slab-solid' }}
    >
      <primitive attach="geometry" object={geometry} />
      <meshStandardMaterial
        attach="material-0"
        color="#cbd5e1"
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
        roughness={0.82}
        shadowSide={DoubleSide}
        side={DoubleSide}
        wireframe={wireframe}
      />
      {edges.map((edge, edgeIndex) =>
        edge.assignment && edge.material ? (
          <SurfaceMeshStandardMaterial
            key={edgeIndex}
            assignment={edge.assignment}
            attach={`material-${edgeIndex + 1}`}
            displacementEnabled={false}
            material={edge.material}
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            side={DoubleSide}
            textureQuality={getWallSurfaceTextureQuality(edge.material)}
            wireframe={wireframe}
          />
        ) : (
          <meshStandardMaterial
            key={edgeIndex}
            attach={`material-${edgeIndex + 1}`}
            color="#cbd5e1"
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            roughness={0.82}
            shadowSide={DoubleSide}
            side={DoubleSide}
            wireframe={wireframe}
          />
        ),
      )}
    </mesh>
  )
}

const SUN_SHADOW_BLOCKER_USER_DATA = 'houseDesignerSunShadowBlocker'

function getSlabEdgeWallPlaneError(
  point: Point,
  nextPoint: Point,
  supportingWall: FloorSlabSupportingWall | null,
) {
  if (!supportingWall) {
    return null
  }

  const wall = supportingWall.wall
  const wallDx = wall.end.x - wall.start.x
  const wallDz = wall.end.y - wall.start.y
  const wallLength = Math.hypot(wallDx, wallDz)

  if (wallLength <= 0.001) {
    return null
  }

  const normalX = -wallDz / wallLength
  const normalZ = wallDx / wallLength
  const midpointX = (point.x + nextPoint.x) / 2
  const midpointZ = (point.y + nextPoint.y) / 2
  const signedDistance =
    (midpointX - wall.start.x) * normalX +
    (midpointZ - wall.start.y) * normalZ
  const wallFaceDistance = (wall.thickness / 2) * supportingWall.side

  return signedDistance - wallFaceDistance
}

function CeilingSlab({
  castsShadow,
  floor,
  isSolid,
  onRegisterPickTarget,
  openings,
  selectedSurface,
  sunShadowBlocker,
  surfaceAssignments,
  upperFloor,
  wireframe,
}: {
  castsShadow: boolean
  floor: FloorLevel
  isSolid: boolean
  onRegisterPickTarget?: (target: PickTarget) => () => void
  openings: Point[][]
  selectedSurface?: SelectableSurface | null
  sunShadowBlocker?: boolean
  surfaceAssignments?: SurfaceMaterialAssignment[]
  upperFloor: FloorLevel | null
  wireframe: boolean
}) {
  // A solid inter-storey slab occupies this floor's ceiling zone, but follows
  // the footprint of the storey it supports. An invisible ceiling shadow
  // blocker follows the current floor and is not structural slab geometry.
  const footprints = isSolid
    ? getCeilingSlabFootprints(upperFloor)
    : getFloorFootprints(floor)
  const slabBottom =
    floor.elevation +
    floor.roomHeight -
    (isSolid ? CEILING_VERTICAL_OVERLAP_METERS : 0)
  const slabTop =
    floor.elevation + floor.roomHeight + floor.slabThickness
  useEffect(() => {
    if (!isSolid) {
      return undefined
    }

    const wallTops = floor.walls.map(
      (wall) => floor.elevation + wall.height,
    )
    const highestWallTop = wallTops.length > 0 ? Math.max(...wallTops) : null
    const lowestWallTop = wallTops.length > 0 ? Math.min(...wallTops) : null

    ceilingSlabDebugEntries.set(floor.id, {
      floorId: floor.id,
      highestWallTop,
      lowestWallTop,
      slabBottom,
      slabTop,
      upperFloorElevation: upperFloor?.elevation ?? null,
      upperFloorGap: upperFloor ? upperFloor.elevation - slabTop : null,
      upperFloorId: upperFloor?.id ?? null,
      wallGap: highestWallTop === null ? null : slabBottom - highestWallTop,
    })

    return () => {
      ceilingSlabDebugEntries.delete(floor.id)
    }
  }, [floor.elevation, floor.id, floor.roomHeight, floor.slabThickness, floor.walls, isSolid, slabBottom, slabTop, upperFloor])
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
  const slabFootprints = useMemo(
    () =>
      footprints.flatMap((footprint) =>
        subtractPlanCutouts(footprint, openings),
      ),
    [footprints, openings],
  )
  const slabShapes = useMemo(
    () => slabFootprints.map(createPlanShapeWithHoles),
    [slabFootprints],
  )
  const slabOuterEdges = useMemo(
    () =>
      slabShapes.map((slabShape) => {
        const points = slabShape.getPoints().map((point) => ({
          x: point.x,
          y: -point.y,
        }))

        return points.map((point, edgeIndex) => {
          const nextPoint = points[(edgeIndex + 1) % points.length]
          const supportingWall = findFloorSlabSupportingWall(
            point,
            nextPoint,
            floor.walls,
          )
          const upperSupportingWall = upperFloor
            ? findFloorSlabSupportingWall(point, nextPoint, upperFloor.walls)
            : null
          const materialSupportingWall = supportingWall ?? upperSupportingWall
          const inheritedAssignment = materialSupportingWall
            ? getExternalWallSlabEdgeMaterialAssignment(
                surfaceAssignments ?? [],
                materialSupportingWall.wall,
                materialSupportingWall.side,
              )
            : undefined
          const inheritedMaterial = inheritedAssignment
            ? surfaceMaterialsById.get(inheritedAssignment.materialId)
            : undefined
          const inheritsWallMaterial = Boolean(
            materialSupportingWall && inheritedAssignment && inheritedMaterial,
          )

          return {
            assignment: inheritsWallMaterial
              ? inheritedAssignment
              : edgeAssignment,
            material: inheritsWallMaterial ? inheritedMaterial : edgeMaterial,
            nextPoint,
            point,
            supportingWall,
            upperSupportingWall,
            uvFrame:
              inheritsWallMaterial && materialSupportingWall
                ? {
                    bottom: materialSupportingWall.wall.height,
                    end: materialSupportingWall.uvEnd,
                    normalSign: materialSupportingWall.normalSign,
                    start: materialSupportingWall.uvStart,
                  }
                : undefined,
          }
        })
      }),
    [
      edgeAssignment,
      edgeMaterial,
      floor.walls,
      slabShapes,
      surfaceAssignments,
      upperFloor,
    ],
  )
  useEffect(() => {
    ceilingSlabEdgeDebugEntries.set(
      floor.id,
      slabOuterEdges.flatMap((edges) =>
        edges.map((edge, edgeIndex) => ({
          edgeIndex,
          floorId: floor.id,
          lowerPlaneError: getSlabEdgeWallPlaneError(
            edge.point,
            edge.nextPoint,
            edge.supportingWall,
          ),
          lowerWallId: edge.supportingWall?.wall.id ?? null,
          upperPlaneError: getSlabEdgeWallPlaneError(
            edge.point,
            edge.nextPoint,
            edge.upperSupportingWall,
          ),
          upperWallId: edge.upperSupportingWall?.wall.id ?? null,
          x1: Number(edge.point.x.toFixed(3)),
          x2: Number(edge.nextPoint.x.toFixed(3)),
          z1: Number(edge.point.y.toFixed(3)),
          z2: Number(edge.nextPoint.y.toFixed(3)),
        })),
      ),
    )

    return () => {
      ceilingSlabEdgeDebugEntries.delete(floor.id)
    }
  }, [floor.id, slabOuterEdges])
  const openingEdgeRings = useMemo(
    () => slabFootprints.flatMap((footprint) => footprint.holes),
    [slabFootprints],
  )
  const openingRevealBottomY =
    floor.elevation + floor.roomHeight - CEILING_VERTICAL_OVERLAP_METERS
  const openingRevealTopY =
    (upperFloor?.elevation ??
      floor.elevation + floor.roomHeight + floor.slabThickness) +
    FLOOR_FINISH_VERTICAL_OFFSET_METERS +
    FLOOR_SLAB_REVEAL_TOP_OVERLAP_METERS
  const openingRevealHeight = Math.max(
    0.001,
    openingRevealTopY - openingRevealBottomY,
  )
  const openingRevealCenterY =
    openingRevealBottomY + openingRevealHeight / 2

  if (slabShapes.length === 0) {
    return null
  }

  return (
    <group>
      {slabShapes.map((slabShape, index) => (
        <group key={index}>
          {isSolid ? (
            <group
              position={[
                0,
                floor.elevation +
                  floor.roomHeight -
                  CEILING_VERTICAL_OVERLAP_METERS,
                0,
              ]}
            >
              <CeilingSlabSolid
                castsShadow={castsShadow}
                depth={floor.slabThickness + CEILING_VERTICAL_OVERLAP_METERS}
                edges={slabOuterEdges[index]}
                shape={slabShape}
                wireframe={wireframe}
              />
            </group>
          ) : (
            <mesh
              castShadow={castsShadow && Boolean(sunShadowBlocker)}
              position={[0, floor.elevation + floor.roomHeight, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              userData={{
                [SUN_SHADOW_BLOCKER_USER_DATA]: Boolean(sunShadowBlocker),
                houseDesignerRole: 'ceiling-shadow-blocker',
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
              <meshStandardMaterial
                colorWrite={false}
                depthWrite={false}
                shadowSide={DoubleSide}
                wireframe={wireframe}
              />
            </mesh>
          )}
          {isSolid ? (
            <mesh
              position={[0, floor.elevation + floor.roomHeight - 0.002, 0]}
              receiveShadow
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={1}
              userData={{ houseDesignerRole: 'ceiling-slab-underside' }}
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
          {isSolid
            ? slabOuterEdges[index].map((edge, edgeIndex) => (
                <FloorSlabEdgeFace
                  key={edgeIndex}
                  assignment={edge.assignment}
                  edgeIndex={edgeIndex}
                  floor={floor}
                  floorId={floor.id}
                  isSelected={edgeIsSelected}
                  material={edge.material}
                  nextPoint={edge.nextPoint}
                  onRegisterPickTarget={onRegisterPickTarget}
                  pickOnly
                  point={edge.point}
                  uvFrame={edge.uvFrame}
                  wireframe={wireframe}
                />
              ))
            : null}
        </group>
      ))}
      {isSolid
        ? openingEdgeRings.flatMap((ring, ringIndex) =>
            ring.map((point, edgeIndex) => {
              const center = ring.reduce(
                (sum, ringPoint) => ({
                  x: sum.x + ringPoint.x / ring.length,
                  y: sum.y + ringPoint.y / ring.length,
                }),
                { x: 0, y: 0 },
              )
              const revealEdge = offsetEdgeTowardPoint(
                point,
                ring[(edgeIndex + 1) % ring.length],
                center,
                FLOOR_SLAB_REVEAL_PLAN_OVERLAP_METERS,
              )

              return (
                <FloorSlabEdgeFace
                  key={`opening:${ringIndex}:${edgeIndex}`}
                  assignment={edgeAssignment}
                  centerY={openingRevealCenterY}
                  edgeIndex={edgeIndex}
                  floor={floor}
                  floorId={floor.id}
                  height={openingRevealHeight}
                  isSelected={edgeIsSelected}
                  material={edgeMaterial}
                  nextPoint={revealEdge.nextPoint}
                  onRegisterPickTarget={onRegisterPickTarget}
                  point={revealEdge.point}
                  showDefaultSurface
                  wireframe={wireframe}
                />
              )
            }),
          )
        : null}
    </group>
  )
}

function createPlanShape(points: Point[]) {
  const [firstPoint, ...remainingPoints] = points
  const shape = new Shape()

  if (!firstPoint) {
    return shape
  }

  shape.moveTo(firstPoint.x, -firstPoint.y)

  for (const point of remainingPoints) {
    shape.lineTo(point.x, -point.y)
  }

  shape.closePath()
  return shape
}

function hasRenderablePlanPolygon(polygon: Point[]) {
  if (polygon.length < 3) {
    return false
  }

  return Math.abs(getSignedArea(polygon)) > 0.000001
}

function getRenderableRoomPolygon(
  room: DetectedRoom,
  roomSurfacePolygonsBySignature?: Map<string, Point[]>,
) {
  const composedPolygon = roomSurfacePolygonsBySignature?.get(room.signature)

  if (composedPolygon && hasRenderablePlanPolygon(composedPolygon)) {
    return composedPolygon
  }

  return hasRenderablePlanPolygon(room.polygon) ? room.polygon : null
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

function createPlanShapesWithCutouts(outline: Point[], cutouts: Point[][]) {
  return subtractPlanCutouts(outline, cutouts).map((footprint) =>
    createPlanShapeWithHoles(footprint),
  )
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
    .flatMap((opening) => {
      const openingWallLeft = opening.center - opening.width / 2
      const openingWallRight = opening.center + opening.width / 2
      const clippedWallLeft = Math.max(edgeWallMin, openingWallLeft)
      const clippedWallRight = Math.min(edgeWallMax, openingWallRight)

      if (clippedWallRight <= clippedWallLeft) {
        return []
      }

      const leftDistance = wallDistanceToEdgeDistance(clippedWallLeft)
      const rightDistance = wallDistanceToEdgeDistance(clippedWallRight)
      const bottom = Math.max(0, Math.min(height, opening.bottom))
      const top = Math.max(
        bottom,
        Math.min(height, opening.bottom + opening.height),
      )

      const rectangle = {
        bottom,
        id: opening.id,
        left: Math.max(0, Math.min(leftDistance, rightDistance)),
        modelId: opening.modelId,
        right: Math.min(edgeLength, Math.max(leftDistance, rightDistance)),
        top,
      }

      return rectangle.right - rectangle.left > 0.001 &&
        rectangle.top - rectangle.bottom > 0.001
        ? [rectangle]
        : []
    })

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

function getUniqueSortedOpeningBreaks(values: number[]) {
  const sortedValues = [...values].sort((first, second) => first - second)

  return sortedValues.filter(
    (value, index) =>
      index === 0 || Math.abs(value - sortedValues[index - 1]) > 0.0001,
  )
}

function openingRectanglesContainPoint(
  openings: OpeningRectangle[],
  x: number,
  y: number,
) {
  return openings.some(
    (opening) =>
      x > opening.left + 0.0001 &&
      x < opening.right - 0.0001 &&
      y > opening.bottom + 0.0001 &&
      y < opening.top - 0.0001,
  )
}

function getOpeningBoundarySegmentOpeningId(
  openings: OpeningRectangle[],
  edge: OpeningBoundarySegment['edge'],
  primary: number,
  rangeStart: number,
  rangeEnd: number,
) {
  const matches = openings.filter((opening) => {
    if (edge === 'left') {
      return (
        Math.abs(opening.left - primary) <= 0.0001 &&
        rangeStart >= opening.bottom - 0.0001 &&
        rangeEnd <= opening.top + 0.0001
      )
    }

    if (edge === 'right') {
      return (
        Math.abs(opening.right - primary) <= 0.0001 &&
        rangeStart >= opening.bottom - 0.0001 &&
        rangeEnd <= opening.top + 0.0001
      )
    }

    if (edge === 'bottom') {
      return (
        Math.abs(opening.bottom - primary) <= 0.0001 &&
        rangeStart >= opening.left - 0.0001 &&
        rangeEnd <= opening.right + 0.0001
      )
    }

    return (
      Math.abs(opening.top - primary) <= 0.0001 &&
      rangeStart >= opening.left - 0.0001 &&
      rangeEnd <= opening.right + 0.0001
    )
  })

  return matches.length === 1 ? matches[0].id : undefined
}

function getMergedOpeningBoundarySegments(
  openings: OpeningRectangle[],
  wallHeight: number,
): OpeningBoundarySegment[] {
  const xBreaks = getUniqueSortedOpeningBreaks(
    openings.flatMap((opening) => [opening.left, opening.right]),
  )
  const yBreaks = getUniqueSortedOpeningBreaks(
    openings.flatMap((opening) => [opening.bottom, opening.top]),
  )
  const segments: OpeningBoundarySegment[] = []

  xBreaks.slice(0, -1).forEach((left, xIndex) => {
    const right = xBreaks[xIndex + 1]

    if (right <= left + 0.0001) {
      return
    }

    yBreaks.slice(0, -1).forEach((bottom, yIndex) => {
      const top = yBreaks[yIndex + 1]

      if (top <= bottom + 0.0001) {
        return
      }

      const centerX = (left + right) / 2
      const centerY = (bottom + top) / 2

      if (!openingRectanglesContainPoint(openings, centerX, centerY)) {
        return
      }

      if (!openingRectanglesContainPoint(openings, left - 0.0002, centerY)) {
        segments.push({
          bottom,
          edge: 'left',
          id: `left:${left}:${bottom}:${top}`,
          openingId: getOpeningBoundarySegmentOpeningId(
            openings,
            'left',
            left,
            bottom,
            top,
          ),
          top,
          x: left,
        })
      }

      if (!openingRectanglesContainPoint(openings, right + 0.0002, centerY)) {
        segments.push({
          bottom,
          edge: 'right',
          id: `right:${right}:${bottom}:${top}`,
          openingId: getOpeningBoundarySegmentOpeningId(
            openings,
            'right',
            right,
            bottom,
            top,
          ),
          top,
          x: right,
        })
      }

      if (
        bottom > 0.0001 &&
        !openingRectanglesContainPoint(openings, centerX, bottom - 0.0002)
      ) {
        segments.push({
          edge: 'bottom',
          id: `bottom:${left}:${right}:${bottom}`,
          left,
          openingId: getOpeningBoundarySegmentOpeningId(
            openings,
            'bottom',
            bottom,
            left,
            right,
          ),
          right,
          y: bottom,
        })
      }

      if (
        top < wallHeight - 0.0001 &&
        !openingRectanglesContainPoint(openings, centerX, top + 0.0002)
      ) {
        segments.push({
          edge: 'top',
          id: `top:${left}:${right}:${top}`,
          left,
          openingId: getOpeningBoundarySegmentOpeningId(
            openings,
            'top',
            top,
            left,
            right,
          ),
          right,
          y: top,
        })
      }
    })
  })

  return segments
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
  rooms,
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
  rooms: DetectedRoom[]
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
  const exteriorWallSidesByWallId = useMemo(
    () => getExteriorWallSidesByWallId(revealContextWalls, rooms),
    [revealContextWalls, rooms],
  )
  const wallOpeningDepthsByModelId = useMemo(
    () => getWallOpeningDepthsByModelId(revealContextWalls),
    [revealContextWalls],
  )
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
            ? wallKind === 'external'
              ? getExternalWallSlabEdgeMaterialAssignment(
                  surfaceAssignments,
                  wall,
                  side,
                )
              : getWallFaceMaterialAssignmentForSide(
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
  const useExplicitGeometry =
    wallKind === 'internal' ||
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
            wallKind !== 'external',
            exteriorWallSidesByWallId,
            wallOpeningDepthsByModelId,
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
      exteriorWallSidesByWallId,
      wallOpeningDepthsByModelId,
    ],
  )
  const selectedHighlightMaterialIndices = useMemo(() => {
    const presentMaterialIndices = new Set(
      explicitGeometry?.groups.map((group) => group.materialIndex ?? 0) ?? [],
    )

    if (
      selectedSurface?.type === 'wall-face' &&
      (!selectedWallId || selectedSurface.wallId === selectedWallId)
    ) {
      return selectedMaterialIndex !== null &&
        presentMaterialIndices.has(selectedMaterialIndex)
        ? [selectedMaterialIndex]
        : []
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
    if (!WALL_RENDER_DEBUG_ENABLED) {
      return
    }

    const footprintEdges = buildFootprintEdgeDebugEntries({
      floorId,
      footprints,
      sourceWalls: sourceWalls ?? [],
      wallKind,
      walls: contextWalls,
    })
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
    const footprintFaces = buildFootprintFaceDebugEntries({
      floorId,
      geometry: explicitGeometry,
      kind: wallKind,
      materialSources,
    })
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

    footprintFaceDebugEntries.set(
      `${floorId}:${wallKind}:${(sourceWalls ?? []).map((wall) => wall.id).join(',')}`,
      footprintFaces,
    )
    footprintEdgeDebugEntries.set(
      `${floorId}:${wallKind}:${(sourceWalls ?? []).map((wall) => wall.id).join(',')}`,
      footprintEdges,
    )
    recordWallRenderDebug(
      'wall-renderer:footprint',
      `floor=${floorId} kind=${wallKind} sourceWalls=${(sourceWalls ?? []).map((wall) => wall.id).join(',')}`,
      JSON.stringify({
        edgeCount: footprintEdges.length,
        groupCount: explicitGeometry?.groups.length ?? 0,
        groups: geometryGroups,
        includeHoleVerticalFaces: wallKind !== 'external',
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
    contextWalls,
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
          frustumCulled={false}
          geometry={explicitGeometry}
          position={[0, elevation, 0]}
          receiveShadow={castsShadow}
          renderOrder={2}
          userData={{ houseDesignerRole: `wall-footprint-${wallKind}` }}
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
            frustumCulled={false}
            geometry={explicitGeometry}
            position={[0, elevation, 0]}
            renderOrder={9}
            userData={{ houseDesignerRole: `wall-footprint-highlight-${wallKind}` }}
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
            frustumCulled={false}
            position={[0, elevation, 0]}
            receiveShadow={castsShadow}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={2}
            userData={{ houseDesignerRole: `wall-footprint-extrude-${wallKind}` }}
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

function buildFootprintFaceDebugEntries({
  floorId,
  geometry,
  kind,
  materialSources,
}: {
  floorId: string
  geometry: BufferGeometry | null
  kind: WallKind
  materialSources: Array<{ materialIndex: number; source: string }>
}): FootprintFaceDebugEntry[] {
  const positionAttribute = geometry?.getAttribute('position')

  if (!(positionAttribute instanceof Float32BufferAttribute)) {
    return []
  }

  const groups = geometry?.groups ?? []

  return groups.map((group) => {
    const bounds = {
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
    }

    for (let index = group.start; index < group.start + group.count; index += 1) {
      const x = positionAttribute.getX(index)
      const y = positionAttribute.getY(index)
      const z = positionAttribute.getZ(index)

      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.minZ = Math.min(bounds.minZ, z)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.maxY = Math.max(bounds.maxY, y)
      bounds.maxZ = Math.max(bounds.maxZ, z)
    }

    const materialIndex = group.materialIndex ?? 0

    return {
      count: group.count,
      floorId,
      kind,
      materialIndex,
      maxX: roundDebugMeters(bounds.maxX),
      maxY: roundDebugMeters(bounds.maxY),
      maxZ: roundDebugMeters(bounds.maxZ),
      minX: roundDebugMeters(bounds.minX),
      minY: roundDebugMeters(bounds.minY),
      minZ: roundDebugMeters(bounds.minZ),
      source:
        materialSources.find(
          (candidateSource) => candidateSource.materialIndex === materialIndex,
        )?.source ?? 'unknown',
      start: group.start,
    }
  })
}

function buildFootprintEdgeDebugEntries({
  floorId,
  footprints,
  sourceWalls,
  wallKind,
  walls,
}: {
  floorId: string
  footprints: WallUnionFootprint[]
  sourceWalls: Wall[]
  wallKind: WallKind
  walls: Wall[]
}): FootprintEdgeDebugEntry[] {
  const sourceWallIds = sourceWalls.map((wall) => wall.id).join(',')
  const matchingWalls = sourceWalls.length > 0 ? sourceWalls : walls

  return footprints.flatMap((footprint, footprintIndex) =>
    [footprint.outline, ...footprint.holes].flatMap((ring, ringIndex) =>
      ring.flatMap((start, edgeIndex) => {
        const end = ring[(edgeIndex + 1) % ring.length]
        const edge = { end, start }
        const metrics = getEdgeMetrics(edge)

        if (!metrics || metrics.length < 0.001) {
          return []
        }

        const outward = getFootprintEdgeOutwardNormal(edge, metrics, footprint)
        const edgeSegments = getFootprintEdgeWallSideSegments(edge, matchingWalls)

        return edgeSegments.map((segment) => {
          const segmentStart = {
            x: start.x + metrics.unit.x * segment.left,
            y: start.y + metrics.unit.y * segment.left,
          }
          const segmentEnd = {
            x: start.x + metrics.unit.x * segment.right,
            y: start.y + metrics.unit.y * segment.right,
          }
          const segmentEdge = {
            end: segmentEnd,
            start: segmentStart,
          }
          const match =
            segment.match ??
            getFootprintEdgeWallSideContext(segmentEdge, matchingWalls) ??
            getShortFootprintEdgeAdjacentWallSideContext(segmentEdge, matchingWalls, {
              shortOnly: false,
            })

          return {
            edgeIndex,
            endX: roundDebugMeters(segmentEnd.x),
            endY: roundDebugMeters(segmentEnd.y),
            floorId,
            isHole: ringIndex > 0,
            kind: wallKind,
            length: roundDebugMeters(segment.right - segment.left),
            matchSide: match?.side,
            matchWallId: match?.wall.id,
            normalX: roundDebugMeters(outward.x),
            normalY: roundDebugMeters(outward.y),
            ringIndex,
            sourceWalls: sourceWallIds,
            startX: roundDebugMeters(segmentStart.x),
            startY: roundDebugMeters(segmentStart.y),
          } satisfies FootprintEdgeDebugEntry
        })
      }),
    ).map((entry) => ({
      ...entry,
      edgeIndex: footprintIndex * 1000 + entry.ringIndex * 100 + entry.edgeIndex,
    })),
  )
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
  includeHoleVerticalFaces = true,
  exteriorWallSidesByWallId = new Map<string, WallSide>(),
  wallOpeningDepthsByModelId = new Map<string, number>(),
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
  const matchingWalls = revealWalls.length > 0 ? revealWalls : walls

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
      const verticalRings = includeHoleVerticalFaces
        ? [footprint.outline, ...footprint.holes]
        : [footprint.outline]

      verticalRings.forEach((ring) => {
        ring.forEach((start, index) => {
          const end = ring[(index + 1) % ring.length]
          const edge = { end, start }
          const metrics = getEdgeMetrics(edge)

          if (!metrics || metrics.length < 0.001) {
            return
          }

          const outward = getFootprintEdgeOutwardNormal(edge, metrics, footprint)
          const edgeSegments = getFootprintEdgeWallSideSegments(edge, matchingWalls)

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
              getFootprintEdgeWallSideContext(segmentEdge, matchingWalls) ??
              getShortFootprintEdgeAdjacentWallSideContext(segmentEdge, matchingWalls, {
                shortOnly: false,
              })
            const openingContext =
              wallSideContext && hasWallOpenings(wallSideContext.wall)
                ? { side: wallSideContext.side, wall: wallSideContext.wall }
                : getFootprintEdgeOpeningContext(segmentEdge, matchingWalls)
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
      const exteriorSide =
        wall.kind === 'external' ? exteriorWallSidesByWallId.get(wall.id) : undefined
      const toPosition = (
        distanceAlongWall: number,
        y: number,
        sideOffset: number,
      ): [number, number, number] => [
        wall.start.x + unit.x * distanceAlongWall + normal.x * sideOffset,
        y,
        wall.start.y + unit.y * distanceAlongWall + normal.y * sideOffset,
      ]

      const openingRectangles = (wall.openings ?? [])
        .flatMap((opening) => {
          const left = opening.center - opening.width / 2
          const right = opening.center + opening.width / 2
          const bottom = Math.max(0, Math.min(height, opening.bottom))
          const top = Math.max(
            bottom,
            Math.min(height, opening.bottom + opening.height),
          )

          return right > left && top > bottom
            ? [{
                bottom,
                id: opening.id,
                left,
                modelId: opening.modelId,
                right,
                top,
              }]
            : []
        })
      const getRevealSplitOffset = (openingId?: string) => {
        if (!exteriorSide || !openingId) {
          return 0
        }

        const opening = openingRectangles.find(
          (candidateOpening) => candidateOpening.id === openingId,
        )
        const openingDepth = opening?.modelId
          ? wallOpeningDepthsByModelId.get(opening.modelId)
          : undefined

        if (typeof openingDepth !== 'number' || !Number.isFinite(openingDepth)) {
          return 0
        }

        return Math.max(
          -halfThickness,
          Math.min(
            halfThickness,
            exteriorSide *
              (halfThickness -
                WINDOW_WALL_FACE_INSET_METERS -
                openingDepth / 2),
          ),
        )
      }

      getMergedOpeningBoundarySegments(openingRectangles, height).forEach(
        (segment) => {
          const splitOffset = getRevealSplitOffset(segment.openingId)
          ;([-1, 1] as const).forEach((side) => {
            const depthStart = side === 1 ? splitOffset : -halfThickness
            const depthEnd = side === 1 ? halfThickness : splitOffset
            const revealDepth = Math.abs(depthEnd - depthStart)
            const materialIndex =
              wallFaceMaterialIndices.get(`${wall.id}:${side}`) ?? 0

            if (segment.edge === 'left') {
              addQuad(
                [
                  toPosition(segment.x, segment.bottom, depthStart),
                  toPosition(segment.x, segment.bottom, depthEnd),
                  toPosition(segment.x, segment.top, depthEnd),
                  toPosition(segment.x, segment.top, depthStart),
                ],
                [unit.x, 0, unit.y],
                [
                  [0, segment.bottom],
                  [revealDepth, segment.bottom],
                  [revealDepth, segment.top],
                  [0, segment.top],
                ],
                materialIndex,
              )
              return
            }

            if (segment.edge === 'right') {
              addQuad(
                [
                  toPosition(segment.x, segment.bottom, depthEnd),
                  toPosition(segment.x, segment.bottom, depthStart),
                  toPosition(segment.x, segment.top, depthStart),
                  toPosition(segment.x, segment.top, depthEnd),
                ],
                [-unit.x, 0, -unit.y],
                [
                  [0, segment.bottom],
                  [revealDepth, segment.bottom],
                  [revealDepth, segment.top],
                  [0, segment.top],
                ],
                materialIndex,
              )
              return
            }

            if (segment.edge === 'top') {
              addQuad(
                [
                  toPosition(segment.left, segment.y, depthEnd),
                  toPosition(segment.right, segment.y, depthEnd),
                  toPosition(segment.right, segment.y, depthStart),
                  toPosition(segment.left, segment.y, depthStart),
                ],
                [0, -1, 0],
                [
                  [segment.left, 0],
                  [segment.right, 0],
                  [segment.right, revealDepth],
                  [segment.left, revealDepth],
                ],
                materialIndex,
              )
              return
            }

            if (
              segment.edge === 'bottom' &&
              segment.y > SKIRTING_OPENING_FLOOR_TOLERANCE_METERS
            ) {
              addQuad(
                [
                  toPosition(segment.left, segment.y, depthStart),
                  toPosition(segment.right, segment.y, depthStart),
                  toPosition(segment.right, segment.y, depthEnd),
                  toPosition(segment.left, segment.y, depthEnd),
                ],
                [0, 1, 0],
                [
                  [segment.left, 0],
                  [segment.right, 0],
                  [segment.right, revealDepth],
                  [segment.left, revealDepth],
                ],
                materialIndex,
              )
            }
          })
        },
      )
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
  roomPolygon?: Point[] | null,
  rooms?: DetectedRoom[],
) {
  const exactAssignment = surfaceAssignments.find(
    (assignment) =>
      assignment.target.type === 'room-floor' &&
      assignment.target.floorId === floorId &&
      assignment.target.roomSignature === roomSignature,
  )

  if (exactAssignment || !roomPolygon || !rooms) {
    return exactAssignment
  }

  const currentRoomSignatures = new Set(rooms.map((room) => room.signature))

  return surfaceAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'room-floor' &&
      assignment.target.floorId === floorId &&
      !currentRoomSignatures.has(assignment.target.roomSignature) &&
      roomSignatureCentroidIsInsidePolygon(
        assignment.target.roomSignature,
        roomPolygon,
      ),
  )
}

function getRoomCeilingMaterialAssignment(
  surfaceAssignments: SurfaceMaterialAssignment[],
  floorId: string,
  roomSignature: string,
  roomPolygon?: Point[] | null,
  rooms?: DetectedRoom[],
) {
  const exactAssignment = surfaceAssignments.find(
    (assignment) =>
      assignment.target.type === 'ceiling' &&
      assignment.target.floorId === floorId &&
      assignment.target.roomSignature === roomSignature,
  )

  if (exactAssignment || !roomPolygon || !rooms) {
    return exactAssignment
  }

  const currentRoomSignatures = new Set(rooms.map((room) => room.signature))

  return surfaceAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'ceiling' &&
      assignment.target.floorId === floorId &&
      Boolean(assignment.target.roomSignature) &&
      !currentRoomSignatures.has(assignment.target.roomSignature!) &&
      roomSignatureCentroidIsInsidePolygon(
        assignment.target.roomSignature!,
        roomPolygon,
      ),
  )
}

function getPointFromRoomSignaturePart(part: string): Point | null {
  const [xKey, yKey] = part.split(':').map((value) => Number(value))

  if (!Number.isFinite(xKey) || !Number.isFinite(yKey)) {
    return null
  }

  return {
    x: xKey * FOOTPRINT_EPSILON,
    y: yKey * FOOTPRINT_EPSILON,
  }
}

function getRoomSignatureCentroid(signature: string): Point | null {
  const points = signature
    .split('|')
    .map(getPointFromRoomSignaturePart)
    .filter((point): point is Point => Boolean(point))

  if (points.length === 0) {
    return null
  }

  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function roomSignatureCentroidIsInsidePolygon(
  signature: string,
  polygon: Point[],
) {
  const centroid = getRoomSignatureCentroid(signature)

  return centroid ? isPointInsideOrOnPolygon(centroid, polygon) : false
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
      firstSurface.wallId === secondSurface.wallId &&
      firstSurface.side === secondSurface.side &&
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
    firstSurface.type === 'portal-floor' &&
    secondSurface.type === 'portal-floor'
  ) {
    return (
      firstSurface.floorId === secondSurface.floorId &&
      firstSurface.wallId === secondSurface.wallId &&
      firstSurface.openingId === secondSurface.openingId
    )
  }

  if (
    firstSurface.type !== 'wall-face' &&
    secondSurface.type !== 'wall-face' &&
    firstSurface.type !== 'wall-surface-fragment' &&
    secondSurface.type !== 'wall-surface-fragment'
  ) {
    if (
      firstSurface.type === 'floor-slab-edge' ||
      secondSurface.type === 'floor-slab-edge' ||
      firstSurface.type === 'portal-floor' ||
      secondSurface.type === 'portal-floor'
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
  openings,
  polygon,
  room,
  roomHeight,
  selectedSurface,
  type,
}: {
  elevation: number
  floorId: string
  onRegisterPickTarget: (target: PickTarget) => () => void
  openings: Point[][]
  polygon: Point[]
  room: DetectedRoom
  roomHeight: number
  selectedSurface: SelectableSurface | null
  type: 'ceiling' | 'room-floor'
}) {
  const meshRef = useRef<Object3D>(null!)
  const shapes = useMemo(
    () => createPlanShapesWithCutouts(polygon, openings),
    [openings, polygon],
  )
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
      ? elevation + 0.012
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
    <>
      <mesh
        ref={meshRef}
        position={[0, y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-1}
      >
        <shapeGeometry args={[shapes]} />
        <meshBasicMaterial
          color="#000000"
          depthWrite={false}
          opacity={0}
          side={pickSide}
          transparent
        />
      </mesh>
      {isSelected ? (
        <mesh
          position={[0, y, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={6}
        >
          <shapeGeometry args={[shapes]} />
          <meshBasicMaterial
            color="#f97316"
            depthTest
            depthWrite={false}
            opacity={0.28}
            polygonOffset
            polygonOffsetFactor={-8}
            polygonOffsetUnits={-8}
            side={pickSide}
            transparent
          />
        </mesh>
      ) : null}
    </>
  )
}

function FloorPlaneSurface({
  elevation,
  floorPlane,
  isActive,
  openings,
  receiveShadow,
  wireframe,
}: {
  elevation: number
  floorPlane: NonNullable<ReturnType<typeof getFloorPlaneBounds>>
  isActive: boolean
  openings: Point[][]
  receiveShadow: boolean
  wireframe: boolean
}) {
  const shapes = useMemo(() => {
    const halfSize = floorPlane.size / 2

    return createPlanShapesWithCutouts(
      [
        { x: floorPlane.centerX - halfSize, y: floorPlane.centerZ - halfSize },
        { x: floorPlane.centerX + halfSize, y: floorPlane.centerZ - halfSize },
        { x: floorPlane.centerX + halfSize, y: floorPlane.centerZ + halfSize },
        { x: floorPlane.centerX - halfSize, y: floorPlane.centerZ + halfSize },
      ],
      openings,
    )
  }, [floorPlane, openings])

  return (
    <mesh
      position={[0, elevation - 0.01, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow={receiveShadow}
      renderOrder={isActive ? 0 : -1}
    >
      <shapeGeometry args={[shapes]} />
      <meshStandardMaterial
        color={isActive ? '#f8fafc' : '#eef2f7'}
        depthWrite={isActive}
        opacity={isActive ? 1 : 0.035}
        polygonOffset={!isActive}
        polygonOffsetFactor={2}
        polygonOffsetUnits={2}
        transparent={!isActive}
        wireframe={wireframe}
      />
    </mesh>
  )
}

function SelectableRoomSurfaces({
  ceilingOpenings,
  elevation,
  floorPlane,
  floorId,
  onRegisterPickTarget,
  floorOpenings,
  roomHeight,
  roomSurfacePolygonsBySignature,
  rooms,
  selectedSurface,
  visibleRoomSignatures,
}: {
  ceilingOpenings: Point[][]
  elevation: number
  floorPlane?: ReturnType<typeof getFloorPlaneBounds> | null
  floorId: string
  onRegisterPickTarget: (target: PickTarget) => () => void
  floorOpenings: Point[][]
  roomHeight: number
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
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
            openings={floorOpenings}
            roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
            rooms={rooms}
            type="room-floor"
          />
          <SelectableRoomSurfaceAreaMesh
            elevation={elevation}
            floorId={floorId}
            floorPlane={floorPlane}
            onRegisterPickTarget={onRegisterPickTarget}
            openings={ceilingOpenings}
            roomHeight={roomHeight}
            roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
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
        .flatMap((room) => {
          const polygon = getRenderableRoomPolygon(
            room,
            roomSurfacePolygonsBySignature,
          )

          return polygon
            ? [
                <SelectableRoomSurfaceMesh
                  key={`${room.signature}:floor`}
                  elevation={elevation}
                  floorId={floorId}
                  onRegisterPickTarget={onRegisterPickTarget}
                  openings={floorOpenings}
                  polygon={polygon}
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
                  openings={ceilingOpenings}
                  polygon={polygon}
                  room={room}
                  roomHeight={roomHeight}
                  selectedSurface={selectedSurface}
                  type="ceiling"
                />,
              ]
            : []
        })}
    </>
  )
}

function SelectableRoomSurfaceAreaMesh({
  elevation,
  floorId,
  floorPlane,
  onRegisterPickTarget,
  openings,
  roomHeight = 0,
  roomSurfacePolygonsBySignature,
  rooms,
  type,
}: {
  elevation: number
  floorId: string
  floorPlane: NonNullable<ReturnType<typeof getFloorPlaneBounds>>
  onRegisterPickTarget: (target: PickTarget) => () => void
  openings: Point[][]
  roomHeight?: number
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
  rooms: DetectedRoom[]
  type: 'ceiling' | 'room-floor'
}) {
  const meshRef = useRef<Object3D>(null!)
  const y =
    type === 'room-floor'
      ? elevation + 0.006
      : elevation + roomHeight - 0.015
  const pickSide = type === 'ceiling' ? BackSide : FrontSide
  const shape = useMemo(() => {
    const halfSize = floorPlane.size / 2
    return createPlanShapesWithCutouts(
      [
        { x: floorPlane.centerX - halfSize, y: floorPlane.centerZ - halfSize },
        { x: floorPlane.centerX + halfSize, y: floorPlane.centerZ - halfSize },
        { x: floorPlane.centerX + halfSize, y: floorPlane.centerZ + halfSize },
        { x: floorPlane.centerX - halfSize, y: floorPlane.centerZ + halfSize },
      ],
      openings,
    )
  }, [floorPlane, openings])

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
      roomSurfacePolygonsBySignature,
      rooms,
      surfaceType: type,
    })
  }, [
    floorId,
    onRegisterPickTarget,
    pickSide,
    roomSurfacePolygonsBySignature,
    rooms,
    type,
  ])

  return (
    <mesh
      ref={meshRef}
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-2}
    >
      <shapeGeometry args={[shape]} />
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
  openings,
  polygon,
  wireframe,
}: {
  assignment: SurfaceMaterialAssignment
  elevation: number
  materialId: string
  openings: Point[][]
  polygon: Point[]
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const material = surfaceMaterialsById.get(materialId)
  const shapes = useMemo(
    () => createPlanShapesWithCutouts(polygon, openings),
    [openings, polygon],
  )
  const y = elevation + FLOOR_FINISH_VERTICAL_OFFSET_METERS

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
      <shapeGeometry args={[shapes]} />
      <SurfaceMeshStandardMaterial
        assignment={assignment}
        displacementEnabled={false}
        material={material}
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        side={FrontSide}
        wireframe={wireframe}
      />
    </mesh>
  )
}

function RoomFloorBaseMesh({
  elevation,
  openings,
  polygon,
  shadowsEnabled,
  wireframe,
}: {
  elevation: number
  openings: Point[][]
  polygon: Point[]
  shadowsEnabled: boolean
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const shapes = useMemo(
    () => createPlanShapesWithCutouts(polygon, openings),
    [openings, polygon],
  )
  const y = elevation + FLOOR_BASE_VERTICAL_OFFSET_METERS

  useHorizontalSurfaceVisibility(meshRef, y, 'above')

  return (
    <mesh
      ref={meshRef}
      position={[0, y, 0]}
      receiveShadow={shadowsEnabled}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={1}
    >
      <shapeGeometry args={[shapes]} />
      <meshStandardMaterial
        color="#f8fafc"
        roughness={0.82}
        side={FrontSide}
        wireframe={wireframe}
      />
    </mesh>
  )
}

function RoomFloorBaseMeshes({
  elevation,
  openings,
  roomSurfacePolygonsBySignature,
  rooms,
  shadowsEnabled,
  visibleRoomSignatures,
  wireframe,
}: {
  elevation: number
  openings: Point[][]
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
  rooms: DetectedRoom[]
  shadowsEnabled: boolean
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
          const polygon = getRenderableRoomPolygon(
            room,
            roomSurfacePolygonsBySignature,
          )

          return polygon ? (
            <RoomFloorBaseMesh
              key={room.signature}
              elevation={elevation}
              openings={openings}
              polygon={polygon}
              shadowsEnabled={shadowsEnabled}
              wireframe={wireframe}
            />
          ) : null
        })}
    </group>
  )
}

function getAllEnabledLocalLightSlots(floor: FloorLevel) {
  const slots: LocalLightSlot[] = []

  for (const model of floor.models ?? []) {
    const modelDefinition = modelsById.get(model.modelId)

    if (!modelDefinition?.isLight || model.lightEnabled === false) {
      continue
    }

    const height = model.height ?? modelDefinition.height
    const lightKind = modelDefinition.lightKind ?? 'point'
    const lightY = floor.elevation + height
    const maxLightY =
      floor.elevation +
      Math.max(0.2, floor.roomHeight - LOCAL_LIGHT_CEILING_CLEARANCE_METERS)
    const y = Math.min(lightY, maxLightY)

    slots.push({
      angle:
        ((lightKind === 'spot'
          ? Math.max(
              5,
              Math.min(120, model.lightSpread ?? modelDefinition.lightSpread ?? 36),
            )
          : 120) *
          Math.PI) /
        360,
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

  return slots
}

function drawPlanPath(
  context: CanvasRenderingContext2D,
  polygon: Point[],
  worldToCanvas: (point: Point) => Point,
) {
  polygon.forEach((point, index) => {
    const canvasPoint = worldToCanvas(point)

    if (index === 0) {
      context.moveTo(canvasPoint.x, canvasPoint.y)
    } else {
      context.lineTo(canvasPoint.x, canvasPoint.y)
    }
  })
  context.closePath()
}

function createBakedFloorLightmapTextures({
  daylightEnabled,
  floor,
  lightDirection,
  roomPolygons,
  walls,
}: {
  daylightEnabled: boolean
  floor: FloorLevel
  lightDirection: LightDirection
  roomPolygons: Point[][]
  walls: Wall[]
}) {
  const floorPlane = getFloorPlaneBounds(floor)

  if (!floorPlane || roomPolygons.length === 0) {
    return null
  }

  const shadowCanvas = document.createElement('canvas')
  const lightCanvas = document.createElement('canvas')
  shadowCanvas.width = BAKED_FLOOR_LIGHTMAP_SIZE
  shadowCanvas.height = BAKED_FLOOR_LIGHTMAP_SIZE
  lightCanvas.width = BAKED_FLOOR_LIGHTMAP_SIZE
  lightCanvas.height = BAKED_FLOOR_LIGHTMAP_SIZE
  const shadowContext = shadowCanvas.getContext('2d')
  const lightContext = lightCanvas.getContext('2d')

  if (!shadowContext || !lightContext) {
    return null
  }

  const halfSize = floorPlane.size / 2
  const minX = floorPlane.centerX - halfSize
  const minZ = floorPlane.centerZ - halfSize
  const worldToCanvas = (point: Point): Point => ({
    x: ((point.x - minX) / floorPlane.size) * BAKED_FLOOR_LIGHTMAP_SIZE,
    y: ((point.y - minZ) / floorPlane.size) * BAKED_FLOOR_LIGHTMAP_SIZE,
  })
  const drawRoomClip = (context: CanvasRenderingContext2D) => {
    context.beginPath()
    roomPolygons.forEach((polygon) => drawPlanPath(context, polygon, worldToCanvas))
    context.clip()
  }

  shadowContext.save()
  drawRoomClip(shadowContext)
  shadowContext.lineCap = 'round'
  shadowContext.lineJoin = 'round'

  const lightSlots = getAllEnabledLocalLightSlots(floor)

  walls.forEach((wall) => {
    const start = worldToCanvas(wall.start)
    const end = worldToCanvas(wall.end)

    shadowContext.beginPath()
    shadowContext.moveTo(start.x, start.y)
    shadowContext.lineTo(end.x, end.y)
    shadowContext.strokeStyle = `rgba(0, 0, 0, ${BAKED_FLOOR_CONTACT_SHADOW_ALPHA})`
    shadowContext.lineWidth = Math.max(
      3,
      (wall.thickness / floorPlane.size) * BAKED_FLOOR_LIGHTMAP_SIZE * 0.95,
    )
    shadowContext.stroke()
  })
  shadowContext.restore()

  lightContext.save()
  drawRoomClip(lightContext)
  if (daylightEnabled) {
    const sunGradientStart = {
      x:
        BAKED_FLOOR_LIGHTMAP_SIZE *
        (0.5 - Math.cos(lightDirection.azimuth) * 0.5),
      y:
        BAKED_FLOOR_LIGHTMAP_SIZE *
        (0.5 - Math.sin(lightDirection.azimuth) * 0.5),
    }
    const sunGradientEnd = {
      x:
        BAKED_FLOOR_LIGHTMAP_SIZE *
        (0.5 + Math.cos(lightDirection.azimuth) * 0.5),
      y:
        BAKED_FLOOR_LIGHTMAP_SIZE *
        (0.5 + Math.sin(lightDirection.azimuth) * 0.5),
    }
    const daylightGradient = lightContext.createLinearGradient(
      sunGradientStart.x,
      sunGradientStart.y,
      sunGradientEnd.x,
      sunGradientEnd.y,
    )
    daylightGradient.addColorStop(0, 'rgba(255, 248, 232, 0.18)')
    daylightGradient.addColorStop(0.55, 'rgba(244, 248, 255, 0.08)')
    daylightGradient.addColorStop(1, 'rgba(126, 161, 213, 0.02)')
    lightContext.fillStyle = daylightGradient
    lightContext.fillRect(
      0,
      0,
      BAKED_FLOOR_LIGHTMAP_SIZE,
      BAKED_FLOOR_LIGHTMAP_SIZE,
    )
  }

  lightSlots.forEach((slot) => {
    const center = worldToCanvas({ x: slot.position[0], y: slot.position[2] })
    const radius =
      (Math.min(slot.distance, 8) / floorPlane.size) * BAKED_FLOOR_LIGHTMAP_SIZE
    const color = new Color(slot.color)
    const gradient = lightContext.createRadialGradient(
      center.x,
      center.y,
      0,
      center.x,
      center.y,
      Math.max(8, radius),
    )
    const alpha = Math.min(
      BAKED_FLOOR_LIGHT_MAX_ALPHA,
      0.1 + slot.power / 750,
    )

    gradient.addColorStop(
      0,
      `rgba(${Math.round(color.r * 255)}, ${Math.round(
        color.g * 255,
      )}, ${Math.round(color.b * 255)}, ${alpha.toFixed(3)})`,
    )
    gradient.addColorStop(
      1,
      `rgba(${Math.round(color.r * 255)}, ${Math.round(
        color.g * 255,
      )}, ${Math.round(color.b * 255)}, 0)`,
    )
    lightContext.fillStyle = gradient
    lightContext.fillRect(
      center.x - radius,
      center.y - radius,
      radius * 2,
      radius * 2,
    )
  })
  lightContext.restore()

  const shadowTexture = new CanvasTexture(shadowCanvas)
  const lightTexture = new CanvasTexture(lightCanvas)
  shadowTexture.needsUpdate = true
  lightTexture.needsUpdate = true

  return {
    floorPlane,
    lightCount: lightSlots.length,
    lightTexture,
    shadowTexture,
  }
}

function BakedFloorLightmap({
  daylightEnabled,
  enabled,
  floor,
  lightDirection,
  roomSurfacePolygonsBySignature,
  rooms,
  walls,
  wireframe,
}: {
  daylightEnabled: boolean
  enabled: boolean
  floor: FloorLevel
  lightDirection: LightDirection
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
  rooms: DetectedRoom[]
  walls: Wall[]
  wireframe: boolean
}) {
  const roomPolygons = useMemo(
    () =>
      rooms
        .map((room) =>
          getRenderableRoomPolygon(room, roomSurfacePolygonsBySignature),
        )
        .filter((polygon): polygon is Point[] => Boolean(polygon)),
    [roomSurfacePolygonsBySignature, rooms],
  )
  const bakedLightmap = useMemo(
    () =>
      enabled && !wireframe
        ? createBakedFloorLightmapTextures({
            daylightEnabled,
            floor,
            lightDirection,
            roomPolygons,
            walls,
          })
        : null,
    [
      daylightEnabled,
      enabled,
      floor,
      lightDirection.azimuth,
      lightDirection.elevation,
      roomPolygons,
      walls,
      wireframe,
    ],
  )

  useEffect(() => {
    if (!bakedLightmap) {
      return undefined
    }

    recordEngineLog(
      'floor-lightmap-baked',
      `${floor.id}: ${BAKED_FLOOR_LIGHTMAP_SIZE}x${BAKED_FLOOR_LIGHTMAP_SIZE}, ${bakedLightmap.lightCount} lights`,
    )

    return () => {
      bakedLightmap.shadowTexture.dispose()
      bakedLightmap.lightTexture.dispose()
    }
  }, [bakedLightmap, floor.id])

  if (!bakedLightmap) {
    return null
  }

  return (
    <group
      position={[
        bakedLightmap.floorPlane.centerX,
        floor.elevation + 0.018,
        bakedLightmap.floorPlane.centerZ,
      ]}
      renderOrder={5}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry
          args={[
            bakedLightmap.floorPlane.size,
            bakedLightmap.floorPlane.size,
          ]}
        />
        <meshBasicMaterial
          color="#000000"
          depthWrite={false}
          map={bakedLightmap.shadowTexture}
          opacity={1}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
          transparent
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry
          args={[
            bakedLightmap.floorPlane.size,
            bakedLightmap.floorPlane.size,
          ]}
        />
        <meshBasicMaterial
          blending={AdditiveBlending}
          color="#ffffff"
          depthWrite={false}
          map={bakedLightmap.lightTexture}
          opacity={1}
          polygonOffset
          polygonOffsetFactor={-5}
          polygonOffsetUnits={-5}
          transparent
        />
      </mesh>
    </group>
  )
}

function RoomFloorFinishes({
  elevation,
  floorId,
  openings,
  roomSurfacePolygonsBySignature,
  rooms,
  surfaceAssignments,
  visibleRoomSignatures,
  wireframe,
}: {
  elevation: number
  floorId: string
  openings: Point[][]
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
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
          const polygon = getRenderableRoomPolygon(
            room,
            roomSurfacePolygonsBySignature,
          )
          const assignment = getRoomFloorMaterialAssignment(
            surfaceAssignments,
            floorId,
            room.signature,
            polygon,
            rooms,
          )

          return assignment && polygon ? (
            <RoomFloorFinishMesh
              key={room.signature}
              assignment={assignment}
              elevation={elevation}
              materialId={assignment.materialId}
              openings={openings}
              polygon={polygon}
              wireframe={wireframe}
            />
          ) : null
        })}
    </group>
  )
}

function RoomPortalFloorMesh({
  assignment,
  elevation,
  floorId,
  isSelected,
  material,
  onRegisterPickTarget,
  portal,
  shadowsEnabled,
  wireframe,
}: {
  assignment?: SurfaceMaterialAssignment
  elevation: number
  floorId: string
  isSelected: boolean
  material?: SurfaceMaterialProduct
  onRegisterPickTarget: (target: PickTarget) => () => void
  portal: PortalFloorGeometry
  shadowsEnabled: boolean
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const y = elevation + FLOOR_FINISH_VERTICAL_OFFSET_METERS
  const shape = useMemo(() => {
    const halfWidth = portal.width / 2
    const halfDepth = portal.depth / 2
    const normal = {
      x: -portal.direction.y,
      y: portal.direction.x,
    }
    const along = (distance: number, across: number) => ({
      x:
        portal.center.x +
        portal.direction.x * distance +
        normal.x * across,
      y:
        portal.center.y +
        portal.direction.y * distance +
        normal.y * across,
    })

    return createPlanShape([
      along(-halfWidth, -halfDepth),
      along(halfWidth, -halfDepth),
      along(halfWidth, halfDepth),
      along(-halfWidth, halfDepth),
    ])
  }, [portal])
  const surface = useMemo<SelectableSurface>(
    () => ({
      floorId,
      openingId: portal.openingId,
      type: 'portal-floor',
      wallId: portal.wallId,
    }),
    [floorId, portal.openingId, portal.wallId],
  )

  useHorizontalSurfaceVisibility(meshRef, y, 'above')

  useEffect(() => {
    const object = meshRef.current

    if (!object) {
      return undefined
    }

    return onRegisterPickTarget({
      blocksCollision: false,
      floorId,
      kind: 'surface',
      object,
      pickSide: FrontSide,
      surface,
    })
  }, [floorId, onRegisterPickTarget, surface])

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[0, y, 0]}
        receiveShadow={shadowsEnabled}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={2}
      >
        <shapeGeometry args={[shape]} />
        {assignment && material ? (
          <SurfaceMeshStandardMaterial
            assignment={assignment}
            displacementEnabled={false}
            material={material}
            side={FrontSide}
            wireframe={wireframe}
          />
        ) : (
          <meshStandardMaterial
            color="#f8fafc"
            roughness={0.82}
            side={FrontSide}
            wireframe={wireframe}
          />
        )}
      </mesh>
      {isSelected ? (
        <mesh
          position={[0, y, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={6}
        >
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial
            color="#f97316"
            depthWrite={false}
            opacity={0.28}
            polygonOffset
            polygonOffsetFactor={-8}
            polygonOffsetUnits={-8}
            side={FrontSide}
            transparent
          />
        </mesh>
      ) : null}
    </group>
  )
}

function RoomPortalFloors({
  elevation,
  floorId,
  onRegisterPickTarget,
  selectedSurface,
  shadowsEnabled,
  surfaceAssignments,
  walls,
  wireframe,
}: {
  elevation: number
  floorId: string
  onRegisterPickTarget: (target: PickTarget) => () => void
  selectedSurface: SelectableSurface | null
  shadowsEnabled: boolean
  surfaceAssignments: SurfaceMaterialAssignment[]
  walls: Wall[]
  wireframe: boolean
}) {
  const thresholdPortals = useMemo(() => {
    return walls.flatMap((wall) => {
      const wallLength = Math.hypot(
        wall.end.x - wall.start.x,
        wall.end.y - wall.start.y,
      )

      if (wallLength <= 0.000001) {
        return []
      }

      const direction = {
        x: (wall.end.x - wall.start.x) / wallLength,
        y: (wall.end.y - wall.start.y) / wallLength,
      }

      return (wall.openings ?? [])
        .filter((opening) => opening.bottom <= 0.05)
        .map((opening) => ({
          center: getWallPointAtDistance(wall, opening.center),
          depth: wall.thickness,
          direction,
          openingId: opening.id,
          wallId: wall.id,
          width: opening.width,
        }))
    })
  }, [walls])

  return thresholdPortals.map((portal) => {
    const surface: SelectableSurface = {
      floorId,
      openingId: portal.openingId,
      type: 'portal-floor',
      wallId: portal.wallId,
    }
    const assignment = surfaceAssignments.findLast(
      (candidate) =>
        candidate.target.type === 'portal-floor' &&
        candidate.target.floorId === floorId &&
        candidate.target.wallId === portal.wallId &&
        candidate.target.openingId === portal.openingId,
    )
    const material = assignment
      ? surfaceMaterialsById.get(assignment.materialId)
      : undefined

    return (
      <RoomPortalFloorMesh
        key={`${portal.wallId}:${portal.openingId}`}
        assignment={assignment}
        elevation={elevation}
        floorId={floorId}
        isSelected={surfacesMatch(selectedSurface, surface)}
        material={material}
        onRegisterPickTarget={onRegisterPickTarget}
        portal={portal}
        shadowsEnabled={shadowsEnabled}
        wireframe={wireframe}
      />
    )
  })
}

function RoomCeilingFinishMesh({
  assignment,
  elevation,
  materialId,
  openings,
  polygon,
  roomHeight,
  wireframe,
}: {
  assignment: SurfaceMaterialAssignment
  elevation: number
  materialId: string
  openings: Point[][]
  polygon: Point[]
  roomHeight: number
  wireframe: boolean
}) {
  const meshRef = useRef<Object3D>(null!)
  const material = surfaceMaterialsById.get(materialId)
  const visualPolygon = useMemo(
    () => getOffsetFootprint(polygon, CEILING_VISUAL_OVERLAP_METERS),
    [polygon],
  )
  const shapes = useMemo(
    () => createPlanShapesWithCutouts(visualPolygon, openings),
    [openings, visualPolygon],
  )
  const y = elevation + roomHeight - CEILING_VERTICAL_OVERLAP_METERS

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
      <shapeGeometry args={[shapes]} />
      <SurfaceMeshStandardMaterial
        assignment={assignment}
        displacementEnabled={false}
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
  openings,
  roomSurfacePolygonsBySignature,
  roomHeight,
  rooms,
  surfaceAssignments,
  visibleRoomSignatures,
  wireframe,
}: {
  elevation: number
  floorId: string
  openings: Point[][]
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
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
          const polygon = getRenderableRoomPolygon(
            room,
            roomSurfacePolygonsBySignature,
          )
          const assignment = getRoomCeilingMaterialAssignment(
            surfaceAssignments,
            floorId,
            room.signature,
            polygon,
            rooms,
          )

          return assignment && polygon ? (
            <RoomCeilingFinishMesh
              key={room.signature}
              assignment={assignment}
              elevation={elevation}
              materialId={assignment.materialId}
              openings={openings}
              polygon={polygon}
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

function getPlanAabbWidth(bounds: PlanAabb) {
  return bounds.maxX - bounds.minX
}

function getPlanAabbDepth(bounds: PlanAabb) {
  return bounds.maxY - bounds.minY
}

function getPlanAabbOverlapOnX(firstBounds: PlanAabb, secondBounds: PlanAabb) {
  return (
    Math.min(firstBounds.maxX, secondBounds.maxX) -
    Math.max(firstBounds.minX, secondBounds.minX)
  )
}

function getPlanAabbOverlapOnY(firstBounds: PlanAabb, secondBounds: PlanAabb) {
  return (
    Math.min(firstBounds.maxY, secondBounds.maxY) -
    Math.max(firstBounds.minY, secondBounds.minY)
  )
}

function getPlanAabbHorizontalSnapDelta(
  objectBounds: PlanAabb,
  targetBounds: PlanAabb,
) {
  const candidates: Array<{
    axis: 'x' | 'z'
    distance: number
    dx: number
    dz: number
  }> = []
  const addCandidate = (
    dx: number,
    dz: number,
    overlap: number,
    allowOverlap = true,
  ) => {
    const signedSeparation = dx !== 0 ? dx : dz
    const distance = Math.abs(signedSeparation)
    const snapDistance = allowOverlap
      ? Math.max(MODEL_EDGE_SNAP_DISTANCE_METERS, MODEL_EDGE_SNAP_OVERLAP_METERS)
      : MODEL_EDGE_SNAP_DISTANCE_METERS

    if (
      distance <= snapDistance &&
      overlap >= MODEL_EDGE_SNAP_MIN_OVERLAP_METERS
    ) {
      candidates.push({ axis: dx !== 0 ? 'x' : 'z', distance, dx, dz })
    }
  }
  const objectWidth = getPlanAabbWidth(objectBounds)
  const objectDepth = getPlanAabbDepth(objectBounds)
  const targetWidth = getPlanAabbWidth(targetBounds)
  const targetDepth = getPlanAabbDepth(targetBounds)
  const similarWidth = Math.abs(objectWidth - targetWidth) <= MODEL_EDGE_SNAP_DISTANCE_METERS
  const similarDepth = Math.abs(objectDepth - targetDepth) <= MODEL_EDGE_SNAP_DISTANCE_METERS
  const overlapX = getPlanAabbOverlapOnX(objectBounds, targetBounds)
  const overlapY = getPlanAabbOverlapOnY(objectBounds, targetBounds)

  addCandidate(targetBounds.minX - objectBounds.maxX, 0, overlapY)
  addCandidate(targetBounds.maxX - objectBounds.minX, 0, overlapY)
  addCandidate(0, targetBounds.minY - objectBounds.maxY, overlapX)
  addCandidate(0, targetBounds.maxY - objectBounds.minY, overlapX)

  if (similarDepth) {
    addCandidate(0, targetBounds.minY - objectBounds.minY, objectWidth, false)
    addCandidate(0, targetBounds.maxY - objectBounds.maxY, objectWidth, false)
  }

  if (similarWidth) {
    addCandidate(targetBounds.minX - objectBounds.minX, 0, objectDepth, false)
    addCandidate(targetBounds.maxX - objectBounds.maxX, 0, objectDepth, false)
  }

  const bestX = candidates
    .filter((candidate) => candidate.axis === 'x')
    .sort(
      (firstCandidate, secondCandidate) =>
        firstCandidate.distance - secondCandidate.distance,
    )[0]
  const bestZ = candidates
    .filter((candidate) => candidate.axis === 'z')
    .sort(
      (firstCandidate, secondCandidate) =>
        firstCandidate.distance - secondCandidate.distance,
    )[0]

  if (!bestX && !bestZ) {
    return null
  }

  return {
    distance: Math.max(bestX?.distance ?? 0, bestZ?.distance ?? 0),
    dx: bestX?.dx ?? 0,
    dz: bestZ?.dz ?? 0,
  }
}

function getOutwardProjection(
  rotationY: number,
  localPoint: Point,
  outwardDirection: Point,
) {
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const worldX = localPoint.x * cos + localPoint.y * sin
  const worldZ = -localPoint.x * sin + localPoint.y * cos

  return worldX * outwardDirection.x + worldZ * outwardDirection.y
}

function getWallInsetForLocalBounds(
  localBounds: ModelHorizontalBounds | null,
  rotationY: number,
  outwardDirection: Point,
) {
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

function getOutwardExtentForLocalBounds(
  localBounds: ModelHorizontalBounds | null,
  rotationY: number,
  outwardDirection: Point,
) {
  if (!localBounds) {
    return 0
  }

  const localCorners = [
    { x: localBounds.minX, y: localBounds.minZ },
    { x: localBounds.minX, y: localBounds.maxZ },
    { x: localBounds.maxX, y: localBounds.minZ },
    { x: localBounds.maxX, y: localBounds.maxZ },
  ]

  return Math.max(
    ...localCorners.map((corner) =>
      getOutwardProjection(rotationY, corner, outwardDirection),
    ),
  )
}

function getModelWallSnap(
  position: Point,
  localBounds: ModelHorizontalBounds | null,
  localForwardAngle: number | null,
  walls: Wall[],
) {

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
      const wallInset = getWallInsetForLocalBounds(
        localBounds,
        -rotation,
        outwardDirection,
      )
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

function getWallLength2d(wall: Wall) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
}

function getWallModelOpeningMetrics(
  model: PlacedModel,
  wall: Wall,
): { centerOffset: number; width: number } | null {
  const definition = modelsById.get(model.modelId)

  if (!definition?.wallMount) {
    return null
  }

  const scale = model.scale ?? 1
  const widthScale = model.widthScale ?? 1
  const wallLength = getWallLength2d(wall)
  const width = Math.min(
    Math.max(
      (definition.openingWidth ?? definition.width) * scale * widthScale,
      0.3,
    ),
    Math.max(wallLength - 0.2, 0.3),
  )

  return {
    centerOffset: (definition.openingCenterOffset ?? 0) * scale * widthScale,
    width,
  }
}

function getProjectedWallOffset(point: Point, wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= 0.000001) {
    return 0
  }

  return ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) /
    Math.sqrt(lengthSquared)
}

function getPointAtWallOffset(wall: Wall, offset: number) {
  const length = getWallLength2d(wall)

  if (length <= 0.000001) {
    return wall.start
  }

  const unit = {
    x: (wall.end.x - wall.start.x) / length,
    y: (wall.end.y - wall.start.y) / length,
  }

  return {
    x: wall.start.x + unit.x * offset,
    y: wall.start.y + unit.y * offset,
  }
}

function getWallOffsetPosition(
  wall: Wall,
  offset: number,
  side: -1 | 1,
  sideDistance: number,
) {
  const length = getWallLength2d(wall)

  if (length <= 0.000001) {
    return wall.start
  }

  const unit = {
    x: (wall.end.x - wall.start.x) / length,
    y: (wall.end.y - wall.start.y) / length,
  }
  const normal = {
    x: -unit.y,
    y: unit.x,
  }
  const centerlinePosition = getPointAtWallOffset(wall, offset)

  return {
    x: centerlinePosition.x + normal.x * side * sideDistance,
    y: centerlinePosition.y + normal.y * side * sideDistance,
  }
}

function getWallMountedModelFallbackLocalBounds(
  definition: ModelDefinition,
): ModelHorizontalBounds {
  return {
    maxX: definition.width / 2,
    maxZ: definition.depth,
    minX: -definition.width / 2,
    minZ: 0,
  }
}

function getWallMountedModelLocalBounds(
  definition: ModelDefinition,
  importedLocalBounds: ModelHorizontalBounds | null,
) {
  return definition.sourceUrl
    ? importedLocalBounds ??
        definition.localBounds ??
        getWallMountedModelFallbackLocalBounds(definition)
    : getWallMountedModelFallbackLocalBounds(definition)
}

function getWallMountedModelDisplayPosition({
  definition,
  importedLocalBounds,
  model,
  offset,
  rotation,
  side,
  wall,
}: {
  definition: ModelDefinition
  importedLocalBounds: ModelHorizontalBounds | null
  model: PlacedModel
  offset: number
  rotation: number
  side: -1 | 1
  wall: Wall
}) {
  const length = getWallLength2d(wall)

  if (length <= 0.000001) {
    return wall.start
  }

  const unit = {
    x: (wall.end.x - wall.start.x) / length,
    y: (wall.end.y - wall.start.y) / length,
  }
  const normal = {
    x: -unit.y,
    y: unit.x,
  }
  const outwardDirection = {
    x: normal.x * side,
    y: normal.y * side,
  }
  const localBounds = getWallMountedModelLocalBounds(
    definition,
    importedLocalBounds,
  )
  const scale = model.scale ?? 1
  const widthScale = scale * (model.widthScale ?? 1)
  const depthScale = scale * (model.depthScale ?? 1)
  const scaledLocalBounds = {
    maxX: localBounds.maxX * widthScale,
    maxZ: localBounds.maxZ * depthScale,
    minX: localBounds.minX * widthScale,
    minZ: localBounds.minZ * depthScale,
  }
  const boundsOutwardExtent = getOutwardExtentForLocalBounds(
    scaledLocalBounds,
    -rotation,
    outwardDirection,
  )
  const frameAnchorDepth = definition.sourceUrl
    ? Math.min(
        Math.max(definition.depth * depthScale, 0),
        WALL_MOUNT_FRAME_ANCHOR_DEPTH_METERS * depthScale,
      )
    : Number.POSITIVE_INFINITY
  const outwardExtent = Math.min(boundsOutwardExtent, frameAnchorDepth)
  const targetDistance =
    wall.thickness / 2 - WINDOW_WALL_FACE_INSET_METERS - outwardExtent

  return getWallOffsetPosition(
    wall,
    offset,
    side,
    targetDistance,
  )
}

function getWallMountedModelRotation(wall: Wall, side: -1 | 1) {
  return Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) +
    (side < 0 ? Math.PI : 0)
}

function getExteriorWallSide(wall: Wall, rooms: DetectedRoom[]): -1 | 1 {
  if (wall.kind !== 'external') {
    return 1
  }

  const length = getWallLength2d(wall)

  if (length <= 0.000001) {
    return 1
  }

  const unit = {
    x: (wall.end.x - wall.start.x) / length,
    y: (wall.end.y - wall.start.y) / length,
  }
  const normal = {
    x: -unit.y,
    y: unit.x,
  }
  const midpoint = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  }
  const sampleDistance = wall.thickness / 2 + 0.08
  const positiveRoom = getRoomContainingPoint(rooms, {
    x: midpoint.x + normal.x * sampleDistance,
    y: midpoint.y + normal.y * sampleDistance,
  })
  const negativeRoom = getRoomContainingPoint(rooms, {
    x: midpoint.x - normal.x * sampleDistance,
    y: midpoint.y - normal.y * sampleDistance,
  })

  if (positiveRoom && !negativeRoom) {
    return -1
  }

  if (negativeRoom && !positiveRoom) {
    return 1
  }

  return 1
}

function getExteriorWallSidesByWallId(walls: Wall[], rooms: DetectedRoom[]) {
  return new Map(
    walls
      .filter((wall) => wall.kind === 'external')
      .map((wall) => [wall.id, getExteriorWallSide(wall, rooms)] as const),
  )
}

function getWallOpeningDepthsByModelId(walls: Wall[]) {
  const modelIds = new Set(
    walls.flatMap((wall) => (wall.openings ?? []).map((opening) => opening.modelId)),
  )

  return new Map(
    Array.from(modelIds).flatMap((modelId) => {
      const definition = modelsById.get(modelId)

      return definition ? [[modelId, definition.depth] as const] : []
    }),
  )
}

function snapWindowWallOffset({
  model,
  models,
  offset,
  wall,
}: {
  model: PlacedModel
  models: PlacedModel[]
  offset: number
  wall: Wall
}) {
  const metrics = getWallModelOpeningMetrics(model, wall)

  if (!metrics) {
    return offset
  }

  const currentLeft = offset + metrics.centerOffset - metrics.width / 2
  const currentRight = offset + metrics.centerOffset + metrics.width / 2
  let bestSnapDistance = Number.POSITIVE_INFINITY
  let bestSnapOffset: number | null = null

  const addCandidate = (candidateOffset: number) => {
    const distance = Math.abs(candidateOffset - offset)

    if (
      distance <= WINDOW_WALL_OFFSET_SNAP_DISTANCE_METERS &&
      distance < bestSnapDistance
    ) {
      bestSnapDistance = distance
      bestSnapOffset = candidateOffset
    }
  }

  for (const otherModel of models) {
    if (
      otherModel.id === model.id ||
      otherModel.wallAttachment?.wallId !== wall.id
    ) {
      continue
    }

    const otherOpenings = wall.openings ?? []

    for (const opening of otherOpenings) {
      const [ownerId] = opening.id.split(':')

      if (ownerId !== otherModel.id) {
        continue
      }

      addCandidate(opening.center - opening.width / 2 - metrics.centerOffset - metrics.width / 2)
      addCandidate(opening.center + opening.width / 2 - metrics.centerOffset + metrics.width / 2)

      if (Math.abs(currentLeft - (opening.center + opening.width / 2)) <= WINDOW_WALL_OFFSET_SNAP_DISTANCE_METERS) {
        addCandidate(opening.center + opening.width / 2 - metrics.centerOffset + metrics.width / 2)
      }

      if (Math.abs(currentRight - (opening.center - opening.width / 2)) <= WINDOW_WALL_OFFSET_SNAP_DISTANCE_METERS) {
        addCandidate(opening.center - opening.width / 2 - metrics.centerOffset - metrics.width / 2)
      }
    }
  }

  return bestSnapOffset ?? offset
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
  models,
  modelAssetVersion,
  pickTargetsRef,
  onRegisterPickTarget,
  onTransformActiveChange,
  onUpdateModel,
  rooms,
  shadowsEnabled,
  stairSnapWalls,
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
  models: PlacedModel[]
  modelAssetVersion: number
  pickTargetsRef: MutableRefObject<PickTarget[]>
  onRegisterPickTarget: (target: PickTarget) => () => void
  onTransformActiveChange: (isActive: boolean) => void
  onUpdateModel: (modelId: string, updates: Partial<PlacedModel>) => void
  rooms: DetectedRoom[]
  shadowsEnabled: boolean
  stairSnapWalls: Wall[]
  transformEnabled: boolean
  transformMode: TransformMode
  walls: Wall[]
  wireframe: boolean
}) {
  const groupRef = useRef<Object3D>(null!)
  const transformModifierRef = useRef({ ctrlKey: false, shiftKey: false })
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
        ? model.wallOpeningBottom ?? WINDOW_SILL_HEIGHT_METERS
        : 0
  const castsShadow =
    shadowsEnabled &&
    isActive &&
    !modelDefinition.isLight &&
    modelDefinition.wallMount !== 'window' &&
    modelDefinition.wallMount !== 'patio-door'
  const floorSnapY = elevation + verticalOffset
  const wallMountWall = model.wallAttachment?.wallId
    ? walls.find((wall) => wall.id === model.wallAttachment?.wallId)
    : null
  const scaledModelHeight = modelDefinition.height * (model.scale ?? 1)
  const maxWindowBottom = wallMountWall
    ? Math.max(wallMountWall.height - Math.min(Math.max(scaledModelHeight, 0.3), wallMountWall.height), 0)
    : Number.POSITIVE_INFINITY
  const isEditableWallMountedOpening =
    Boolean(modelDefinition.wallMount && model.wallAttachment && wallMountWall)
  const isVerticallyEditableWindow =
    modelDefinition.wallMount === 'window' && Boolean(model.wallAttachment)
  const wallMountedDisplaySide =
    wallMountWall &&
    (modelDefinition.wallMount === 'window' ||
      modelDefinition.wallMount === 'exterior-door' ||
      modelDefinition.wallMount === 'patio-door')
      ? getExteriorWallSide(wallMountWall, rooms)
      : model.wallAttachment?.side ?? 1
  const wallMountedDisplayRotation =
    isEditableWallMountedOpening && wallMountWall
      ? getWallMountedModelRotation(wallMountWall, wallMountedDisplaySide)
      : model.rotation
  const displayPosition =
    isEditableWallMountedOpening && wallMountWall && model.wallAttachment
      ? getWallMountedModelDisplayPosition({
          definition: modelDefinition,
          importedLocalBounds,
          model,
          offset: model.wallAttachment.offset,
          rotation: wallMountedDisplayRotation,
          side: wallMountedDisplaySide,
          wall: wallMountWall,
        })
      : model.position
  const snapObjectToFloor = () => {
    const object = groupRef.current

    if (object && !modelDefinition.isLight && !isVerticallyEditableWindow) {
      object.position.y = floorSnapY
    }
  }
  const getObjectUniformScale = (object: Object3D) =>
    Math.max(
      0.2,
      Math.abs(object.scale.y),
    )
  const getObjectWidthScale = (object: Object3D, uniformScale: number) =>
    Math.max(0.2, Math.abs(object.scale.x) / Math.max(uniformScale, 0.0001))
  const getObjectDepthScale = (object: Object3D, uniformScale: number) =>
    Math.max(0.2, Math.abs(object.scale.z) / Math.max(uniformScale, 0.0001))
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
  useEffect(() => {
    if (!isSelected || !isActive) {
      transformModifierRef.current.ctrlKey = false
      transformModifierRef.current.shiftKey = false
      return undefined
    }

    const isControlKey = (event: KeyboardEvent) =>
      event.key === 'Control' ||
      event.code === 'ControlLeft' ||
      event.code === 'ControlRight'
    const isShiftKey = (event: KeyboardEvent) =>
      event.key === 'Shift' ||
      event.code === 'ShiftLeft' ||
      event.code === 'ShiftRight'
    const updateModifierKeys = (event: KeyboardEvent) => {
      transformModifierRef.current.ctrlKey = event.ctrlKey || isControlKey(event)
      transformModifierRef.current.shiftKey = event.shiftKey || isShiftKey(event)
    }
    const releaseModifierKeys = (event: KeyboardEvent) => {
      transformModifierRef.current.ctrlKey = isControlKey(event)
        ? false
        : event.ctrlKey
      transformModifierRef.current.shiftKey = isShiftKey(event)
        ? false
        : event.shiftKey
    }
    const clearModifierKeys = () => {
      transformModifierRef.current.ctrlKey = false
      transformModifierRef.current.shiftKey = false
    }

    window.addEventListener('keydown', updateModifierKeys, true)
    window.addEventListener('keyup', releaseModifierKeys, true)
    window.addEventListener('blur', clearModifierKeys)

    return () => {
      window.removeEventListener('keydown', updateModifierKeys, true)
      window.removeEventListener('keyup', releaseModifierKeys, true)
      window.removeEventListener('blur', clearModifierKeys)
      clearModifierKeys()
    }
  }, [isActive, isSelected])
  const objectCollides = ({
    ignoreWalls = false,
    ignoredWallId,
    tolerance = 0,
  }: {
    ignoreWalls?: boolean
    ignoredWallId?: string
    tolerance?: number
  } = {}) => {
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
    const collidesWithWall = !ignoreWalls && walls.some((wall) => {
      if (wall.id === ignoredWallId) {
        return false
      }

      return planAabbsOverlap(
        objectBounds,
        getPlanAabbFromPoints(getWallPolygon({ wall, startExtension: 0, endExtension: 0 })),
        tolerance,
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
        tolerance,
      )
    })
  }
  const applyObjectEdgeSnap = () => {
    const object = groupRef.current

    if (!object || modelDefinition.isLight || modelDefinition.wallMount) {
      return
    }

    const collisionTarget =
      pickTargetsRef.current.find(
        (target) => target.kind === 'model' && target.modelId === model.id,
      )
        ?.object ?? object

    object.updateWorldMatrix(true, true)
    collisionTarget.updateWorldMatrix(true, false)

    const objectBounds = getPlanAabbFromBox(new Box3().setFromObject(collisionTarget))
    let bestSnap: {
      distance: number
      dx: number
      dz: number
      targetModelId: string
    } | null = null

    for (const target of pickTargetsRef.current) {
      if (
        !target.blocksCollision ||
        target.kind !== 'model' ||
        target.modelId === model.id ||
        target.floorId !== floorId
      ) {
        continue
      }

      target.object.updateWorldMatrix(true, false)

      const snap = getPlanAabbHorizontalSnapDelta(
        objectBounds,
        getPlanAabbFromBox(new Box3().setFromObject(target.object)),
      )

      if (!snap || (bestSnap && snap.distance >= bestSnap.distance)) {
        continue
      }

      bestSnap = {
        ...snap,
        targetModelId: target.modelId,
      }
    }

    if (!bestSnap) {
      return null
    }

    object.position.x += bestSnap.dx
    object.position.z += bestSnap.dz
    object.updateWorldMatrix(true, true)

    return bestSnap
  }
  const applyObjectSnaps = () => {
    const object = groupRef.current

    if (!object) {
      return null
    }

    if (isEditableWallMountedOpening) {
      const wall = wallMountWall
      const metrics = wall ? getWallModelOpeningMetrics(model, wall) : null
      const rawOffset =
        wall && metrics
          ? getProjectedWallOffset(
              { x: object.position.x, y: object.position.z },
              wall,
            )
          : model.wallAttachment?.offset ?? 0
      const wallLength = wall ? getWallLength2d(wall) : 0
      const minOffset = metrics ? metrics.width / 2 - metrics.centerOffset : 0
      const maxOffset =
        metrics && wall
          ? wallLength - metrics.width / 2 - metrics.centerOffset
          : wallLength
      const side = model.wallAttachment?.side ?? 1
      const steppedOffset = transformModifierRef.current.ctrlKey
        ? rawOffset
        : Math.round(rawOffset / WINDOW_WALL_OFFSET_STEP_METERS) *
          WINDOW_WALL_OFFSET_STEP_METERS
      const snappedOffset =
        wall && !transformModifierRef.current.ctrlKey
          ? snapWindowWallOffset({
              model,
              models,
              offset: steppedOffset,
              wall,
            })
          : steppedOffset
      const nextOffset = Math.max(minOffset, Math.min(maxOffset, snappedOffset))
      const displayPosition = wall
        ? getWallMountedModelDisplayPosition({
            definition: modelDefinition,
          importedLocalBounds,
          model,
          offset: nextOffset,
          rotation: wallMountedDisplayRotation,
          side: wall.kind === 'external' ? wallMountedDisplaySide : side,
          wall,
        })
        : model.position
      const savedPosition = wall
        ? getPointAtWallOffset(wall, nextOffset)
        : model.position

      object.position.x = displayPosition.x
      object.position.z = displayPosition.y
      object.rotation.y = -wallMountedDisplayRotation
      object.position.y = isVerticallyEditableWindow
        ? elevation + Math.max(0, Math.min(maxWindowBottom, object.position.y - elevation))
        : floorSnapY
      object.updateWorldMatrix(true, true)
      updateLastValidTransform()

      return {
        height: undefined,
        position: savedPosition,
        rotation: wallMountedDisplayRotation,
        scale: model.scale ?? 1,
        wallAttachment: model.wallAttachment
          ? {
              ...model.wallAttachment,
              offset: nextOffset,
            }
          : undefined,
        wallOpeningBottom: isVerticallyEditableWindow
          ? object.position.y - elevation
          : undefined,
        widthScale: model.widthScale ?? 1,
        depthScale: model.depthScale ?? 1,
      }
    }

    snapObjectToFloor()

    const snappingDisabled = transformModifierRef.current.ctrlKey
    const uniformScale = getObjectUniformScale(object)
    const widthScale = getObjectWidthScale(object, uniformScale)
    const depthScale = getObjectDepthScale(object, uniformScale)
    const transformedPosition = {
      x: object.position.x,
      y: object.position.z,
    }
    const isStairs = modelDefinition.objectType === 'stairs'
    const stairSnap = snappingDisabled || !isStairs
      ? null
      : snapStairApertureToWalls({
          depth: modelDefinition.depth,
          localBounds: importedLocalBounds,
          position: transformedPosition,
          rotation: -object.rotation.y,
          scale: uniformScale,
          widthScale,
          depthScale,
          walls: stairSnapWalls,
          width: modelDefinition.width,
        })
    const wallSnap = snappingDisabled || isStairs || modelDefinition.wallMount || modelDefinition.isLight
      ? null
      : getModelWallSnap(
          transformedPosition,
          modelDefinition.sourceUrl ? importedLocalBounds : null,
          importedForwardAngle,
          walls,
        )

    if (stairSnap) {
      object.position.x = stairSnap.position.x
      object.position.z = stairSnap.position.y
    } else if (wallSnap) {
      object.position.x = wallSnap.position.x
      object.position.z = wallSnap.position.y
      object.rotation.y = -wallSnap.rotation
    }

    if (!snappingDisabled && !isStairs) {
      applyObjectEdgeSnap()
    }

    if (
      !snappingDisabled &&
      objectCollides({
        ignoreWalls: isStairs,
        ignoredWallId: wallSnap?.wallId,
      })
    ) {
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
      position: {
        x: object.position.x,
        y: object.position.z,
      },
      rotation: wallSnap?.rotation ?? -object.rotation.y,
      scale: uniformScale,
      wallAttachment: undefined,
      wallOpeningBottom: undefined,
      widthScale,
      depthScale,
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
      wallAttachment: snappedTransform.wallAttachment,
      wallOpeningBottom: snappedTransform.wallOpeningBottom,
      widthScale: snappedTransform.widthScale,
      depthScale: snappedTransform.depthScale,
    })
  }
  const localModelTransform = (
    <group
      rotation={[0, model.flipped ? Math.PI : 0, 0]}
      scale={[model.mirrored ? -1 : 1, 1, 1]}
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
          normalizeToDimensions={Boolean(modelDefinition.normalizeToDimensions)}
          targetDepth={modelDefinition.depth}
          targetHeight={modelDefinition.height}
          targetWidth={modelDefinition.width}
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
  const modelGroup = (
    <group
      ref={groupRef}
      position={[displayPosition.x, floorSnapY, displayPosition.y]}
      rotation={[0, -wallMountedDisplayRotation, 0]}
      scale={[
        (model.scale ?? 1) * (model.widthScale ?? 1),
        model.scale ?? 1,
        (model.scale ?? 1) * (model.depthScale ?? 1),
      ]}
      renderOrder={isActive ? 3 : 1}
    >
      {localModelTransform}
    </group>
  )

  if (isSelected && isActive && transformEnabled) {
    return (
      <>
        {modelGroup}
        <TransformControls
          object={groupRef}
          mode={transformMode}
          showX={
            isVerticallyEditableWindow ? transformMode === 'translate' : true
          }
          showY={
            isVerticallyEditableWindow ? transformMode === 'translate' : true
          }
          showZ={
            isVerticallyEditableWindow ? transformMode === 'translate' : true
          }
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
    if (!WALL_RENDER_DEBUG_ENABLED) {
      return
    }

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
  externalWallFootprintGroups,
  externalWallUnionWallIds,
  fakeAmbientOcclusionEnabled,
  fakeAmbientOcclusionIntensity,
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
  roomSurfacePolygonsBySignature,
  rooms,
  selectedWallId,
  selectedSurface,
  shadowsEnabled,
  showWallPerimeter,
  stairSnapWalls,
  surfaceAssignments,
  transformEnabled,
  transformMode,
  visibleRoomSignatures,
  wallBodyOccluders,
  wireframe,
}: {
  daylightEnabled: boolean
  externalWallFootprintGroups: WallFootprintRenderGroup[]
  externalWallUnionWallIds: string[]
  fakeAmbientOcclusionEnabled: boolean
  fakeAmbientOcclusionIntensity: number
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
  roomSurfacePolygonsBySignature?: Map<string, Point[]>
  rooms: DetectedRoom[]
  selectedWallId: string | null
  selectedSurface: SelectableSurface | null
  shadowsEnabled: boolean
  showWallPerimeter: boolean
  stairSnapWalls: Wall[]
  surfaceAssignments: SurfaceMaterialAssignment[]
  transformEnabled: boolean
  transformMode: TransformMode
  visibleRoomSignatures?: ReadonlySet<string> | null
  wallBodyOccluders: WallBodyOccluder[]
  wireframe: boolean
}) {
  const usesExternalWallUnion =
    !WALL_BODY_PERIMETER_MESH_ENABLED && externalWallFootprintGroups.length > 0
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
    if (!WALL_RENDER_DEBUG_ENABLED) {
      return
    }

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
      {usesExternalWallUnion
        ? externalWallFootprintGroups.map((group) => (
          <WallFootprintMeshes
            key={group.wallId}
            castsShadow={shadowsEnabled}
            elevation={floor.elevation}
            floorId={floor.id}
            footprints={group.footprints}
            geometryContextRenderedWalls={renderedWalls}
            geometryContextWalls={geometryContextWalls}
            height={floor.roomHeight}
            onRegisterPickTarget={onRegisterPickTarget}
            rooms={rooms}
            selectedWallId={selectedWallId}
            selectedSurface={selectedSurface}
            sourceWalls={(group.wallIds ?? [group.wallId])
              .map((wallId) => wallsById.get(wallId))
              .filter((wall): wall is Wall => Boolean(wall))}
            surfaceAssignments={surfaceAssignments}
            wallKind="external"
            wireframe={wireframe}
          />
        ))
        : null}
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
          rooms={rooms}
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
      {wallEngineRenderedWalls.length > 0 || rooms.length > 0 ? (
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
          showWallPerimeter={showWallPerimeter}
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
        geometryContextWalls={geometryContextWalls}
        models={visibleModels}
        renderedWalls={renderedWalls}
        roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
        rooms={rooms}
        wireframe={wireframe}
      />
      <FakeAmbientOcclusion
        elevation={floor.elevation}
        geometryContextWalls={geometryContextWalls}
        intensity={fakeAmbientOcclusionIntensity}
        roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
        rooms={rooms}
        visible={fakeAmbientOcclusionEnabled && !wireframe}
      />
      <Suspense fallback={null}>
        {visibleModels.map((model) => (
          <ModelLoadBoundary
            key={`${model.id}:${modelAssetVersion}`}
            modelId={model.id}
          >
            <ModelMesh
              daylightEnabled={daylightEnabled}
              elevation={floor.elevation}
              floorId={floor.id}
              frustumCullingEnabled={frustumCullingEnabled}
              isActive
              isSelected={isSelectedModel(model.id)}
              lightMarkersVisible={lightMarkersVisible}
              model={model}
              models={visibleModels}
              modelAssetVersion={modelAssetVersion}
              pickTargetsRef={pickTargetsRef}
              onRegisterPickTarget={onRegisterPickTarget}
              onTransformActiveChange={onTransformActiveChange}
              onUpdateModel={onUpdateModel}
              rooms={rooms}
              shadowsEnabled={shadowsEnabled}
              stairSnapWalls={stairSnapWalls}
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

  useEffect(() => {
    if (!modelDefinition) {
      return
    }

    recordEngineLog(
      'model-loaded',
      `${modelDefinition.name} (${model.id}) ${formatDimensions(
        modelDefinition.width,
        modelDefinition.height,
        modelDefinition.depth,
      )}`,
    )
  }, [model.id, modelDefinition])

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

  useEffect(() => {
    if (!modelDefinition) {
      return
    }

    recordEngineLog(
      'model-loaded',
      `${modelDefinition.name} (${model.id}) ${formatDimensions(
        modelDefinition.width,
        modelDefinition.height,
        modelDefinition.depth,
      )}`,
    )
  }, [model.id, modelDefinition])

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
  normalizeToDimensions,
  onBoundsChange,
  onRegisterPickTarget,
  sourceUrl,
  targetDepth,
  targetHeight,
  targetWidth,
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
  normalizeToDimensions: boolean
  onBoundsChange: (bounds: ModelHorizontalBounds) => void
  onRegisterPickTarget: (target: PickTarget) => () => void
  sourceUrl: string
  targetDepth: number
  targetHeight: number
  targetWidth: number
  wireframe: boolean
}) {
  const normalizedGroupRef = useRef<Object3D>(null!)
  const { gl } = useThree()
  useEffect(() => {
    recordEngineLog('model-load-start', getAssetFileName(sourceUrl))
  }, [sourceUrl])
  const gltf = useGLTF(sourceUrl, true, true, (loader) => {
    setGltfKtx2Loader(loader, gl)
  })
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
  const normalizedTransform = useMemo(() => {
    const scaleX = normalizeToDimensions
      ? targetWidth / Math.max(bounds.size.x, 0.0001)
      : 1
    const scaleY = normalizeToDimensions
      ? targetHeight / Math.max(bounds.size.y, 0.0001)
      : 1
    const scaleZ = normalizeToDimensions
      ? targetDepth / Math.max(bounds.size.z, 0.0001)
      : 1
    const size = normalizeToDimensions
      ? new Vector3(targetWidth, targetHeight, targetDepth)
      : bounds.size.clone()

    return {
      center: bounds.center.clone().multiply(new Vector3(scaleX, scaleY, scaleZ)),
      offset: new Vector3(0, 0, 0),
      scale: new Vector3(scaleX, scaleY, scaleZ),
      size,
    }
  }, [
    bounds.box.min.x,
    bounds.box.min.y,
    bounds.box.min.z,
    bounds.size.x,
    bounds.size.y,
    bounds.size.z,
    normalizeToDimensions,
    targetDepth,
    targetHeight,
    targetWidth,
  ])

  useEffect(() => {
    if (!normalizeToDimensions) {
      onBoundsChange({
        maxX: bounds.box.max.x,
        maxZ: bounds.box.max.z,
        minX: bounds.box.min.x,
        minZ: bounds.box.min.z,
      })
      return
    }

    onBoundsChange({
      maxX: bounds.box.max.x * normalizedTransform.scale.x,
      maxZ: bounds.box.max.z * normalizedTransform.scale.z,
      minX: bounds.box.min.x * normalizedTransform.scale.x,
      minZ: bounds.box.min.z * normalizedTransform.scale.z,
    })
  }, [
    bounds.box.max.x,
    bounds.box.max.z,
    bounds.box.min.x,
    bounds.box.min.z,
    normalizeToDimensions,
    normalizedTransform.scale.x,
    normalizedTransform.scale.z,
    normalizedTransform.size.x,
    normalizedTransform.size.z,
    onBoundsChange,
  ])

  useEffect(() => {
    recordEngineLog(
      'model-loaded',
      `${getAssetFileName(sourceUrl)} (${modelId}) ${formatDimensions(
        normalizedTransform.size.x,
        normalizedTransform.size.y,
        normalizedTransform.size.z,
      )}`,
    )
  }, [
    modelId,
    normalizedTransform.size.x,
    normalizedTransform.size.y,
    normalizedTransform.size.z,
    sourceUrl,
  ])

  useEffect(() => {
    const object = normalizedGroupRef.current

    if (!object) {
      return undefined
    }

    return onRegisterPickTarget({
      blocksCollision,
      floorId,
      kind: 'model',
      modelId,
      object,
    })
  }, [blocksCollision, floorId, modelId, onRegisterPickTarget])

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
          center={[
            normalizedTransform.center.x,
            normalizedTransform.center.y,
            normalizedTransform.center.z,
          ]}
          size={[
            normalizedTransform.size.x,
            normalizedTransform.size.y,
            normalizedTransform.size.z,
          ]}
        />
      ) : null}
      <group ref={normalizedGroupRef} scale={normalizedTransform.scale}>
        <primitive object={scene} />
      </group>
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

function FixedLocalLightPool({
  activeFloorId,
  localLightIds,
  lightShadowsEnabled,
  maxLights = MAX_REALTIME_LOCAL_LIGHTS,
  shadowsEnabled,
  visibleRenderedFloors,
}: {
  activeFloorId: string
  localLightIds: ReadonlySet<string>
  lightShadowsEnabled: boolean
  maxLights?: number
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
        .slice(0, maxLights),
    [maxLights, slots],
  )
  const spotSlots = useMemo(
    () =>
      slots
        .filter((slot) => slot.kind === 'spot')
        .slice(0, maxLights),
    [maxLights, slots],
  )
  const pointPoolSlots = useMemo(
    () =>
      Array.from(
        { length: maxLights },
        (_, index) => pointSlots[index] ?? null,
      ),
    [maxLights, pointSlots],
  )
  const spotPoolSlots = useMemo(
    () =>
      Array.from(
        { length: maxLights },
        (_, index) => spotSlots[index] ?? null,
      ),
    [maxLights, spotSlots],
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

function SceneRenderInvalidator({
  renderKey,
}: {
  renderKey: string
}) {
  const { invalidate, scene } = useThree()

  useEffect(() => {
    let cancelled = false
    const frameIds: number[] = []
    const renderFrame = () => {
      if (cancelled) {
        return
      }

      invalidate()
    }

    scene.traverse((object) => {
      const material = (object as { material?: Material | Material[] }).material

      if (Array.isArray(material)) {
        material.forEach((entry) => {
          entry.needsUpdate = true
        })
      } else if (material) {
        material.needsUpdate = true
      }
    })

    for (let index = 0; index < 8; index += 1) {
      frameIds.push(window.requestAnimationFrame(renderFrame))
    }

    return () => {
      cancelled = true
      frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId))
    }
  }, [invalidate, renderKey, scene])

  return null
}

function SceneObjectDebugProbe() {
  const { invalidate, scene } = useThree()

  useEffect(() => {
    sceneRoleVisibilityController = (role, visible) => {
      let changed = 0

      scene.traverse((object) => {
        if (object.userData.houseDesignerRole === role) {
          object.visible = visible
          changed += 1
        }
      })
      invalidate()
      return changed
    }
    sceneObjectDebugProvider = () => {
      const meshes: SceneObjectDebugEntry[] = []

      scene.traverse((object) => {
        const meshLike = object as Object3D & {
          geometry?: BufferGeometry
          material?: Material | Material[]
        }

        if (!meshLike.geometry || !meshLike.material) {
          return
        }

        const materialCount = Array.isArray(meshLike.material)
          ? meshLike.material.length
          : 1
        const positionAttribute = meshLike.geometry.getAttribute('position')

        meshes.push({
          geometryGroups: meshLike.geometry.groups.length,
          materialCount,
          name: object.name,
          positionCount:
            positionAttribute instanceof Float32BufferAttribute
              ? positionAttribute.count
              : undefined,
          renderOrder: object.renderOrder,
          role:
            typeof object.userData.houseDesignerRole === 'string'
              ? object.userData.houseDesignerRole
              : undefined,
          type: object.type,
          visible: object.visible,
        })
      })

      return {
        meshCount: meshes.length,
        visibleMeshCount: meshes.filter((mesh) => mesh.visible).length,
        wallLikeMeshes: meshes.filter(
          (mesh) =>
            mesh.role?.includes('wall') ||
            mesh.name.toLowerCase().includes('wall'),
        ),
      }
    }

    return () => {
      if (sceneObjectDebugProvider) {
        sceneObjectDebugProvider = null
      }
      if (sceneRoleVisibilityController) {
        sceneRoleVisibilityController = null
      }
    }
  }, [invalidate, scene])

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
  const { camera, gl, invalidate, scene } = useThree()

  useEffect(() => {
    if (!SHADER_WARMUP_ENABLED) {
      onPendingChange(false)
      return undefined
    }

    if (blocked) {
      onPendingChange(false)
      return undefined
    }

    let cancelled = false
    let warmupTimeoutId: number | null = null
    let restoreWarmupState: (() => void) | null = null
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
      let completed = false
      const restoreFrustumStates = () => {
        frustumStates.forEach(({ frustumCulled, object }) => {
          object.frustumCulled = frustumCulled
        })
      }
      restoreWarmupState = restoreFrustumStates
      warmupTimeoutId = window.setTimeout(() => {
        if (cancelled || completed) {
          return
        }

        completed = true
        restoreFrustumStates()
        onPendingChange(false)
        recordEngineLog(
          'shader-warmup-timeout',
          `${SHADER_WARMUP_TIMEOUT_MS}ms`,
        )
        emitEngineActivity({
          message: 'Scene shaders ready',
          minimumVisibleMs: 700,
        })
      }, SHADER_WARMUP_TIMEOUT_MS)

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
          if (warmupTimeoutId !== null) {
            window.clearTimeout(warmupTimeoutId)
            warmupTimeoutId = null
          }

          if (completed) {
            return
          }

          completed = true
          restoreFrustumStates()
          restoreWarmupState = null

          if (!cancelled) {
            recordEngineLog('shader-warmup-complete')
            window.requestAnimationFrame(() => {
              if (!cancelled) {
                invalidate()
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

      if (warmupTimeoutId !== null) {
        window.clearTimeout(warmupTimeoutId)
      }

      restoreWarmupState?.()
      onPendingChange(false)
    }
  }, [blocked, camera, gl, invalidate, onPendingChange, scene, warmupKey])

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

function WebXRViewerButton({
  containerRef,
  onPresentingChange,
}: {
  containerRef: MutableRefObject<HTMLDivElement | null>
  onPresentingChange: (isPresenting: boolean) => void
}) {
  const { gl } = useThree()

  useEffect(() => {
    gl.xr.enabled = true
    gl.xr.setFramebufferScaleFactor(XR_FRAMEBUFFER_SCALE_FACTOR)

    const button = VRButton.createButton(gl, {
      optionalFeatures: ['bounded-floor', 'hand-tracking', 'local-floor'],
    })
    button.classList.add('webxr-enter-button')
    button.style.bottom = '18px'
    button.style.left = '50%'
    button.style.position = 'absolute'
    button.style.right = 'auto'
    button.style.transform = 'translateX(-50%)'
    button.style.zIndex = '20'

    const container = containerRef.current

    if (container) {
      container.appendChild(button)
    }

    const handleSessionStart = () => {
      gl.xr.setFoveation(XR_FOVEATION)
      onPresentingChange(true)
      emitEngineActivity({
        message: 'VR session active',
        minimumVisibleMs: 900,
      })
    }
    const handleSessionEnd = () => {
      onPresentingChange(false)
      emitEngineActivity({
        message: 'VR session ended',
        minimumVisibleMs: 900,
      })
    }

    gl.xr.addEventListener('sessionstart', handleSessionStart)
    gl.xr.addEventListener('sessionend', handleSessionEnd)

    return () => {
      gl.xr.removeEventListener('sessionstart', handleSessionStart)
      gl.xr.removeEventListener('sessionend', handleSessionEnd)
      onPresentingChange(false)
      button.remove()
    }
  }, [containerRef, gl, onPresentingChange])

  return null
}

function getVrStartPosition(floor: FloorLevel | null) {
  if (!floor || floor.walls.length === 0) {
    return {
      floorId: floor?.id ?? null,
      x: 0,
      y: floor?.elevation ?? 0,
      z: 0,
    }
  }

  const externalWalls = floor.walls.filter(
    (wall) => wall.kind === 'external',
  )
  const boundsWalls = externalWalls.length > 0 ? externalWalls : floor.walls
  const points = boundsWalls.flatMap((wall) => [wall.start, wall.end])
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minZ = Math.min(...points.map((point) => point.y))
  const maxZ = Math.max(...points.map((point) => point.y))

  return {
    floorId: floor.id,
    x: (minX + maxX) / 2,
    y: floor.elevation,
    z: (minZ + maxZ) / 2,
  }
}

function XRLocomotionControls({
  activeFloorElevation,
  initialPosition,
}: {
  activeFloorElevation: number
  initialPosition: { x: number; y: number; z: number }
}) {
  const { gl } = useThree()
  const appliedFloorElevationRef = useRef(0)
  const initialPositionAppliedRef = useRef(false)
  const queuedStepsRef = useRef(0)
  const forwardRef = useRef(new Vector3())
  const turnUpRef = useRef(new Vector3(0, 1, 0))
  const turnPivotRef = useRef(new Vector3())
  const rotatedTurnPivotRef = useRef(new Vector3())
  const previousExitButtonPressedRef = useRef(false)
  const rightStickLatchedRef = useRef(false)

  const applyActiveFloorElevation = useCallback(() => {
    const elevationDelta = activeFloorElevation - appliedFloorElevationRef.current

    if (Math.abs(elevationDelta) <= 0.000001) {
      return
    }

    const referenceSpace = gl.xr.getReferenceSpace()

    if (!referenceSpace || typeof XRRigidTransform === 'undefined') {
      return
    }

    const offsetTransform = new XRRigidTransform({
      x: 0,
      y: -elevationDelta,
      z: 0,
    })

    gl.xr.setReferenceSpace(
      referenceSpace.getOffsetReferenceSpace(offsetTransform),
    )
    appliedFloorElevationRef.current = activeFloorElevation
  }, [activeFloorElevation, gl])

  const moveViewer = useCallback(
    (distance: number) => {
      if (!gl.xr.isPresenting || Math.abs(distance) <= 0) {
        return
      }

      const referenceSpace = gl.xr.getReferenceSpace()

      if (!referenceSpace || typeof XRRigidTransform === 'undefined') {
        return
      }

      const xrCamera = gl.xr.getCamera()
      const forward = forwardRef.current

      xrCamera.getWorldDirection(forward)
      forward.y = 0

      if (forward.lengthSq() <= 0.000001) {
        return
      }

      forward.normalize().multiplyScalar(distance)

      const offsetTransform = new XRRigidTransform({
        x: -forward.x,
        y: 0,
        z: -forward.z,
      })

      gl.xr.setReferenceSpace(
        referenceSpace.getOffsetReferenceSpace(offsetTransform),
      )
    },
    [gl],
  )

  const turnViewer = useCallback(
    (angle: number) => {
      if (!gl.xr.isPresenting || Math.abs(angle) <= 0) {
        return
      }

      const referenceSpace = gl.xr.getReferenceSpace()

      if (!referenceSpace || typeof XRRigidTransform === 'undefined') {
        return
      }

      const halfAngle = angle / 2
      const pivot = gl.xr.getCamera().getWorldPosition(turnPivotRef.current)
      pivot.y = 0
      const rotatedPivot = rotatedTurnPivotRef.current
        .copy(pivot)
        .applyAxisAngle(turnUpRef.current, angle)
      gl.xr.setReferenceSpace(
        referenceSpace.getOffsetReferenceSpace(
          new XRRigidTransform(
            {
              x: pivot.x - rotatedPivot.x,
              y: 0,
              z: pivot.z - rotatedPivot.z,
            },
            {
              x: 0,
              y: Math.sin(halfAngle),
              z: 0,
              w: Math.cos(halfAngle),
            },
          ),
        ),
      )
    },
    [gl],
  )

  useEffect(() => {
    const controllers = [gl.xr.getController(0), gl.xr.getController(1)]
    const queueForwardStep = () => {
      queuedStepsRef.current += 1
    }

    controllers.forEach((controller) => {
      controller.addEventListener('selectstart', queueForwardStep)
    })

    return () => {
      controllers.forEach((controller) => {
        controller.removeEventListener('selectstart', queueForwardStep)
      })
    }
  }, [gl])

  useFrame(() => {
    if (!gl.xr.isPresenting) {
      appliedFloorElevationRef.current = 0
      initialPositionAppliedRef.current = false
      queuedStepsRef.current = 0
      previousExitButtonPressedRef.current = false
      rightStickLatchedRef.current = false
      return
    }

    if (!initialPositionAppliedRef.current) {
      const referenceSpace = gl.xr.getReferenceSpace()

      if (!referenceSpace || typeof XRRigidTransform === 'undefined') {
        return
      }

      gl.xr.setReferenceSpace(
        referenceSpace.getOffsetReferenceSpace(
          new XRRigidTransform({
            x: -initialPosition.x,
            y: -initialPosition.y,
            z: -initialPosition.z,
          }),
        ),
      )
      appliedFloorElevationRef.current = initialPosition.y
      initialPositionAppliedRef.current = true
    }

    applyActiveFloorElevation()

    if (queuedStepsRef.current > 0) {
      const steps = queuedStepsRef.current
      queuedStepsRef.current = 0
      moveViewer(XR_STEP_DISTANCE_METERS * steps)
    }

    const session = gl.xr.getSession()

    if (!session) {
      return
    }

    let rightStickX = 0
    let rightStickY = 0
    let exitButtonPressed = false

    for (const inputSource of session.inputSources) {
      const gamepad = inputSource.gamepad
      const axes = gamepad?.axes

      if (!axes || axes.length === 0) {
        if (gamepad?.buttons[XR_EXIT_BUTTON_INDEX]?.pressed) {
          exitButtonPressed = true
        }
        continue
      }

      if (gamepad?.buttons[XR_EXIT_BUTTON_INDEX]?.pressed) {
        exitButtonPressed = true
      }

      if (inputSource.handedness === 'right') {
        const xCandidates = [axes[2], axes[0]].filter(
          (axis): axis is number => typeof axis === 'number',
        )
        const yCandidates = [axes[3], axes[1]].filter(
          (axis): axis is number => typeof axis === 'number',
        )
        rightStickX = xCandidates.reduce(
          (strongest, axis) =>
            Math.abs(axis) > Math.abs(strongest) ? axis : strongest,
          0,
        )
        rightStickY = yCandidates.reduce(
          (strongest, axis) =>
            Math.abs(axis) > Math.abs(strongest) ? axis : strongest,
          0,
        )
      }
    }

    if (
      exitButtonPressed &&
      !previousExitButtonPressedRef.current
    ) {
      gl.xr.getSession()?.end().catch(() => {
        emitEngineActivity({
          message: 'Could not exit VR session',
          minimumVisibleMs: 1200,
        })
      })
    }

    previousExitButtonPressedRef.current = exitButtonPressed

    const stickMagnitude = Math.max(
      Math.abs(rightStickX),
      Math.abs(rightStickY),
    )

    if (stickMagnitude <= XR_STICK_DEADZONE) {
      rightStickLatchedRef.current = false
      return
    }

    if (rightStickLatchedRef.current) {
      return
    }

    rightStickLatchedRef.current = true

    if (Math.abs(rightStickX) > Math.abs(rightStickY)) {
      turnViewer(
        rightStickX > 0 ? XR_SNAP_TURN_RADIANS : -XR_SNAP_TURN_RADIANS,
      )
      return
    }

    moveViewer(
      rightStickY < 0 ? XR_STEP_DISTANCE_METERS : -XR_STEP_DISTANCE_METERS,
    )
  })

  return null
}

function getNextFloorAbove(activeFloor: FloorLevel | null, floors: FloorLevel[]) {
  if (!activeFloor) {
    return null
  }

  return [...floors]
    .filter((floor) => floor.elevation > activeFloor.elevation)
    .sort(
      (firstFloor, secondFloor) => firstFloor.elevation - secondFloor.elevation,
    )[0] ?? null
}

function getNextFloorBelow(activeFloor: FloorLevel | null, floors: FloorLevel[]) {
  if (!activeFloor) {
    return null
  }

  return [...floors]
    .filter((floor) => floor.elevation < activeFloor.elevation)
    .sort(
      (firstFloor, secondFloor) => secondFloor.elevation - firstFloor.elevation,
    )[0] ?? null
}

function getStairsButtonPosition(
  model: PlacedModel,
  definition: NonNullable<ReturnType<typeof modelsById.get>>,
  elevation: number,
  landing: 'lower' | 'upper',
): [number, number, number] {
  const polygon = getStairOpeningPolygon(
    model.position,
    model.rotation,
    definition.width,
    definition.depth,
    model.scale || 1,
    getModelHorizontalBounds(definition),
    model.widthScale || 1,
    model.depthScale || 1,
  )
  const landingPoints = landing === 'lower' ? [polygon[0], polygon[1]] : [polygon[2], polygon[3]]
  const landingCenter = {
    x: (landingPoints[0].x + landingPoints[1].x) / 2,
    y: (landingPoints[0].y + landingPoints[1].y) / 2,
  }
  const polygonCenter = polygon.reduce(
    (center, point) => ({
      x: center.x + point.x / polygon.length,
      y: center.y + point.y / polygon.length,
    }),
    { x: 0, y: 0 },
  )
  const inward = new Vector2(
    polygonCenter.x - landingCenter.x,
    polygonCenter.y - landingCenter.y,
  ).normalize()

  return [
    landingCenter.x + inward.x * XR_STAIRS_BUTTON_INSET_METERS,
    elevation + XR_STAIRS_BUTTON_HEIGHT_METERS,
    landingCenter.y + inward.y * XR_STAIRS_BUTTON_INSET_METERS,
  ]
}

function getStairsDefinition(model: PlacedModel) {
  const definition = modelsById.get(model.modelId)
  return definition?.objectType === 'stairs' ? definition : null
}

function XRStairsPushButton({
  contactSources,
  handSources,
  onPush,
  position,
}: {
  contactSources: Object3D[]
  handSources: Object3D[]
  onPush: () => void
  position: [number, number, number]
}) {
  const { gl } = useThree()
  const groupRef = useRef<Object3D>(null)
  const plungerRef = useRef<Object3D>(null)
  const isPressedRef = useRef(false)
  const cameraPositionRef = useRef(new Vector3())
  const contactPositionRef = useRef(new Vector3())
  const localContactRef = useRef(new Vector3())
  const inverseButtonMatrixRef = useRef(new Matrix4())

  useFrame(() => {
    const group = groupRef.current
    const plunger = plungerRef.current

    if (!group || !plunger || !gl.xr.isPresenting) {
      return
    }

    const cameraPosition = cameraPositionRef.current
    gl.xr.getCamera().getWorldPosition(cameraPosition)
    group.lookAt(cameraPosition.x, group.position.y, cameraPosition.z)
    group.updateWorldMatrix(true, false)
    inverseButtonMatrixRef.current.copy(group.matrixWorld).invert()

    const contacts = contactSources.flatMap((source) => {
      if (!source.visible) {
        return []
      }

      const position = new Vector3(0, 0, -0.1).applyMatrix4(source.matrixWorld)
      return [position]
    })

    handSources.forEach((hand) => {
      const fingerTip = hand.getObjectByName('index-finger-tip')

      if (fingerTip?.visible) {
        contacts.push(fingerTip.getWorldPosition(new Vector3()))
      }
    })

    let closestDepth = Number.POSITIVE_INFINITY

    contacts.forEach((contact) => {
      const localContact = localContactRef.current
        .copy(contactPositionRef.current.copy(contact))
        .applyMatrix4(inverseButtonMatrixRef.current)
      const radialDistance = Math.hypot(localContact.x, localContact.y)

      if (radialDistance <= XR_PUSH_BUTTON_CONTACT_RADIUS_METERS) {
        closestDepth = Math.min(closestDepth, Math.abs(localContact.z - 0.025))
      }
    })

    const isTouching = closestDepth <= XR_PUSH_BUTTON_PRESS_DEPTH_METERS
    plunger.position.z = isTouching ? 0.015 : 0.025

    if (isTouching && !isPressedRef.current) {
      isPressedRef.current = true
      onPush()
    } else if (
      !isTouching &&
      closestDepth > XR_PUSH_BUTTON_RELEASE_DEPTH_METERS
    ) {
      isPressedRef.current = false
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      renderOrder={30}
      userData={{ houseDesignerRole: 'xr-stairs-floor-button' }}
    >
      <mesh>
        <boxGeometry args={[0.09, 0.08, 0.018]} />
        <meshStandardMaterial color="#263445" metalness={0.45} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0, 0.011]}>
        <torusGeometry args={[0.032, 0.004, 10, 28]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.24} />
      </mesh>
      <mesh ref={plungerRef} position={[0, 0, 0.025]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[XR_PUSH_BUTTON_RADIUS_METERS, XR_PUSH_BUTTON_RADIUS_METERS, 0.018, 28]} />
        <meshStandardMaterial
          color="#ef4444"
          emissive="#7f1d1d"
          emissiveIntensity={0.28}
          metalness={0.2}
          roughness={0.32}
        />
      </mesh>
    </group>
  )
}

function XRControllerVisualsAndButtons({
  activeFloor,
  floors,
  onSelectFloor,
}: {
  activeFloor: FloorLevel | null
  floors: FloorLevel[]
  onSelectFloor: (floorId: string) => void
}) {
  const { gl } = useThree()
  const controllerModelFactory = useMemo(() => new XRControllerModelFactory(), [])
  const handModelFactory = useMemo(() => new XRHandModelFactory(), [])
  const controllers = useMemo(
    () => [gl.xr.getController(0), gl.xr.getController(1)],
    [gl],
  )
  const controllerGrips = useMemo(
    () => [gl.xr.getControllerGrip(0), gl.xr.getControllerGrip(1)],
    [gl],
  )
  const hands = useMemo(
    () => [gl.xr.getHand(0), gl.xr.getHand(1)],
    [gl],
  )
  const nextFloor = getNextFloorAbove(activeFloor, floors)
  const previousFloor = getNextFloorBelow(activeFloor, floors)
  const stairsButtons = useMemo(() => {
    if (!activeFloor) {
      return []
    }

    const upwardButtons = nextFloor
      ? (activeFloor.models ?? [])
          .flatMap((model) => {
            const definition = getStairsDefinition(model)
            return definition ? [{ model, definition }] : []
          })
          .map(({ model, definition }) => ({
            id: `up:${model.id}`,
            position: getStairsButtonPosition(
              model,
              definition,
              activeFloor.elevation,
              'lower',
            ),
            targetFloor: nextFloor,
          }))
      : []
    const downwardButtons = previousFloor
      ? (previousFloor.models ?? [])
          .flatMap((model) => {
            const definition = getStairsDefinition(model)
            return definition ? [{ model, definition }] : []
          })
          .map(({ model, definition }) => ({
            id: `down:${model.id}`,
            position: getStairsButtonPosition(
              model,
              definition,
              activeFloor.elevation,
              'upper',
            ),
            targetFloor: previousFloor,
          }))
      : []

    return [...upwardButtons, ...downwardButtons]
  }, [activeFloor, nextFloor, previousFloor])

  useEffect(() => {
    recordEngineLog(
      'xr-stairs-buttons',
      `activeFloor=${activeFloor?.id ?? 'none'} previousFloor=${previousFloor?.id ?? 'none'} nextFloor=${nextFloor?.id ?? 'none'} count=${stairsButtons.length}`,
    )
  }, [activeFloor?.id, nextFloor?.id, previousFloor?.id, stairsButtons.length])

  useEffect(() => {
    const controllerModels = controllerGrips.map((grip) =>
      controllerModelFactory.createControllerModel(grip),
    )
    const handModels = hands.map((hand) =>
      handModelFactory.createHandModel(hand, 'mesh'),
    )

    controllerGrips.forEach((grip, index) => {
      grip.add(controllerModels[index])
    })
    hands.forEach((hand, index) => {
      hand.add(handModels[index])
    })

    return () => {
      controllerGrips.forEach((grip, index) => {
        grip.remove(controllerModels[index])
      })
      hands.forEach((hand, index) => {
        hand.remove(handModels[index])
      })
    }
  }, [
    controllerGrips,
    controllerModelFactory,
    handModelFactory,
    hands,
  ])

  return (
    <>
      {controllers.map((controller, index) => (
        <primitive key={`controller-${index}`} object={controller} />
      ))}
      {controllerGrips.map((grip, index) => (
        <primitive key={`controller-grip-${index}`} object={grip} />
      ))}
      {hands.map((hand, index) => (
        <primitive key={`hand-${index}`} object={hand} />
      ))}
      {stairsButtons.map((button) => (
        <XRStairsPushButton
          contactSources={controllers}
          handSources={hands}
          key={button.id}
          onPush={() => {
            onSelectFloor(button.targetFloor.id)
            emitEngineActivity({
              message: `Moved to ${button.targetFloor.name}`,
              minimumVisibleMs: 1200,
            })
          }}
          position={button.position}
        />
      ))}
    </>
  )
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
    const isShiftKey = (event: KeyboardEvent) =>
      event.key === 'Shift' ||
      event.code === 'ShiftLeft' ||
      event.code === 'ShiftRight'
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

      if (isShiftKey(event)) {
        event.preventDefault()
        isShiftPressedRef.current = true
        return
      }

      if (['KeyA', 'KeyD', 'KeyS', 'KeyW'].includes(event.code)) {
        event.preventDefault()
        keysRef.current.add(event.code)
        isShiftPressedRef.current = event.shiftKey
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

      isShiftPressedRef.current = isShiftKey(event) ? false : event.shiftKey
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

  if (
    target.surface.type === 'floor-slab-edge' ||
    target.surface.type === 'portal-floor'
  ) {
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
    return `${surface.floorId}:wall-fragment:${surface.wallId}:${surface.side}:${surface.fragmentId}`
  }

  if (surface.type === 'room-floor' || surface.type === 'ceiling') {
    return `${surface.floorId}:${surface.type}:${surface.roomSignature}`
  }

  if (surface.type === 'portal-floor') {
    return `${surface.floorId}:portal-floor:${surface.wallId}:${surface.openingId}`
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

  const planPoint = {
    x: intersection.point.x,
    y: intersection.point.z,
  }
  const room = getRenderableRoomContainingPoint(
    target.rooms,
    {
      x: planPoint.x,
      y: planPoint.y,
    },
    target.roomSurfacePolygonsBySignature,
  )

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
      const room = getRenderableRoomContainingPoint(
        target.rooms,
        {
          x: candidate.intersection.point.x,
          y: candidate.intersection.point.z,
        },
        target.roomSurfacePolygonsBySignature,
      )

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

function EngineConsoleOverlay({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const [lines, setLines] = useState<EngineConsoleLine[]>([])
  const linesRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)

  const clearLines = useCallback(() => {
    setLines([])
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const seedLines = engineLogEntries
      .slice(-ENGINE_CONSOLE_LINE_LIMIT)
      .map((entry) => ({
        entry,
        text: formatEngineConsoleLine(entry),
      }))

    setLines(seedLines)

    return subscribeEngineLog((entry) => {
      setLines((currentLines) => [
        ...currentLines,
        {
          entry,
          text: formatEngineConsoleLine(entry),
        },
      ].slice(-ENGINE_CONSOLE_LINE_LIMIT))
    })
  }, [isOpen])

  useEffect(() => {
    const element = linesRef.current

    if (!element || !shouldStickToBottomRef.current) {
      return
    }

    element.scrollTop = element.scrollHeight
  }, [lines])

  if (!isOpen) {
    return null
  }

  return (
    <div className="engine-console-overlay" aria-label="3D console log">
      <div className="engine-console-toolbar">
        <span>Console</span>
        <button type="button" onClick={clearLines}>
          Clear
        </button>
        <button type="button" onClick={onClose} aria-label="Close 3D console">
          Close
        </button>
      </div>
      <div
        ref={linesRef}
        className="engine-console-lines"
        onScroll={(event) => {
          const element = event.currentTarget
          shouldStickToBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 8
        }}
      >
        {lines.map((line) => (
          <div key={line.entry.index} className="engine-console-line">
            {line.text}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ThreeDView({
  activeFloorId,
  floors,
  isEngineConsoleOpen,
  lightDirection,
  modelAssetVersion,
  onClearSelection,
  onEngineConsoleOpenChange,
  onLightDirectionChange,
  onSelectFloor,
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
  const threeHostRef = useRef<HTMLDivElement | null>(null)
  const [isTransformingModel, setIsTransformingModel] = useState(false)
  const [isXrPresenting, setIsXrPresenting] = useState(false)
  const showAllFloorsInScene = showAllFloors || isXrPresenting
  const engineStatusRef = useRef<HTMLDivElement>(null)
  const engineStatusTimerRef = useRef<number | null>(null)
  const latestEngineActivityIdRef = useRef(0)
  const lastEngineActivityRef = useRef({
    message: 'startup',
    time: 0,
  })
  const lastVisibleStallStatusTimeRef = useRef(0)
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
  const [initialScenePreparationComplete, setInitialScenePreparationComplete] =
    useState(false)
  const [, setRoomVisibilityState] =
    useState<FloorVisibilityState | null>(null)
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({
    ambientOcclusion: false,
    ambientOcclusionIntensity: 0.85,
    ambientOcclusionQuality: 'fast',
    ambientTerm: 0.32,
    bakedLightmaps: true,
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
    wallPerimeter: false,
    wireframe: false,
  })

  useEffect(() => {
    const placedPortalModelIds = getPlacedPortalModelIds(floors)

    if (placedPortalModelIds.length === 0) {
      return
    }

    const missingPortalModelIds = placedPortalModelIds.filter(
      (modelId) => !modelsById.has(modelId),
    )

    recordEngineLog(
      'portal-models',
      `${placedPortalModelIds.length} placed, ${getRegisteredPortalModelCount()} registered`,
    )

    if (missingPortalModelIds.length > 0) {
      recordEngineLog(
        'portal-model-definitions-missing',
        missingPortalModelIds.join(', '),
      )
    } else {
      placedPortalModelIds.forEach((modelId) => {
        const definition = modelsById.get(modelId)

        if (definition?.sourceUrl) {
          recordEngineLog(
            'portal-model-url',
            `${modelId} ${getModelAssetUrl(definition.sourceUrl, modelAssetVersion)}`,
          )
        }
      })
    }
  }, [floors, modelAssetVersion])
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
  const vrStartPosition = useMemo(
    () => getVrStartPosition(activeFloor),
    [activeFloor],
  )
  const handleXrPresentingChange = useCallback(
    (isPresenting: boolean) => {
      setIsXrPresenting(isPresenting)
    },
    [],
  )
  const floorBelowActive = activeFloor
    ? floorsByElevation
        .filter((floor) => floor.elevation < activeFloor.elevation)
        .at(-1) ?? null
    : null
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
  const canPrepareLevelsInWorkers =
    typeof Worker !== 'undefined' && floors.length > 0
  const [renderedFloors, setRenderedFloors] = useState<RenderedFloorData[]>(
    () => (canPrepareLevelsInWorkers ? [] : prepareRenderedFloorsSync(floors)),
  )
  const [isLevelPreparationPending, setIsLevelPreparationPending] =
    useState(canPrepareLevelsInWorkers)

  useEffect(() => {
    const startedAt = performance.now()
    const controller = new AbortController()
    const preparationTarget =
      typeof Worker === 'undefined' || floors.length === 0
        ? 'main thread'
        : 'workers'

    setIsLevelPreparationPending(true)
    recordEngineLog(
      'level-preparation-start',
      `${floors.length} floors on ${preparationTarget}`,
    )
    emitEngineActivity({
      message: `Preparing ${pluralize(
        floors.length,
        'floor',
      )} on ${preparationTarget}...`,
      minimumVisibleMs: 700,
    })

    prepareRenderedFloorsInWorkers(floors, {
      signal: controller.signal,
    })
      .then((preparedFloors) => {
        setRenderedFloors(preparedFloors)
        setIsLevelPreparationPending(false)
        recordEngineLog(
          'level-preparation-complete',
          `${preparedFloors.length} floors in ${Math.round(
            performance.now() - startedAt,
          )}ms`,
        )
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return
        }

        console.warn('Worker level preparation failed; using main thread.', error)
        setRenderedFloors(prepareRenderedFloorsSync(floors))
        setIsLevelPreparationPending(false)
        recordEngineLog(
          'level-preparation-worker-fallback',
          error instanceof Error ? error.message : String(error),
        )
      })

    return () => {
      controller.abort()
    }
  }, [floorGeometryStatusKey, floors])
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
      showAllFloorsInScene
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
      showAllFloorsInScene,
    ],
  )
  const allFloorsPlane = useMemo(
    () =>
      showAllFloorsInScene && renderOptions.groundPlane
        ? getFloorsPlaneBounds(visibleRenderedFloors.map((renderedFloor) => renderedFloor.floor))
        : null,
    [renderOptions.groundPlane, showAllFloorsInScene, visibleRenderedFloors],
  )
  const shaderWarmupKey = useMemo(
    () =>
      JSON.stringify({
        floorCount: showAllFloorsInScene
          ? floors.length
          : floors.some((floor) => floor.id === activeFloorId)
            ? 1
            : 0,
        modelVariants: Array.from(
          new Set(
            (showAllFloorsInScene
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
          ambientOcclusionQuality: renderOptions.ambientOcclusionQuality,
          bakedLightmaps: renderOptions.bakedLightmaps,
          floorSlabs: renderOptions.floorSlabs,
          lightMarkers: renderOptions.lightMarkers,
          lightShadows: renderOptions.lightShadows,
          lights: renderOptions.lights,
          referenceFloors: renderOptions.referenceFloors,
          shadows: renderOptions.shadows,
          skybox: renderOptions.skybox,
          wallPerimeter: renderOptions.wallPerimeter,
          wireframe: renderOptions.wireframe,
        },
        showAllFloors: showAllFloorsInScene,
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
            (showAllFloorsInScene
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
      renderOptions.ambientOcclusionQuality,
      renderOptions.bakedLightmaps,
      renderOptions.floorSlabs,
      renderOptions.lightMarkers,
      renderOptions.lightShadows,
      renderOptions.lights,
      renderOptions.referenceFloors,
      renderOptions.shadows,
      renderOptions.skybox,
      renderOptions.wallPerimeter,
      renderOptions.wireframe,
      showAllFloorsInScene,
      surfaceAssignments,
    ],
  )
  const lightIndicator = useMemo(() => {
    const scopedFloors = showAllFloorsInScene
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
  }, [activeFloorId, floors, localLightIds, showAllFloorsInScene])
  useEffect(() => {
    const latestStats = latestRendererStatsRef.current

    stallSnapshotRef.current = [
      `lights ${lightIndicator.contributing}/${lightIndicator.total}`,
      `limit ${localLightLimit}`,
      `floors ${visibleRenderedFloors.length}`,
      renderOptions.shadows ? 'scene shadows on' : 'scene shadows off',
      renderOptions.lightShadows ? 'light shadows on' : 'light shadows off',
      renderOptions.ambientOcclusion
        ? `AO ${renderOptions.ambientOcclusionQuality} ${renderOptions.ambientOcclusionIntensity.toFixed(2)}`
        : 'AO off',
      objectFrustumCullingEnabled
        ? 'object frustum culling on'
        : 'object frustum culling off',
      `ambient ${renderOptions.ambientTerm.toFixed(2)}`,
      renderOptions.bakedLightmaps ? 'baked lightmaps on' : 'baked lightmaps off',
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
    renderOptions.ambientOcclusionQuality,
    renderOptions.ambientTerm,
    renderOptions.bakedLightmaps,
    renderOptions.lightShadows,
    renderOptions.lights,
    objectFrustumCullingEnabled,
    renderOptions.shadows,
    visibleRenderedFloors.length,
  ])
  const scenePreparationPending =
    isLevelPreparationPending ||
    isShaderWarmupPending ||
    isTexturePreloadPending ||
    isAssetLoadPending
  const scenePreparationPendingReasons = useMemo(
    () =>
      [
        isShaderWarmupPending ? 'shader-warmup' : null,
        isTexturePreloadPending ? 'texture-preload' : null,
        isAssetLoadPending ? 'asset-load' : null,
        isLevelPreparationPending ? 'level-preparation' : null,
      ].filter((reason): reason is string => Boolean(reason)),
    [
      isAssetLoadPending,
      isLevelPreparationPending,
      isShaderWarmupPending,
      isTexturePreloadPending,
    ],
  )
  const initialScenePreparationPending =
    scenePreparationPending && !initialScenePreparationComplete
  const shaderWarmupBlocked = isTexturePreloadPending || isAssetLoadPending
  const transformEnabled = true
  const navigationLocked =
    isTransformingModel || isXrPresenting || initialScenePreparationPending
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

      if (
        message !== 'Engine idle' &&
        !message.startsWith('Main thread stalled')
      ) {
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

  useEffect(() => {
    if (!scenePreparationPending) {
      setInitialScenePreparationComplete(true)
      return undefined
    }

    if (!initialScenePreparationPending) {
      return undefined
    }

    const pendingReasons = scenePreparationPendingReasons.join(', ') || 'unknown'
    const timeoutId = window.setTimeout(() => {
      recordEngineLog(
        'scene-preparation-timeout',
        pendingReasons,
        stallSnapshotRef.current,
      )
      setIsShaderWarmupPending(false)
      setIsTexturePreloadPending(false)
      setIsAssetLoadPending(false)
      setIsLevelPreparationPending(false)
      setInitialScenePreparationComplete(true)
      showEngineStatus('Engine idle', 700)
    }, SCENE_PREPARATION_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    initialScenePreparationPending,
    scenePreparationPending,
    scenePreparationPendingReasons,
    showEngineStatus,
  ])

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

      if (option === 'bakedLightmaps') {
        return nextEnabled
          ? 'Baking floor lightmaps...'
          : 'Disabling baked floor lightmaps...'
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
  const updateAmbientOcclusionQuality = (
    ambientOcclusionQuality: AmbientOcclusionQuality,
  ) => {
    recordEngineLog(
      'render-option-applied',
      `ambientOcclusionQuality -> ${ambientOcclusionQuality}`,
      stallSnapshotRef.current,
    )
    setRenderOptions((currentOptions) => ({
      ...currentOptions,
      ambientOcclusionQuality,
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
        if (
          frameTime - lastVisibleStallStatusTimeRef.current >=
          MAIN_THREAD_STALL_STATUS_COOLDOWN_MS
        ) {
          lastVisibleStallStatusTimeRef.current = frameTime
          showEngineStatus(
            `Main thread stalled for ${stallSeconds}s${activityContext}`,
            4200,
          )
        }
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

  const ambientOcclusionSettings =
    AMBIENT_OCCLUSION_SETTINGS[renderOptions.ambientOcclusionQuality]
  const screenSpaceAmbientOcclusionEnabled =
    renderOptions.ambientOcclusion && !isXrPresenting
  const fakeAmbientOcclusionEnabled =
    renderOptions.ambientOcclusion && isXrPresenting
  const fakeAmbientOcclusionIntensity = renderOptions.ambientOcclusionIntensity
  const activeLocalLightLimit = isXrPresenting
    ? Math.min(localLightLimit, XR_MAX_REALTIME_LOCAL_LIGHTS)
    : localLightLimit
  const sunShadowsEnabled = renderOptions.shadows && !isXrPresenting
  const localLightShadowsEnabled =
    renderOptions.shadows && renderOptions.lightShadows && !isXrPresenting

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
          {/* <button
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
          </button> */}
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
                  <span>AO quality</span>
                  <select
                    value={renderOptions.ambientOcclusionQuality}
                    onChange={(event) =>
                      updateAmbientOcclusionQuality(
                        event.currentTarget.value as AmbientOcclusionQuality,
                      )
                    }
                  >
                    <option value="fast">Fast</option>
                    <option value="balanced">Balanced</option>
                  </select>
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
                    checked={renderOptions.bakedLightmaps}
                    onChange={() => updateRenderOption('bakedLightmaps')}
                  />
                  Baked lightmaps
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
                    checked={renderOptions.wallPerimeter}
                    onChange={() => updateRenderOption('wallPerimeter')}
                  />
                  Wall perimeter
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
                  Ceiling slabs
                </label>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        ref={threeHostRef}
        className={
          initialScenePreparationPending ? 'three-host is-preparing' : 'three-host'
        }
      >
        <Canvas
          shadows={renderOptions.shadows}
          camera={{ position: [6, 5, 8], fov: cameraFov }}
          dpr={screenSpaceAmbientOcclusionEnabled ? 1 : [1, 1.5]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.info.autoReset = false
            gl.xr.enabled = true
          }}
          tabIndex={0}
        >
          <>
            <WebXRViewerButton
              containerRef={threeHostRef}
              onPresentingChange={handleXrPresentingChange}
            />
            <XRLocomotionControls
              activeFloorElevation={activeFloor?.elevation ?? 0}
              initialPosition={vrStartPosition}
            />
            <XRControllerVisualsAndButtons
              activeFloor={activeFloor}
              floors={floors}
              onSelectFloor={onSelectFloor}
            />
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
              blocked={shaderWarmupBlocked || isXrPresenting}
              onPendingChange={updateShaderWarmupPending}
              warmupKey={shaderWarmupKey}
            />
            <SceneRenderInvalidator
              renderKey={`${floorGeometryStatusKey}:${shaderWarmupKey}:${surfaceAssignments.length}:${scenePreparationPending ? 'preparing' : 'ready'}`}
            />
            {WALL_RENDER_DEBUG_ENABLED ? <SceneObjectDebugProbe /> : null}
            <CameraFovController fov={cameraFov} />
            <RendererLightCapabilities
              onLocalLightLimitChange={updateLocalLightLimit}
            />
            <LocalLightBudgetController
              activeFloorId={activeFloorId}
              enabled={renderOptions.lights}
              localLightLimit={activeLocalLightLimit}
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
              shadowMapSize={isXrPresenting ? XR_SUN_SHADOW_MAP_SIZE : 2048}
              shadows={sunShadowsEnabled}
            />
            <FixedLocalLightPool
              activeFloorId={activeFloorId}
              localLightIds={localLightIds}
              lightShadowsEnabled={localLightShadowsEnabled}
              maxLights={activeLocalLightLimit}
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
                externalWallFootprintGroups,
                externalWallUnionFootprints,
                externalWallUnionWallIds,
                floor,
                geometryContextWalls,
                internalWallFootprintGroups,
                renderedWalls,
                roomSurfacePolygonsBySignature,
                rooms,
                wallBodyOccluders,
              } = renderedFloor
              const isActive = floor.id === activeFloorId
              const usesExternalWallUnion =
                !WALL_BODY_PERIMETER_MESH_ENABLED &&
                isActive &&
                externalWallUnionFootprints.length > 0
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
              const lowerFloor =
                floorIndex > 0 ? floorsByElevation[floorIndex - 1] ?? null : null
              const floorOpenings = lowerFloor
                ? getStairSlabOpenings(lowerFloor, floor, floors, modelsById)
                : []
              const ceilingOpenings = getStairSlabOpenings(
                floor,
                upperFloor,
                floors,
                modelsById,
              )
              const hasShadowSurface = renderOptions.shadows && isActive
              const visibleRoomsForFloor = rooms
              const visibleModelsForFloor = floor.models ?? []
              const floorPlane =
                renderOptions.groundPlane && !showAllFloorsInScene && isActive
                  ? getFloorPlaneBounds(floor)
                  : null
              const shouldRenderSlab =
                !showAllFloorsInScene &&
                ((renderOptions.floorSlabs &&
                  floor.id === floorBelowActive?.id) ||
                  (renderOptions.shadows && isActive))

              if (showAllFloorsInScene) {
                return (
                  <group key={`${sceneRevision}:${floor.id}`}>
                      <FloorRenderBoundary
                        floorId={floor.id}
                        resetKey={getFloorRenderResetKey(
                          floor,
                          surfaceAssignments,
                        )}
                      >
                      {renderOptions.floorSlabs && upperFloor ? (
                        <CeilingSlab
                          castsShadow={renderOptions.shadows}
                          floor={floor}
                          isSolid
                          onRegisterPickTarget={registerPickTarget}
                          openings={ceilingOpenings}
                          selectedSurface={selectedSurface}
                          surfaceAssignments={surfaceAssignments}
                          upperFloor={upperFloor}
                          wireframe={renderOptions.wireframe}
                        />
                      ) : null}
                      <RoomFloorFinishes
                        elevation={floor.elevation}
                        floorId={floor.id}
                        openings={floorOpenings}
                        roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                        rooms={rooms}
                        surfaceAssignments={surfaceAssignments}
                        visibleRoomSignatures={null}
                        wireframe={renderOptions.wireframe}
                      />
                      <BakedFloorLightmap
                        daylightEnabled={renderOptions.daylight}
                        enabled={renderOptions.bakedLightmaps}
                        floor={floor}
                        lightDirection={lightDirection}
                        roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                        rooms={rooms}
                        walls={geometryContextWalls}
                        wireframe={renderOptions.wireframe}
                      />
                      <RoomPortalFloors
                        elevation={floor.elevation}
                        floorId={floor.id}
                        onRegisterPickTarget={registerPickTarget}
                        selectedSurface={selectedSurface}
                        shadowsEnabled={renderOptions.shadows}
                        surfaceAssignments={surfaceAssignments}
                        walls={geometryContextWalls}
                        wireframe={renderOptions.wireframe}
                      />
                      <RoomCeilingFinishes
                        elevation={floor.elevation}
                        floorId={floor.id}
                        openings={ceilingOpenings}
                        roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                        roomHeight={floor.roomHeight}
                        rooms={rooms}
                        surfaceAssignments={surfaceAssignments}
                        visibleRoomSignatures={null}
                        wireframe={renderOptions.wireframe}
                      />
                      <SelectableRoomSurfaces
                        ceilingOpenings={ceilingOpenings}
                        elevation={floor.elevation}
                        floorPlane={getFloorPlaneBounds(floor)}
                        floorId={floor.id}
                        floorOpenings={floorOpenings}
                        onRegisterPickTarget={registerPickTarget}
                        roomHeight={floor.roomHeight}
                        roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                        rooms={rooms}
                        selectedSurface={selectedSurface}
                        visibleRoomSignatures={null}
                      />
                      <SolidFloorScene
                        daylightEnabled={renderOptions.daylight}
                        externalWallFootprintGroups={externalWallFootprintGroups}
                        externalWallUnionWallIds={externalWallUnionWallIds}
                        fakeAmbientOcclusionEnabled={fakeAmbientOcclusionEnabled}
                        fakeAmbientOcclusionIntensity={fakeAmbientOcclusionIntensity}
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
                        roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                        rooms={rooms}
                        selectedWallId={selectedWallId}
                        selectedSurface={selectedSurface}
                        shadowsEnabled={renderOptions.shadows}
                        showWallPerimeter={renderOptions.wallPerimeter}
                        stairSnapWalls={
                          upperFloor
                            ? [...floor.walls, ...upperFloor.walls]
                            : floor.walls
                        }
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
                      <CeilingSlab
                        castsShadow={renderOptions.shadows}
                        floor={floor}
                        isSolid={slabIsSolid}
                        onRegisterPickTarget={registerPickTarget}
                        openings={ceilingOpenings}
                        selectedSurface={selectedSurface}
                        sunShadowBlocker={isActive && !slabIsSolid}
                        surfaceAssignments={surfaceAssignments}
                        upperFloor={upperFloor}
                        wireframe={renderOptions.wireframe}
                      />
                    ) : null}
                    {floorPlane ? (
                      <FloorPlaneSurface
                        elevation={floor.elevation}
                        floorPlane={floorPlane}
                        isActive={isActive}
                        openings={floorOpenings}
                        receiveShadow={hasShadowSurface}
                        wireframe={renderOptions.wireframe}
                      />
                    ) : null}
                    {isActive ? (
                      <>
                        <RoomFloorBaseMeshes
                          elevation={floor.elevation}
                          openings={floorOpenings}
                          roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                          rooms={rooms}
                          shadowsEnabled={renderOptions.shadows}
                          visibleRoomSignatures={activeVisibleRoomSignatures}
                          wireframe={renderOptions.wireframe}
                        />
                        <RoomFloorFinishes
                          elevation={floor.elevation}
                          floorId={floor.id}
                          openings={floorOpenings}
                          roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                          rooms={rooms}
                          surfaceAssignments={surfaceAssignments}
                          visibleRoomSignatures={activeVisibleRoomSignatures}
                          wireframe={renderOptions.wireframe}
                        />
                        <BakedFloorLightmap
                          daylightEnabled={renderOptions.daylight}
                          enabled={renderOptions.bakedLightmaps}
                          floor={floor}
                          lightDirection={lightDirection}
                          roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                          rooms={visibleRoomsForFloor}
                          walls={geometryContextWalls}
                          wireframe={renderOptions.wireframe}
                        />
                        <RoomPortalFloors
                          elevation={floor.elevation}
                          floorId={floor.id}
                          onRegisterPickTarget={registerPickTarget}
                          selectedSurface={selectedSurface}
                          shadowsEnabled={renderOptions.shadows}
                          surfaceAssignments={surfaceAssignments}
                          walls={geometryContextWalls}
                          wireframe={renderOptions.wireframe}
                        />
                        <RoomCeilingFinishes
                          elevation={floor.elevation}
                          floorId={floor.id}
                          openings={ceilingOpenings}
                          roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                          roomHeight={floor.roomHeight}
                          rooms={rooms}
                          surfaceAssignments={surfaceAssignments}
                          visibleRoomSignatures={activeVisibleRoomSignatures}
                          wireframe={renderOptions.wireframe}
                        />
                        <SelectableRoomSurfaces
                          ceilingOpenings={ceilingOpenings}
                          elevation={floor.elevation}
                          floorPlane={floorPlane}
                          floorId={floor.id}
                          floorOpenings={floorOpenings}
                          onRegisterPickTarget={registerPickTarget}
                          roomHeight={floor.roomHeight}
                          roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
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
                    {usesExternalWallUnion
                      ? externalWallFootprintGroups.map((group) => {
                          const sourceWalls = (group.wallIds ?? [group.wallId])
                            .map((wallId) => wallsByIdForFloor.get(wallId))
                            .filter((wall): wall is Wall => Boolean(wall))

                          if (
                            !sourceWalls.some((wall) =>
                              wallTouchesVisibleRoom(
                                wall,
                                rooms,
                                activeVisibleRoomSignatures,
                              ),
                            )
                          ) {
                            return null
                          }

                          return (
                        <WallFootprintMeshes
                          key={group.wallId}
                          castsShadow={hasShadowSurface}
                          elevation={floor.elevation}
                          floorId={floor.id}
                          footprints={group.footprints}
                          geometryContextRenderedWalls={renderedWalls}
                          geometryContextWalls={geometryContextWalls}
                          height={floor.roomHeight}
                          onRegisterPickTarget={registerPickTarget}
                          rooms={visibleRoomsForFloor}
                          selectedWallId={selectedWallId}
                          selectedSurface={selectedSurface}
                          sourceWalls={sourceWalls}
                          surfaceAssignments={surfaceAssignments}
                          wallKind="external"
                          wireframe={renderOptions.wireframe}
                        />
                          )
                        })
                      : null}
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
                              rooms={visibleRoomsForFloor}
                              selectedWallId={selectedWallId}
                              selectedSurface={selectedSurface}
                              sourceWalls={sourceWalls}
                              surfaceAssignments={surfaceAssignments}
                              wallKind="internal"
                              wireframe={renderOptions.wireframe}
                            />
                          ))
                      : null}
                    {wallEngineRenderedWalls.length > 0 || visibleRoomsForFloor.length > 0 ? (
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
                        showWallPerimeter={renderOptions.wallPerimeter}
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
                        geometryContextWalls={geometryContextWalls}
                        models={visibleModelsForFloor}
                        renderedWalls={renderedWalls}
                        roomSurfacePolygonsBySignature={roomSurfacePolygonsBySignature}
                        rooms={visibleRoomsForFloor}
                        wireframe={renderOptions.wireframe}
                      />
                    ) : null}
                    {isActive ? (
                      <FakeAmbientOcclusion
                        elevation={floor.elevation}
                        geometryContextWalls={geometryContextWalls}
                        intensity={fakeAmbientOcclusionIntensity}
                        roomSurfacePolygonsBySignature={
                          roomSurfacePolygonsBySignature
                        }
                        rooms={visibleRoomsForFloor}
                        visible={
                          fakeAmbientOcclusionEnabled && !renderOptions.wireframe
                        }
                      />
                    ) : null}
                    {isActive ? (
                      <Suspense fallback={null}>
                        {visibleModelsForFloor.map((model) => (
                          <ModelLoadBoundary
                            key={`${model.id}:${modelAssetVersion}`}
                            modelId={model.id}
                          >
                            <ModelMesh
                              daylightEnabled={renderOptions.daylight}
                              elevation={floor.elevation}
                              floorId={floor.id}
                              frustumCullingEnabled={objectFrustumCullingEnabled}
                              isActive={isActive}
                              isSelected={model.id === selectedModelId}
                              lightMarkersVisible={renderOptions.lightMarkers}
                              model={model}
                              models={visibleModelsForFloor}
                              modelAssetVersion={modelAssetVersion}
                              pickTargetsRef={pickTargetsRef}
                              onRegisterPickTarget={registerPickTarget}
                              onTransformActiveChange={setTransformingModel}
                              onUpdateModel={onUpdateModel}
                              rooms={visibleRoomsForFloor}
                              shadowsEnabled={renderOptions.shadows}
                              stairSnapWalls={
                                upperFloor
                                  ? [...floor.walls, ...upperFloor.walls]
                                  : floor.walls
                              }
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
            {screenSpaceAmbientOcclusionEnabled ? (
              <EffectComposer
                multisampling={0}
                resolutionScale={ambientOcclusionSettings.resolutionScale}
              >
                <N8AO
                  aoRadius={0.28}
                  distanceFalloff={1}
                  intensity={renderOptions.ambientOcclusionIntensity}
                  aoSamples={ambientOcclusionSettings.aoSamples}
                  denoiseSamples={ambientOcclusionSettings.denoiseSamples}
                  denoiseRadius={ambientOcclusionSettings.denoiseRadius}
                  halfRes={ambientOcclusionSettings.halfRes}
                  color={ambientOcclusionColor}
                />
              </EffectComposer>
            ) : null}
          </>
        </Canvas>
        <div
          ref={engineStatusRef}
          className="viewport-engine-status is-idle"
          aria-live="polite"
          aria-label="3D engine status"
        >
          Engine idle
        </div>
        <EngineConsoleOverlay
          isOpen={isEngineConsoleOpen}
          onClose={() => onEngineConsoleOpenChange(false)}
        />
        {initialScenePreparationPending ? (
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
          onLightDirectionChange={onLightDirectionChange}
        />
      </div>
    </section>
  )
}
