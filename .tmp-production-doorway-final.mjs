// With Vite on port 5180: node tests/browser/interiorRoofTrimRegression.mjs
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './tests/browser/browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${createBrowserTestProfile('interior-roof-trim-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome debugger did not start')), 30000)
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    child.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    const request = pending.get(result.id)
    if (!request) return
    pending.delete(result.id)
    if (result.error) request.reject(result.error)
    else request.resolve(result.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 120000)
    pending.set(++id, {
      resolve: result => { clearTimeout(timeout); resolve(result) },
      reject: error => { clearTimeout(timeout); reject(error) },
    })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await call('Page.enable')
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__THREE_DEVTOOLS__=new EventTarget();window.productionRender=null;window.observed=[];
    window.__THREE_DEVTOOLS__.addEventListener('observe',event=>{
      const renderer=event.detail;window.observed.push(renderer.constructor.name);if(!renderer.render||!renderer.getRenderTarget)return;
      const render=renderer.render.bind(renderer);
      renderer.render=(scene,camera)=>{
        if(scene.userData.getIndirectCaptureScene&&camera.isPerspectiveCamera)window.productionRender={scene,camera,renderer};
        return render(scene,camera);
      };
    });
  `});
  await call('Runtime.enable');await call('Page.navigate',{url:'http://localhost:4173/'});
  let ready=false;
  for(let i=0;i<240;i++){
    await new Promise(resolve=>setTimeout(resolve,500));
    ready=await evaluate(`(()=>{let roofs=0,walls=0;window.productionRender?.scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='roof-eaves')roofs++;
      if(o.userData.houseDesignerRole==='wall-engine-render'&&o.geometry.attributes.position.count)walls++;
    });return roofs===8&&walls>=2&&!document.body.innerText.includes('Preparing 3D scene')})()`);
    if(i===20)console.log(await evaluate('({observed:window.observed,body:document.body.innerText.slice(0,1500),roles:window.productionRender?.scene.children.map(o=>({name:o.name,type:o.type,data:o.userData}))})'));if(ready)break;
  }
  writeFileSync('.tmp-production-loading.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));console.log(await evaluate('({observed:window.observed,body:document.body.innerText.slice(0,1500),roots:window.productionRender?.scene.children.map(o=>({name:o.name,type:o.type}))})'));assert.ok(ready,'production scene loads');
  await evaluate(`(()=>{const style=document.createElement('style');style.textContent='.editor-grid{--split-left:2fr!important;--split-right:98fr!important}';document.head.append(style)})()`);
  for(let i=0;i<180;i++){
    await new Promise(resolve=>setTimeout(resolve,500));
    if(await evaluate("window.productionRender?.scene.userData.indirectLighting?.state==='ready'"))break;
  }
  console.log(await evaluate(`({scripts:[...document.scripts].map(s=>s.src),camera:window.productionRender.camera.position.toArray(),
    status:window.productionRender.scene.userData.indirectLighting})`));
  writeFileSync('.tmp-doorway-final-preview.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
} finally {ws?.close();child.kill()}

