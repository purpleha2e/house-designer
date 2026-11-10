import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),port=process.argv[2]??5180
try{
 for(const stage of ['baseline','candidate']){
  const out=`docs/gi-spatial-accuracy/${stage}/house`;mkdirSync(out,{recursive:true})
  const cache=readFileSync(`tmp/gi-spatial-${stage}-cache.json`,'utf8')
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${cache}}}`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi${stage==='candidate'?'&giSpatial=occluder-local':''}`})
  await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.indirectLighting.pendingUpdate&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
  console.log('NAVIGATION',stage)
  const result=await b.evaluate(`(async()=>{
   const s=roofWallScene(),m=await import('/tests/browser/kitchenFrameMeasurements.ts'),live=m.installKitchenLiveFrames(s),original=s.camera.position.clone(),old=s.scene.userData.getLightingField(),generation=s.scene.userData.indirectLighting.generation,start=performance.now(),memoryBefore={...s.gl.info.memory},gaps=[],longTasks=[];
   let running=true,previous=start,firstUsefulMs=0;
   const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({at:e.startTime-start,ms:e.duration}))));observer.observe({type:'longtask'});
   const frame=now=>{if(!running)return;gaps.push(now-previous);previous=now;if(now-start<8000){s.camera.position.x=original.x+Math.sin((now-start)/800)*.12;s.camera.updateMatrixWorld();s.invalidate()}requestAnimationFrame(frame)};requestAnimationFrame(frame);
   try{
    regressionMoveWindow(.25);
    while(true){const g=s.scene.userData.indirectLighting;if(!firstUsefulMs&&s.scene.userData.getLightingField()!==old)firstUsefulMs=performance.now()-start;if(g.generation>generation&&g.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&performance.now()-start>8000)break;if(performance.now()-start>180000)throw Error('Navigation edit timed out');await new Promise(r=>setTimeout(r,50))}
    const firstEdit={elapsedMs:performance.now()-start,firstUsefulMs,status:{...s.scene.userData.indirectLighting}},memory=[{...s.gl.info.memory}];
    // Subsequent small edits must retire their atlases and obsolete generations.
    for(const delta of [.1,.2]){const old=s.scene.userData.indirectLighting.generation;regressionMoveWindow(delta);while(true){const g=s.scene.userData.indirectLighting;if(g.generation>old&&g.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving)break;if(performance.now()-start>300000)throw Error('Repeated edit timed out');await new Promise(r=>setTimeout(r,50))}await new Promise(r=>setTimeout(r,300));memory.push({...s.gl.info.memory})}
    return{navigationMs:8000,firstEdit,frames:live.report(),animationGaps:{count:gaps.length,maxMs:Math.max(...gaps),p95Ms:[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length*.95)]},longTasks,memoryBefore,memoryAfterEachEdit:memory,finalMode:s.scene.userData.getLightingField().spatialInterpolation,glError:s.gl.getContext().getError()}
   }finally{running=false;observer.disconnect();live.dispose();s.camera.position.copy(original);s.camera.updateMatrixWorld();s.invalidate()}
  })()`)
  assert.equal(result.glError,0);writeFileSync(`${out}/navigation.json`,JSON.stringify(result,null,2));console.log('PASS NAVIGATION',stage,JSON.stringify({firstUsefulMs:result.firstEdit.firstUsefulMs,completeMs:result.firstEdit.elapsedMs,memory:result.memoryAfterEachEdit,gaps:result.animationGaps}))
 }
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/probeDaylightReference.html?probe&giSpatial=occluder-local`});await b.wait('!!window.probeDaylight')
 const cancellation=await b.evaluate('probeDaylight.bootstrapCheck()');assert.equal(cancellation.cancellation.maxError,0);assert.ok(cancellation.cancellation.interrupted)
 writeFileSync('docs/gi-spatial-accuracy/candidate/cancellation.json',JSON.stringify(cancellation,null,2));assert.deepEqual(b.errors,[]);console.log('PASS candidate rapid-generation cancellation versus fresh final field')
}finally{b.close()}
