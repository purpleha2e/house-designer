import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Box3,Vector3} from 'three'
import {loadIndirectLighting} from '../src/indirectLightingPersistence.ts'
import {restoreIndirectVisibility} from '../src/indirectVisibility.ts'
import {addIndirectContactProbes} from '../src/indirectContactProbes.ts'
const bytes=gunzipSync(readFileSync('docs/colin-contact-fix/baseline/geometry.f32.gz')),positions=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),visibility=restoreIndirectVisibility({positions,tree:null}),{field}=await loadIndirectLighting(JSON.parse(readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json')),{reflections:false})
try{
 field.probes=field.probes.filter(p=>!p.kind)
 const models=JSON.parse(readFileSync('docs/colin-contact-fix/baseline/models.json')).filter(m=>m.contact&&(!process.argv.includes('--sofa-only')||m.name.endsWith('96cca887-d5d4-4fef-a941-c3638911c06a'))),boxes=models.map(m=>new Box3(new Vector3().fromArray(m.min),new Vector3().fromArray(m.max)))
 const target=new Vector3(2.456140315883101,.5704070701967253,17.367366838191565),audit={near:[],selected:[]},trace=process.argv.includes('--trace')?{prepared(buckets,seeds,frequency){audit.near=buckets.flatMap((bucket,cluster)=>bucket.map(c=>({...c,cluster,position:c.position.toArray(),distanceToTarget:c.position.distanceTo(target),criticalScore:c.coverage.reduce((s,l)=>s+(seeds[l.index].missingSupport?l.weight/Math.max(.0001,frequency[l.index]):0),0),initialScore:c.coverage.reduce((s,l)=>s+l.weight/Math.max(.0001,frequency[l.index]),0)}))).filter(c=>c.distanceToTarget<.06)},selected(c,score){if(c.position.distanceTo(target)<1.9)audit.selected.push({position:c.position.toArray(),score,gap:c.gap,coverage:c.coverage.length,floor:c.floor})}}:undefined
 const start=performance.now(),count=addIndirectContactProbes(field,boxes,visibility,models.flatMap(m=>m.seeds??[]),trace),contacts=field.probes.filter(p=>p.kind==='contact').map(p=>({position:p.position.toArray(),index:p.index})),ms=performance.now()-start
 if(trace){writeFileSync('docs/colin-contact-fix/contact-layout-trace.json',JSON.stringify(audit,null,2));console.log('AUDIT',JSON.stringify({near:audit.near.map(c=>({position:c.position,d:c.distanceToTarget,score:c.initialScore,critical:c.criticalScore,coverage:c.coverage.length,distance:c.distance})),selected:audit.selected}))}
 const results=JSON.parse(readFileSync('docs/colin-contact-shading/reference.json')).results.map(p=>({...p,contacts:contacts.map(q=>({...q,distance:new Vector3().fromArray(q.position).distanceTo(new Vector3().fromArray(p.position))})).sort((a,b)=>a.distance-b.distance).slice(0,4)}))
 writeFileSync(process.argv.includes('--sofa-only')?'docs/colin-contact-fix/sofa-layout.json':'docs/colin-contact-fix/contact-layout.json',JSON.stringify({count,ms,contacts,results},null,2));console.log('CONTACTS',count,'ms',ms);for(const p of results)console.log(p.name,JSON.stringify(p.contacts.slice(0,2)))
}finally{field.dispose();visibility.dispose()}
