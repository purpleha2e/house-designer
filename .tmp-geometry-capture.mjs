// Vite + asset portal running: node tests/browser/viewportResponsiveness.mjs [port] [seconds]
import { mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './tests/browser/browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,850',
  `--user-data-dir=${createBrowserTestProfile('viewport-response-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 15000)
    browser.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]) } })
    browser.on('error', reject); browser.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const r = JSON.parse(event.data), p = pending.get(r.id)
    if (p) { pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(r.error) : p.resolve(r.result) }
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails)
    if (r.method === 'Runtime.consoleAPICalled' && r.params.type === 'error') errors.push(r.params.args.map(a => a.value ?? a.description))
    if(r.method==='Log.entryAdded'&&r.params.entry.source==='rendering')console.log('GL:',r.params.entry.text)
  })
  const send = (method, params, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(method + ' timed out')) }, 30000)
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  await call('Page.enable'); await call('Runtime.enable'); await call('Profiler.enable');await call('Log.enable');await call('Performance.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  if (process.argv.includes('--resources')) {
    await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5181}/tests/browser/viewportResourcesRegression.html` })
    let result
    for(let i=0;i<300&&!result;i++) {
      await new Promise(resolve=>setTimeout(resolve,100));result=await evaluate('window.viewportResourcesResult')
      if(errors.length)throw Error(JSON.stringify(errors))
    }
    assert.ok(result,'Resource regression did not finish')
    console.log('PASS viewport resources:',result)
    ws.close();browser.kill();process.exit(0)
  }
  if (process.argv.includes('--bake-environment')) {
    await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5181}/tests/browser/bakePbrEnvironment.html` })
    let baked
    for (let i=0;i<100&&!baked;i++) { await new Promise(resolve=>setTimeout(resolve,100)); baked=await evaluate('window.bakedPbrEnvironment') }
    if (!baked || errors.length) throw Error(JSON.stringify({ baked: !!baked, errors }))
    mkdirSync('src/assets/environments', { recursive: true })
    writeFileSync('src/assets/environments/roomEnvironment.bin.gz', gzipSync(Buffer.from(baked.base64, 'base64')))
    writeFileSync('src/assets/environments/roomEnvironment.json', JSON.stringify({ width:baked.width, height:baked.height })+'\n')
    console.log('Baked existing RoomEnvironment:', baked.width, baked.height)
    ws.close(); browser.kill(); process.exit(0)
  }

  await call('Page.addScriptToEvaluateOnNewDocument', {source: `
    window.geometryJobs=[];window.geometryInputs=[];
    const NativeWorker=Worker;
    window.Worker=class extends NativeWorker {
      constructor(url,options){super(url,options);this.url=String(url);this.addEventListener('message',()=>{if(this.job)this.job.end=performance.now()})}
      postMessage(data,...rest){const job={url:this.url,kind:data?.kind??(data?.input?'clip':Array.isArray(data)?'assembly':'prepare'),start:performance.now()};this.job=job;geometryJobs.push(job);if(/wallRoofClip/.test(this.url)&&data?.input)geometryInputs.push(data);super.postMessage(data,...rest)}
      terminate(){if(this.job&&!this.job.end)this.job.cancelled=performance.now();super.terminate()}
    };
  `})
  await call('Page.navigate',{url:'http://127.0.0.1:'+ (process.argv[2]??5181) +'/tests/browser/roofWallRegression.html?'+(process.argv[3]??'colin')})
  const deadline=Date.now()+90000
  let result
  while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,1000))
    result=await evaluate(`({jobs:geometryJobs,logs:window.houseDesignerEngineLog?.entries,state:window.roofWallScene?.()?.scene.userData.indirectLighting,shader:window.roofWallScene?.()?.scene.userData.shaderWarmupPending})`)
    const active=result.jobs.filter(j=>!j.end&&!j.cancelled&&/buildingPreparation|wallRoofClip|roofAssembly|threeDLevel/.test(j.url))
    console.log(JSON.stringify({seconds:Math.round((90000-deadline+Date.now())/1000),jobs:result.jobs.length,active:active.map(j=>({type:j.url.split('/').pop(),kind:j.kind,start:j.start})),shader:result.shader,state:result.state?.state}))
    if(result.jobs.length&&active.length===0&&Date.now()>deadline-70000)break
  }
  writeFileSync('.tmp-geometry-inputs.json',JSON.stringify(await evaluate('geometryInputs')));
  writeFileSync('.tmp-geometry-'+(process.argv[4]??'baseline')+'.json',JSON.stringify({result,errors},null,2))
  console.log(JSON.stringify({jobs:result.jobs.map(j=>({...j,url:j.url.split('/').pop(),ms:Math.round((j.end??j.cancelled??0)-j.start)})),logs:result.logs,errors},null,2))
}finally{ws?.close();browser.kill()}
