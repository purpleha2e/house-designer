import {Box3,Mesh,MeshStandardMaterial,Vector3} from 'three'
import {includeViewportObject} from '../../src/viewportSurfaceVisibility'
export function sunlitInventory(s:any){
 const meshes:any[]=[];s.scene.updateMatrixWorld(true)
 s.scene.traverse((o:any)=>{if(!(o instanceof Mesh)||!includeViewportObject(o))return
  const bounds=new Box3().setFromObject(o);if(bounds.max.y<2.7||bounds.min.y>5.3||bounds.max.x<-.6||bounds.min.x>3.5||bounds.max.z<10||bounds.min.z>14.6)return
  const parents=[];let p:any=o;while(p){if(p.name||p.userData?.houseDesignerRole)parents.push({name:p.name,role:p.userData?.houseDesignerRole});p=p.parent}
  meshes.push({uuid:o.uuid,name:o.name,parents,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3,materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>({name:m.name,uuid:m.uuid,color:(m as MeshStandardMaterial).color?.toArray(),metalness:(m as MeshStandardMaterial).metalness,roughness:(m as MeshStandardMaterial).roughness,map:(m as MeshStandardMaterial).map?.name,normalMap:!!(m as MeshStandardMaterial).normalMap}))})
 });const f=s.scene.userData.getLightingField();return{meshes,probes:f.probes.length,order:f.shOrder,camera:{position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),fov:s.camera.fov},settings:s.scene.userData.getBakedIndirectLighting()?.settings}
}
export function bedComponents(s:any){
 const root=s.scene.getObjectByName('model-transform-5e6c5ebd-32a2-4b47-9f48-9ad7c124d2f5');if(!root)throw Error('Bedroom bed missing')
 let mesh:any;root.traverse((o:any)=>{if(o instanceof Mesh)mesh=o});const g=mesh.geometry,p=g.attributes.position,ix=g.index,count=(ix?.count??p.count)/3,parent=Array.from({length:count},(_,i)=>i),vertexOwner=new Map<string,number>(),find=(i:number):number=>parent[i]===i?i:parent[i]=find(parent[i]),v=new Vector3(),positions:number[][]=[],indices:number[][]=[]
 for(let t=0;t<count;t++){const ids=[];for(let c=0;c<3;c++){const i=ix?.getX(t*3+c)??t*3+c;ids.push(i);v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);positions[i]=v.toArray();const key=v.toArray().map(x=>Math.round(x*100000)).join(','),owner=vertexOwner.get(key);if(owner!==undefined)parent[find(t)]=find(owner);else vertexOwner.set(key,t)}indices.push(ids)}
 const components=new Map<number,any>();for(let t=0;t<count;t++){const key=find(t),q=components.get(key)??{id:key,triangles:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};q.triangles.push(t);for(const i of indices[t])for(let c=0;c<3;c++){q.min[c]=Math.min(q.min[c],positions[i][c]);q.max[c]=Math.max(q.max[c],positions[i][c])}components.set(key,q)}
 const data={mesh:mesh.uuid,components:[...components.values()].sort((a,b)=>b.triangles.length-a.triangles.length)};s.scene.userData.sunlitBedComponents=data;return data
}
