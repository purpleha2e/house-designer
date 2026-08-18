import { useEffect, useMemo, useState } from 'react'
import { ContextPanel } from './components/ContextPanel'
import { FloorplanCanvas } from './components/FloorplanCanvas'
import { Toolbar } from './components/Toolbar'
import { ThreeDView } from './components/ThreeDView'
import type { FloorLevel, Room, Wall, WallKind } from './types'
import { buildWallTopology, type DetectedRoom } from './wallTopology'
import './App.css'

const DEFAULT_THICKNESS = 0.3
const DEFAULT_ROOM_HEIGHT = 2.4
const DEFAULT_SLAB_THICKNESS = 0.3
const STORAGE_KEY = 'house-designer:project'

type SavedProject = {
  activeFloorId: string
  floors: FloorLevel[]
  wallKind: WallKind
}

type SelectedRoom = {
  detectedRoom: DetectedRoom
  metadata: Room
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

function App() {
  const initialWallId: string = crypto.randomUUID()
  const initialFloorId: string = crypto.randomUUID()
  const [floors, setFloors] = useState<FloorLevel[]>([
    {
      id: initialFloorId,
      name: 'Floor 0',
      elevation: 0,
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
  const [wallKind, setWallKind] = useState<WallKind>('external')
  const [isAddingWall, setIsAddingWall] = useState(false)
  const [selectedWallId, setSelectedWallId] = useState<string | null>(
    initialWallId,
  )
  const [selectedRoomSignature, setSelectedRoomSignature] = useState<string | null>(
    null,
  )

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

  const addWall = (wall: Pick<Wall, 'start' | 'end'>) => {
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
    setSelectedRoomSignature(null)
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
    setSelectedWallId((currentSelectedWallId) => {
      const selectedWallWasDeleted =
        currentSelectedWallId === wallId ||
        (shouldDeleteFloorsAbove &&
          floorsAbove.some((floor) =>
            floor.walls.some((wall) => wall.id === currentSelectedWallId),
          ))

      return selectedWallWasDeleted ? null : currentSelectedWallId
    })
    setSelectedRoomSignature(null)
  }

  const addFloor = ({ copyExternalWalls }: { copyExternalWalls: boolean }) => {
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
                }))
            : [],
      },
    ])
    setActiveFloorId(id)
    setSelectedWallId(null)
    setSelectedRoomSignature(null)
    setIsAddingWall(false)
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

      setFloors(parsedProject.floors)
      setActiveFloorId(
        parsedProject.floors.some((floor) => floor.id === parsedProject.activeFloorId)
          ? parsedProject.activeFloorId
          : parsedProject.floors[0].id,
      )
      setWallKind(parsedProject.wallKind)
      setSelectedWallId(null)
      setSelectedRoomSignature(null)
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

  return (
    <main className="app-shell">
      <Toolbar
        activeFloorId={activeFloor.id}
        floors={floors}
        isAddingWall={isAddingWall}
        wallCount={totalWallCount}
        wallKind={wallKind}
        onAddEmptyFloor={() => addFloor({ copyExternalWalls: false })}
        onAddFloor={() => addFloor({ copyExternalWalls: true })}
        onLoadProject={loadProject}
        onSaveProject={saveProject}
        onSelectFloor={(floorId) => {
          setActiveFloorId(floorId)
          setSelectedWallId(null)
          setSelectedRoomSignature(null)
          setIsAddingWall(false)
        }}
        onToggleAddWall={() => setIsAddingWall((value) => !value)}
        onWallKindChange={setWallKind}
      />
      <ContextPanel
        activeFloor={activeFloor}
        selectedRoom={selectedRoom}
        selectedWall={selectedWall}
        onRenameRoom={(roomSignature, name) => {
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

      <section className="editor-grid" aria-label="House floorplan editor">
        <FloorplanCanvas
          activeFloor={activeFloor}
          floors={floors}
          isAddingWall={isAddingWall}
          selectedWallId={selectedWallId}
          wallKind={wallKind}
          onAddWall={addWall}
          onDeleteWall={deleteWall}
          onExitAddWall={() => setIsAddingWall(false)}
          selectedRoomSignature={selectedRoomSignature}
          onSelectRoom={(roomSignature) => {
            setSelectedRoomSignature(roomSignature)
            setSelectedWallId(null)
          }}
          onSelectWall={(wallId) => {
            setSelectedWallId(wallId)
            setSelectedRoomSignature(null)
          }}
        />
        <ThreeDView activeFloorId={activeFloor.id} floors={floors} />
      </section>
    </main>
  )
}

export default App
