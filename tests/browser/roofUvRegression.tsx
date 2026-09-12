import React from 'react'
import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { ThreeDView } from '../../src/components/ThreeDView'
import { surfaceMaterialsById } from '../../src/materials/materialCatalog'
import savedProject from '../../red_house_2.json'
import '../../src/App.css'

const floor = {
  ...savedProject.floors[0], models: [],
  roofs: [{
    id: 'uv-roof', type: 'up-and-over', width: 6, depth: 8,
    supportWidth: 6, supportDepth: 8, position: { x: 0, y: 3 },
    supportPosition: { x: 0, y: 3 }, pitchDegrees: 37, rotation: 0,
    overhangSide: 0.5, overhangEnd: 0.5,
  }, {
    id: 'cross-roof', type: 'up-and-over', width: 6, depth: 8,
    supportWidth: 6, supportDepth: 8, position: { x: 0, y: 3 },
    supportPosition: { x: 0, y: 3 }, pitchDegrees: 37, rotation: Math.PI / 2,
    heightOffset: 0.5, overhangSide: 0.5, overhangEnd: 0.5,
  }],
}
const material = {
  id: 'uv-material', category: 'tile', manufacturer: 'Test', productName: 'UV test',
  pbr: { baseColor: '#d97706', roughness: 0.8, repeatX: 1, repeatY: 1 },
}
surfaceMaterialsById.set(material.id, material as never)
const assignment = {
  id: 'uv-assignment', materialId: material.id,
  target: { type: 'roof', floorId: floor.id, roofId: 'uv-roof' },
}
const crossAssignment = {
  ...assignment, id: 'cross-assignment',
  target: { ...assignment.target, roofId: 'cross-roof' },
}
const noop = () => {}
createRoot(document.getElementById('root')!).render(<ThreeDView
  activeFloorId={floor.id} floors={[floor] as never} isEngineConsoleOpen={false}
  lightDirection={savedProject.sunPosition} modelAssetVersion={1}
  onClearSelection={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop}
  onSelectFloor={noop} onSelectModel={noop} onSelectRoof={noop} onSelectSurface={noop}
  onUpdateModel={noop} selectedModelId={null} selectedRoofId={null} selectedSurface={null}
  selectedWallId={null} sceneRevision={1} showAllFloors
  surfaceAssignments={[assignment, crossAssignment] as never}
/>)
setTimeout(() => {
  const state = [..._roots.values()][0]?.store.getState()
  const results: Array<{ roofId: string; vertices: number; uSpan: number; vSpan: number }> = []
  let eaves = 0
  state?.scene.traverse((object: any) => {
    if (object.userData.houseDesignerRole === 'roof-eaves') eaves++
    if (object.userData.houseDesignerRole !== 'roof-top') return
    const uv = object.geometry.getAttribute('uv')
    const us = Array.from({ length: uv.count }, (_, index) => uv.getX(index))
    const vs = Array.from({ length: uv.count }, (_, index) => uv.getY(index))
    results.push({
      roofId: object.userData.roofId,
      vertices: object.geometry.getAttribute('position').count,
      uSpan: Math.max(...us) - Math.min(...us),
      vSpan: Math.max(...vs) - Math.min(...vs),
    })
  })
  const lowerRoof = results.find(result => result.roofId === 'uv-roof')
  const upperRoof = results.find(result => result.roofId === 'cross-roof')
  const passed = results.length === 2 && eaves === 2 &&
    results.every(result => result.uSpan > 7.9 && result.vSpan > 3) &&
    Boolean(lowerRoof && upperRoof && lowerRoof.vertices !== upperRoof.vertices)
  document.documentElement.dataset.regression = passed ? 'passed' : 'failed'
  document.getElementById('diagnostics')!.textContent = JSON.stringify({ passed, eaves, results })
}, 8000)
