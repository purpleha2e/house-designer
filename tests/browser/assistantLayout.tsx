import { createRoot } from 'react-dom/client'
import { App } from '../../src/App'
import { getEditorState, Konva } from './rendererTestModules'
import type { FloorLevel, Wall } from '../../src/types'
import redHouse from '../../red_house_5.json'
import '../../src/index.css'

const ring = [{ x: 0, y: 0 }, { x: 11.6, y: 0 }, { x: 11.6, y: 9.2 }, { x: 0, y: 9.2 }]
const walls: Wall[] = ring.map((start, index) => ({ start, end: ring[(index + 1) % ring.length], id: `wall-${index}`,
  kind: 'external', height: 2.45, thickness: 0.3 }))
walls[0].openings = [2, 5.7, 9.7].map((center, index) => ({
  id: `window-${index}`, modelId: 'window', center, width: 0.95, bottom: 0.95, height: 1,
}))
const upper: FloorLevel = { id: 'upper', name: 'First floor', elevation: 2.7, walls, roomHeight: 2.45, slabThickness: 0.25, rooms: [], models: [] }
const lower: FloorLevel = { ...upper, id: 'lower', name: 'Ground floor', elevation: 0,
  walls: walls.map(wall => ({ ...wall, openings: undefined })), models: [
    { id: 'stairs', modelId: 'simple-stairs', position: { x: 5.3, y: 4.6 }, rotation: -Math.PI / 2, scale: 1.12 },
  ] }

Object.assign(window, { assistantPlan: () => Konva.stages[0], assistantThree: getEditorState,
  assistantPlanProps: () => {
    const root = document.getElementById('root')!
    const key = Object.keys(root).find(name => name.startsWith('__reactContainer$'))!
    type Fiber = { type?: { name?: string }; child?: Fiber; sibling?: Fiber; memoizedProps?: { floors?: FloorLevel[] } }
    const tree = (root as unknown as Record<string, { stateNode: { current: Fiber } }>)[key].stateNode.current
    const find = (fiber?: Fiber): Fiber | undefined => fiber && (fiber.type?.name === 'FloorplanCanvas' ? fiber : find(fiber.child) ?? find(fiber.sibling))
    return find(tree)?.memoizedProps
  },
})
const testProject = new URLSearchParams(location.search)
const project = testProject.has('springfield') ? (await import('../../springfield_15_narrower.json')).default : testProject.has('red-house') ? redHouse : {
  activeFloorId: 'lower', floors: [lower, upper], sunPosition: { azimuth: 1, elevation: 0.7 }, surfaceAssignments: [], wallKind: 'external',
}
createRoot(document.getElementById('root')!).render(<App initialProjectSource={project} />)
