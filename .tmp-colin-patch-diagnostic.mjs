import { readFileSync, writeFileSync } from 'node:fs'
import { prepareRenderedFloorData } from './src/threeDLevelPreparation.ts'
import { buildFloorWallSurfaceFaces } from './src/wallEngine/floorWallSurfaceMesh.ts'
import { getFloorSlabFootprints } from './src/ceilingSlabFootprint.ts'
import { buildStoreyGeometry } from './src/storeyGeometry.ts'
import { buildBuildingRoomVolumes } from './src/buildingRoomVolumes.ts'
import { buildBuildingRoofGables, getGableWallClipData } from './src/roofGableGeometry.ts'
import { resolveBuildingRoofs, getRoofSupportBoundsInRoofSpace, getRoofWorldPointFromLocal, getRoofRenderPosition } from './src/roofBuildingGeometry.ts'
import { getRoofCoverageUndersideFaces, getRoofRenderableOuterFaces } from './src/roofJunctions.ts'
import { getRoofAbutmentPlanes } from './src/roofAbutmentGeometry.ts'
import { createWallRoofClipOptions } from './src/roofWallClipping.ts'
import { createWallRoofClipJob, runWallRoofClipJob } from './src/wallEngine/wallRoofClipJob.ts'
import { findWallFragmentAssignmentForFace, findStoreyBoundaryAssignment } from './src/wallFragmentAssignments.ts'
import { Raycaster, Vector3, Mesh, MeshBasicMaterial, DoubleSide } from 'three'
import { buildWallBufferGeometryPayload } from './src/wallEngine/wallBuffer.ts'
import { createWallBufferGeometry } from './src/wallEngine/wallThreeGeometry.ts'
const project=JSON.parse(readFileSync('colin_house_v2.json','utf8'))
if(process.argv.includes('passive'))project.floors[0].roofs[1].clipsGeometry=false
const storeys=project.floors.map(floor=>{const data=prepareRenderedFloorData(floor);return {
 floor,footprints:getFloorSlabFootprints(floor),faces:buildFloorWallSurfaceFaces({renderedWalls:data.renderedWalls,rooms:data.rooms,useWallBodyPerimeterMesh:true})}})
const geometry=buildStoreyGeometry(storeys), roofs=resolveBuildingRoofs(project.floors)
const volumes=buildBuildingRoomVolumes(project.floors,roofs)
const gables=buildBuildingRoofGables(project.floors,roofs,volumes,[...geometry.values()].flatMap(s=>s.assembly?[s.assembly]:[]))
writeFileSync('.tmp-colin-patch-gables.json',JSON.stringify(gables.map(g=>({id:g.id,faces:g.faces.filter(f=>f.points.some(v=>v[2]<5&&v[2]>4.6))})),null,2))
const results=[]
for(const floor of project.floors){
 const wallFaces=geometry.get(floor.id).wallFaces
 const opts=createWallRoofClipOptions({...getGableWallClipData(gables,roofs,floor.id,floor.elevation),floorElevation:floor.elevation,floorId:floor.id,walls:floor.walls,wallFaces,
  roofs:roofs.map(c=>{const b=getRoofSupportBoundsInRoofSpace(c.roof);return {
   clipsGeometry:c.roof.clipsGeometry,roofId:c.roof.id,floorId:c.floorId,surfaceFaces:c.resolved.structuralFaces,enclosedFootprints:geometry.get(c.floorId).footprints,
   supportPolygon:[{x:b.minX,y:b.minY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY},{x:b.minX,y:b.maxY}].map(p=>getRoofWorldPointFromLocal(c.roof,p)),
   abutmentPlanes:getRoofAbutmentPlanes(c.abuttingWalls,getRoofRenderPosition(c.roof)),
   undersideFaces:getRoofCoverageUndersideFaces(c.resolved).map(f=>f.map(([x,y,z])=>[x,y+.005,z])),
   heightClipUndersideFaces:getRoofRenderableOuterFaces(c.resolved).map(f=>f.map(([x,y,z])=>[x,y-(c.roof.thickness??.04)+.005,z]))
  }}),
 })
 const faces=runWallRoofClipJob(createWallRoofClipJob(wallFaces,opts)), ids=new Set(faces.map(f=>f.faceId))
 const nearby=faces.filter(f=>f.vertices.some(v=>v.position[0]>4.25&&v.position[0]<4.9&&v.position[2]>4.6&&v.position[2]<5&&v.position[1]+floor.elevation>2.65&&v.position[1]+floor.elevation<3.6))
 console.log('Unfinished nearby faces', floor.name,JSON.stringify(nearby.filter(f=>!(findWallFragmentAssignmentForFace(project.surfaceAssignments,f,ids)??findStoreyBoundaryAssignment(project.surfaceAssignments,f,faces,ids))).map(f=>({id:f.faceId,source:f.materialSource,normal:f.normal,vertices:f.vertices.map(v=>v.position)})),null,2))
 const payload=buildWallBufferGeometryPayload(faces,{floorId:floor.id,groupBy:'face'})
 const mesh=new Mesh(createWallBufferGeometry(payload),payload.materialSlots.map(()=>new MeshBasicMaterial({side:DoubleSide})));mesh.position.y=floor.elevation;mesh.updateMatrixWorld()
 if(floor.id===project.floors[1].id)for(const x of [4.3,4.4,4.5,4.6])for(const y of [2.9,3.1,3.3,3.5]){
  const hit=new Raycaster(new Vector3(x,y,3),new Vector3(0,0,1)).intersectObject(mesh)[0];
  console.log({x,y,point:hit?.point.toArray(),target:hit?payload.pickTargets.get(hit.face.materialIndex):null});
 }
 for(const face of faces){
  if(floor.id!==project.floors[1].id||face.normal[2]>-.9||!face.vertices.every(v=>Math.abs(v.position[2]-4.751592949)<.01))continue
  const a=findWallFragmentAssignmentForFace(project.surfaceAssignments,face,ids)??findStoreyBoundaryAssignment(project.surfaceAssignments,face,faces,ids)
  results.push({id:face.faceId,wall:face.wallId,kind:face.kind,materialSource:face.materialSource,boundary:face.storeyBoundary,finish:a?.id,vertices:face.vertices.map(v=>v.position)})
 }
}
writeFileSync('.tmp-colin-patch-faces.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.filter(f=>!f.finish),null,2))
