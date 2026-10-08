import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { HouseViewer } from '../../src/viewer/HouseViewer'
import type { PublishedHouse } from '../../src/viewer/viewerProject'
import type { FloorLevel } from '../../src/types'
import { modelsById } from '../../src/models/modelLibrary'
import { getViewerStairTransitions } from '../../src/viewer/viewerNavigation'
import '../../src/index.css'
import '../../src/App.css'

const makeFloor = (id: string, elevation: number): FloorLevel => ({
  id, name: id === 'ground' ? 'Ground floor' : 'First floor', elevation,
  roomHeight: 2.4, slabThickness: 0.3, rooms: [], models: [], roofs: [],
  walls: [
    [{ x: 0, y: 0 }, { x: 8, y: 0 }], [{ x: 8, y: 0 }, { x: 8, y: 8 }],
    [{ x: 8, y: 8 }, { x: 0, y: 8 }], [{ x: 0, y: 8 }, { x: 0, y: 0 }],
  ].map(([start, end], index) => ({ id: `${id}-${index}`, start, end, height: 2.4, thickness: 0.2, kind: 'external' })),
})
const ground = makeFloor('ground', 0), first = makeFloor('first', 2.7)
ground.models.push({ id: 'stairs-instance', modelId: 'simple-stairs', position: { x: 4, y: 4 }, rotation: 0, scale: 1 })
let house: PublishedHouse = { title: 'Viewer test house', materials: [],
  startCamera: { position: { x: 4, y: 1.8, z: 7 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }, project: {
  activeFloorId: ground.id, floors: [ground, first], surfaceAssignments: [],
  threeDView: { floorViewId: 'all', camera: { position: { x: 4, y: 1.8, z: 7 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } } },
} }
if (new URLSearchParams(location.search).has('published')) {
  const snapshot = await (await fetch('/.viewer-data/public/house.json')).text()
  house = JSON.parse(snapshot.replaceAll('./published-assets/', '/.viewer-data/public/published-assets/'))
}
const original = JSON.stringify(house)
Object.assign(window, {
  viewerState: () => [..._roots.values()][0]?.store.getState(),
  viewerHouse: house,
  viewerHouseUnchanged: () => JSON.stringify(house) === original,
  viewerTransitions: () => getViewerStairTransitions(ground, [ground, first], modelsById),
})
createRoot(document.getElementById('root')!).render(<HouseViewer house={house} />)
