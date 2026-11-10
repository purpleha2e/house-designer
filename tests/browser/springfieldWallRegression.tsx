import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {_roots} from '@react-three/fiber'
import {PerspectiveCamera} from 'three'
import {ThreeDView} from '../../src/components/ThreeDView'
import {registerRuntimeSurfaceMaterials} from '../../src/materials/materialCatalog'
import {getIndirectLightingUniforms,updateIndirectUniforms} from '../../src/indirectLightingShader'
import type {FloorLevel,SurfaceMaterialAssignment} from '../../src/types'
import '../../src/App.css'

const project=await (await fetch('/springfield_14.json')).json()
const loft=new URLSearchParams(location.search).has('loft')
registerRuntimeSurfaceMaterials(project.materialDefinitions)
const floors:FloorLevel[]=project.floors.map((floor:FloorLevel,index:number)=>({...floor,models:loft&&index===2?floor.models:[]}))
const assignments:SurfaceMaterialAssignment[]=project.surfaceAssignments.filter((a:SurfaceMaterialAssignment)=>loft||a.target.type==='wall-face'||a.target.type==='wall-surface-fragment')
const camera=new PerspectiveCamera();camera.position.set(7.2,1.5,8.9);camera.lookAt(5.6,1.3,8.3)
const cameraState={position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},
 quaternion:{x:camera.quaternion.x,y:camera.quaternion.y,z:camera.quaternion.z,w:camera.quaternion.w}},noop=()=>{}
Object.assign(window,{springfieldWallScene:()=>[..._roots.values()][0]?.store.getState(),springfieldFloors:floors,
 springfieldGI:{getIndirectLightingUniforms,updateIndirectUniforms}})
// Exercise the editor's actual wall preparation/material/retained-view path;
// furniture assets and their lighting captures are unrelated to this check.
export function SpringfieldWallRegression(){
 const [finishes,setFinishes]=useState(assignments)
 Object.assign(window,{springfieldAssignments:finishes,updateSpringfieldAssignments:setFinishes})
 return <ThreeDView lightingUpdateMode="preview"
 activeFloorId={floors[loft?2:0].id} floors={floors} surfaceAssignments={finishes}
 cameraRestoreRevision={1} cameraViewState={cameraState} lightDirection={project.sunPosition}
 savedIndirectLighting={project.indirectLighting} modelAssetVersion={1} isEngineConsoleOpen={false}
 placementModel={null} roofPlacementPreview={null} selectedModelId={null} selectedRoofId={null}
 selectedSurface={null} selectedWallId={null} sceneRevision={1} showAllFloors
 onCancelModelPlacement={noop} onClearSelection={noop} onCameraViewStateChange={noop}
 onEngineConsoleOpenChange={noop} onLightDirectionChange={noop} onPlaceModel={noop}
 onSelectFloor={noop} onSelectModel={noop} onSelectRoof={noop} onSelectSurface={noop} onUpdateModel={noop}/>
}
createRoot(document.getElementById('root')!).render(<SpringfieldWallRegression/> )
