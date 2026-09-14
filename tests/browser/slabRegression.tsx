import React from 'react'
import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { AmbientLight, Box3 } from 'three'
import { ThreeDView } from '../../src/components/ThreeDView'
import { getFloorEnvelopeWalls } from '../../src/floorEnvelope'
import { surfaceMaterialsById } from '../../src/materials/materialCatalog'
import savedProject from '../../red_house_2.json'
import '../../src/App.css'

const actual = new URLSearchParams(location.search).has('actual')
const singleFloor = new URLSearchParams(location.search).get('floor')
const activeIndex = singleFloor === '0' ? 0 : 1
const project = actual ? await (await fetch('/red_house_3.json')).json() : savedProject
const lower = { ...project.floors[0], models: [], roofs: [] }
const upper = {
  ...lower, id: 'regression-upper', elevation: 2.7, rooms: [],
  walls: getFloorEnvelopeWalls(lower.walls).map(wall => ({
    ...wall, id: `upper-${wall.id}`, kind: 'external', openings: [],
  })),
}
const material = { id: 'regression-red', category: 'wall-covering', manufacturer: 'Test',
  productName: 'Test', pbr: { baseColor: '#a33b22', roughness: 0.8 } }
surfaceMaterialsById.set(material.id, material as never)
const floors = actual ? project.floors.map(f => ({...f, models: [], roofs: []})) : [lower, upper]
if (actual) {
  // Retain the real assignments, but avoid network-dependent texture loading.
  for (const assignment of project.surfaceAssignments) {
    surfaceMaterialsById.set(assignment.materialId, { ...material, id: assignment.materialId } as never)
  }
}
const noop = () => {}
createRoot(document.getElementById('root')!).render(<ThreeDView
  roofPlacementPreview={null}
  activeFloorId={floors[activeIndex].id} floors={floors as never} isEngineConsoleOpen={false}
  lightDirection={project.sunPosition} modelAssetVersion={1}
  onClearSelection={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop}
  onSelectFloor={noop} onSelectModel={noop} onSelectRoof={noop} onSelectSurface={noop}
  onUpdateModel={noop} selectedModelId={null} selectedRoofId={null} selectedSurface={null}
  selectedWallId={null} sceneRevision={1} showAllFloors={singleFloor === null}
  surfaceAssignments={actual ? project.surfaceAssignments : floors.flatMap(floor => floor.walls.map(wall => ({
    id: wall.id, materialId: material.id, target: { type: 'wall-face', wallId: wall.id, side: 'both' },
  })))}
/>)
setTimeout(() => {
  const state = [..._roots.values()][0]?.store.getState()
  if (state) {
    state.scene.add(new AmbientLight('#ffffff', singleFloor === null ? 2 : 0.4))
    state.camera.position.set(...(actual && singleFloor === null ? [4.5, 3.8, 10.5] : [-20, 14, -18]) as [number, number, number])
    state.camera.lookAt(...(actual && singleFloor === null ? [1.35, 2.55, 8.1] : [-2, 2, 4]) as [number, number, number])
    state.invalidate()
  }
}, 7000)
setTimeout(() => {
  const debug = (window as any).houseDesignerWallRenderDebug
  const state = [..._roots.values()][0]?.store.getState()
  const blockerChecks: Array<{ flatAtWallTop: boolean; invisible: boolean }> = []
  state?.scene.traverse((object: any) => {
    if (object.userData.houseDesignerRole !== 'ceiling-shadow-blocker') return
    const bounds = new Box3().setFromObject(object)
    const expectedY = floors[activeIndex].elevation + floors[activeIndex].roomHeight
    blockerChecks.push({
      flatAtWallTop: Math.abs(bounds.min.y - expectedY) < 1e-6 && Math.abs(bounds.max.y - expectedY) < 1e-6,
      invisible: !object.material.colorWrite && !object.material.depthWrite,
    })
  })
  const passed = singleFloor === null
    ? blockerChecks.length === 0
    : blockerChecks.length > 0 && blockerChecks.every(check => check.flatAtWallTop && check.invisible)
  document.documentElement.dataset.regression = passed ? 'passed' : 'failed'
  document.getElementById('diagnostics')!.textContent = JSON.stringify({
    passed, blockerChecks,
    slabs: debug?.ceilingSlabs(), edges: debug?.ceilingSlabEdges(),
    objects: debug?.sceneObjects(),
  })
}, 12000)
