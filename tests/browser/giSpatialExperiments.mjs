import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),port=process.argv[2]??5180,out=process.argv[3]??'docs/gi-spatial-accuracy/experiments'
mkdirSync(out,{recursive:true})
try{
 const cases=process.argv.includes('--all')?[['sealed','table'],['window','table'],['two-rooms','table'],...['table','removed','raised','lowered','sideways','cabinet'].map(v=>['furniture',v])]:[['window','table'],['two-rooms','table'],['furniture','table']]
 for(const [kind,variant]of cases){
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/probeDaylightReference.html?probe${process.argv.includes('--candidate')?'&giSpatial=occluder-local':''}`});await b.wait('!!window.probeDaylight')
  console.log('EXPERIMENT',kind,variant)
  const r=await b.evaluate(`(async()=>{const m=await import('/tests/browser/giSpatialExperiments.ts');return m.spatialFixture('${kind}','${variant}',${!process.argv.includes('--no-angular')&&variant==='table'&&kind!=='sealed'})})()`)
  assert.equal(r.glError,0);writeFileSync(`${out}/${kind}-${variant}.json`,JSON.stringify(r,null,2))
  const values=Object.keys(r.points[0].candidates).map(m=>({method:m,mae:r.points.slice(0,5).reduce((s,p)=>s+p.candidates[m].rgb.reduce((s,v,c)=>s+Math.abs(v-p.reference.sky[c]-p.reference.reflected[c]),0)/3,0)/5}))
  console.log('RESULT',kind,variant,JSON.stringify({values,elapsedMs:r.elapsedMs,probes:r.probes.length,maxCaptureCoefficientError:Math.max(0,...r.probes.map(p=>p.maxCoefficientDifference))}))
 }
 assert.deepEqual(b.errors,[])
}finally{b.close()}
