import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { Mesh, Raycaster, Vector3 } from 'three'
import { ThreeDView } from '../../src/components/ThreeDView'
import redHouse from '../../red_house_3.json'
import roofTests from '../../roof_tests.json'
import roofTests1 from '../../roof_tests_1.json'
import roofTests2 from '../../roof_tests_2.json'
import springfield from '../../springfield_13.json'
import '../../src/App.css'
import { loadPortalCatalog } from '../../src/portalCatalog'
import { registerRuntimeSurfaceMaterials } from '../../src/materials/materialCatalog'
import { modelsById, registerRuntimeModels, type ModelDefinition } from '../../src/models/modelLibrary'
import { normalizeFloor } from '../../src/modelPlacement'
import type { FloorLevel, SelectableSurface, SurfaceMaterialAssignment } from '../../src/types'

const noop = () => {}
const searchParams = new URLSearchParams(location.search)
const isSpringfield = searchParams.has('springfield')
const isRoofTests = searchParams.has('roof-tests')
const isRoofTests1 = searchParams.has('roof-tests-1')
const isRoofTests2 = searchParams.has('roof-tests-2')
const isRedHouseDoor = searchParams.has('red-house-door')
const savedProject = isRoofTests2 ? roofTests2 : isRoofTests1 ? roofTests1 : isRoofTests ? roofTests : isSpringfield ? springfield : redHouse
// Match the editor's load path: model definitions determine doorway reveals
// and therefore the solid boundaries used when closing roof junctions.
if ('modelDefinitions' in savedProject && Array.isArray(savedProject.modelDefinitions)) {
  registerRuntimeModels(savedProject.modelDefinitions as unknown as ModelDefinition[])
}
if (searchParams.has('materials')) {
  const catalog = await loadPortalCatalog()
  registerRuntimeSurfaceMaterials(catalog.materials)
  registerRuntimeModels(catalog.models)
}
const groundOnly = searchParams.has('ground')
const showPreview = searchParams.has('preview')
const sourceFloors = (groundOnly ? [savedProject.floors[0]] : savedProject.floors)
  .map(floor => normalizeFloor(floor as unknown as FloorLevel, modelsById))
const previewSource = sourceFloors[0].roofs?.[0]
const floors = showPreview && previewSource
  ? sourceFloors.map((floor, index) => index === 0 ? { ...floor, roofs: [] } : floor)
  : sourceFloors
function RegressionScene() {
  const [activeFloorId, setActiveFloorId] = useState(groundOnly ? floors[0].id : savedProject.activeFloorId)
  const [sunPosition, setSunPosition] = useState(savedProject.sunPosition)
  const [sceneFloors, setSceneFloors] = useState(floors as unknown as FloorLevel[])
  const [selection, setSelection] = useState<string | null>(null)
  const [surfaceSelection, setSurfaceSelection] = useState<SelectableSurface | null>(null)
  const [assignments, setAssignments] = useState(savedProject.surfaceAssignments as SurfaceMaterialAssignment[])
  Object.assign(window, {
    updateRegressionFloors: setSceneFloors,
    selectRegressionModel: setSelection,
    regressionSelectedModelId: selection,
    updateRegressionActiveFloor: setActiveFloorId,
    regressionFloors: sceneFloors,
    regressionSurface: surfaceSelection,
    regressionAssignments: assignments,
    updateRegressionAssignments: setAssignments,
    regressionSunPosition: sunPosition,
  })
  return <ThreeDView
  roofPlacementPreview={showPreview && previewSource ? {
    floorId: sourceFloors[0].id,
    roof: { ...previewSource, id: '__roof-placement-preview__' },
  } : null}
  activeFloorId={activeFloorId} floors={sceneFloors}
  cameraRestoreRevision={1} cameraViewState={savedProject.threeDView.camera}
  isEngineConsoleOpen={false} lightDirection={sunPosition}
  modelAssetVersion={1} onCameraViewStateChange={noop} onClearSelection={noop}
  onEngineConsoleOpenChange={noop} onLightDirectionChange={position => {
    const counters = window as unknown as { regressionSunCommits?: number }
    counters.regressionSunCommits = (counters.regressionSunCommits ?? 0) + 1
    setSunPosition(position)
  }}
  onSelectFloor={noop} onSelectModel={setSelection} onSelectRoof={(roofId, floorId) => setSurfaceSelection({ type: 'roof', roofId, floorId })} onSelectSurface={setSurfaceSelection}
  onUpdateModel={noop} selectedModelId={selection} selectedRoofId={null}
  selectedSurface={surfaceSelection} selectedWallId={null} sceneRevision={1} showAllFloors
  surfaceAssignments={assignments}
/>
}
createRoot(document.getElementById('root')!).render(<RegressionScene />)

// Expose camera controls for repeatable inspection from both roof ends.
Object.assign(window, { roofWallScene: () => [..._roots.values()][0]?.store.getState() })

setTimeout(() => {
  const state = [..._roots.values()][0]?.store.getState()
  const boundaries: Array<{ role: string; roofId: string; minX: number; maxX: number }> = []
  state?.scene.traverse((object) => {
    if (!(object instanceof Mesh) || !['roof-top', 'roof-shell', 'roof-eaves'].includes(object.userData.houseDesignerRole)) return
    const positions = object.geometry.getAttribute('position')
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < positions.count; i++) {
      const world = object.localToWorld(new Vector3().fromBufferAttribute(positions, i))
      minX = Math.min(minX, world.x)
      maxX = Math.max(maxX, world.x)
    }
    boundaries.push({ role: object.userData.houseDesignerRole, roofId: object.userData.roofId, minX, maxX })
  })
  const infillMeshes: Mesh[] = []
  state?.scene.traverse((object) => {
    if (object instanceof Mesh && object.userData.houseDesignerRole === 'roof-infill') infillMeshes.push(object)
  })
  const gableFilled = new Raycaster(new Vector3(16, 5.8, 7.3), new Vector3(-1, 0, 0))
    .intersectObjects(infillMeshes, false).some((hit) => hit.point.x > 14.8 && hit.point.x < 15)
  const springfieldGable = boundaries.filter(({ roofId }) => roofId === '03233f9a-f497-49c7-ac08-cc12e288c142')
  const leanToId = '50d9f27a-ff90-4121-88dc-08d2bbb09e32'
  const leanToTop = boundaries.find(({ roofId, role }) => roofId === leanToId && role === 'roof-top')
  const leanToMeetsFacade = !!leanToTop && Math.abs(leanToTop.maxX - 5.359627581803311) < 1e-5
  const leanToInfill = infillMeshes.filter((mesh) => mesh.userData.roofId === leanToId)
  const leanToInfillBounded = leanToInfill.length > 0 && leanToInfill.every((mesh) => {
    const positions = mesh.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      if (mesh.localToWorld(new Vector3().fromBufferAttribute(positions, i)).y > 3.5) return false
    }
    return true
  })
  const roofTests2JoinedTop = (() => {
    let extended = false
    state?.scene.traverse(object => {
      if (!(object instanceof Mesh) || object.userData.houseDesignerRole !== 'roof-top' ||
        object.userData.roofId !== '5ce7ce3c-c5d2-4a22-8032-bed5d337e865') return
      const positions = object.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        if (positions.getZ(i) < -2.8) extended = true
      }
    })
    return extended
  })()
  const roofTests2CeilingShadows = (() => {
    const blockers: Mesh[] = []
    state?.scene.traverse(object => {
      if (object instanceof Mesh && object.userData.houseDesignerRole === 'room-ceiling-shadow-blocker') {
        blockers.push(object)
      }
    })
    return blockers.some(mesh => mesh.castShadow && !mesh.visible) &&
      new Raycaster(new Vector3(2.4, 4, 5.4), new Vector3(0, -1, 0))
        .intersectObjects(blockers, false).some(hit => Math.abs(hit.point.y - 2.38) < 0.01)
  })()
  // The crossing roof in roof_tests_1 has only a partial supporting wall at
  // this end. Its gable must still close the opening above the other roof.
  const gableTarget = new Vector3(4.312, 4.25, 5.85)
  const roofTestsGableHit = state ? new Raycaster(
    state.camera.position.clone(),
    gableTarget.sub(state.camera.position).normalize(),
  ).intersectObjects(infillMeshes, false)
    .some(hit => hit.object.userData.roofId === 'f6df8580-9ce1-48ce-88b4-3d2e03d357cc' &&
      Math.abs(hit.point.x - 4.312) < 0.02 && hit.point.y > 4.1) : false
  const doorHeight = 3.7
  const doorDepth = 5.24313
  const nearDoorGable = new Raycaster(
    new Vector3(2, doorHeight, doorDepth), new Vector3(-1, 0, 0),
  ).intersectObjects(infillMeshes, false).some(hit =>
    hit.object.userData.roofId === 'b490e12e-e2cc-4509-801c-33d0e68a1aa2' &&
    hit.point.x > 1 && hit.point.x < 1.2)
  const nearDoorLooseStrip = infillMeshes.some(mesh => {
    if (mesh.userData.roofId !== 'b490e12e-e2cc-4509-801c-33d0e68a1aa2' ||
      mesh.userData.wallId !== '4046e47d-aaec-4ec1-a7f4-c63f146eeea2') return false
    const positions = mesh.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) < 5) return true
    }
    return false
  })
  const farGable = new Raycaster(
    new Vector3(0, doorHeight, doorDepth), new Vector3(1, 0, 0),
  ).intersectObjects(infillMeshes, false).some(hit =>
    hit.object.userData.roofId === 'b490e12e-e2cc-4509-801c-33d0e68a1aa2' &&
    hit.point.x > 5.8 && hit.point.x < 6)
  const passed = isSpringfield
    ? springfieldGable.length === 3 && springfieldGable.every(({ minX }) => minX < 5.36) && gableFilled && leanToMeetsFacade && leanToInfillBounded
    : isRoofTests2 ? roofTests2JoinedTop && roofTests2CeilingShadows
    : isRoofTests1 ? roofTestsGableHit
    : isRedHouseDoor ? !nearDoorGable && !nearDoorLooseStrip && farGable
    : boundaries.length === 3 && boundaries.every(({ minX }) => Math.abs(minX - 1.35) < 1e-5)
  document.documentElement.dataset.regression = passed ? 'passed' : 'failed'
  Object.assign(window, { roofWallRegression: { passed, groundOnly, isSpringfield, gableFilled, roofTests2JoinedTop, roofTests2CeilingShadows, roofTestsGableHit, nearDoorGable, nearDoorLooseStrip, farGable, leanToMeetsFacade, leanToInfillBounded, boundaries } })
}, 12000)
