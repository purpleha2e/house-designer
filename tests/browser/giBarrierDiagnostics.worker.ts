import {Vector3} from 'three'
import {restoreIndirectField,type IndirectFieldData} from '../../src/indirectLighting'
import {createIndirectVisibilityFromSnapshot,type IndirectGeometrySnapshot} from '../../src/indirectVisibility'
import {buildBarrierMetadata,sampleBarrierField,type BarrierData} from '../giBarrierGeometry'
type Point={name:string;camera:string;pixel:{x:number;y:number};position:number[];normal:number[];geometricNormal:number[];floorIndex:number}
self.onmessage=async({data}:{data:{field:IndirectFieldData;geometry:IndirectGeometrySnapshot;volume:Uint16Array;floor:Uint16Array;points:Point[]}})=>{
 const field=restoreIndirectField(data.field),visibility=createIndirectVisibilityFromSnapshot(data.geometry)
 try{
  field.volume.data.set(data.volume);field.floorLayer.data.set(data.floor);field.floorLayer.ready=true
  const metadata=await buildBarrierMetadata(field,visibility.snapshot()),header=(atlas:BarrierData,index:number)=>{const page=atlas.data[Math.floor(index/64)];return page?atlas.data[atlas.pageBase*4+(page-1)*64+index%64]:0},maps=[]
  for(const mode of ['A','B'] as const)for(let floor=0;floor<field.floors.length;floor++)for(const layer of ['floor','volume'] as const){
   const size=layer==='floor'?metadata.layout.floorN:metadata.layout.volumeN,iy=4,raw=new Uint8Array(size*size*3),atlas=mode==='A'?metadata.a:metadata.b
   for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    const index=layer==='floor'?(floor*size+z)*size+x:metadata.layout.floorCells+((floor*11+iy)*size+z)*size+x,id=header(atlas,index),colour=id===0?[35,65,66]:mode==='B'&&id>0?[235,190,65]:[220,70,65]
    raw.set(colour,(z*size+x)*3)
   }maps.push({mode,floor,layer,iy,width:size,height:size,data:raw})
  }
  const points=data.points.map(p=>{
   if(p.floorIndex<0)return{...p,exterior:true}
   const normal=new Vector3().fromArray(p.normal),geometric=new Vector3().fromArray(p.geometricNormal),position=new Vector3().fromArray(p.position),floor=p.floorIndex,range=field.ranges[floor],step=[field.bounds.size/(field.volume.n-1),(range.top-range.bottom)/11,field.bounds.size/(field.volume.n-1)],floorReceiver=geometric.y>.9&&position.y>=field.floors[floor].elevation-.02&&position.y<=field.floors[floor].elevation+.08,bias=floorReceiver?.004:.02+step.reduce((s,v,i)=>s+Math.abs(p.geometricNormal[i])*v,0)
   position.addScaledVector(geometric,bias)
   const samples=Object.fromEntries(['legacy','A','B'].map(mode=>[mode,sampleBarrierField(field,metadata,position,normal,floor,floorReceiver,mode as 'legacy'|'A'|'B')]))
   return{...p,biasedPosition:position.toArray(),floorReceiver,samples}
  })
  self.postMessage({ok:true,maps,points,statistics:metadata.statistics,bounds:field.bounds},{transfer:maps.map(m=>m.data.buffer)})
 }catch(error){self.postMessage({ok:false,error:String(error)})}finally{field.dispose();visibility.dispose()}
}
