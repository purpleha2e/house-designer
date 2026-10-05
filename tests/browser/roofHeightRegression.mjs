// With Vite on port 5180: node tests/browser/roofHeightRegression.mjs
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
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/bayRoofPlacementRegression.html?roof-height'})
  for(let i=0;i<80;i++){
    await pause(250)
    if(await evaluate('!!window.bayScene?.() && !!document.querySelector(\'[aria-label="Roof vertical offset"]\')'))break
  }
  const roofId='8e321618-2fa0-4ea5-99ec-8210302fe639'
  const snapshot=(id=roofId)=>evaluate(`(()=>{
    const state=window.bayScene();state.scene.updateMatrixWorld(true);let roof,wall;
    state.scene.traverse(o=>{
      if(o.userData.houseDesignerRole==='roof-top' && o.userData.roofId==='${id}')roof=o;
      if(o.userData.houseDesignerRole==='wall-engine-render' && o.userData.floorId===window.bayFloor.id)wall=o;
    });
    if(!roof?.geometry.attributes.position || !wall?.geometry.attributes.position)return null;
    const p=roof.geometry.attributes.position;
    return {roofId:roof.geometry.uuid,wallId:wall.geometry.uuid,
      roofTop:Math.max(...Array.from({length:p.count},(_,i)=>p.getY(i)))+roof.matrixWorld.elements[13],
      count:p.count};
  })()`)
  let before
  for(let i=0;i<80;i++){await pause(250);before=await snapshot();if(before)break}
  assert.ok(before)
  const originalWalls=await evaluate('JSON.stringify(window.bayFloor.walls)')
  await evaluate(`document.querySelector('[aria-label="Fit supporting walls to roof"]').click()`)
  await evaluate(`(()=>{const el=document.querySelector('[aria-label="Roof vertical offset"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'-0.3');
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  let after
  for(let i=0;i<80;i++){
    await pause(250);after=await snapshot()
    if(after && after.wallId!==before.wallId && Math.abs(before.roofTop-after.roofTop-0.3)<1e-5)break
  }
  assert.ok(after)
  assert.ok(Math.abs(before.roofTop-after.roofTop-0.3)<1e-5,'the live roof lowers by exactly 300 mm')
  assert.notEqual(after.wallId,before.wallId,'supporting wall geometry follows the live edit')
  assert.ok(after.count>0,'the lowered passive roof remains visible')
  const roof=await evaluate(`window.bayFloor.roofs.find(r=>r.id==='${roofId}')`)
  assert.equal(roof.heightOffset,-0.3);assert.equal(roof.fitSupportingWalls,true);assert.equal(roof.clipsGeometry,false)
  assert.equal(await evaluate('JSON.stringify(window.bayFloor.walls)'),originalWalls,'authored wall data is intact')
  const change=async(selector,value)=>{
    await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await pause(250)
  }
  await evaluate(`document.querySelector('[aria-label="Asymmetric roof sides"]').click()`)
  await pause(300)
  const planBefore=await evaluate(`JSON.stringify(window.bayStage().find('.gable-roof-profile').map(line=>line.points()))`)
  await change('[aria-label="Roof ridge offset"]','0.5')
  let asymmetric
  for(let i=0;i<80;i++){
    await pause(250);asymmetric=await snapshot()
    if(asymmetric?.roofId!==after.roofId)break
  }
  assert.ok(Math.abs(asymmetric.roofTop-after.roofTop)<1e-5,'moving the ridge keeps its height fixed')
  assert.notEqual(await evaluate(`JSON.stringify(window.bayStage().find('.gable-roof-profile').map(line=>line.points()))`),planBefore,
    'the plan profile follows the offset ridge')
  const eaves=await evaluate(`['1','2'].map(side=>parseFloat(document.querySelector('[aria-label="Side '+side+' eave height"]').textContent))`)
  assert.ok(Math.abs(eaves[1]-2.1)<0.011,'the shorter side stays mounted at the offset wall height')
  assert.ok(eaves[0]<eaves[1],'the longer side can descend below the mount')
  await change('[aria-label="Roof mounted side"]','free')
  const freeEaves=await evaluate(`['1','2'].map(side=>parseFloat(document.querySelector('[aria-label="Side '+side+' eave height"]').textContent))`)
  assert.ok(Math.abs(freeEaves[1]-freeEaves[0]-Math.tan(28*Math.PI/180))<0.011,'free eaves retain equal pitches')
  assert.equal(await evaluate(`window.bayFloor.roofs.find(r=>r.id==='${roofId}').mountSide`),'free')
  await change('[aria-label="Roof mounted side"]','auto')
  const roofTargetId='b46c5b90-ecdc-4d0f-a6a5-976b793c7270'
  await change('[aria-label="Match roof ridge height"]',roofTargetId)
  let linked,target
  for(let i=0;i<80;i++){
    await pause(250);linked=await snapshot();target=await snapshot(roofTargetId)
    if(linked&&target&&Math.abs(linked.roofTop-target.roofTop)<1e-5)break
  }
  assert.ok(Math.abs(linked.roofTop-target.roofTop)<1e-5,'linked ridge matches the other roof in live 3D')
  assert.equal(await evaluate(`document.querySelector('[aria-label="Roof ridge height"]').disabled`),true)
  const targetBefore=target
  await evaluate(`window.baySelectRoof('${roofTargetId}')`)
  await pause(300)
  await change('[aria-label="Selected roof settings"] .roof-pitch-field input[min="1"][max="75"]','30')
  for(let i=0;i<80;i++){
    await pause(250);linked=await snapshot();target=await snapshot(roofTargetId)
    if(linked&&target&&Math.abs(linked.roofTop-target.roofTop)<1e-5&&target.roofTop>targetBefore.roofTop+0.1)break
  }
  assert.ok(target.roofTop>targetBefore.roofTop+0.1,'the receiving roof pitch changes its ridge height')
  assert.ok(Math.abs(linked.roofTop-target.roofTop)<1e-5,'the linked ridge follows subsequent target edits')
  await evaluate(`window.baySelectRoof('${roofId}')`)
  await pause(300)
  await change('[aria-label="Match roof ridge height"]','')
  assert.equal(await evaluate(`document.querySelector('[aria-label="Roof ridge height"]').disabled`),false)
  await pause(300)
  assert.ok(Math.abs((await snapshot()).roofTop-linked.roofTop)<1e-5,'unlinking preserves the matched height')
  await change('[aria-label="Roof ridge height"]','1.9')
  let manual
  for(let i=0;i<80;i++){
    await pause(250);manual=await snapshot()
    if(manual&&Math.abs(manual.roofTop-7)<1e-5)break
  }
  assert.ok(Math.abs(manual.roofTop-7)<1e-5,'manual ridge height updates live above this floor wall datum')
  assert.equal(await evaluate(`document.querySelector('[aria-label="Roof ridge height"]').value`),'1.9','numeric fields suppress floating-point noise')
  assert.equal(await evaluate('JSON.stringify(window.bayFloor.walls)'),originalWalls)
  await evaluate(`(()=>{const s=window.bayScene();s.setFrameloop('never');s.camera.position.set(16,10,17);
    s.camera.lookAt(3,5.2,10);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync('.tmp-roof-asymmetric.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Live roof height, asymmetric ridge, linked/manual height and supporting wall fitting passed',{before,after,asymmetric,linked,manual})
}finally{ws?.close();child.kill()}
