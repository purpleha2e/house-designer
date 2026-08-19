import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ContextPanel } from './components/ContextPanel'
import { FloorplanCanvas } from './components/FloorplanCanvas'
import { LeftToolRail } from './components/LeftToolRail'
import { ModelSelector } from './components/ModelSelector'
import { Toolbar } from './components/Toolbar'
import { ThreeDView } from './components/ThreeDView'
import type {
  FloorLevel,
  PlacedModel,
  Point,
  Room,
  Wall,
  WallKind,
  WallOpening,
} from './types'
import { modelsById, type ModelDefinition } from './models/modelLibrary'
import { buildWallTopology, type DetectedRoom } from './wallTopology'
import './App.css'

const DEFAULT_THICKNESS = 0.3
const DEFAULT_ROOM_HEIGHT = 2.4
const DEFAULT_SLAB_THICKNESS = 0.3
const STORAGE_KEY = 'house-designer:project'
const WINDOW_SILL_HEIGHT_METERS = 0.9
const PATIO_DOOR_WIDTH_METERS = 1.62
const PATIO_SIDE_LIGHT_BOTTOM_METERS = 1.02
const ALL_FLOORS_VIEW_ID = 'all'

type SavedProject = {
  activeFloorId: string
  floors: FloorLevel[]
  wallKind: WallKind
}

type ProjectSnapshot = SavedProject & {
  selectedFloorViewId: string
  selectedModelId: string | null
  selectedModelIds: string[]
  selectedRoomSignature: string | null
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

function getPlanCenter(walls: Wall[]): Point {
  const points = walls.flatMap((wall) => [wall.start, wall.end])

  if (points.length === 0) {
    return { x: 3, y: 3 }
  }

  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  }
}

function distance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function getProjectionOnWall(point: Point, wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return { point: wall.start, t: 0 }
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lengthSquared),
  )

  return {
    point: {
      x: wall.start.x + dx * t,
      y: wall.start.y + dy * t,
    },
    t,
  }
}

function getWallAngle(wall: Wall) {
  return Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x)
}

function getWallLength(wall: Wall) {
  return distance(wall.start, wall.end)
}

function getWallMountForPoint(point: Point, walls: Wall[]) {
  const candidates = walls
    .map((wall) => {
      const projection = getProjectionOnWall(point, wall)

      return {
        distance: distance(point, projection.point),
        point: projection.point,
        t: projection.t,
        wall,
      }
    })
    .filter((candidate) => candidate.distance <= 0.55)
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

function openingBelongsToModel(opening: WallOpening, modelIds: Set<string>) {
  const [ownerId] = opening.id.split(':')
  return modelIds.has(ownerId)
}

function getModelOpenings(model: PlacedModel, wall: Wall): WallOpening[] {
  const definition = modelsById.get(model.modelId)

  if (!definition?.wallMount || !model.wallAttachment) {
    return []
  }

  const scale = model.scale ?? 1
  const wallLength = getWallLength(wall)
  const width = Math.min(
    Math.max((definition.openingWidth ?? definition.width) * scale, 0.3),
    Math.max(wallLength - 0.2, 0.3),
  )
  const bottom =
    definition.wallMount === 'window'
      ? Math.min(WINDOW_SILL_HEIGHT_METERS, Math.max(wall.height - 0.2, 0))
      : 0
  const height = Math.min(Math.max(definition.height * scale, 0.3), Math.max(wall.height - bottom, 0.3))

  const opening: WallOpening = {
    id: model.id,
    modelId: model.modelId,
    center: Math.max(width / 2, Math.min(wallLength - width / 2, model.wallAttachment.offset)),
    width,
    bottom,
    height,
  }

  if (!model.modelId.includes('side-lights')) {
    return [opening]
  }

  const centreDoorWidth = Math.min(
    PATIO_DOOR_WIDTH_METERS * scale,
    Math.max(wallLength - 0.2, 0.3),
  )
  const sideLightWidth = Math.max((definition.width * scale - centreDoorWidth) / 2, 0)
  const sideLightBottom = Math.min(
    PATIO_SIDE_LIGHT_BOTTOM_METERS * scale,
    Math.max(wall.height - 0.2, 0),
  )
  const sideLightHeight = Math.min(
    Math.max(definition.height * scale - sideLightBottom, 0.3),
    Math.max(wall.height - sideLightBottom, 0.3),
  )
  const sideLightOffset = centreDoorWidth / 2 + sideLightWidth / 2

  if (sideLightWidth <= 0.1) {
    return [
      {
        ...opening,
        width: centreDoorWidth,
      },
    ]
  }

  const clampCenter = (center: number, openingWidth: number) =>
    Math.max(
      openingWidth / 2,
      Math.min(wallLength - openingWidth / 2, center),
    )

  return [
    {
      ...opening,
      id: `${model.id}:left-side-light`,
      center: clampCenter(model.wallAttachment.offset - sideLightOffset, sideLightWidth),
      width: sideLightWidth,
      bottom: sideLightBottom,
      height: sideLightHeight,
    },
    {
      ...opening,
      id: `${model.id}:doors`,
      center: clampCenter(model.wallAttachment.offset, centreDoorWidth),
      width: centreDoorWidth,
      bottom: 0,
      height: Math.min(definition.height * scale, wall.height),
    },
    {
      ...opening,
      id: `${model.id}:right-side-light`,
      center: clampCenter(model.wallAttachment.offset + sideLightOffset, sideLightWidth),
      width: sideLightWidth,
      bottom: sideLightBottom,
      height: sideLightHeight,
    },
  ]
}

function syncWallOpenings(floor: FloorLevel): FloorLevel {
  const modelIds = new Set((floor.models ?? []).map((model) => model.id))
  const modelsByWallId = new Map<string, PlacedModel[]>()

  for (const model of floor.models ?? []) {
    if (!model.wallAttachment) {
      continue
    }

    modelsByWallId.set(model.wallAttachment.wallId, [
      ...(modelsByWallId.get(model.wallAttachment.wallId) ?? []),
      model,
    ])
  }

  return {
    ...floor,
    walls: floor.walls.map((wall) => {
      const modelOpenings = (modelsByWallId.get(wall.id) ?? [])
        .flatMap((model) => getModelOpenings(model, wall))
      const manualOpenings = (wall.openings ?? []).filter((opening) =>
        !openingBelongsToModel(opening, modelIds),
      )
      const openings = [...manualOpenings, ...modelOpenings].sort(
        (firstOpening, secondOpening) => firstOpening.center - secondOpening.center,
      )

      return openings.length > 0
        ? { ...wall, openings }
        : { ...wall, openings: undefined }
    }),
  }
}

function normalizeFloor(floor: FloorLevel): FloorLevel {
  return syncWallOpenings({
    ...floor,
    models: Array.isArray(floor.models)
      ? floor.models.map((model) => ({
          ...model,
          scale:
            typeof model.scale === 'number' && Number.isFinite(model.scale)
              ? model.scale
              : 1,
        }))
      : [],
  })
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
    (project.wallKind === 'external' || project.wallKind === 'internal')
  )
}

function cloneProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return structuredClone(snapshot)
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

function App() {
  const initialWallId: string = crypto.randomUUID()
  const initialFloorId: string = crypto.randomUUID()
  const [floors, setFloors] = useState<FloorLevel[]>([
    {
      id: initialFloorId,
      name: 'Floor 0',
      elevation: 0,
      models: [],
      rooms: [],
      roomHeight: DEFAULT_ROOM_HEIGHT,
      slabThickness: DEFAULT_SLAB_THICKNESS,
      walls: [
        {
          id: initialWallId,
          kind: 'external',
          start: { x: 1.5, y: 1.5 },
          end: { x: 6.5, y: 1.5 },
          thickness: DEFAULT_THICKNESS,
          height: DEFAULT_ROOM_HEIGHT,
        },
      ],
    },
  ])
  const [activeFloorId, setActiveFloorId] = useState<string>(initialFloorId)
  const [selectedFloorViewId, setSelectedFloorViewId] =
    useState<string>(initialFloorId)
  const [wallKind, setWallKind] = useState<WallKind>('external')
  const [isAddingWall, setIsAddingWall] = useState(false)
  const [selectedWallId, setSelectedWallId] = useState<string | null>(
    initialWallId,
  )
  const [selectedRoomSignature, setSelectedRoomSignature] = useState<string | null>(
    null,
  )
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([initialWallId])
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const editorGridRef = useRef<HTMLElement>(null)
  const historyPastRef = useRef<ProjectSnapshot[]>([])
  const historyFutureRef = useRef<ProjectSnapshot[]>([])
  const historyCoalesceRef = useRef<{ key: string; time: number } | null>(null)
  const [splitPercent, setSplitPercent] = useState(50)
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)

  const getProjectSnapshot = (): ProjectSnapshot => ({
    activeFloorId,
    floors,
    selectedFloorViewId,
    selectedModelId,
    selectedModelIds,
    selectedRoomSignature,
    selectedWallId,
    selectedWallIds,
    wallKind,
  })

  const restoreProjectSnapshot = (snapshot: ProjectSnapshot) => {
    setFloors(snapshot.floors.map(normalizeFloor))
    setActiveFloorId(snapshot.activeFloorId)
    setSelectedFloorViewId(snapshot.selectedFloorViewId)
    setSelectedModelId(snapshot.selectedModelId)
    setSelectedModelIds(snapshot.selectedModelIds)
    setSelectedRoomSignature(snapshot.selectedRoomSignature)
    setSelectedWallId(snapshot.selectedWallId)
    setSelectedWallIds(snapshot.selectedWallIds)
    setWallKind(snapshot.wallKind)
    setIsAddingWall(false)
  }

  const recordHistory = (coalesceKey?: string) => {
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
    setHistoryVersion((version) => version + 1)
  }

  useEffect(() => {
    setFloors((currentFloors) => {
      let changed = false

      const nextFloors = currentFloors.map((floor) => {
        const detectedRooms = buildWallTopology(floor.walls).rooms
        const roomMetadataBySignature = new Map(
          (floor.rooms ?? []).map((room) => [room.signature, room]),
        )
        const rooms = detectedRooms.map((detectedRoom, index) => {
          const existingRoom = roomMetadataBySignature.get(detectedRoom.signature)

          return (
            existingRoom ?? {
              id: crypto.randomUUID(),
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
    recordHistory()
    const id = crypto.randomUUID()
    const targetFloor =
      floors.find((floor) => floor.id === activeFloorId) ?? floors[0]

    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        floor.id === activeFloorId
          ? {
              ...floor,
              walls: [
                ...floor.walls,
                {
                  ...wall,
                  id,
                  kind: wallKind,
                  thickness:
                    wallKind === 'external' ? DEFAULT_THICKNESS : DEFAULT_THICKNESS / 2,
                  height: targetFloor.roomHeight,
                },
              ],
            }
          : floor,
      ),
    )
    setSelectedWallId(id)
    setSelectedWallIds([id])
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
  }

  const deleteWall = (wallId: string) => {
    const wallFloor = floors.find((floor) =>
      floor.walls.some((wall) => wall.id === wallId),
    )
    const wallToDelete = wallFloor?.walls.find((wall) => wall.id === wallId)

    if (!wallFloor || !wallToDelete) {
      return
    }

    const floorsAbove = floors.filter(
      (floor) => floor.elevation > wallFloor.elevation,
    )
    const shouldDeleteFloorsAbove =
      wallToDelete.kind === 'external' && floorsAbove.length > 0

    if (shouldDeleteFloorsAbove) {
      const shouldDelete = window.confirm(
        `Removing a wall under another floor will cause all floors above ${wallFloor.name} to be deleted.\n\nThis will delete ${floorsAbove
          .map((floor) => floor.name)
          .join(', ')}. Continue?`,
      )

      if (!shouldDelete) {
        return
      }
    }

    recordHistory()
    setFloors((currentFloors) =>
      currentFloors
        .filter(
          (floor) =>
            !shouldDeleteFloorsAbove || floor.elevation <= wallFloor.elevation,
        )
        .map((floor) => ({
          ...floor,
          walls: floor.walls.filter((wall) => wall.id !== wallId),
        })),
    )
    if (
      shouldDeleteFloorsAbove &&
      floorsAbove.some((floor) => floor.id === activeFloorId)
    ) {
      setActiveFloorId(wallFloor.id)
    }
    if (
      shouldDeleteFloorsAbove &&
      selectedFloorViewId !== ALL_FLOORS_VIEW_ID &&
      floorsAbove.some((floor) => floor.id === selectedFloorViewId)
    ) {
      setSelectedFloorViewId(wallFloor.id)
    }
    setSelectedWallId((currentSelectedWallId) => {
      const selectedWallWasDeleted =
        currentSelectedWallId === wallId ||
        (shouldDeleteFloorsAbove &&
          floorsAbove.some((floor) =>
            floor.walls.some((wall) => wall.id === currentSelectedWallId),
          ))

      return selectedWallWasDeleted ? null : currentSelectedWallId
    })
    setSelectedWallIds((currentSelectedWallIds) =>
      currentSelectedWallIds.filter((selectedId) => selectedId !== wallId),
    )
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
  }

  const addFloor = ({ copyExternalWalls }: { copyExternalWalls: boolean }) => {
    recordHistory()
    const floorNumber = floors.length
    const id = crypto.randomUUID()
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
        rooms: [],
        roomHeight: DEFAULT_ROOM_HEIGHT,
        slabThickness: DEFAULT_SLAB_THICKNESS,
        walls:
          copyExternalWalls && previousFloor
            ? previousFloor.walls
                .filter((wall) => wall.kind === 'external')
                .map((wall) => ({
                  ...wall,
                  id: crypto.randomUUID(),
                  height: DEFAULT_ROOM_HEIGHT,
                  openings: undefined,
                }))
            : [],
      },
    ])
    setActiveFloorId(id)
    setSelectedFloorViewId(id)
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setIsAddingWall(false)
  }

  const addModel = (modelId: string) => {
    recordHistory()
    const activeFloorForPlacement =
      floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
    const definition = modelsById.get(modelId)
    const planCenter = getPlanCenter(activeFloorForPlacement.walls)
    const wallMount =
      definition?.wallMount
        ? getWallMountForPoint(planCenter, activeFloorForPlacement.walls)
        : null
    const model: PlacedModel = {
      id: crypto.randomUUID(),
      modelId,
      position: wallMount?.position ?? planCenter,
      rotation: wallMount?.rotation ?? 0,
      scale: 1,
      wallAttachment: wallMount?.wallAttachment,
    }

    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        floor.id === activeFloorId
          ? syncWallOpenings({
              ...floor,
              models: [...(floor.models ?? []), model],
            })
          : floor,
      ),
    )
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedModelId(model.id)
    setSelectedModelIds([model.id])
    setIsAddingWall(false)
    setIsModelSelectorOpen(false)
  }

  const updateModel = (modelId: string, updates: Partial<PlacedModel>) => {
    recordHistory(`model:${modelId}`)
    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        floor.id === activeFloorId
          ? syncWallOpenings({
              ...floor,
              models: (floor.models ?? []).map((model) =>
                model.id === modelId ? { ...model, ...updates, id: model.id } : model,
              ),
            })
          : floor,
      ),
    )
  }

  const updateWallGeometry = (
    wallId: string,
    updates: Pick<Wall, 'end' | 'start'>,
  ) => {
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
        const nextWallLength = getWallLength(nextWall)
        const nextWallAngle = getWallAngle(nextWall)
        const nextWallDirection =
          nextWallLength > 0
            ? {
                x: (nextWall.end.x - nextWall.start.x) / nextWallLength,
                y: (nextWall.end.y - nextWall.start.y) / nextWallLength,
              }
            : { x: 0, y: 0 }
        const nextModels = (floor.models ?? []).map((model) => {
          if (model.wallAttachment?.wallId !== wallId) {
            return model
          }

          const offset = Math.max(
            0,
            Math.min(nextWallLength, model.wallAttachment.offset),
          )

          return {
            ...model,
            position: {
              x: nextWall.start.x + nextWallDirection.x * offset,
              y: nextWall.start.y + nextWallDirection.y * offset,
            },
            rotation: nextWallAngle,
            wallAttachment: {
              ...model.wallAttachment,
              offset,
            },
          }
        })

        return syncWallOpenings({
          ...floor,
          models: nextModels,
          walls: floor.walls.map((wall) => (wall.id === wallId ? nextWall : wall)),
        })
      }),
    )
  }

  const deleteModel = (modelId: string) => {
    recordHistory()
    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        syncWallOpenings({
          ...floor,
          models: (floor.models ?? []).filter((model) => model.id !== modelId),
          walls: floor.walls.map((wall) => ({
            ...wall,
            openings: (wall.openings ?? []).filter(
              (opening) =>
                opening.id !== modelId && !opening.id.startsWith(`${modelId}:`),
            ),
          })),
        }),
      ),
    )
    setSelectedModelId((currentSelectedModelId) =>
      currentSelectedModelId === modelId ? null : currentSelectedModelId,
    )
    setSelectedModelIds((currentSelectedModelIds) =>
      currentSelectedModelIds.filter((selectedId) => selectedId !== modelId),
    )
  }

  const saveProject = () => {
    const project: SavedProject = {
      activeFloorId,
      floors,
      wallKind,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
  }

  const loadProject = () => {
    const savedProject = localStorage.getItem(STORAGE_KEY)

    if (!savedProject) {
      window.alert('No saved house design was found in this browser.')
      return
    }

    try {
      const parsedProject: unknown = JSON.parse(savedProject)

      if (!isSavedProject(parsedProject)) {
        window.alert('The saved house design could not be loaded.')
        return
      }

      const loadedFloors = parsedProject.floors.map(normalizeFloor)

      recordHistory()
      setFloors(loadedFloors)
      const loadedActiveFloorId = loadedFloors.some(
        (floor) => floor.id === parsedProject.activeFloorId,
      )
        ? parsedProject.activeFloorId
        : loadedFloors[0].id

      setActiveFloorId(loadedActiveFloorId)
      setSelectedFloorViewId(loadedActiveFloorId)
      setWallKind(parsedProject.wallKind)
      setSelectedWallId(null)
      setSelectedWallIds([])
      setSelectedRoomSignature(null)
      setSelectedModelId(null)
      setSelectedModelIds([])
      setIsAddingWall(false)
    } catch {
      window.alert('The saved house design could not be loaded.')
    }
  }

  const activeFloor =
    floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
  const selectedWall = floors
    .flatMap((floor) => floor.walls)
    .find((wall) => wall.id === selectedWallId)
  const selectedModel: SelectedModel | null = selectedModelId
    ? (() => {
        const model = activeFloor.models.find(
          (candidateModel) => candidateModel.id === selectedModelId,
        )
        const definition = model ? modelsById.get(model.modelId) : null

        return model && definition ? { definition, model } : null
      })()
    : null
  const activeDetectedRooms = useMemo(
    () => buildWallTopology(activeFloor.walls).rooms,
    [activeFloor.walls],
  )
  const selectedRoom: SelectedRoom | null = selectedRoomSignature
    ? (() => {
        const detectedRoom = activeDetectedRooms.find(
          (room) => room.signature === selectedRoomSignature,
        )
        const metadata = (activeFloor.rooms ?? []).find(
          (room) => room.signature === selectedRoomSignature,
        )

        return detectedRoom && metadata ? { detectedRoom, metadata } : null
      })()
    : null
  const totalWallCount = floors.reduce(
    (wallCount, floor) => wallCount + floor.walls.length,
    0,
  )
  const canUndo = historyPastRef.current.length > 0
  const canRedo = historyFutureRef.current.length > 0
  const canCopy = Boolean(selectedModel || selectedWall)
  const canPaste = Boolean(clipboardItem)

  const copySelection = () => {
    if (selectedModel) {
      setClipboardItem({
        type: 'model',
        model: cloneProjectSnapshot({
          activeFloorId,
          floors,
          selectedFloorViewId,
          selectedModelId,
          selectedModelIds,
          selectedRoomSignature,
          selectedWallId,
          selectedWallIds,
          wallKind,
        }).floors
          .flatMap((floor) => floor.models)
          .find((model) => model.id === selectedModel.model.id) ?? selectedModel.model,
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

    recordHistory()

    if (clipboardItem.type === 'wall') {
      const id = crypto.randomUUID()
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
      setSelectedRoomSignature(null)
      setIsAddingWall(false)
      return
    }

    const id = crypto.randomUUID()
    const definition = modelsById.get(clipboardItem.model.modelId)
    const pastedPosition = {
      x: clipboardItem.model.position.x + 0.35,
      y: clipboardItem.model.position.y + 0.35,
    }
    const wallMount =
      definition?.wallMount ? getWallMountForPoint(pastedPosition, activeFloor.walls) : null
    const modelToPaste: PlacedModel = {
      ...clipboardItem.model,
      id,
      position: wallMount?.position ?? pastedPosition,
      rotation: wallMount?.rotation ?? clipboardItem.model.rotation,
      wallAttachment: wallMount?.wallAttachment,
    }

    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        floor.id === activeFloorId
          ? syncWallOpenings({
              ...floor,
              models: [...(floor.models ?? []), modelToPaste],
            })
          : floor,
      ),
    )
    setSelectedModelId(id)
    setSelectedModelIds([id])
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setIsAddingWall(false)
  }

  const selectModel = (modelId: string | null, additive = false) => {
    if (!modelId) {
      setSelectedModelId(null)
      setSelectedModelIds([])
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
      setSelectedModelId(modelId)
      setSelectedModelIds([modelId])
    }

    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setIsAddingWall(false)
  }

  const selectWall = (wallId: string | null, additive = false) => {
    if (!wallId) {
      setSelectedWallId(null)
      setSelectedWallIds([])
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
    setSelectedRoomSignature(null)
    setIsAddingWall(false)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryElement(event.target)) {
        return
      }

      const key = event.key.toLowerCase()

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
  }, [
          activeFloor,
          activeFloorId,
          clipboardItem,
          floors,
          selectedFloorViewId,
          selectedModel,
          selectedModelId,
          selectedModelIds,
          selectedRoomSignature,
          selectedWall,
          selectedWallId,
          selectedWallIds,
          wallKind,
          historyVersion,
  ])

  return (
    <main className="app-shell">
      <LeftToolRail onOpenModelSelector={() => setIsModelSelectorOpen(true)} />
      <Toolbar
        activeFloorId={activeFloor.id}
        floors={floors}
        isAddingWall={isAddingWall}
        selectedFloorViewId={selectedFloorViewId}
        wallCount={totalWallCount}
        wallKind={wallKind}
        canCopy={canCopy}
        canPaste={canPaste}
        canRedo={canRedo}
        canUndo={canUndo}
        onAddEmptyFloor={() => addFloor({ copyExternalWalls: false })}
        onAddFloor={() => addFloor({ copyExternalWalls: true })}
        onCopy={copySelection}
        onCut={cutSelection}
        onLoadProject={loadProject}
        onPaste={pasteClipboard}
        onRedo={redo}
        onSaveProject={saveProject}
        onSelectFloor={(floorId) => {
          setSelectedFloorViewId(floorId)

          if (floorId !== ALL_FLOORS_VIEW_ID) {
            setActiveFloorId(floorId)
          }

          setSelectedWallId(null)
          setSelectedRoomSignature(null)
          setSelectedModelId(null)
          setIsAddingWall(false)
        }}
        onToggleAddWall={() => setIsAddingWall((value) => !value)}
        onUndo={undo}
        onWallKindChange={(nextWallKind) => {
          recordHistory()
          setWallKind(nextWallKind)
        }}
      />
      <ContextPanel
        activeFloor={activeFloor}
        selectedModel={selectedModel}
        selectedRoom={selectedRoom}
        selectedWall={selectedWall}
        onDeleteModel={deleteModel}
        onRenameRoom={(roomSignature, name) => {
          recordHistory()
          setFloors((currentFloors) =>
            currentFloors.map((floor) =>
              floor.id === activeFloor.id
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
          activeFloor={activeFloor}
          floors={floors}
          isAddingWall={isAddingWall}
          selectedModelId={selectedModelId}
          selectedModelIds={selectedModelIds}
          selectedWallId={selectedWallId}
          selectedWallIds={selectedWallIds}
          wallKind={wallKind}
          onAddWall={addWall}
          onDeleteModel={deleteModel}
          onDeleteWall={deleteWall}
          onExitAddWall={() => setIsAddingWall(false)}
          onSelectModel={selectModel}
          selectedRoomSignature={selectedRoomSignature}
          onSelectRoom={(roomSignature) => {
            setSelectedRoomSignature(roomSignature)
            setSelectedWallId(null)
            setSelectedWallIds([])
            setSelectedModelId(null)
            setSelectedModelIds([])
          }}
          onSelectWall={selectWall}
          onUpdateModel={updateModel}
          onUpdateWall={updateWallGeometry}
        />
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
          activeFloorId={activeFloor.id}
          floors={floors}
          selectedModelId={selectedModelId}
          showAllFloors={selectedFloorViewId === ALL_FLOORS_VIEW_ID}
        />
      </section>
      {isModelSelectorOpen ? (
        <ModelSelector
          onClose={() => setIsModelSelectorOpen(false)}
          onSelectModel={addModel}
        />
      ) : null}
    </main>
  )
}

export default App
