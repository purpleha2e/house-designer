import { readFileSync } from 'node:fs'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { createJoinedRoofAssemblyGeometries } from '../src/roofAssembly.ts'
import { buildBuildingRoofGables } from '../src/roofGableGeometry.ts'
import { BufferGeometry, Float32BufferAttribute, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
const {floors}=JSON.parse(readFileSync('colin_house_v2.json','utf8'))
const roofs=resolveBuildingRoofs(floors),{cuts,exteriorTrimCuts}=buildBuildingRoomVolumes(floors,roofs)
const geometries=createJoinedRoofAssemblyGeometries(roofs.map(r=>({resolved:r.resolved,abuttingWalls:r.abuttingWalls,roomCuts:cuts,exteriorTrimCuts})))
const meshes=roofs.flatMap(r=>Object.entries(geometries.get(r.roof.id)!).flatMap(([part,geometry])=>{
 if(!geometry)return [];const m=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));m.name=r.roof.id+'/'+part;m.position.set(r.roof.position.x,r.resolved.elevation,r.roof.position.y);m.rotation.y=r.roof.rotation;m.updateMatrixWorld();return[m]
}))
const gables=buildBuildingRoofGables(floors,roofs,buildBuildingRoomVolumes(floors,roofs))
for(const g of gables) for(const f of g.faces){const geo=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(f.points.slice(1,-1).flatMap((p,i)=>[f.points[0],p,f.points[i+2]].flat()),3));const m=new Mesh(geo,new MeshBasicMaterial({side:DoubleSide}));m.name='gable/'+g.roofId+'/'+JSON.stringify({interior:f.interior,side:f.wallSide,plane:f.plane});m.updateMatrixWorld();meshes.push(m)}
for(const z of [17.92,18.04]) for(const x of [0,.4,.8,1.26,1.7,2.1,2.5]){
 const hits=new Raycaster(new Vector3(x,4.8,z),new Vector3(0,1,0)).intersectObjects(meshes)
 console.log(JSON.stringify({x,z,hits:hits.slice(0,3).map(h=>({part:h.object.name,y:h.point.y,normal:h.face?.normal.toArray()}))}))
}
