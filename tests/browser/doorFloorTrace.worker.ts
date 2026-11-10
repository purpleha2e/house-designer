import {DataUtils,Vector3} from 'three'
import {restoreIndirectField} from '../../src/indirectLighting'
import {createIndirectVisibilityFromSnapshot} from '../../src/indirectVisibility'
import {sampleIndirectCoefficients} from '../../src/indirectVolume'
import {sampleBakedIndirectFloor,indirectFloorConfidence} from '../../src/indirectFloorLighting'
import {indirectSHIrradianceBasis} from '../../src/indirectSH'
import {createSceneLightingReference} from '../sceneLightingReference'

self.onmessage=({data})=>{
 const started=performance.now(),field=restoreIndirectField(data.field),visibility=createIndirectVisibilityFromSnapshot(data.geometry)
 field.coefficients=data.coefficients;field.floorLayer.data.set(data.floorLayer);field.floorLayer.ready=true
 const reference=data.reference?createSceneLightingReference(data.reference):null
 const normal=new Vector3(0,1,0),basis=indirectSHIrradianceBasis(normal,field.shOrder),occluded=visibility.occluded
 const rgb=(a:ArrayLike<number>)=>[0,1,2].map(c=>basis.reduce((s,b,k)=>s+b*a[c*field.coefficientCount+k],0))
 try{
  if(field.contactLighting||field.spatialInterpolation!=='legacy')throw Error('Trace expects the reported legacy, non-contact field')
  const points=data.points.map((p:number[],i:number)=>{
   self.postMessage({progress:i,total:data.points.length})
   const links:unknown[]=[],weights:number[]=[]
   visibility.occluded=(origin,direction,max,near)=>{
    const index=field.probes.find(p=>origin.distanceToSquared(new Vector3().fromArray(field.positionData,p.index*4))<1e-10)!.index
    const blocked=occluded(origin,direction,max,near),hit=visibility.hit(origin,direction,max,near)
    const distance=max+.001,weight=(1-distance**2/(field.spacing*1.75)**2)**2
    const coefficients=field.coefficients.flatMap(a=>Array.from(a.subarray(index*field.coefficientCount,(index+1)*field.coefficientCount),DataUtils.fromHalfFloat))
    links.push({index,position:origin.toArray(),distance,visibility:blocked?0:1,independentVisibility:hit?0:1,hit:hit?{position:hit.point.toArray(),distance:hit.distance,normal:hit.face?.normal.toArray()}:null,baseWeight:weight,coefficients,irradiance:rgb(coefficients)})
    weights.push(blocked?0:weight);return blocked
   }
   const coefficients=new Float64Array(field.coefficientCount*3),support=sampleIndirectCoefficients(field,0,...p as [number,number,number],coefficients,visibility)
   const total=weights.reduce((a,b)=>a+b,0),unclamped=rgb(coefficients),confidence=indirectFloorConfidence(support)
   const contributions=links.map((l:any,j)=>({...l,normalizedWeight:weights[j]/Math.max(1e-12,total),contribution:l.irradiance.map((v:number)=>v*weights[j]/Math.max(1e-12,total)*confidence)}))
   const reconstructed=[0,1,2].map(c=>contributions.reduce((s,l)=>s+l.contribution[c],0))
   if(reconstructed.some((v,c)=>Math.abs(v-unclamped[c]*confidence)>1e-7))throw Error('Contribution trace does not reproduce the production blend')
   return {position:p,normal:normal.toArray(),links:contributions,support,confidence,unclamped,unfiltered:unclamped.map(v=>Math.max(0,v)*confidence),filtered:sampleBakedIndirectFloor(field,0,new Vector3().fromArray(p),normal),reference:reference?.evaluate({name:'texel-'+i,position:[p[0],.012,p[2]],normal:[0,1,0],geometricNormal:[0,1,0]},data.samples??8192,6,1234)}
  })
  self.postMessage({ok:true,points,elapsedMs:performance.now()-started,probeKinds:[...new Set(field.probes.map(p=>p.kind))]})
 }catch(e){self.postMessage({ok:false,error:String(e)})}finally{visibility.dispose();reference?.dispose();field.dispose()}
}
