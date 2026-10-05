// With Vite on port 5180: node tests/browser/bayRoofPlacementRegression.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1800,1000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bay-roof-'))}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout=setTimeout(()=>reject(new Error('Chrome startup timed out')),30000)
    child.stderr.on('data', data => {
      const match=String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if(match){clearTimeout(timeout);resolve(match[1])}
    })
    child.on('error',reject)
    child.on('exit',code=>reject(new Error(`Chrome exited ${code}`)))
  })
  ws=new WebSocket(endpoint)
  await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}))
  let id=0
  const pending=new Map()
  ws.addEventListener('message',event=>{
    const result=JSON.parse(event.data),request=pending.get(result.id)
    if(request){pending.delete(result.id);result.error?request.reject(result.error):request.resolve(result.result)}
  })
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),30000)
    pending.set(++id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject:error=>{clearTimeout(timeout);reject(error)}})
    ws.send(JSON.stringify({id,method,params,sessionId}))
  })
  const {targetId}=await send('Target.createTarget',{url:'about:blank'})
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true})
  const call=(method,params)=>send(method,params,sessionId)
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  await call('Page.enable')
  await call('Page.navigate',{url:'http://127.0.0.1:5180/.tmp-roof-live-preview.html'})
  for(let i=0;i<60;i++){await pause(500);if(await evaluate('!!window.bayStage?.() && !!window.bayScene?.()'))break}
  assert.ok(await evaluate('!!window.bayStage?.()'))
  await pause(5000)
  const change=async(selector,value)=>{
    await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await pause(200)
  }
  await change('.roof-tool-flyout select','lean-to')
  const screen=point=>evaluate(`(()=>{const s=window.bayStage(),r=s.container().getBoundingClientRect();return {x:r.left+s.x()+${point.x}*60*s.scaleX(),y:r.top+s.y()+${point.y}*60*s.scaleY()}})()`)
  const click=async point=>{
    const p=await screen(point)
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await pause(500)
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1})
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await pause(500)
    console.log('click',point,await evaluate("window.bayStage().find('Circle').filter(c=>c.fill()==='#22c55e').map(c=>({x:c.x()/60,y:c.y()/60}))"))
  }
  for(const p of [{x:-0.4771028,y:4.901592949},{x:1.731173,y:4.901592949},{x:1.731173,y:10.161181662}])await click(p)
  await pause(1500)
  const roof=await evaluate('window.bayPreview')
  writeFileSync('.tmp-roof-live-preview.json',JSON.stringify(roof))
  const geometry=await evaluate(`(()=>{const result=[];window.bayScene().scene.traverse(o=>{if(o.userData.houseDesignerRole==='roof-placement-preview')result.push({count:o.geometry.attributes.position.count,position:Array.from(o.geometry.attributes.position.array),matrix:o.matrixWorld.elements})});return result})()`)
  console.log('Preview',roof,'mesh',geometry.map(g=>({count:g.count})))
  writeFileSync('.tmp-roof-live-preview-geometry.json',JSON.stringify(geometry))
  await evaluate(`(()=>{const s=window.bayScene();s.setFrameloop('never');s.camera.position.set(-8,9,19);s.camera.lookAt(2,2.4,9);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync('.tmp-roof-live-preview.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
}finally{ws?.close();child.kill()}

