// Supplemental fault/lifetime coverage, separate from the real-editor workflows.
import { lightingBrowser } from './lightingHarness.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const b = await lightingBrowser(), report = {}, output = 'tmp/usability-recovery/floor-publication'
mkdirSync(output, { recursive: true })
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.filterWorkers=[];const NativeWorker=Worker;
    window.Worker=class extends NativeWorker {
      constructor(url,options){super(url,options);this.isFilter=String(url).includes('indirectFloorFilter.worker');if(this.isFilter){filterWorkers.push(this);this.addEventListener('message',e=>{if(!this.releasing){this.held=e.data;e.stopImmediatePropagation()}})}}
      terminate(){this.stopped=true;return super.terminate()}
      release(){this.releasing=true;this.dispatchEvent(new MessageEvent('message',{data:this.held}));this.releasing=false}
    };
  ` })
  await b.call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5202}/tests/browser/softFloorPublication.html` })
  await b.wait('window.filterWorkers[0]?.held', 15000)
  assert.equal(await b.evaluate('floorPublication.state.scene.userData.softFloorGI.state'), 'preparing')
  await b.evaluate(`document.getElementById('input').click();document.getElementById('replace').click()`)
  await b.wait('filterWorkers[0].stopped&&filterWorkers[1]?.held', 15000)
  await b.evaluate('filterWorkers[0].release()')
  assert.notEqual(await b.evaluate('floorPublication.state.scene.userData.softFloorGI.state'), 'ready', 'obsolete response cannot publish')
  await b.evaluate('filterWorkers[1].release()')
  await b.wait(`floorPublication.state.scene.userData.softFloorGI.state==='ready'`, 15000)
  report.ready = await b.evaluate(`(()=>{const p=floorPublication,original=p.uniforms.hdGIFloorLayer.value,restore=p.state.scene.userData.bindSoftFloorGI();const swapped=p.uniforms.hdGIFloorLayer.value!==original;restore?.();return{swapped,restored:p.uniforms.hdGIFloorLayer.value===original,status:p.state.scene.userData.softFloorGI}})()`)
  assert.ok(report.ready.swapped && report.ready.restored)
  // A replacement with the same version number must reject the filtered result.
  report.textureFence = await b.evaluate(`(()=>{const p=floorPublication,t=p.field.floorLayer.texture,replacement=t.clone();replacement.version=t.version;p.field.floorLayer.texture=replacement;const rejected=!p.state.scene.userData.bindSoftFloorGI();p.field.floorLayer.texture=t;replacement.dispose();return rejected})()`)
  assert.ok(report.textureFence)
  await b.evaluate(`document.getElementById('replace').click()`)
  await b.wait('filterWorkers[1]?.held&&floorPublication.state.scene.userData.softFloorGI.state===\'preparing\'', 10000)
  await b.evaluate(`filterWorkers.at(-1).dispatchEvent(new ErrorEvent('error',{message:'Injected floor-filter failure'}))`)
  await b.wait(`floorPublication.state.scene.userData.softFloorGI.state==='error'`, 3000)
  await b.evaluate(`document.getElementById('input').click()`)
  assert.equal(await b.evaluate(`document.getElementById('input').textContent`), 'Input 2')
  report.failure = await b.evaluate('floorPublication.state.scene.userData.softFloorGI')
  await b.evaluate(`document.getElementById('disable').click();document.getElementById('unmount').click()`)
  await b.wait('filterWorkers.every(w=>w.stopped)', 5000)
  report.workers = await b.evaluate('filterWorkers.map(w=>({stopped:w.stopped}))')
  assert.deepEqual(b.errors, [])
  console.log('PASS floor cancellation, stale response/texture rejection, bounded upload, failure input and worker disposal')
} catch (error) { report.failure = String(error); console.error(error); process.exitCode = 1 }
finally { writeFileSync(`${output}/report.json`, JSON.stringify({ ...report, errors: b.errors }, null, 2)); b.close() }
