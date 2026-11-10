import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser()
try{
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.backgroundJobs=0;const NativeWorker=Worker;window.Worker=class extends NativeWorker{postMessage(message,...args){if(message.kind)backgroundJobs++;return super.postMessage(message,...args)}};window.editLongTasks=[];new PerformanceObserver(list=>editLongTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});`})
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/doorMoveLatencyRegression.html`})
  const ready=`doorLatency.state()?.scene.userData.indirectLighting?.state==='ready'&&!doorLatency.state().scene.userData.indirectLighting.volumePending&&!doorLatency.state().scene.userData.indirectLighting.pendingUpdate`
  await browser.wait(`!!window.doorLatency&&${ready}`)
  const initial=await browser.evaluate(`({generation:doorLatency.state().scene.userData.indirectLighting.generation,textures:doorLatency.state().gl.info.memory.textures,preview:doorLatency.state().scene.userData.fastGI.stats.state})`)
  assert.equal(initial.preview,'disabled')
  await browser.evaluate('doorLatency.state().camera.position.x+=.1;doorLatency.state().invalidate()');await new Promise(r=>setTimeout(r,600))
  assert.equal(await browser.evaluate('doorLatency.state().scene.userData.indirectLighting.generation'),initial.generation,'camera movement keeps world GI')
  const moves=[]
  for(const [x,rapid]of [[1.7,false],[2,true],[1.9,false]]){
    const previous=await browser.evaluate('doorLatency.state().scene.userData.indirectLighting.generation')
    const started=await browser.evaluate(`(()=>{const s=doorLatency.state(),render=s.gl.render.bind(s.gl);window.geometryFeedback=0;window.moveAt=performance.now();s.gl.render=(scene,camera)=>{const r=render(scene,camera);if(!geometryFeedback&&(scene===s.scene||scene.userData.retainedViewport)){const model=s.scene.getObjectByName('model-transform-door');if(model&&Math.abs(model.matrixWorld.elements[12]-${x})<.001)geometryFeedback=performance.now()-moveAt}return r};doorLatency.move(${x});return moveAt})()`)
    if(rapid){await new Promise(r=>setTimeout(r,50));await browser.evaluate(`doorLatency.move(${x+.15})`)}
    await browser.wait(`doorLatency.state().scene.userData.indirectLighting.generation>${previous}&&${ready}`)
    const result=await browser.evaluate(`({geometryMs:geometryFeedback,totalMs:performance.now()-${started},firstLightingMs:doorLatency.state().scene.userData.indirectLighting.bakeStartedAt+doorLatency.state().scene.userData.indirectLighting.firstPreviewMs-${started},status:{...doorLatency.state().scene.userData.indirectLighting},preview:doorLatency.state().scene.userData.fastGI.stats.state,textures:doorLatency.state().gl.info.memory.textures,glError:doorLatency.state().gl.getContext().getError()})`);moves.push(result)
    if(!rapid)assert.ok(result.geometryMs>0&&result.geometryMs<200,'door geometry responds before lighting work')
    assert.equal(result.preview,'disabled');assert.equal(result.glError,0);assert.ok(result.totalMs<15000,'warm background GI must finish without a minute-long rebuild')
  }
  assert.ok(moves.at(-1).textures<initial.textures+30,'repeated edits release obsolete lighting textures')
  await browser.evaluate('doorLatency.move(2.3)');await new Promise(r=>setTimeout(r,80));await browser.evaluate('doorLatency.unmount()');await new Promise(r=>setTimeout(r,700));const jobs=await browser.evaluate('backgroundJobs');await new Promise(r=>setTimeout(r,1000));assert.equal(await browser.evaluate('backgroundJobs'),jobs,'disposed lighting stops worker jobs')
  mkdirSync('tmp/background-gi',{recursive:true});writeFileSync('tmp/background-gi/report.json',JSON.stringify({initial,moves,longTasks:await browser.evaluate('editLongTasks'),errors:browser.errors},null,2));assert.deepEqual(browser.errors,[]);console.log('PASS automatic background GI, immediate geometry, camera stability, rapid edits, bounded textures and disposal',JSON.stringify(moves.map(m=>({geometryMs:m.geometryMs,totalMs:m.totalMs,passBatches:m.status.batchedPasses}))))
}finally{browser.close()}
