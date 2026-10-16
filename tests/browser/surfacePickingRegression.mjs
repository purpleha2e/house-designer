import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const browser = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--no-first-run',
  '--window-size=1100,850', `--user-data-dir=${createBrowserTestProfile('surface-picking-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    browser.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    browser.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id)
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }))
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
  const savedHouse = process.argv.includes('--house')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5186}/tests/browser/roofWallRegression.html?${savedHouse ? 'colin&upper-selection' : 'lighting-startup&selection-shaders'}` })
  for (let i = 0; i < 600; i++) {
    if (errors.length) throw Error(JSON.stringify(errors))
    if (await evaluate('!!window.roofWallScene?.()?.scene.userData.progressiveStartup?.opaqueReadyMs')) break
    await pause(100)
  }
  assert.ok(await evaluate('window.roofWallScene()?.scene.userData.progressiveStartup?.opaqueReadyMs'), 'Opaque scene must become ready')
  // Inspect the registered picker, not render meshes that merely look selectable.
  console.log('targets', await evaluate(`(()=>{
    window.testTargets=window.regressionPickTargets();
    return {count:testTargets.length,kinds:testTargets.reduce((counts,t)=>{const key=t.surface?.type??t.kind;counts[key]=(counts[key]??0)+1;return counts},{})}
  })()`))
  const clickAt = async (position, target) => {
    const point = await evaluate(`(()=>{window.selectRegressionModel(null);const s=window.roofWallScene();s.camera.position.set(...${JSON.stringify(position)});s.camera.lookAt(...${JSON.stringify(target)});s.camera.updateMatrixWorld(true);const r=s.gl.domElement.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await pause(100)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await pause(100)
    return evaluate('({surface:window.regressionSurface,model:window.regressionSelectedModelId})')
  }
  const camera = await evaluate('window.roofWallScene().camera.position.toArray()')
  const wall = await clickAt(savedHouse ? camera : [4, 1.4, 2], savedHouse ? [camera[0]+4,camera[1],camera[2]] : [8, 1.4, 2])
  const floorPoints = savedHouse ? await evaluate(`(()=>{
    const s=window.roofWallScene();s.scene.updateMatrixWorld(true);
    return window.regressionPickTargets().filter(t=>t.surface?.type==='room-floor'&&t.object.isMesh).map(t=>{
      const g=t.object.geometry,p=g.attributes.position;let bestArea=0,best;
      for(let i=0;i<(g.index?.count??p.count);i+=3){const v=[0,1,2].map(j=>s.camera.position.clone().fromBufferAttribute(p,g.index?g.index.getX(i+j):i+j).applyMatrix4(t.object.matrixWorld));
        const area=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).length();if(area>bestArea){bestArea=area;best=v[0].add(v[1]).add(v[2]).divideScalar(3).toArray()}}
      return {point:best,surface:t.surface}
    }).filter(t=>t.point).slice(0,8)
  })()`) : [{point:[4,0,2]}]
  const floors=[]
  for(const sample of floorPoints){const p=sample.point;const result=await clickAt([p[0],p[1]+.65,p[2]],p);floors.push({expected:sample.surface,result,point:p})}
  const floor = floors[0].result
  console.log({ wall, floor })
  assert.ok(wall.surface?.type.startsWith('wall-'), 'Clicking a visible wall must select its surface')
  for (const {expected,result} of floors) {
    assert.equal(result.model, null, 'An unobstructed floor click must not select an object')
    assert.equal(result.surface?.type, 'room-floor', 'Clicking a visible floor must select its surface')
    if(expected) assert.deepEqual(result.surface,expected,'The correct room and storey must be selected')
  }
  console.log(`PASS wall and ${floors.length} floor selections during staged startup`)
  for (let i = 0; i < 1800; i++) {
    if (errors.length) throw Error(JSON.stringify(errors))
    if(await evaluate('window.roofWallScene().scene.userData.progressiveStartup?.phase === "full"'))break
    await pause(100)
  }
  assert.equal(await evaluate('window.roofWallScene().scene.userData.progressiveStartup?.phase'),'full')
  await evaluate(`(()=>{
    const s=window.roofWallScene(),render=s.gl.render.bind(s.gl);window.wallSelectionFrames=[];
    window.selectionFrame=0;function tick(){window.selectionFrame++;requestAnimationFrame(tick)}requestAnimationFrame(tick);
    s.gl.render=(scene,camera)=>{
      render(scene,camera);
      if(camera!==s.camera||(scene!==s.scene&&!scene.userData.retainedViewport))return;
      let highlights=0,objectHighlights=0;scene.traverseVisible(o=>{
        if(o.userData.houseDesignerRole==='wall-engine-highlight'){highlights++;return}
        if(o.isMesh)for(let p=o;p;p=p.parent)if(p.userData.selectionDecoration){objectHighlights++;break}
      });
      const previous=window.wallSelectionFrames.at(-1);
      // N8AO draws opaque and transparent surfaces separately. A highlight is
      // intentionally absent from its opaque pass, but must appear in the frame.
      if(previous?.frame===window.selectionFrame){previous.highlights=Math.max(previous.highlights,highlights);previous.objectHighlights=Math.max(previous.objectHighlights,objectHighlights)}
      else window.wallSelectionFrames.push({frame:window.selectionFrame,highlights,objectHighlights,selectedModel:window.regressionSelectedModelId,selected:window.regressionSurface?.type,retained:!!scene.userData.retainedViewport,pending:!!s.scene.userData.shaderWarmupPending});
      if(window.holdPreparedDisplay)s.scene.userData.shaderWarmupPending=true;
    };
  })()`)
  const fullWall = await clickAt(savedHouse ? camera : [4,1.4,2],savedHouse ? [camera[0]+4,camera[1],camera[2]] : [8,1.4,2])
  assert.ok(fullWall.surface?.type.startsWith('wall-'),'Wall must remain selectable after lighting handover')
  await pause(6000)
  const frames=await evaluate('window.wallSelectionFrames')
  const firstHighlight=frames.findIndex(frame=>frame.highlights>0)
  assert.ok(firstHighlight>=0,'Selected wall highlight must be drawn')
  const missing=frames.slice(firstHighlight).filter(frame=>frame.selected?.startsWith('wall-')&&!frame.highlights)
  console.log('Wall highlight continuity', {frames:frames.length,missing:missing.length,examples:missing.slice(0,3)})
  assert.equal(missing.length,0,'Wall highlight must not disappear after selection')
  await evaluate('window.wallSelectionFrames=[];window.holdPreparedDisplay=true;window.roofWallScene().scene.userData.shaderWarmupPending=true')
  await pause(1200)
  const retainedFrames=await evaluate('window.wallSelectionFrames.filter(f=>f.retained)')
  assert.ok(retainedFrames.length>0,'Exercise the prepared display while a wall is selected')
  assert.ok(retainedFrames.every(f=>f.highlights>0),'Retained display must include the live wall selection')
  await evaluate('window.holdPreparedDisplay=false;window.roofWallScene().scene.userData.shaderWarmupPending=false')
  for(const sample of floorPoints){const p=sample.point;const result=await clickAt([p[0],p[1]+.65,p[2]],p);assert.equal(result.model,null);assert.equal(result.surface?.type,'room-floor');if(sample.surface)assert.deepEqual(result.surface,sample.surface)}
  console.log('PASS selections after full lighting handover')
  if(!savedHouse){
    await evaluate('window.wallSelectionFrames=[]')
    const object=await clickAt([2,1.3,1],[2,1.3,0])
    assert.equal(object.model,'selection-window-1','Select a window through the actual pointer handler')
    await pause(1200)
    await evaluate('window.holdPreparedDisplay=true;window.roofWallScene().scene.userData.shaderWarmupPending=true')
    await pause(1200)
    const frames=await evaluate('window.wallSelectionFrames.filter(f=>f.selectedModel==="selection-window-1")')
    const first=frames.findIndex(f=>f.objectHighlights>0)
    assert.ok(first>=0,'Object selection highlight must be drawn')
    assert.ok(frames.slice(first).every(f=>f.objectHighlights>0),'Object highlight must remain visible')
    assert.ok(frames.some(f=>f.retained&&f.objectHighlights>0),'Prepared display must show live object selection')
    await evaluate('window.holdPreparedDisplay=false;window.roofWallScene().scene.userData.shaderWarmupPending=false')
    console.log('PASS continuous object selection in live and prepared displays')
  }
  assert.deepEqual(errors, [])
} finally { ws?.close(); browser.kill() }
