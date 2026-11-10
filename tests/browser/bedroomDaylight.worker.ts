import {DataUtils,Vector3} from 'three'
import {createSceneLightingReference} from '../sceneLightingReference'
import {restoreIndirectField,INDIRECT_MASK_SIZE} from '../../src/indirectLighting'
import {createIndirectVisibilityFromSnapshot} from '../../src/indirectVisibility'
import {inspectIndirectPoint} from '../../src/indirectLightingDiagnostic'
import {indirectSHIrradianceBasis,indirectSHRadianceBasis} from '../../src/indirectSH'

self.onmessage=({data})=>{
 const started=performance.now(),reference=createSceneLightingReference(data.scene),field=restoreIndirectField(data.field),visibility=createIndirectVisibilityFromSnapshot(data.geometry)
 try{
  data.coefficients.forEach((c:Uint16Array,i:number)=>field.coefficients[i].set(c));field.volume.data.set(data.volume);field.floorLayer.data.set(data.floorLayer);field.floorLayer.ready=true
  const original={sun:data.scene.sunIrradiance.slice(),sky:data.scene.skyBase.slice(),groundSun:data.scene.skySun.slice()}
  const cases=[{name:'sun-1',sun:1,sky:1},{name:'sun-0',sun:0,sky:1},{name:'sky-0',sun:1,sky:0}]
  const sweeps=cases.map(c=>{self.postMessage({progress:c.name});data.scene.sunIrradiance=original.sun.map((v:number)=>v*c.sun);data.scene.skyBase=original.sky.map((v:number)=>v*c.sky);data.scene.skySun=original.groundSun.map((v:number)=>v*c.sun)
   return{...c,receivers:data.points.map((p:any,i:number)=>reference.evaluate({name:p.name,position:p.samplePosition,normal:p.normal,geometricNormal:p.normal},16384,6,1234+i*1009,6))}
  })
  // The independent diffuse path estimator is linear in source radiance. Reuse
  // the identical sampled paths algebraically; production is still measured
  // separately at every intensity, including its nonlinear SH clamps.
  for(const c of [{name:'sun-2',sun:2,sky:1},{name:'sun-4',sun:4,sky:1},{name:'sky-2',sun:1,sky:2}]){
   const without=sweeps.find(s=>s.name===(c.sky===1?'sun-0':'sky-0'))!,scale=c.sky===1?c.sun:c.sky
   sweeps.push({...c,receivers:sweeps[0].receivers.map((r:any,i:number)=>{const result={...r,derivedFrom:['sun-1',without.name],sourceMultiplier:scale,standardErrorConvention:'Conservative upper bounds for the correlated linear combination'};for(const key of ['direct','sky','reflected'])result[key]=r[key].map((v:number,k:number)=>v+(scale-1)*(v-(without.receivers[i] as any)[key][k]));for(const key of ['skyStandardError','reflectedStandardError'])result[key]=r[key].map((v:number,k:number)=>scale*v+(scale-1)*(without.receivers[i] as any)[key][k]);return result})})
  }
  data.scene.sunIrradiance=original.sun;data.scene.skyBase=original.sky;data.scene.skySun=original.groundSun
  const reconstruction=data.points.map((p:any)=>{
   const point=new Vector3().fromArray(p.position),normal=new Vector3().fromArray(p.normal),result=inspectIndirectPoint(field,visibility,point,normal,[])
   const weightsAt=(position:number[])=>{const origin=new Vector3(),direction=new Vector3(),radiusSquared=(field.spacing*1.75)**2
    const probes=field.probes.flatMap(probe=>{const offset=probe.index*4;if(field.positionData[offset+3]<.5)return[];origin.fromArray(field.positionData,offset);direction.fromArray(position).sub(origin);const distanceSquared=direction.lengthSq();if(distanceSquared>=radiusSquared)return[];const distance=Math.sqrt(distanceSquared),max=Math.max(0,distance-.001),visible=max<=.025||!visibility.occluded(origin,direction.multiplyScalar(1/distance),max,.025);const kernel=(1-distanceSquared/radiusSquared)**2,basis=indirectSHIrradianceBasis(normal,1)
     return[{index:probe.index,position:origin.toArray(),distance,visible,kernel,weight:visible?kernel:0,rawSH:field.coefficients.map(c=>basis.reduce((sum,b,k)=>sum+b*DataUtils.fromHalfFloat(c[probe.index*4+k]),0))}]
    });const support=probes.reduce((s,p)=>s+p.weight,0);return{support,probes:probes.map(p=>({...p,normalizedWeight:support?p.weight/support:0}))}
   }
   const floor=field.floors.findIndex(f=>f.id===result.floorId),range=field.ranges[floor],n=result.floorLayer?field.floorLayer.n:field.volume.n,clamp=(v:number)=>Math.max(0,Math.min(1,v)),gx=clamp((p.samplePosition[0]-field.bounds.minX)/field.bounds.size)*(n-1),gz=clamp((p.samplePosition[2]-field.bounds.minZ)/field.bounds.size)*(n-1),gy=clamp((p.samplePosition[1]-range.bottom)/(range.top-range.bottom))*11,grid=[]
   for(let dz=0;dz<2;dz++)for(let dy=0;dy<(result.floorLayer?1:2);dy++)for(let dx=0;dx<2;dx++){
    const x=Math.min(n-1,Math.floor(gx)+dx),z=Math.min(n-1,Math.floor(gz)+dz),y=Math.min(11,Math.floor(gy)+dy),weight=(dx?gx%1:1-gx%1)*(dz?gz%1:1-gz%1)*(result.floorLayer?1:dy?gy%1:1-gy%1),mx=Math.min(INDIRECT_MASK_SIZE-1,Math.floor(x/(n-1)*INDIRECT_MASK_SIZE)),mz=Math.min(INDIRECT_MASK_SIZE-1,Math.floor(z/(n-1)*INDIRECT_MASK_SIZE)),mask=field.mask.image.data as Uint8Array,m=((floor*INDIRECT_MASK_SIZE+mz)*INDIRECT_MASK_SIZE+mx)*4,ceiling=range.bottom+(mask[m+1]*256+mask[m+2])/65535*(range.top-range.bottom),nominalY=Math.max(field.floors[floor].elevation+.06,range.bottom+y/11*(range.top-range.bottom)),sampleY=result.floorLayer?field.floors[floor].elevation+.016:mask[m]?Math.max(field.floors[floor].elevation+.06,Math.min(nominalY,ceiling-.06)):nominalY,position=[field.bounds.minX+x/(n-1)*field.bounds.size,sampleY,field.bounds.minZ+z/(n-1)*field.bounds.size],contributors=weightsAt(position)
    grid.push({index:[x,y,z],position,interpolationWeight:weight,mask:mask[m],support:result.floorLayer&&!mask[m]?0:contributors.support,confidence:result.floorLayer?Math.min(1,(mask[m]?contributors.support:0)/.1):1,probes:contributors.probes})
   }
   return{...result,weightsAtBiasedPoint:weightsAt(p.samplePosition),weightsNearSurface:weightsAt(point.addScaledVector(normal,.004).toArray()),grid,note:'Point and baked-grid weights use the unchanged legacy kernel/visibility. Grid records include floor confidence and ceiling sample clamping, before the separate 10 cm display filter.'}
  })
  const contributing=new Set<number>(reconstruction.flatMap((r:any)=>[...r.weightsAtBiasedPoint.probes,...r.weightsNearSurface.probes].filter((p:any)=>p.visible).map((p:any)=>p.index))),activeCaptures=data.captures.filter((p:any)=>contributing.has(p.index))
  const probeReference=activeCaptures.map((p:any,i:number)=>{
   self.postMessage({progress:'contributing probe '+(i+1)+'/'+activeCaptures.length})
   const incoming=reference.incoming(p.position,p.samples.map((q:any)=>q.direction),16,6,800+i*1009,false,6),factor=4*Math.PI/p.samples.reduce((s:number,q:any)=>s+q.weight,0)
   const coefficients=Array.from({length:4},(_,k)=>[0,1,2].map(c=>p.samples.reduce((s:number,q:any,j:number)=>s+q.weight*factor*indirectSHRadianceBasis(new Vector3().fromArray(q.direction),1)[k]*incoming[j].radiance[c],0)))
   const receivers=data.points.map((r:any)=>{const basis=indirectSHIrradianceBasis(new Vector3().fromArray(r.normal),1)
    const integrate=(kind:string)=>[0,1,2].map(c=>p.samples.reduce((sum:number,q:any,j:number)=>sum+q.weight*factor*Math.max(0,q.direction.reduce((s:number,d:number,k:number)=>s+d*r.normal[k],0))*(kind==='reference'?incoming[j].radiance[c]:kind==='referenceFirst'?incoming[j].firstPass[c]:q[kind][c]),0))
    return{name:r.name,capturedFirst:integrate('direct'),capturedFinal:integrate('final'),referenceFirst:integrate('referenceFirst'),referenceFinal:integrate('reference'),productionSH:p.coefficients.map((c:number[])=>Math.max(0,basis.reduce((s,b,k)=>s+b*c[k],0))),referenceSH:[0,1,2].map(c=>Math.max(0,basis.reduce((s,b,k)=>s+b*coefficients[k][c],0)))}
   });return{index:p.index,position:p.position,referenceCoefficients:coefficients,receivers}
  })
  const referenceReceiverSH=data.points.map((p:any,i:number)=>{
   self.postMessage({progress:'receiver angular reference '+(i+1)+'/6'})
   const quadrature=data.captures[0].samples,factor=4*Math.PI/quadrature.reduce((s:number,q:any)=>s+q.weight,0),incoming=reference.incoming(p.samplePosition,quadrature.map((q:any)=>q.direction),16,6,91000+i*1009,false,6),basis=indirectSHIrradianceBasis(new Vector3().fromArray(p.normal),1)
   const coefficients=Array.from({length:4},(_,k)=>[0,1,2].map(c=>quadrature.reduce((s:number,q:any,j:number)=>s+q.weight*factor*indirectSHRadianceBasis(new Vector3().fromArray(q.direction),1)[k]*incoming[j].radiance[c],0)))
   return{name:p.name,raw:[0,1,2].map(c=>quadrature.reduce((s:number,q:any,j:number)=>s+q.weight*factor*Math.max(0,q.direction.reduce((sum:number,d:number,k:number)=>sum+d*p.normal[k],0))*incoming[j].radiance[c],0)),l1:[0,1,2].map(c=>Math.max(0,basis.reduce((s,b,k)=>s+b*coefficients[k][c],0)))}
  })
  const referenceProbeBlends=reconstruction.map((r:any,i:number)=>{
   const basis=indirectSHIrradianceBasis(new Vector3().fromArray(data.points[i].normal),1),weights=r.weightsAtBiasedPoint.probes.filter((p:any)=>p.visible),coveredWeight=weights.reduce((s:number,p:any)=>s+(probeReference.some((q:any)=>q.index===p.index)?p.normalizedWeight:0),0)
   const rgb=[0,1,2].map(c=>Math.max(0,weights.reduce((s:number,p:any)=>{const ref=probeReference.find((q:any)=>q.index===p.index);return s+(ref?p.normalizedWeight*basis.reduce((sum,b,k)=>sum+b*ref.referenceCoefficients[k][c],0):0)},0)))
   return{name:data.points[i].name,coveredWeight,referenceProbeBlend:rgb,productionProbeBlend:r.exactAtShiftedSample.unboundedRGB,storedField:r.displayed.rgb,independentAtReceiver:sweeps[0].receivers[i].sky.map((v:number,c:number)=>v+sweeps[0].receivers[i].reflected[c]),note:'Counterfactual point interpolation using independently traced probe radiance, the same production point weights, and L1. It diagnoses spatial/angular limits separately from errors in the production probe captures; it is not used as the independent receiver reference.'}
  })
  self.postMessage({ok:true,sweeps,reconstruction,probeReference,referenceReceiverSH,referenceProbeBlends,elapsedMs:performance.now()-started,convention:'Six source encounters, identical seeded paths for each source sweep; diffuse textured reference with hard visibility. Probe reference uses 16 paths per cubemap direction. No probe interpolation is used by the independent reference.'})
 }catch(error){self.postMessage({ok:false,error:String(error)})}finally{reference.dispose();field.dispose();visibility.dispose()}
}
