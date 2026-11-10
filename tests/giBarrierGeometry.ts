import {Box3,BufferAttribute,BufferGeometry,DataUtils,DoubleSide,Ray,Vector3} from 'three'
import {MeshBVH} from 'three-mesh-bvh'
import type {IndirectField} from '../src/indirectLighting.ts'
import type {IndirectVisibilitySnapshot} from '../src/indirectVisibility.ts'

export const BARRIER_EPSILON=.00001
export type BarrierTriangle={vertices:number[];packed:number[]}
export type BarrierCell={box:number[];triangles:BarrierTriangle[];plane?:number[]}
export type BarrierLayout={floorN:number;volumeN:number;floors:number;floorCells:number;cells:number;key:string}
export type BarrierData={data:Float32Array;width:number;height:number;pageBase:number;offsets:number[];bytes:number;records:number;triangles:number;planeRecords:number;pages:number}
export type BarrierMetadata={layout:BarrierLayout;cells:Map<number,BarrierCell>;a:BarrierData;b:BarrierData;statistics:Record<string,number>}
export type BarrierChange={min:number[];max:number[]}
const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i])
const cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
const squared=(a:number[])=>dot(a,a)
function triangle(vertices:number[]):BarrierTriangle|null{
 const points=[vertices.slice(0,3),vertices.slice(3,6),vertices.slice(6,9)].sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]),[a,b,c]=points,e1=sub(b,a),e2=sub(c,a),normal=cross(e1,e2),length=Math.sqrt(squared(normal))
 if(length<1e-12)return null
 for(let i=0;i<3;i++)normal[i]/=length
 const largest=normal.reduce((k,v,i)=>Math.abs(v)>Math.abs(normal[k])?i:k,0)
 if(normal[largest]<0)for(let i=0;i<3;i++)normal[i]*=-1
 const d=dot(normal,a),e11=squared(e1),e22=squared(e2),e12=dot(e1,e2),den=e11*e22-e12*e12
 if(den<1e-24)return null
 const u=e1.map((v,i)=>(e22*v-e12*e2[i])/den),v=e2.map((v,i)=>(e11*v-e12*e1[i])/den)
 return{vertices:points.flat(),packed:[...normal,d,...u,-dot(u,a),...v,-dot(v,a)]}
}
export function barrierTriangleBlocks(t:BarrierTriangle,p:number[],q:number[]){
 const a=dot(t.packed,p)-t.packed[3],b=dot(t.packed,q)-t.packed[3]
 if(!(a>BARRIER_EPSILON&&b<-BARRIER_EPSILON||b>BARRIER_EPSILON&&a<-BARRIER_EPSILON))return false
 const f=a/(a-b),hit=p.map((v,i)=>v+(q[i]-v)*f),u=dot(t.packed.slice(4),hit)+t.packed[7],v=dot(t.packed.slice(8),hit)+t.packed[11]
 return u>=-1e-5&&v>=-1e-5&&u+v<=1.00001
}
function cutPolygon(n:number[],d:number,box:number[]){
 const corners=Array.from({length:8},(_,i)=>[box[i&1?3:0],box[i&2?4:1],box[i&4?5:2]]),points:number[][]=[]
 for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit)){
  const a=corners[i],b=corners[i|bit],da=dot(n,a)-d,db=dot(n,b)-d
  if(da*db>0)continue
  const f=Math.abs(da-db)>1e-12?da/(da-db):0,p=a.map((v,k)=>v+(b[k]-v)*f)
  if(!points.some(q=>squared(sub(q,p))<1e-18))points.push(p)
 }
 return points
}
function hull(points:number[][]){
 const sorted=points.map(p=>p.slice()).sort((a,b)=>a[0]-b[0]||a[1]-b[1]).filter((p,i,a)=>!i||squared(sub([p[0],p[1],0],[...a[i-1],0]))>1e-18),turn=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),lo:number[][]=[],hi:number[][]=[]
 for(const p of sorted){while(lo.length>1&&turn(lo.at(-2)!,lo.at(-1)!,p)<=0)lo.pop();lo.push(p)}
 for(const p of [...sorted].reverse()){while(hi.length>1&&turn(hi.at(-2)!,hi.at(-1)!,p)<=0)hi.pop();hi.push(p)}
 return[...lo.slice(0,-1),...hi.slice(0,-1)]
}
const area=(poly:number[][])=>Math.abs(poly.reduce((s,p,i)=>s+p[0]*poly[(i+1)%poly.length][1]-p[1]*poly[(i+1)%poly.length][0],0))/2
function inside(poly:number[][],p:number[]){return poly.every((a,i)=>{const b=poly[(i+1)%poly.length];return(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>=-BARRIER_EPSILON*Math.hypot(b[0]-a[0],b[1]-a[1])})}
/** Conservative certificate: an actual triangle, or a convex union of two
 * edge-sharing triangles, covers the complete plane/cell cross-section. */
function certificate(triangles:BarrierTriangle[],normal:number[],d:number,box:number[]){
 const axis=normal.reduce((k,v,i)=>Math.abs(v)>Math.abs(normal[k])?i:k,0),project=(p:number[])=>p.filter((_,i)=>i!==axis),cut=cutPolygon(normal,d,box).map(project)
 if(cut.length<2)return false
 const polygons=triangles.map(t=>hull([t.vertices.slice(0,3),t.vertices.slice(3,6),t.vertices.slice(6,9)].map(project)))
 if(polygons.some(poly=>cut.every(p=>inside(poly,p))))return true
 if(polygons.length>32)return false
 for(let i=0;i<polygons.length;i++)for(let j=i+1;j<polygons.length;j++){
  const a=polygons[i],b=polygons[j],common=a.filter(p=>b.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-7))
  if(common.length!==2)continue
  const combined=hull([...a,...b]),expected=area(a)+area(b)
  if(Math.abs(area(combined)-expected)>1e-9*Math.max(1,expected))continue
  if(cut.every(p=>inside(combined,p)))return true
 }
 return false
}
function planeCertificate(triangles:BarrierTriangle[],box:number[]){
 if(!triangles.length)return undefined
 const n=triangles[0].packed.slice(0,3),groups:{d:number;triangles:BarrierTriangle[]}[]=[]
 for(const t of triangles){
  if(t.packed.slice(0,3).some((v,i)=>Math.abs(v-n[i])>1e-6))return undefined
  const d=t.packed[3];let group=groups.find(g=>Math.abs(g.d-d)<2e-6)
  if(!group){if(groups.length===2)return undefined;group={d,triangles:[]};groups.push(group)}
  if([0,3,6].some(i=>Math.abs(dot(n,t.vertices.slice(i,i+3))-group!.d)>2e-6))return undefined
  group.triangles.push(t)
 }
 if(!groups.every(g=>certificate(g.triangles,n,g.d,box)))return undefined
 const distances=groups.map(g=>g.d).sort((a,b)=>a-b)
 return[...n,distances[0],distances.at(-1)!]
}
export function barrierVolumeY(field:IndirectField,floor:number,ix:number,iy:number,iz:number){
 const range=field.ranges[floor],mask=field.mask.image.data as Uint8Array,mx=Math.min(511,Math.floor(ix/(field.volume.n-1)*512)),mz=Math.min(511,Math.floor(iz/(field.volume.n-1)*512)),m=((floor*512+mz)*512+mx)*4
 const y=Math.max(field.floors[floor].elevation+.06,range.bottom+iy/11*(range.top-range.bottom)),ceiling=range.bottom+(mask[m+1]*256+mask[m+2])/65535*(range.top-range.bottom)
 return mask[m]?Math.max(field.floors[floor].elevation+.06,Math.min(y,ceiling-.06)):y
}
export function barrierLayout(field:IndirectField):BarrierLayout{
 const f=field.floorLayer.n-1,v=field.volume.n-1,floors=field.floors.length,floorCells=f*f*floors
 let hash=2166136261;for(const value of field.mask.image.data as Uint8Array)hash=Math.imul(hash^value,16777619)
 return{floorN:f,volumeN:v,floors,floorCells,cells:floorCells+v*v*11*floors,key:JSON.stringify([field.bounds,field.ranges,field.floors.map(f=>f.elevation),f,v,hash>>>0])}
}
function pack(layout:BarrierLayout,cells:Map<number,BarrierCell>,mode:'A'|'B'):BarrierData{
 const headers=new Float32Array(layout.cells),records:number[]=[],lists:number[]=[],triangles:number[]=[],planes:number[]=[],recordMap=new Map<string,number>(),triangleMap=new Map<BarrierTriangle,number>(),planeMap=new Map<string,number>()
 for(const [index,cell]of cells){
  if(mode==='B'&&cell.plane){const key=cell.plane.map(v=>Math.round(v*1e6)).join(',');let id=planeMap.get(key);if(id===undefined){id=planes.length/8+1;planeMap.set(key,id);planes.push(...cell.plane.slice(0,4),cell.plane[4],0,0,0)}headers[index]=id;continue}
  const ids=cell.triangles.map(t=>{let id=triangleMap.get(t);if(id===undefined){id=triangles.length/12;triangleMap.set(t,id);const a=t.vertices.slice(0,3),e1=sub(t.vertices.slice(3,6),a),e2=sub(t.vertices.slice(6,9),a);triangles.push(...a,0,...e1,0,...e2,0)}return id}).sort((a,b)=>a-b)
  const key=ids.join(',');let id=recordMap.get(key)
  if(id===undefined){id=records.length/4+1;recordMap.set(key,id);records.push(lists.length,ids.length,0,0);lists.push(...ids)}
  headers[index]=mode==='B'?-id:id
 }
 const pageTable=new Float32Array(Math.ceil(layout.cells/64)),pageValues:number[]=[]
 for(let page=0;page<pageTable.length;page++){const start=page*64;if(!headers.subarray(start,start+64).some(v=>v!==0))continue;pageTable[page]=pageValues.length/64+1;for(let i=0;i<64;i++)pageValues.push(headers[start+i]??0)}
 const pageBase=Math.ceil(pageTable.length/4),recordBase=pageBase+pageValues.length/4,listBase=recordBase+records.length/4,triangleBase=listBase+Math.ceil(lists.length/4),planeBase=triangleBase+triangles.length/4,pixels=planeBase+planes.length/4,width=Math.min(1024,Math.max(1,Math.ceil(pixels))),height=Math.max(1,Math.ceil(pixels/width)),data=new Float32Array(width*height*4)
 data.set(pageTable);data.set(pageValues,pageBase*4);data.set(records,recordBase*4);data.set(lists,listBase*4);data.set(triangles,triangleBase*4);data.set(planes,planeBase*4)
 return{data,width,height,pageBase,offsets:[recordBase,listBase,triangleBase,planeBase],bytes:data.byteLength,records:records.length/4,triangles:triangles.length/12,planeRecords:planes.length/8,pages:pageValues.length/64}
}
/** Test prototype, isolated from production. Actual geometry supplies every
 * validity decision; no room ID or radiance threshold participates. */
export async function buildBarrierMetadata(field:IndirectField,snapshot:IndirectVisibilitySnapshot,options:{previous?:BarrierMetadata;changes?:BarrierChange[];cancelled?:()=>boolean;yieldEvery?:number}={}){
 const began=performance.now(),layout=barrierLayout(field),geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(snapshot.positions,3))
 const tree=snapshot.tree?MeshBVH.deserialize(snapshot.tree,geometry):null,box=new Box3(),cache=new Map<number,BarrierTriangle|null>(),cells=new Map<number,BarrierCell>(),old=options.previous?.layout.key===layout.key?options.previous:undefined
 const canonical=new Map<number,BarrierTriangle[]>(),bits=new Float32Array(9),integers=new Uint32Array(bits.buffer)
 const intern=(value:BarrierTriangle)=>{bits.set(value.vertices);let hash=2166136261;for(const bit of integers)hash=Math.imul(hash^bit,16777619);const bucket=canonical.get(hash)??[],same=bucket.find(t=>t.vertices.every((v,i)=>v===value.vertices[i]));if(same)return same;bucket.push(value);canonical.set(hash,bucket);return value}
 if(old){const seeded=new Set<BarrierTriangle>();for(const cell of old.cells.values())for(const t of cell.triangles)if(!seeded.has(t)){seeded.add(t);intern(t)}}
 let queried=0,reused=0,queryMs=0,certificateMs=0,maxTriangles=0,eligible=0,planeCells=0,processed=0
 const mask=field.mask.image.data as Uint8Array,prefix=Array.from({length:layout.floors},(_,floor)=>{const values=new Uint32Array(513*513);for(let z=0;z<512;z++)for(let x=0;x<512;x++)values[(z+1)*513+x+1]=(mask[((floor*512+z)*512+x)*4]>0?1:0)+values[z*513+x+1]+values[(z+1)*513+x]-values[z*513+x];return values})
 const occupied=(floor:number,x:number,z:number,n:number)=>{const x0=Math.max(0,Math.floor(x/(n-1)*512)),z0=Math.max(0,Math.floor(z/(n-1)*512)),x1=Math.min(512,Math.ceil((x+1)/(n-1)*512)+1),z1=Math.min(512,Math.ceil((z+1)/(n-1)*512)+1),s=prefix[floor];return s[z1*513+x1]-s[z0*513+x1]-s[z1*513+x0]+s[z0*513+x0]>0}
 const process=async(index:number,bounds:number[])=>{
  processed++;if(processed%(options.yieldEvery??2048)===0){await new Promise(r=>setTimeout(r,0));if(options.cancelled?.())throw Error('Barrier metadata cancelled')}
  eligible++;const previous=old?.cells.get(index),affected=!old||!options.changes?.length||options.changes.some(c=>bounds.slice(0,3).every((v,i)=>v<=c.max[i]+BARRIER_EPSILON&&bounds[i+3]>=c.min[i]-BARRIER_EPSILON))
  if(!affected){if(previous){cells.set(index,previous);if(previous.plane)planeCells++}reused++;return}
  const start=performance.now(),found:BarrierTriangle[]=[],seen=new Set<BarrierTriangle>();box.min.fromArray(bounds);box.max.fromArray(bounds,3)
  tree?.shapecast({intersectsBounds:b=>b.intersectsBox(box),intersectsTriangle:(tri,index)=>{if(!box.intersectsTriangle(tri))return false;let t=cache.get(index);if(t===undefined){t=triangle([...tri.a.toArray(),...tri.b.toArray(),...tri.c.toArray()]);if(t)t=intern(t);cache.set(index,t)}if(t&&!seen.has(t)){seen.add(t);found.push(t)}return false}})
  queryMs+=performance.now()-start;queried++;maxTriangles=Math.max(maxTriangles,found.length)
  if(!found.length)return
  const cert=performance.now(),plane=planeCertificate(found,bounds);certificateMs+=performance.now()-cert
  cells.set(index,{box:bounds,triangles:found,plane});if(plane)planeCells++
 }
 try{
  for(let floor=0;floor<layout.floors;floor++){
   const n=field.floorLayer.n,step=field.bounds.size/(n-1),y=field.floors[floor].elevation+.016
   for(let z=0;z<n-1;z++)for(let x=0;x<n-1;x++){
    if(!occupied(floor,x,z,n))continue
    const px=field.bounds.minX+x*step,pz=field.bounds.minZ+z*step
    await process((floor*layout.floorN+z)*layout.floorN+x,[px-(x===0?.4:0),y-1e-6,pz-(z===0?.4:0),px+step+(x===n-2?.4:0),y+1e-6,pz+step+(z===n-2?.4:0)])
   }
   const vn=field.volume.n,vs=field.bounds.size/(vn-1),range=field.ranges[floor]
   for(let iy=0;iy<11;iy++)for(let z=0;z<vn-1;z++)for(let x=0;x<vn-1;x++){
    if(!occupied(floor,x,z,vn))continue
    const heights=[0,1].flatMap(dz=>[0,1].flatMap(dx=>[0,1].map(dy=>barrierVolumeY(field,floor,x+dx,iy+dy,z+dz)))),px=field.bounds.minX+x*vs,pz=field.bounds.minZ+z*vs
    const bottom=Math.min(...heights,range.bottom+iy/11*(range.top-range.bottom)-(iy===0?.3:0)),top=Math.max(...heights,range.bottom+(iy+1)/11*(range.top-range.bottom)+(iy===10?.3:0))
    await process(layout.floorCells+((floor*11+iy)*layout.volumeN+z)*layout.volumeN+x,[px-(x===0?.4:0),bottom-1e-6,pz-(z===0?.4:0),px+vs+(x===vn-2?.4:0),top+1e-6,pz+vs+(z===vn-2?.4:0)])
   }
  }
  const packAt=performance.now(),a=pack(layout,cells,'A'),aPackMs=performance.now()-packAt,bAt=performance.now(),b=pack(layout,cells,'B'),bPackMs=performance.now()-bAt
  return{layout,cells,a,b,statistics:{elapsedMs:performance.now()-began,queryMs,certificateMs,aPackMs,bPackMs,eligible,queried,reused,boundaryCells:cells.size,planeCells,fallbackCells:cells.size-planeCells,maxTriangles,aBytes:a.bytes,bBytes:b.bytes}} satisfies BarrierMetadata
 }finally{geometry.dispose()}
}
export function barrierCellAt(field:IndirectField,p:Vector3,floor:number,floorLayer:boolean){
 const layout=barrierLayout(field),n=(floorLayer?field.floorLayer.n:field.volume.n),x=Math.max(0,Math.min(n-1,(p.x-field.bounds.minX)/field.bounds.size*(n-1))),z=Math.max(0,Math.min(n-1,(p.z-field.bounds.minZ)/field.bounds.size*(n-1))),ix=Math.min(n-2,Math.floor(x)),iz=Math.min(n-2,Math.floor(z)),range=field.ranges[floor],y=Math.max(0,Math.min(11,(p.y-range.bottom)/(range.top-range.bottom)*11)),iy=Math.min(10,Math.floor(y))
 return{index:floorLayer?(floor*layout.floorN+iz)*layout.floorN+ix:layout.floorCells+((floor*11+iy)*layout.volumeN+iz)*layout.volumeN+ix,ix,iy,iz,fraction:[x-ix,floorLayer?0:y-iy,z-iz]}
}
export function barrierValid(cell:BarrierCell|undefined,p:number[],q:number[],mode:'A'|'B'){
 if(!cell)return true
 if(mode==='B'&&cell.plane){const plane=cell.plane,a=dot(plane,p),b=dot(plane,q);return[plane[3],plane[4]].every(d=>!(a-d>BARRIER_EPSILON&&b-d<-BARRIER_EPSILON||b-d>BARRIER_EPSILON&&a-d<-BARRIER_EPSILON))}
 return!cell.triangles.some(t=>barrierTriangleBlocks(t,p,q))
}
export function sampleBarrierField(field:IndirectField,metadata:BarrierMetadata,p:Vector3,normal:Vector3,floor:number,floorLayer:boolean,mode:'A'|'B'|'legacy'){
 const cell=barrierCellAt(field,p,floor,floorLayer),layer=floorLayer?field.floorLayer:field.volume,coefficients=new Float64Array(field.coefficientCount*3),taps=[];let coverage=0
 const receiver=p.toArray();if(floorLayer)receiver[1]=field.floors[floor].elevation+.016
 for(let dz=0;dz<2;dz++)for(let dy=0;dy<(floorLayer?1:2);dy++)for(let dx=0;dx<2;dx++){
  const x=cell.ix+dx,z=cell.iz+dz,y=floorLayer?floor:floor*14+cell.iy+dy+1,q=[field.bounds.minX+x/(layer.n-1)*field.bounds.size,floorLayer?receiver[1]:barrierVolumeY(field,floor,x,cell.iy+dy,z),field.bounds.minZ+z/(layer.n-1)*field.bounds.size],weight=(dx?cell.fraction[0]:1-cell.fraction[0])*(dz?cell.fraction[2]:1-cell.fraction[2])*(floorLayer?1:dy?cell.fraction[1]:1-cell.fraction[1]),valid=mode==='legacy'||barrierValid(metadata.cells.get(cell.index),receiver,q,mode),offset=((z*layer.height*field.coefficientCount+y)*layer.n+x)*4,alpha=DataUtils.fromHalfFloat(layer.data[offset+3]),values=[]
  for(let k=0;k<field.coefficientCount;k++){const at=offset+k*layer.height*layer.n*4;for(let c=0;c<3;c++){const v=DataUtils.fromHalfFloat(layer.data[at+c]);if(valid)coefficients[c*field.coefficientCount+k]+=v*weight;if(k===0)values.push(v*.886227)}}
  if(valid)coverage+=alpha*weight;taps.push({coordinate:[x,y,z],position:q,weight,valid,support:alpha,l0Irradiance:values})
 }
 // Diagnostic receivers below use L0 fields; arbitrary SH is evaluated by GPU.
 return{rgb:[0,1,2].map(c=>Math.max(0,(coefficients[c*field.coefficientCount]*.886227+coefficients[c*field.coefficientCount+1]*1.023328*normal.y+coefficients[c*field.coefficientCount+2]*1.023328*normal.z+coefficients[c*field.coefficientCount+3]*1.023328*normal.x)/Math.max(1e-5,coverage))),coverage,taps,cell:cell.index}
}
/** Independent nearest-hit check uses micrometre near/far bounds: the existing
 * 25 mm probe-ray near bias is inappropriate for 6 mm final filter segments. */
export function independentBarrierRay(snapshot:IndirectVisibilitySnapshot,p:number[],q:number[]){
 const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(snapshot.positions,3));const tree=snapshot.tree?MeshBVH.deserialize(snapshot.tree,geometry):null,origin=new Vector3().fromArray(p),direction=new Vector3().fromArray(q).sub(origin),distance=direction.length()
 try{return!tree?.raycastFirst(new Ray(origin,direction.normalize()),DoubleSide,1e-5,Math.max(1e-5,distance-1e-5))}finally{geometry.dispose()}
}
