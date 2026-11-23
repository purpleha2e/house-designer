import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
const browser = await lightingBrowser(), report = {}, out = 'tmp/lighting-lab/reference-regression'
mkdirSync(out, { recursive: true })
try {
  for (const mode of ['open', 'closed']) {
    await browser.call('Page.navigate', { url: 'http://127.0.0.1:5188/tests/browser/houseDoorwayFixture.html' + (mode === 'closed' ? '?closed=1' : '') })
    await browser.wait('window.houseLightingLab?.stats().frames>10')
    await browser.evaluate(`(async()=>{
      const lab=houseLightingLab;lab.setPaused(true);
      // The source uses raster-culling flags. Those must not make a sealed
      // room transparent to the reference renderer's environment shadow rays.
      houseFixtureSnapshot.finishes.forEach(finish=>finish.side=0);
      const {HouseReference}=await import('/src/lightingLab/houseReference.ts');
      window.reference=new HouseReference(document.querySelector('#viewport'),houseFixtureSnapshot,lab.referenceInput(),lab.camera,1,
        {diffuse:true,samples:${mode === 'open' ? 128 : 8},bounces:32,width:64},message=>window.referenceStatus=message);
      reference.tracer.tiles.set(1,1);
      await reference.start();
    })()`)
    const end=Date.now()+300000
    while(await browser.evaluate('reference.tracer.samples<'+(mode==='open'?128:8))) {
      writeFileSync(out+'/progress.json',JSON.stringify(await browser.evaluate('({status:referenceStatus,samples:reference.tracer.samples,compiling:reference.tracer.isCompiling,errors:[]})')))
      if(browser.errors.length)throw Error(browser.errors.join('\n'))
      if(Date.now()>end)throw Error('Reference did not converge within five minutes')
      await new Promise(resolve=>setTimeout(resolve,1000))
    }
    report[mode] = await browser.evaluate(`(async()=>({stats:reference.stats(),rgb:await reference.measure(0,0,5),status:referenceStatus}))()`)
    writeFileSync(`${out}/${mode}.png`, Buffer.from((await browser.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await browser.evaluate('reference.dispose()')
  }
  // The black-walled fixture has a diffuse .8 receiver. Two successive open
  // doorways admit sky; closing the internal one must remove every path.
  assert.ok(report.open.rgb[0] > .015 && report.open.rgb[0] < .06, JSON.stringify(report.open))
  assert.ok(report.closed.rgb.every(value => value < .00001), JSON.stringify(report.closed))
  assert.deepEqual(browser.errors, [])
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { browser.close() }
