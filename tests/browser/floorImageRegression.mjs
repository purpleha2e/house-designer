// With Vite running on port 5180: node tests/browser/floorImageRegression.mjs
// Checks independent floor images and their overlay in both views.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,850',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'object-handles-'))}`, 'about:blank',
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
  await call('Page.navigate', { url: 'http://127.0.0.1:5180/tests/browser/objectHandlesRegression.html' })
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return
      await pause(150)
    }
    throw new Error(`Timed out: ${expression}`)
  }
  await waitFor('!!window.handleStage?.() && !!window.handleThreeScene?.()')
  await evaluate(`(() => {
    const image = color => {
      const c=document.createElement('canvas');c.width=80;c.height=80;
      const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,80,80);
      return {dataUrl:c.toDataURL(),name:color+'.png',position:{x:1,y:1},width:4,length:4,opacity:0.5,visible:true};
    };
    const floor=(id,elevation,color)=>({id,name:id,elevation,roomHeight:2.4,slabThickness:0.2,
      models:[],roofs:[],rooms:[],groundImage:color?image(color):undefined,
      walls:[[[0,0],[6,0]],[[6,0],[6,6]],[[6,6],[0,6]],[[0,6],[0,0]]].map(([a,b],i)=>({
        id:id+'-wall-'+i,start:{x:a[0],y:a[1]},end:{x:b[0],y:b[1]},height:2.4,thickness:0.2,kind:'external',openings:[]}))});
    window.handleSetFloors([floor('floor',0,'#ff0000'),floor('upper',2.6,'#0000ff'),floor('empty',5.2)]);
    window.handleSelectModel(null);window.handleSetShowAllFloors(true);
  })()`)
  const read = () => evaluate(`(() => {
    const stage=window.handleStage(), images=stage.find('.ground-image');
    const scene=window.handleThreeScene().scene, meshes=[];
    scene.traverse(o=>{if(o.userData.houseDesignerRole==='floor-image')meshes.push({floor:o.userData.floorId,
      y:o.position.y,opacity:o.material.opacity,depthWrite:o.material.depthWrite,depthTest:o.material.depthTest})});
    const node=images[0],p=node?.getAbsoluteTransform().point({x:60,y:60});
    const sample=p?Array.from(stage.toCanvas().getContext('2d').getImageData(Math.round(p.x),Math.round(p.y),1,1).data):null;
    return {active:window.handleFloor.id,count:images.length,image:node?.image().src,opacity:node?.opacity(),
      listening:node?.getLayer().listening(),meshes,sample};
  })()`)
  const ready = id => waitFor(`window.handleFloor.id==='${id}' && window.handleStage().find('.ground-image').length===1 &&
    window.handleThreeScene().scene.getObjectByName('ground-image-3d')?.userData.floorId==='${id}'`)
  await ready('floor')
  const lower=await read()
  assert.equal(lower.count,1);assert.equal(lower.meshes.length,1)
  assert.equal(lower.meshes[0].floor,'floor');assert.equal(lower.opacity,0.5)
  assert.equal(lower.listening,false,'reference image must not block room selection or drawing')
  assert.equal(lower.meshes[0].depthWrite,false);assert.equal(lower.meshes[0].depthTest,true)
  assert.ok(lower.sample[0]>lower.sample[2]+70,'red reference image is visible above the room fill')
  assert.ok(lower.sample[1]>30,'the underlying floor remains visible through the image')
  await evaluate("window.handleSetActiveFloor('upper')")
  await ready('upper')
  const upper=await read()
  assert.equal(upper.count,1);assert.equal(upper.meshes.length,1)
  assert.equal(upper.meshes[0].floor,'upper');assert.equal(upper.meshes[0].opacity,0.5)
  assert.ok(upper.meshes[0].y>2.612,'image sits above the upper-floor finish')
  assert.notEqual(upper.image,lower.image)
  assert.ok(upper.sample[2]>upper.sample[0]+70,'only the active floor image appears over its room')
  // Measure the rendered 3D overlay above an actual room floor, with opacity
  // on and off. A below-floor image would leave the sampled pixel unchanged.
  await evaluate(`(() => {
    const s=window.handleThreeScene();s.setFrameloop('never');
    s.camera.position.set(3,4.8,3);s.camera.lookAt(3,2.6,3);s.camera.updateMatrixWorld();
  })()`)
  const pixel=async opacity=>evaluate(`(() => {
    const s=window.handleThreeScene(),m=s.scene.getObjectByName('ground-image-3d');m.material.opacity=${opacity};
    s.gl.render(s.scene,s.camera);const gl=s.gl.getContext(),p=new Uint8Array(4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);
    return Array.from(p);
  })()`)
  const floorPixel=await pixel(0),imagePixel=await pixel(0.5)
  assert.ok(imagePixel[2]>imagePixel[0]+30,'blue overlay is visibly rendered over the upper floor')
  assert.ok(Math.abs(imagePixel[0]-floorPixel[0])>20,'translucent image changes the actual floor pixel')
  await evaluate("window.handleThreeScene().setFrameloop('always')")
  await evaluate(`(() => {
    document.querySelector('[aria-label="Project menu"]').click();
  })()`)
  await waitFor("!!document.querySelector('.ground-image-controls > button')")
  await evaluate("document.querySelector('.ground-image-controls > button').click()")
  await waitFor("!!document.querySelector('[aria-label=\"Floor image opacity\"]')")
  await evaluate(`(() => {
    const el=document.querySelector('[aria-label="Floor image opacity"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'30');
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await waitFor('window.handleFloor.groundImage.opacity===0.3')
  const saved=await evaluate('JSON.parse(JSON.stringify(window.handleFloors))')
  assert.equal(saved[0].groundImage.opacity,0.5)
  assert.equal(saved[1].groundImage.opacity,0.3)
  await evaluate("window.handleSetActiveFloor('empty')")
  await waitFor("window.handleFloor.id==='empty' && !window.handleStage().findOne('.ground-image') && !window.handleThreeScene().scene.getObjectByName('ground-image-3d')")
  await evaluate(`window.handleSetFloors(${JSON.stringify(saved)});window.handleSetActiveFloor('floor')`)
  await ready('floor')
  assert.equal((await read()).image,lower.image,'save/load preserves the independent embedded image')
  await waitFor("!!document.querySelector('[aria-label=\"Images\"]')")
  const imagesBeforeToggle=await evaluate('JSON.stringify(window.handleFloors)')
  const toggleImages=()=>evaluate("document.querySelector('[aria-label=\"Images\"]').click()")
  const hidden="!window.handleStage().findOne('.ground-image') && !window.handleStage().findOne('.ground-image-handles') && !window.handleThreeScene().scene.getObjectByName('ground-image-3d')"
  await toggleImages()
  await waitFor(hidden)
  await evaluate("window.handleSetActiveFloor('upper')")
  await waitFor("window.handleFloor.id==='upper'")
  assert.equal(await evaluate(hidden),true,'the shared toggle remains off when switching floors')
  assert.equal(await evaluate('JSON.stringify(window.handleFloors)'),imagesBeforeToggle,'toggling does not change saved images or their individual visibility')
  await toggleImages()
  await ready('upper')
  assert.equal((await read()).opacity,0.3,'restoring images preserves opacity')
  await evaluate("document.querySelector('.ground-image-controls > button').click()")
  await waitFor("!!document.querySelector('.ground-image-menu button[aria-pressed]')")
  await evaluate("document.querySelector('.ground-image-menu button[aria-pressed]').click()")
  await waitFor("!!window.handleStage().findOne('.ground-image-handles')")
  await toggleImages()
  await waitFor(hidden)
  await toggleImages()
  await ready('upper')
  assert.equal(await evaluate("!!window.handleStage().findOne('.ground-image-handles')"),false,'hiding images exits image editing')
  writeFileSync('.tmp-floor-image-layers.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  console.log('Independent floor images, shared 2D/3D toggle, active-floor isolation, translucent overlays, edits and save/load passed',
    {lower:lower.sample,upper:upper.sample,floorPixel,imagePixel})
} finally { ws?.close(); child.kill() }
