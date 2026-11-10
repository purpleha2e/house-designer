/* eslint-disable react-refresh/only-export-components -- Standalone renderer regression. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { ThreeDView } from '../../src/components/ThreeDView'
import { modelsById, registerRuntimeModels } from '../../src/models/modelLibrary'
import { syncWallOpenings } from '../../src/modelPlacement'
import type { FloorLevel } from '../../src/types'
import '../../src/App.css'

registerRuntimeModels([{ id: 'latency-door', name: 'Latency door', category: 'Doors', shape: 'box',
  color: '#b8a187', width: .9, height: 2.1, depth: .15, wallMount: 'interior-door' }])
const noop = () => {}
const camera = { position: { x: 2, y: 1.6, z: 2 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
const sun = { azimuth: 140, elevation: 40 }
const assignments = []
const floor: FloorLevel = syncWallOpenings({ id: 'room', name: 'Four walls', elevation: 0, roomHeight: 2.4,
  slabThickness: .2, roofs: [], rooms: [], walls: [
    { id: 'south', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
    { id: 'east', start: { x: 4, y: 0 }, end: { x: 4, y: 3 } },
    { id: 'north', start: { x: 4, y: 3 }, end: { x: 0, y: 3 } },
    { id: 'west', start: { x: 0, y: 3 }, end: { x: 0, y: 0 } },
  ].map(wall => ({ ...wall, kind: 'external', thickness: .2, height: 2.4 })), models: [
    { id: 'door', modelId: 'latency-door', position: { x: 1.5, y: 0 }, rotation: 0, scale: 1,
      wallAttachment: { wallId: 'south', offset: 1.5 } },
    { id: 'lamp', modelId: 'point-light', position: { x: 2, y: 1.5 }, height: 2.2,
      rotation: 0, scale: 1, lightPower: 120, lightEnabled: true },
  ] }, modelsById)
function App() {
  const [floors, setFloors] = useState([floor])
  Object.assign(window, { doorLatency: {
    state: () => [..._roots.values()][0]?.store.getState(),
    move: (x: number) => setFloors(current => current.map(f => syncWallOpenings({ ...f,
      models: f.models.map(m => m.id === 'door' ? { ...m, position: { x, y: 0 }, wallAttachment: { wallId: 'south', offset: x } } : m),
    }, modelsById))),
    unmount:()=>root.unmount(),
  } })
  return <ThreeDView lightingUpdateMode={location.search.includes('preview-lighting') ? 'preview' : 'automatic'} floors={floors} activeFloorId="room" cameraRestoreRevision={1}
    cameraViewState={camera}
    diffuseProbeResolution={16} isEngineConsoleOpen={false} lightDirection={sun}
    modelAssetVersion={1} placementModel={null} roofPlacementPreview={null}
    onCancelModelPlacement={noop} onClearSelection={noop} onCameraViewStateChange={noop}
    onEngineConsoleOpenChange={noop} onLightDirectionChange={noop} onPlaceModel={noop}
    onSelectFloor={noop} onSelectModel={noop} onSelectRoof={noop} onSelectSurface={noop} onUpdateModel={noop}
    selectedModelId={null} selectedRoofId={null} selectedSurface={null} selectedWallId={null}
    sceneRevision={1} showAllFloors surfaceAssignments={assignments} />
}
const root=createRoot(document.getElementById('root')!);root.render(<App />)
