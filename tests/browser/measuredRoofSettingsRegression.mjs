// With Vite on port 5180: node tests/browser/measuredRoofSettingsRegression.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1800,1000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bay-roof-'))}`, 'about:blank',
], { windowsHide: true })
let ws
const automatic = process.argv.includes('--automatic')
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
  const ids = {
    rear: '8e321618-2fa0-4ea5-99ec-8210302fe639',
    asymmetric: 'b46c5b90-ecdc-4d0f-a6a5-976b793c7270',
    front: 'b9c4f4d7-2ea6-4bc2-8b59-481280115509',
  }
  await evaluate(`(async()=>{
    const project=await(await fetch('/colin_house_v2.json')).json();
    const {normalizeFloor}=await import('/src/modelPlacement.ts');
    window.baySetFloor(normalizeFloor(project.floors[1],new Map()));
  })()`)
  await pause(750)
  const selectRoof = async id => { await evaluate(`window.baySelectRoof('${id}')`); await pause(300) }
  const change = async (label, value, select=false) => {
    await evaluate(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');
      if(!el)throw new Error('Missing '+${JSON.stringify(label)});
      Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await pause(300)
  }
  const check = async (label, checked) => {
    await evaluate(`(()=>{const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');
      if(el.checked!==${checked})el.click()})()`)
    await pause(300)
  }
  await selectRoof(ids.rear)
  await change('Roof pitch',29)
  await check('Match overhang to roof pitch',true)
  await selectRoof(ids.asymmetric)
  await check('Asymmetric roof sides',true)
  await change('Roof pitch',33)
  await change('Roof mounted side','free',true)
  await change('Match roof ridge height',ids.rear,true)
  if (automatic) {
    await change('Roof height alignment','side1',true)
    await change('Roof alignment target',ids.rear,true)
  } else await change('Roof ridge offset',-0.428765)
  await check('Fit supporting walls to roof',true)
  await check('Match overhang to roof pitch',true)
  await change('Chamfer end B angle',33)
  if (automatic) await check('Match chamfer end B eave',true)
  else await change('Chamfer end B setback',3.018032)
  await selectRoof(ids.front)
  await change('Roof pitch',33)
  if (automatic) {
    await change('Roof height alignment','slope',true)
    await change('Roof alignment target',ids.asymmetric,true)
  } else await change('Roof vertical offset',0.019020)
  await check('Match overhang to roof pitch',true)
  const result = await evaluate(`(async()=>{
    const expected=await(await fetch('/colin_house_v2_measured_roofs.json')).json();
    const {resolveBuildingRoofs}=await import('/src/roofBuildingGeometry.ts');
    const {getPitchedRoofSideSlope}=await import('/src/roofProfile.ts');
    const actualRoofs=resolveBuildingRoofs([window.bayFloor]);
    const expectedRoofs=resolveBuildingRoofs([expected.floors[1]]);
    const ids=${JSON.stringify(ids)};
    return Object.values(ids).map(id=>{
      const actual=actualRoofs.find(r=>r.roof.id===id),target=expectedRoofs.find(r=>r.roof.id===id);
      const actualPoints=actual.resolved.faces.flat(),targetPoints=target.resolved.faces.flat();
      const error=Math.max(...actualPoints.map(p=>Math.min(...targetPoints.map(q=>Math.hypot(...p.map((v,i)=>v-q[i]))))),
        ...targetPoints.map(p=>Math.min(...actualPoints.map(q=>Math.hypot(...p.map((v,i)=>v-q[i]))))));
      return {id,error,pitch:actual.roof.pitchDegrees,mode:actual.roof.mountSide,
        offset:actual.roof.ridgeOffset,heightOffset:actual.roof.heightOffset,
        chamfer:actual.roof.ridgeEndChamfer,
        sidePitches:[actual.resolved.support.minX,actual.resolved.support.maxX].map(x=>
          Math.atan(getPitchedRoofSideSlope(actual.roof,actual.resolved.support,x))*180/Math.PI)};
    });
  })()`)
  for(const roof of result)assert.ok(roof.error<0.00001,`UI settings reproduce the measured geometry within 0.01 mm: ${JSON.stringify(roof)}`)
  const asymmetric=result.find(r=>r.id===ids.asymmetric)
  assert.equal(asymmetric.mode,'free')
  asymmetric.sidePitches.forEach(p=>assert.ok(Math.abs(p-33)<1e-8))
  await selectRoof(ids.asymmetric)
  assert.ok(await evaluate(`document.querySelector('[aria-label="Roof mounted side"]').selectedOptions[0].textContent.includes('Keep both side pitches')`))
  if (automatic) {
    assert.equal(await evaluate(`document.querySelector('[aria-label="Roof ridge offset"]').disabled`),true)
    assert.equal(await evaluate(`document.querySelector('[aria-label="Chamfer end B setback"]').disabled`),true)
    await selectRoof(ids.front)
    assert.equal(await evaluate(`document.querySelector('[aria-label="Roof vertical offset"]').disabled`),true)
    const before=await evaluate(`Number(document.querySelector('[aria-label="Roof vertical offset"]').value)`)
    await selectRoof(ids.rear)
    await change('Roof pitch',30)
    await selectRoof(ids.front)
    const after=await evaluate(`Number(document.querySelector('[aria-label="Roof vertical offset"]').value)`)
    assert.ok(Math.abs(before-after)>0.001,'alignment follows later target pitch edits')
    await change('Roof height alignment','',true)
    const unlinked=await evaluate(`({disabled:document.querySelector('[aria-label="Roof vertical offset"]').disabled,
      offset:window.bayFloor.roofs.find(r=>r.id==='${ids.front}').heightOffset})`)
    assert.equal(unlinked.disabled,false)
    assert.ok(Math.abs(unlinked.offset-after)<1e-8,'returning to manual keeps the aligned height')
  }
  console.log('Measured roofs reproduced through the UI',result)
} finally { ws?.close(); child.kill() }
