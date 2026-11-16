import {createRoot} from 'react-dom/client'
import {_roots} from '@react-three/fiber'
import {ThreeDView} from '../../src/components/ThreeDView'
import {HouseViewer} from '../../src/viewer/HouseViewer'
import {registerRuntimeModels} from '../../src/models/modelLibrary'
import {registerRuntimeSurfaceMaterials} from '../../src/materials/materialCatalog'
import '../../src/index.css'
import '../../src/App.css'
const house=await(await fetch('/.viewer-data/public/house.json')).json()
const local=JSON.parse(JSON.stringify(house).replaceAll('./published-assets/','/.viewer-data/public/published-assets/'))
registerRuntimeModels(local.project.modelDefinitions)
registerRuntimeSurfaceMaterials(local.materials)
const p=local.project,noop=()=>{}
Object.assign(window,{exportHouse:house,exportState:()=>[..._roots.values()][0]?.store.getState()})
const root=createRoot(document.getElementById('root')!)
const verify=()=>root.render(<HouseViewer house={{...local,project:{...p,indirectLighting:(window as any).exportCache}}}/> )
Object.assign(window,{verifyExport:verify})
root.render(<div style={{height:'100vh',display:'flex'}}><ThreeDView
 activeFloorId={p.activeFloorId} floors={p.floors} cameraRestoreRevision={1} cameraViewState={p.threeDView.camera}
 savedIndirectLighting={p.indirectLighting} onIndirectLightingReady={cache=>{if(cache)(window as any).exportCache=cache}}
 ambientLighting={p.threeDView.ambientLighting} diffuseProbeResolution={p.threeDView.diffuseProbeResolution}
 exposureStops={p.threeDView.exposureStops} lightDirection={p.sunPosition} surfaceAssignments={p.surfaceAssignments}
 modelAssetVersion={0} isEngineConsoleOpen={false} placementModel={null} roofPlacementPreview={null}
 selectedModelId={null} selectedRoofId={null} selectedSurface={null} selectedWallId={null}
 sceneRevision={0} showAllFloors onCancelModelPlacement={noop} onClearSelection={noop}
 onCameraViewStateChange={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop}
 onPlaceModel={noop} onSelectFloor={noop} onSelectModel={noop} onSelectRoof={noop} onSelectSurface={noop} onUpdateModel={noop}/></div>)
