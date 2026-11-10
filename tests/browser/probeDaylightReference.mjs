import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {referenceIrradiance} from '../daylightReferenceCalculation.ts'
const browser=await lightingBrowser(),out=process.argv[3]??'tmp/probe-daylight'
try{
  mkdirSync(out,{recursive:true});await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/probeDaylightReference.html?probe`});await browser.wait('!!window.probeDaylight')
  const results=[]
  for(const [condition,bounces,sealed] of [['away',2,false],['away',6,false],['away',8,false],['direct',6,false],['overcast',6,false],['away',6,true],['overcast',6,true]]){
    const result=await browser.evaluate(`probeDaylight.run('${condition}',${bounces},${sealed})`)
    for(const receiver of result.receivers)receiver.reference=referenceIrradiance(receiver.p,receiver.n,{sky:condition==='overcast'?'overcast':'clear',sun:condition==='overcast'?'none':condition,depth:6,sealed,samples:32768})
    results.push(result);console.log('PROBE',JSON.stringify({condition,bounces,sealed,elapsedMs:result.elapsedMs,receivers:result.receivers,profile:result.performance.wallPhases,status:result.status.state}))
    writeFileSync(`${out}/report.json`,JSON.stringify({results,errors:browser.errors},null,2));const image=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${condition}-${bounces}${sealed?'-sealed':''}.png`,Buffer.from(image.data,'base64'))
    assert.equal(result.glError,0);assert.equal(result.status.state,'ready')
    if(sealed&&condition==='overcast')assert.ok(result.receivers.every(r=>r.irradiance.rgb.every(c=>c<.00001)),'a sealed room receives no diffuse sky')
    // Six is the production setting. Eight tests convergence below; it is not
    // a higher spatial/angular resolution reference solution.
    if(!sealed&&bounces===6)for(const receiver of result.receivers)for(let c=0;c<3;c++)assert.ok(Math.abs(receiver.irradiance.rgb[c]-receiver.reference[c])/receiver.reference[c]<.4,`${condition}: ${receiver.name}, channel ${c}, exceeds the 40% production reference error bound`)
  }
  const six=results.find(r=>r.condition==='away'&&r.bounces===6&&!r.sealed),eight=results.find(r=>r.condition==='away'&&r.bounces===8&&!r.sealed)
  assert.ok(eight.receivers.every((r,i)=>r.irradiance.rgb.every((v,c)=>Math.abs(v-six.receivers[i].irradiance.rgb[c])/Math.max(v,.00001)<.12)),'extra bounces converge rather than amplifying energy indefinitely')
  assert.deepEqual(browser.errors,[])
  if(process.argv.includes('--serial-compare')){
    await browser.evaluate(`probeDaylight.scene.userData.indirectLegacyProbeReplay=true`)
    const serial=await browser.evaluate(`probeDaylight.run('direct',6,false)`)
    await browser.evaluate(`probeDaylight.scene.userData.indirectLegacyProbeReplay=false`)
    const batch=await browser.evaluate(`probeDaylight.run('direct',6,false)`)
    const maxError=Math.max(...serial.receivers.flatMap((r,i)=>r.irradiance.rgb.map((v,c)=>Math.abs(v-batch.receivers[i].irradiance.rgb[c]))))
    assert.ok(maxError<.002,'batched and per-probe Jacobi transport must match')
    const retain=await browser.evaluate('probeDaylight.retainCheck()');assert.ok(retain.copied>0&&retain.maxError<.002);assert.equal(retain.glError,0)
    writeFileSync(`${out}/batch-comparison.json`,JSON.stringify({serialMs:serial.elapsedMs,batchMs:batch.elapsedMs,maxError,retain},null,2));console.log('PASS batch and retained receiver equivalence',JSON.stringify({serialMs:serial.elapsedMs,batchMs:batch.elapsedMs,maxError,retain}))
  }
}finally{browser.close()}
