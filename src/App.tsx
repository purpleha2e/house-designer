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
  Room,
  SelectableSurface,
  SurfaceMaterialAssignment,
  SurfaceWallSide,
  Wall,
  WallKind,
} from './types'
import { surfaceMaterialCatalog } from './materials/materialCatalog'
import { modelsById, type ModelDefinition } from './models/modelLibrary'
import { buildWallTopology, type DetectedRoom } from './wallTopology'
import {
  createPlacedModel,
  getWallMountForPoint,
  normalizeFloor,
  syncWallOpenings,
  updateWallAttachedModels,
} from './modelPlacement'
import './App.css'

const DEFAULT_THICKNESS = 0.3
const DEFAULT_INTERNAL_THICKNESS = 0.15
const DEFAULT_ROOM_HEIGHT = 2.4
const DEFAULT_SLAB_THICKNESS = 0.3
const MAX_ENABLED_LIGHTS = 11
const ALL_FLOORS_VIEW_ID = 'all'
const PROJECT_FILE_EXTENSION = '.house.json'
const PROJECT_FILE_NAME = `house-design${PROJECT_FILE_EXTENSION}`
const PROJECT_FILE_MIME_TYPE = 'application/json'

type SavedProject = {
  activeFloorId: string
  floors: FloorLevel[]
  surfaceAssignments?: SurfaceMaterialAssignment[]
  wallKind: WallKind
}

type FilePickerFileType = {
  accept: Record<string, string[]>
  description: string
}

type FileSystemFileHandle = {
  getFile: () => Promise<File>
}

type FileSystemWritableFileStream = {
  close: () => Promise<void>
  write: (data: BlobPart) => Promise<void>
}

type FileSystemSaveFilePickerOptions = {
  suggestedName?: string
  types?: FilePickerFileType[]
}

type FileSystemOpenFilePickerOptions = {
  multiple?: boolean
  types?: FilePickerFileType[]
}

type WindowWithFileSystemAccess = Window &
  typeof globalThis & {
    showOpenFilePicker?: (
      options?: FileSystemOpenFilePickerOptions,
    ) => Promise<FileSystemFileHandle[]>
    showSaveFilePicker?: (
      options?: FileSystemSaveFilePickerOptions,
    ) => Promise<{
      createWritable: () => Promise<FileSystemWritableFileStream>
    }>
  }

type ProjectSnapshot = SavedProject & {
  selectedFloorViewId: string
  selectedModelId: string | null
  selectedModelIds: string[]
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

function getProjectFilePickerTypes(): FilePickerFileType[] {
  return [
    {
      description: 'House Designer project',
      accept: {
        [PROJECT_FILE_MIME_TYPE]: [PROJECT_FILE_EXTENSION, '.json'],
      },
    },
  ]
}

async function saveTextToLocalFile(fileName: string, contents: string) {
  const browserWindow = window as WindowWithFileSystemAccess

  if (browserWindow.showSaveFilePicker) {
    const fileHandle = await browserWindow.showSaveFilePicker({
      suggestedName: fileName,
      types: getProjectFilePickerTypes(),
    })
    const writableFile = await fileHandle.createWritable()

    await writableFile.write(contents)
    await writableFile.close()
    return
  }

  const blob = new Blob([contents], { type: PROJECT_FILE_MIME_TYPE })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function readTextFromInputFile() {
  return new Promise<string | null>((resolve, reject) => {
    const input = document.createElement('input')

    input.type = 'file'
    input.accept = `${PROJECT_FILE_EXTENSION},.json,${PROJECT_FILE_MIME_TYPE}`
    input.onchange = () => {
      const file = input.files?.[0]

      if (!file) {
        resolve(null)
        return
      }

      file.text().then(resolve, reject)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

async function readTextFromLocalFile() {
  const browserWindow = window as WindowWithFileSystemAccess

  if (browserWindow.showOpenFilePicker) {
    const [fileHandle] = await browserWindow.showOpenFilePicker({
      multiple: false,
      types: getProjectFilePickerTypes(),
    })

    if (!fileHandle) {
      return null
    }

    return fileHandle.getFile().then((file) => file.text())
  }

  return readTextFromInputFile()
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
  const [internalWallThickness, setInternalWallThickness] = useState(
    DEFAULT_INTERNAL_THICKNESS,
  )
  const [isAddingWall, setIsAddingWall] = useState(false)
  const [selectedWallId, setSelectedWallId] = useState<string | null>(
    initialWallId,
  )
  const [selectedRoomSignature, setSelectedRoomSignature] = useState<string | null>(
    null,
  )
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [selectedSurface, setSelectedSurface] =
    useState<SelectableSurface | null>(null)
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([initialWallId])
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
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [surfaceAssignments, setSurfaceAssignments] = useState<
    SurfaceMaterialAssignment[]
  >([])

  const getProjectSnapshot = (): ProjectSnapshot => ({
    activeFloorId,
    floors,
    selectedFloorViewId,
    selectedModelId,
    selectedModelIds,
    selectedRoomSignature,
    selectedSurface,
    selectedWallId,
    selectedWallIds,
    surfaceAssignments,
    wallKind,
  })

  const restoreProjectSnapshot = (snapshot: ProjectSnapshot) => {
    setFloors(
      enforceProjectLightEnabledLimit(
        snapshot.floors.map((floor) => normalizeFloor(floor, modelsById)),
        undefined,
        snapshot.activeFloorId,
      ),
    )
    setActiveFloorId(snapshot.activeFloorId)
    setSelectedFloorViewId(snapshot.selectedFloorViewId)
    setSelectedModelId(snapshot.selectedModelId)
    setSelectedModelIds(snapshot.selectedModelIds)
    setSelectedRoomSignature(snapshot.selectedRoomSignature)
    setSelectedSurface(snapshot.selectedSurface ?? null)
    setSelectedWallId(snapshot.selectedWallId)
    setSelectedWallIds(snapshot.selectedWallIds)
    setSurfaceAssignments(snapshot.surfaceAssignments ?? [])
    setWallKind(snapshot.wallKind)
    setIsAddingWall(false)
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

    return definition?.wallMount ? syncWallOpenings(floor, modelsById) : floor
  }

  const enforceProjectLightEnabledLimit = (
    floorsToClamp: FloorLevel[],
    priorityModelId?: string,
    priorityFloorId?: string,
  ) => {
    const enabledLights = floorsToClamp.flatMap((floor, floorIndex) =>
      (floor.models ?? []).flatMap((model, modelIndex) => {
        const definition = modelsById.get(model.modelId)

        return definition?.isLight && model.lightEnabled !== false
          ? [{ floorId: floor.id, floorIndex, model, modelIndex }]
          : []
      }),
    )

    if (enabledLights.length <= MAX_ENABLED_LIGHTS) {
      return floorsToClamp
    }

    const enabledLightIds = new Set<string>()
    const priorityLight = priorityModelId
      ? enabledLights.find((light) => light.model.id === priorityModelId)
      : null

    if (priorityLight) {
      enabledLightIds.add(priorityLight.model.id)
    }

    const orderedLights = enabledLights
      .filter((light) => light.model.id !== priorityModelId)
      .sort((firstLight, secondLight) => {
        const firstFloorScore = firstLight.floorId === priorityFloorId ? 0 : 1
        const secondFloorScore = secondLight.floorId === priorityFloorId ? 0 : 1

        return (
          firstFloorScore - secondFloorScore ||
          firstLight.floorIndex - secondLight.floorIndex ||
          firstLight.modelIndex - secondLight.modelIndex
        )
      })

    for (const light of orderedLights) {
      if (enabledLightIds.size >= MAX_ENABLED_LIGHTS) {
        break
      }

      enabledLightIds.add(light.model.id)
    }

    return floorsToClamp.map((floor) => ({
      ...floor,
      models: (floor.models ?? []).map((model) => {
        const definition = modelsById.get(model.modelId)

        return definition?.isLight &&
          model.lightEnabled !== false &&
          !enabledLightIds.has(model.id)
          ? {
              ...model,
              lightEnabled: false,
            }
          : model
      }),
    }))
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
                    wallKind === 'external'
                      ? DEFAULT_THICKNESS
                      : internalWallThickness,
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
    setSelectedFloorViewId(fallbackFloor.id)
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
    const model = createPlacedModel({
      id: crypto.randomUUID(),
      modelId,
      modelsById,
      walls: activeFloorForPlacement.walls,
    })

    setFloors((currentFloors) =>
      enforceProjectLightEnabledLimit(
        currentFloors.map((floor) =>
          floor.id === activeFloorId
            ? syncWallOpeningsForModelIfNeeded(
                {
                  ...floor,
                  models: [...(floor.models ?? []), model],
                },
                model.modelId,
              )
            : floor,
        ),
        model.id,
        activeFloorId,
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
    setFloors((currentFloors) => {
      let updatedModelFloorId: string | undefined
      const nextFloors = currentFloors.map((floor) => {
        const modelOnFloor = (floor.models ?? []).find((model) => model.id === modelId)

        if (!modelOnFloor) {
          return floor
        }

        updatedModelFloorId = floor.id

        return syncWallOpeningsForModelIfNeeded(
          {
            ...floor,
            models: (floor.models ?? []).map((model) => {
              if (model.id !== modelId) {
                return model
              }

              const nextModel = { ...model, ...updates, id: model.id }
              const definition = modelsById.get(model.modelId)
              const wallMount =
                definition?.wallMount && updates.position
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
                  ? {
                      ...nextModel,
                      wallAttachment: undefined,
                    }
                  : nextModel
            }),
          },
          modelOnFloor.modelId,
        )
      })

      return enforceProjectLightEnabledLimit(
        nextFloors,
        updates.lightEnabled === true ? modelId : undefined,
        updatedModelFloorId,
      )
    })
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
        const nextModels = updateWallAttachedModels(floor.models ?? [], nextWall)

        return syncWallOpenings(
          {
            ...floor,
            models: nextModels,
            walls: floor.walls.map((wall) => (wall.id === wallId ? nextWall : wall)),
          },
          modelsById,
        )
      }),
    )
  }

  const assignRoomFloorMaterial = (
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
            assignment.target.floorId === activeFloor.id &&
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
          id: crypto.randomUUID(),
          materialId,
          target: {
            type: 'room-floor',
            floorId: activeFloor.id,
            roomSignature,
          },
          textureRotation,
          textureScale,
        },
      ]
    })
  }

  const assignRoomCeilingMaterial = (
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
            assignment.target.floorId === activeFloor.id &&
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
          id: crypto.randomUUID(),
          materialId,
          target: {
            type: 'ceiling',
            floorId: activeFloor.id,
            roomSignature,
          },
          textureRotation,
          textureScale,
        },
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
  ) => {
    recordHistory()
    setSurfaceAssignments((currentAssignments) => {
      const nextAssignments = currentAssignments.filter(
        (assignment) =>
          !(
            assignment.target.type === 'wall-face' &&
            assignment.target.wallId === wallId &&
            (side === 'both' ||
              assignment.target.side === 'both' ||
              assignment.target.side === side)
          ),
      )

      if (!materialId) {
        return nextAssignments
      }

      return [
        ...nextAssignments,
        {
          coverageHeight,
          customColor,
          id: crypto.randomUUID(),
          materialId,
          target: {
            type: 'wall-face',
            side,
            wallId,
          },
          textureRotation,
          textureScale,
        },
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
          models: (floor.models ?? []).filter((model) => model.id !== modelId),
        }

        if (!modelCutsOpenings) {
          return nextFloor
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

  const saveProject = async () => {
    const project: SavedProject = {
      activeFloorId,
      floors,
      surfaceAssignments,
      wallKind,
    }

    try {
      await saveTextToLocalFile(
        PROJECT_FILE_NAME,
        `${JSON.stringify(project, null, 2)}\n`,
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      window.alert('The house design could not be saved to disk.')
    }
  }

  const loadProject = async () => {
    try {
      const savedProject = await readTextFromLocalFile()

      if (!savedProject) {
        return
      }

      const parsedProject: unknown = JSON.parse(savedProject)

      if (!isSavedProject(parsedProject)) {
        window.alert('The selected house design could not be loaded.')
        return
      }

      const loadedFloors = enforceProjectLightEnabledLimit(
        parsedProject.floors.map((floor) => normalizeFloor(floor, modelsById)),
        undefined,
        parsedProject.activeFloorId,
      )

      recordHistory()
      setFloors(loadedFloors)
      const loadedActiveFloorId = loadedFloors.some(
        (floor) => floor.id === parsedProject.activeFloorId,
      )
        ? parsedProject.activeFloorId
        : loadedFloors[0].id

      setActiveFloorId(loadedActiveFloorId)
      setSelectedFloorViewId(loadedActiveFloorId)
      setSurfaceAssignments(
        Array.isArray(parsedProject.surfaceAssignments)
          ? parsedProject.surfaceAssignments
          : [],
      )
      setWallKind(parsedProject.wallKind)
      setSelectedWallId(null)
      setSelectedWallIds([])
      setSelectedRoomSignature(null)
      setSelectedModelId(null)
      setSelectedModelIds([])
      setIsAddingWall(false)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      window.alert('The selected house design could not be loaded.')
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
  const selectedSurfaceWall = selectedSurface?.type === 'wall-face'
    ? activeFloor.walls.find((wall) => wall.id === selectedSurface.wallId) ?? null
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
        selectedSurface.roomSignature,
        materialId,
        textureScale,
        textureRotation,
        customColor,
      )
      return
    }

    const wall = activeFloor.walls.find((candidateWall) =>
      candidateWall.id === selectedSurface.wallId
    )

    assignWallMaterial(
      selectedSurface.wallId,
      materialId,
      wallMode === 'lower' ? coverageHeight ?? 1.2 : wall?.height ?? activeFloor.roomHeight,
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
      enforceProjectLightEnabledLimit(
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
        modelToPaste.id,
        activeFloorId,
      ),
    )
    setSelectedModelId(id)
    setSelectedModelIds([id])
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
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

  const selectModelFromThreeD = (modelId: string, floorId: string) => {
    setActiveFloorId(floorId)

    if (selectedFloorViewId !== ALL_FLOORS_VIEW_ID) {
      setSelectedFloorViewId(floorId)
    }

    setSelectedModelId(modelId)
    setSelectedModelIds([modelId])
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
    setIsAddingWall(false)
  }

  const clearThreeDSelection = () => {
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedWallId(null)
    setSelectedWallIds([])
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
    setIsAddingWall(false)
  }

  const selectSurfaceFromThreeD = (surface: SelectableSurface) => {
    setActiveFloorId(surface.floorId)

    if (selectedFloorViewId !== ALL_FLOORS_VIEW_ID) {
      setSelectedFloorViewId(surface.floorId)
    }

    setSelectedSurface(surface)
    setSelectedModelId(null)
    setSelectedModelIds([])
    setSelectedWallIds([])

    if (surface.type === 'wall-face') {
      setSelectedWallId(surface.wallId)
      setSelectedRoomSignature(null)
      return
    }

    setSelectedWallId(null)
    setSelectedRoomSignature(surface.roomSignature)
  }

  const selectWall = (wallId: string | null, additive = false) => {
    if (!wallId) {
      setSelectedWallId(null)
      setSelectedWallIds([])
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
    setSelectedRoomSignature(null)
    setSelectedSurface(null)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <LeftToolRail
        activeFloorId={activeFloor.id}
        canCopy={canCopy}
        canPaste={canPaste}
        canRedo={canRedo}
        canUndo={canUndo}
        floors={floors}
        internalWallThickness={internalWallThickness}
        isAddingWall={isAddingWall}
        materials={surfaceMaterialCatalog}
        selectedSurface={selectedSurface}
        selectedFloorViewId={selectedFloorViewId}
        selectedWallHeight={selectedSurfaceWall?.height ?? null}
        wallCount={totalWallCount}
        wallKind={wallKind}
        onAddEmptyFloor={() => addFloor({ copyExternalWalls: false })}
        onAddFloor={() => addFloor({ copyExternalWalls: true })}
        onApplyMaterial={applyMaterialToSelectedSurface}
        onCopy={copySelection}
        onCut={cutSelection}
        onDeleteFloor={deleteActiveFloor}
        onLoadProject={loadProject}
        onOpenModelSelector={() => setIsModelSelectorOpen(true)}
        onPaste={pasteClipboard}
        onRedo={redo}
        onSaveProject={saveProject}
        onSelectFloor={(floorId) => {
          setSelectedFloorViewId(floorId)

          if (floorId !== ALL_FLOORS_VIEW_ID) {
            setActiveFloorId(floorId)
          }

          setSelectedWallId(null)
          setSelectedWallIds([])
          setSelectedRoomSignature(null)
          setSelectedModelId(null)
          setSelectedModelIds([])
          setIsAddingWall(false)
        }}
        onToggleAddWall={() => setIsAddingWall((value) => !value)}
        onUndo={undo}
        onInternalWallThicknessChange={setInternalWallThickness}
        onWallKindChange={(nextWallKind) => {
          recordHistory()
          setWallKind(nextWallKind)
        }}
      />
      <Toolbar
        floorCount={floors.length}
        wallCount={totalWallCount}
        onLoadProject={loadProject}
        onSaveProject={saveProject}
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
          internalWallThickness={internalWallThickness}
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
            setSelectedSurface(null)
          }}
          onSelectWall={selectWall}
          onUpdateModel={updateModel}
          onUpdateWall={updateWallGeometry}
        >
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
            onUpdateModel={updateModel}
          />
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
          activeFloorId={activeFloor.id}
          floors={floors}
          onClearSelection={clearThreeDSelection}
          onSelectModel={selectModelFromThreeD}
          onSelectSurface={selectSurfaceFromThreeD}
          onUpdateModel={updateModel}
          selectedModelId={selectedModelId}
          selectedSurface={selectedSurface}
          showAllFloors={selectedFloorViewId === ALL_FLOORS_VIEW_ID}
          surfaceAssignments={surfaceAssignments}
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
