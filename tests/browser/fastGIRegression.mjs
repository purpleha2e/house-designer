// Run with Vite on 5180: node tests/browser/fastGIRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'
const child=spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-sandbox','--enable-unsafe-swiftshader','--remote-debugging-port=0','--no-first-run','--no-default-browser-check',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1050,820',`--user-data-dir=${createBrowserTestProfile('fast-gi-')}`,'about:blank'],{windowsHide:true})
let ws
try {
  const endpoint=await new Promise((resolve,reject)=>{child.stderr.on('data',data=>{const match=String(data).match(/DevTools listening on (ws:\/\/\S+)/);if(match)resolve(match[1])});child.on('error',reject);child.on('exit',code=>reject(Error(`Chrome exited ${code}`)))})
  ws=new WebSocket(endpoint);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
  let id=0;const pending=new Map(),errors=[]
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data),request=pending.get(message.id)
    if(request){pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result)}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text)
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.value??a.description).join(' '))})
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}))})
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params={})=>send(method,params,sessionId)
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
  const wait=async(expression,seconds=90)=>{const until=Date.now()+seconds*1000;let lastLog=0;while(Date.now()<until){if(errors.length)throw Error(errors.join('\n'));if(await evaluate(expression))return;const state=await evaluate('window.houseDesignerFastGI?.stats');if(state?.state==='error')throw Error(JSON.stringify(state));if(Date.now()-lastLog>10000){console.log('WAIT',JSON.stringify(state));lastLog=Date.now()}await new Promise(resolve=>setTimeout(resolve,100))}throw Error(`Timed out: ${expression}\n${JSON.stringify(await evaluate('window.houseDesignerFastGI?.stats'))}`)}
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true})
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.fastGIFrames=[];window.fastGILongTasks=[];let last=performance.now();function tick(){const now=performance.now();fastGIFrames.push(now-last);last=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);new PerformanceObserver(list=>fastGILongTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});`})
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/fastGIRegression.html?fastGI=1`})
  await wait(`window.houseDesignerFastGI?.stats.state==='ready'`)
  mkdirSync('tmp/fast-gi',{recursive:true})
  const screenshot=async name=>{const result=await call('Page.captureScreenshot',{format:'png'});writeFileSync(`tmp/fast-gi/${name}.png`,Buffer.from(result.data,'base64'))}
  const report={hardware:await evaluate(`(()=>{const c=fastGITest.state().gl.getContext(),e=c.getExtension('WEBGL_debug_renderer_info');return {renderer:e?c.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown',cores:navigator.hardwareConcurrency}})()`)}
  report.hybridCold=await evaluate('fastGITest.read()');console.log('HYBRID',JSON.stringify(report.hybridCold));await screenshot('hybrid')
  report.transport=await evaluate('fastGITest.transport()');console.log('TRANSPORT',JSON.stringify(report.transport))
  report.filter=await evaluate('fastGITest.filter()');console.log('FILTER',JSON.stringify(report.filter))
  assert.ok(report.filter.constant.constantError<.001,'spatial filtering preserves constant illumination')
  assert.ok(report.filter.noise.variance<.05,'spatial filtering removes high-frequency sampling noise')
  assert.equal(report.filter.partition.leftMax,0,'a solid partition prevents smoothing light into its dark side')
  assert.ok(report.filter.partition.rightMin>3.99,'the lit side retains its illumination')
  for(const sample of Object.values(report.filter)){
    assert.ok(sample.directionError<.001,'all directional SH bands use the same filter weights')
    assert.equal(sample.metadataError,0,'occupancy and observation flags remain exact')
  }
  assert.ok(report.transport.floorDirect.wall>0,'sunlit floor patch illuminates a facing wall')
  assert.ok(report.transport.floorReflected.floor>report.transport.floorDirect.floor,'wall reflection returns additional light to the neighbouring floor')
  for(const kind of ['surfaces','normals','occupancy','forward','reverse','indirect']){
    const data=await evaluate(`houseDesignerFastGI.inspect('${kind}',0)`);writeFileSync(`tmp/fast-gi/${kind}.png`,Buffer.from(data.split(',')[1],'base64'))
  }
  await evaluate(`document.querySelectorAll('body>div').forEach(e=>{if(e.textContent.startsWith('Experimental GI:'))e.remove()})`)
  await evaluate(`houseDesignerFastGI.configure({hybrid:false,mode:'fast'})`);await wait(`houseDesignerFastGI.stats.state==='ready'&&houseDesignerFastGI.options.hybrid===false&&houseDesignerFastGI.stats.revision>${report.hybridCold.stats.revision}`)
  report.captures=await evaluate('fastGITest.read()');console.log('CAPTURES',JSON.stringify(report.captures));await screenshot('captures-only')
  await evaluate(`houseDesignerFastGI.configure({hybrid:true})`);await wait(`houseDesignerFastGI.stats.state==='ready'&&houseDesignerFastGI.stats.revision>${report.captures.stats.revision}`)
  report.hybridWarm=await evaluate('fastGITest.read()');report.edits={}
  for(const kind of ['red','window','table','partition']){
    const previous=await evaluate('houseDesignerFastGI.stats.revision')
    const editedAt=await evaluate(`(()=>{const at=performance.now();fastGITest.edit('${kind}');return at})()`)
    await wait(`houseDesignerFastGI.stats.state==='ready'&&houseDesignerFastGI.stats.revision>${previous}`)
    // Allow any geometry scan following the edit to supersede its first request.
    await new Promise(resolve=>setTimeout(resolve,600));await wait(`houseDesignerFastGI.stats.state==='ready'`)
    report.edits[kind]=await evaluate('fastGITest.read()');report.edits[kind].editToVisibleMs=report.edits[kind].stats.publishedAt-editedAt
    console.log('EDIT',kind,JSON.stringify({stats:report.edits[kind].stats,editToVisibleMs:report.edits[kind].editToVisibleMs,energy:report.edits[kind].energy}));await screenshot(`edit-${kind}`)
  }
  const rapidBefore=await evaluate(`(async()=>{const previous=houseDesignerFastGI.stats.revision;fastGITest.edit('red');await new Promise(r=>setTimeout(r,20));fastGITest.edit('red');return previous})()`)
  await wait(`houseDesignerFastGI.stats.state==='ready'&&houseDesignerFastGI.stats.revision>${rapidBefore}`)
  await new Promise(resolve=>setTimeout(resolve,600));await wait(`houseDesignerFastGI.stats.state==='ready'`)
  report.rapidEdits=await evaluate('fastGITest.read()')
  await evaluate(`houseDesignerFastGI.configure({mode:'combined'})`)
  await wait(`fastGITest.state().scene.userData.indirectLighting?.state==='ready'`,180)
  report.probeRefinementMs=await evaluate(`performance.now()-fastGITest.state().scene.userData.indirectLighting.bakeStartedAt`)
  await new Promise(resolve=>setTimeout(resolve,800));report.refined=await evaluate('fastGITest.read()');await screenshot('probe-refined')
  await evaluate(`houseDesignerFastGI.configure({mode:'fast'})`);await wait(`fastGITest.read().then(r=>r.fastWeight===1)`)
  await screenshot('same-scene-fast')
  const fast=await sharp('tmp/fast-gi/same-scene-fast.png').extract({left:0,top:35,width:1000,height:690}).removeAlpha().raw().toBuffer()
  const probe=await sharp('tmp/fast-gi/probe-refined.png').extract({left:0,top:35,width:1000,height:690}).removeAlpha().raw().toBuffer()
  let squared=0,fastMean=0,probeMean=0;for(let i=0;i<fast.length;i++){squared+=(fast[i]-probe[i])**2;fastMean+=fast[i];probeMean+=probe[i]}
  report.imageComparison={rmse:Math.sqrt(squared/fast.length),fastMean:fastMean/fast.length,probeMean:probeMean/probe.length,scale:255}
  const steadyFrames=()=>evaluate(`new Promise(resolve=>{const values=[];let last=performance.now(),skip=5;function tick(){const now=performance.now();if(skip>0)skip--;else values.push(now-last);last=now;if(values.length<120)requestAnimationFrame(tick);else {values.sort((a,b)=>a-b);resolve({median:values[60],p95:values[114],max:values[119]})}}requestAnimationFrame(tick)})`)
  report.steadyFast=await steadyFrames()
  await evaluate(`houseDesignerFastGI.configure({mode:'probe'})`);await new Promise(resolve=>setTimeout(resolve,800))
  report.steadyProbe=await steadyFrames()
  const sample=await evaluate(`(()=>{const a=fastGIFrames.slice(-180).sort((a,b)=>a-b);return {median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:Math.max(...a),longTasks:fastGILongTasks}})()`)
  report.frames=sample;report.errors=errors
  writeFileSync('tmp/fast-gi/report.json',JSON.stringify(report,null,2));console.log('REPORT tmp/fast-gi/report.json')
  assert.ok(report.hybridCold.observed>100,'captured surfaces reconstructed')
  assert.ok(report.hybridCold.positive>0&&report.hybridCold.negative>0,'opposing surface orientations retained')
  assert.ok(report.hybridCold.radiant>0&&report.hybridCold.dark>0,'observed bright and dark surfaces remain distinct')
  assert.ok(report.hybridCold.energy>0,'gathered illumination contains energy')
  assert.equal(report.transport.sealed.energy,0,'solid wall blocks all transferred light')
  assert.ok(report.transport.opening.energy>0&&report.transport.clear.energy>=report.transport.opening.energy,'window admits transferred light')
  assert.equal(report.transport.backFacingEmitter.energy,0,'surface emits into its outward hemisphere')
  assert.equal(report.transport.skySealed.energy,0,'a closed black room receives no sky light')
  assert.ok(report.transport.skyOpening.energy>0&&report.transport.skyOpening.front>report.transport.skyOpening.back,'sky enters through an opening and retains direction')
  assert.ok(report.transport.skyReflected.energy>report.transport.skyOpening.energy,'material response reflects visible sky into a second bounce')
  assert.equal(report.transport.sealedReflected.energy,0,'a second bounce cannot invent light in a sealed black room')
  assert.ok(report.transport.clear.front>report.transport.clear.back,'opposite receiver normals receive different light')
  assert.ok(report.hybridCold.allHemisphere.every(v=>v>0),'sphere represented from both sides')
  assert.ok(report.hybridCold.hemisphere.every((v,i)=>v<report.hybridCold.allHemisphere[i]),'reverse captures add sphere surface coverage')
  assert.ok(report.hybridCold.floorUnderTable>0,'floor beneath furniture is observed')
  assert.ok(report.hybridCold.underside>0&&report.hybridCold.darkUnderside>0,'upward reverse capture observes the dark table underside')
  assert.ok(report.hybridCold.occupied>=report.captures.occupied,'geometry adds occupancy')
  assert.ok(report.hybridWarm.redEnergy/report.hybridWarm.greenEnergy>report.edits.red.redEnergy/report.edits.red.greenEnergy,'red wall changes colour bleeding')
  assert.ok(Math.abs(report.rapidEdits.redEnergy/report.rapidEdits.greenEnergy-report.edits.partition.redEnergy/report.edits.partition.greenEnergy)<.01,'superseded red captures cannot overwrite the latest white-wall revision')
  assert.equal(report.refined.fastWeight,0,'completed probes replace fast GI after a smooth blend')
  assert.deepEqual(errors,[])
  console.log('PASS opposing reconstruction, directional transport, edits and probe handover')
} finally {ws?.close();child.kill()}
