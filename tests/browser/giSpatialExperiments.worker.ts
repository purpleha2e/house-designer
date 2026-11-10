import {DataUtils,Vector3} from 'three'
import {restoreIndirectField,type IndirectFieldData} from '../../src/indirectLighting'
import {createIndirectVisibilityFromSnapshot} from '../../src/indirectVisibility'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic'
import {indirectSHRadianceBasis,indirectSHIrradianceBasis} from '../../src/indirectSH'
import {createSceneLightingReference,type ReferenceSceneData,type ReferenceReceiver} from '../sceneLightingReference'
import {spatialInfluences,spatialIrradiance,type SpatialMethod} from '../giSpatialReconstruction'
type Capture={index:number;position:number[];samples:{direction:number[];weight:number;direct:number[];final:number[]}[]}
self.onmessage=({data}:{data:{kind:string;variant:string;field:IndirectFieldData;coefficients:Uint16Array[];volume:Uint16Array;floorLayer:Uint16Array;scene:ReferenceSceneData;points:(ReferenceReceiver&{camera?:string})[];captures:Capture[];referenceOverride?:ReturnType<ReturnType<typeof createSceneLightingReference>['evaluate']>[]}})=>{
 const started=performance.now(),field=restoreIndirectField(data.field),reference=createSceneLightingReference(data.scene)
 const visibility=createIndirectVisibilityFromSnapshot([{position:data.scene.positions,stride:3,offset:0,normalized:false,index:null,ranges:[{start:0,count:data.scene.positions.length/3}],matrices:[[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]],structural:false}])
 field.coefficients=data.coefficients;field.volume.data.set(data.volume);field.floorLayer.data.set(data.floorLayer);field.floorLayer.ready=true
 try{
  const methods:SpatialMethod[]=['current','nearest','same-room','portal','local-1','local-2','local-3','occluder-local']
  const points=data.points.map((p,i)=>{
   self.postMessage({progress:p.name})
   const normal=new Vector3().fromArray(p.normal),point=new Vector3().fromArray(p.position),floor=Math.max(0,field.floors.findIndex((_,i)=>p.position[1]+p.geometricNormal[1]*.08>=field.ranges[i].bottom&&p.position[1]+p.geometricNormal[1]*.08<field.ranges[i].top))
   const step=[field.bounds.size/(field.volume.n-1),(field.ranges[floor].top-field.ranges[floor].bottom)/11,field.bounds.size/(field.volume.n-1)]
   const floorReceiver=p.normal[1]>.9&&p.position[1]<field.floors[floor].elevation+.08,bias=floorReceiver?.004:.02+p.normal.reduce((s,n,i)=>s+Math.abs(n)*step[i],0)
   const shifted=point.clone().addScaledVector(normal,bias)
   const candidates=Object.fromEntries(methods.map(m=>{const weights=spatialInfluences(field,visibility,{...p,floor},m,data.kind==='two-rooms'?2.5:undefined);return[m,{rgb:spatialIrradiance(field,weights,p.normal),...weights}]}))
   return{...p,shaderEquivalent:sampleDisplayedIndirect(field,floor,shifted,normal),candidates,reference:data.referenceOverride?.[i]??reference.evaluate(p,p.name.includes('-')?8192:32768,6,1234+i*1009)}
  })
  const probes=data.captures.map((capture,i)=>{
   self.postMessage({progress:`probe ${i+1}/${data.captures.length}`})
   const incoming=reference.incoming(capture.position,capture.samples.map(s=>s.direction),data.kind==='house'?8:16,6,777+i*1009),solidAngle=capture.samples.reduce((s,p)=>s+p.weight,0)
   const project=(values:number[][])=>Array.from({length:9},(_,k)=>[0,1,2].map(c=>capture.samples.reduce((s,p,j)=>s+p.weight*4*Math.PI/solidAngle*indirectSHRadianceBasis(new Vector3().fromArray(p.direction),2)[k]*values[j][c],0)))
   const captured=project(capture.samples.map(s=>s.final)),independent=project(incoming.map(s=>s.radiance))
   const normals=[[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,0,0],[-1,0,0]]
   const values=normals.map(n=>{
    const raw=(data:number[][])=>[0,1,2].map(c=>capture.samples.reduce((s,p,j)=>s+p.weight*4*Math.PI/solidAngle*Math.max(0,p.direction.reduce((s,d,i)=>s+d*n[i],0))*data[j][c],0))
    const sh=(coefficients:number[][],order:1|2)=>{const basis=indirectSHIrradianceBasis(new Vector3().fromArray(n),order);return[0,1,2].map(c=>Math.max(0,basis.reduce((s,b,k)=>s+b*coefficients[k][c],0)))}
    return{normal:n,capturedRaw:raw(capture.samples.map(s=>s.final)),referenceRaw:raw(incoming.map(s=>s.radiance)),capturedL1:sh(captured,1),capturedL2:sh(captured,2),referenceL1:sh(independent,1),referenceL2:sh(independent,2),capturedSky:raw(capture.samples.map(s=>s.direct)),referenceSky:raw(incoming.map(s=>s.sky))}
   })
   const maxCoefficientDifference=Math.max(...captured.slice(0,field.coefficientCount).flatMap((p,k)=>p.map((v,c)=>Math.abs(v-DataUtils.fromHalfFloat(field.coefficients[c][capture.index*field.coefficientCount+k])))))
   return{index:capture.index,position:capture.position,values,maxCoefficientDifference,capturedCoefficients:captured,referenceCoefficients:independent,sourceSkyMAE:values.flatMap(v=>v.capturedSky.map((x,c)=>Math.abs(x-v.referenceSky[c]))).reduce((a,b)=>a+b,0)/18}
  })
  self.postMessage({ok:true,points,probes,elapsedMs:performance.now()-started,field:{positions:field.probes.map(p=>({index:p.index,position:new Vector3().fromArray(field.positionData,p.index*4).toArray(),region:p.region.id,kind:p.kind})),spacing:field.spacing,volumeStep:field.bounds.size/(field.volume.n-1),floorStep:field.bounds.size/(field.floorLayer.n-1),shOrder:field.shOrder},scope:'Diagnostic alternatives share one completed production field; candidate interpolation is not fed back into transport in this run. L1/L2 probe rows project identical final atlas radiance. Reference probe paths use identical cube directions, 16 paths/direction, six secondary bounces.'})
 }catch(error){self.postMessage({ok:false,error:String(error)})}finally{reference.dispose();visibility.dispose();field.dispose()}
}
