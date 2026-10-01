import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Konva from 'konva'
import { FloorplanCanvas } from './src/components/FloorplanCanvas'
import { modelsById } from './src/models/modelLibrary'
import { syncWallOpenings } from './src/modelPlacement'
import './src/App.css'
const noop = () => {}
const cases = [
  { x: 1, y: 2, rotation: 0 },
  { x: 5, y: 2, rotation: 0, mirrored: true },
  { x: 9, y: 2, rotation: 0, flipped: true },
  { x: 1, y: 5, rotation: 0, flipped: true, mirrored: true },
  { x: 6, y: 5, rotation: Math.PI / 2 },
  { x: 9, y: 5, rotation: Math.PI / 4, double: true },
]
const initial = syncWallOpenings({id:'floor', name:'Door plan', elevation:0, roomHeight:2.4, slabThickness:0.2, rooms:[], roofs:[],
  walls:cases.map((c,i)=>({id:`wall-${i}`,kind:'internal',height:2.4,thickness: i===2 ? 0.3 : 0.15,
    start:{x:c.x-1.3*Math.cos(c.rotation),y:c.y-1.3*Math.sin(c.rotation)},
    end:{x:c.x+1.3*Math.cos(c.rotation),y:c.y+1.3*Math.sin(c.rotation)}})),
  models:cases.map((c,i)=>({id:`door-${i}`,modelId:c.double?'patio-doors':'panel-interior-door-closed',scale:1,
    position:{x:c.x,y:c.y},rotation:c.rotation,flipped:c.flipped,mirrored:c.mirrored,
    wallAttachment:{wallId:`wall-${i}`,offset:1.3,side:1}}))},modelsById)
function Preview(){
  const [floor,setFloor]=useState(initial),[selected,setSelected]=useState(null)
  Object.assign(window,{doorStage:()=>Konva.stages[0],doorSelection:selected,doorFloor:floor})
  return <FloorplanCanvas activeFloor={floor} floors={[floor]} initialViewport={{x:110,y:100,scale:1.3}}
    internalWallThickness={0.15} isAddingWall={false} isRoofMode={false} modelAssetVersion={1} placementModel={null}
    projectFileName="Door preview" selectedModelId={selected} selectedModelIds={[]} selectedRoofId={null}
    selectedRoomSignature={null} selectedWallId={null} selectedWallIds={[]} wallHeight={2.4} wallKind="internal"
    onAddWall={noop} onAddRoof={noop} onCancelModelPlacement={noop} onDeleteModel={noop} onDeleteRoof={noop}
    onDeleteWall={noop} onExitAddWall={noop} onViewportChange={noop} onSelectModel={setSelected} onSelectRoof={noop}
    onSelectRoom={noop} onSelectWall={noop} onRoofPlacementPreviewChange={noop} onPlaceModel={noop}
    onUpdateModel={(id,updates)=>setFloor(current=>syncWallOpenings({...current,models:current.models.map(m=>m.id===id?{...m,...updates}:m)},modelsById))}
    onUpdateRoof={noop} onUpdateWall={noop} onUpdateWalls={noop} viewportRestoreRevision={1}/>
}
createRoot(document.getElementById('root')!).render(<Preview />)
