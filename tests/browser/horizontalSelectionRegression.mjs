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
  const house = process.argv.includes('--house')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5186}/tests/browser/roofWallRegression.html?${house ? 'colin&edit-floor' : 'lighting-startup&selection-shaders'}&toggle-selection` })
  for (let i = 0; i < 2400; i++) {
    assert.deepEqual(errors, [])
    if (await evaluate('window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase === "full"')) break
    await pause(100)
  }
  assert.equal(await evaluate('window.roofWallScene()?.scene.userData.progressiveStartup?.phase'), 'full')
  for (let i=0;i<1800;i++) {
    if(await evaluate('roofWallScene().scene.userData.indirectLighting?.state === "ready" && !roofWallScene().scene.userData.shaderWarmupPending'))break
    await pause(100)
  }
  await pause(1500)
  const targets = await evaluate(`(() => {
    const s=roofWallScene();s.scene.updateMatrixWorld(true);
    return ['room-floor','ceiling'].map(type => {
      const targets=regressionPickTargets().filter(t=>t.surface?.type===type&&t.object.isMesh);
      for(const t of targets) {
        const g=t.object.geometry,p=g.attributes.position;let area=0,best;
        for(let i=0;i<(g.index?.count??p.count);i+=3) {
          const v=[0,1,2].map(j=>s.camera.position.clone().fromBufferAttribute(p,g.index?g.index.getX(i+j):i+j).applyMatrix4(t.object.matrixWorld));
          const a=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).length();
          if(a>area){area=a;best=v[0].add(v[1]).add(v[2]).divideScalar(3).toArray()}
        }
        if(best)return{surface:t.surface,point:best};
      }
      throw Error('No '+type+' pick target');
    });
  })()`)
  await evaluate(`(() => {
    const s=roofWallScene(),render=s.gl.render.bind(s.gl),gl=s.gl.getContext(),create=gl.createProgram.bind(gl);
    window.horizontalPrograms=0;gl.createProgram=(...args)=>{horizontalPrograms++;return create(...args)};
    window.horizontalFrames=[];window.horizontalTick=0;
    let pending=s.scene.userData.shaderWarmupPending;
    Object.defineProperty(s.scene.userData,'shaderWarmupPending',{configurable:true,
      get(){return !!window.holdHorizontalDisplay||pending},set(value){pending=value}});
    function tick(){window.horizontalTick++;requestAnimationFrame(tick)}requestAnimationFrame(tick);
    s.gl.render=(scene,camera)=>{
      render(scene,camera);
      if(camera!==s.camera||(scene!==s.scene&&!scene.userData.retainedViewport))return;
      let highlights=0;
      scene.traverseVisible(o=>{
        if(!o.isMesh)return;
        const materials=Array.isArray(o.material)?o.material:[o.material];
        if(materials.some(m=>m.isMeshBasicMaterial&&m.color.getHexString()==='f97316'&&m.opacity>0))highlights++;
      });
      const previous=horizontalFrames.at(-1);
      if(previous?.frame===horizontalTick)previous.highlights=Math.max(previous.highlights,highlights);
      else horizontalFrames.push({frame:horizontalTick,highlights,retained:!!scene.userData.retainedViewport});
      if(window.holdHorizontalDisplay)s.scene.userData.shaderWarmupPending=true;
    };
  })()`)
  for (const target of targets) {
    const point = await evaluate(`(() => {
      const s=roofWallScene(),p=${JSON.stringify(target.point)},type=${JSON.stringify(target.surface.type)};
      s.camera.position.set(p[0],p[1]+(type==='ceiling'?-.4:.4),p[2]);s.camera.lookAt(...p);s.camera.updateMatrixWorld(true);
      s.controls?.target?.set(...p);s.invalidate();
      const r=s.gl.domElement.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};
    })()`)
    await pause(300)
    const click = async expected => {
      const before = await evaluate('window.regressionSurfaceChanges?.length??0')
      await call('Input.dispatchMouseEvent', { type:'mousePressed',...point,button:'left',clickCount:1 })
      await call('Input.dispatchMouseEvent', { type:'mouseReleased',...point,button:'left',clickCount:1 })
      for(let i=0;i<80;i++) {
        if(await evaluate(`(window.regressionSurfaceChanges?.length??0)>${before}`))break
        await pause(100)
      }
      assert.equal(await evaluate('regressionSurfaceChanges.length'),before+1,'one state change per click')
      assert.deepEqual(await evaluate('regressionSurface'),expected)
    }
    await evaluate('window.horizontalFrames=[];window.holdHorizontalDisplay=true;roofWallScene().scene.userData.shaderWarmupPending=true')
    await click(target.surface)
    await evaluate('window.horizontalFrames=[]')
    await pause(500)
    let frames=await evaluate('horizontalFrames')
    assert.ok(frames.some(f=>f.retained),'exercise the retained display')
    assert.ok(frames.every(f=>f.highlights>0),`${target.surface.type} highlight must remain selected during retained frames: ${JSON.stringify(frames.slice(0,6))}`)
    // Also retain a display while selected, then deselect: that snapshot must
    // not resurrect the old highlight while the live scene catches up.
    await evaluate('window.holdHorizontalDisplay=false;roofWallScene().scene.userData.shaderWarmupPending=false')
    await pause(1200)
    await evaluate('window.holdHorizontalDisplay=true;roofWallScene().scene.userData.shaderWarmupPending=true')
    await click(null)
    await evaluate('window.horizontalFrames=[]')
    await pause(500)
    frames=await evaluate('horizontalFrames')
    assert.ok(frames.some(f=>f.retained))
    assert.ok(frames.every(f=>f.highlights===0),`${target.surface.type} deselection must be immediate in retained frames`)
    await evaluate('window.horizontalFrames=[];window.holdHorizontalDisplay=false;roofWallScene().scene.userData.shaderWarmupPending=false')
    await pause(700)
    frames=await evaluate('horizontalFrames')
    assert.ok(frames.length>0)
    assert.ok(frames.every(f=>f.highlights===0),`${target.surface.type} deselection must not restore an old highlight`)
    console.log(`PASS: ${target.surface.type} selects/deselects once and remains current across retained/live frames`)
  }
  console.log('Selection GPU programs created:',await evaluate('horizontalPrograms'))
  assert.deepEqual(errors, [])
} finally { ws?.close(); browser.kill() }
