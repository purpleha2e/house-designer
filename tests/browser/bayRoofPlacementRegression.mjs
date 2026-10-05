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
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/bayRoofPlacementRegression.html'})
  for(let i=0;i<60;i++){await pause(500);if(await evaluate('!!window.bayStage?.() && !!window.bayScene?.()'))break}
  assert.ok(await evaluate('!!window.bayStage?.()'))
  const change=async(selector,value)=>{
    await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await pause(200)
  }
  await change('.roof-tool-flyout select','bay')
  assert.equal(await evaluate(`document.querySelector('[aria-label="Bay roof ridge length"]').value`),'0.5')
  const screen=point=>evaluate(`(()=>{const s=window.bayStage(),r=s.container().getBoundingClientRect();
    return {x:r.left+s.x()+${point.x}*60*s.scaleX(),y:r.top+s.y()+${point.y}*60*s.scaleY()}})()`)
  const move=async(point,modifiers=0)=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',...await screen(point),modifiers});await pause(120)}
  const click=async point=>{
    await move(point)
    const p=await screen(point)
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1})
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1})
    await pause(180)
  }
  const guides=()=>evaluate(`(()=>{const s=window.bayStage();return {
    vertical:s.find('.roof-placement-guide-vertical').length,horizontal:s.find('.roof-placement-guide-horizontal').length,
    active:s.find('.roof-placement-guide-vertical').filter(line=>!line.dash()?.length).length}})()`)
  await click({x:1,y:1})
  assert.deepEqual(await guides(),{vertical:1,horizontal:1,active:1})
  await move({x:1.04,y:3})
  assert.equal(await evaluate("window.bayStage().findOne('.roof-hover-wall-anchor').x()/60"),1,
    'a free point aligns exactly to the selected mounting point')
  await move({x:1.04,y:3},2)
  assert.ok(Math.abs(await evaluate("window.bayStage().findOne('.roof-hover-wall-anchor').x()/60")-1.04)<1e-6,
    'Ctrl bypasses guide snapping')
  await click({x:1.04,y:3})
  assert.equal((await guides()).horizontal,2,'a click records the aligned free point')
  await click({x:1,y:3})
  assert.equal((await guides()).horizontal,1,'deselecting a mount point clears its guide')
  for(const p of [{x:5,y:1},{x:5,y:2},{x:4,y:4},{x:2,y:4},{x:1,y:2}])await click(p)
  assert.ok(await evaluate('!!window.bayPreview'))
  await change('[aria-label="Bay roof ridge length"]','1.2')
  assert.equal(await evaluate('window.bayPreview.roof.bayRidgeLength'),1.2)
  writeFileSync('.tmp-bay-roof-guides.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  const shell=()=>evaluate(`(()=>{let mesh;window.bayScene().scene.traverse(o=>{
    if(o.userData.houseDesignerRole==='roof-placement-preview')mesh=o});return mesh?{uuid:mesh.geometry.uuid,count:mesh.geometry.attributes.position.count}:null})()`)
  for(let i=0;i<40;i++){await pause(150);if(await shell())break}
  const before=await shell()
  assert.ok(before,'the bay roof has a live 3D preview')
  await change('[aria-label="Bay roof ridge length"]','0.7')
  for(let i=0;i<40;i++){await pause(150);if((await shell())?.uuid!==before.uuid)break}
  assert.notEqual((await shell()).uuid,before.uuid,'ridge changes rebuild the live roof')
  await change('[aria-label="Roof vertical offset"]','-0.15')
  await evaluate(`document.querySelector('[aria-label="Fit supporting walls to roof"]').click()`)
  await pause(200)
  assert.equal(await evaluate('window.bayPreview.roof.heightOffset'),-0.15)
  assert.equal(await evaluate('window.bayPreview.roof.fitSupportingWalls'),true)
  await evaluate(`(()=>{const button=[...document.querySelectorAll('.roof-placement-actions button')].find(b=>b.textContent.includes('Create'));if(!button||button.disabled)throw new Error('Cannot create bay');button.click()})()`)
  await pause(400)
  assert.equal(await evaluate('window.bayFloor.roofs[0].bayRidgeLength'),0.7)
  assert.equal(await evaluate('window.bayFloor.roofs[0].heightOffset'),-0.15)
  assert.equal(await evaluate('window.bayFloor.roofs[0].fitSupportingWalls'),true)
  assert.equal((await guides()).vertical,0,'creating the roof clears mounting guides')
  await evaluate("window.bayRoofMode(false);window.baySelectRoof('created-bay')")
  await pause(400)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Bay roof ridge length"]').value`),'0.7')
  await change('[aria-label="Bay roof ridge length"]','1.1')
  assert.equal(await evaluate('window.bayFloor.roofs[0].bayRidgeLength'),1.1)
  await evaluate(`(()=>{const s=window.bayScene();s.setFrameloop('never');s.camera.position.set(7,6,8);s.camera.lookAt(3,2.4,2);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync('.tmp-bay-roof-placement.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Bay ridge placement, live 3D preview, selected settings, guide snapping and Ctrl bypass passed')
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/bayRoofPlacementRegression.html?lean-to'})
  for(let i=0;i<60;i++){await pause(500);if(await evaluate(`window.bayFloor?.id==='a5e1058b-f220-4fef-9e1f-5cb871e2e0c5' && !!window.bayStage?.() && !!window.bayScene?.() && !!document.querySelector('.roof-tool-flyout select')`))break}
  await pause(1500)
  await change('.roof-tool-flyout select','lean-to')
  for(const point of [{x:-0.4771028,y:4.901592949},{x:1.7305522,y:4.901592949},{x:1.7305522,y:10.160690667}])await click(point)
  const leanPreview=await evaluate('window.bayPreview?.roof')
  assert.ok(leanPreview && leanPreview.supportWidth>2 && leanPreview.supportWidth<2.2,
    'crossing end walls cannot collapse the mounting span at its corners')
  assert.ok(Math.abs(leanPreview.rotation)<1e-6,'the high edge must attach to the upper-storey facade')
  await pause(500)
  const previewArea=await evaluate(`(()=>{let area=0;window.bayScene().scene.traverse(o=>{
    if(o.userData.houseDesignerRole!=='roof-placement-preview')return;
    const p=o.geometry.attributes.position;for(let i=0;i<p.count;i+=3){
      area+=Math.abs((p.getX(i+1)-p.getX(i))*(p.getZ(i+2)-p.getZ(i))-(p.getZ(i+1)-p.getZ(i))*(p.getX(i+2)-p.getX(i)))/2
    }});return area})()`)
  assert.ok(previewArea>10,`the complete lean-to panel remains visible rather than an eave strip: ${previewArea}`)
  await change('[aria-label="Roof vertical offset"]','-0.1')
  await evaluate(`document.querySelector('[aria-label="Fit supporting walls to roof"]').click()`)
  await pause(200)
  await evaluate(`(()=>{const button=[...document.querySelectorAll('.roof-placement-actions button')].find(b=>b.textContent.includes('Create'));button.click()})()`)
  await pause(500)
  const created=await evaluate("window.bayFloor.roofs.find(roof=>roof.id==='created-lean-to')")
  assert.equal(created.rotation,leanPreview.rotation)
  assert.equal(created.supportWidth,leanPreview.supportWidth)
  assert.equal(created.heightOffset,-0.1)
  assert.equal(created.fitSupportingWalls,true)
  console.log('Stacked-storey lean-to mounts to the correct facade and retains its full width', {previewArea})
  await call('Page.navigate',{url:'http://127.0.0.1:5180/tests/browser/bayRoofPlacementRegression.html?asymmetric-create'})
  for(let i=0;i<60;i++){await pause(250);if(await evaluate(`window.bayFloor?.id==='gable-floor' && !!window.bayStage?.() && !!window.bayScene?.() && !!document.querySelector('[aria-label="Asymmetric roof sides"]')`))break}
  for(const point of [{x:1,y:1},{x:5,y:1},{x:5,y:4},{x:1,y:4}])await click(point)
  await evaluate(`document.querySelector('[aria-label="Asymmetric roof sides"]').click()`)
  await pause(250)
  await change('[aria-label="Roof ridge offset"]','0.5')
  await change('[aria-label="Match roof ridge height"]','height-target')
  await evaluate(`document.querySelector('[aria-label="Fit supporting walls to roof"]').click()`)
  await pause(400)
  const asymmetricPreview=await evaluate('window.bayPreview?.roof')
  assert.equal(asymmetricPreview.asymmetricSides,true)
  assert.equal(asymmetricPreview.ridgeOffset,0.5)
  assert.equal(asymmetricPreview.ridgeHeightTargetRoofId,'height-target')
  assert.equal(asymmetricPreview.fitSupportingWalls,true)
  const liveBefore=await shell()
  assert.ok(liveBefore?.count>0,'asymmetric creation has a complete live 3D preview')
  await change('[aria-label="Roof ridge offset"]','0.65')
  for(let i=0;i<40;i++){await pause(150);if((await shell())?.uuid!==liveBefore.uuid)break}
  assert.notEqual((await shell()).uuid,liveBefore.uuid,'creation preview follows ridge movement')
  await evaluate(`(()=>{const button=[...document.querySelectorAll('.roof-placement-actions button')].find(b=>b.textContent.includes('Create'));button.click()})()`)
  await pause(500)
  const gable=await evaluate("window.bayFloor.roofs.find(roof=>roof.id==='created-gable')")
  assert.equal(gable.asymmetricSides,true);assert.equal(gable.ridgeOffset,0.65)
  assert.equal(gable.ridgeHeightTargetRoofId,'height-target');assert.equal(gable.fitSupportingWalls,true)
  await evaluate("window.bayRoofMode(false);window.baySelectRoof('created-gable')")
  await pause(300)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Roof ridge offset"]').value`),'0.65')
  assert.equal(await evaluate(`document.querySelector('[aria-label="Match roof ridge height"]').value`),'height-target')
  console.log('Asymmetric gable creation, live preview and persisted ridge settings passed')
}finally{ws?.close();child.kill()}
