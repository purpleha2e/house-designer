// With Vite on port 5180: node tests/browser/roofControlsRegression.mjs
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
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/bayRoofPlacementRegression.html?asymmetric-create'})
  for(let i=0;i<80;i++){
    await pause(250)
    if(await evaluate('!!window.bayScene?.() && !!document.querySelector(\'[aria-label="Roof vertical offset"]\')'))break
  }
  const tab = async name => {
    await evaluate(`(()=>{const el=[...document.querySelectorAll('.roof-settings-tabs [role="tab"]')].find(el=>el.textContent===${JSON.stringify(name)});if(!el)throw new Error('Missing tab');el.click()})()`)
    await pause(250)
  }
  const visible = async label => evaluate(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');return !!el?.getClientRects().length})()`)
  const change = async (label,value) => {
    await evaluate(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');
      if(!el.getClientRects().length)throw new Error('Field is hidden: '+${JSON.stringify(label)});
      Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await pause(300)
  }
  assert.equal(await visible('Roof shape'),true)
  assert.equal(await visible('Roof pitch'),true)
  assert.equal(await visible('Roof vertical offset'),false)
  assert.equal(await visible('Fit supporting walls to roof'),false)
  const initialBounds=await evaluate(`(()=>{const p=document.querySelector('.roof-settings-panel'),r=p.getBoundingClientRect();return {width:r.width,right:r.right,scroll:p.scrollWidth,client:p.clientWidth}})()`)
  assert.ok(initialBounds.width<=340)
  assert.ok(initialBounds.scroll<=initialBounds.client,'no horizontal scrolling in the roof panel')
  writeFileSync('.tmp-roof-controls-create.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await change('Roof pitch',33)
  await tab('Advanced')
  assert.equal(await visible('Roof vertical offset'),true)
  await change('Roof vertical offset',-0.15)
  await tab('Height & joins')
  assert.equal(await visible('Fit supporting walls to roof'),true)
  await evaluate(`document.querySelector('[aria-label="Fit supporting walls to roof"]').click()`)
  await tab('Shape')
  // Pan so all four mounting points are clear of the controls, as in the app.
  const pane=await evaluate(`(()=>{const r=window.bayStage().container().getBoundingClientRect();return {x:r.left+600,y:r.top+650}})()`)
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...pane})
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...pane,button:'middle',buttons:4,clickCount:1})
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:pane.x+100,y:pane.y,button:'middle',buttons:4})
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:pane.x+100,y:pane.y,button:'middle',buttons:0,clickCount:1})
  await pause(300)
  const screen = point => evaluate(`(()=>{const s=window.bayStage(),r=s.container().getBoundingClientRect();return {
    x:r.left+s.x()+${point.x}*60*s.scaleX(),y:r.top+s.y()+${point.y}*60*s.scaleY()}})()`)
  for(const point of [{x:1,y:1},{x:5,y:1},{x:5,y:4},{x:1,y:4}]){
    const p=await screen(point)
    assert.ok(p.x>initialBounds.right,'mounting point is outside the panel')
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p})
    await pause(100)
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1})
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})
    await pause(200)
  }
  assert.ok(await evaluate('!!window.bayPreview'),'selecting supporting points creates a live roof preview')
  await evaluate(`(()=>{const button=[...document.querySelectorAll('.roof-placement-actions button')].find(b=>b.textContent==='Create');if(button.disabled)throw new Error('Create is disabled');button.click()})()`)
  await pause(500)
  const created=await evaluate(`window.bayFloor.roofs.find(r=>r.id==='created-gable')`)
  assert.equal(created.pitchDegrees,33)
  assert.equal(created.heightOffset,-0.15)
  assert.equal(created.fitSupportingWalls,true)
  await evaluate(`window.bayRoofMode(false);window.baySelectRoof('created-gable')`)
  await pause(500)
  assert.equal(await visible('Roof pitch'),true,'selected roofs open on Shape')
  await change('Roof pitch',29)
  assert.equal(await evaluate(`window.bayFloor.roofs.find(r=>r.id==='created-gable').pitchDegrees`),29)
  await tab('Height & joins')
  assert.equal(await visible('Roof height alignment'),true)
  assert.equal(await visible('Roof ridge offset'),false)
  // Keep a completed automatic example visible for layout inspection.
  await evaluate(`(async()=>{const p=await(await fetch('/colin_house_v2_aligned_roofs.json')).json();
    const {normalizeFloor}=await import('/src/modelPlacement.ts');window.baySetFloor(normalizeFloor(p.floors[1],new Map()));
    window.baySelectRoof('b46c5b90-ecdc-4d0f-a6a5-976b793c7270')})()`)
  await pause(750)
  await tab('Height & joins')
  writeFileSync('.tmp-roof-controls-height.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  for(const width of [1800,1000]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
    await pause(350)
    const layout=await evaluate(`(()=>{const p=document.querySelector('.roof-settings-panel'),r=p.getBoundingClientRect();
      return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,client:p.clientWidth,scroll:p.scrollWidth,height:innerHeight}})()`)
    assert.ok(layout.x>=0&&layout.right<=width&&layout.bottom<=layout.height,'panel stays in the viewport')
    assert.ok(layout.scroll<=layout.client,'no horizontal overflow at narrower widths')
  }
  console.log('Roof creation, selected editing, tab visibility, alignment controls and responsive layout passed')
} finally { ws?.close(); child.kill() }