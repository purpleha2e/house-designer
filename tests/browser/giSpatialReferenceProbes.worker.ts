import {Vector3} from 'three'
import {createSceneLightingReference,type ReferenceSceneData} from '../sceneLightingReference'
import {indirectSHRadianceBasis,indirectSHIrradianceBasis} from '../../src/indirectSH'
type Probe={index:number;position:number[];values:{normal:number[];capturedSky:number[];[key:string]:unknown}[];[key:string]:unknown}
self.onmessage=({data}:{data:{scene:ReferenceSceneData;probes:Probe[];size:number;sourceOnly?:boolean}})=>{
 const reference=createSceneLightingReference(data.scene),quadrature=[]
 try{
  const size=data.size
  for(let face=0;face<6;face++)for(let row=0;row<size;row++)for(let col=0;col<size;col++){
   const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1]),weight=4/d.length()**3
   quadrature.push({direction:d.normalize().toArray(),weight,basis:indirectSHRadianceBasis(d,2)})
  }
  const factor=4*Math.PI/quadrature.reduce((s,p)=>s+p.weight,0)
  const probes=data.probes.map((probe,i)=>{
   const incoming=reference.incoming(probe.position,quadrature.map(q=>q.direction),data.sourceOnly?1:8,data.sourceOnly?0:6,777+i*1009)
   const coefficients=Array.from({length:9},(_,k)=>[0,1,2].map(c=>quadrature.reduce((s,q,j)=>s+q.weight*factor*q.basis[k]*incoming[j].radiance[c],0)))
   const values=probe.values.map(value=>{
    const raw=(sky:boolean)=>[0,1,2].map(c=>quadrature.reduce((s,q,j)=>s+q.weight*factor*Math.max(0,q.direction.reduce((s,d,k)=>s+d*value.normal[k],0))*(sky?incoming[j].sky[c]:incoming[j].radiance[c]),0))
    const sh=(order:1|2)=>[0,1,2].map(c=>Math.max(0,indirectSHIrradianceBasis(new Vector3().fromArray(value.normal),order).reduce((s,b,k)=>s+b*coefficients[k][c],0)))
    const referenceFirstPass=[0,1,2].map(c=>quadrature.reduce((s,q,j)=>s+q.weight*factor*Math.max(0,q.direction.reduce((s,d,k)=>s+d*value.normal[k],0))*incoming[j].firstPass[c],0))
    return{...value,...(data.sourceOnly?{}:{referenceRaw:raw(false),referenceSky:raw(true),referenceL1:sh(1),referenceL2:sh(2)}),referenceFirstPass}
   })
   const result={...probe,values,...(data.sourceOnly?{}:{referenceCoefficients:coefficients}),firstPassSourceMAE:values.flatMap(v=>v.capturedSky.map((x,c)=>Math.abs(x-v.referenceFirstPass[c]))).reduce((a,b)=>a+b,0)/18};Reflect.deleteProperty(result,'sourceSkyMAE');return result
  })
  self.postMessage({ok:true,probes,pathsPerDirection:8,depth:6,skyConvention:'Snapshot sky radiance is already scaled; directional source gain is not applied again.'})
 }catch(error){self.postMessage({ok:false,error:String(error)})}finally{reference.dispose()}
}
