import {readFileSync,writeFileSync} from 'node:fs'
import {DataUtils,Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
const {field,skyCoefficients}=await loadIndirectLighting(JSON.parse(readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json')),{reflections:false})
try{
 const points=JSON.parse(readFileSync('docs/colin-contact-fix/point-candidates.json')).results
 const results=points.map(p=>{
  const candidate=p.candidates['surface-near0.0001-power0'],basis=indirectSHIrradianceBasis(new Vector3().fromArray(p.normal),1)
  const raw=(coefficients)=>[0,1,2].map(c=>candidate.links.reduce((s,l)=>s+l.weight*basis.reduce((s,b,k)=>s+b*DataUtils.fromHalfFloat(coefficients[c][l.index*4+k]),0),0))
  const total=raw(field.coefficients),sky=raw(skyCoefficients),reflected=total.map((v,c)=>v-sky[c]),split=sky.map((v,c)=>Math.max(0,v)+Math.max(0,reflected[c])),legacy=total.map(v=>Math.max(0,v))
  return{name:p.name,group:p.group,reference:p.reference,legacy,sky,reflected,split}
 })
 const error=(key,group)=>{const d=results.filter(p=>p.group===group).flatMap(p=>p[key].map((v,c)=>v-p.reference[c]));return{rmse:Math.sqrt(d.reduce((s,v)=>s+v*v,0)/d.length),mae:d.reduce((s,v)=>s+Math.abs(v),0)/d.length}}
 const summary={legacy:{contacts:error('legacy','contacts'),house:error('legacy','house')},split:{contacts:error('split','contacts'),house:error('split','house')}}
 writeFileSync('docs/colin-contact-fix/directional-candidates.json',JSON.stringify({summary,results},null,2));console.log(JSON.stringify(summary));for(const r of results.filter(r=>r.group==='contacts'))console.log(JSON.stringify(r))
}finally{field.dispose()}
