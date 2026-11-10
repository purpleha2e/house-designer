import {Vector3} from 'three'
import {createSceneLightingReference,type ReferenceSceneData,type ReferenceReceiver} from '../sceneLightingReference'
import {indirectSHIrradianceBasis,indirectSHRadianceBasis} from '../../src/indirectSH'

self.onmessage=({data}:{data:{scene:ReferenceSceneData;points:ReferenceReceiver[];samples:number;probes:{index:number;position:number[];coefficients:number[][];capture:{direction:number[];weight:number;rgb:number[]}[]}[]}})=>{
 const started=performance.now(),reference=createSceneLightingReference(data.scene)
 try{
  const results=data.points.map((p,i)=>{self.postMessage({progress:{stage:'surface reference',index:i,total:data.points.length,name:p.name}});return{...p,reference:reference.evaluate(p,data.samples,6,1234+i*1009)}})
  const directions=Array.from({length:1024},(_,i)=>{const y=1-2*(i+.5)/1024,r=Math.sqrt(1-y*y),a=i*Math.PI*(3-Math.sqrt(5));return[r*Math.cos(a),y,r*Math.sin(a)]})
  const probes=data.probes.map((p,i)=>{
   self.postMessage({progress:{stage:'independent probe directions',index:i,total:data.probes.length}})
   const incoming=reference.incoming(p.position,directions,16,6,777+i*1009),coefficients=Array.from({length:3},()=>Array(4).fill(0))
   incoming.forEach((v,j)=>{const basis=indirectSHRadianceBasis(new Vector3().fromArray(directions[j]),1);for(let c=0;c<3;c++)for(let k=0;k<4;k++)coefficients[c][k]+=v.radiance[c]*basis[k]*4*Math.PI/directions.length})
   const solid=p.capture.reduce((s,q)=>s+q.weight,0),capturedCoefficients=Array.from({length:3},()=>Array(4).fill(0))
   for(const q of p.capture){const basis=indirectSHRadianceBasis(new Vector3().fromArray(q.direction),1);for(let c=0;c<3;c++)for(let k=0;k<4;k++)capturedCoefficients[c][k]+=q.rgb[c]*basis[k]*q.weight*4*Math.PI/solid}
   const values=[[-1,0,0],[1,0,0],[0,1,0],[0,-1,0],[0,0,-1],[0,0,1]].map(n=>{const basis=indirectSHIrradianceBasis(new Vector3().fromArray(n),1),sh=(a:number[][])=>a.map(a=>Math.max(0,a.reduce((s,v,k)=>s+v*basis[k],0))),raw=[0,1,2].map(c=>incoming.reduce((s,v,j)=>s+v.radiance[c]*Math.max(0,n.reduce((s,v,k)=>s+v*directions[j][k],0))*4*Math.PI/directions.length,0)),capturedRaw=p.capture.length?[0,1,2].map(c=>p.capture.reduce((s,q)=>s+q.rgb[c]*Math.max(0,n.reduce((s,v,k)=>s+v*q.direction[k],0))*q.weight*4*Math.PI/solid,0)):null;return{normal:n,bakedL1:sh(p.coefficients),referenceL1:sh(coefficients),referenceRaw:raw,capturedRaw,capturedL1:p.capture.length?sh(capturedCoefficients):null}})
   const {capture,...saved}=p
   return{...saved,referenceCoefficients:coefficients,capturedCoefficients:capture.length?capturedCoefficients:null,maxCaptureCoefficientDifference:capture.length?Math.max(...capturedCoefficients.flatMap((a,c)=>a.map((v,k)=>Math.abs(v-p.coefficients[c][k])))):null,values,directions:1024,pathsPerDirection:16,captureRays:capture.length}
  })
  self.postMessage({ok:true,results,probes,elapsedMs:performance.now()-started,samples:data.samples,depth:6,limitations:['Probe quadrature uses 1024 Fibonacci directions and 16 paths per direction, without confidence intervals.','Stored L1 versus independent L1 measures combined capture/transport error; no saved final cubemap radiance is available to split capture from SH integration.','Surface reference excludes secondary normal maps, emission and specular transport; direct visibility is hard rather than shadow-map filtered.']})
 }catch(error){self.postMessage({ok:false,error:String(error)})}finally{reference.dispose()}
}
