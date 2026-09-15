import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { _roots } from '@react-three/fiber'
import { Mesh, Raycaster, Vector3 } from 'three'
import { ThreeDView } from '../../src/components/ThreeDView'
import redHouse from '../../red_house_3.json'
import roofTests from '../../roof_tests.json'
import springfield from '../../springfield_13.json'
import '../../src/App.css'
import { loadPortalCatalog } from '../../src/portalCatalog'
import { registerRuntimeSurfaceMaterials } from '../../src/materials/materialCatalog'
import type { FloorLevel, SelectableSurface, SurfaceMaterialAssignment } from '../../src/types'

if (new URLSearchParams(location.search).has('materials')) {
  registerRuntimeSurfaceMaterials((await loadPortalCatalog()).materials)
}

const noop = () => {}
const searchParams = new URLSearchParams(location.search)
const isSpringfield = searchParams.has('springfield')
const isRoofTests = searchParams.has('roof-tests')
const savedProject = isRoofTests ? roofTests : isSpringfield ? springfield : redHouse
const groundOnly = searchParams.has('ground')
const showPreview = searchParams.has('preview')
const sourceFloors = groundOnly ? [savedProject.floors[0]] : savedProject.floors
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
  const passed = isSpringfield
    ? springfieldGable.length === 3 && springfieldGable.every(({ minX }) => minX < 5.36) && gableFilled && leanToMeetsFacade && leanToInfillBounded
    : boundaries.length === 3 && boundaries.every(({ minX }) => Math.abs(minX - 1.35) < 1e-5)
  document.documentElement.dataset.regression = passed ? 'passed' : 'failed'
  Object.assign(window, { roofWallRegression: { passed, groundOnly, isSpringfield, gableFilled, leanToMeetsFacade, leanToInfillBounded, boundaries } })
}, 12000)
