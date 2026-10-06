// With Vite on port 5180: node tests/browser/roofChamferRegression.mjs
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
  const roofId = 'b46c5b90-ecdc-4d0f-a6a5-976b793c7270'
  await evaluate(`window.baySelectRoof('${roofId}')`)
  await pause(500)
  const change = async (label, value) => {
    await evaluate(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await pause(500)
  }
  await evaluate(`(()=>{const el=document.querySelectorAll('.roof-chamfer-fields input[type="checkbox"]')[1];if(!el.checked)el.click()})()`)
  await pause(500)
  for (const angle of ['28', '60']) {
    await change('Chamfer end B angle', angle)
    await change('Chamfer end B setback', '100')
    const state = await evaluate(`(async()=>{
      const {resolveBuildingRoofs}=await import('/src/roofBuildingGeometry.ts');
      const {getGableChamferLimits}=await import('/src/roofProfile.ts');
      const {roofToLocal}=await import('/src/roofJunctions.ts');
      const candidate=resolveBuildingRoofs([window.bayFloor]).find(r=>r.roof.id==='${roofId}');
      const r=candidate.resolved, input=document.querySelector('[aria-label="Chamfer end B setback"]');
      const bad=r.exteriorFaces.flat().map(p=>roofToLocal(r.roof,r.elevation,p)).filter(p=>!p.every(Number.isFinite));
      return {maximum:Number(input.max),value:Number(input.value),stored:window.bayFloor.roofs.find(r=>r.id==='${roofId}').ridgeEndChamfer.distance,
        effective:getGableChamferLimits(r.roof,r.extents).ridgeEndChamfer.distance,bad:bad.length,
        depth:r.extents.maxY-r.extents.minY,
        notice:input.closest('.roof-chamfer-values').textContent};
    })()`)
    assert.ok(state.maximum > 0 && state.maximum < 100)
    assert.ok(Math.abs(state.maximum - state.depth) < 1e-6, 'only roof length limits a single chamfer')
    assert.ok(Math.abs(state.stored - state.maximum) < 1e-6, 'editing clamps the saved setback')
    assert.ok(Math.abs(state.value - state.stored) < 1e-6, 'the field shows the rendered setback')
    assert.ok(Math.abs(state.effective - state.stored) < 1e-6)
    assert.ok(state.notice.includes('Maximum'))
    assert.equal(state.bad, 0)
    console.log('Chamfer angle', angle, state)
  }
  await change('Chamfer end B angle', '33')
  await change('Chamfer end B setback', '4.25')
  await evaluate(`(()=>{const el=document.querySelector('[aria-label="Fit supporting walls to roof"]');if(!el.checked)el.click()})()`)
  await pause(1500)
  const deep = await evaluate(`(async()=>{
    const {resolveBuildingRoofs}=await import('/src/roofBuildingGeometry.ts');
    const {getPitchedRoofHeightAtX}=await import('/src/roofProfile.ts');
    const {roofToLocal}=await import('/src/roofJunctions.ts');
    const roof=window.bayFloor.roofs.find(r=>r.id==='${roofId}');
    const r=resolveBuildingRoofs([window.bayFloor]).find(r=>r.roof.id===roof.id).resolved;
    const points=r.faces.flat().map(p=>roofToLocal(r.roof,r.elevation,p));
    const lowered=points.filter(([x,y,z])=>Math.abs(z-r.extents.maxY)<1e-7 &&
      y<getPitchedRoofHeightAtX(r.roof,r.support,x)-0.01);
    return {setback:roof.ridgeEndChamfer.distance,fit:roof.fitSupportingWalls,lowered:lowered.length,
      value:Number(document.querySelector('[aria-label="Chamfer end B setback"]').value)};
  })()`)
  assert.equal(deep.setback,4.25)
  assert.equal(deep.value,4.25)
  assert.equal(deep.fit,true)
  assert.ok(deep.lowered>0, 'a setback beyond the old limit lowers the chamfer perimeter')
  console.log('Deep fitted chamfer',deep)
  await evaluate(`(()=>{const s=window.bayScene();s.setFrameloop('never');s.camera.position.set(-4,8,18);
    s.camera.lookAt(2,5,13);s.camera.updateMatrixWorld();s.gl.render(s.scene,s.camera)})()`)
  writeFileSync('.tmp-roof-chamfer-limit.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Live chamfer setback limits passed')
} finally { ws?.close(); child.kill() }
