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
  Wall,
  WallKind,
} from './types'
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
const DEFAULT_ROOM_HEIGHT = 2.4
const DEFAULT_SLAB_THICKNESS = 0.3
const STORAGE_KEY = 'house-designer:project'
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
  const [historyAvailability, setHistoryAvailability] = useState({
    canRedo: false,
    canUndo: false,
  })
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
    setFloors(snapshot.floors.map((floor) => normalizeFloor(floor, modelsById)))
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

  const updateHistoryAvailability = () => {
    setHistoryAvailability({
      canRedo: historyFutureRef.current.length > 0,
      canUndo: historyPastRef.current.length > 0,
    })
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
      currentFloors.map((floor) =>
        floor.id === activeFloorId
          ? syncWallOpenings(
              {
                ...floor,
                models: [...(floor.models ?? []), model],
              },
              modelsById,
            )
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
          ? syncWallOpenings(
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
              modelsById,
            )
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

  const deleteModel = (modelId: string) => {
    recordHistory()
    setFloors((currentFloors) =>
      currentFloors.map((floor) =>
        syncWallOpenings(
          {
            ...floor,
            models: (floor.models ?? []).filter((model) => model.id !== modelId),
            walls: floor.walls.map((wall) => ({
              ...wall,
              openings: (wall.openings ?? []).filter(
                (opening) =>
                  opening.id !== modelId && !opening.id.startsWith(`${modelId}:`),
              ),
            })),
          },
          modelsById,
        ),
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

      const loadedFloors = parsedProject.floors.map((floor) =>
        normalizeFloor(floor, modelsById),
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
  const canUndo = historyAvailability.canUndo
  const canRedo = historyAvailability.canRedo
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
          ? syncWallOpenings(
              {
                ...floor,
                models: [...(floor.models ?? []), modelToPaste],
              },
              modelsById,
            )
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
    setIsAddingWall(false)
  }

  const clearThreeDSelection = () => {
    setSelectedModelId(null)
    setSelectedModelIds([])
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
        isAddingWall={isAddingWall}
        selectedFloorViewId={selectedFloorViewId}
        wallCount={totalWallCount}
        wallKind={wallKind}
        onAddEmptyFloor={() => addFloor({ copyExternalWalls: false })}
        onAddFloor={() => addFloor({ copyExternalWalls: true })}
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
          onUpdateModel={updateModel}
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
