import {readFileSync} from 'node:fs'
import{resolveBuildingRoofs}from'./src/roofBuildingGeometry.ts'
import{roofSurfaceHeights,getRoofRenderableOuterFaces}from'./src/roofJunctions.ts'
const floors=JSON.parse(readFileSync('tests/fixtures/asymmetricRoofJunctionRegression.json','utf8')).floors
const roofs=resolveBuildingRoofs(floors)
for(const r of roofs.filter(r=>r.floorId===floors[1].id)){
 console.log(r.roof.id,'extents',r.resolved.extents,'resolved',r.resolved.resolvedExtents)
 for(const[x,z]of[[6.5771,11.5361],[6.64,11.4467],[7.4,12.7],[7.4,11.3],[6.3,12.5]])console.log(x,z,roofSurfaceHeights(r.resolved.faces,{x,y:z}),roofSurfaceHeights(getRoofRenderableOuterFaces(r.resolved),{x,y:z}))
}
