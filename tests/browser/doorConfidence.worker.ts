import {Vector3} from 'three'
import {restoreIndirectField} from '../../src/indirectLighting'
import {createIndirectVisibilityFromSnapshot} from '../../src/indirectVisibility'
import {sampleIndirectCoefficients} from '../../src/indirectVolume'
import {indirectSHIrradianceBasis} from '../../src/indirectSH'
import {indirectFloorConfidence} from '../../src/indirectFloorLighting'
import {createDoorConfidenceSampler} from '../doorVisibilityConfidence'
import {createSceneLightingReference} from '../sceneLightingReference'

self.onmessage=({data})=>{
 const started=performance.now(),field=restoreIndirectField(data.field),visibility=createIndirectVisibilityFromSnapshot(data.geometry)
 field.coefficients=data.coefficients
 const sampler=createDoorConfidenceSampler(field,visibility),reference=createSceneLightingReference(data.reference)
 const basis=indirectSHIrradianceBasis(new Vector3(0,1,0),field.shOrder),coefficients=new Float64Array(field.coefficientCount*3)
 try{
  const points=data.points.map((p:{name:string;position:number[];kind:string;reference?:unknown},i:number)=>{
   self.postMessage({progress:i,total:data.points.length,name:p.name})
   const result=sampler.sample(p.position),support=sampleIndirectCoefficients(field,0,...p.position as[number,number,number],coefficients,visibility)
   const baseline=[0,1,2].map(c=>Math.max(0,basis.reduce((s,b,k)=>s+b*coefficients[c*field.coefficientCount+k],0))*indirectFloorConfidence(support))
   if(baseline.some((v,c)=>Math.abs(v-result.variants.binary.rgb[c])>1e-8))throw Error('Diagnostic baseline differs from production')
   const ref=p.reference??reference.evaluate({name:p.name,position:[p.position[0],p.position[1]-.004,p.position[2]],normal:[0,1,0],geometricNormal:[0,1,0]},data.samples??4096,6,1234)
   return{...result,name:p.name,kind:p.kind,reference:ref}
  })
  self.postMessage({ok:true,configuration:data.configuration,points,probes:sampler.probes,counters:sampler.counters,step:sampler.step,elapsedMs:performance.now()-started,samples:data.samples,typedInputBytes:data.geometry.reduce((n:number,g:any)=>n+g.position.byteLength+(g.index?.byteLength??0),0)+data.reference.positions.byteLength+data.reference.uvs.byteLength+data.reference.materialIndices.byteLength+data.reference.textures.reduce((n:number,t:any)=>n+t.pixels.byteLength,0),heap:(performance as any).memory?.usedJSHeapSize??null})
 }catch(e){self.postMessage({ok:false,error:String(e)})}finally{visibility.dispose();reference.dispose();field.dispose()}
}
