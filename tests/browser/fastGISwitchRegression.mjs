// Real ThreeDView settings: fast on / probes off must display fast lighting.
import assert from 'node:assert/strict'
import { statSync, utimesSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'
const child=spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--remote-debugging-port=0','--no-first-run','--no-default-browser-check',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1200,850',`--user-data-dir=${createBrowserTestProfile('fast-gi-switch-')}`,'about:blank'],{windowsHide:true})
let ws
try {
  const endpoint=await new Promise((resolve,reject)=>{child.stderr.on('data',data=>{const m=String(data).match(/DevTools listening on (ws:\/\/\S+)/);if(m)resolve(m[1])});child.on('error',reject)})
  ws=new WebSocket(endpoint);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
  let id=0;const pending=new Map(),errors=[]
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result)}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text)
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'&&m.params.args.some(a=>/shader|WebGL|THREE/.test(a.value??'')))errors.push(m.params.args.map(a=>a.value??a.description).join(' '))})
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const request=++id,timer=setTimeout(()=>{pending.delete(request);reject(Error(`${method} timed out`))},30000);pending.set(request,{resolve,reject,timer});ws.send(JSON.stringify({id:request,method,params,sessionId}))})
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params={})=>send(method,params,sessionId)
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  const wait=async expression=>{const until=Date.now()+180000;while(Date.now()<until){if(errors.length)throw Error(errors.join('\n'));const failures=await evaluate(`window.houseDesignerEngineLog?.entries.filter(e=>e.type==='shader-warmup-failed')??[]`);if(failures.length)throw Error(JSON.stringify(failures));if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error(`Timeout: ${expression}`)}
  const menu=()=>evaluate(`document.querySelector('button[aria-label="3D view menu"]').click()`)
  const toggle=label=>evaluate(`(()=>{const label=[...document.querySelectorAll('#three-settings-menu label')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!label)throw Error('Missing settings switch');label.querySelector('input').click()})()`)
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true})
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?${process.argv.includes('--colin')?'colin&materials':process.argv.includes('--gi-test')?'gi-test&materials':'lighting-startup'}`})
  await wait(`!!window.roofWallScene?.()?.scene.userData.fastGI&&!!document.querySelector('button[aria-label="3D view menu"]')`)
  if(process.argv.includes('--door-view'))await evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(1.4,1.3,16.3);s.camera.lookAt(3.7,1.15,15.8);s.camera.updateMatrixWorld();s.invalidate()})()`)
  if(process.argv.includes('--mid-bake'))await wait(`roofWallScene().scene.userData.indirectLighting?.capturedFaces>12&&roofWallScene().scene.userData.indirectLighting.state==='refining'`)
  if(process.argv.includes('--settled')) {
    await wait(`roofWallScene().scene.userData.progressiveStartup?.phase==='full'&&!roofWallScene().scene.userData.shaderWarmupPending`)
    await new Promise(r=>setTimeout(r,700))
  }
  // A feature switch must never compile its replacement programs inside a
  // display draw. Count shader submissions there, regardless of driver speed.
  await evaluate(`(()=>{
    const {gl}=roofWallScene(),context=gl.getContext(),render=gl.render.bind(gl),shaderSource=context.shaderSource.bind(context);
    window.fastGIDisplayCompiles=[];let displayDraw=false;
    gl.render=(next,camera)=>{const previous=displayDraw;displayDraw=true;
      try{return render(next,camera)}finally{displayDraw=previous}};
    context.shaderSource=(shader,source)=>{if(displayDraw&&source.includes('#define HD_FAST_GI'))fastGIDisplayCompiles.push(source.slice(0,200));return shaderSource(shader,source)};
  })()`)
  await menu();await wait(`!!document.querySelector('#three-settings-menu')`)
  await toggle('Indirect lighting (GI)');await toggle('Lighting preview')
  await wait(`houseDesignerFastGI.options.enabled&&houseDesignerFastGI.stats.state==='ready'&&houseDesignerFastGI.weight===1&&roofWallScene().scene.userData.indirectLighting?.diffuseEnabled===false`)
  await wait(`document.querySelector('[aria-label="Fast GI status"]')?.textContent.includes('100%')`)
  await wait(`!roofWallScene().scene.userData.indirectLighting.preparing&&!roofWallScene().scene.userData.indirectLighting.reading&&!roofWallScene().scene.userData.indirectLighting.warming`)
  const pausedProbe=await evaluate(`({...roofWallScene().scene.userData.indirectLighting})`)
  await new Promise(r=>setTimeout(r,1600))
  const stillPaused=await evaluate(`({...roofWallScene().scene.userData.indirectLighting})`)
  assert.equal(stillPaused.capturedFaces,pausedProbe.capturedFaces,'probe GI off must stop submitting probe capture faces')
  assert.equal(stillPaused.completed,pausedProbe.completed,'probe GI off must stop bounce integration')
  console.log('PASS: probe capture and bounce counters stay paused while experimental GI remains active')
  assert.deepEqual(await evaluate('fastGIDisplayCompiles'),[],'experimental GI shaders must be prepared outside display draws')
  if(process.argv.includes('--hot-reload')){
    await evaluate('(()=>{window.fastGIRegressionPreviousEngine=houseDesignerFastGI.engine;return true})()')
    const path='src/components/FastGI.tsx',stat=statSync(path);utimesSync(path,stat.atime,new Date())
    await wait(`!!window.fastGIRegressionPreviousEngine&&houseDesignerFastGI.engine!==window.fastGIRegressionPreviousEngine&&houseDesignerFastGI.stats.state==='ready'&&houseDesignerFastGI.weight===1`)
    await wait(`document.querySelector('[aria-label="Fast GI status"]')?.textContent.includes('100%')`)
    console.log('PASS: development refresh replaces disposed fast GI resources')
  }
  const active=await evaluate(`({status:document.querySelector('[aria-label="Fast GI status"]').textContent,weight:houseDesignerFastGI.weight,probeEnabled:roofWallScene().scene.userData.indirectLighting.diffuseEnabled})`)
  assert.match(active.status,/active · 100%/);assert.equal(active.probeEnabled,false)
  console.log('Fast GI active with probes disabled:',active)
  await menu()
  if(process.argv.includes('--gi-test'))await wait(`!roofWallScene().scene.userData.shaderWarmupPending&&!roofWallScene().scene.userData.viewportPreparation`)
  // Position inside the test room so the comparison actually sees its lighting.
  if(process.argv.includes('--corner'))await evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(.5,1.15,9);s.camera.lookAt(8,1.15,5.4);s.camera.updateMatrixWorld();s.invalidate()})()`)
  if(!process.argv.includes('--gi-test')&&!process.argv.includes('--saved-camera')&&!process.argv.includes('--door-view'))await evaluate(`(()=>{const s=roofWallScene();s.camera.position.set(7,1.6,3);s.camera.lookAt(2,1.2,1);s.camera.updateMatrixWorld();s.invalidate()})()`)
  await new Promise(r=>setTimeout(r,800))
  const screenshot=async name=>{const result=await call('Page.captureScreenshot',{format:'png'});const bytes=Buffer.from(result.data,'base64');writeFileSync(`tmp/${name}.png`,bytes);return bytes}
  const fast=await screenshot('fast-gi-switch-on')
  if(process.argv.includes('--gi-test')&&!process.argv.includes('--corner')){
    const wall=await sharp(fast).extract({left:100,top:250,width:100,height:160}).removeAlpha().stats()
    assert.ok(wall.channels.reduce((sum,c)=>sum+c.mean,0)/3>110,'completed fast GI must illuminate the saved room, rather than retaining its dark startup capture')
  }
  const fastStats=await evaluate(`({...houseDesignerFastGI.stats,bounds:houseDesignerFastGI.engine.bounds,preparation:roofWallScene().scene.userData.viewportPreparation,warmup:roofWallScene().scene.userData.shaderWarmupPending,materials:regressionAssignments.filter(a=>a.target.type==='room-floor').map(a=>regressionTools.surfaceMaterialsById.get(a.materialId))})`)
  await menu();await wait(`!!document.querySelector('#three-settings-menu')`);await toggle('Lighting preview')
  await wait(`!houseDesignerFastGI.options.enabled&&houseDesignerFastGI.weight===0`);await menu();await new Promise(r=>setTimeout(r,500))
  const off=await screenshot('fast-gi-switch-off')
  const crop=async bytes=>sharp(bytes).extract({left:300,top:250,width:500,height:350}).removeAlpha().raw().toBuffer()
  const a=await crop(fast),b=await crop(off);let difference=0;for(let i=0;i<a.length;i++)difference+=Math.abs(a[i]-b[i]);difference/=a.length
  assert.ok(difference>1,`fast lighting must visibly change scene pixels with probes disabled: ${difference}`)
  console.log('Visible pixel difference with probes disabled:',difference)
  if(process.argv.includes('--capture-only')) {
    writeFileSync('tmp/fast-gi-room-check.json',JSON.stringify({active,fastStats,meanPixelDifference:difference,errors},null,2))
    console.log(JSON.stringify(fastStats));assert.deepEqual(errors,[])
  } else {
  await menu();await wait(`!!document.querySelector('#three-settings-menu')`);await toggle('Indirect lighting (GI)');await toggle('Lighting preview')
  await wait(`houseDesignerFastGI.stats.state==='ready'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&houseDesignerFastGI.weight===0`)
  const combined=await evaluate(`document.querySelector('[aria-label="Fast GI status"]').textContent`)
  assert.match(combined,/displaying probes/);assert.deepEqual(errors,[])
  console.log(JSON.stringify({active,meanPixelDifference:difference,combined}));console.log('PASS: real 3D switches isolate fast GI, disable both, and restore probe refinement')
  }
} finally {ws?.close();child.kill()}
