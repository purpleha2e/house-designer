import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

/** Exercise the real saved house past the reported ten-second slowdown. */
export async function checkViewerRendering({ call, evaluate, pause, waitFor }) {
  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true })
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.viewerWorkerRequests=[];
    const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker {
      constructor(url,...args){super(url,...args);this.viewerUrl=String(url)}
      postMessage(data,...args){window.viewerWorkerRequests.push({url:this.viewerUrl,kind:data?.kind});return super.postMessage(data,...args)}
    };
  ` })
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/readOnlyViewerRegression.html?published' })
  await waitFor("!!window.viewerState?.() && document.querySelector('.viewer-status')?.textContent==='Scene ready.'", 'saved phone tour ready', 960)
  assert.equal(await evaluate("matchMedia('(pointer: coarse)').matches"), true)
  await pause(1000)
  await evaluate(`(()=>{
    window.viewerWorkerRequests=[];
    window.viewerSceneChanges=[];
    const s=window.viewerState(),render=s.gl.render;
    s.gl.render=function(scene,camera){
      if(scene!==s.scene)window.viewerSceneChanges.push('temporary-scene');
      return render.call(this,scene,camera);
    };
    window.viewerGeometry=new Map();
    s.scene.traverse(o=>{if(o.geometry)window.viewerGeometry.set(o.uuid,o.geometry.uuid)});
  })()`)
  const sample = () => evaluate(`(async()=>{
    const s=window.viewerState(), original=s.gl.render, start=performance.now();
    let draws=0,extraPasses=0,frames=0,last=start,calls=0;const intervals=[];
    const sunUpdates=[];
    s.scene.traverse(o=>{if(o.isDirectionalLight){const update=o.shadow.updateMatrices;const item={shadow:o.shadow,update,count:0};sunUpdates.push(item);o.shadow.updateMatrices=function(...args){item.count++;return update.apply(this,args)}}});
    s.gl.render=function(scene,camera){draws++;if(scene!==s.scene)extraPasses++;const before=this.info.render.calls;const result=original.call(this,scene,camera);calls+=this.info.render.calls-before;return result};
    const yaw=s.camera.rotation.y;
    try {
      await new Promise(resolve=>{
        function frame(now){
          intervals.push(now-last);last=now;frames++;
          s.camera.rotation.y=yaw+Math.sin((now-start)/1000)*.08;s.camera.updateMatrixWorld();
          if(now-start<12000)requestAnimationFrame(frame);else resolve();
        }
        requestAnimationFrame(frame);
      });
      const sorted=intervals.slice(2).sort((a,b)=>a-b);
      return {draws,extraPasses,frames,dpr:s.gl.getPixelRatio(),callsPerDraw:calls/draws,sunUpdates:sunUpdates.map(s=>s.count),camera:s.camera.position.toArray(),
        p95Ms:sorted[Math.floor(sorted.length*.95)],programs:s.gl.info.programs.length,
        giDisplayed:s.scene.userData.indirectLighting?.displayed,
        giSource:s.scene.userData.indirectLighting?.source,
        glass:(()=>{let found=false;s.scene.traverseVisible(o=>{
          for(const m of Array.isArray(o.material)?o.material:[o.material])
            if(m?.transparent&&m.opacity>0&&m.opacity<1)found=true;
        });return found})()};
    }finally{s.gl.render=original;sunUpdates.forEach(s=>s.shadow.updateMatrices=s.update);s.camera.rotation.y=yaw;s.camera.updateMatrixWorld()}
  })()`)
  let initialPrograms
  for (let turn=0;turn<3;turn++) {
    if(turn) {
      const previous=await evaluate('window.viewerState().camera.position.y')
      await evaluate("[...document.querySelectorAll('.viewer-floor-controls button')].find(b=>!b.disabled).click()")
      await waitFor(`window.viewerState().camera.position.y!==${previous}`, 'changed floor')
      // A camera move must never wait for replacement building geometry.
      await pause(250)
      assert.deepEqual(await evaluate('window.viewerWorkerRequests'), [], 'floor changes do not submit preparation work')
      assert.equal(await evaluate("document.querySelector('.viewer-status').textContent"), 'Scene ready.', 'floor change stays ready')
    }
    await pause(1000)
    if(process.argv.includes('--profile')){await call('Profiler.enable');await call('Profiler.start')}
    const result=await sample()
    if(process.argv.includes('--profile')){const {profile}=await call('Profiler.stop');writeFileSync(`node_modules/.cache/viewer-phone-${turn}.cpuprofile`,JSON.stringify(profile))}
    console.log(`Phone rendering after ${turn} floor changes:`,result)
    assert.ok(result.draws>20, 'camera movement continues rendering throughout the sample')
    assert.equal(result.extraPasses,0,'phone does not resume postprocessing after preparation')
    assert.equal(result.dpr,1,'high-density phone stays within its drawing-buffer budget')
    assert.equal(result.giDisplayed,true,'saved indirect lighting is still displayed')
    assert.equal(result.giSource,'saved','floor changes do not start recalculating lighting')
    assert.equal(result.glass,true,'transparent glass remains in the displayed scene')
    if(turn===0)initialPrograms=result.programs
    if(turn===2)assert.equal(result.programs,initialPrograms,'returning to the same floor does not accumulate shader programs')
    assert.deepEqual(await evaluate('window.viewerWorkerRequests'), [], 'no delayed geometry/lighting rebuilds during navigation')
    assert.deepEqual(await evaluate('window.viewerSceneChanges'), [], 'the complete live scene stays on screen')
    assert.equal(await evaluate(`(()=>{const s=window.viewerState();let same=true;for(const [id,geometry]of window.viewerGeometry){const o=s.scene.getObjectByProperty('uuid',id);if(!o||o.geometry.uuid!==geometry)same=false}return same})()`), true, 'all geometry identities survive floor changes')
    await pause(1000)
    assert.equal(await evaluate(`(async()=>{const gl=window.viewerState().gl,render=gl.render;let draws=0;gl.render=function(...args){draws++;return render.apply(this,args)};try{await new Promise(r=>setTimeout(r,1500));return draws}finally{gl.render=render}})()`),0,'settled tour submits no idle GPU draws')
  }
  console.log('PASS: Phone rendering stays single-pass beyond ten seconds and repeated floor changes, retaining saved lighting and transparent glass.')
}
