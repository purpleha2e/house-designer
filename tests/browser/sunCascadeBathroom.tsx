import React from 'react'
import {createRoot} from 'react-dom/client'
import {_roots} from '@react-three/fiber'
import {PerspectiveCamera} from 'three'
import {ThreeDView} from '../../src/components/ThreeDView'
import {registerRuntimeSurfaceMaterials} from '../../src/materials/materialCatalog'
import {registerRuntimeModels,modelsById} from '../../src/models/modelLibrary'
import {normalizeFloor} from '../../src/modelPlacement'
import type {FloorLevel,SurfaceMaterialAssignment,PlacedModel} from '../../src/types'
import '../../src/App.css'
const project=await(await fetch('/colin_house_v2.json')).json()
registerRuntimeSurfaceMaterials(project.materialDefinitions??[])
registerRuntimeModels(project.modelDefinitions??[])
const floors:FloorLevel[]=project.floors.map((floor:FloorLevel)=>normalizeFloor({...floor,models:floor.models.filter((m:PlacedModel)=>
 m.position.y>11&&m.position.y<15&&m.position.x>4&&m.position.x<9)},modelsById))
const floor=floors[1],camera=new PerspectiveCamera()
camera.position.set(5.1,floor.elevation+1.6,13.0);camera.lookAt(6.15,floor.elevation+.8,13.3)
const view={position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},quaternion:{x:camera.quaternion.x,y:camera.quaternion.y,z:camera.quaternion.z,w:camera.quaternion.w}},noop=()=>{}
Object.assign(window,{bathroomScene:()=>[..._roots.values()][0]?.store.getState()})
createRoot(document.getElementById('root')!).render(<ThreeDView lightingUpdateMode="preview" floors={floors}
 activeFloorId={floor.id} surfaceAssignments={project.surfaceAssignments as SurfaceMaterialAssignment[]} cameraRestoreRevision={1}
 cameraViewState={view} lightDirection={project.sunPosition} modelAssetVersion={1} isEngineConsoleOpen={false}
 placementModel={null} roofPlacementPreview={null} selectedModelId={null} selectedRoofId={null} selectedSurface={null}
 selectedWallId={null} sceneRevision={1} showAllFloors onCancelModelPlacement={noop} onClearSelection={noop}
 onCameraViewStateChange={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop} onPlaceModel={noop}
 onSelectFloor={noop} onSelectModel={noop} onSelectRoof={noop} onSelectSurface={noop} onUpdateModel={noop}/>)
