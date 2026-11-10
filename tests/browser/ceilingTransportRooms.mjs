import fs from 'node:fs'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
import {roomReference} from '../giPhysicsReference.ts'
if(!process.argv.includes('--ceiling-transport'))throw Error('Diagnostic flag required')
const out='docs/ceiling-transport',b=await lightingBrowser()
try{
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/giPhysics.html?giSH=1&lightingProfile=1&physicsTrace=1'})
 await b.wait('!!window.giPhysics')
 const units=await b.evaluate('giPhysics.units(1)');fs.writeFileSync(`${out}/controlled-units.json`,JSON.stringify(units,null,2))
 for(const config of [
  {name:'sky-only',rho:[.5,.5,.5],emission:'none',window:true,sun:0,direction:[0,.6,-1]},
  {name:'sun-wall',rho:[.5,.5,.5],emission:'none',window:true,sun:1,direction:[0,.05,-1]},
  {name:'sun-floor',rho:[.5,.5,.5],emission:'none',window:true,sun:1,direction:[0,.8,-1]},
 ]){
  const result=await b.evaluate(`giPhysics.room(${JSON.stringify(config)})`)
  assert.equal(result.passes.length,6);assert.ok(result.passes.every(p=>p.order===1));assert.equal(result.glError,0)
  result.reference=result.passes[0].samples.map(p=>({name:p.name,...roomReference(p.p,p.n,config,262144,6)}))
  const probe=result.passes[0].coefficients[0]
  result.probeReference={index:probe.index,position:probe.position,normal:[0,-1,0],...roomReference(probe.position,[0,-1,0],config,262144,6)}
  fs.writeFileSync(`${out}/controlled-${config.name}.json`,JSON.stringify(result));console.log('controlled',config.name,'complete',result.elapsedMs)
 }
 assert.deepEqual(b.errors,[]);fs.writeFileSync(`${out}/controlled-browser-errors.json`,JSON.stringify(b.errors))
}finally{b.close()}
