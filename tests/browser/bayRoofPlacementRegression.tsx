import { useState } from 'react'
import { _roots } from '@react-three/fiber'
import { createRoot } from 'react-dom/client'
import Konva from 'konva'
import { FloorplanCanvas, type RoofPlacementPreview } from '../../src/components/FloorplanCanvas'
import { ThreeDView } from '../../src/components/ThreeDView'
import { DEFAULT_THREE_D_CAMERA_STATE } from '../../src/projectViewState'
import type { FloorLevel, RoofStructure } from '../../src/types'
import leanToFixture from '../fixtures/leanToPlacementRegression.json'
import roofHeightFixture from '../fixtures/roofJoinRegression.json'
import '../../src/App.css'

const noop = () => {}
const leanTo = new URLSearchParams(location.search).has('lean-to')
const roofHeight = new URLSearchParams(location.search).has('roof-height')
const asymmetricCreate = new URLSearchParams(location.search).has('asymmetric-create')
const fixtureFloors = (roofHeight ? roofHeightFixture : leanToFixture).floors as unknown as FloorLevel[]
const points = [{x:1,y:1},{x:5,y:1},{x:5,y:2},{x:4,y:4},{x:2,y:4},{x:1,y:2}]
const initial: FloorLevel = { id:'bay-floor', name:'Bay placement', elevation:0, roomHeight:2.4,
  slabThickness:0.2, rooms:[], roofs:[], models:[], walls:points.map((start,i)=>({
    id:`wall-${i}`,start,end:points[(i+1)%points.length],kind:'external',thickness:0.2,height:2.4,
  })) }
const gablePoints = [{x:1,y:1},{x:5,y:1},{x:5,y:4},{x:1,y:4}]
const gableInitial: FloorLevel = { ...initial, id:'gable-floor', name:'Gable placement',
  walls:gablePoints.map((start,i)=>({id:`gable-wall-${i}`,start,end:gablePoints[(i+1)%gablePoints.length],
    kind:'external',thickness:0.2,height:2.4})),
  roofs:[{id:'height-target',type:'up-and-over',position:{x:10,y:10},supportPosition:{x:10,y:10},
    width:4.4,depth:6.4,supportWidth:4,supportDepth:6,rotation:0,pitchDegrees:35,overhangSide:0.2,overhangEnd:0.2}],
}
function Preview() {
  const [floor,setFloor]=useState(roofHeight ? fixtureFloors[1] : leanTo ? fixtureFloors[0] : asymmetricCreate ? gableInitial : initial)
  const [roofMode,setRoofMode]=useState(!roofHeight)
  const [selection,setSelection]=useState<string|null>(roofHeight ? '8e321618-2fa0-4ea5-99ec-8210302fe639' : null)
  const [preview,setPreview]=useState<RoofPlacementPreview|null>(null)
  const updateRoof=(id:string,updates:Partial<RoofStructure>)=>setFloor(current=>({...current,
    roofs:current.roofs?.map(roof=>roof.id===id?{...roof,...updates}:roof)}))
  Object.assign(window,{ bayStage:()=>Konva.stages[0], bayFloor:floor, bayPreview:preview,
    bayRoofMode:setRoofMode, baySelectRoof:setSelection, bayScene:()=>[..._roots.values()][0]?.store.getState() })
  const floors = roofHeight ? [fixtureFloors[0],floor] : leanTo ? [floor,...fixtureFloors.slice(1)] : [floor]
  return <><FloorplanCanvas activeFloor={floor} floors={floors}
    initialViewport={roofHeight ? {x:100,y:-220,scale:1.3} : leanTo ? {x:500,y:-220,scale:1.3} : {x:250,y:180,scale:1.3}}
    internalWallThickness={0.15} isAddingWall={false} isRoofMode={roofMode} modelAssetVersion={1} placementModel={null}
    projectFileName="Bay roof placement" selectedModelId={null} selectedModelIds={[]} selectedRoofId={selection}
    selectedRoomSignature={null} selectedWallId={null} selectedWallIds={[]} wallHeight={2.4} wallKind="external"
    onAddWall={noop} onAddRoof={options=>{const {floorId,...roof}=options;void floorId;
      setFloor(current=>({...current,roofs:[...(current.roofs??[]),{...roof,id:leanTo?'created-lean-to':asymmetricCreate?'created-gable':'created-bay',position:roof.position!,depth:roof.depth!,rotation:roof.rotation!}]}))}}
    onCancelModelPlacement={noop} onDeleteModel={noop} onDeleteRoof={noop} onDeleteWall={noop} onExitAddWall={noop}
    onViewportChange={noop} onSelectModel={noop} onSelectRoof={setSelection} onSelectRoom={noop} onSelectWall={noop}
    onRoofPlacementPreviewChange={setPreview} onPlaceModel={noop} onUpdateModel={noop} onUpdateRoof={updateRoof}
    onUpdateWall={noop} onUpdateWalls={noop} viewportRestoreRevision={1} />
    <ThreeDView activeFloorId={floor.id} floors={floors} cameraRestoreRevision={1}
      cameraViewState={DEFAULT_THREE_D_CAMERA_STATE} isEngineConsoleOpen={false}
      lightDirection={{azimuth:135,elevation:40}} modelAssetVersion={1} placementModel={null}
      roofPlacementPreview={preview} onCancelModelPlacement={noop} onClearSelection={noop}
      onCameraViewStateChange={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop}
      onPlaceModel={noop} onSelectFloor={noop} onSelectModel={noop} onSelectRoof={setSelection} onSelectSurface={noop}
      onUpdateModel={noop} selectedModelId={null} selectedRoofId={selection} selectedSurface={null}
      selectedWallId={null} sceneRevision={1} showAllFloors={false} surfaceAssignments={[]} /></>
}
createRoot(document.getElementById('root')!).render(<Preview />)
