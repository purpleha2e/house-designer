import { useCallback, useRef, useState } from 'react'
import { ThreeDView } from '../components/ThreeDView'
import { modelsById, registerRuntimeModels } from '../models/modelLibrary'
import { registerRuntimeSurfaceMaterials } from '../materials/materialCatalog'
import { normalizeFloor } from '../modelPlacement'
import type { Point, ThreeDViewCameraState } from '../types'
import { getViewerStartCamera, VIEWER_HEAD_HEIGHT, type ViewerNavigationMode } from './viewerNavigation'
import type { PublishedHouse } from './viewerProject'
import './HouseViewer.css'

const noop = () => {}

function prepareHouse(house: PublishedHouse) {
  registerRuntimeModels(house.project.modelDefinitions ?? [])
  registerRuntimeSurfaceMaterials(house.materials)
  return house.project.floors.map(floor => normalizeFloor(floor, modelsById))
    .sort((a, b) => a.elevation - b.elevation)
}

/** Independent viewer entry: it never mounts the editor or writes project state. */
export function HouseViewer({ house }: { house: PublishedHouse }) {
  const [floors] = useState(() => prepareHouse(house))
  const initialFloor = floors.find(floor => floor.id === house.project.activeFloorId) ?? floors[0]
  const [activeFloorId, setActiveFloorId] = useState(initialFloor.id)
  const [mode, setMode] = useState<ViewerNavigationMode>('walk')
  // An editor camera can be inside a wall once snapped to head height. Start
  // outside the house unless its owner has provided an explicit tour viewpoint.
  const [initialCamera] = useState(() => house.startCamera ?? getViewerStartCamera(initialFloor))
  const cameraRef = useRef(initialCamera)
  const [restore, setRestore] = useState({ revision: 0, camera: initialCamera })
  const activeFloor = floors.find(floor => floor.id === activeFloorId)!
  const index = floors.indexOf(activeFloor)
  const updateCamera = useCallback((camera: ThreeDViewCameraState) => { cameraRef.current = camera }, [])
  const navigate = useCallback((floorId: string, position?: Point) => {
    const floor = floors.find(candidate => candidate.id === floorId)
    if (!floor) return
    setActiveFloorId(floor.id)
    const camera = { ...cameraRef.current, position: {
      x: position?.x ?? cameraRef.current.position.x,
      y: floor.elevation + VIEWER_HEAD_HEIGHT,
      z: position?.y ?? cameraRef.current.position.z,
    } }
    cameraRef.current = camera
    setRestore(previous => ({ revision: previous.revision + 1, camera }))
  }, [floors])
  const reset = () => {
    setActiveFloorId(initialFloor.id)
    cameraRef.current = initialCamera
    setRestore(previous => ({ revision: previous.revision + 1, camera: initialCamera }))
  }

  return (
    <main className="house-viewer" aria-label="Read-only house viewer">
      <ThreeDView readOnly viewerMode={mode} onViewerStairs={navigate}
        viewerToolbar={
          <header className="viewer-toolbar" aria-label="House viewer controls">
            <div className="viewer-title"><strong>{house.title}</strong><span>Read-only tour</span></div>
            <div className="viewer-modes" role="group" aria-label="Navigation mode">
              {(['walk', 'fly'] as const).map(value => <button key={value} type="button"
                aria-pressed={mode === value} onClick={event => { setMode(value); event.currentTarget.blur() }}>
                {value === 'walk' ? 'Walk' : 'Fly'}
              </button>)}
            </div>
            <div className="viewer-floor-controls" role="group" aria-label="Floor navigation">
              <button type="button" disabled={index === 0} onClick={event => {
                navigate(floors[index - 1].id); event.currentTarget.blur()
              }}>Downstairs</button>
              <span aria-live="polite" aria-label="Current floor">{activeFloor.name}</span>
              <button type="button" disabled={index === floors.length - 1} onClick={event => {
                navigate(floors[index + 1].id); event.currentTarget.blur()
              }}>Upstairs</button>
            </div>
            <button type="button" onClick={event => { reset(); event.currentTarget.blur() }}>Reset view</button>
          </header>
        }
        activeFloorId={activeFloor.id} cameraRestoreRevision={restore.revision} cameraViewState={restore.camera}
        floors={floors} isEngineConsoleOpen={false}
        lightDirection={house.project.sunPosition ?? { azimuth: Math.atan2(6, 4), elevation: 0.78 }}
        modelAssetVersion={0} placementModel={null} roofPlacementPreview={null}
        onCancelModelPlacement={noop} onClearSelection={noop} onCameraViewStateChange={updateCamera}
        onEngineConsoleOpenChange={noop} onLightDirectionChange={noop} onPlaceModel={noop}
        onSelectFloor={navigate} onSelectModel={noop} onSelectRoof={noop} onSelectSurface={noop}
        onUpdateModel={noop} selectedModelId={null} selectedRoofId={null} selectedSurface={null}
        selectedWallId={null} sceneRevision={0} showAllFloors showImages={false}
        surfaceAssignments={house.project.surfaceAssignments ?? []}
      />
      <aside className="viewer-help" aria-label="Navigation instructions">
        <strong>{mode === 'walk' ? 'Walk at head height' : 'Fly freely'}</strong>
        <span>W/S forward/back · A/D sideways · Hold left mouse button and drag to look</span>
        <span>{mode === 'walk' ? 'Click a stair button or use Upstairs / Downstairs to change floors.' : 'Look up/down and move forward to fly, or use Q/E to descend/rise.'} Hold Shift to move faster.</span>
        <span>For VR, open this page in your headset browser and choose Enter VR.</span>
      </aside>
    </main>
  )
}
