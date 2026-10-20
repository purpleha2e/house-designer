import { useCallback, useRef, useState } from 'react'
import { ThreeDView } from '../components/ThreeDView'
import { modelsById, registerRuntimeModels } from '../models/modelLibrary'
import { registerRuntimeSurfaceMaterials } from '../materials/materialCatalog'
import type { Point, ThreeDViewCameraState } from '../types'
import { getViewerStartCamera, VIEWER_HEAD_HEIGHT, type ViewerNavigationMode } from './viewerNavigation'
import type { PublishedHouse } from './viewerProject'
import { ViewerTouchControls } from './ViewerTouchControls'
import { createViewerTouchInput, ViewerTouchContext } from './viewerTouchInput'
import { prepareViewerFloors } from './viewerFloors'
import { ViewerFullscreenButton } from './ViewerFullscreenButton'
import { useViewerViewport } from './useViewerViewport'
import { useViewerTouchDevice } from './useViewerTouchDevice'
import './HouseViewer.css'

const noop = () => {}

function prepareHouse(house: PublishedHouse) {
  registerRuntimeModels(house.project.modelDefinitions ?? [])
  registerRuntimeSurfaceMaterials(house.materials)
  return prepareViewerFloors(house.project, modelsById)
}

/** Independent viewer entry: it never mounts the editor or writes project state. */
export function HouseViewer({ house }: { house: PublishedHouse }) {
  const viewerRef = useRef<HTMLElement>(null)
  useViewerViewport(viewerRef)
  const touchDevice = useViewerTouchDevice()
  const [floors] = useState(() => prepareHouse(house))
  const initialFloor = floors.find(floor => floor.id === house.project.activeFloorId) ?? floors[0]
  const [activeFloorId, setActiveFloorId] = useState(initialFloor.id)
  const [mode, setMode] = useState<ViewerNavigationMode>('walk')
  const [menuOpen, setMenuOpen] = useState(false)
  const [touchInput] = useState(createViewerTouchInput)
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
    <ViewerTouchContext.Provider value={touchInput}>
    <main ref={viewerRef} className="house-viewer" aria-label="Read-only house viewer">
      <ThreeDView readOnly viewerTouchDevice={touchDevice} viewerMode={mode} onViewerStairs={navigate}
        savedIndirectLighting={house.project.indirectLighting}
        diffuseProbeResolution={house.project.threeDView?.diffuseProbeResolution}
        viewerToolbar={aspectControls => (
          <header className="viewer-toolbar" aria-label="House viewer controls">
            <button type="button" className="viewer-menu-toggle" aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Close tour menu' : 'Open tour menu'}
              aria-controls="viewer-options" onClick={() => setMenuOpen(open => !open)}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} />
              </svg>
            </button>
            <div id="viewer-options" className={`viewer-options${menuOpen ? ' is-open' : ''}`}>
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
            {aspectControls}
            <ViewerFullscreenButton target={viewerRef} />
            <aside className="viewer-help" aria-label="Navigation instructions">
              <strong>{mode === 'walk' ? 'Walk at head height' : 'Fly freely'}</strong>
              <span>Touch: left joystick moves; drag the right side to look.</span>
              <span>Keyboard: W/S forward/back, A/D sideways. Hold left mouse button and drag to look.</span>
              <span>{mode === 'walk' ? 'Use the stair buttons or Upstairs / Downstairs to change floors.' : 'Look up/down and move forward to fly, or use Q/E to descend/rise.'}</span>
              <span>Xbox: left stick moves, right stick looks. For VR, open the tour in your headset browser.</span>
            </aside>
            </div>
          </header>
        )}
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
      <ViewerTouchControls input={touchInput} resetKey={`${mode}:${restore.revision}`} suspended={menuOpen} />
    </main>
    </ViewerTouchContext.Provider>
  )
}
