import {readFileSync} from 'node:fs'
import {resolveBuildingRoofs,getRoofSupportBoundsInRoofSpace,getRoofPanelLocalExtents,getLeanToPanelLocalExtents} from './src/roofBuildingGeometry.ts'
import {buildRoofProfileFaces} from './src/roofProfile.ts'
import {buildWallTopology} from './src/wallTopology.ts'
const p=JSON.parse(readFileSync('colin_house_v2.json','utf8')),preview=JSON.parse(readFileSync('.tmp-roof-live-preview.json','utf8'))
const f=p.floors[0];const floors=p.floors.map((f,i)=>i===0?{...f,roofs:[...f.roofs,preview.roof]}:f)
const r=resolveBuildingRoofs(floors).at(-1)
const area=faces=>faces.reduce((sum,f)=>sum+Math.abs(f.reduce((a,v,i)=>{const n=f[(i+1)%f.length];return a+v[0]*n[2]-n[0]*v[2]},0))/2,0)
console.log(JSON.stringify({roof:r.roof,support:getRoofSupportBoundsInRoofSpace(r.roof),outer:getRoofPanelLocalExtents(r.roof),lean:getLeanToPanelLocalExtents(r.roof,f.walls,buildWallTopology(f.walls,{floorFootprints:f.floorFootprints}).rooms),raw:area(buildRoofProfileFaces(r.roof,getRoofPanelLocalExtents(r.roof),getRoofSupportBoundsInRoofSpace(r.roof))),resolved:area(r.resolved.faces),abuts:r.abuttingWalls.map(w=>({floor:w.floorId,id:w.wall.id,start:w.wall.start,end:w.wall.end})),faces:r.resolved.faces},null,2))
