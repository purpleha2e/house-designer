import './rendererPhase5Probe'
import React,{Profiler,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {_roots} from '@react-three/fiber'
import {ThreeDView} from '../../src/components/ThreeDView'
import {HouseViewer} from '../../src/viewer/HouseViewer'
import {modelsById,registerRuntimeModels} from '../../src/models/modelLibrary'
import {registerRuntimeSurfaceMaterials} from '../../src/materials/materialCatalog'
import {normalizeFloor} from '../../src/modelPlacement'
import {loadPortalCatalog} from '../../src/portalCatalog'
import type {FloorLevel} from '../../src/types'
import type {PublishedHouse} from '../../src/viewer/viewerProject'
import '../../src/App.css'
const project=await(await fetch('/colin_house_v2.json')).json()
if(new URLSearchParams(location.search).has('mainFeatures')){
 const {installMainShaderFeatures}=await import('./rendererAuditFeatures.js');installMainShaderFeatures()
}
const catalog=await loadPortalCatalog()
registerRuntimeModels([...catalog.models,...project.modelDefinitions??[]])
registerRuntimeSurfaceMaterials([...catalog.materials,...project.materialDefinitions??[]])
const floors:FloorLevel[]=project.floors.map((f:FloorLevel)=>normalizeFloor(f,modelsById))
const noop=()=>{}
const auditBridge={development:import.meta.env.DEV,
 installAudit:async()=>{const {installRendererAudit}=await import('./rendererAuditProbe.js');return installRendererAudit([..._roots.values()][0]!.store.getState())},
 modules:()=>import('./rendererTestModules.ts'),
 profileMain:async(duration=5000,moving=true)=>{
  const {profileMainScene}=await import('./rendererAuditMainScene.js');return profileMainScene([..._roots.values()][0]!.store.getState(),(window as unknown as {rendererAudit:Parameters<typeof profileMainScene>[1]}).rendererAudit,duration,moving)
 },
 uniformExperiment:async()=>{
  const {installUniformArrayExperiment}=await import('./rendererAuditUniformArrays.js');return installUniformArrayExperiment([..._roots.values()][0]!.store.getState().gl)
 },
 windowExperiment:async()=>{
  const {installWindowBatchExperiment}=await import('./rendererAuditWindowBatch.js');return installWindowBatchExperiment([..._roots.values()][0]!.store.getState())
 },
 pairedRender:async(duration:number,control:Parameters<typeof import('./rendererAuditPair.js')['pairedRender']>[2],moving=false)=>{
  const {pairedRender}=await import('./rendererAuditPair.js');return pairedRender([..._roots.values()][0]!.store.getState(),duration,control,moving)
 }}
const fixedCamera={...project.threeDView.camera,position:{...project.threeDView.camera.position,y:project.floors.find((f:FloorLevel)=>f.id===project.activeFloorId).elevation+1.8}}
const house={title:'Renderer recovery — full furnished Colin house',project,
 startCamera:fixedCamera,
 materials:[...catalog.materials,...project.materialDefinitions??[]]} as PublishedHouse
const requested=new URLSearchParams(location.search).get('view')==='walk'?'walk':'building'
function RecoveryFixture(){
 const [view,setView]=useState<'building'|'walk'>(requested),[visible,setVisible]=useState(true)
 const [sceneFloors,setSceneFloors]=useState(floors),[sun,setSun]=useState(project.sunPosition)
 const [assignments,setAssignments]=useState(project.surfaceAssignments)
 const [revision,setRevision]=useState(1)
 Object.assign(window,{rendererRecovery:{...auditBridge,setView,setVisible,view,visible,revision,projectModels:floors.reduce((n,f)=>n+f.models.length,0),
  testFurniture:(add:boolean)=>setSceneFloors(add?floors.map((f,i)=>i?f:{...f,models:[...f.models,{...f.models[0],id:'renderer-audit-temporary-model',position:{...f.models[0].position,x:f.models[0].position.x+.5}}]}):floors),
  testTransforms:(change:boolean)=>setSceneFloors(change?floors.map((f,i)=>i?f:{...f,models:f.models.map(m=>m.id===floors[0].models.find(m=>!m.wallAttachment)!.id?{...m,position:{...m.position,x:m.position.x+.1}}:m)}):floors),
  testOpenings:(change:boolean)=>setSceneFloors(change?floors.map((f,i)=>i?f:{...f,walls:f.walls.map(w=>({...w,openings:w.openings?.map(o=>({...o,width:o.width+.02}))}))}):floors),
  transformTest:{id:floors[0].models.find(m=>!m.wallAttachment)!.id,originalX:floors[0].models.find(m=>!m.wallAttachment)!.position.x},
  openingTest:{id:floors[0].walls.find(w=>w.openings?.length)!.openings![0].id,originalWidth:floors[0].walls.find(w=>w.openings?.length)!.openings![0].width},
  testSun:(change:boolean)=>setSun(change?{...project.sunPosition,azimuth:project.sunPosition.azimuth+.05}:{...project.sunPosition}),
  testRevision:()=>setRevision(value=>value+1),
  testFinish:(change:boolean)=>setAssignments(change?project.surfaceAssignments.map((a:object,i:number)=>i?a:{...a,customColor:'#778899'}):project.surfaceAssignments),
  state:()=>[..._roots.values()][0]?.store.getState()}})
 if(!visible)return <div>2D mode — renderer unmounted</div>
 if(view==='walk')return <HouseViewer house={house}/>
 return <ThreeDView floors={sceneFloors} activeFloorId={project.activeFloorId} showAllFloors
  lightingUpdateMode="preview" surfaceAssignments={assignments}
  ambientLighting={project.threeDView?.ambientLighting} cameraRestoreRevision={1} cameraViewState={fixedCamera}
  diffuseProbeResolution={project.threeDView?.diffuseProbeResolution??16} lightDirection={sun} modelAssetVersion={1}
  placementModel={null} roofPlacementPreview={null} selectedModelId={null} selectedRoofId={null} selectedSurface={null}
  selectedWallId={null} sceneRevision={revision} isEngineConsoleOpen={false} onCancelModelPlacement={noop} onClearSelection={noop}
  onCameraViewStateChange={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop} onPlaceModel={noop}
  onSelectFloor={noop} onSelectModel={noop} onSelectRoof={noop} onSelectSurface={noop} onUpdateModel={noop}/>
}
const reactProfile={commits:0,totalMs:0,maxMs:0}
Object.assign(window,{rendererAuditReact:reactProfile})
createRoot(document.getElementById('root')!).render(<Profiler id="renderer-audit-ui" onRender={(_,__,ms)=>{reactProfile.commits++;reactProfile.totalMs+=ms;reactProfile.maxMs=Math.max(reactProfile.maxMs,ms)}}><RecoveryFixture/></Profiler>)
