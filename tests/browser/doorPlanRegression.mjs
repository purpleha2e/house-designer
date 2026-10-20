// With Vite running: node tests/browser/doorPlanRegression.mjs [port]
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,950',
  `--user-data-dir=${createBrowserTestProfile('door-plan-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
    child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data), request = pending.get(result.id)
    if (request) {
      pending.delete(result.id)
      result.error ? request.reject(result.error) : request.resolve(result.result)
    }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
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
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  await call('Runtime.enable')
  await call('Page.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? '5186'}/tests/browser/objectHandlesRegression.html` })
  for (let i = 0; i < 600; i++) {
    if (await evaluate('!!window.handleRegisterModels')) break
    assert.deepEqual(errors, [])
    await pause(100)
  }
  await evaluate(`(() => {
    document.getElementById('root').style.gridTemplateColumns = '1fr';
    document.querySelectorAll('.editor-pane')[1].style.display = 'none';
    const base = {category:'Doors',shape:'box',color:'#64748b',width:.9,height:2.1,depth:.13,wallMount:'interior-door'};
    handleRegisterModels([
      {...base,id:'plan-single',name:'Single internal door',doorLeafCount:1},
      {...base,id:'plan-double',name:'Interior double doors open',width:1.8},
      {...base,id:'plan-window',name:'400 mm window with a very long name',wallMount:'window',width:.8,depth:.04},
      {...base,id:'plan-light',name:'Point Light',wallMount:undefined,shape:'light',isLight:true,width:.25,depth:.25}
    ]);
    handleSelectModel(null);
    handleSetFloor(f => ({...f,walls:[
      {id:'single-wall',start:{x:1,y:2},end:{x:5,y:2},height:2.4,thickness:.2,kind:'internal',openings:[{id:'single',modelId:'plan-single',center:2,width:.9,height:2.1,bottom:0}]},
      {id:'double-wall',start:{x:6,y:2},end:{x:11,y:2},height:2.4,thickness:.2,kind:'internal',openings:[{id:'double',modelId:'plan-double',center:2.5,width:1.8,height:2.1,bottom:0}]},
      {id:'turned-wall',start:{x:3,y:5},end:{x:3,y:9},height:2.4,thickness:.2,kind:'internal',openings:[{id:'turned',modelId:'plan-single',center:2,width:.9,height:2.1,bottom:0}]},
      {id:'flipped-wall',start:{x:6,y:7},end:{x:11,y:7},height:2.4,thickness:.2,kind:'internal',openings:[{id:'flipped',modelId:'plan-double',center:2.5,width:1.8,height:2.1,bottom:0}]}
    ],models:[
      {id:'single',modelId:'plan-single',position:{x:3,y:2},rotation:0,scale:1,wallAttachment:{wallId:'single-wall',offset:2}},
      {id:'double',modelId:'plan-double',position:{x:8.5,y:2},rotation:0,scale:1,wallAttachment:{wallId:'double-wall',offset:2.5}},
      {id:'turned',modelId:'plan-single',position:{x:3,y:7},rotation:Math.PI/2,scale:1,mirrored:true,wallAttachment:{wallId:'turned-wall',offset:2}},
      {id:'flipped',modelId:'plan-double',position:{x:8.5,y:7},rotation:0,scale:1,flipped:true,wallAttachment:{wallId:'flipped-wall',offset:2.5}},
      {id:'window',modelId:'plan-window',position:{x:6,y:4.5},rotation:0,scale:1},
      {id:'light',modelId:'plan-light',position:{x:10,y:4.5},rotation:0,scale:1}
    ]}));
  })()`)
  await pause(500)
  const inspect = () => evaluate(`(() => {
    const stage = handleStage();
    return {
      scale:stage.scaleX(),
      doors:stage.find('.door-plan-symbol').map(door => ({
        leaves:door.find('.door-leaf').map(leaf => ({height:leaf.height(),width:leaf.width()})),
        swings:door.find('.door-swing').length,
        jambs:door.find('.door-jamb').length,
        thresholds:door.find('.door-threshold').length,
        maskHeight:door.findOne('.door-opening-mask').height(),
        widths:door.find(n => typeof n.stroke === 'function' && n.stroke()).map(n => n.strokeWidth() * (n.strokeScaleEnabled() ? Math.abs(n.getAbsoluteScale().x) : 1))
      })),
      whiteLabels:stage.find('Text').filter(n => ['white','#fff','#ffffff'].includes(n.fill())).map(n => n.text())
    };
  })()`)
  const before = await inspect()
  const windowFrame = await evaluate(`(() => {
    const frame = handleStage().findOne('.window-frame');
    return {ratio:frame.height()/frame.width(),radius:frame.cornerRadius()};
  })()`)
  assert.ok(Math.abs(windowFrame.ratio - .04/.8) < 1e-6, 'window depth follows the model below the old 100 mm minimum')
  assert.equal(windowFrame.radius, 0, 'windows have square corners')
  assert.deepEqual(before.doors.map(door => door.leaves.length), [1, 2, 1, 2])
  assert.deepEqual(before.doors.map(door => door.swings), [1, 2, 1, 2])
  assert.ok(before.doors.every(door => door.jambs === 2 && door.thresholds === 1))
  // Each double leaf spans half the opening, rather than one oversized swing.
  assert.ok(Math.abs(before.doors[0].leaves[0].height - before.doors[1].leaves[0].height) < 3)
  assert.deepEqual(before.whiteLabels, [])
  const target = await evaluate(`(() => {
    const leaf = handleStage().findOne('.door-leaf');
    const p = leaf.getAbsoluteTransform().point({x:leaf.width()/2,y:leaf.height()/2});
    const bounds = handleStage().container().getBoundingClientRect();
    return {x:p.x+bounds.left,y:p.y+bounds.top};
  })()`)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', clickCount: 1 })
  for (let i = 0; i < 20; i++) {
    if (await evaluate('handleSelection') === 'single') break
    await pause(100)
  }
  assert.equal(await evaluate('handleSelection'), 'single', 'door leaves remain selectable')
  await evaluate('handleSelectModel(null)')
  await pause(100)
  writeFileSync('node_modules/.cache/door-plan.png', Buffer.from((await call('Page.captureScreenshot', { format:'png' })).data, 'base64'))
  for (let i = 0; i < 3; i++) {
    await evaluate(`document.querySelector('[aria-label="Zoom in"]').click()`)
    await pause(50)
  }
  const after = await inspect()
  assert.ok(after.scale > before.scale)
  assert.deepEqual(after.doors.map(door => door.widths), before.doors.map(door => door.widths))

  // A 45-degree window must not erase room fill beside the wall. Compare real
  // canvas pixels with and without its wall opening, rather than just props.
  await evaluate(`(() => {
    document.querySelector('[aria-label="Reset zoom"]').click();
    const points = [{x:2,y:5},{x:6,y:9},{x:10,y:5},{x:6,y:1}];
    handleSetFloor(f => ({...f,models:[],walls:points.map((start,i) => ({
      id:'bay-'+i,start,end:points[(i+1)%4],kind:'external',height:2.4,thickness:.4
    }))}));
  })()`)
  await pause(300)
  const sampleRoom = () => evaluate(`(() => {
    const stage = handleStage(), canvas = stage.toCanvas({pixelRatio:1}), ctx = canvas.getContext('2d');
    return [-.4,0,.4].map(offset => {
      const point = stage.getAbsoluteTransform().point({x:(4+(offset+.225)/Math.SQRT2)*60,y:(7+(offset-.225)/Math.SQRT2)*60});
      return [...ctx.getImageData(Math.round(point.x),Math.round(point.y),1,1).data];
    });
  })()`)
  const roomBefore = await sampleRoom()
  assert.ok(roomBefore.some(pixel => pixel[0] !== pixel[1] || pixel[1] !== pixel[2]), 'sample a coloured room')
  await evaluate(`handleSetFloor(f => ({...f,walls:f.walls.map((w,i) => i ? w : {...w,openings:[{
    id:'angled-window',modelId:'plan-window',center:Math.sqrt(8),width:1.6,height:1.2,bottom:.9
  }]}),models:[{id:'angled-window',modelId:'plan-window',position:{x:4,y:7},rotation:Math.PI/4,
    scale:1,widthScale:2,depthScale:1.5,wallAttachment:{wallId:'bay-0',offset:Math.sqrt(8)}}]}))`)
  await pause(300)
  assert.deepEqual(await sampleRoom(), roomBefore, 'the angled opening preserves adjacent room-colour pixels')
  const angledFrame = await evaluate(`(() => {
    const frame = handleStage().findOne('.window-frame');
    return {width:frame.width(),depth:frame.height(),radius:frame.cornerRadius()};
  })()`)
  assert.ok(Math.abs(angledFrame.depth - .04*1.5*60) < 1e-6, 'window depth scale is respected')
  assert.equal(angledFrame.radius, 0)
  writeFileSync('node_modules/.cache/window-plan.png', Buffer.from((await call('Page.captureScreenshot', {format:'png'})).data,'base64'))
  assert.deepEqual(errors, [])
  console.log('PASS: door leaves/jambs/thresholds, selection and constant strokes; rectangular windows at model depth; angled openings preserve room-colour pixels; no white labels')
} finally {
  ws?.close()
  child.kill()
}
