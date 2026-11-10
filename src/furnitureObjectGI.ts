import {Box3,DataUtils,Vector3} from 'three'
import type {IndirectField,IndirectRegion} from './indirectLighting.ts'
import {pointIsInsideRoomPolygon} from './roomLightMask.ts'
import {indirectSHIrradianceBasis} from './indirectSH.ts'

export type ObjectGIStrategy='above'|'centre-adjacent'|'four'|'eight'
const inside=(r:IndirectRegion,p:Vector3)=>p.y>r.bottom+.02&&p.y<r.top-.02&&pointIsInsideRoomPolygon({x:p.x,y:p.z},r.polygon)
/** Conservative object-level experiment. No visibility rays or acceleration
 * construction. Room membership is a hard gate, not an inverse-distance hint. */
export function sampleObjectGI(field:IndirectField,bounds:Box3,strategy:ObjectGIStrategy,otherBounds:Box3[]=[]){
 const started=performance.now(),centre=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3())
 const region=field.regions.find(r=>inside(r,centre))
 if(!region)return{ok:false as const,reason:'No single indoor region at object centre'}
 if(bounds.min.y<region.bottom-.03||bounds.max.y>region.top-.02)return{ok:false as const,reason:'Object exceeds the room height range'}
 // Check the full horizontal perimeter at <=10cm intervals; reject uncertain
 // room-boundary objects instead of borrowing light through another room.
 for(const y of [Math.max(bounds.min.y,region.bottom+.03),Math.min(bounds.max.y,region.top-.03)])for(let edge=0;edge<4;edge++){
  const corners=[[bounds.min.x,bounds.min.z],[bounds.max.x,bounds.min.z],[bounds.max.x,bounds.max.z],[bounds.min.x,bounds.max.z]],a=new Vector3(corners[edge][0],y,corners[edge][1]),b=new Vector3(corners[(edge+1)%4][0],y,corners[(edge+1)%4][1])
  const steps=Math.max(1,Math.ceil(a.distanceTo(b)/.1));for(let i=0;i<=steps;i++)if(!inside(region,a.clone().lerp(b,i/steps)))return{ok:false as const,reason:'Object bounds span or touch a room boundary'}
 }
 const pad=.12,above=new Vector3(centre.x,bounds.max.y+pad,centre.z),sides=[new Vector3(bounds.min.x-pad,centre.y,centre.z),new Vector3(bounds.max.x+pad,centre.y,centre.z),new Vector3(centre.x,centre.y,bounds.min.z-pad),new Vector3(centre.x,centre.y,bounds.max.z+pad)]
 const topCorners=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,z])=>new Vector3(centre.x+x*size.x*.3,above.y,centre.z+z*size.z*.3))
 const valid=(p:Vector3)=>inside(region,p)&&!bounds.containsPoint(p)&&!otherBounds.some(b=>b.containsPoint(p))
 const accessibleSides=sides.filter(valid).sort((a,b)=>a.distanceToSquared(centre)-b.distanceToSquared(centre))
 const requested=strategy==='above'?[above]:strategy==='centre-adjacent'?accessibleSides.slice(0,1):strategy==='four'?sides:[...sides,...topCorners]
 const target=strategy==='four'?4:strategy==='eight'?8:1,points=requested.filter(valid)
 const topEdges=[[-1,0],[1,0],[0,-1],[0,1]].map(([x,z])=>new Vector3(centre.x+x*size.x*.3,above.y,centre.z+z*size.z*.3))
 if(strategy==='four'||strategy==='eight')for(const p of [...topCorners,above,...topEdges,...sides]){if(points.length>=target)break;if(valid(p)&&!points.some(q=>q.distanceToSquared(p)<1e-12))points.push(p)}
 if(!points.length)return{ok:false as const,reason:'No conservative accessible representative positions'}
 const candidates=field.probes.filter(p=>p.region.id===region.id&&field.positionData[p.index*4+3]>.5&&inside(region,new Vector3().fromArray(field.positionData,p.index*4)))
 if(!candidates.length)return{ok:false as const,reason:'No completed probes in the selected room'}
 const selectionMs=performance.now()-started,blendStarted=performance.now(),samples=points.map(position=>{
  const nearest=candidates.map(p=>({index:p.index,d2:position.distanceToSquared(new Vector3().fromArray(field.positionData,p.index*4))})).sort((a,b)=>a.d2-b.d2).slice(0,8)
  const coefficients=new Float32Array(3*field.coefficientCount);let total=0
  const links=nearest.map(p=>({...p,weight:1/(p.d2+.15**2)}))
  for(const p of links){total+=p.weight;for(let c=0;c<3;c++)for(let k=0;k<field.coefficientCount;k++)coefficients[c*field.coefficientCount+k]+=p.weight*DataUtils.fromHalfFloat(field.coefficients[c][p.index*field.coefficientCount+k])}
  for(let i=0;i<coefficients.length;i++)coefficients[i]/=total
  return{position:position.toArray(),coefficients:Array.from(coefficients),links}
 })
 const coefficients=new Float32Array(3*field.coefficientCount)
 for(const p of samples)for(let k=0;k<coefficients.length;k++)coefficients[k]+=p.coefficients[k]/samples.length
 return{ok:true as const,regionId:region.id,floorId:region.floorId,strategy,requestedCount:strategy==='four'?4:strategy==='eight'?8:1,actualCount:samples.length,samples,coefficients:Array.from(coefficients),selectionMs,blendMs:performance.now()-blendStarted,cpuMs:performance.now()-started,bytes:coefficients.byteLength}
}
export function evaluateObjectGI(coefficients:number[],normal:Vector3){const basis=indirectSHIrradianceBasis(normal.clone().normalize(),1);return[0,1,2].map(c=>Math.max(0,basis.reduce((s,v,k)=>s+v*coefficients[c*4+k],0)))}

/** Keep the original capture branch intact. Display branches never call the
 * receiver-offset or volume sampler. The existing PBR diffuse BRDF consumes
 * irradiance; no extra GI contribution is added. */
export function patchObjectGIShader(source:string){
 const receiver='float hdGIId = hdGIReceiver(',begin='            vec3 hdGIMean;',end='            irradiance = hdGICapture'
 if(!source.includes(receiver)||!source.includes(begin)||!source.includes(end))throw Error('Object GI shader contract changed')
 source=source.replace(receiver,'float hdGIId = hdGICapture < .5 ? 0.0 : hdGIReceiver(')
 const start=source.indexOf(begin),stop=source.indexOf(end,start),original=source.slice(start,stop).replace('            vec3 hdGIMean;','').replaceAll('vec3 hdGILight =','hdGILight =')
 const block=`vec3 hdGILight;vec3 hdGIMean;
 if(hdGICapture<.5){vec4 basis=vec4(.886227,1.023328*hdGINormal.y,1.023328*hdGINormal.z,1.023328*hdGINormal.x);
 hdGILight=max(vec3(0.),vec3(dot(objectSHR,basis),dot(objectSHG,basis),dot(objectSHB,basis)));hdGIMean=hdGILight;
 hdGILight*=hdGIProbeStrength*hdGIDisplayStrength;
 }else{${original}}
 `
 return source.slice(0,start)+block+source.slice(stop)
}
