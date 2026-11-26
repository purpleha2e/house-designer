import { replaceRoofMaterialAssignment, roofSurfaceTargetsMatch } from './roofMaterialAssignments'
import { browserProjectSaveFile, writeProjectFile, type ProjectFileHandle } from './projectDeviceSave'
import { getSelectionContextFloor } from './surfaceSelection'
import { mergeProjectModelDefinitions, retainProjectModels } from './models/projectModelCatalog'
import { readRecentProject, rememberRecentProject, useRecentProjects, type LoadedProjectFile } from './recentProjects'
import { ProjectLoadConfirmation } from './components/ProjectLoadConfirmation'
import { indirectProjectKey, indirectContentKey, indirectAssetIdentity, savedIndirectLightingMatches, type SavedIndirectLighting } from './indirectLightingPersistence'
import { normalizeDiffuseProbeResolution, type DiffuseProbeResolution } from './indirectProbeResolution'
import { ambientLightingPreferences } from './ambientLighting'
import { normalizeSunStrength } from './sunStrength'
import type { ModelTransformPreview } from './modelTransformPreview'
import { createLocalLightControl } from './localLightControl'
import { installViewportInputPriority } from './viewportScheduling'
import { editorPreparationTime, traceEditorPreparation } from './editorPreparationTrace'
import {
  useCallback,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { ContextPanel } from './components/ContextPanel'
import {
  FloorplanCanvas,
  clearFloorplanModelAssetCaches,
  type RoofCreateOptions,
  type RoofPlacementPreview,
} from './components/FloorplanCanvas'
import { LeftToolRail, EditToolbar, type RailPanel } from './components/LeftToolRail'
import { DesignAssistant } from './components/DesignAssistant'
import { makeSceneSource } from './assistant/scene'
import { materializeProposalFloors, type DesignOption, type DesignProposal, type FloorEdits } from './assistant/proposal'
import { ManufacturerPortal } from './components/ManufacturerPortal'
import { MaterialEditor } from './components/MaterialEditor'
import { AccountDialog } from './components/AccountDialog'
import { workspaceClient } from './workspace/workspaceClient'
import { collectLocalMaterialDefinitions, loadLocalMaterials, saveLocalMaterial, validateLocalMaterial } from './materials/localMaterials'
import { ModelSelector } from './components/ModelSelector'
import { WindowBuilder } from './components/WindowBuilder'
import { StairBuilder } from './components/StairBuilder'
import { ObjectBuilder } from './components/ObjectBuilder'
import { PictureFrameBuilder } from './components/PictureFrameBuilder'
import { KitchenUnitBuilder } from './components/KitchenUnitBuilder'
import { validatePictureFrameDesign } from './pictureFrameDesign'
import { validateKitchenUnitDesign } from './kitchenUnitDesign'
import { loadPictureFrameLibrary, registerPictureFrameModels, removePictureFramesFromLibrary,
  savePictureFrameToLibrary } from './pictureFrameLibrary'
import { loadKitchenUnitLibrary, registerKitchenUnitModels, removeKitchenUnitsFromLibrary,
  saveKitchenUnitToLibrary } from './kitchenUnitLibrary'
import { loadStairLibrary, registerStairModels, removeStairsFromLibrary, saveStairToLibrary } from './stairLibrary'
import { stairGeometryKey } from './stairGeometry'
import { validateStairDesign } from './stairDesign'
import { loadWindowLibrary, removeWindowsFromLibrary, saveWindowToLibrary } from './windowLibrary'
import { validateWindowDesign } from './windowDesign'
import { Toolbar } from './components/Toolbar'
import { ThreeDView, clearThreeDModelAssetCaches } from './components/ThreeDView'
import type {
  FloorLevel,
  FloorplanViewportState,
  PlacedModel,
  Point,
  RoofStructure,
  Room,
  SavedThreeDViewState,
  SavedTwoDViewState,
  SelectableSurface,
  SunPosition,
  SurfaceMaterialAssignment,
  SurfaceMaterialProduct,
  SurfaceWallSide,
  Wall,
  WallKind,
  WallSurfaceFragmentReference,
  ThreeDViewCameraState,
} from './types'
import {
  registerRuntimeSurfaceMaterials,
  registerLocalSurfaceMaterials,
  surfaceMaterialCatalog,
  surfaceMaterialsById,
} from './materials/materialCatalog'
import {
  modelLibrary,
  modelsById,
  registerRuntimeModels,
  registerWindowModels,
  type ModelDefinition,
} from './models/modelLibrary'
import {
  isOpeningModel,
  type ModelLibraryRoot,
  type ModelLibrarySection,
} from './models/modelLibrarySections'
import { loadPortalCatalog } from './portalCatalog'
import {
  buildWallTopology,
  preserveRoomMetadataAfterWallMove,
  wallEditCollapsesGeometry,
  WALL_TOPOLOGY_VERSION,
  type DetectedRoom,
} from './wallTopology'
import { getFloorEnvelopeWalls } from './floorEnvelope'
import { createCeilingLoftFloor, getAddLoftFloorDisabledReason } from './loftFloor'
import { createDormerWindow, syncDormerWindows, updateDormerWindow } from './dormerWindows'
import { DEFAULT_EXTERNAL_WALL_THICKNESS_METERS, MAX_WALL_HEIGHT_METERS } from './wallGeometry'
import { remapSplitWallFinishes, splitFloorWall } from './wallSplit'
import { getWallJoinChain, joinFloorWalls, preserveJoinedWallRooms, remapJoinedWallFinishes } from './wallJoin'
import {
  ALL_FLOORS_VIEW_ID,
  normalizeExposureStops,
  normalizeSavedThreeDViewState,
  normalizeSavedTwoDViewState,
} from './projectViewState'
import {
  constrainDoorUpdate,
  createPlacedModel,
  doorPlacementFits,
  getDoorWallOffset,
  getWallMountForPoint,
  fitWallMountedObject,
  getWallMountedObjectPlacement,
  isWallMountedDecoration,
  normalizeFloor,
  resolveWallCabinetPlacement,
  syncWallOpenings,
  updateWallAttachedModels,
  type ModelPlacement,
} from './modelPlacement'
import { isPlanDoor } from './doorPlan'
import {
  findDormerPlacement,
  getAttachedDormerPlacement,
} from './dormerPlacement'
//import springfield12Project from '../springfield_14.json'
//import springfield12Project from '../red_house_3.json'
import './App.css'

const DEFAULT_THICKNESS = DEFAULT_EXTERNAL_WALL_THICKNESS_METERS
const DEFAULT_INTERNAL_THICKNESS = 0.15
const DEFAULT_ROOM_HEIGHT = 2.4
const DEFAULT_SLAB_THICKNESS = 0.3
const PROJECT_FILE_EXTENSION = '.house.json'
const PROJECT_FILE_NAME = `house-design${PROJECT_FILE_EXTENSION}`
const PROJECT_FILE_MIME_TYPE = 'application/json'
const DEFAULT_SUN_POSITION: SunPosition = {
  azimuth: Math.atan2(6, 4),
  elevation: 0.78,
}
const MIN_COMMITTED_WALL_LENGTH_METERS = 0.01
const WALL_COORDINATE_EPSILON_METERS = 0.001

type ModelAlignDirection = 'bottom' | 'left' | 'right' | 'top'

function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))

    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-')
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function getPointDistance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function pointHasFiniteCoordinates(point: Point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function wallHasValidGeometry(wall: Pick<Wall, 'end' | 'start'>) {
  return (
    pointHasFiniteCoordinates(wall.start) &&
    pointHasFiniteCoordinates(wall.end) &&
    getPointDistance(wall.start, wall.end) >= MIN_COMMITTED_WALL_LENGTH_METERS
  )
}

function pointsMatchWithinEpsilon(first: Point, second: Point) {
  return getPointDistance(first, second) <= WALL_COORDINATE_EPSILON_METERS
}

function wallMatchesExistingSegment(
  candidateWall: Pick<Wall, 'end' | 'start'>,
  existingWall: Pick<Wall, 'end' | 'start'>,
) {
  return (
    (pointsMatchWithinEpsilon(candidateWall.start, existingWall.start) &&
      pointsMatchWithinEpsilon(candidateWall.end, existingWall.end)) ||
    (pointsMatchWithinEpsilon(candidateWall.start, existingWall.end) &&
      pointsMatchWithinEpsilon(candidateWall.end, existingWall.start))
  )
}

function wallDuplicatesExistingSegment(
  candidateWall: Pick<Wall, 'end' | 'start'>,
  walls: Wall[],
  ignoredWallId?: string,
) {
  return walls.some(
    (wall) =>
      wall.id !== ignoredWallId && wallMatchesExistingSegment(candidateWall, wall),
  )
}

type SavedProject = {
  indirectLighting?: SavedIndirectLighting
  activeFloorId: string
  floors: FloorLevel[]
  modelDefinitions?: ModelDefinition[]
  materialDefinitions?: SurfaceMaterialProduct[]
  sunPosition?: SunPosition
  surfaceAssignments?: SurfaceMaterialAssignment[]
  threeDView?: SavedThreeDViewState
  twoDView?: SavedTwoDViewState
  wallKind: WallKind
}

type ProjectSaveDestination = { kind: 'device'; handle?: ProjectFileHandle } | { kind: 'cloud'; assetId: string; name: string }

type ProjectSnapshot = SavedProject & {
  threeDNavigationFloorId: string
  selectedFloorViewId: string
  selectedModelId: string | null
  selectedModelIds: string[]
  selectedRoofId: string | null
  selectedRoomSignature: string | null
  selectedSurface: SelectableSurface | null
  selectedWallId: string | null
  selectedWallIds: string[]
}

type ClipboardItem =
  | {
      type: 'model'
      model: PlacedModel
    }
  | {
      type: 'wall'
      wall: Wall
    }

type SelectedRoom = {
  detectedRoom: DetectedRoom
  metadata: Room
}

type SelectedModel = {
  definition: ModelDefinition
  model: PlacedModel
}

function selectableSurfacesMatch(
  firstSurface: SelectableSurface | null,
  secondSurface: SelectableSurface,
) {
  if (!firstSurface || firstSurface.type !== secondSurface.type) {
    return false
  }

  if (firstSurface.type === 'wall-face' && secondSurface.type === 'wall-face') {
    return (
      firstSurface.floorId === secondSurface.floorId &&
      firstSurface.wallId === secondSurface.wallId &&
      firstSurface.side === secondSurface.side
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
    firstSurface.type === 'wall-face' ||
    secondSurface.type === 'wall-face' ||
    firstSurface.type === 'wall-surface-fragment' ||
    secondSurface.type === 'wall-surface-fragment'
  ) {
    return false
  }

  if (
    firstSurface.type === 'floor-slab-edge' ||
    secondSurface.type === 'floor-slab-edge'
  ) {
    return false
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

  if (firstSurface.type === 'roof' && secondSurface.type === 'roof') {
    return roofSurfaceTargetsMatch(firstSurface, secondSurface)
  }

  if (
    firstSurface.type === 'portal-floor' ||
    secondSurface.type === 'portal-floor' ||
    firstSurface.type === 'roof' ||
    secondSurface.type === 'roof'
  ) {
    return false
  }

  return (
    firstSurface.floorId === secondSurface.floorId &&
    firstSurface.roomSignature === secondSurface.roomSignature
  )
}

function isSavedProject(value: unknown): value is SavedProject {
  if (!value || typeof value !== 'object') {
    return false
  }

  const project = value as Partial<SavedProject>

  return (
    typeof project.activeFloorId === 'string' &&
    Array.isArray(project.floors) &&
    project.floors.length > 0 &&
    (project.wallKind === 'external' || project.wallKind === 'internal') &&
    (!Array.isArray(project.modelDefinitions) || project.modelDefinitions.every(model =>
      (!model?.stairDesign || !validateStairDesign(model.stairDesign)) &&
      (!model?.pictureFrameDesign || !validatePictureFrameDesign(model.pictureFrameDesign)) &&
      (!model?.kitchenUnitDesign || !validateKitchenUnitDesign(model.kitchenUnitDesign))))
  )
}

function downloadProjectCopy(fileName: string, contents: string) {
  const blob = new Blob([contents], { type: PROJECT_FILE_MIME_TYPE })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // The browser can start the download after this click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

function readTextFromInputFile() {
  // Use the standard file input even where showOpenFilePicker is available:
  // affected desktop sessions leave that API pending after choosing a file.
  return new Promise<LoadedProjectFile | null>((resolve, reject) => {
    const input = document.createElement('input')

    input.type = 'file'
    input.hidden = true
    input.accept = `${PROJECT_FILE_EXTENSION},.json,${PROJECT_FILE_MIME_TYPE}`
    let settled = false
    input.onchange = () => {
      if (settled) return
      settled = true
      const file = input.files?.[0]
      input.remove()

      if (!file) {
        resolve(null)
        return
      }

      file.text().then(
        (contents) => resolve({ contents, fileName: file.name }),
        reject,
      )
    }
    input.oncancel = () => {
      if (settled) return
      // Some chooser implementations report cancel when reselecting a file.
      if (input.files?.length) { input.onchange?.call(input, new Event('change')); return }
      settled = true; input.remove(); resolve(null)
    }
    // Keep the input owned by the document while the menu that opened it unmounts.
    document.body.append(input)
    try { input.click() } catch (error) { input.remove(); reject(error) }
  })
}

function cloneProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return structuredClone(snapshot)
}

function serializeSavedProject(project: SavedProject) {
  // Personal libraries arrive asynchronously and include designs which have
  // never been placed in this house. Saving can still carry that library, but
  // loading it is not an edit to the project (nor is navigating either view).
  const modelIds = new Set(project.floors.flatMap(floor => (floor.models ?? [])
    .flatMap(model => [model.modelId, model.dormerWindowModelId].filter(Boolean))))
  const modelDefinitions = (project.modelDefinitions ?? []).filter(model => modelIds.has(model.id))
  const materialDefinitions = collectLocalMaterialDefinitions(
    { floors: project.floors, surfaceAssignments: project.surfaceAssignments, modelDefinitions }, project.materialDefinitions ?? [])
  return JSON.stringify({
    ...Object.fromEntries(Object.entries(project).filter(([key]) => !['indirectLighting', 'activeFloorId', 'twoDView'].includes(key))),
    modelDefinitions,
    materialDefinitions,
    threeDView: project.threeDView && {
      diffuseProbeResolution: project.threeDView.diffuseProbeResolution,
      exposureStops: project.threeDView.exposureStops,
      ambientLighting: project.threeDView.ambientLighting,
    },
  })
}

function getSavedProjectModelDefinitions(floors: FloorLevel[]) {
  const modelIds = new Set(
    floors.flatMap((floor) => (floor.models ?? []).map((model) => model.modelId)),
  )
  modelLibrary.filter(model => model.windowDesign || model.stairDesign || model.pictureFrameDesign || model.kitchenUnitDesign)
    .forEach(model => modelIds.add(model.id))

  return Array.from(modelIds)
    .flatMap((modelId) => {
      const definition = modelsById.get(modelId)

      return definition && (modelId.startsWith('portal-model-') || definition.windowDesign ||
        definition.stairDesign || definition.pictureFrameDesign || definition.kitchenUnitDesign)
        ? [definition]
        : []
    })
    .sort((firstDefinition, secondDefinition) =>
      firstDefinition.id.localeCompare(secondDefinition.id),
    )
}

function normalizeSunPosition(sunPosition?: SunPosition): SunPosition {
  if (
    !sunPosition ||
    !Number.isFinite(sunPosition.azimuth) ||
    !Number.isFinite(sunPosition.elevation)
  ) {
    return DEFAULT_SUN_POSITION
  }

  return {
    azimuth: sunPosition.azimuth,
    elevation: Math.max(0.08, Math.min(1.2, sunPosition.elevation)),
    ...(sunPosition.strength === undefined ? {} : { strength: normalizeSunStrength(sunPosition.strength) }),
  }
}

function normalizeSavedProject(project: SavedProject) {
  if (Array.isArray(project.materialDefinitions)) {
    project.materialDefinitions.forEach(validateLocalMaterial)
    registerLocalSurfaceMaterials(project.materialDefinitions)
  }
  if (Array.isArray(project.modelDefinitions)) {
    registerRuntimeModels(project.modelDefinitions)
  }

  // Light switches are authored state; GPU light/shadow budgets belong to the
  // renderer and must never switch lamps off in the saved project.
  const floors = project.floors.map(normalizeLoadedFloor)
  const activeFloorId = floors.some((floor) => floor.id === project.activeFloorId)
    ? project.activeFloorId
    : floors[0].id
  const restoredThreeDView = normalizeSavedThreeDViewState(
    project.threeDView,
    floors.map((floor) => floor.id),
    activeFloorId,
  )
  const threeDView = { ...restoredThreeDView, ambientLighting: restoredThreeDView.ambientLighting ?? ambientLightingPreferences(project.indirectLighting?.settings) }
  const twoDView = normalizeSavedTwoDViewState(
    project.twoDView,
    floors.map((floor) => floor.id),
  )

  return {
    activeFloorId,
    floors,
    modelDefinitions: getSavedProjectModelDefinitions(floors),
    materialDefinitions: collectLocalMaterialDefinitions({ floors, surfaceAssignments: project.surfaceAssignments, modelDefinitions: getSavedProjectModelDefinitions(floors) }, surfaceMaterialCatalog),
    sunPosition: normalizeSunPosition(project.sunPosition),
    surfaceAssignments: Array.isArray(project.surfaceAssignments)
      ? project.surfaceAssignments
      : [],
    threeDView,
    twoDView,
    wallKind: project.wallKind,
    indirectLighting: project.indirectLighting,
  }
}

function normalizeLoadedFloor(input: FloorLevel): FloorLevel {
  const floor = normalizeFloor(input, modelsById)
  const existingRooms = new Map((floor.rooms ?? []).map(room => [room.signature, room]))
  // Migrate derived topology before taking the clean snapshot, rather than
  // letting the room reconciliation effect make a freshly loaded house dirty.
  const rooms = buildWallTopology(floor.walls, { floorFootprints: floor.floorFootprints }).rooms
    .map((room, index) => existingRooms.get(room.signature) ?? {
      id: createId(), name: `Room ${index + 1}`, signature: room.signature,
    })
  return { ...floor, rooms }
}

function createFallbackProject(): SavedProject {
  const initialFloorId = createId()

  return {
    activeFloorId: initialFloorId,
    floors: [
      {
        id: initialFloorId,
        name: 'Floor 0',
        elevation: 0,
        models: [],
        roofs: [],
        rooms: [],
        roomHeight: DEFAULT_ROOM_HEIGHT,
        slabThickness: DEFAULT_SLAB_THICKNESS,
        walls: [],
      },
    ],
    sunPosition: DEFAULT_SUN_POSITION,
    surfaceAssignments: [],
    wallKind: 'external',
  }
}

function createInitialProject(defaultProject: unknown) {
  if (isSavedProject(defaultProject)) {
    return normalizeSavedProject(defaultProject)
  }

  return normalizeSavedProject(createFallbackProject())
}

function isTextEntryElement(target: EventTarget | null) {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return true
  }

  return target instanceof HTMLElement && target.isContentEditable
}

function getFloorWallBounds(floor: FloorLevel) {
  const points = [...floor.walls.flatMap((wall) => [wall.start, wall.end]), ...(floor.floorFootprints?.flat() ?? [])]

  if (points.length === 0) {
    return null
  }

  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))

  return {
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
    depth: Math.max(maxY - minY, 0.3),
    width: Math.max(maxX - minX, 0.3),
  }
}

function rotatePlanOffset(offset: Point, rotation: number): Point {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  return {
    x: offset.x * cos + offset.y * sin,
    y: -offset.x * sin + offset.y * cos,
  }
}

export function App({ initialProjectSource }: { initialProjectSource: unknown }) {
  const recentProjects = useRecentProjects()
  const [localLightControl] = useState(createLocalLightControl)
  const [initialProject] = useState(() => createInitialProject(initialProjectSource))
  const [loadedLightingCache, setLoadedLightingCache] = useState(initialProject.indirectLighting)
  const bakedLightingRef = useRef(initialProject.indirectLighting)
  const projectGeneration = useRef(0)
  const projectLoadRequest = useRef(0)
  const pendingLoadDecision = useRef<((discard: boolean) => void) | null>(null)
  const [loadConfirmation, setLoadConfirmation] = useState<{ fileName: string; onDecision: (discard: boolean) => void } | null>(null)
  const [loadFeedback, setLoadFeedback] = useState<{ error: boolean; message: string } | null>(null)
  const [floors, setFloors] = useState<FloorLevel[]>(initialProject.floors)
  const currentFloorsRef = useRef(floors)
  useLayoutEffect(() => { currentFloorsRef.current = floors }, [floors])
  // ThreeDView already coalesces reconciliation after the controls paint.
  // Keep its incoming floors current: another deferred copy here can strand
  // undo/removal on an old snapshot after the plan and saved state have changed.
  const [projectLoadRevision, setProjectLoadRevision] = useState(0)
  const updateBakedLighting = useCallback((cache: SavedIndirectLighting | undefined) => {
    // A queued completion from the outgoing Canvas must not replace the new
    // project's portable cache, including before passive unmount cleanup runs.
    if (projectGeneration.current === projectLoadRevision) bakedLightingRef.current = cache
  }, [projectLoadRevision])
  useEffect(() => { traceEditorPreparation('plan-commit', projectLoadRevision, { walls: floors.reduce((sum, floor) => sum + floor.walls.length, 0) }) }, [floors, projectLoadRevision])
  const modelTransformPreviewRef = useRef<ModelTransformPreview | null>(null)
  useEffect(() => {
    // The view's live-floor ref now owns the committed transform while its
    // coalesced scene props catch up.
    if (modelTransformPreviewRef.current?.committed) modelTransformPreviewRef.current = null
  }, [floors])
  const [sunPosition, setSunPosition] = useState<SunPosition>(
    initialProject.sunPosition,
  )
  const [activeFloorId, setActiveFloorId] = useState<string>(
    initialProject.activeFloorId,
  )
  const [selectedFloorViewId, setSelectedFloorViewId] =
    useState<string>(initialProject.threeDView.floorViewId)
  // Keep 3D navigation independent of the floor being edited in the plan.
  const [threeDNavigationFloorId, setThreeDNavigationFloorId] = useState(initialProject.activeFloorId)
  const [diffuseProbeResolution, setDiffuseProbeResolution] = useState<DiffuseProbeResolution>(
    normalizeDiffuseProbeResolution(initialProject.threeDView.diffuseProbeResolution ?? initialProject.indirectLighting?.settings.diffuseProbeResolution),
  )
  const [exposureStops, setExposureStops] = useState(() => normalizeExposureStops(initialProject.threeDView.exposureStops))
  const [ambientLighting, setAmbientLighting] = useState(() => initialProject.threeDView.ambientLighting ?? ambientLightingPreferences(initialProject.indirectLighting?.settings))
  const [showImages, setShowImages] = useState(false)
  const threeDViewCameraRef = useRef<ThreeDViewCameraState>(
    initialProject.threeDView.camera,
  )
  const [cameraRestoreRequest, setCameraRestoreRequest] = useState({
    revision: 0,
    state: initialProject.threeDView.camera,
  })
  const floorplanViewportsRef = useRef(
    initialProject.twoDView.viewportsByFloorId,
  )
  const [floorplanRestoreRevision, setFloorplanRestoreRevision] = useState(0)
  const [wallKind, setWallKind] = useState<WallKind>(initialProject.wallKind)
  const [internalWallThickness, setInternalWallThickness] = useState(
    DEFAULT_INTERNAL_THICKNESS,
  )
  const [newWallHeight, setNewWallHeight] = useState(DEFAULT_ROOM_HEIGHT)
  const [wallTool, setWallTool] = useState<'add' | 'split' | null>(null)
  const [railPanel, setRailPanel] = useState<RailPanel | null>(null)
  const isAddingWall = wallTool === 'add'
  const isSplittingWall = wallTool === 'split'
  const exitWallTool = useCallback(() => setWallTool(null), [])
  const stopAddingWalls = useCallback(() => {
    setWallTool(null)
    setRailPanel('wall')
  }, [])
  const [isRoofMode, setIsRoofMode] = useState(false)
  const [projectFileName, setProjectFileName] = useState(initialProjectSource === undefined ? PROJECT_FILE_NAME : 'colin_house_v2.json')
  //const [projectFileName, setProjectFileName] = useState('sharrose_road_2.json')
  //const [projectFileName, setProjectFileName] = useState('red_house_3.json')
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null)
  const [selectedRoomSignature, setSelectedRoomSignature] = useState<string | null>(
    null,
  )
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false)
  const [propertiesFullscreenHost, setPropertiesFullscreenHost] = useState<Element | null>(null)
  const openProperties = useCallback(() => setIsPropertiesOpen(true), [])
  useEffect(() => {
    const update = () => {
      const fullscreen = document.fullscreenElement
      setPropertiesFullscreenHost(fullscreen?.classList.contains('three-editor-pane') ? fullscreen : null)
    }
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  const [selectedRoofId, setSelectedRoofId] = useState<string | null>(null)
  const [roofPlacementPreview, setRoofPlacementPreview] =
    useState<RoofPlacementPreview | null>(null)
  const [selectedSurface, setSelectedSurface] =
    useState<SelectableSurface | null>(null)
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([])
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const editorGridRef = useRef<HTMLElement>(null)
  const historyPastRef = useRef<ProjectSnapshot[]>([])
  const historyFutureRef = useRef<ProjectSnapshot[]>([])
  const historyCoalesceRef = useRef<{ key: string; time: number } | null>(null)
  const [historyAvailability, setHistoryAvailability] = useState({
    canRedo: false,
    canUndo: false,
  })
  const [splitPercent, setSplitPercent] = useState(50)
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [windowBuilder, setWindowBuilder] = useState<{ definition: ModelDefinition | null } | null>(null)
  const [stairBuilder, setStairBuilder] = useState<{ definition: ModelDefinition | null } | null>(null)
  const [objectBuilderOpen, setObjectBuilderOpen] = useState(false)
  const [pictureFrameBuilder, setPictureFrameBuilder] = useState<{ definition: ModelDefinition | null } | null>(null)
  const [kitchenUnitBuilder, setKitchenUnitBuilder] = useState<{ definition: ModelDefinition | null } | null>(null)
  const [modelSelectorLocation, setModelSelectorLocation] =
    useState<{ root: ModelLibraryRoot; section: ModelLibrarySection }>({ root: 'public', section: 'objects' })
  const [pendingModelId, setPendingModelId] = useState<string | null>(null)
  const [isManufacturerPortalOpen, setIsManufacturerPortalOpen] = useState(false)
  const [isMaterialEditorOpen, setIsMaterialEditorOpen] = useState(false)
  const [isAccountOpen, setIsAccountOpen] = useState(false)
  const [saveDestination, setSaveDestination] = useState<ProjectSaveDestination | null>(null)
  const [isSavingProject, setIsSavingProject] = useState(false)
  const deviceSavePickerRef = useRef<AbortController | null>(null)
  const [cloudSaveRequested, setCloudSaveRequested] = useState(false)
  const [isEngineConsoleOpen, setIsEngineConsoleOpen] = useState(false)
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantPreview, setAssistantPreview] = useState<{ proposal: DesignProposal; previewFloors: FloorLevel[]; floors: FloorLevel[]; revision: string;
    stair?: FloorEdits['stair']; overlays?: FloorEdits['overlays'] } | null>(null)
  const [modelAssetVersion, setModelAssetVersion] = useState(0)
  const [sceneRevision, setSceneRevision] = useState(0)
  const [availableMaterials, setAvailableMaterials] = useState(
    () => [...surfaceMaterialCatalog],
  )
  const [availableModels, setAvailableModels] = useState(() => [...modelLibrary])
  const portalModelsRef = useRef<ModelDefinition[]>([])
  const [surfaceAssignments, setSurfaceAssignments] = useState<
    SurfaceMaterialAssignment[]
  >(initialProject.surfaceAssignments)
  const lastCleanProjectRef = useRef<string | null>(null)
  // useRef evaluates its argument on every render. Serialising the embedded
  // house there blocked selection/menu updates even though the value was ignored.
  if (lastCleanProjectRef.current === null) {
    lastCleanProjectRef.current = serializeSavedProject(initialProject)
  }
  useEffect(() => installViewportInputPriority(window), [])

  const updateThreeDViewCameraState = useCallback(
    (cameraState: ThreeDViewCameraState) => {
      threeDViewCameraRef.current = cameraState
    },
    [],
  )

  const restoreThreeDViewCameraState = (cameraState: ThreeDViewCameraState) => {
    threeDViewCameraRef.current = cameraState
    setCameraRestoreRequest((currentRequest) => ({
      revision: currentRequest.revision + 1,
      state: cameraState,
    }))
  }

  const updateFloorplanViewport = useCallback(
    (floorId: string, viewport: FloorplanViewportState) => {
      floorplanViewportsRef.current = {
        ...floorplanViewportsRef.current,
        [floorId]: viewport,
      }
    },
    [],
  )

  const restoreTwoDViewState = (twoDView: SavedTwoDViewState) => {
    floorplanViewportsRef.current = structuredClone(twoDView.viewportsByFloorId)
    setFloorplanRestoreRevision((revision) => revision + 1)
  }

  const refreshPortalCatalog = useCallback(async (preserveSavedDefinitions = false) => {
    try {
      const catalog = await loadPortalCatalog()
      console.info(
        `[HouseDesigner] Loaded portal catalog: ${catalog.models.length} models, ${catalog.materials.length} materials`,
      )
      registerRuntimeSurfaceMaterials(catalog.materials)
      portalModelsRef.current = catalog.models
      registerRuntimeModels(retainProjectModels(catalog.models, currentFloorsRef.current, modelsById, preserveSavedDefinitions))
      setAvailableMaterials([...surfaceMaterialCatalog])
      setAvailableModels([...modelLibrary])
      setModelAssetVersion((version) => version + 1)
    } catch (error) {
      console.warn(
        error instanceof Error ? error.message : 'Could not load uploaded assets',
      )
    }
  }, [])

  useEffect(() => {
    void refreshPortalCatalog(true)
  }, [refreshPortalCatalog])

  useEffect(() => {
    let cancelled = false
    void loadLocalMaterials().then(materials => {
      if (cancelled) return
      // Definitions embedded in the opened house take precedence over the library.
      registerLocalSurfaceMaterials(materials.filter(material => !surfaceMaterialsById.has(material.id)))
      setAvailableMaterials([...surfaceMaterialCatalog])
    }).catch(error => console.warn('Could not read My materials:', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadWindowLibrary().then(windows => {
      if (cancelled) return
      // A design embedded in the currently loaded project takes precedence.
      registerWindowModels(windows.filter(model => !modelsById.has(model.id)))
      setAvailableModels([...modelLibrary])
    }).catch(error => console.warn('Could not read My windows:', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadStairLibrary().then(stairs => {
      if (cancelled) return
      registerStairModels(stairs.filter(model => !modelsById.has(model.id)))
      setAvailableModels([...modelLibrary])
    }).catch(error => console.warn('Could not read My stairs:', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadPictureFrameLibrary().then(frames => {
      if (cancelled) return
      registerPictureFrameModels(frames.filter(model => !modelsById.has(model.id)))
      setAvailableModels([...modelLibrary])
    }).catch(error => console.warn('Could not read saved picture frames:', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadKitchenUnitLibrary().then(units => {
      if (cancelled) return
      registerKitchenUnitModels(units.filter(model => !modelsById.has(model.id)))
      setAvailableModels([...modelLibrary])
    }).catch(error => console.warn('Could not read saved kitchen units:', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (modelAssetVersion <= 0) {
      return
    }

    setFloors((currentFloors) =>
      currentFloors.map((floor) => normalizeFloor(floor, modelsById)),
    )
    setSceneRevision((currentRevision) => currentRevision + 1)
  }, [modelAssetVersion])

  const getProjectSnapshot = (): ProjectSnapshot => ({
    threeDNavigationFloorId,
    activeFloorId,
    floors,
    modelDefinitions: getSavedProjectModelDefinitions(floors),
    materialDefinitions: collectLocalMaterialDefinitions({ floors, surfaceAssignments, modelDefinitions: getSavedProjectModelDefinitions(floors) }, surfaceMaterialCatalog),
    selectedFloorViewId,
    selectedModelId,
    selectedModelIds,
    selectedRoofId,
    selectedRoomSignature,
    selectedSurface,
    selectedWallId,
    selectedWallIds,
    sunPosition,
    surfaceAssignments,
    threeDView: {
      camera: structuredClone(threeDViewCameraRef.current),
      floorViewId: selectedFloorViewId,
      diffuseProbeResolution,
      exposureStops,
      ambientLighting,
    },
    twoDView: normalizeSavedTwoDViewState(
      { viewportsByFloorId: floorplanViewportsRef.current },
      floors.map((floor) => floor.id),
    ),
    wallKind,
  })

  const getCurrentSavedProject = (): SavedProject => {
    const normalizedFloors = floors.map((floor) =>
      normalizeFloor(floor, modelsById),
    )

    return {
      activeFloorId,
      floors: normalizedFloors,
      modelDefinitions: getSavedProjectModelDefinitions(normalizedFloors),
      materialDefinitions: collectLocalMaterialDefinitions({ floors: normalizedFloors, surfaceAssignments, modelDefinitions: getSavedProjectModelDefinitions(normalizedFloors) }, surfaceMaterialCatalog),
      sunPosition,
      surfaceAssignments,
      threeDView: {
        camera: structuredClone(threeDViewCameraRef.current),
        floorViewId: selectedFloorViewId,
        diffuseProbeResolution,
        exposureStops,
        ambientLighting,
      },
      twoDView: normalizeSavedTwoDViewState(
        { viewportsByFloorId: floorplanViewportsRef.current },
        normalizedFloors.map((floor) => floor.id),
      ),
      wallKind,
    }
  }

  const restoreProjectSnapshot = (snapshot: ProjectSnapshot) => {
    if (snapshot.materialDefinitions) {
      registerLocalSurfaceMaterials(snapshot.materialDefinitions)
      setAvailableMaterials([...surfaceMaterialCatalog])
    }
    if (snapshot.modelDefinitions) {
      const restoredIds = new Set(snapshot.modelDefinitions.map(model => model.id))
      const removedWindows = modelLibrary.filter(model => model.windowDesign && !restoredIds.has(model.id)).map(model => model.id)
      void removeWindowsFromLibrary(removedWindows).catch(error => console.warn('Could not undo local window:', error))
      const removedStairs = modelLibrary.filter(model => model.stairDesign && !restoredIds.has(model.id)).map(model => model.id)
      void removeStairsFromLibrary(removedStairs).catch(error => console.warn('Could not undo local stairs:', error))
      const removedFrames = modelLibrary.filter(model => model.pictureFrameDesign && !restoredIds.has(model.id)).map(model => model.id)
      void removePictureFramesFromLibrary(removedFrames).catch(error => console.warn('Could not undo local picture frames:', error))
      const removedUnits = modelLibrary.filter(model => model.kitchenUnitDesign && !restoredIds.has(model.id)).map(model => model.id)
      void removeKitchenUnitsFromLibrary(removedUnits).catch(error => console.warn('Could not undo local kitchen units:', error))
      registerRuntimeModels(mergeProjectModelDefinitions(portalModelsRef.current,
        snapshot.modelDefinitions.filter(model => !model.windowDesign && !model.stairDesign && !model.pictureFrameDesign && !model.kitchenUnitDesign)))
      registerWindowModels(snapshot.modelDefinitions.filter(model => model.windowDesign), true)
      registerStairModels(snapshot.modelDefinitions.filter(model => model.stairDesign), true)
      registerPictureFrameModels(snapshot.modelDefinitions.filter(model => model.pictureFrameDesign), true)
      registerKitchenUnitModels(snapshot.modelDefinitions.filter(model => model.kitchenUnitDesign), true)
      setAvailableModels([...modelLibrary])
      setSceneRevision(revision => revision + 1)
      for (const model of snapshot.modelDefinitions.filter(model => model.windowDesign)) {
        void saveWindowToLibrary(model).catch(error => console.warn('Could not restore local window:', error))
      }
      for (const model of snapshot.modelDefinitions.filter(model => model.stairDesign)) {
        void saveStairToLibrary(model).catch(error => console.warn('Could not restore local stairs:', error))
      }
      for (const model of snapshot.modelDefinitions.filter(model => model.pictureFrameDesign)) {
        void savePictureFrameToLibrary(model).catch(error => console.warn('Could not restore local picture frames:', error))
      }
      for (const model of snapshot.modelDefinitions.filter(model => model.kitchenUnitDesign)) {
        void saveKitchenUnitToLibrary(model).catch(error => console.warn('Could not restore local kitchen units:', error))
      }
    }
    localLightControl.restore(snapshot.floors.flatMap(floor => floor.models.filter(model => modelsById.get(model.modelId)?.isLight)
      .map(model => [model.id, model.lightEnabled !== false] as const)))
    setFloors(snapshot.floors.map((floor) => normalizeFloor(floor, modelsById)))
    setActiveFloorId(snapshot.activeFloorId)
    setThreeDNavigationFloorId(snapshot.threeDNavigationFloorId)
    setSelectedFloorViewId(snapshot.selectedFloorViewId)
    if (snapshot.threeDView) {
      restoreThreeDViewCameraState(snapshot.threeDView.camera)
      setDiffuseProbeResolution(normalizeDiffuseProbeResolution(snapshot.threeDView.diffuseProbeResolution))
      setExposureStops(normalizeExposureStops(snapshot.threeDView.exposureStops))
      setAmbientLighting(snapshot.threeDView.ambientLighting ?? ambientLightingPreferences())
    }
    if (snapshot.twoDView) {
      restoreTwoDViewState(
        normalizeSavedTwoDViewState(
          snapshot.twoDView,
          snapshot.floors.map((floor) => floor.id),
        ),
      )
    }
    setSelectedModelId(snapshot.selectedModelId)
    setSelectedModelIds(snapshot.selectedModelIds)
    setSelectedRoofId(snapshot.selectedRoofId ?? null)
    setSelectedRoomSignature(snapshot.selectedRoomSignature)
    setSelectedSurface(snapshot.selectedSurface ?? null)
    setSelectedWallId(snapshot.selectedWallId)
    setSelectedWallIds(snapshot.selectedWallIds)
    setSunPosition(normalizeSunPosition(snapshot.sunPosition))
    setSurfaceAssignments(snapshot.surfaceAssignments ?? [])
    setWallKind(snapshot.wallKind)
    setWallTool(null)
  }

  const updateHistoryAvailability = () => {
    setHistoryAvailability({
      canRedo: historyFutureRef.current.length > 0,
      canUndo: historyPastRef.current.length > 0,
    })
  }

  const syncWallOpeningsForModelIfNeeded = (
    floor: FloorLevel,
    modelId: string,
  ) => {
    const definition = modelsById.get(modelId)

    return definition?.wallMount ? syncWallOpenings(floor, modelsById) : syncDormerWindows(floor, modelsById)
  }

  const recordHistory = (coalesceKey?: string) => {
    // This helper is only invoked from event/update handlers, not during render.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    const previousCoalesce = historyCoalesceRef.current

    if (
      coalesceKey &&
      previousCoalesce?.key === coalesceKey &&
      now - previousCoalesce.time < 600
    ) {
      historyCoalesceRef.current = { key: coalesceKey, time: now }
      return
    }

    historyPastRef.current = [
      ...historyPastRef.current.slice(-79),
      cloneProjectSnapshot(getProjectSnapshot()),
    ]
    historyFutureRef.current = []
    historyCoalesceRef.current = coalesceKey ? { key: coalesceKey, time: now } : null
    updateHistoryAvailability()
    setHistoryVersion((version) => version + 1)
  }

  const undo = () => {
    const previousSnapshot = historyPastRef.current.at(-1)

    if (!previousSnapshot) {
      return
    }

    historyPastRef.current = historyPastRef.current.slice(0, -1)
    historyFutureRef.current = [
      cloneProjectSnapshot(getProjectSnapshot()),
      ...historyFutureRef.current,
    ]
    historyCoalesceRef.current = null
    restoreProjectSnapshot(previousSnapshot)
    updateHistoryAvailability()
    setHistoryVersion((version) => version + 1)
  }

  const redo = () => {
    const nextSnapshot = historyFutureRef.current[0]

    if (!nextSnapshot) {
      return
    }

    historyFutureRef.current = historyFutureRef.current.slice(1)
    historyPastRef.current = [
      ...historyPastRef.current,
      cloneProjectSnapshot(getProjectSnapshot()),
    ]
    historyCoalesceRef.current = null
    restoreProjectSnapshot(nextSnapshot)
    updateHistoryAvailability()
    setHistoryVersion((version) => version + 1)
  }

  useEffect(() => {
    // Rooms are derived from wall topology, but room names are user metadata that
    // must stay attached to the current floor state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFloors((currentFloors) => {
      let changed = false

      const nextFloors = currentFloors.map((inputFloor) => {
        const floor = syncDormerWindows(inputFloor, modelsById)
        if (floor !== inputFloor) changed = true
        const detectedRooms = buildWallTopology(floor.walls, { floorFootprints: floor.floorFootprints }).rooms
        const roomMetadataBySignature = new Map(
          (floor.rooms ?? []).map((room) => [room.signature, room]),
        )
        const rooms = detectedRooms.map((detectedRoom, index) => {
          const existingRoom = roomMetadataBySignature.get(detectedRoom.signature)

          return (
            existingRoom ?? {
              id: createId(),
              name: `Room ${index + 1}`,
              signature: detectedRoom.signature,
            }
          )
        })

        const roomSignaturesChanged =
          rooms.length !== (floor.rooms ?? []).length ||
          rooms.some((room, index) => room.signature !== floor.rooms?.[index]?.signature)

        if (roomSignaturesChanged) {
          changed = true
          return {
            ...floor,
            rooms,
          }
        }

        return floor
      })

      return changed ? nextFloors : currentFloors
    })
  }, [floors])

  useEffect(() => {
    if (!isResizingSplit) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const editorGrid = editorGridRef.current

      if (!editorGrid) {
        return
      }

      const bounds = editorGrid.getBoundingClientRect()
      const nextPercent = ((event.clientX - bounds.left) / bounds.width) * 100

      setSplitPercent(Math.min(75, Math.max(25, nextPercent)))
    }
    const stopResizing = () => setIsResizingSplit(false)

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [isResizingSplit])

  const addWall = (wall: Pick<Wall, 'start' | 'end'>) => {
    const targetFloor =
      floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
    const id = createId()
    const nextWall: Wall = {
      ...wall,
      id,
      kind: wallKind,
      allowRoofClipHeight: targetFloor.floorFootprints?.length ? true : undefined,
      thickness: wallKind === 'external' ? DEFAULT_THICKNESS : internalWallThickness,
      height: Math.min(newWallHeight, MAX_WALL_HEIGHT_METERS),
    }

    if (
      !wallHasValidGeometry(wall) ||
      wallDuplicatesExistingSegment(wall, targetFloor.walls) ||
      wallEditCollapsesGeometry(targetFloor.walls, [...targetFloor.walls, nextWall])
    ) {
      console.warn('[HouseDesigner] Ignored invalid wall geometry.', wall)
      return
    }

    recordHistory()

    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        floor.id === activeFloorId
          ? {
              ...floor,
              walls: [...floor.walls, nextWall],
            }
          : floor,
      ),
    )
    setSelectedWallId(id)
    setSelectedWallIds([id])
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
  }

  const splitWall = (wallId: string, offset: number) => {
    const floor = floors.find(candidate => candidate.id === activeFloorId) ?? floors[0]
    const split = splitFloorWall(floor, wallId, offset, createId())
    if (!split || wallEditCollapsesGeometry(floor.walls, split.floor.walls)) return

    const nextFloor = syncWallOpenings(split.floor, modelsById)
    const nextAssignments = remapSplitWallFinishes(surfaceAssignments, split, nextFloor, createId)
    recordHistory()
    setFloors(current => current.map(candidate => candidate.id === floor.id ? nextFloor : candidate))
    setSurfaceAssignments(nextAssignments)
    setSelectedWallId(split.second.id)
    setSelectedWallIds([split.second.id])
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
    setSelectedSurface(null)
  }

  const joinWalls = (wallIds: string[]) => {
    const floor = floors.find(candidate => candidate.id === activeFloorId) ?? floors[0]
    const chain = getWallJoinChain(floor.walls, wallIds, buildWallTopology(floor.walls, { detectRooms: false }))
    if (!chain) return

    const result = joinFloorWalls(floor, chain, createId())
    if (!wallHasValidGeometry(result.joined) ||
      wallDuplicatesExistingSegment(result.joined, result.floor.walls, result.joined.id) ||
      wallEditCollapsesGeometry(floor.walls, result.floor.walls)) return

    const nextModels = updateWallAttachedModels(result.floor.models, result.joined, { walls: result.floor.walls, definitions: modelsById })
    const nextFloor = syncWallOpenings({ ...result.floor, models: nextModels }, modelsById)
    const nextAssignments = remapJoinedWallFinishes(surfaceAssignments, result, nextFloor)
    const preserved = preserveJoinedWallRooms(floor, nextFloor, nextAssignments)
    recordHistory()
    setFloors(current => current.map(candidate => candidate.id === floor.id ? preserved.floor : candidate))
    setSurfaceAssignments(preserved.assignments)
    selectWall(result.joined.id)
  }

  const deleteWall = (wallId: string) => {
    if (!floors.some((floor) => floor.walls.some((wall) => wall.id === wallId))) {
      return
    }

    recordHistory()
    setFloors((currentFloors) =>
      currentFloors
        .map((floor) => ({
          ...floor,
          models: (floor.models ?? []).filter(
            (model) => model.wallAttachment?.wallId !== wallId,
          ),
          walls: floor.walls.filter((wall) => wall.id !== wallId),
        }))
        .map((floor) => syncWallOpenings(floor, modelsById)),
    )
    setSelectedWallId((currentSelectedWallId) =>
      currentSelectedWallId === wallId ? null : currentSelectedWallId,
    )
    setSelectedWallIds((currentSelectedWallIds) =>
      currentSelectedWallIds.filter((selectedId) => selectedId !== wallId),
    )
    setSelectedRoomSignature(null)
    setSelectedSurface((currentSelectedSurface) =>
      (currentSelectedSurface?.type === 'wall-face' ||
        currentSelectedSurface?.type === 'wall-surface-fragment') &&
      currentSelectedSurface.wallId === wallId
        ? null
        : currentSelectedSurface,
    )
    setSurfaceAssignments((currentSurfaceAssignments) =>
      currentSurfaceAssignments.filter(
        (assignment) =>
          !(
            (assignment.target.type === 'wall-face' ||
              assignment.target.type === 'wall-surface-fragment') &&
            assignment.target.wallId === wallId
          ),
      ),
    )
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
  }

  const addFloor = ({ copyExternalWalls }: { copyExternalWalls: boolean }) => {
    recordHistory()
    const floorNumber = floors.length
    const id = createId()
    const previousFloor = floors[floors.length - 1]
    const previousElevation = previousFloor
      ? previousFloor.elevation + previousFloor.roomHeight + previousFloor.slabThickness
      : 0

    setFloors((currentFloors) => [
      ...currentFloors,
      {
        id,
        name: `Floor ${floorNumber}`,
        elevation: previousElevation,
        models: [],
        roofs: [],
        rooms: [],
        roomHeight: DEFAULT_ROOM_HEIGHT,
        slabThickness: DEFAULT_SLAB_THICKNESS,
        walls:
          copyExternalWalls && previousFloor
            ? getFloorEnvelopeWalls(previousFloor.walls)
                .map((wall) => ({
                  ...wall,
                  id: createId(),
                  height: DEFAULT_ROOM_HEIGHT,
                  kind: 'external' as const,
                  openings: undefined,
                }))
            : [],
      },
    ])
    setActiveFloorId(id)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
    setWallTool(null)
  }

  const addCeilingLoftFloor = () => {
    const loft = createCeilingLoftFloor(floors, activeFloorId, createId())
    if (!loft) return
    recordHistory()
    const sourceViewport = floorplanViewportsRef.current[activeFloorId]
    if (sourceViewport) {
      floorplanViewportsRef.current = {
        ...floorplanViewportsRef.current,
        [loft.id]: { ...sourceViewport },
      }
    }
    setFloors(currentFloors => [...currentFloors, loft])
    setActiveFloorId(loft.id)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
    setWallTool(null)
    setIsRoofMode(false)
  }

  const updateActiveFloorSlabThickness = (slabThickness: number) => {
    const targetFloor = floors.find((floor) => floor.id === activeFloorId)

    if (!targetFloor || Math.abs(targetFloor.slabThickness - slabThickness) <= 0.000001) {
      return
    }

    const elevationDelta = slabThickness - targetFloor.slabThickness
    recordHistory()
    setFloors((currentFloors) =>
      currentFloors.map((floor) => {
        if (floor.id === targetFloor.id) {
          return {
            ...floor,
            slabThickness,
          }
        }

        return floor.elevation > targetFloor.elevation
          ? {
              ...floor,
              elevation: floor.elevation + elevationDelta,
            }
          : floor
      }),
    )
  }

  const updateActiveFloorCeilingMode = (ceilingMode: NonNullable<FloorLevel['ceilingMode']>) => {
    const target = floors.find(floor => floor.id === activeFloorId)
    if (!target || (target.ceilingMode ?? 'horizontal') === ceilingMode) return
    recordHistory()
    setFloors(current => current.map(floor => floor.id === activeFloorId ? { ...floor, ceilingMode } : floor))
    setSelectedSurface(null)
  }

  const deleteActiveFloor = () => {
    if (floors.length <= 1) {
      return
    }

    const activeFloorIndex = floors.findIndex((floor) => floor.id === activeFloorId)
    const floorToDelete =
      activeFloorIndex >= 0 ? floors[activeFloorIndex] : activeFloor
    const shouldDelete = window.confirm(`Delete ${floorToDelete.name}?`)

    if (!shouldDelete) {
      return
    }

    recordHistory()
    const fallbackFloor =
      floors[activeFloorIndex - 1] ??
      floors[activeFloorIndex + 1] ??
      floors.find((floor) => floor.id !== floorToDelete.id)

    if (!fallbackFloor) {
      return
    }

    setFloors((currentFloors) =>
      currentFloors.filter((floor) => floor.id !== floorToDelete.id),
    )
    setActiveFloorId(fallbackFloor.id)
    setSelectedFloorViewId(current => current === floorToDelete.id ? ALL_FLOORS_VIEW_ID : current)
    setThreeDNavigationFloorId(current => current === floorToDelete.id ? fallbackFloor.id : current)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
    setWallTool(null)
  }

  const addRoof = ({
    asymmetricSides,
    mountSide,
    ridgeOffset,
    ridgeHeight,
    ridgeHeightTargetRoofId,
    heightOffset,
    fitSupportingWalls,
    clipsGeometry,
    allowInteriorSkin,
    interiorSkinDepth,
    thickness,
    bayOutline,
    bayRoofStyle,
    bayRidgeLength,
    depth,
    floorId,
    overhangEnd,
    overhangPitchDegrees,
    soffitColor,
    overhangSide,
    overhangSideNegative,
    overhangSidePositive,
    pitchDegrees,
    position,
    ridgeEndChamfer,
    ridgeStartChamfer,
    rotation,
    supportDepth,
    supportPosition,
    supportWidth,
    type,
    width,
  }: RoofCreateOptions) => {
    const targetFloor = floors.find((floor) => floor.id === floorId)
    if (!targetFloor) return
    const bounds = getFloorWallBounds(targetFloor)
    const roofWidth = Math.max(0.3, width)
    const roofDepth = Math.max(depth ?? bounds?.depth ?? roofWidth, 0.3)
    const endOverhang = Math.max(0, overhangEnd ?? 0)
    const sideOverhang = Math.max(0, overhangSide ?? 0)
    const negativeSideOverhang = Math.max(
      0,
      overhangSideNegative ?? overhangSide ?? 0,
    )
    const positiveSideOverhang = Math.max(
      0,
      overhangSidePositive ?? overhangSide ?? 0,
    )
    const roofRotation = rotation ?? 0
    const roofPosition = position ?? bounds?.center ?? { x: 0, y: 0 }
    const supportWidthFallback =
      type === 'hip'
        ? undefined
        : Math.max(
            0.3,
            roofWidth -
              negativeSideOverhang -
              (type === 'lean-to' ? 0 : positiveSideOverhang),
          )
    const supportDepthFallback =
      type === 'hip'
        ? undefined
        : Math.max(0.3, roofDepth - endOverhang * 2)
    const fallbackSupportLocalOffset =
      type === 'hip'
        ? { x: 0, y: 0 }
        : {
            x:
              type === 'lean-to'
                ? negativeSideOverhang / 2
                : (negativeSideOverhang - positiveSideOverhang) / 2,
            y: 0,
          }
    const fallbackSupportOffset = rotatePlanOffset(
      fallbackSupportLocalOffset,
      roofRotation,
    )
    const supportPositionFallback =
      type === 'hip'
        ? undefined
        : {
            x: roofPosition.x + fallbackSupportOffset.x,
            y: roofPosition.y + fallbackSupportOffset.y,
          }
    const roof: RoofStructure = {
      asymmetricSides: type === 'up-and-over' && asymmetricSides === true,
      mountSide: type === 'up-and-over' ? mountSide : undefined,
      ridgeOffset: type === 'up-and-over' ? ridgeOffset : undefined,
      ridgeHeight: type === 'up-and-over' ? ridgeHeight : undefined,
      ridgeHeightTargetRoofId: type === 'up-and-over' ? ridgeHeightTargetRoofId : undefined,
      fitSupportingWalls: fitSupportingWalls === true,
      clipsGeometry: clipsGeometry !== false,
      allowInteriorSkin: allowInteriorSkin === true,
      interiorSkinDepth,
      thickness,
      bayOutline: type === 'bay' ? bayOutline : undefined,
      bayRoofStyle: type === 'bay' ? bayRoofStyle : undefined,
      bayRidgeLength: type === 'bay' ? bayRidgeLength : undefined,
      depth: roofDepth,
      heightOffset: heightOffset ?? 0,
      id: createId(),
      overhangEnd: endOverhang,
      overhangPitchDegrees,
      soffitColor,
      overhangSide: sideOverhang,
      overhangSideNegative: negativeSideOverhang,
      overhangSidePositive: positiveSideOverhang,
      pitchDegrees: Math.min(75, Math.max(1, pitchDegrees)),
      position: roofPosition,
      ridgeEndChamfer: type === 'up-and-over' ? ridgeEndChamfer : undefined,
      ridgeStartChamfer: type === 'up-and-over' ? ridgeStartChamfer : undefined,
      rotation: roofRotation,
      supportDepth: supportDepth ?? supportDepthFallback,
      supportPosition: supportPosition ?? supportPositionFallback,
      supportWidth: supportWidth ?? supportWidthFallback,
      type,
      width: roofWidth,
    }

    recordHistory()
    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        floor.id === targetFloor.id
          ? {
              ...floor,
              roofs: [...(floor.roofs ?? []), roof],
            }
          : floor,
      ),
    )
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(roof.id)
    setSelectedSurface({
      floorId: targetFloor.id,
      roofId: roof.id,
      type: 'roof',
    })
    setIsRoofMode(false)
    setRoofPlacementPreview(null)
    setWallTool(null)
  }

  const addModel = (modelId: string, placement?: ModelPlacement) => {
    const activeFloorForPlacement =
      floors.find((floor) => floor.id === (placement?.floorId ?? activeFloorId)) ?? floors[0]
    const baseModel = createPlacedModel({
      id: createId(),
      modelId,
      modelsById,
      walls: activeFloorForPlacement.walls,
    })
    const model = placement
      ? {
          ...baseModel,
          position: placement.position,
          height: placement.height ?? baseModel.height,
          roofAttachment: placement.roofAttachment,
          rotation: placement.rotation,
          wallAttachment: placement.wallAttachment,
          wallOpeningBottom: placement.wallOpeningBottom,
        }
      : baseModel
    const definition = modelsById.get(modelId)
    if (definition && ((definition.placement === 'wall-mounted' && !model.wallAttachment) ||
      !doorPlacementFits(definition, activeFloorForPlacement.walls, model.wallAttachment, model))) return
    recordHistory()
    const targetFloorId = activeFloorForPlacement.id

    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        floor.id === targetFloorId
          ? syncWallOpeningsForModelIfNeeded(
              {
                ...floor,
                models: [...(floor.models ?? []), model],
              },
              model.modelId,
            )
          : floor,
      ),
    )
    setActiveFloorId(targetFloorId)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedModelId(model.id)
    setSelectedModelIds([model.id])
    setSelectedRoofId(null)
    setWallTool(null)
    setPendingModelId(null)
    setIsModelSelectorOpen(false)
  }

  const chooseModel = (modelId: string) => {
    const definition = modelsById.get(modelId)
    const dormer = activeFloor.models.find(model => model.id === selectedModelId &&
      modelsById.get(model.modelId)?.roofMount === 'dormer')
    if (definition?.wallMount === 'window' && dormer) {
      addWindowToDormer(dormer.id, modelId)
      return
    }

    if (definition && (isOpeningModel(definition) || definition.placement === 'wall-mounted' || definition.placement === 'ceiling-mounted')) {
      setPendingModelId(modelId)
      setWallTool(null)
      setIsRoofMode(false)
      setIsModelSelectorOpen(false)
      return
    }

    addModel(modelId)
  }

  const pendingModel = pendingModelId
    ? modelsById.get(pendingModelId) ?? null
    : null

  const addWindowToDormer = (dormerId: string, modelId: string) => {
    const floor = floors.find(floor => floor.models.some(model => model.id === dormerId))
    if (!floor) return
    const existing = floor.models.find(model => model.dormerAttachment?.dormerId === dormerId)
    const window = existing ? updateDormerWindow(floor, existing, { modelId, materialOverrides: undefined, materialTextureTransforms: undefined }, modelsById)
      : createDormerWindow(floor, dormerId, modelId, createId(), modelsById)
    if (!window) return
    recordHistory()
    setFloors(current => current.map(candidate => candidate.id === floor.id
      ? syncDormerWindows({ ...candidate, models: [...candidate.models.filter(model => model.id !== window.id), window] }, modelsById) : candidate))
    setActiveFloorId(floor.id)
    setSelectedModelId(window.id)
    setSelectedModelIds([window.id])
    setSelectedSurface(null)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoofId(null)
    setPendingModelId(null)
    setIsModelSelectorOpen(false)
  }

  const updateRoof = (roofId: string, updates: Partial<RoofStructure>) => {
    recordHistory(`roof:${roofId}`)
    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        (floor.roofs ?? []).some((roof) => roof.id === roofId)
          ? (() => {
              const roofs = (floor.roofs ?? []).map((roof) =>
                roof.id === roofId ? { ...roof, ...updates, id: roof.id } : roof,
              )
              const updatedRoof = roofs.find((roof) => roof.id === roofId)
              return {
                ...floor,
                roofs,
                models: (floor.models ?? []).map((model) => {
                  if (!updatedRoof || model.roofAttachment?.roofId !== roofId) return model
                  const placement = getAttachedDormerPlacement(updatedRoof, model.roofAttachment)
                  return placement ? {
                    ...model,
                    position: placement.position,
                    rotation: placement.rotation,
                  } : model
                }),
              }
            })()
          : floor,
      ),
    )
  }

  const deleteRoof = (roofId: string) => {
    recordHistory()
    const attachedModelIds = new Set(
      floors.flatMap((floor) =>
        (floor.models ?? [])
          .filter((model) => model.roofAttachment?.roofId === roofId)
          .map((model) => model.id),
      ),
    )
    floors.flatMap(floor => floor.models).forEach(model => {
      if (model.dormerAttachment && attachedModelIds.has(model.dormerAttachment.dormerId)) attachedModelIds.add(model.id)
    })
    setFloors((currentFloors) =>
      currentFloors.map((floor) => ({
        ...floor,
        models: (floor.models ?? []).filter(
          (model) => !attachedModelIds.has(model.id),
        ),
        roofs: (floor.roofs ?? []).filter((roof) => roof.id !== roofId),
      })),
    )
    setSurfaceAssignments((currentAssignments) =>
      currentAssignments.filter(
        (assignment) =>
          !(assignment.target.type === 'roof' && assignment.target.roofId === roofId),
      ),
    )
    setSelectedRoofId((currentSelectedRoofId) =>
      currentSelectedRoofId === roofId ? null : currentSelectedRoofId,
    )
    setSelectedModelId((currentSelectedModelId) =>
      currentSelectedModelId && attachedModelIds.has(currentSelectedModelId)
        ? null
        : currentSelectedModelId,
    )
    setSelectedModelIds((currentSelectedModelIds) =>
      currentSelectedModelIds.filter((modelId) => !attachedModelIds.has(modelId)),
    )
    setSelectedSurface((currentSelectedSurface) =>
      currentSelectedSurface?.type === 'roof' &&
      currentSelectedSurface.roofId === roofId
        ? null
        : currentSelectedSurface,
    )
  }

  const refreshModelAssets = () => {
    clearFloorplanModelAssetCaches()
    clearThreeDModelAssetCaches()
    void refreshPortalCatalog()
    setModelAssetVersion((currentVersion) => currentVersion + 1)
    setSceneRevision((currentRevision) => currentRevision + 1)
  }

  const updateModel = (modelId: string, updates: Partial<PlacedModel>) => {
    if (['position', 'wallAttachment', 'scale', 'widthScale', 'modelId'].some(key => key in updates)) {
      const floor = floors.find(candidate => candidate.models.some(model => model.id === modelId))
      const model = floor?.models.find(candidate => candidate.id === modelId)
      const definition = model && modelsById.get(updates.modelId ?? model.modelId)
      if (floor && model && definition && isPlanDoor(definition)) {
        const constrained = constrainDoorUpdate(model, definition, floor.walls, updates)
        if (!constrained) return
        updates = constrained
      }
    }
    if (['position', 'rotation', 'scale', 'widthScale', 'depthScale', 'wallAttachment', 'wallOpeningBottom', 'height'].some(key => key in updates)) {
      modelTransformPreviewRef.current = { modelId, updates, committed: true }
    }
    if (typeof updates.lightEnabled === 'boolean') {
      localLightControl.setEnabled(modelId, updates.lightEnabled)
      startTransition(() => commitModelUpdate(modelId, updates))
    } else commitModelUpdate(modelId, updates)
  }
  const commitModelUpdate = (modelId: string, updates: Partial<PlacedModel>) => {
    recordHistory(`model:${modelId}`)
    setFloors((currentFloors) => {
      const nextFloors = currentFloors.map((floor) => {
        const modelOnFloor = (floor.models ?? []).find((model) => model.id === modelId)

        if (!modelOnFloor) {
          return floor
        }

        return syncWallOpeningsForModelIfNeeded(
          {
            ...floor,
            models: (floor.models ?? []).map((model) => {
              if (model.id !== modelId) {
                return model
              }

              const nextModel = { ...model, ...updates, id: model.id }
              const windowDesign = modelsById.get(model.modelId)?.windowDesign
              if (windowDesign && validateWindowDesign({ ...windowDesign,
                width: windowDesign.width * (nextModel.scale ?? 1) * (nextModel.widthScale ?? 1),
                height: windowDesign.height * (nextModel.scale ?? 1),
                depth: windowDesign.depth * (nextModel.scale ?? 1) * (nextModel.depthScale ?? 1) })) return model
              if (model.dormerAttachment) return updateDormerWindow(floor, model, updates, modelsById)
              const definition = modelsById.get(model.modelId)
              if (definition && nextModel.wallAttachment && isWallMountedDecoration(definition, nextModel)) {
                const wall = floor.walls.find(wall => wall.id === nextModel.wallAttachment?.wallId)
                const mount = wall && fitWallMountedObject(definition, wall, nextModel.wallAttachment, nextModel, floor.walls)
                return mount ? { ...nextModel, ...mount } : model
              }
              const wallMount =
                definition?.wallMount && updates.position && !updates.wallAttachment
                  ? getWallMountForPoint(updates.position, floor.walls)
                  : null

              return wallMount
                ? {
                    ...nextModel,
                    position: wallMount.position,
                    rotation: wallMount.rotation,
                    wallAttachment: wallMount.wallAttachment,
                  }
                : definition?.wallMount && updates.position
                  ? updates.wallAttachment
                    ? nextModel
                    : {
                        ...nextModel,
                        wallAttachment: undefined,
                      }
                  : nextModel
            }),
          },
          modelOnFloor.modelId,
        )
      })

      return nextFloors
    })
  }

  const updateWallGeometry = (
    wallId: string,
    updates: Partial<Pick<Wall, 'allowRoofClipHeight' | 'end' | 'height' | 'start' | 'thickness'>>,
  ) => {
    const targetFloor =
      floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
    const previousWall = targetFloor.walls.find((wall) => wall.id === wallId)

    if (!previousWall) {
      return
    }

    const nextWall = {
      ...previousWall,
      ...updates,
    }

    if (
      !wallHasValidGeometry(nextWall) ||
      !Number.isFinite(nextWall.thickness) ||
      nextWall.thickness <= 0 ||
      (updates.height !== undefined &&
        (!Number.isFinite(updates.height) ||
          updates.height <= 0 ||
          updates.height > MAX_WALL_HEIGHT_METERS)) ||
      wallDuplicatesExistingSegment(nextWall, targetFloor.walls, wallId) ||
      ((updates.start !== undefined || updates.end !== undefined) && wallEditCollapsesGeometry(
        targetFloor.walls,
        targetFloor.walls.map(wall => wall.id === wallId ? nextWall : wall),
      ))
    ) {
      console.warn('[HouseDesigner] Ignored invalid wall update.', {
        previousWall,
        updates,
      })
      return
    }

    recordHistory(`wall:${wallId}`)
    setFloors((currentFloors) =>
      currentFloors.map((floor) => {
        if (floor.id !== activeFloorId) {
          return floor
        }

        const previousWall = floor.walls.find((wall) => wall.id === wallId)

        if (!previousWall) {
          return floor
        }

        const nextWall = {
          ...previousWall,
          ...updates,
        }
        const walls = floor.walls.map((wall) => (wall.id === wallId ? nextWall : wall))
        const nextModels = updateWallAttachedModels(floor.models ?? [], nextWall, { walls, definitions: modelsById })
        const updatedFloor = syncWallOpenings(
          {
            ...floor,
            models: nextModels,
            walls,
          },
          modelsById,
        )
        return updates.start !== undefined || updates.end !== undefined || updates.thickness !== undefined
          ? preserveRoomMetadataAfterWallMove(floor, updatedFloor)
          : updatedFloor
      }),
    )
  }

  const updateWallGeometries = (
    wallUpdates: Array<{
      wallId: string
      updates: Pick<Wall, 'end' | 'start'>
    }>,
  ) => {
    if (wallUpdates.length === 0) {
      return
    }

    const targetFloor =
      floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
    const updatesByWallId = new Map(
      wallUpdates.map(({ wallId, updates }) => [wallId, updates]),
    )
    const nextWalls = targetFloor.walls.map((wall) => {
      const updates = updatesByWallId.get(wall.id)

      return updates ? { ...wall, ...updates } : wall
    })
    const invalidWall = nextWalls.find((wall) => {
      const wasUpdated = updatesByWallId.has(wall.id)

      return (
        wasUpdated &&
        (!wallHasValidGeometry(wall) ||
          !Number.isFinite(wall.thickness) ||
          wall.thickness <= 0 ||
          wallDuplicatesExistingSegment(wall, nextWalls, wall.id))
      )
    })

    if (invalidWall || wallEditCollapsesGeometry(targetFloor.walls, nextWalls)) {
      console.warn('[HouseDesigner] Ignored invalid wall batch update.', {
        invalidWall,
        wallUpdates,
      })
      return
    }

    recordHistory(
      wallUpdates.length === 1 ? `wall:${wallUpdates[0].wallId}` : undefined,
    )
    setFloors((currentFloors) =>
      currentFloors.map((floor) => {
        if (floor.id !== activeFloorId) {
          return floor
        }

        const nextWalls = floor.walls.map((wall) => {
          const updates = updatesByWallId.get(wall.id)

          return updates ? { ...wall, ...updates } : wall
        })
        const nextModels = nextWalls.reduce(
          (models, wall) =>
            updatesByWallId.has(wall.id)
              ? updateWallAttachedModels(models, wall, { walls: nextWalls, definitions: modelsById })
              : models,
          floor.models ?? [],
        )

        const updatedFloor = syncWallOpenings(
          {
            ...floor,
            models: nextModels,
            walls: nextWalls,
          },
          modelsById,
        )
        return preserveRoomMetadataAfterWallMove(floor, updatedFloor)
      }),
    )
  }

  const assignRoomFloorMaterial = (
    floorId: string,
    roomSignature: string,
    materialId: string | null,
    textureScale = 1,
    textureRotation = 0,
    customColor?: string,
  ) => {
    recordHistory()
    setSurfaceAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.filter(
        (assignment) =>
          !(
            assignment.target.type === 'room-floor' &&
            assignment.target.floorId === floorId &&
            assignment.target.roomSignature === roomSignature
          ),
      )

      if (!materialId) {
        return nextAssignments
      }

      return [
        ...nextAssignments,
        {
          customColor,
          id: createId(),
          materialId,
          target: {
            type: 'room-floor',
            floorId,
            roomSignature,
          },
          textureRotation,
          textureScale,
        },
      ]
    })
  }

  const assignRoomCeilingMaterial = (
    floorId: string,
    roomSignature: string,
    materialId: string | null,
    textureScale = 1,
    textureRotation = 0,
    customColor?: string,
  ) => {
    recordHistory()
    setSurfaceAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.filter(
        (assignment) =>
          !(
            assignment.target.type === 'ceiling' &&
            assignment.target.floorId === floorId &&
            assignment.target.roomSignature === roomSignature
          ),
      )

      if (!materialId) {
        return nextAssignments
      }

      return [
        ...nextAssignments,
        {
          customColor,
          id: createId(),
          materialId,
          target: {
            type: 'ceiling',
            floorId,
            roomSignature,
          },
          textureRotation,
          textureScale,
        },
      ]
    })
  }

  const assignFloorSlabEdgeMaterial = (
    floorId: string,
    materialId: string | null,
    textureScale = 1,
    textureRotation = 0,
    customColor?: string,
  ) => {
    recordHistory()
    setSurfaceAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.filter(
        (assignment) =>
          !(
            assignment.target.type === 'floor-slab-edge' &&
            assignment.target.floorId === floorId
          ),
      )

      if (!materialId) {
        return nextAssignments
      }

      return [
        ...nextAssignments,
        {
          customColor,
          id: createId(),
          materialId,
          target: {
            type: 'floor-slab-edge',
            floorId,
          },
          textureRotation,
          textureScale,
        },
      ]
    })
  }

  const assignPortalFloorMaterial = (
    floorId: string,
    wallId: string,
    openingId: string,
    materialId: string | null,
    textureScale = 1,
    textureRotation = 0,
    customColor?: string,
  ) => {
    recordHistory()
    setSurfaceAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.filter(
        (assignment) =>
          !(
            assignment.target.type === 'portal-floor' &&
            assignment.target.floorId === floorId &&
            assignment.target.wallId === wallId &&
            assignment.target.openingId === openingId
          ),
      )

      return materialId
        ? [
            ...nextAssignments,
            {
              customColor,
              id: createId(),
              materialId,
              target: {
                type: 'portal-floor' as const,
                floorId,
                openingId,
                wallId,
              },
              textureRotation,
              textureScale,
            },
          ]
        : nextAssignments
    })
  }

  const assignRoofMaterial = (
    target: Extract<SelectableSurface, { type: 'roof' }>,
    materialId: string | null,
    textureScale = 1,
    textureRotation = 0,
    customColor?: string,
  ) => {
    recordHistory()
    setSurfaceAssignments(currentAssignments => replaceRoofMaterialAssignment(
      currentAssignments,
      target,
      materialId ? { id: createId(), materialId, customColor, textureRotation, textureScale } : null,
    ))
  }

  const assignWallMaterials = (
    wallFaces: Array<{ side: -1 | 1; wallId: string }>,
    materialId: string | null,
    coverageHeight: number,
    side: SurfaceWallSide,
    textureScale = 1,
    textureRotation = 0,
    customColor?: string,
  ) => {
    recordHistory()
    setSurfaceAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.filter(
        (assignment) =>
          !(
            assignment.target.type === 'wall-face' &&
            wallFaces.some(
              (wallFace) =>
                assignment.target.type === 'wall-face' &&
                assignment.target.wallId === wallFace.wallId &&
                (side === 'both' ||
                  assignment.target.side === 'both' ||
                  assignment.target.side === wallFace.side),
            )
          ),
      )

      if (!materialId) {
        return nextAssignments
      }

      return [
        ...nextAssignments,
        ...wallFaces.map((wallFace) => ({
          coverageHeight,
          customColor,
          id: createId(),
          materialId,
          target: {
            type: 'wall-face',
            side: side === 'both' ? 'both' : wallFace.side,
            wallId: wallFace.wallId,
          },
          textureRotation,
          textureScale,
        } satisfies SurfaceMaterialAssignment)),
      ]
    })
  }
  const assignWallMaterial = (
    wallId: string,
    materialId: string | null,
    coverageHeight: number,
    side: SurfaceWallSide,
    textureScale = 1,
    textureRotation = 0,
    customColor?: string,
  ) =>
    assignWallMaterials(
      [{ side: side === 'both' ? 1 : side, wallId }],
      materialId,
      coverageHeight,
      side,
      textureScale,
      textureRotation,
      customColor,
    )

  const assignWallFragmentMaterials = (
    fragments: WallSurfaceFragmentReference[],
    materialId: string | null,
    coverageHeight: number,
    side: SurfaceWallSide,
    textureScale = 1,
    textureRotation = 0,
    customColor?: string,
  ) => {
    recordHistory()
    setSurfaceAssignments((currentAssignments) => {
      const fragmentSidesByKey = new Map(
        fragments.map((fragment) => [
          `${fragment.wallId}:${fragment.fragmentId}`,
          fragment.side,
        ]),
      )
      const nextAssignments = currentAssignments.filter(
        (assignment) => {
          if (assignment.target.type !== 'wall-surface-fragment') {
            return true
          }

          const fragmentSide = fragmentSidesByKey.get(
            `${assignment.target.wallId}:${assignment.target.fragmentId}`,
          )

          return !(
            fragmentSide &&
            (side === 'both' ||
              assignment.target.side === 'both' ||
              assignment.target.side === fragmentSide)
          )
        },
      )

      if (!materialId) {
        return nextAssignments
      }

      return [
        ...nextAssignments,
        ...fragments.map((fragment) => ({
          coverageHeight,
          customColor,
          id: createId(),
          materialId,
          target: {
            type: 'wall-surface-fragment',
            fragmentId: fragment.fragmentId,
            side: side === 'both' ? 'both' : fragment.side,
            wallId: fragment.wallId,
          },
          textureRotation,
          textureScale,
        } satisfies SurfaceMaterialAssignment)),
      ]
    })
  }

  const deleteModel = (modelId: string) => {
    recordHistory()
    const modelToDelete = floors
      .flatMap((floor) => floor.models ?? [])
      .find((model) => model.id === modelId)
    const modelCutsOpenings = Boolean(
      modelToDelete && modelsById.get(modelToDelete.modelId)?.wallMount,
    )

    setFloors((currentFloors) =>
      currentFloors.map((floor) => {
        const nextFloor = {
          ...floor,
          models: (floor.models ?? []).filter((model) => model.id !== modelId && model.dormerAttachment?.dormerId !== modelId),
        }

        if (!modelCutsOpenings) {
          return syncDormerWindows(nextFloor, modelsById)
        }

        return syncWallOpenings(
          {
            ...nextFloor,
            walls: floor.walls.map((wall) => ({
              ...wall,
              openings: (wall.openings ?? []).filter(
                (opening) =>
                  opening.id !== modelId && !opening.id.startsWith(`${modelId}:`),
              ),
            })),
          },
          modelsById,
        )
      }),
    )
    setSelectedModelId((currentSelectedModelId) =>
      currentSelectedModelId === modelId ? null : currentSelectedModelId,
    )
    setSelectedModelIds((currentSelectedModelIds) =>
      currentSelectedModelIds.filter((selectedId) => selectedId !== modelId),
    )
  }

  const saveProject = async (destination: 'last' | 'device' | 'cloud' | 'download' = 'last') => {
    if (isSavingProject || (destination === 'last' && !saveDestination)) return false
    const savingGeneration = projectGeneration.current
    let pickingDeviceFile = false
    try {
      setIsSavingProject(true)
      setLoadFeedback(null)
      const savingToDevice = destination === 'device' || (destination === 'last' && saveDestination?.kind === 'device')
      let deviceHandle = destination === 'last' && saveDestination?.kind === 'device' ? saveDestination.handle : undefined
      if (savingToDevice && !deviceHandle) {
        pickingDeviceFile = true
        deviceSavePickerRef.current = new AbortController()
        setLoadFeedback({ error: false, message: 'Choose a folder and filename in the Save As dialog…' })
        deviceHandle = await browserProjectSaveFile(projectFileName, deviceSavePickerRef.current.signal)
        deviceSavePickerRef.current = null
        pickingDeviceFile = false
        // A different model may have been opened while the dialog was pending.
        if (projectGeneration.current !== savingGeneration) return false
      }
      setLoadFeedback({ error: false, message: 'Saving model…' })
      const project = getCurrentSavedProject()
      if (savedIndirectLightingMatches(bakedLightingRef.current, indirectProjectKey(project)) &&
        normalizeDiffuseProbeResolution(bakedLightingRef.current?.settings.diffuseProbeResolution) === diffuseProbeResolution) {
        project.indirectLighting = bakedLightingRef.current
      }
      const contents = `${JSON.stringify(project, null, 2)}\n`
      let savedName = projectFileName
      const downloaded = destination === 'download'
      if (downloaded) {
        downloadProjectCopy(projectFileName, contents)
      } else if (savingToDevice && deviceHandle) {
        await writeProjectFile(deviceHandle, contents)
        savedName = deviceHandle.name
        if (projectGeneration.current === savingGeneration) {
          setSaveDestination({ kind: 'device', handle: deviceHandle })
          setProjectFileName(savedName)
        }
        await rememberRecentProject({ fileName: savedName, contents })
          .catch(error => console.warn('Could not update recent models after saving:', error))
      } else if (destination === 'cloud' || saveDestination?.kind === 'cloud') {
        const session = await workspaceClient.session()
        if (!session.user) {
          setCloudSaveRequested(true); setIsAccountOpen(true); setLoadFeedback(null)
          return false
        }
        const previous = destination === 'last' && saveDestination?.kind === 'cloud' ? saveDestination : null
        const name = previous?.name ?? window.prompt('Design name', projectFileName)
        if (!name?.trim()) { setLoadFeedback(null); return false }
        const fileName = /\.json$/i.test(name.trim()) ? name.trim() : `${name.trim()}.json`
        const file = new File([contents], fileName, { type: PROJECT_FILE_MIME_TYPE })
        const { asset } = previous ? await workspaceClient.replaceProject(previous.assetId, file) : await workspaceClient.upload(file, 'project')
        savedName = asset.name
        if (projectGeneration.current === savingGeneration) {
          setSaveDestination({ kind: 'cloud', assetId: asset.id, name: asset.name }); setProjectFileName(asset.name)
        }
      }
      // A download request cannot confirm that the browser wrote a file.
      if (!downloaded && projectGeneration.current === savingGeneration) lastCleanProjectRef.current = serializeSavedProject(project)
      setLoadFeedback({ error: false, message: downloaded
        ? `Download requested for ${savedName}. Check your browser’s downloads.` : `Saved ${savedName}.` })
      // Native writes are complete only after close(); downloads remain unconfirmed.
      return !downloaded
    } catch (error) {
      if (pickingDeviceFile && error instanceof Error && error.name === 'AbortError') {
        setLoadFeedback(null)
        return false
      }
      const message = error instanceof Error ? `The house design could not be saved: ${error.message}` : 'The house design could not be saved.'
      setLoadFeedback({ error: true, message: `${message} Your model is still open. You can use Download copy from the project menu.` })
      window.alert(message)
      return false
    } finally { deviceSavePickerRef.current = null; setIsSavingProject(false) }
  }

  const loadProject = async (readFile = readTextFromInputFile, recentId?: string) => {
    pendingLoadDecision.current?.(false)
    const request = ++projectLoadRequest.current
    setLoadFeedback({ error: false, message: 'Opening model…' })
    const selectedAt = editorPreparationTime()
    traceEditorPreparation('file-selection', projectGeneration.current + 1, { request })
    try {
      const loadedFile = await readFile()

      if (!loadedFile || request !== projectLoadRequest.current) {
        return
      }

      traceEditorPreparation('file-read', projectGeneration.current + 1, { request, elapsedMs: editorPreparationTime() - selectedAt, bytes: loadedFile.contents.length })
      const parseAt = editorPreparationTime()
      const parsedProject: unknown = JSON.parse(loadedFile.contents)
      traceEditorPreparation('json-parse', projectGeneration.current + 1, { request, cpuMs: editorPreparationTime() - parseAt })

      if (!isSavedProject(parsedProject)) {
        setLoadFeedback({ error: true, message: `${loadedFile.fileName} is not a supported House Designer project.` })
        window.alert('The selected house design could not be loaded.')
        return
      }

      if (Array.isArray(parsedProject.materialDefinitions)) {
        parsedProject.materialDefinitions.forEach(validateLocalMaterial)
      }
      if (serializeSavedProject(getCurrentSavedProject()) !== lastCleanProjectRef.current) {
        setLoadFeedback(null)
        const discard = await new Promise<boolean>(resolve => {
          const onDecision = (value: boolean) => {
            if (pendingLoadDecision.current !== onDecision) return
            pendingLoadDecision.current = null; setLoadConfirmation(null); resolve(value)
          }
          pendingLoadDecision.current = onDecision
          setLoadConfirmation({ fileName: loadedFile.fileName, onDecision })
        })
        if (!discard) return
      }
      if (request !== projectLoadRequest.current) return
      // Capture the current house's material values before an imported file
      // replaces definitions with matching library IDs.
      recordHistory()
      if (Array.isArray(parsedProject.materialDefinitions)) {
        registerLocalSurfaceMaterials(parsedProject.materialDefinitions)
        setAvailableMaterials([...surfaceMaterialCatalog])
        // Keep the portable house available even if local storage is full.
        for (const material of parsedProject.materialDefinitions) {
          void saveLocalMaterial(material).catch(error => console.warn('Could not copy material to the local library:', error))
        }
      }

      if (Array.isArray(parsedProject.modelDefinitions)) {
        registerRuntimeModels(mergeProjectModelDefinitions(portalModelsRef.current, parsedProject.modelDefinitions))
        setAvailableModels([...modelLibrary])
      }

      const loadedFloors = parsedProject.floors.map(normalizeLoadedFloor)

      localLightControl.restore(loadedFloors.flatMap(floor => floor.models.filter(model => modelsById.get(model.modelId)?.isLight)
        .map(model => [model.id, model.lightEnabled !== false] as const)))
      setFloors(loadedFloors)
      setProjectLoadRevision(++projectGeneration.current)
      traceEditorPreparation('project-replacement', projectGeneration.current, { request, floors: loadedFloors.length })
      setLoadedLightingCache(parsedProject.indirectLighting)
      bakedLightingRef.current = parsedProject.indirectLighting
      const loadedActiveFloorId = loadedFloors.some(
        (floor) => floor.id === parsedProject.activeFloorId,
      )
        ? parsedProject.activeFloorId
        : loadedFloors[0].id
      const restoredThreeDView = normalizeSavedThreeDViewState(
        parsedProject.threeDView,
        loadedFloors.map((floor) => floor.id),
        loadedActiveFloorId,
      )
      const loadedThreeDView = { ...restoredThreeDView, ambientLighting: restoredThreeDView.ambientLighting ?? ambientLightingPreferences(parsedProject.indirectLighting?.settings) }
      const loadedTwoDView = normalizeSavedTwoDViewState(
        parsedProject.twoDView,
        loadedFloors.map((floor) => floor.id),
      )

      setActiveFloorId(loadedActiveFloorId)
      setThreeDNavigationFloorId(loadedActiveFloorId)
      setSelectedFloorViewId(loadedThreeDView.floorViewId)
      setDiffuseProbeResolution(normalizeDiffuseProbeResolution(loadedThreeDView.diffuseProbeResolution ?? parsedProject.indirectLighting?.settings.diffuseProbeResolution))
      setExposureStops(normalizeExposureStops(loadedThreeDView.exposureStops))
      setAmbientLighting(loadedThreeDView.ambientLighting ?? ambientLightingPreferences(parsedProject.indirectLighting?.settings))
      restoreThreeDViewCameraState(loadedThreeDView.camera)
      restoreTwoDViewState(loadedTwoDView)
      setSunPosition(normalizeSunPosition(parsedProject.sunPosition))
      setSurfaceAssignments(
        Array.isArray(parsedProject.surfaceAssignments)
          ? parsedProject.surfaceAssignments
          : [],
      )
      setWallKind(parsedProject.wallKind)
      lastCleanProjectRef.current = serializeSavedProject({
        activeFloorId: loadedActiveFloorId,
        floors: loadedFloors,
        modelDefinitions: getSavedProjectModelDefinitions(loadedFloors),
        materialDefinitions: collectLocalMaterialDefinitions({ floors: loadedFloors, surfaceAssignments: parsedProject.surfaceAssignments, modelDefinitions: getSavedProjectModelDefinitions(loadedFloors) }, surfaceMaterialCatalog),
        sunPosition: normalizeSunPosition(parsedProject.sunPosition),
        surfaceAssignments: Array.isArray(parsedProject.surfaceAssignments)
          ? parsedProject.surfaceAssignments
          : [],
        threeDView: loadedThreeDView,
        twoDView: loadedTwoDView,
        wallKind: parsedProject.wallKind,
      })
      setSelectedWallId(null)
      setSelectedWallIds([])
      setSelectedRoomSignature(null)
      setSelectedModelId(null)
      setSelectedModelIds([])
      setSelectedRoofId(null)
      setWallTool(null)
      setProjectFileName(loadedFile.fileName)
      setSaveDestination({ kind: 'device' })
      setSceneRevision((currentRevision) => currentRevision + 1)
      void rememberRecentProject(loadedFile, recentId).catch(error => console.warn('Could not save recent models:', error))
    } catch (error) {
      if (request !== projectLoadRequest.current) return
      setLoadFeedback({ error: true, message: error instanceof Error ? `Could not open the model: ${error.message}` : 'The selected house design could not be loaded.' })
      window.alert(recentId && error instanceof Error ? error.message : 'The selected house design could not be loaded.')
    } finally {
      if (request === projectLoadRequest.current) setLoadFeedback(current => current?.error ? current : null)
    }
  }

  const newProject = async () => {
    const currentProject = getCurrentSavedProject()
    const hasUnsavedChanges =
      serializeSavedProject(currentProject) !== lastCleanProjectRef.current

    if (hasUnsavedChanges) {
      const saveFirst = window.confirm(
        'Save changes before starting a new project?',
      )

      if (saveFirst) {
        const saved = await saveProject(saveDestination ? 'last' : 'device')

        if (!saved) {
          return
        }
      } else if (
        !window.confirm('Discard unsaved changes and start a new project?')
      ) {
        return
      }
    }

    const project = normalizeSavedProject(createFallbackProject())

    projectLoadRequest.current++
    pendingLoadDecision.current?.(false)
    setLoadFeedback(null)
    localLightControl.restore([])
    setFloors(project.floors)
    setProjectLoadRevision(++projectGeneration.current)
    traceEditorPreparation('new-project', projectGeneration.current)
    setLoadedLightingCache(undefined)
    bakedLightingRef.current = undefined
    setActiveFloorId(project.activeFloorId)
    setThreeDNavigationFloorId(project.activeFloorId)
    setSelectedFloorViewId(project.threeDView.floorViewId)
    setDiffuseProbeResolution(normalizeDiffuseProbeResolution(project.threeDView.diffuseProbeResolution))
    setExposureStops(normalizeExposureStops(project.threeDView.exposureStops))
    setAmbientLighting(project.threeDView.ambientLighting ?? ambientLightingPreferences())
    restoreThreeDViewCameraState(project.threeDView.camera)
    restoreTwoDViewState(project.twoDView)
    setSunPosition(project.sunPosition)
    setSurfaceAssignments(project.surfaceAssignments)
    setWallKind(project.wallKind)
    setNewWallHeight(DEFAULT_ROOM_HEIGHT)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
    setSelectedSurface(null)
    setClipboardItem(null)
    setWallTool(null)
    setProjectFileName(PROJECT_FILE_NAME)
    setSaveDestination(null)
    historyPastRef.current = []
    historyFutureRef.current = []
    historyCoalesceRef.current = null
    updateHistoryAvailability()
    lastCleanProjectRef.current = serializeSavedProject(project)
    setSceneRevision((currentRevision) => currentRevision + 1)
  }

  const activeFloor =
    floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
  const contextFloor = getSelectionContextFloor(floors, activeFloor, {
    modelId: selectedModelId, wallId: selectedWallId, roofId: selectedRoofId, surface: selectedSurface,
  })
  const selectedWall = floors
    .flatMap((floor) => floor.walls)
    .find((wall) => wall.id === selectedWallId)
  const selectedModel: SelectedModel | null = selectedModelId
    ? (() => {
        const model = contextFloor.models.find(
          (candidateModel) => candidateModel.id === selectedModelId,
        )
        const definition = model ? modelsById.get(model.modelId) : null

        return model && definition ? { definition, model } : null
      })()
    : null
  const contextDetectedRooms = useMemo(
    () => buildWallTopology(contextFloor.walls, { floorFootprints: contextFloor.floorFootprints }).rooms,
    [contextFloor.walls, contextFloor.floorFootprints, WALL_TOPOLOGY_VERSION],
  )
  const addLoftFloorDisabledReason = useMemo(
    () => getAddLoftFloorDisabledReason(floors, activeFloorId),
    [floors, activeFloorId],
  )
  const selectedRoom: SelectedRoom | null = selectedRoomSignature
    ? (() => {
        const detectedRoom = contextDetectedRooms.find(
          (room) => room.signature === selectedRoomSignature,
        )
        const metadata = (contextFloor.rooms ?? []).find(
          (room) => room.signature === selectedRoomSignature,
        )

        return detectedRoom && metadata ? { detectedRoom, metadata } : null
      })()
    : null
  const selectedSurfaceWall =
    selectedSurface?.type === 'wall-face' ||
    selectedSurface?.type === 'wall-surface-fragment'
    ? contextFloor.walls.find((wall) => wall.id === selectedSurface.wallId) ?? null
    : null
  const applyMaterialToSelectedSurface = ({
    coverageHeight,
    customColor,
    materialId,
    textureRotation,
    textureScale,
    wallMode,
    wallSide,
  }: {
    coverageHeight?: number
    customColor?: string
    materialId: string
    textureRotation: number
    textureScale: number
    wallMode?: 'full' | 'lower'
    wallSide?: SurfaceWallSide
  }) => {
    if (!selectedSurface) {
      return
    }

    if (selectedSurface.type === 'room-floor') {
      assignRoomFloorMaterial(
        selectedSurface.floorId,
        selectedSurface.roomSignature,
        materialId,
        textureScale,
        textureRotation,
        customColor,
      )
      return
    }

    if (selectedSurface.type === 'ceiling') {
      assignRoomCeilingMaterial(
        selectedSurface.floorId,
        selectedSurface.roomSignature,
        materialId,
        textureScale,
        textureRotation,
        customColor,
      )
      return
    }

    if (selectedSurface.type === 'floor-slab-edge') {
      assignFloorSlabEdgeMaterial(
        selectedSurface.floorId,
        materialId,
        textureScale,
        textureRotation,
        customColor,
      )
      return
    }

    if (selectedSurface.type === 'portal-floor') {
      assignPortalFloorMaterial(
        selectedSurface.floorId,
        selectedSurface.wallId,
        selectedSurface.openingId,
        materialId,
        textureScale,
        textureRotation,
        customColor,
      )
      return
    }

    if (selectedSurface.type === 'roof') {
      assignRoofMaterial(
        selectedSurface,
        materialId,
        textureScale,
        textureRotation,
        customColor,
      )
      return
    }

    const wall = contextFloor.walls.find(
      (candidateWall) => candidateWall.id === selectedSurface.wallId,
    )

    if (selectedSurface.type === 'wall-surface-fragment') {
      assignWallFragmentMaterials(
        selectedSurface.fragments ?? [selectedSurface],
        materialId,
        wallMode === 'lower' ? coverageHeight ?? 1.2 : wall?.height ?? contextFloor.roomHeight,
        wallSide ?? 'both',
        textureScale,
        textureRotation,
        customColor,
      )
      return
    }

    if (selectedSurface.wallFaces && selectedSurface.wallFaces.length > 0) {
      assignWallMaterials(
        selectedSurface.wallFaces,
        materialId,
        wallMode === 'lower' ? coverageHeight ?? 1.2 : wall?.height ?? contextFloor.roomHeight,
        wallSide ?? selectedSurface.side,
        textureScale,
        textureRotation,
        customColor,
      )
      return
    }

    assignWallMaterial(
      selectedSurface.wallId,
      materialId,
      wallMode === 'lower' ? coverageHeight ?? 1.2 : wall?.height ?? contextFloor.roomHeight,
      wallSide ?? 'both',
      textureScale,
      textureRotation,
      customColor,
    )
  }
  const totalWallCount = floors.reduce(
    (wallCount, floor) => wallCount + floor.walls.length,
    0,
  )
  const canUndo = historyAvailability.canUndo
  const canRedo = historyAvailability.canRedo
  const canCopy = Boolean(selectedModel || selectedWall)
  const canPaste = Boolean(clipboardItem)

  const getModelPlanHorizontalBounds = (
    model: PlacedModel,
    definition: ModelDefinition,
  ) => {
    const scale = model.scale ?? 1
    const width = definition.width * scale * (model.widthScale ?? 1)
    const depth = definition.depth * scale * (model.depthScale ?? 1)
    const rotation = model.rotation ?? 0

    const halfWidth = Math.abs(Math.cos(rotation)) * width / 2 + Math.abs(Math.sin(rotation)) * depth / 2
    const originToCentre = model.kitchenUnitOrigin === 'back' ? depth / 2 * (model.flipped ? -1 : 1) : 0
    const centreX = model.position.x - Math.sin(rotation) * originToCentre
    return { left: centreX - halfWidth, right: centreX + halfWidth }
  }

  const getModelVerticalBounds = (
    model: PlacedModel,
    definition: ModelDefinition,
  ) => {
    const scale = model.scale ?? 1
    const height = definition.height * scale
    const bottom =
      definition.wallMount === 'window'
        ? model.wallOpeningBottom ?? 0.9
        : definition.isLight
          ? model.height ?? definition.height
          : 0

    return {
      bottom,
      top: bottom + height,
    }
  }

  const alignSelectedModels = (direction: ModelAlignDirection) => {
    if (selectedModelIds.length < 2) {
      return
    }

    recordHistory(`align:${direction}`)
    setFloors((currentFloors) =>
      currentFloors.map((floor) => {
        if (floor.id !== activeFloor.id) {
          return floor
        }

        const models = floor.models ?? []
        const selectedModels = selectedModelIds
          .map((modelId) => models.find((model) => model.id === modelId) ?? null)
          .filter((model): model is PlacedModel => Boolean(model))
        const referenceModel = selectedModels[0]
        const referenceDefinition = referenceModel
          ? modelsById.get(referenceModel.modelId)
          : undefined

        if (!referenceModel || !referenceDefinition) {
          return floor
        }

        const referenceBounds = getModelPlanHorizontalBounds(
          referenceModel,
          referenceDefinition,
        )
        const referenceVerticalBounds = getModelVerticalBounds(
          referenceModel,
          referenceDefinition,
        )
        const selectedIdSet = new Set(selectedModelIds.slice(1))
        const nextModels = models.map((model) => {
          if (!selectedIdSet.has(model.id)) {
            return model
          }

          const definition = modelsById.get(model.modelId)

          if (!definition) {
            return model
          }

          if (direction === 'left' || direction === 'right') {
            const currentEdge = getModelPlanHorizontalBounds(model, definition)[direction]
            const targetEdge = referenceBounds[direction]
            const deltaX = targetEdge - currentEdge

            if (Math.abs(deltaX) <= 0.000001) {
              return model
            }

            if (model.wallAttachment) {
              const wall = floor.walls.find(
                (candidateWall) =>
                  candidateWall.id === model.wallAttachment?.wallId,
              )
              const wallLength = wall
                ? Math.hypot(
                    wall.end.x - wall.start.x,
                    wall.end.y - wall.start.y,
                  )
                : 0
              const wallUnitX = wallLength > 0 && wall
                ? (wall.end.x - wall.start.x) / wallLength
                : 0

              if (!wall || Math.abs(wallUnitX) <= 0.000001) {
                return model
              }

              const requested = model.wallAttachment.offset + deltaX / wallUnitX
              const nextOffset = isPlanDoor(definition)
                ? getDoorWallOffset(wall, floor.walls, definition, requested, { model, fromOffset: model.wallAttachment.offset })
                : Math.max(
                0,
                Math.min(wallLength, requested),
              )
              if (nextOffset === null) return model
              const nextPosition = {
                x: wall.start.x + (wall.end.x - wall.start.x) * (nextOffset / wallLength),
                y: wall.start.y + (wall.end.y - wall.start.y) * (nextOffset / wallLength),
              }

              return {
                ...model,
                position: nextPosition,
                wallAttachment: {
                  ...model.wallAttachment,
                  offset: nextOffset,
                },
              }
            }

            return {
              ...model,
              position: {
                ...model.position,
                x: model.position.x + deltaX,
              },
            }
          }

          const verticalBounds = getModelVerticalBounds(model, definition)
          const targetBottom =
            direction === 'bottom'
              ? referenceVerticalBounds.bottom
              : referenceVerticalBounds.top -
                (verticalBounds.top - verticalBounds.bottom)

          if (definition.wallMount === 'window') {
            return {
              ...model,
              wallOpeningBottom: Math.max(0, targetBottom),
            }
          }

          if (definition.isLight) {
            return {
              ...model,
              height: Math.max(0.05, targetBottom),
            }
          }

          return model
        })

        return syncWallOpenings(
          {
            ...floor,
            models: nextModels,
          },
          modelsById,
        )
      }),
    )
  }

  const copySelection = () => {
    if (selectedModel) {
      setClipboardItem({
        type: 'model',
        model: structuredClone(selectedModel.model),
      })
      return
    }

    if (selectedWall) {
      setClipboardItem({
        type: 'wall',
        wall: structuredClone({
          ...selectedWall,
          openings: undefined,
        }),
      })
    }
  }

  const cutSelection = () => {
    if (!selectedModel && !selectedWall) {
      return
    }

    copySelection()

    if (selectedModel) {
      deleteModel(selectedModel.model.id)
    } else if (selectedWall) {
      deleteWall(selectedWall.id)
    }
  }

  const pasteClipboard = () => {
    if (!clipboardItem) {
      return
    }

    if (clipboardItem.type === 'wall') {
      const id = createId()
      const wallToPaste: Wall = {
        ...clipboardItem.wall,
        id,
        start: {
          x: clipboardItem.wall.start.x + 0.35,
          y: clipboardItem.wall.start.y + 0.35,
        },
        end: {
          x: clipboardItem.wall.end.x + 0.35,
          y: clipboardItem.wall.end.y + 0.35,
        },
        openings: undefined,
      }
      if (wallEditCollapsesGeometry(activeFloor.walls, [...activeFloor.walls, wallToPaste])) return

      recordHistory()
      setFloors((currentFloors) =>
        currentFloors.map((floor) =>
          floor.id === activeFloorId
            ? {
                ...floor,
                walls: [...floor.walls, wallToPaste],
              }
            : floor,
        ),
      )
      setSelectedWallId(id)
      setSelectedWallIds([id])
      setSelectedModelId(null)
      setSelectedModelIds([])
      setSelectedRoofId(null)
      setSelectedRoomSignature(null)
      setWallTool(null)
      return
    }

    const id = createId()
    const definition = modelsById.get(clipboardItem.model.modelId)
    const pastedPosition = {
      x: clipboardItem.model.position.x + 0.35,
      y: clipboardItem.model.position.y + 0.35,
    }
    const wallObject = definition && isWallMountedDecoration(definition, clipboardItem.model)
    const originalAttachment = clipboardItem.model.wallAttachment
    const originalWall = activeFloor.walls.find(wall => wall.id === originalAttachment?.wallId)
    const proposedWallMount = wallObject ? getWallMountedObjectPlacement(definition, activeFloor.walls, pastedPosition, clipboardItem.model) ??
      (originalWall && originalAttachment ? fitWallMountedObject(definition, originalWall,
        { ...originalAttachment, offset: originalAttachment.offset + 0.35 }, clipboardItem.model, activeFloor.walls) : null)
      : null
    const wallMount: Omit<ModelPlacement, 'floorId'> | null = wallObject
      ? resolveWallCabinetPlacement(definition, activeFloor, modelsById, proposedWallMount, { ...clipboardItem.model, id }) ??
        resolveWallCabinetPlacement(definition, activeFloor, modelsById, proposedWallMount, { ...clipboardItem.model, id },
          { snap: 'horizontal', snapDistance: Infinity })
      : definition?.wallMount ? getWallMountForPoint(pastedPosition, activeFloor.walls) : null
    if (wallObject && !wallMount) return
    const dormerPlacement = definition?.roofMount === 'dormer'
      ? findDormerPlacement(
          activeFloor.roofs ?? [],
          pastedPosition,
          definition.width,
          definition.depth,
        )?.placement ?? null
      : null
    const modelToPaste: PlacedModel = {
      ...clipboardItem.model,
      id,
      height: wallMount?.height ?? clipboardItem.model.height,
      position: dormerPlacement?.position ?? wallMount?.position ?? pastedPosition,
      roofAttachment: dormerPlacement?.roofAttachment,
      rotation:
        dormerPlacement?.rotation ?? wallMount?.rotation ?? clipboardItem.model.rotation,
      wallAttachment: wallMount?.wallAttachment,
    }
    if (definition && !doorPlacementFits(definition, activeFloor.walls, modelToPaste.wallAttachment, modelToPaste)) return
    recordHistory()

    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        floor.id === activeFloorId
          ? syncWallOpeningsForModelIfNeeded(
              {
                ...floor,
                models: [...(floor.models ?? []), modelToPaste],
              },
              modelToPaste.modelId,
            )
          : floor,
      ),
    )
    setSelectedModelId(id)
    setSelectedModelIds([id])
    setSelectedRoofId(null)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
    setWallTool(null)
  }

  const selectModel = (modelId: string | null, additive = false) => {
    if (!modelId) {
      setSelectedModelId(null)
      setSelectedModelIds([])
      setSelectedRoofId(null)
      return
    }

    if (additive) {
      setSelectedModelIds((currentSelectedIds) => {
        const nextSelectedIds = currentSelectedIds.includes(modelId)
          ? currentSelectedIds.filter((selectedId) => selectedId !== modelId)
          : [...currentSelectedIds, modelId]

        setSelectedModelId(nextSelectedIds.at(-1) ?? null)
        return nextSelectedIds
      })
    } else {
      const shouldDeselect =
        selectedModelId === modelId &&
        selectedModelIds.length === 1 &&
        selectedModelIds[0] === modelId

      setSelectedModelId(shouldDeselect ? null : modelId)
      setSelectedModelIds(shouldDeselect ? [] : [modelId])
    }

    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
    setSelectedRoofId(null)
    setWallTool(null)
  }

  const selectModelFromThreeD = (modelId: string, _floorId: string, keepSelected = false) => {
    // Canvas reconciliation can still be showing the preceding callback when
    // a second click arrives. Toggle against the current selection queue, not
    // the selection captured by that older rendered scene.
    setSelectedModelIds(currentSelectedIds => {
      if (keepSelected && currentSelectedIds.at(-1) === modelId) return currentSelectedIds
      const shouldDeselect = !keepSelected && currentSelectedIds.length === 1 && currentSelectedIds[0] === modelId
      setSelectedModelId(shouldDeselect ? null : modelId)
      return shouldDeselect ? [] : [modelId]
    })
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
    setSelectedRoofId(null)
    setWallTool(null)
  }

  const selectRoofFromThreeD = (roofId: string, floorId: string, keepSelected = false) => {
    const shouldDeselect = !keepSelected && selectedRoofId === roofId && selectedSurface?.type === 'roof' && !selectedSurface.part

    setSelectedRoofId(shouldDeselect ? null : roofId)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(
      shouldDeselect
        ? null
        : {
            floorId,
            roofId,
            type: 'roof',
          },
    )
    setWallTool(null)
  }

  const selectRoofFromFloorplan = (roofId: string | null) => {
    const roofFloor = roofId ? floors.find(floor => floor.roofs?.some(roof => roof.id === roofId)) : undefined
    setSelectedRoofId(roofId)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(
      roofId && roofFloor
        ? {
            floorId: roofFloor.id,
            roofId,
            type: 'roof',
          }
        : null,
    )
    setWallTool(null)
  }

  const clearThreeDSelection = () => {
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
    setWallTool(null)
  }

  const selectEditingFloor = (floorId: string) => {
    setActiveFloorId(floorId)
    clearThreeDSelection()
    setRoofPlacementPreview(null)
  }

  const assistantProjectId = `${projectLoadRevision}:${initialProject.floors[0].id}`
  const assistantRevision = `${projectLoadRevision}:${historyVersion}:${modelAssetVersion}:${internalWallThickness}`
  const currentAssistantPreview = assistantPreview?.floors === floors && assistantPreview.revision === assistantRevision ? assistantPreview : null
  const modelPreviewFloors = useMemo(() => {
    if (currentAssistantPreview?.proposal.method !== 'model-variants') return floors
    const replacements = new Map(currentAssistantPreview.previewFloors.map(floor => [floor.id, floor]))
    return floors.map(floor => replacements.get(floor.id) ?? floor)
  }, [currentAssistantPreview, floors])
  const captureAssistantSource = () => makeSceneSource({
    floors, models: modelsById, projectId: assistantProjectId, revision: assistantRevision,
    wallMaterials: surfaceAssignments.flatMap(assignment => assignment.target.type === 'wall-face' || assignment.target.type === 'wall-surface-fragment'
      ? [{ wallId: assignment.target.wallId, materialId: assignment.materialId }] : []),
    selection: { floorId: activeFloor.id, roomSignature: selectedRoomSignature, wallIds: selectedWallIds,
      modelIds: selectedModelIds, roofId: selectedRoofId }, partitionThickness: internalWallThickness,
  })

  const previewAssistantLayout = (option: DesignOption | null, sourceFloors: FloorLevel[], revision: string) => {
    if (sourceFloors !== floors || currentFloorsRef.current !== floors || projectGeneration.current !== projectLoadRevision || revision !== assistantRevision) return
    if (!option) { setAssistantPreview(null); return }
    const { proposal, edits } = option
    const nextFloors = materializeProposalFloors(floors, proposal.floorId, edits)
    if (!nextFloors) return
    const previewFloors = nextFloors.filter((floor, index) => floor !== floors[index])
    setAssistantPreview({ proposal, previewFloors, floors, revision, stair: edits.stair, overlays: edits.overlays })
    if (activeFloorId !== proposal.floorId) selectEditingFloor(proposal.floorId)
    if (isRoofMode) setIsRoofMode(false)
  }

  const applyAssistantLayout = (proposal: DesignProposal, edits: FloorEdits, sourceFloors: FloorLevel[]) => {
    if (sourceFloors !== floors || currentFloorsRef.current !== floors || projectGeneration.current !== projectLoadRevision ||
      proposal.projectId !== assistantProjectId || proposal.sourceRevision !== assistantRevision) return false
    const nextFloors = materializeProposalFloors(floors, proposal.floorId, edits)
    if (!nextFloors) return false
    const removedWalls = new Set([edits, ...(edits.additionalFloors ?? []).map(item => item.edits)].flatMap(change => change.removedWallIds ?? []))
    const removedOpenings = new Map(nextFloors.flatMap((next, index) => {
      if (next === floors[index]) return []
      const kept = new Set(next.walls.flatMap(wall => wall.openings?.map(opening => opening.id) ?? []))
      const removed = floors[index].walls.flatMap(wall => wall.openings?.filter(opening => !kept.has(opening.id)).map(opening => opening.id) ?? [])
      return removed.length ? [[next.id, new Set(removed)] as const] : []
    }))
    recordHistory()
    if (edits.stair) {
      registerStairModels([edits.stair.definition])
      setAvailableModels([...modelLibrary])
      setSceneRevision(value => value + 1)
    }
    setFloors(nextFloors)
    if (removedWalls.size || removedOpenings.size) setSurfaceAssignments(assignments => assignments.filter(({ target: surface }) =>
      !('wallId' in surface && removedWalls.has(surface.wallId)) &&
      !(surface.type === 'portal-floor' && removedOpenings.get(surface.floorId)?.has(surface.openingId))))
    if (!edits.additionalFloors?.some(floor => floor.floorId === activeFloorId)) selectEditingFloor(proposal.floorId)
    setAssistantPreview(null)
    setIsRoofMode(false)
    setPendingModelId(null)
    return true
  }

  const selectSurfaceFromThreeD = (surface: SelectableSurface, keepSelected = false) => {
    if (selectableSurfacesMatch(selectedSurface, surface)) {
      if (!keepSelected) clearThreeDSelection()
      return
    }

    setSelectedSurface(surface)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(surface.type === 'roof' ? surface.roofId : null)
    setSelectedWallIds([])

    if (surface.type === 'wall-face') {
      setSelectedWallId(surface.wallId)
      setSelectedWallIds([surface.wallId])
      setSelectedRoomSignature(null)
      return
    }

    if (surface.type === 'wall-surface-fragment') {
      setSelectedWallId(null)
      setSelectedWallIds([])
      setSelectedRoomSignature(null)
      return
    }

    setSelectedWallId(null)
    setSelectedRoomSignature(
      surface.type === 'floor-slab-edge' ||
        surface.type === 'portal-floor' ||
        surface.type === 'roof'
        ? null
        : surface.roomSignature,
    )
  }

  const selectWall = (wallId: string | null, additive = false) => {
    if (!wallId) {
      setSelectedWallId(null)
      setSelectedWallIds([])
      setSelectedRoofId(null)
      setSelectedSurface(null)
      return
    }

    if (additive) {
      setSelectedWallIds((currentSelectedIds) => {
        const nextSelectedIds = currentSelectedIds.includes(wallId)
          ? currentSelectedIds.filter((selectedId) => selectedId !== wallId)
          : [...currentSelectedIds, wallId]

        setSelectedWallId(nextSelectedIds.at(-1) ?? null)
        return nextSelectedIds
      })
    } else {
      setSelectedWallId(wallId)
      setSelectedWallIds([wallId])
    }

    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedRoofId(null)
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
    setWallTool(null)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isMaterialEditorOpen || isAccountOpen || loadConfirmation ||
          isTextEntryElement(event.target) || event.target instanceof Element && event.target.closest('.design-assistant')) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === 'escape' && pendingModelId) {
        event.preventDefault()
        setPendingModelId(null)
        return
      }

      if (!(event.ctrlKey || event.metaKey)) {
        return
      }

      if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        redo()
        return
      }

      if (key === 'z') {
        event.preventDefault()
        undo()
        return
      }

      if (key === 'y') {
        event.preventDefault()
        redo()
        return
      }

      if (key === 'c') {
        if (window.getSelection()?.isCollapsed === false) return
        event.preventDefault()
        copySelection()
        return
      }

      if (key === 'x') {
        event.preventDefault()
        cutSelection()
        return
      }

      if (key === 'v') {
        event.preventDefault()
        pasteClipboard()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
          isMaterialEditorOpen,
          isAccountOpen,
          loadConfirmation,
          activeFloor,
          activeFloorId,
          clipboardItem,
          floors,
          selectedFloorViewId,
          selectedModel,
          selectedModelId,
          selectedModelIds,
          pendingModelId,
          selectedRoomSignature,
          selectedWall,
          selectedWallId,
          selectedWallIds,
          wallKind,
          historyVersion,
  ])

  return (
    <main className="app-shell">
      {loadConfirmation && <ProjectLoadConfirmation {...loadConfirmation} />}
      {loadFeedback && <div className="project-load-feedback" role={loadFeedback.error ? 'alert' : 'status'}>
        <span>{loadFeedback.message}</span>
        {isSavingProject && deviceSavePickerRef.current && <button type="button" onClick={() => deviceSavePickerRef.current?.abort()}>Cancel save</button>}
        <button type="button" onClick={() => setLoadFeedback(null)}>Dismiss</button>
      </div>}
      {isAccountOpen && <AccountDialog onClose={() => { setIsAccountOpen(false); setCloudSaveRequested(false) }}
        onSignedIn={cloudSaveRequested ? () => { setIsAccountOpen(false); setCloudSaveRequested(false); void saveProject('cloud') } : undefined} />}
      {isMaterialEditorOpen ? <MaterialEditor materials={availableMaterials}
        onClose={() => setIsMaterialEditorOpen(false)}
        onSave={async material => {
          let storageError: unknown
          try { await saveLocalMaterial(material) } catch (error) { storageError = error }
          const used = collectLocalMaterialDefinitions({ floors, surfaceAssignments, modelDefinitions: getSavedProjectModelDefinitions(floors) }, [material]).length > 0
          const previousMaterial = surfaceMaterialsById.get(material.id)
          const appearanceChanged = used && previousMaterial !== material &&
            indirectContentKey(indirectAssetIdentity(previousMaterial)) !== indirectContentKey(indirectAssetIdentity(material))
          if (used) recordHistory()
          registerLocalSurfaceMaterials([material])
          setAvailableMaterials([...surfaceMaterialCatalog])
          if (appearanceChanged) {
            setSceneRevision(revision => revision + 1)
            bakedLightingRef.current = undefined
            setLoadedLightingCache(undefined)
          }
          if (storageError) throw storageError
        }} /> : null}
      {isManufacturerPortalOpen ? (
        <ManufacturerPortal
          onCatalogChanged={refreshPortalCatalog}
          onClose={() => setIsManufacturerPortalOpen(false)}
        />
      ) : null}
      <LeftToolRail
        activeFloorId={activeFloor.id}
        floors={floors}
        internalWallThickness={internalWallThickness}
        isAddingWall={isAddingWall}
        isSplittingWall={isSplittingWall}
        isRoofMode={isRoofMode}
        materials={availableMaterials}
        openPanel={isAddingWall && railPanel === 'wall' ? null : railPanel}
        onOpenMaterialEditor={() => setIsMaterialEditorOpen(true)}
        onPanelChange={setRailPanel}
        selectedSurface={selectedSurface}
        selectedModelCount={selectedModelIds.length}
        selectedWallHeight={selectedSurfaceWall?.height ?? null}
        wallCount={totalWallCount}
        wallHeight={Math.min(newWallHeight, MAX_WALL_HEIGHT_METERS)}
        wallKind={wallKind}
        onAddEmptyFloor={() => addFloor({ copyExternalWalls: false })}
        onAddFloor={() => addFloor({ copyExternalWalls: true })}
        onAddCeilingLoftFloor={addCeilingLoftFloor}
        addLoftFloorDisabledReason={addLoftFloorDisabledReason}
        onAlignModels={alignSelectedModels}
        onApplyMaterial={applyMaterialToSelectedSurface}
        onDeleteFloor={deleteActiveFloor}
        onOpenModelSelector={(section) => {
          setModelSelectorLocation({ root: 'public', section })
          setIsModelSelectorOpen(true)
        }}
        onRoofModeChange={(nextIsRoofMode) => {
          setIsRoofMode(nextIsRoofMode)

          if (nextIsRoofMode) {
            setWallTool(null)
            setPendingModelId(null)
          }
        }}
        onSelectFloor={selectEditingFloor}
        onSlabThicknessChange={updateActiveFloorSlabThickness}
        onCeilingModeChange={updateActiveFloorCeilingMode}
        onToggleAddWall={() => {
          setIsRoofMode(false)
          setWallTool(value => value === 'add' ? null : 'add')
        }}
        onToggleSplitWall={() => {
          setIsRoofMode(false)
          setPendingModelId(null)
          setWallTool(value => value === 'split' ? null : 'split')
        }}
        onInternalWallThicknessChange={setInternalWallThickness}
        onWallHeightChange={setNewWallHeight}
        onWallKindChange={(nextWallKind) => {
          recordHistory()
          setWallKind(nextWallKind)
        }}
      />

      <section
        ref={editorGridRef}
        className={isResizingSplit ? 'editor-grid resizing' : 'editor-grid'}
        aria-label="House floorplan editor"
        style={{
          '--split-left': `${splitPercent}fr`,
          '--split-right': `${100 - splitPercent}fr`,
        } as CSSProperties}
      >
        <FloorplanCanvas
          assistantPreview={currentAssistantPreview}
          assistantPanel={<DesignAssistant key={projectLoadRevision} open={assistantOpen} onClose={() => setAssistantOpen(false)}
            floors={floors} revision={assistantRevision} captureSource={captureAssistantSource}
            onPreview={previewAssistantLayout} onApply={applyAssistantLayout} />}
          showImages={showImages}
          onShowImagesChange={setShowImages}
          projectMenu={onClose => (
            <Toolbar onClose={onClose}
              isEngineConsoleOpen={isEngineConsoleOpen}
              onEngineConsoleOpenChange={setIsEngineConsoleOpen}
              onLoadProject={() => { void loadProject() }}
              recentProjects={recentProjects}
              onLoadRecentProject={id => {
                const entry = recentProjects.find(project => project.id === id)
                if (entry) void loadProject(() => readRecentProject(entry), id)
              }}
              onNewProject={newProject}
              onOpenManufacturerPortal={() => setIsManufacturerPortalOpen(true)}
              onOpenMaterialEditor={() => setIsMaterialEditorOpen(true)}
              onOpenObjectBuilder={() => setObjectBuilderOpen(true)}
              onOpenAccount={() => setIsAccountOpen(true)}
              onOpenDesignAssistant={() => setAssistantOpen(true)}
              onSaveProject={() => { void saveProject() }}
              onSaveToDevice={() => { void saveProject('device') }}
              onDownloadCopy={() => { void saveProject('download') }}
              onSaveToCloud={() => { void saveProject('cloud') }}
              canSave={!!saveDestination && !isSavingProject}
              saveToDevice={saveDestination?.kind === 'device'}
              isSaving={isSavingProject}
            />
          )}
          editControls={<EditToolbar canCopy={canCopy} canPaste={canPaste} canRedo={canRedo} canUndo={canUndo} onCopy={copySelection} onCut={cutSelection} onPaste={pasteClipboard} onRedo={redo} onUndo={undo} />}
          onGroundImageChange={image => {
            recordHistory()
            setFloors(current => current.map(floor => floor.id === activeFloor.id ? { ...floor, groundImage: image } : floor))
          }}
          modelTransformPreviewRef={modelTransformPreviewRef}
          activeFloor={activeFloor}
          onSelectFloor={selectEditingFloor}
          floors={floors}
          initialViewport={floorplanViewportsRef.current[activeFloor.id]}
          internalWallThickness={internalWallThickness}
          isAddingWall={isAddingWall}
          isSplittingWall={isSplittingWall}
          isRoofMode={isRoofMode}
          modelAssetVersion={modelAssetVersion}
          placementModel={pendingModel}
          projectFileName={projectFileName}
          selectedModelId={selectedModelId}
          selectedModelIds={selectedModelIds}
          selectedRoofId={selectedRoofId}
          selectedWallId={selectedWallId}
          selectedWallIds={selectedWallIds}
          wallHeight={Math.min(newWallHeight, MAX_WALL_HEIGHT_METERS)}
          wallKind={wallKind}
          onAddWall={addWall}
          onSplitWall={splitWall}
          onJoinWalls={joinWalls}
          onAddRoof={addRoof}
          onCancelModelPlacement={() => setPendingModelId(null)}
          onDeleteModel={deleteModel}
          onDeleteRoof={deleteRoof}
          onDeleteWall={deleteWall}
          onExitAddWall={exitWallTool}
          onStopAddingWalls={stopAddingWalls}
          onStartMeasuring={() => setIsRoofMode(false)}
          onOpenProperties={openProperties}
          onViewportChange={updateFloorplanViewport}
          onSelectModel={selectModel}
          onSelectRoof={selectRoofFromFloorplan}
          onRoofPlacementPreviewChange={setRoofPlacementPreview}
          onPlaceModel={(placement) => {
            if (pendingModelId) addModel(pendingModelId, placement)
          }}
          selectedRoomSignature={selectedRoomSignature}
          onSelectRoom={(roomSignature) => {
            setSelectedRoomSignature(roomSignature)
            setSelectedWallId(null)
            setSelectedWallIds([])
            setSelectedModelId(null)
            setSelectedModelIds([])
            setSelectedRoofId(null)
            setSelectedSurface(null)
          }}
          onSelectWall={selectWall}
          onUpdateModel={updateModel}
          onUpdateRoof={updateRoof}
          onUpdateWall={updateWallGeometry}
          onUpdateWalls={updateWallGeometries}
          viewportRestoreRevision={floorplanRestoreRevision}
        >
          {transformControls => {
            if (!isPropertiesOpen) return null
            const panel = (
              <ContextPanel
                lightControl={localLightControl}
                transformControls={transformControls}
                activeFloor={contextFloor}
                floors={floors}
                canVaultRoom={!floors.some(floor => floor.elevation > contextFloor.elevation)}
                selectedModel={selectedModel}
                selectedRoom={selectedRoom}
                selectedSurface={selectedSurface}
                selectedWall={selectedWall ?? selectedSurfaceWall ?? undefined}
                surfaceAssignments={surfaceAssignments}
                surfaceMaterials={availableMaterials}
                onClose={() => setIsPropertiesOpen(false)}
                onDeleteModel={deleteModel}
                onAddDormerWindow={addWindowToDormer}
                onSelectDormerWindow={modelId => {
                  setSelectedModelId(modelId)
                  setSelectedModelIds([modelId])
                }}
                onRenameRoom={(roomSignature, name) => {
                  recordHistory()
                  setFloors((currentFloors) =>
                    currentFloors.map((floor) =>
                      floor.id === contextFloor.id
                        ? {
                            ...floor,
                            rooms: (floor.rooms ?? []).map((room) =>
                              room.signature === roomSignature ? { ...room, name } : room,
                            ),
                          }
                        : floor,
                    ),
                  )
                }}
                onUpdateRoomCeilingMode={(roomSignature, ceilingMode) => {
                  const room = contextFloor.rooms.find(candidate => candidate.signature === roomSignature)
                  if (!room || (room.ceilingMode ?? contextFloor.ceilingMode ?? 'horizontal') === ceilingMode) return
                  recordHistory()
                  setFloors(currentFloors => currentFloors.map(floor =>
                    floor.id === contextFloor.id
                      ? { ...floor, rooms: floor.rooms.map(candidate =>
                        candidate.signature === roomSignature ? { ...candidate, ceilingMode } : candidate) }
                      : floor,
                  ))
                }}
                onUpdateModel={updateModel}
                onUpdateWall={updateWallGeometry}
              />
            )
            return propertiesFullscreenHost ? createPortal(panel, propertiesFullscreenHost) : panel
          }}
        </FloorplanCanvas>
        <div
          className="view-splitter"
          role="separator"
          aria-label="Resize 2D and 3D views"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => {
            event.preventDefault()
            setIsResizingSplit(true)
          }}
          onDoubleClick={() => setSplitPercent(50)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              setSplitPercent((currentPercent) => Math.max(25, currentPercent - 5))
            }

            if (event.key === 'ArrowRight') {
              event.preventDefault()
              setSplitPercent((currentPercent) => Math.min(75, currentPercent + 5))
            }

            if (event.key === 'Home') {
              event.preventDefault()
              setSplitPercent(25)
            }

            if (event.key === 'End') {
              event.preventDefault()
              setSplitPercent(75)
            }

            if (event.key === 'Enter') {
              event.preventDefault()
              setSplitPercent(50)
            }
          }}
        />
        <ThreeDView
          suspended={isMaterialEditorOpen || isAccountOpen}
          lightControl={localLightControl}
          savedIndirectLighting={loadedLightingCache}
          lightingResetRevision={projectLoadRevision}
          ambientLighting={ambientLighting}
          onAmbientLightingChange={setAmbientLighting}
          diffuseProbeResolution={diffuseProbeResolution}
          onDiffuseProbeResolutionChange={setDiffuseProbeResolution}
          exposureStops={exposureStops}
          onExposureStopsChange={setExposureStops}
          onIndirectLightingReady={updateBakedLighting}
          modelTransformPreviewRef={modelTransformPreviewRef}
          activeFloorId={selectedFloorViewId === ALL_FLOORS_VIEW_ID
            ? threeDNavigationFloorId : selectedFloorViewId}
          onFloorViewChange={setSelectedFloorViewId}
          cameraRestoreRevision={cameraRestoreRequest.revision}
          cameraViewState={cameraRestoreRequest.state}
          floors={modelPreviewFloors}
          isEngineConsoleOpen={isEngineConsoleOpen}
          lightDirection={sunPosition}
          modelAssetVersion={modelAssetVersion}
          placementModel={pendingModel}
          roofPlacementPreview={roofPlacementPreview}
          onClearSelection={clearThreeDSelection}
          onCameraViewStateChange={updateThreeDViewCameraState}
          onEngineConsoleOpenChange={setIsEngineConsoleOpen}
          onSelectFloor={(floorId) => {
            setThreeDNavigationFloorId(floorId)
            setSelectedFloorViewId((currentFloorViewId) =>
              currentFloorViewId === ALL_FLOORS_VIEW_ID
                ? currentFloorViewId
                : floorId,
            )
            clearThreeDSelection()
          }}
          onSelectModel={selectModelFromThreeD}
          onOpenProperties={openProperties}
          onSelectRoof={selectRoofFromThreeD}
          onSelectSurface={selectSurfaceFromThreeD}
          onLightDirectionChange={setSunPosition}
          onCancelModelPlacement={() => setPendingModelId(null)}
          onPlaceModel={(placement) => {
            if (pendingModelId) addModel(pendingModelId, placement)
          }}
          onUpdateModel={updateModel}
          selectedModelId={selectedModelId}
          selectedRoofId={selectedRoofId}
          selectedSurface={selectedSurface}
          selectedWallId={selectedWallId}
          sceneRevision={sceneRevision}
          showAllFloors={selectedFloorViewId === ALL_FLOORS_VIEW_ID}
          showImages={showImages}
          surfaceAssignments={surfaceAssignments}
        />
      </section>
      {isModelSelectorOpen ? (
        <ModelSelector
          initialRoot={modelSelectorLocation.root}
          initialSection={modelSelectorLocation.section}
          models={availableModels}
          onClose={() => setIsModelSelectorOpen(false)}
          onRefreshModels={refreshModelAssets}
          onSelectModel={chooseModel}
          onBuildWindow={() => { setIsModelSelectorOpen(false); setWindowBuilder({ definition: null }) }}
          onEditWindow={definition => { setIsModelSelectorOpen(false); setWindowBuilder({ definition }) }}
          onBuildStairs={() => { setIsModelSelectorOpen(false); setStairBuilder({ definition: null }) }}
          onEditStairs={definition => { setIsModelSelectorOpen(false); setStairBuilder({ definition }) }}
          onEditPictureFrame={definition => { setIsModelSelectorOpen(false); setPictureFrameBuilder({ definition }) }}
          onEditKitchenUnit={definition => { setIsModelSelectorOpen(false); setKitchenUnitBuilder({ definition }) }}
        />
      ) : null}
      {objectBuilderOpen && <ObjectBuilder onClose={() => setObjectBuilderOpen(false)} onChoose={type => {
        setObjectBuilderOpen(false)
        if (type === 'stairs') setStairBuilder({ definition: null })
        if (type === 'windows') setWindowBuilder({ definition: null })
        if (type === 'picture-frame') setPictureFrameBuilder({ definition: null })
        if (type === 'kitchen-unit') setKitchenUnitBuilder({ definition: null })
      }} />}
      {!windowBuilder && !stairBuilder && !pictureFrameBuilder && !kitchenUnitBuilder && selectedModelId && (() => {
        const instance = floors.flatMap(floor => floor.models ?? []).find(model => model.id === selectedModelId)
        const definition = instance && modelsById.get(instance.modelId)
        return definition?.stairDesign ? <button type="button" className="window-variety-edit"
          onClick={() => setStairBuilder({ definition })}>Edit stair variety</button> : definition?.windowDesign ? <button type="button" className="window-variety-edit"
          onClick={() => setWindowBuilder({ definition })}>Edit window variety</button> : definition?.pictureFrameDesign
          ? <button type="button" className="window-variety-edit" onClick={() => setPictureFrameBuilder({ definition })}>Edit picture frame</button>
          : definition?.kitchenUnitDesign
            ? <button type="button" className="window-variety-edit" onClick={() => setKitchenUnitBuilder({ definition })}>Edit kitchen unit</button> : null
      })()}
      {pictureFrameBuilder && <PictureFrameBuilder definition={pictureFrameBuilder.definition}
        onClose={() => setPictureFrameBuilder(null)} onSave={async (definition, place) => {
          for (const floor of floors) for (const model of floor.models) {
            if (model.modelId !== definition.id || !model.wallAttachment) continue
            const wall = floor.walls.find(wall => wall.id === model.wallAttachment?.wallId)
            if (wall && !fitWallMountedObject(definition, wall, model.wallAttachment, model)) {
              throw new Error(`The frame is too large for its wall on ${floor.name}.`)
            }
          }
          await savePictureFrameToLibrary(definition)
          recordHistory()
          registerPictureFrameModels([definition])
          setAvailableModels([...modelLibrary])
          setFloors(current => current.map(floor => floor.models.some(model => model.modelId === definition.id)
            ? { ...floor, models: floor.models.map(model => {
              if (model.modelId !== definition.id || !model.wallAttachment) return model
              const wall = floor.walls.find(wall => wall.id === model.wallAttachment?.wallId)
              const mount = wall && fitWallMountedObject(definition, wall, model.wallAttachment, model)
              return mount ? { ...model, ...mount } : model
            }) } : floor))
          setSceneRevision(revision => revision + 1)
          setPictureFrameBuilder(null)
          if (place) chooseModel(definition.id)
          else { setModelSelectorLocation({ root: 'mine', section: 'objects' }); setIsModelSelectorOpen(true) }
        }} />}
      {kitchenUnitBuilder && <KitchenUnitBuilder definition={kitchenUnitBuilder.definition} materials={availableMaterials} models={availableModels}
        onClose={() => setKitchenUnitBuilder(null)} onSave={async (definition, place) => {
          const refitUnit = (floor: FloorLevel, model: PlacedModel) => {
            if (model.modelId !== definition.id || !model.wallAttachment) return undefined
            const wall = floor.walls.find(wall => wall.id === model.wallAttachment?.wallId)
            return wall ? fitWallMountedObject(definition, wall, model.wallAttachment, model, floor.walls) : undefined
          }
          if (definition.placement === 'wall-mounted') {
            for (const floor of floors) {
              if (floor.models.some(model => refitUnit(floor, model) === null)) {
                throw new Error(`The cabinet is too large for its wall on ${floor.name}.`)
              }
            }
          }
          await saveKitchenUnitToLibrary(definition)
          recordHistory()
          registerKitchenUnitModels([definition])
          setAvailableModels([...modelLibrary])
          if (kitchenUnitBuilder.definition?.id === definition.id) {
            setFloors(current => current.map(floor => floor.models.some(model => model.modelId === definition.id)
              ? { ...floor, models: floor.models.map(model => {
                const mount = definition.placement === 'wall-mounted' && refitUnit(floor, model)
                return mount ? { ...model, ...mount } : model
              }) } : floor))
            setSceneRevision(revision => revision + 1)
          }
          setKitchenUnitBuilder(null)
          if (place) chooseModel(definition.id)
          else { setModelSelectorLocation({ root: 'mine', section: 'objects' }); setIsModelSelectorOpen(true) }
        }} />}
      {stairBuilder ? <StairBuilder definition={stairBuilder.definition}
        instanceCount={floors.flatMap(floor => floor.models ?? []).filter(model => model.modelId === stairBuilder.definition?.id).length}
        floorRise={(() => {
          const floor = floors.find(floor => floor.id === activeFloorId) ?? floors[0]
          const above = floors.filter(candidate => candidate.elevation > floor.elevation).sort((a, b) => a.elevation - b.elevation)[0]
          return above ? above.elevation - floor.elevation : floor.roomHeight + floor.slabThickness
        })()}
        materials={availableMaterials} onClose={() => setStairBuilder(null)}
        onSave={async (definition, place) => {
          await saveStairToLibrary(definition)
          recordHistory()
          const previous = modelsById.get(definition.id)?.stairDesign
          const geometryChanged = previous && stairGeometryKey(previous) !== stairGeometryKey(definition.stairDesign!)
          registerStairModels([definition])
          setAvailableModels([...modelLibrary])
          setFloors(current => current.map(floor => floor.models.some(model => model.modelId === definition.id)
            ? { ...floor, models: [...floor.models] } : floor))
          if (geometryChanged) setSceneRevision(revision => revision + 1)
          setStairBuilder(null)
          if (place) chooseModel(definition.id)
          else { setModelSelectorLocation({ root: 'mine', section: 'objects' }); setIsModelSelectorOpen(true) }
        }} /> : null}
      {windowBuilder ? <WindowBuilder definition={windowBuilder.definition}
        instanceCount={floors.flatMap(floor => floor.models ?? []).filter(model => model.modelId === windowBuilder.definition?.id).length}
        onClose={() => setWindowBuilder(null)}
        onSave={async (definition, place) => {
          // Persist successfully before changing the house, so a storage failure leaves the editor open.
          for (const floor of floors) for (const instance of floor.models ?? []) {
            if (instance.modelId !== definition.id || !definition.windowDesign) continue
            const design = definition.windowDesign
            const error = validateWindowDesign({ ...design,
              width: design.width * (instance.scale ?? 1) * (instance.widthScale ?? 1),
              height: design.height * (instance.scale ?? 1),
              depth: design.depth * (instance.scale ?? 1) * (instance.depthScale ?? 1) })
            if (error) throw new Error(`A resized instance on ${floor.name} would be too small for this layout. ${error}`)
          }
          await saveWindowToLibrary(definition)
          recordHistory()
          registerWindowModels([definition])
          setAvailableModels([...modelLibrary])
          setFloors(current => current.map(floor => syncWallOpenings(floor, modelsById)))
          setSceneRevision(revision => revision + 1)
          setWindowBuilder(null)
          if (place) chooseModel(definition.id)
          else { setModelSelectorLocation({ root: 'mine', section: 'openings' }); setIsModelSelectorOpen(true) }
        }} /> : null}
    </main>
  )
}

export default function AppBootstrap() {
  return <App initialProjectSource={undefined} />
}
