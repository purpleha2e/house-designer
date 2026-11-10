import {DataUtils,Vector3} from 'three'
import type {IndirectField} from '../src/indirectLighting.ts'
import type {IndirectVisibility} from '../src/indirectVisibility.ts'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
import {indirectFloorConfidence} from '../src/indirectFloorLighting.ts'

export const confidenceRadii=[.01,.02,.04,.08]
export const confidenceCandidates=['binary',...confidenceRadii.flatMap(r=>[4,8].map(n=>`ring${n}-${r}`)),'boundary-taper']

/** Diagnostic only. Every candidate is gated by the unchanged central ray.
 * Ring fractions are confidence hypotheses, not measured energy fractions.
 * The one bounded alternative tapers over two existing floor cells using
 * distance to blocked lattice neighbours; it never filters final lighting. */
export function createDoorConfidenceSampler(field:IndirectField,visibility:Pick<IndirectVisibility,'occluded'>){
 if(field.contactLighting||field.spatialInterpolation!=='legacy')throw Error('Experiment requires the reported legacy, non-contact field')
 const origin=new Vector3(),direction=new Vector3(),basis=indirectSHIrradianceBasis(new Vector3(0,1,0),field.shOrder)
 const radius2=(field.spacing*1.75)**2,h=field.bounds.size/(field.floorLayer.n-1)
 const counters=Object.fromEntries(confidenceCandidates.map(k=>[k,{queries:0,ms:0}]))
 const probes=field.probes.filter(p=>field.positionData[p.index*4+3]>=.5).map(p=>({index:p.index,position:Array.from(field.positionData.subarray(p.index*4,p.index*4+3)),coefficients:field.coefficients.flatMap(a=>Array.from(a.subarray(p.index*field.coefficientCount,(p.index+1)*field.coefficientCount),DataUtils.fromHalfFloat))}))
 const visible=(p:typeof probes[number],x:number,y:number,z:number,key:string)=>{
  origin.fromArray(p.position);direction.set(x-origin.x,y-origin.y,z-origin.z)
  const d=direction.length(),max=Math.max(0,d-.001)
  if(max<=.025)return true
  counters[key].queries++
  return !visibility.occluded(origin,direction.divideScalar(d),max,.025)
 }
 return {probes,counters,step:h,sample(point:number[]){
  const [x,y,z]=point,started=performance.now()
  const links=probes.map(p=>{const d2=p.position.reduce((s,v,i)=>s+(v-point[i])**2,0);return{probe:p,distance:Math.sqrt(d2),baseWeight:(1-d2/radius2)**2,central:d2<radius2&&visible(p,x,y,z,'binary')}}).filter(l=>l.distance**2<radius2)
  counters.binary.ms+=performance.now()-started
  const variants:Record<string,{confidence:number[];weights:number[];normalizedWeights:number[];support:number;coefficients:number[];unclamped:number[];rgb:number[]}>= {}
  for(const key of confidenceCandidates){
   const start=performance.now(),confidence=links.map(l=>{
    if(!l.central)return 0
    if(key==='binary')return 1
    if(key==='boundary-taper'){
     let nearest=Infinity
     for(let iz=-2;iz<=2;iz++)for(let ix=-2;ix<=2;ix++){
      const d=Math.hypot(ix,iz)*h
      if(!d||d>2*h)continue
      if(!visible(l.probe,x+ix*h,y,z+iz*h,key))nearest=Math.min(nearest,d)
     }
     const t=Math.min(1,Math.max(0,(nearest-h/2)/(2*h)))
     return t*t*(3-2*t)
    }
    const [pattern,radius]=key.split('-'),n=Number(pattern.slice(4)),r=Number(radius)
    let count=0
    for(let j=0;j<n;j++){const angle=j*2*Math.PI/n;if(visible(l.probe,x+r*Math.cos(angle),y,z+r*Math.sin(angle),key))count++}
    return (count+1)/(n+1)
   })
   const weights=links.map((l,i)=>l.baseWeight*confidence[i]),support=weights.reduce((a,b)=>a+b,0),normalizedWeights=weights.map(w=>w/Math.max(1e-30,support))
   const coefficients=Array.from({length:field.coefficientCount*3},(_,k)=>links.reduce((sum,l,i)=>sum+normalizedWeights[i]*l.probe.coefficients[k],0))
   const unclamped=[0,1,2].map(c=>basis.reduce((sum,b,k)=>sum+b*coefficients[c*field.coefficientCount+k],0)),coverageConfidence=indirectFloorConfidence(support)
   variants[key]={confidence,weights,normalizedWeights,support,coefficients,unclamped,rgb:unclamped.map(v=>Math.max(0,v)*coverageConfidence)}
   counters[key].ms+=performance.now()-start
  }
  return{position:point,normal:[0,1,0],links:links.map(l=>({index:l.probe.index,distance:l.distance,baseWeight:l.baseWeight,central:l.central})),variants}
 }}
}
