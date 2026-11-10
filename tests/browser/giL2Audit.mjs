import fs from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const out='docs/gi-l2-physics';fs.mkdirSync(out,{recursive:true})
for(const order of [1,2]){
 const b=await lightingBrowser()
 try{
  if(order===1&&!process.argv.includes('--units-only')){
   await b.call('Page.navigate',{url:'http://localhost:5181/tests/browser/indirectSHSampling.html'})
   await b.wait('!!window.indirectSHSamplingResult');const sampling=await b.evaluate('indirectSHSamplingResult');assert.ok(!sampling.error,JSON.stringify(sampling));assert.ok(sampling.maxError<.003);assert.equal(sampling.glError,0)
   fs.writeFileSync(`${out}/gpu-volume-floor-sampling.json`,JSON.stringify(sampling,null,2))
  }
  const nav=await b.call('Page.navigate',{url:`http://localhost:5181/tests/browser/giPhysics.html?giSH=${order}&lightingProfile=1&physicsTrace=1`});assert.ok(!nav.errorText,nav.errorText)
  await b.wait('!!window.giPhysics')
  const units=await b.evaluate(`giPhysics.units(${order})`);fs.writeFileSync(`${out}/l${order}-units.json`,JSON.stringify(units,null,2));console.log('L'+order,'units',units.test2.map(t=>[t.name,t.relativeError[0]]))
  assert.ok(units.test2.every(t=>t.outgoingAtSecond.every((v,c)=>Math.abs(v-t.shaderExpectedFromCapturedSH[c])<1e-7)))
  if(process.argv.includes('--units-only'))continue
  for(const name of ['uniform-0','uniform-rgb','uniform-1','ceiling-source','sun-0','sun-1','sun-2','sun-away']){
   const baseline=JSON.parse(fs.readFileSync(`docs/gi-physics/${name}.json`)),result=await b.evaluate(`giPhysics.room(${JSON.stringify(baseline.config)})`)
   assert.equal(result.selection.selected,order);assert.equal(result.passes.length,6);assert.ok(result.passes.every(p=>p.order===order&&p.coefficientCount===(order===2?9:4)))
   result.reference=baseline.reference;fs.writeFileSync(`${out}/l${order}-${name}.json`,JSON.stringify(result,null,2))
   console.log('L'+order,name,result.elapsedMs,result.passes[5].samples.map(s=>s.rgb[0]))
  }
  assert.deepEqual(b.errors,[])
 }finally{fs.writeFileSync(`${out}/l${order}-browser-errors.json`,JSON.stringify(b.errors,null,2));b.close()}
}
