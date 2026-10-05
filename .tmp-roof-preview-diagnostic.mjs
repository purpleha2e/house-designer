import {readFileSync} from 'node:fs'
import {resolveBuildingRoofs,getRoofSupportBoundsInRoofSpace,getRoofPanelLocalExtents} from './src/roofBuildingGeometry.ts'
import {buildRoofProfileFaces} from './src/roofProfile.ts'
const p=JSON.parse(readFileSync('colin_house_v2.json','utf8'))
const x1=-.4771028,x2=1.731173,y1=4.901592949,y2=10.161181662
for(const type of ['up-and-over','lean-to','flat'])for(const rotation of [0,Math.PI/2,Math.PI]){
 const swapped=rotation===Math.PI/2;const width=swapped?y2-y1:x2-x1,depth=swapped?x2-x1:y2-y1
 const roof={id:'__roof-placement-preview__',type,position:{x:(x1+x2)/2,y:(y1+y2)/2},supportPosition:{x:(x1+x2)/2,y:(y1+y2)/2},supportWidth:width,supportDepth:depth,width:width+.3,depth:depth+.3,rotation,pitchDegrees:28,overhangSide:.15,overhangEnd:.15,thickness:.04}
 const floors=p.floors.map((f,i)=>i===0?{...f,roofs:[...f.roofs,roof]}:f)
 const r=resolveBuildingRoofs(floors).at(-1)
 const area=faces=>faces.reduce((sum,f)=>sum+Math.abs(f.reduce((a,v,i)=>{const n=f[(i+1)%f.length];return a+v[0]*n[2]-n[0]*v[2]},0))/2,0)
 console.log(type,rotation,{raw:area(buildRoofProfileFaces(r.roof,getRoofPanelLocalExtents(r.roof),getRoofSupportBoundsInRoofSpace(r.roof))),resolved:area(r.resolved.faces),abuts:r.abuttingWalls.map(w=>({floor:w.floorId,id:w.wall.id,start:w.wall.start,end:w.wall.end})),faces:r.resolved.faces})
}
