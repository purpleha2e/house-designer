/** Diagnostic-only reconstruction. Never imported by the application. */
import {DataUtils, Vector3} from 'three'
import type {IndirectField} from '../src/indirectLighting.ts'
import type {IndirectVisibility} from '../src/indirectVisibility.ts'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
import {indirectFloorConfidence} from '../src/indirectFloorLighting.ts'

export type LocalDefinition = 'spatial' | 'geometric' | 'cell-four'
export const localDefinitions: LocalDefinition[] = ['spatial', 'geometric', 'cell-four']
export type LocalLink = {index:number; position:number[]; regionId:number; distance:number; spatialWeight:number;
  visible:boolean; coefficients:number[]; signature?:number[]}
const luminance = (rgb:number[]) => rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722
const distance2 = (a:number[],b:number[]) => a.reduce((s,v,i)=>s+(v-b[i])**2,0)

/** Membership never depends on coefficients or which cross probe just became
 * visible. Cell selection uses all candidates, then applies exact visibility.
 * Six axis boundary coordinates describe enclosure similarity, NOT neighbouring
 * receiver visibility, a visibility fraction, room labels, or portal transport. */
export function reconstructLocalLight(links:LocalLink[], position:number[], normal:number[], spacing:number,
  definition:LocalDefinition, floor=false, signature?:number[], fixedIndices?:Set<number>) {
  const start=performance.now(), basis=indirectSHIrradianceBasis(new Vector3().fromArray(normal).normalize(),1)
  const cell=position.map(v=>Math.floor(v/(spacing/2))),center=cell.map(v=>(v+.5)*spacing/2)
  const fixed=fixedIndices??new Set([...links].sort((a,b)=>distance2(a.position,center)-distance2(b.position,center)||a.index-b.index).slice(0,4).map(p=>p.index))
  const similarity=(p:LocalLink)=>signature&&p.signature?Math.sqrt(signature.reduce((s,v,i)=>s+Math.min(1,Math.abs(v-p.signature![i])/spacing)**2,0)/6):Infinity
  const membership=links.map(p=>definition==='spatial'?p.distance<spacing:definition==='cell-four'?fixed.has(p.index):p.distance<spacing*1.75&&similarity(p)<=.35)
  const weights=links.map(p=>p.visible?p.spatialWeight:0), support=weights.reduce((a,b)=>a+b,0)
  const localWeights=weights.map((w,i)=>membership[i]?w:0), localSupport=localWeights.reduce((a,b)=>a+b,0)
  const crossWeights=weights.map((w,i)=>membership[i]?0:w), crossSupport=crossWeights.reduce((a,b)=>a+b,0)
  // Two independent measurements and the existing minimum floor support are
  // required; geometrical eligibility is not proof of radiometric validity.
  const localCount=localWeights.filter(w=>w>0).length, valid=localCount>=2&&localSupport>=.1
  const blend=(w:number[],sum:number)=>Array.from({length:12},(_,k)=>sum?links.reduce((s,p,i)=>s+w[i]*p.coefficients[k]/sum,0):0)
  const evaluate=(c:number[])=>[0,1,2].map(channel=>Math.max(0,basis.reduce((s,b,k)=>s+b*c[channel*4+k],0)))
  const productionCoefficients=blend(weights,support),localCoefficients=blend(localWeights,localSupport),crossCoefficients=blend(crossWeights,crossSupport)
  const coverage=floor?indirectFloorConfidence(support):1
  const production=evaluate(productionCoefficients).map(v=>v*coverage),local=evaluate(localCoefficients),cross=evaluate(crossCoefficients)
  const conservative=valid?local.map(v=>v*coverage):production.slice()
  // A bounded convex correction, not an additive source. Compare evaluated
  // irradiance, never signed SH coefficients. RGB version can change hue.
  const coupling=valid&&support?crossSupport/support:0
  const maskedRGB=valid?local.map((v,c)=>(v+coupling*Math.max(0,cross[c]-v))*coverage):production.slice()
  const maskedLuminance=valid&&luminance(cross)>luminance(local)?local.map((v,c)=>(v+coupling*(cross[c]-v))*coverage):conservative.slice()
  return {definition,cell,position,normal,support,localSupport,crossSupport,localCount,validLocal:valid,
    fallback:valid?null:'Insufficient local coverage; unchanged production reconstruction',coupling,coverage,
    production,local,conservative,maskedRGB,maskedLuminance,productionCoefficients,
    conservativeCoefficients:valid?localCoefficients:productionCoefficients,
    candidates:links.map((p,i)=>({index:p.index,position:p.position,regionId:p.regionId,distance:p.distance,
      spatialWeight:p.spatialWeight,visible:p.visible,local:membership[i],geometryMismatch:definition==='geometric'?similarity(p):null,
      irradiance:evaluate(p.coefficients),rawIrradiance:[0,1,2].map(c=>basis.reduce((s,b,k)=>s+b*p.coefficients[c*4+k],0)),
      normalizedWeight:support?weights[i]/support:0,localNormalizedWeight:localSupport?localWeights[i]/localSupport:0,
      crossNormalizedWeight:crossSupport?crossWeights[i]/crossSupport:0})),selectionAndBlendMs:performance.now()-start}
}

export function createLocalLightSampler(field:IndirectField,visibility:Pick<IndirectVisibility,'occluded'|'hit'>, diagnostic=false) {
  if(!diagnostic)throw Error('Local-light reconstruction requires explicit diagnostic opt-in')
  if(field.shOrder!==1||field.spatialInterpolation!=='legacy'||field.contactLighting)throw Error('Requires completed legacy L1 field')
  const start=performance.now(),origin=new Vector3(),direction=new Vector3(),radius2=(field.spacing*1.75)**2
  const counters={visibilityQueries:0,geometryQueries:0,prepareMs:0,sampleMs:0,samples:0}
  const signature=(p:number[])=>[0,1,2].flatMap(axis=>[-1,1].map(sign=>{
    origin.fromArray(p);direction.set(0,0,0).setComponent(axis,sign);counters.geometryQueries++
    const hit=visibility.hit(origin,direction,field.spacing*4,.001)
    return hit?hit.point.getComponent(axis):p[axis]+sign*field.spacing*4
  }))
  const probes=field.probes.filter(p=>field.positionData[p.index*4+3]>=.5).map(p=>{
    const position=Array.from(field.positionData.subarray(p.index*4,p.index*4+3))
    return {index:p.index,position,regionId:p.region.id,coefficients:field.coefficients.flatMap(c=>Array.from(c.subarray(p.index*4,p.index*4+4),DataUtils.fromHalfFloat)),signature:signature(position)}
  })
  const bins=new Map<string,typeof probes>()
  probes.forEach(p=>{const key=p.position.map(v=>Math.floor(v/field.spacing)).join(':');const bin=bins.get(key)??[];bin.push(p);bins.set(key,bin)})
  const cellSets=new Map<string,Set<number>>()
  counters.prepareMs=performance.now()-start
  return {probes,counters,signature,sample(position:number[],normal:number[]=[0,1,0],floor=true) {
    const started=performance.now(),cell=position.map(v=>Math.floor(v/field.spacing)),nearby:typeof probes=[]
    for(let z=-2;z<=2;z++)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)nearby.push(...bins.get([cell[0]+x,cell[1]+y,cell[2]+z].join(':'))??[])
    const links:LocalLink[]=nearby.flatMap(p=>{
      const d2=distance2(position,p.position);if(d2>=radius2)return[]
      const d=Math.sqrt(d2),max=Math.max(0,d-.001)
      origin.fromArray(p.position);direction.fromArray(position).sub(origin).divideScalar(d||1)
      if(max>.025)counters.visibilityQueries++
      return[{...p,distance:d,spatialWeight:(1-d2/radius2)**2,visible:max<=.025||!visibility.occluded(origin,direction,max,.025)}]
    })
    const stableCell=position.map(v=>Math.floor(v/(field.spacing/2))),cellKey=stableCell.join(':')
    let fixed=cellSets.get(cellKey)
    if(!fixed){const center=stableCell.map(v=>(v+.5)*field.spacing/2);fixed=new Set([...probes].sort((a,b)=>distance2(a.position,center)-distance2(b.position,center)||a.index-b.index).slice(0,4).map(p=>p.index));cellSets.set(cellKey,fixed)}
    const geometry=signature(position)
    const variants=Object.fromEntries(localDefinitions.map(key=>[key,reconstructLocalLight(links,position,normal,field.spacing,key,floor,geometry,fixed)])) as Record<LocalDefinition,ReturnType<typeof reconstructLocalLight>>
    counters.samples++;counters.sampleMs+=performance.now()-started
    return {position,normal,signature:geometry,variants}
  }}
}
