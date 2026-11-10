import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {referenceIrradiance} from '../daylightReferenceCalculation.ts'
const browser=await lightingBrowser(),out=process.argv[3]??'docs/gi-directional-diagnostics/reference-room'
mkdirSync(out,{recursive:true});const reports=[]
try{
 for(const order of [1,2]){
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/probeDaylightReference.html?probe&giSH=${order}`});await browser.wait('!!window.probeDaylight')
  for(const condition of ['away','direct','overcast']){
   const r=await browser.evaluate(`probeDaylight.run('${condition}',6,false)`)
   assert.equal(r.shOrder,order);assert.equal(r.glError,0)
   for(const receiver of r.receivers){receiver.reference=referenceIrradiance(receiver.p,receiver.n,{sky:condition==='overcast'?'overcast':'clear',sun:condition==='overcast'?'none':condition,depth:6,samples:131072});receiver.absoluteError=receiver.irradiance.rgb.map((v,c)=>Math.abs(v-receiver.reference[c]));receiver.relativeError=receiver.absoluteError.map((v,c)=>v/Math.max(1e-5,receiver.reference[c]))}
   reports.push(r);writeFileSync(`${out}/results.json`,JSON.stringify(reports,null,2))
   const png=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/l${order}-${condition}.png`,Buffer.from(png.data,'base64'));console.log('REFERENCE ROOM',order,condition,JSON.stringify(r.receivers))
  }
 }
 for(const condition of ['away','direct','overcast'])assert.deepEqual(reports.find(r=>r.shOrder===1&&r.condition===condition).probePositions,reports.find(r=>r.shOrder===2&&r.condition===condition).probePositions)
 assert.deepEqual(browser.errors,[]);console.log('PASS identical reference-room probes, six production transport passes, independent CPU errors')
}finally{browser.close()}
