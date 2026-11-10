import {BoxGeometry,DataUtils,Mesh,MeshStandardMaterial,Scene} from 'three'
import {createIndirectVisibility,snapshotIndirectGeometry} from '../../src/indirectVisibility'
import {prepareSoftGIGraph,filterSoftGI,type SoftGIField} from '../../src/indirectFloorFilter'

export async function checkSoftGIWorker(){
 const scene=new Scene(),material=new MeshStandardMaterial(),meshes:Mesh[]=[],n=81,floors=2,size=3.2
 const box=(x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const m=new Mesh(new BoxGeometry(sx,sy,sz),material);m.position.set(x,y,z);scene.add(m);meshes.push(m);return m}
 for(let f=0;f<floors;f++)box(size/2,f*3-.02,size/2,size,.04,size)
 const door=box(1.5,1,1.5,.006,2,.3),data=new Uint16Array(n*n*floors*16)
 for(let z=0;z<n;z++)for(let band=0;band<floors*4;band++)for(let x=0;x<n;x++){
  const o=((z*floors*4+band)*n+x)*4
  for(let c=0;c<3;c++)data[o+c]=DataUtils.toHalfFloat(band<floors?(x<40?.2:1.2)+band*.3:(c===1?-.07:.1));data[o+3]=DataUtils.toHalfFloat(1)
 }
 const field:SoftGIField={shOrder:1,bounds:{minX:0,minZ:0,size},floors:[{elevation:0},{elevation:3}],floorLayer:{n,data}}
 const worker=new Worker(new URL('../../src/indirectFloorFilter.worker.ts',import.meta.url),{type:'module'}),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();let id=0
 worker.onmessage=({data})=>{const p=pending.get(data.id);pending.delete(data.id);if(data.error)p?.reject(Error(data.error));else p?.resolve(data)}
 worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message))}
 const request=(radius:number,source?:SoftGIField,geometry?:ReturnType<typeof snapshotIndirectGeometry>)=>new Promise<any>((resolve,reject)=>{pending.set(++id,{resolve,reject});worker.postMessage({id,radius,field:source,geometry})})
 const verify=(output:Uint16Array,radius:number)=>{const visibility=createIndirectVisibility(scene);try{const graph=prepareSoftGIGraph(field,visibility),expected=filterSoftGI(field.floorLayer.data,graph,radius).output;let mismatch=0;for(let i=0;i<output.length;i++)if(output[i]!==expected[i])mismatch++;if(mismatch)throw Error(`${mismatch} mismatched half-floats at radius ${radius}`);return mismatch}finally{visibility.dispose()}}
 try{
  const original=data.slice(),initial=await request(.1,field,snapshotIndirectGeometry(scene));verify(initial.output,.1)
  field.floorLayer.data=data.slice();field.floorLayer.data[((40*8)*n+20)*4]=DataUtils.toHalfFloat(.8)
  const local=await request(.1,field);verify(local.output,.1)
  if(!local.statistics.incremental||local.statistics.links>=initial.statistics.links)throw Error('Coefficient edit did not use a local filter')
  door.position.x+=.12
  const moved=await request(.1,field,snapshotIndirectGeometry(scene));verify(moved.output,.1)
  if(!moved.statistics.incremental||!moved.statistics.graph.retainedPairs)throw Error('Door edit did not retain unaffected connections')
  const requests=[.2,.05,.1],rapid=await Promise.all(requests.map(radius=>request(radius)))
  rapid.forEach((result,i)=>verify(result.output,requests[i]))
  if(!original.every((v,i)=>v===data[i]))throw Error('Source modified')
  return{initial:initial.statistics,local:local.statistics,moved:moved.statistics,rapid:rapid.map(r=>r.statistics),allBitExact:true,sourceUnchanged:true}
 }finally{worker.terminate();meshes.forEach(m=>m.geometry.dispose());material.dispose()}
}
