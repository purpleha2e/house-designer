import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import Konva from 'konva'
import { PerspectiveCamera } from 'three'
import { ThreeDView } from '../../src/components/ThreeDView'
import { FloorplanCanvas, type RoofPlacementPreview } from '../../src/components/FloorplanCanvas'
import { createBayRoofLayout } from '../../src/bayRoof'
import { surfaceMaterialsById } from '../../src/materials/materialCatalog'
import type { FloorLevel, RoofStructure } from '../../src/types'
import '../../src/App.css'

const angled = new URLSearchParams(location.search).has('angled')
const angle = Number(new URLSearchParams(location.search).get('rotation') ?? 0)
const points = (angled ? [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 3 }, { x: -1, y: 3 }, { x: -2, y: 1 }]
  : [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: -2, y: 3 }])
  .map(p => ({ x: Number((p.x * Math.cos(angle) - p.y * Math.sin(angle)).toFixed(6)), y: Number((p.x * Math.sin(angle) + p.y * Math.cos(angle)).toFixed(6)) }))
const initialFloor: FloorLevel = {
  id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: 0.2, models: [], rooms: [], roofs: [],
  walls: points.map((start, i) => ({ id: `wall-${i}`, start, end: points[(i + 1) % points.length], kind: 'external', height: i === 0 ? 4.5 : 2.4, thickness: 0.2 })),
}
// A repeating course pattern makes tile orientation and stretching visible.
const texture = document.createElement('canvas'); texture.width = 128; texture.height = 128
const ctx = texture.getContext('2d')!
ctx.fillStyle = '#a44f32'; ctx.fillRect(0, 0, 128, 128)
ctx.strokeStyle = '#482a20'; ctx.lineWidth = 3
for (let row = 0; row < 4; row++) {
  ctx.beginPath(); ctx.moveTo(0, row * 32); ctx.lineTo(128, row * 32); ctx.stroke()
  for (let x = (row % 2) * 32; x <= 128; x += 64) { ctx.beginPath(); ctx.moveTo(x, row * 32); ctx.lineTo(x, row * 32 + 32); ctx.stroke() }
}
surfaceMaterialsById.set('bay-test-tiles', { id: 'bay-test-tiles', category: 'tile', manufacturer: 'Test', productName: 'Bay test courses',
  pbr: { baseColor: '#ffffff', baseColorTextureUrl: texture.toDataURL(), repeatX: 1, repeatY: 1, roughness: 0.8 } })
const noop = () => {}
const camera = new PerspectiveCamera()
camera.position.set(7, 6, 9); camera.lookAt(0, 2, 1)
const cameraViewState = { position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
  quaternion: { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w } }
function Regression() {
  const [floor, setFloor] = useState(initialFloor)
  const [preview, setPreview] = useState<RoofPlacementPreview | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [roofMode, setRoofMode] = useState(true)
  const updateRoof = (id: string, updates: Partial<RoofStructure>) => setFloor(f => ({ ...f, roofs: f.roofs?.map(r => r.id === id ? { ...r, ...updates } : r) }))
  Object.assign(window, { bayRegression: { floor, preview, points }, bayStage: () => Konva.stages[0],
    bayScene: () => [..._roots.values()][0]?.store.getState(),
    loadBay: () => setFloor({ ...initialFloor, roofs: [{ ...createBayRoofLayout(points)!, id: 'bay', type: 'bay', pitchDegrees: 35, overhangSide: 0.25 }] }),
    loadRoof: (type: RoofStructure['type'], thickness = 0.04) => {
      setFloor({ ...initialFloor, roofs: [{ ...createBayRoofLayout(points)!, id: 'bay', type, thickness, pitchDegrees: 35, overhangSide: 0.25 }] })
      setSelected('bay'); setRoofMode(false)
    },
  })
  return <>
    <FloorplanCanvas activeFloor={floor} floors={[floor]} initialViewport={{ x: 360, y: 240, scale: 1 }}
      internalWallThickness={0.1} isAddingWall={false} isRoofMode={roofMode} modelAssetVersion={0} projectFileName="Bay test"
      selectedModelId={null} selectedModelIds={[]} selectedRoofId={selected} selectedRoomSignature={null} selectedWallId={null} selectedWallIds={[]}
      wallHeight={2.4} wallKind="external" onAddWall={noop} onAddRoof={options => { setFloor(f => ({ ...f, roofs: [...f.roofs ?? [], { ...options, id: 'bay' } as RoofStructure] })); setSelected('bay') }}
      onDeleteModel={noop} onDeleteRoof={noop} onDeleteWall={noop} onExitAddWall={noop} onViewportChange={noop}
      onSelectModel={noop} onSelectRoof={setSelected} onSelectRoom={noop} onSelectWall={noop} onRoofPlacementPreviewChange={setPreview}
      onUpdateModel={noop} onUpdateRoof={updateRoof} onUpdateWall={noop} onUpdateWalls={noop} viewportRestoreRevision={1} />
    <ThreeDView roofPlacementPreview={preview} activeFloorId={floor.id} floors={[floor]} isEngineConsoleOpen={false}
      cameraViewState={cameraViewState} cameraRestoreRevision={1} onCameraViewStateChange={noop}
      lightDirection={{ azimuth: -1.18, elevation: 0.73 }} modelAssetVersion={0}
      onClearSelection={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop}
      onSelectFloor={noop} onSelectModel={noop} onSelectRoof={setSelected} onSelectSurface={noop} onUpdateModel={noop}
      selectedModelId={null} selectedRoofId={selected} selectedSurface={null} selectedWallId={null} sceneRevision={1} showAllFloors
      surfaceAssignments={['bay', '__roof-placement-preview__'].map(id => ({ id, materialId: 'bay-test-tiles', target: { type: 'roof', floorId: floor.id, roofId: id } }))} />
  </>
}
createRoot(document.getElementById('root')!).render(<Regression />)
