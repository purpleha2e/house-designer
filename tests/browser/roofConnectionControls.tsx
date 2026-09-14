import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RoofConnectionFields } from '../../src/components/RoofConnectionFields'
import type { FloorLevel, RoofStructure } from '../../src/types'
import '../../src/App.css'

const roof = (id: string, x: number, y: number, rotation = 0): RoofStructure => ({
  id, type: 'up-and-over', position: { x, y }, supportPosition: { x, y },
  width: 4, depth: 6, supportWidth: 4, supportDepth: 6, pitchDegrees: 45, rotation,
})
function Controls() {
  const [floors, setFloors] = useState<FloorLevel[]>([
    { id: 'ground', name: 'Ground floor', elevation: 0, roomHeight: 2.4, slabThickness: 0.2,
      walls: [], rooms: [], models: [], roofs: [roof('branch', 0, -3)] },
    { id: 'upper', name: 'Upper floor', elevation: 2.6, roomHeight: 2.4, slabThickness: 0.2,
      walls: [], rooms: [], models: [], roofs: [roof('main', 0, 2, Math.PI / 2)] },
  ])
  Object.assign(window, { roofControlFloors: floors })
  return <div className="roof-placement-panel">
    <RoofConnectionFields floors={floors} roof={floors[0].roofs![0]} onChange={(updates) => setFloors((current) => current.map((floor, index) =>
      index ? floor : { ...floor, roofs: [{ ...floor.roofs![0], ...updates }] }))} />
    <button onClick={() => setFloors((current) => current.slice(0, 1))}>Delete target</button>
  </div>
}
createRoot(document.getElementById('root')!).render(<Controls />)
