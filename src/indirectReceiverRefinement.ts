import {BufferAttribute,BufferGeometry,Float32BufferAttribute,Matrix3,Vector3,type Matrix4} from 'three'

const MAX_BYTES=768*1024,MAX_MESH_BYTES=256*1024,EDGE=.08
let allocated=0
/** Render-only subdivision of displaced receivers. Position and UV interpolation
 * preserve the original surface. Raw reference normals preserve its exact
 * original interpolation after non-uniform model scaling. */
export function refineIndirectReceiverGeometry(source:BufferGeometry,matrix:Matrix4,bounds:Map<number,number[]>){
 const names=Object.keys(source.attributes),size=Object.values(source.attributes).reduce((s,a)=>s+a.itemSize*4,0)+4
 if(!bounds.size||source.morphAttributes.position?.length||Number.isFinite(source.drawRange.count))return null
 const available=Math.min(MAX_MESH_BYTES,MAX_BYTES-allocated),baseCount=source.attributes.position.count,maxVertices=Math.floor(available/(size+4))
 if(maxVertices<=baseCount)return null
 const data=new Map<string,number[]>(),normalMatrix=new Matrix3().getNormalMatrix(matrix),n=new Vector3()
 for(const name of names){const attribute=source.attributes[name],values:number[]=[]
  for(let i=0;i<attribute.count;i++)for(let k=0;k<attribute.itemSize;k++)values.push(k===0?attribute.getX(i):k===1?attribute.getY(i):k===2?attribute.getZ(i):attribute.getW(i))
  data.set(name,values)
 }
 const normals=data.get('normal')!
 for(let i=0;i<baseCount;i++){n.fromArray(normals,i*3);const length=n.clone().applyMatrix3(normalMatrix).length();if(length>0)n.divideScalar(length);n.toArray(normals,i*3)}
 const indices:number[]=[],caps:number[]=Array(baseCount*2).fill(32),edges=new Map<string,number>(),positions=data.get('position')!,a=new Vector3(),b=new Vector3(),c=new Vector3()
 let count=baseCount,split=false,estimated=baseCount*size+(source.index?.count??baseCount)*4
 if(estimated>=available||estimated>160*1024)return null
 const midpoint=(i:number,j:number)=>{
  const key=i<j?`${i}:${j}`:`${j}:${i}`,existing=edges.get(key);if(existing!==undefined)return existing
  const id=count++;estimated+=size;for(const name of names){const values=data.get(name)!,stride=source.attributes[name].itemSize;for(let k=0;k<stride;k++)values.push((values[i*stride+k]+values[j*stride+k])*.5)}
  caps.push(32,32);edges.set(key,id);return id
 }
 const emit=(ia:number,ib:number,ic:number,limit:number[],depth=0)=>{
  a.fromArray(positions,ia*3).applyMatrix4(matrix);b.fromArray(positions,ib*3).applyMatrix4(matrix);c.fromArray(positions,ic*3).applyMatrix4(matrix)
  const lengths=[a.distanceToSquared(b),b.distanceToSquared(c),c.distanceToSquared(a)],longest=Math.max(...lengths)
  const abx=b.x-a.x,aby=b.y-a.y,abz=b.z-a.z,acx=c.x-a.x,acy=c.y-a.y,acz=c.z-a.z,area2=Math.hypot(aby*acz-abz*acy,abz*acx-abx*acz,abx*acy-aby*acx)
  const edge=lengths.indexOf(longest),ends=edge===0?[ia,ib]:edge===1?[ib,ic]:[ic,ia]
  const curved=depth>0||new Vector3().fromArray(normals,ends[0]*3).applyMatrix3(normalMatrix).normalize().dot(new Vector3().fromArray(normals,ends[1]*3).applyMatrix3(normalMatrix).normalize())<.96
  if(limit[0]>.006&&limit[0]<.12&&curved&&(depth>0||longest>.16**2&&longest>4*area2)&&longest>EDGE**2&&depth<8&&count<maxVertices&&estimated+size+12<=available){
   split=true;estimated+=12
   if(edge===0){const mid=midpoint(ia,ib);emit(ia,mid,ic,limit,depth+1);emit(mid,ib,ic,limit,depth+1)}
   else if(edge===1){const mid=midpoint(ib,ic);emit(ia,ib,mid,limit,depth+1);emit(ia,mid,ic,limit,depth+1)}
   else{const mid=midpoint(ic,ia);emit(ia,ib,mid,limit,depth+1);emit(mid,ib,ic,limit,depth+1)}
   return
  }
  // A local new vertex supplies the flat receiver identity. Cyclic rotation
  // preserves the triangle, winding, UVs and normal interpolation.
  const last=Math.max(ia,ib,ic)
  if(last===ia)indices.push(ib,ic,ia);else if(last===ib)indices.push(ic,ia,ib);else indices.push(ia,ib,ic)
  for(const id of [ia,ib,ic])for(let side=0;side<2;side++)caps[id*2+side]=Math.min(caps[id*2+side],limit[side])
 }
 const groups=source.groups.length?source.groups:[{start:0,count:source.index?.count??baseCount,materialIndex:0}],resultGroups:typeof source.groups=[]
 for(const group of groups){const start=indices.length
  for(let i=group.start;i+2<group.start+group.count;i+=3)emit(source.index?.getX(i)??i,source.index?.getX(i+1)??i+1,source.index?.getX(i+2)??i+2,bounds.get(i)??[32,32])
  resultGroups.push({start,count:indices.length-start,materialIndex:group.materialIndex})
 }
 if(!split)return null
 const geometry=new BufferGeometry()
 for(const name of names)geometry.setAttribute(name,new Float32BufferAttribute(data.get(name)!,source.attributes[name].itemSize))
 geometry.setAttribute('hdGIReceiverLinearNormal',new Float32BufferAttribute(new Float32Array(count).fill(1),1));geometry.setIndex(new BufferAttribute(new Uint32Array(indices),1));geometry.groups=source.groups.length?resultGroups:[]
 geometry.name=source.name;geometry.userData={...source.userData};geometry.computeBoundingBox();geometry.computeBoundingSphere()
 const bytes=Object.values(geometry.attributes).reduce((s,a)=>s+a.array.byteLength,0)+geometry.index!.array.byteLength
 if(bytes>MAX_MESH_BYTES||allocated+bytes>MAX_BYTES){geometry.dispose();return null}
 allocated+=bytes
 let released=false
 return{geometry,caps:new Float32Array(caps),bytes,baseCount,release(){if(!released){released=true;allocated-=bytes}}}
}
