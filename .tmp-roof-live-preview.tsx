import { useState } from 'react'
import { _roots } from '@react-three/fiber'
import { createRoot } from 'react-dom/client'
import Konva from 'konva'
import { FloorplanCanvas, type RoofPlacementPreview } from './src/components/FloorplanCanvas'
import { ThreeDView } from './src/components/ThreeDView'
import { DEFAULT_THREE_D_CAMERA_STATE } from './src/projectViewState'
import type { FloorLevel, RoofStructure } from './src/types'
import './src/App.css'

const noop = () => {}
const points = [{x:1,y:1},{x:5,y:1},{x:5,y:2},{x:4,y:4},{x:2,y:4},{x:1,y:2}]
const initial: FloorLevel = { id:'bay-floor', name:'Bay placement', elevation:0, roomHeight:2.4,
  slabThickness:0.2, rooms:[], roofs:[], models:[], walls:points.map((start,i)=>({
    id:`wall-${i}`,start,end:points[(i+1)%points.length],kind:'external',thickness:0.2,height:2.4,
  })) }
const project = await (await fetch('/colin_house_v2.json')).json() as {floors:FloorLevel[]}
function Preview() {
  const [floor,setFloor]=useState<FloorLevel>(project.floors[0])
  const [roofMode,setRoofMode]=useState(true)
  const [selection,setSelection]=useState<string|null>(null)
  const [preview,setPreview]=useState<RoofPlacementPreview|null>(null)
  const updateRoof=(id:string,updates:Partial<RoofStructure>)=>setFloor(current=>({...current,
    roofs:current.roofs?.map(roof=>roof.id===id?{...roof,...updates}:roof)}))
  Object.assign(window,{ bayStage:()=>Konva.stages[0], bayFloor:floor, bayPreview:preview,
    bayRoofMode:setRoofMode, baySelectRoof:setSelection, bayScene:()=>[..._roots.values()][0]?.store.getState() })
  return <><FloorplanCanvas activeFloor={floor} floors={[floor,...project.floors.slice(1)]} initialViewport={{x:500,y:-220,scale:1.3}}
    internalWallThickness={0.15} isAddingWall={false} isRoofMode={roofMode} modelAssetVersion={1} placementModel={null}
    projectFileName="Bay roof placement" selectedModelId={null} selectedModelIds={[]} selectedRoofId={selection}
    selectedRoomSignature={null} selectedWallId={null} selectedWallIds={[]} wallHeight={2.4} wallKind="external"
    onAddWall={noop} onAddRoof={options=>{const {floorId,...roof}=options;void floorId;
      setFloor(current=>({...current,roofs:[...(current.roofs??[]),{...roof,id:'created-bay',position:roof.position!,depth:roof.depth!,rotation:roof.rotation!}]}))}}
    onCancelModelPlacement={noop} onDeleteModel={noop} onDeleteRoof={noop} onDeleteWall={noop} onExitAddWall={noop}
    onViewportChange={noop} onSelectModel={noop} onSelectRoof={setSelection} onSelectRoom={noop} onSelectWall={noop}
    onRoofPlacementPreviewChange={setPreview} onPlaceModel={noop} onUpdateModel={noop} onUpdateRoof={updateRoof}
    onUpdateWall={noop} onUpdateWalls={noop} viewportRestoreRevision={1} />
    <ThreeDView activeFloorId={floor.id} floors={[floor,...project.floors.slice(1)]} cameraRestoreRevision={1}
      cameraViewState={DEFAULT_THREE_D_CAMERA_STATE} isEngineConsoleOpen={false}
      lightDirection={{azimuth:135,elevation:40}} modelAssetVersion={1} placementModel={null}
      roofPlacementPreview={preview} onCancelModelPlacement={noop} onClearSelection={noop}
      onCameraViewStateChange={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop}
      onPlaceModel={noop} onSelectFloor={noop} onSelectModel={noop} onSelectRoof={setSelection} onSelectSurface={noop}
      onUpdateModel={noop} selectedModelId={null} selectedRoofId={selection} selectedSurface={null}
      selectedWallId={null} sceneRevision={1} showAllFloors={false} surfaceAssignments={[]} /></>
}
createRoot(document.getElementById('root')!).render(<Preview />)

