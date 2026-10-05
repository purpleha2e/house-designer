import { readFileSync } from 'node:fs'
import { resolveBuildingRoofs } from './src/roofBuildingGeometry.ts'
import { createSolidRoofGeometryFromFaces } from './src/roofSolidGeometry.ts'
import { buildBuildingRoomVolumes } from './src/buildingRoomVolumes.ts'
import { carveRoofSurfaceByRooms } from './src/roofRoomCsg.ts'
import { getRoofRenderableOuterFaces, roofToLocal, subtractRoofVolume } from './src/roofJunctions.ts'
import { getRoofAbutmentPlanes } from './src/roofAbutmentGeometry.ts'
import { getRoofRenderPosition } from './src/roofBuildingGeometry.ts'
const project=JSON.parse(readFileSync('colin_house_v2.json','utf8'))
const roofs=resolveBuildingRoofs(project.floors)
console.log('Abutments',roofs[1].abuttingWalls.map(a=>({id:a.wall.id,start:a.wall.start,end:a.wall.end,elevation:a.elevation})))
const r=roofs[1], cuts=buildBuildingRoomVolumes(project.floors,roofs).cuts
const local=p=>roofToLocal(r.roof,r.floorTopElevation,p)
let shellFaces=getRoofRenderableOuterFaces(r.resolved)
for(const a of r.abuttingWalls){const plane=getRoofAbutmentPlanes([a],getRoofRenderPosition(r.roof))[0];shellFaces=shellFaces.flatMap(f=>subtractRoofVolume(f,[plane]))}
const solid=createSolidRoofGeometryFromFaces(r.resolved.faces.map(f=>f.map(local)),undefined,.04,shellFaces.map(f=>f.map(local)))
console.log('Shell before/after carve',solid.shell.attributes.position.count,carveRoofSurfaceByRooms(solid.shell,cuts,local).attributes.position.count)
console.log('Resolved faces',JSON.stringify(r.resolved.faces.map(f=>f.map(local))))
console.log('Structural faces',JSON.stringify(shellFaces.map(f=>f.map(local))))
const data=JSON.parse(readFileSync('.tmp-roof-corners-geometry.json','utf8'))
for(const g of data.filter(g=>['roof-shell','roof-eaves'].includes(g.role))){
 console.log(g.role)
 for(let i=0;i<g.positions.length;i+=9){
  const vertices=[0,3,6].map(n=>g.positions.slice(i+n,i+n+3))
  if(vertices.every(v=>v[0]<-1.7)&&vertices.some(v=>v[2]>3)&&vertices.every(v=>v[1]<.02))console.log({vertices,normal:g.normals.slice(i,i+3)})
 }
}
