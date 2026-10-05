import { readFileSync } from 'node:fs'
import { prepareRenderedFloorData } from './src/threeDLevelPreparation.ts'
import { buildFloorWallSurfaceFaces } from './src/wallEngine/floorWallSurfaceMesh.ts'
import { getFloorSlabFootprints } from './src/ceilingSlabFootprint.ts'
import { buildStoreyGeometry } from './src/storeyGeometry.ts'
const project=JSON.parse(readFileSync('colin_house_v2.json','utf8'))
const storeys=project.floors.map(floor=>{const data=prepareRenderedFloorData(floor);return {
 floor,footprints:getFloorSlabFootprints(floor),faces:buildFloorWallSurfaceFaces({renderedWalls:data.renderedWalls,rooms:data.rooms,useWallBodyPerimeterMesh:true})}})
const geometry=buildStoreyGeometry(storeys)
for(const [id,data] of geometry)console.log(JSON.stringify({id,footprints:data.footprints,
 bands:data.wallFaces.filter(f=>f.storeyBoundary).map(f=>({wall:f.wallId,normal:f.normal,vertices:f.vertices.map(v=>v.position)})),
 edges:data.assembly?.edges.map(e=>({a:e.point,b:e.nextPoint,owner:e.wallFloorId,face:e.wallFace?.wallId}))}))
