// With Vite running: node tests/browser/doorPlanRegression.mjs [port]
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,950',
  `--user-data-dir=${createBrowserTestProfile('door-plan-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
    child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), request = pending.get(result.id)
    if (request) {
      pending.delete(result.id)
      result.error ? request.reject(result.error) : request.resolve(result.result)
    }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Page.navigate', {url:'http://127.0.0.1:'+(process.argv[2]??5186)+'/tests/browser/modelPlanPreviewRegression.html'})
  for(let i=0;i<600;i++){if(await evaluate('window.planPreviewResult||window.planPreviewError'))break;await pause(100)}
  assert.equal(await evaluate('window.planPreviewError'),undefined)
  const result=await evaluate('window.planPreviewResult')
  assert.ok(result,'preview completes')
  assert.ok(result.ink>200&&result.white>1000,'recognisable outlines and white surfaces')
  assert.ok(result.transparent>100,'transparent space outside the object silhouette')
  assert.equal(result.coloured,0,'preview contains only black and white')
  assert.ok(Math.abs(result.aspect-result.modelAspect)<.01,'orthographic thumbnail preserves the model proportions')
  writeFileSync('node_modules/.cache/model-plan-preview.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  assert.deepEqual(errors,[])
  console.log('PASS: monochrome orthographic bed preview',result)
  await call('Page.navigate',{url:'http://127.0.0.1:'+(process.argv[2]??5186)+'/tests/browser/objectHandlesRegression.html'})
  for(let i=0;i<600;i++){if(await evaluate('!!window.handleSetFloor'))break;await pause(100)}
  await evaluate(`(()=>{
    document.getElementById('root').style.gridTemplateColumns='1fr';document.querySelectorAll('.editor-pane')[1].style.display='none';
    handleSelectModel(null);handleSetFloor(f=>({...f,models:[{id:'plan-bed',modelId:'king-bed',position:{x:3,y:3},rotation:0,scale:1}]}));
  })()`)
  for(let i=0;i<900;i++){if(await evaluate(`!!handleStage().findOne('.model-plan-detail')`))break;await pause(100)}
  assert.ok(await evaluate(`!!handleStage().findOne('.model-plan-detail')`),'the plan receives the traced vector drawing')
  const drawing = () => evaluate(`(()=>{
    const nodes=handleStage().find(n=>n.name()==='model-plan-detail'||n.name()==='model-plan-silhouette');
    return nodes.map(n=>({name:n.name(),width:n.strokeWidth()*(n.strokeScaleEnabled()?n.getAbsoluteScale().x:1),kind:n.getClassName()}));
  })()`)
  const before=await drawing()
  assert.deepEqual(before.map(n=>n.kind),['Shape','Shape'],'furniture details are vector shapes rather than a scaled bitmap')
  for(let i=0;i<6;i++){await evaluate(`document.querySelector('[aria-label="Zoom in"]').click()`);await pause(30)}
  assert.deepEqual(await drawing(),before,'vector line widths remain fixed when zooming in')
  for(let i=0;i<10;i++){await evaluate(`document.querySelector('[aria-label="Zoom out"]').click()`);await pause(30)}
  assert.deepEqual(await drawing(),before,'fine lines remain fixed when zooming out')
  await evaluate(`document.querySelector('[aria-label="Reset zoom"]').click()`)
  await pause(100)
  writeFileSync('node_modules/.cache/model-plan-vector.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('PASS: actual furniture uses vector outlines/details with constant screen widths across zoom')
}finally{ws?.close();child.kill()}
