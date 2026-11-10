import {Vector3} from 'three'
import {createIndirectVisibilityFromSnapshot,type IndirectGeometrySnapshot} from '../../src/indirectVisibility'
import {restoreIndirectField,type IndirectFieldData} from '../../src/indirectLighting'
import {createIndirectVolumeLookup,writeIndirectVolumeRow} from '../../src/indirectVolume'
import {createIndirectFloorLookup,writeIndirectFloorRow} from '../../src/indirectFloorLighting'
import {buildBarrierMetadata,type BarrierMetadata,type BarrierChange} from '../giBarrierGeometry'
let previous:BarrierMetadata|undefined,version=0
self.onmessage=async({data}:{data:{id:number;field:IndirectFieldData;geometry:IndirectGeometrySnapshot;changes?:BarrierChange[];baselineWarm?:boolean}})=>{
 const id=data.id;version=id;const started=performance.now(),field=restoreIndirectField(data.field),geometryAt=performance.now(),visibility=createIndirectVisibilityFromSnapshot(data.geometry),geometryMs=performance.now()-geometryAt
 try{
  let warmMs=0
  if(data.baselineWarm){const at=performance.now(),lookup=createIndirectVolumeLookup(field,visibility),floor=createIndirectFloorLookup(field,visibility),result=new Float64Array(field.coefficientCount*3);for(let row=0;row<field.volume.rows;row++)writeIndirectVolumeRow(field,row,result,visibility,lookup,true);for(let row=0;row<field.floorLayer.n*field.floors.length;row++)writeIndirectFloorRow(field,row,visibility,floor,true);warmMs=performance.now()-at}
  const result=await buildBarrierMetadata(field,visibility.snapshot(),{previous,changes:data.changes,cancelled:()=>id!==version})
  if(id!==version)return
  previous=result;self.postMessage({id,ok:true,a:result.a,b:result.b,layout:result.layout,statistics:{...result.statistics,geometryMs,warmMs,roundTripWorkerMs:performance.now()-started},samplePosition:new Vector3().toArray()},{transfer:[result.a.data.buffer,result.b.data.buffer]})
 }catch(error){if(id===version)self.postMessage({id,ok:false,error:String(error)})}finally{field.dispose();visibility.dispose()}
}
