// With Vite: node tests/browser/wallReferenceSnapRegression.mjs [port]
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${createBrowserTestProfile('wall-reference-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
    child.on('exit', code => reject(new Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (pending.has(result.id)) {
      const { resolve, reject } = pending.get(result.id)
      pending.delete(result.id)
      if (result.error) reject(result.error)
      else resolve(result.result)
    }
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
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

  await call('Page.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2]??5186}/tests/browser/objectHandlesRegression.html?basic-scene` })
  const until=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await pause(100)}throw Error(`Timed out: ${expression}`)}
  await until('!!window.handleSetFloors && !!window.handleStage?.()')
  await evaluate(`(()=>{const w=(id,x,y,x2,y2)=>({id,kind:'internal',start:{x,y},end:{x:x2,y:y2},height:2.4,thickness:.1});
    window.snapUpper={...handleFloor,elevation:2.7,models:[],walls:[w('moving',2,2.04,5,2.04),w('attached',5,2.04,5,5)]};
    window.snapLower={...handleFloor,id:'lower',elevation:0,models:[],walls:[w('below',1,2.173,6,2.173)]};
    handleSetFloors([snapLower,snapUpper]);handleSelectModel(null)})()`)
  await pause(500)
  const setting=async enabled=>{
    await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`);await pause(100)
    await evaluate(`(()=>{const c=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Snap to other floors')).querySelector('input');if(c.checked!==${enabled})c.click()})()`)
    await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`);await pause(100)
  }
  const reset=async(endpoint=false)=>{
    await evaluate(`handleSetFloor({...snapUpper,walls:${endpoint?"[{...snapUpper.walls[0],start:{x:2,y:2.5},end:{x:5,y:2.5}}]":"structuredClone(snapUpper.walls)"}})`)
    if(endpoint)await evaluate(`handleSetFloors(current=>current.map(f=>f.id==='lower'?{...snapLower,walls:[{...snapLower.walls[0],start:{x:5.173,y:1},end:{x:5.173,y:4}}]}:f))`)
    await pause(300)
  }
  const drag=async(dx,dy,modifiers=0,endpoint=false)=>{
    const p=await evaluate(`(()=>{const s=handleStage(),w=handleFloor.walls[0],r=s.container().getBoundingClientRect(),p=${endpoint?"s.find('Circle').find(n=>n.draggable()&&Math.abs(n.x()-w.end.x*60)<.01&&Math.abs(n.y()-w.end.y*60)<.01).getAbsolutePosition()":"s.getAbsoluteTransform().point({x:(w.start.x+w.end.x)*30,y:(w.start.y+w.end.y)*30})"};return{x:r.left+p.x,y:r.top+p.y}})()`)
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1,modifiers})
    for(let i=1;i<=8;i++){await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+dx*i/8,y:p.y+dy*i/8,buttons:1,modifiers});await pause(35)}
    const guide=await evaluate(`handleStage().find('Line').some(n=>n.stroke()==='#16a34a'&&n.dash()?.length===2)`)
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1,modifiers});await pause(300)
    return {walls:await evaluate('handleFloor.walls'),guide}
  }
  await setting(false)
  const off=await drag(0,8);assert.ok(Math.abs(off.walls[0].start.y-2.173)>.01,'disabled snap keeps ordinary grid movement')
  await reset();await setting(true)
  const on=await drag(0,8);assert.ok(Math.abs(on.walls[0].start.y-2.173)<1e-8,'existing wall aligns exactly with the downstairs centre line')
  assert.ok(on.guide,'a visible alignment guide confirms the reference snap')
  assert.ok(Math.abs(on.walls[1].start.y-2.173)<1e-8,'connected wall endpoint stays attached')
  assert.equal(on.walls[1].end.y,5,'the far endpoint stays in place')
  await reset();const bypass=await drag(0,8,2);assert.ok(Math.abs(bypass.walls[0].start.y-2.173)>.01,'Ctrl bypasses cross-floor snapping')
  await reset(true);const end=await drag(8,0,0,true)
  assert.ok(Math.abs(end.walls[0].end.x-5.173)<1e-8,`endpoint editing includes the other storey: ${JSON.stringify(end)}`)
  console.log(JSON.stringify({off:off.walls[0],on:on.walls[0],bypass:bypass.walls[0],endpoint:end.walls[0]}))
  console.log('PASS: Native wall translation and endpoint editing respect cross-floor snapping, connected joins and Ctrl bypass.')
} finally {ws?.close();child.kill()}
