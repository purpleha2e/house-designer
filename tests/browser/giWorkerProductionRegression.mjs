// Production preview: node tests/browser/giWorkerProductionRegression.mjs [port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=900,760',
  `--user-data-dir=${createBrowserTestProfile('gi-production-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 30000)
    browser.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]) } })
    browser.once('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data), request = pending.get(m.id)
    if (request) { pending.delete(m.id); clearTimeout(request.timer); m.error ? request.reject(m.error) : request.resolve(m.result) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${method} timed out`)) }, 60000)
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ id: requestId, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async (expression, timeout = 180000) => {
    const end = Date.now() + timeout
    while (!await evaluate(expression)) {
      assert.deepEqual(errors, [])
      if (Date.now() > end) throw Error(`Timed out: ${expression}\n${JSON.stringify(await evaluate('window.doorLatency?.state()?.scene.userData.indirectLighting'))}`)
      await pause(50)
    }
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data)
    if(m.method==='Fetch.requestPaused') void call('Fetch.fulfillRequest', {
      requestId:m.params.requestId,responseCode:200,
      responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<!doctype html><title>GI worker smoke test</title>').toString('base64'),
    })
  })
  await call('Fetch.enable',{patterns:[{urlPattern:'*',resourceType:'Document',requestStage:'Request'}]})
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??4180}/`})
  await pause(100)
  await call('Fetch.disable')
  const result=await evaluate(`(async()=>{
    const html=await(await fetch('/')).text(),doc=new DOMParser().parseFromString(html,'text/html');
    const script=doc.querySelector('script[type="module"][src]').src;
    const bundle=await(await fetch(script)).text(),name=bundle.match(/indirectLighting\\.worker-[A-Za-z0-9_-]+\\.js/)?.[0];
    if(!name)throw Error('GI worker not found in production bundle');
    const url=new URL(name,script).href,worker=new Worker(url,{type:'module'});
    const request={id:1,kind:'prepare',floors:[{id:'floor',elevation:0,height:2.4,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}]}]}],lights:[[2,2,1.5]],obstacles:[],geometry:[{
      position:new Float32Array([1.5,0,0,1.5,2.4,0,1.5,2.4,3,1.5,0,0,1.5,2.4,3,1.5,0,3]),
      stride:3,offset:0,normalized:false,index:null,ranges:[{start:0,count:6}],
      matrices:[[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]],structural:false,
    }]};
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('GI worker timed out: '+url)),30000);
      worker.onerror=e=>{clearTimeout(timer);reject(Error((e.message||'Worker load failed')+' '+e.filename))};
      worker.onmessage=({data})=>{
        if(data.progress)return;
        if(!data.ok){clearTimeout(timer);reject(Error(data.error));return}
        if(data.id===1){
          request.geometry[0].matrices[0][12]=.25;
          worker.postMessage({...request,id:2,zones:{previous:data.value.field.probes.map(p=>({index:p.index,position:p.position,floorId:'floor'})),changes:[{floorId:'floor',min:[1.4,0,0],max:[1.8,2.4,3]}]}});
          return;
        }
        clearTimeout(timer);resolve({url,probes:data.value.field.probes.length,geometryRefitted:data.value.geometryRefitted});
      };
      worker.postMessage(request);
    })}finally{worker.terminate()}
  })()`)
  assert.ok(result.probes>0)
  assert.equal(result.geometryRefitted,true)
  console.log('PASS bundled GI worker prepares and refits changed geometry',JSON.stringify(result))
}finally{ws?.close();browser.kill()}
