import {readFileSync} from 'node:fs'
import {resolveBuildingRoofs} from './src/roofBuildingGeometry.ts'
import {createWallRoofClipOptions} from './src/roofWallClipping.ts'
import {createWallRoofClipJob,runWallRoofClipJob} from './src/wallEngine/wallRoofClipJob.ts'
import {buildFloorWallSurfaceFaces} from './src/wallEngine/floorWallSurfaceMesh.ts'
import {getRenderedWalls} from './src/wallGeometry.ts'
import {buildWallTopology} from './src/wallTopology.ts'
import {getRoofRenderableOuterFaces,roofBoundsPolygon} from './src/roofJunctions.ts'
import {BufferGeometry,Float32BufferAttribute,Mesh,MeshBasicMaterial,Raycaster,Vector3,DoubleSide} from 'three'
const p=JSON.parse(readFileSync('colin_house_v2.json')),f=p.floors[1]
f.roofs.find(r=>r.asymmetricSides).fitSupportingWalls=true
const roofs=resolveBuildingRoofs(p.floors),r=roofs.find(r=>r.roof.asymmetricSides)
const faces=buildFloorWallSurfaceFaces({renderedWalls:getRenderedWalls(f.walls),rooms:buildWallTopology(f.walls).rooms,useWallBodyPerimeterMesh:true})
const options=createWallRoofClipOptions({floorId:f.id,floorElevation:f.elevation,walls:f.walls,wallFaces:faces,roofs:[{floorId:f.id,clipsGeometry:false,fitSupportingWallIds:r.supportingWallIds,supportPolygon:roofBoundsPolygon(r.resolved,r.resolved.support),undersideFaces:r.resolved.coverageFaces,heightClipUndersideFaces:getRoofRenderableOuterFaces(r.resolved).map(face=>face.map(([x,y,z])=>[x,y-.035,z]))}]})
const out=runWallRoofClipJob(createWallRoofClipJob(faces,options))
for(const id of r.supportingWallIds)console.log(id,'max',Math.max(...out.filter(f=>f.wallId===id).flatMap(f=>f.vertices.map(v=>v.position[1]))))
console.log('volumes',options.volumes.length)
const job=JSON.parse(readFileSync('.tmp-fit-jobs.json')).find(j=>j.floorElevation>2)
const output=runWallRoofClipJob(job)
const meshes=output.map(face=>{const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(face.vertices.slice(1,-1).flatMap((v,i)=>[face.vertices[0].position,v.position,face.vertices[i+2].position].flat()),3));const m=new Mesh(g,new MeshBasicMaterial({side:DoubleSide}));m.position.y=job.floorElevation;m.userData={id:face.wallId,kind:face.kind,faceId:face.faceId};m.updateMatrixWorld();return m})
console.log(new Raycaster(new Vector3(4,10,16.35),new Vector3(0,-1,0)).intersectObjects(meshes).map(h=>({d:h.object.userData,p:h.point.toArray()})))
