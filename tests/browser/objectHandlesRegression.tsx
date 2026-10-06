import { useRef, useState, type SetStateAction } from 'react'
import { _roots } from '@react-three/fiber'
import { createRoot } from 'react-dom/client'
import Konva from 'konva'
import { FloorplanCanvas } from '../../src/components/FloorplanCanvas'
import { ThreeDView } from '../../src/components/ThreeDView'
import { DEFAULT_THREE_D_CAMERA_STATE } from '../../src/projectViewState'
import type { ModelTransformPreview } from '../../src/modelTransformPreview'
import { registerRuntimeModels } from '../../src/models/modelLibrary'
import type { FloorLevel } from '../../src/types'
import '../../src/App.css'
const noop = () => {}
registerRuntimeModels([{id:'handle-test-box',name:'Test box',category:'Furniture',shape:'box',color:'#a16207',width:1.8,depth:0.9,height:0.75}])
const initial: FloorLevel = {id:'floor', name:'Handle test', elevation:0, roomHeight:2.4, slabThickness:0.2, rooms:[], roofs:[], walls:[],
  models:[{id:'handle-box',modelId:'handle-test-box',scale:1,position:{x:3,y:3},rotation:0}]}
function Preview(){
  const [wallMode,setWallMode]=useState(false)
  const [floors,setFloors]=useState([initial]),[activeFloorId,setActiveFloorId]=useState(initial.id)
  const [showAllFloors,setShowAllFloors]=useState(false)
  const [showImages,setShowImages]=useState(true)
  const floor=floors.find(f=>f.id===activeFloorId)??floors[0]
  const setFloor=(update:SetStateAction<FloorLevel>)=>setFloors(current=>current.map(f=>f.id===floor.id?
    typeof update==='function'?update(f):update:f))
  const [selected,setSelected]=useState<string | null>('handle-box')
  const previewRef=useRef<ModelTransformPreview | null>(null)
  const updateModel=(id:string,updates:Partial<FloorLevel['models'][number]>)=>{
    const metrics=window as unknown as {handleCommits?:number}
    metrics.handleCommits=(metrics.handleCommits??0)+1
    setFloor(current=>({...current,models:current.models.map(m=>m.id===id?{...m,...updates}:m)}))
  }
  Object.assign(window,{handleStage:()=>Konva.stages[0],handleSelection:selected,handleFloor:floor,handleSetFloor:setFloor,handleSelectModel:setSelected,handleWallMode:setWallMode})
  Object.assign(window,{handleFloors:floors,handleSetFloors:setFloors,handleSetActiveFloor:setActiveFloorId,handleSetShowAllFloors:setShowAllFloors})
  Object.assign(window,{handleThreeScene:()=>[..._roots.values()][0]?.store.getState()})
  Object.assign(window,{handlePreview:()=>previewRef.current})
  return <><FloorplanCanvas modelTransformPreviewRef={previewRef} activeFloor={floor} floors={floors} initialViewport={{x:100,y:100,scale:1.3}}
    showImages={showImages} onShowImagesChange={setShowImages}
    onGroundImageChange={image=>{
      const metrics=window as unknown as {groundImageCommits?:number}
      metrics.groundImageCommits=(metrics.groundImageCommits??0)+1
      setFloor(current=>({...current,groundImage:image}))
    }}
    internalWallThickness={0.15} isAddingWall={wallMode} isRoofMode={false} modelAssetVersion={1} placementModel={null}
    projectFileName="Handle preview" selectedModelId={selected} selectedModelIds={[]} selectedRoofId={null}
    selectedRoomSignature={null} selectedWallId={null} selectedWallIds={[]} wallHeight={2.4} wallKind="internal"
    onAddWall={wall=>setFloor(current=>({...current,walls:[...current.walls,{...wall,id:'drawn-wall',kind:'internal',thickness:0.15,height:2.4}]}))} onAddRoof={noop} onCancelModelPlacement={noop} onDeleteModel={noop} onDeleteRoof={noop}
    onDeleteWall={noop} onExitAddWall={()=>setWallMode(false)} onViewportChange={noop} onSelectModel={setSelected} onSelectRoof={noop}
    onSelectRoom={noop} onSelectWall={noop} onRoofPlacementPreviewChange={noop} onPlaceModel={noop}
    onUpdateModel={updateModel}
    onUpdateRoof={noop} onUpdateWall={noop} onUpdateWalls={changes=>setFloor(current=>({...current,
      walls:current.walls.map(wall=>{const change=changes.find(change=>change.wallId===wall.id);return change?{...wall,...change.updates}:wall})
    }))} viewportRestoreRevision={1}/>
    <ThreeDView modelTransformPreviewRef={previewRef} activeFloorId={floor.id} floors={floors}
      showImages={showImages}
      cameraRestoreRevision={1} cameraViewState={DEFAULT_THREE_D_CAMERA_STATE}
      isEngineConsoleOpen={false} lightDirection={{azimuth:135,elevation:40}} modelAssetVersion={1}
      placementModel={null} roofPlacementPreview={null} onCancelModelPlacement={noop} onClearSelection={noop}
      onCameraViewStateChange={noop} onEngineConsoleOpenChange={noop} onLightDirectionChange={noop}
      onPlaceModel={noop} onSelectFloor={noop} onSelectModel={setSelected} onSelectRoof={noop} onSelectSurface={noop}
      onUpdateModel={updateModel} selectedModelId={selected} selectedRoofId={null} selectedSurface={null}
      selectedWallId={null} sceneRevision={1} showAllFloors={showAllFloors} surfaceAssignments={[]} />
    </>
}
createRoot(document.getElementById('root')!).render(<Preview />)
