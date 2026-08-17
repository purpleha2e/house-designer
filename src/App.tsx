import { useState } from 'react'
import { ContextPanel } from './components/ContextPanel'
import { FloorplanCanvas } from './components/FloorplanCanvas'
import { Toolbar } from './components/Toolbar'
import { ThreeDView } from './components/ThreeDView'
import type { Wall } from './types'
import './App.css'

const DEFAULT_THICKNESS = 0.3
const DEFAULT_HEIGHT = 2.4

function App() {
  const initialWallId = crypto.randomUUID()
  const [walls, setWalls] = useState<Wall[]>([
    {
      id: initialWallId,
      start: { x: 1.5, y: 1.5 },
      end: { x: 6.5, y: 1.5 },
      thickness: DEFAULT_THICKNESS,
      height: DEFAULT_HEIGHT,
    },
  ])
  const [isAddingWall, setIsAddingWall] = useState(false)
  const [selectedWallId, setSelectedWallId] = useState<string | null>(
    initialWallId,
  )

  const addWall = (wall: Omit<Wall, 'id' | 'thickness' | 'height'>) => {
    const id = crypto.randomUUID()

    setWalls((currentWalls) => [
      ...currentWalls,
      {
        ...wall,
        id,
        thickness: DEFAULT_THICKNESS,
        height: DEFAULT_HEIGHT,
      },
    ])
    setSelectedWallId(id)
  }

  const deleteWall = (wallId: string) => {
    setWalls((currentWalls) => currentWalls.filter((wall) => wall.id !== wallId))
    setSelectedWallId((currentSelectedWallId) =>
      currentSelectedWallId === wallId ? null : currentSelectedWallId,
    )
  }

  const selectedWall = walls.find((wall) => wall.id === selectedWallId)

  return (
    <main className="app-shell">
      <Toolbar
        isAddingWall={isAddingWall}
        wallCount={walls.length}
        onToggleAddWall={() => setIsAddingWall((value) => !value)}
      />
      <ContextPanel selectedWall={selectedWall} />

      <section className="editor-grid" aria-label="House floorplan editor">
        <FloorplanCanvas
          isAddingWall={isAddingWall}
          selectedWallId={selectedWallId}
          walls={walls}
          onAddWall={addWall}
          onDeleteWall={deleteWall}
          onSelectWall={setSelectedWallId}
        />
        <ThreeDView walls={walls} />
      </section>
    </main>
  )
}

export default App
