import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {DataUtils,Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {restoreIndirectVisibility} from '../src/indirectVisibility.ts'
import {sampleDisplayedIndirect} from '../src/indirectLightingDiagnostic.ts'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
const out='docs/colin-contact-fix',bytes=gunzipSync(readFileSync(`${out}/baseline/geometry.f32.gz`)),positions=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),visibility=restoreIndirectVisibility({positions,tree:null}),{field}=await loadIndirectLighting(JSON.parse(readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json')),{reflections:false})
const contacts=JSON.parse(readFileSync('docs/colin-contact-shading/reference.json')).results,house=JSON.parse(readFileSync('docs/lighting-correctness/verified/reference.json')).results
const points=[...contacts.map(p=>({...p,group:'contacts'})),...house.map(p=>({...p,group:'house'}))],radiusSquared=(field.spacing*1.75)**2,results=[]
try{
 for(const point of points){
  const normal=new Vector3().fromArray(point.normal).normalize(),gn=new Vector3().fromArray(point.geometricNormal).normalize(),sourceNormal=point.group==='contacts'?normal:gn,physical=new Vector3().fromArray(point.position),floor=Math.max(0,field.floors.findIndex((f,i)=>physical.y>=field.ranges[i].bottom&&physical.y<field.ranges[i].top)),range=field.ranges[floor],isFloor=sourceNormal.y>.9&&physical.y>=field.floors[floor].elevation-.02&&physical.y<=field.floors[floor].elevation+.08,step=[field.bounds.size/(field.volume.n-1),(range.top-range.bottom)/11,field.bounds.size/(field.volume.n-1)],bias=isFloor?.004:.02+sourceNormal.toArray().reduce((s,n,i)=>s+Math.abs(n)*step[i],0),direction=sourceNormal.clone(),start=physical.clone().addScaledVector(gn,.0002),hit=visibility.hit(start,direction,bias,.0001),safeBias=hit?Math.max(.0002,hit.distance-.002):bias
  const samples=Object.fromEntries([['legacy',bias],['small',.002],['clipped',safeBias]].map(([name,b])=>[name,sampleDisplayedIndirect(field,floor,physical.clone().addScaledVector(sourceNormal,b),normal).rgb]))
  if(point.samplePosition)samples.measured=sampleDisplayedIndirect(field,floor,new Vector3().fromArray(point.samplePosition),normal).rgb
  const candidates={}
  for(const [label,offset]of [['surface',.0002],['near',.004],['clipped',safeBias]]){
   const p=physical.clone().addScaledVector(gn,offset);if(isFloor)p.y=field.floors[floor].elevation+.016
   const basis=indirectSHIrradianceBasis(normal,field.shOrder)
   for(const near of [.025,.0001])for(const power of [0,1,2,3]){
    let total=0,support=0;const coefficients=new Float64Array(field.coefficientCount*3),links=[]
    for(const probe of field.probes){const pos=new Vector3().fromArray(field.positionData,probe.index*4);if(field.positionData[probe.index*4+3]<.5)continue;const delta=p.clone().sub(pos),d2=delta.lengthSq(),distance=Math.sqrt(d2);if(d2>=radiusSquared)continue
     if(distance>near&&visibility.hit(pos,delta.divideScalar(distance),Math.max(0,distance-.0002),near))continue
     const base=(1-d2/radiusSquared)**2,weight=base/(d2+.15**2)**(power/2);total+=weight;support+=base;links.push({index:probe.index,kind:probe.kind,distance,weight,position:pos.toArray()})
     for(let c=0;c<3;c++)for(let k=0;k<field.coefficientCount;k++)coefficients[c*field.coefficientCount+k]+=DataUtils.fromHalfFloat(field.coefficients[c][probe.index*field.coefficientCount+k])*weight
    }
    const rgb=[0,1,2].map(c=>Math.max(0,basis.reduce((sum,b,k)=>sum+b*coefficients[c*field.coefficientCount+k],0)/Math.max(total,1e-12))*(isFloor?Math.min(1,support/.1):1))
    candidates[`${label}-near${near}-power${power}`]={rgb,support,links:links.map(l=>({...l,weight:l.weight/Math.max(total,1e-12)}))}
   }
  }
  results.push({name:point.name,group:point.group,position:point.position,normal:point.normal,geometricNormal:point.geometricNormal,floor,isFloor,bias,safeBias,hit:hit?.distance??null,reference:point.reference.sky.map((v,c)=>v+point.reference.reflected[c]),samples,candidates})
 }
 const metric=(select,group)=>{const errors=results.filter(r=>r.group===group).flatMap(r=>select(r).map((v,c)=>v-r.reference[c]));return{rmse:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/errors.length),mae:errors.reduce((s,v)=>s+Math.abs(v),0)/errors.length}}
 const methods=Object.keys(results[0].candidates),summary=Object.fromEntries(methods.map(m=>[m,{contacts:metric(r=>r.candidates[m].rgb,'contacts'),house:metric(r=>r.candidates[m].rgb,'house')}]))
 writeFileSync(`${out}/point-candidates.json`,JSON.stringify({summary,results},null,2));console.log(JSON.stringify(summary,null,2));for(const r of results.filter(r=>r.group==='contacts'))console.log(r.name,JSON.stringify({reference:r.reference,samples:r.samples,safeBias:r.safeBias,surface:r.candidates['surface-near0.0001-power0'].rgb,local:r.candidates['surface-near0.0001-power2'].rgb}))
}finally{visibility.dispose();field.dispose()}
