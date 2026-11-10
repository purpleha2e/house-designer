import {readFileSync,writeFileSync} from 'node:fs'
import {DataUtils,Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
const dir=process.argv[2]??'docs/colin-contact-fix/iteration-8',cache=JSON.parse(readFileSync(`${dir}/field-cache.json`)),{field}=await loadIndirectLighting(cache,{reflections:false})
try{
 const points=JSON.parse(readFileSync('docs/colin-contact-shading/reference.json')).results.map(p=>{
  const point=new Vector3().fromArray(p.position),basis=indirectSHIrradianceBasis(new Vector3().fromArray(p.normal).normalize(),1)
  const captures=field.probes.filter(q=>q.kind==='contact').map(q=>({slot:field.probes.filter(r=>r.kind==='contact').indexOf(q),position:q.position.toArray(),distance:q.position.distanceTo(point),rgb:[0,1,2].map(c=>Math.max(0,basis.reduce((s,v,k)=>s+v*DataUtils.fromHalfFloat(field.coefficients[c][q.index*4+k]),0)))})).sort((a,b)=>a.distance-b.distance).slice(0,2)
  return{name:p.name,reference:p.reference.sky.map((v,c)=>v+p.reference.reflected[c]),captures}
 })
 writeFileSync(`${dir}/contact-captures.json`,JSON.stringify(points,null,2));for(const p of points)console.log(p.name,JSON.stringify(p.captures[0]))
}finally{field.dispose()}
