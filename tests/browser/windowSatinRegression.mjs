// Stage colin_house_v2.json with build:viewer, then run with Vite on port 5180.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1800,1000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'viewer-roof-'))}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout=setTimeout(()=>reject(new Error('Chrome startup timed out')),60000)
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
    const timeout=setTimeout(()=>reject(new Error(`${method} timed out`)),60000)
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
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/readOnlyViewerRegression.html?published'})
  for(let i=0;i<160;i++){await pause(250);if(await evaluate('!!window.viewerState?.() && !document.querySelector(".viewport-preparing-overlay")'))break}
  await evaluate(`document.querySelectorAll('button')[1].click()`)
  for(let i=0;i<160;i++){
    await pause(250)
    if(await evaluate(`(()=>{const ids=new Set();window.viewerState()?.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render'&&o.geometry.attributes.position.count)ids.add(o.userData.floorId)});return ids.has('a5e1058b-f220-4fef-9e1f-5cb871e2e0c5')&&ids.has('db559ff8-8f78-4b2c-8093-d57d78580c07')})()`))break
  }
  await pause(2000)
  const result=await evaluate(`(()=>{
    const s=window.viewerState();s.setFrameloop('never');s.scene.updateMatrixWorld(true);
    const materials=new Set();s.scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m&&/^painted_white_frame/.test(m.name))materials.add(m)});
    window.satinMaterials=[...materials];
    s.camera.position.set(4.75,4.5,12.3);s.camera.lookAt(6.37,4.15,13.32);s.camera.updateMatrixWorld();s.gl.clear();s.gl.render(s.scene,s.camera);
    return [...materials].map(m=>({name:m.name,color:m.color.toArray(),roughness:m.roughness,metalness:m.metalness,environment:!!m.envMap,intensity:m.envMapIntensity}));
  })()`)
  assert.ok(result.length,'the saved house contains imported window frames')
  assert.ok(result.every(m=>m.roughness===0.38&&m.metalness===0&&m.environment&&m.intensity===0.55),'window frames receive satin reflected lighting')
  assert.ok(result.every(m=>Math.abs(m.color[0]-0.9386857151985168)<1e-6),'authored window colours are preserved')
  writeFileSync('.tmp-window-satin-after.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate(`(()=>{const s=window.viewerState();for(const m of window.satinMaterials){m.envMap=null;m.metalness=.05;m.roughness=.42;m.needsUpdate=true}s.gl.clear();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync('.tmp-window-satin-before.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Window satin finish passed:',JSON.stringify(result))
}finally{ws?.close();child.kill()}