import fs from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const results=[],out='docs/gi-l2-physics'
for(const order of [1,2])for(let cold=0;cold<2;cold++){
 const b=await lightingBrowser()
 try{
  await b.call('Page.navigate',{url:`http://localhost:5181/tests/browser/giPhysics.html?giSH=${order}&lightingProfile=1`});await b.wait('!!window.giPhysics')
  // No raw radiance readbacks or screenshot work during these benchmarks.
  for(let warm=0;warm<3;warm++){
   const config=JSON.parse(fs.readFileSync('docs/gi-physics/ceiling-source.json')).config
   const r=await b.evaluate(`giPhysics.room(${JSON.stringify(config)})`);assert.equal(r.selection.selected,order)
   results.push({order,cold,warm,elapsedMs:r.elapsedMs,passes:r.passes.map(p=>({pass:p.pass,wallMs:p.passWallMs})),memory:r.passes[5].memory,profile:r.profile,interpolation:r.status.interpolationProfile})
   fs.writeFileSync(`${out}/bench-room.json`,JSON.stringify(results,null,2));console.log(order,cold,warm,r.elapsedMs)
  }
  assert.deepEqual(b.errors,[])
 }finally{b.close()}
}
