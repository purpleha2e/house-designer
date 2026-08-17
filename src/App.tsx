import { useState } from 'react'
import { ContextPanel } from './components/ContextPanel'
import { FloorplanCanvas } from './components/FloorplanCanvas'
import { Toolbar } from './components/Toolbar'
import { ThreeDView } from './components/ThreeDView'
import type { FloorLevel, Wall, WallKind } from './types'
import './App.css'

const DEFAULT_THICKNESS = 0.3
const DEFAULT_ROOM_HEIGHT = 2.4
const DEFAULT_SLAB_THICKNESS = 0.3

function App() {
  const initialWallId: string = crypto.randomUUID()
  const initialFloorId: string = crypto.randomUUID()
  const [floors, setFloors] = useState<FloorLevel[]>([
    {
      id: initialFloorId,
      name: 'Floor 0',
      elevation: 0,
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
  }

  const deleteWall = (wallId: string) => {
    setFloors((currentFloors) =>
      currentFloors.map((floor) => ({
        ...floor,
        walls: floor.walls.filter((wall) => wall.id !== wallId),
      })),
    )
    setSelectedWallId((currentSelectedWallId) =>
      currentSelectedWallId === wallId ? null : currentSelectedWallId,
    )
  }

  const addFloor = () => {
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
        roomHeight: DEFAULT_ROOM_HEIGHT,
        slabThickness: DEFAULT_SLAB_THICKNESS,
        walls: [],
      },
    ])
    setActiveFloorId(id)
    setSelectedWallId(null)
    setIsAddingWall(false)
  }

  const activeFloor =
    floors.find((floor) => floor.id === activeFloorId) ?? floors[0]
  const selectedWall = floors
    .flatMap((floor) => floor.walls)
    .find((wall) => wall.id === selectedWallId)
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
        onAddFloor={addFloor}
        onSelectFloor={(floorId) => {
          setActiveFloorId(floorId)
          setSelectedWallId(null)
          setIsAddingWall(false)
        }}
        onToggleAddWall={() => setIsAddingWall((value) => !value)}
        onWallKindChange={setWallKind}
      />
      <ContextPanel activeFloor={activeFloor} selectedWall={selectedWall} />

      <section className="editor-grid" aria-label="House floorplan editor">
        <FloorplanCanvas
          activeFloor={activeFloor}
          floors={floors}
          isAddingWall={isAddingWall}
          selectedWallId={selectedWallId}
          onAddWall={addWall}
          onDeleteWall={deleteWall}
          onExitAddWall={() => setIsAddingWall(false)}
          onSelectWall={setSelectedWallId}
        />
        <ThreeDView activeFloorId={activeFloor.id} floors={floors} />
      </section>
    </main>
  )
}

export default App
