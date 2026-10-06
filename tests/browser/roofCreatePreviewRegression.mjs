// With Vite running: node tests/browser/roofCreatePreviewRegression.mjs [port]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { Triangle, Vector3 } from 'three'

const profile = mkdtempSync(join(tmpdir(), 'roof-create-preview-'))
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1800,1000',
  `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true })
const exited = once(child, 'exit')
let ws, send
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 30000)
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    child.on('error', reject)
    child.on('exit', code => reject(new Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const response = JSON.parse(event.data), request = pending.get(response.id)
    if (request) { pending.delete(response.id); response.error ? request.reject(response.error) : request.resolve(response.result) }
  })
  send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 30000)
    pending.set(++id, {
      resolve: value => { clearTimeout(timeout); resolve(value) },
      reject: error => { clearTimeout(timeout); reject(error) },
    })
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
  const waitFor = async expression => {
    for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await pause(250) }
    throw new Error(`Timed out: ${expression}`)
  }
  await call('Page.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofCreatePreviewRegression.html` })
  await waitFor(`!!window.roofCreateStage?.() && !!window.roofCreateScene?.() && !!document.querySelector('[aria-label="Project menu"]')`)
  const points = [{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 10 }, { x: 1, y: 10 }]
  const floor = { id: 'creation-floor', name: 'Creation regression', elevation: 0, roomHeight: 2.4,
    slabThickness: 0.2, models: [], rooms: [], roofs: [],
    walls: points.map((start, i) => ({ id: `wall-${i}`, start, end: points[(i + 1) % points.length],
      kind: 'external', thickness: 0.2, height: 2.4, openings: [] })),
  }
  const project = { activeFloorId: floor.id, floors: [floor], wallKind: 'external',
    twoDView: { viewportsByFloorId: { [floor.id]: { x: 380, y: 200, scale: 0.9 } } } }
  await evaluate(`(() => {
    window.showOpenFilePicker = async () => [{getFile:async () => new File([${JSON.stringify(JSON.stringify(project))}], 'creation.house.json')}];
    window.showSaveFilePicker = async () => ({createWritable:async () => ({write:async value => {window.savedCreationProject=JSON.parse(value)},close:async () => {}})});
  })()`)
  const menu = async name => {
    await evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
    await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(el=>el.textContent.trim()===${JSON.stringify(name)}).click()`)
    await pause(400)
  }
  await menu('Load')
  await waitFor('document.body.textContent.includes("creation")')
  await evaluate(`document.querySelector('[aria-label="Roof tools"]').click()`)
  await waitFor(`!!document.querySelector('[aria-label="Roof shape"]')`)
  const tab = async name => {
    await evaluate(`[...document.querySelectorAll('.roof-settings-tabs [role="tab"]')].find(el=>el.textContent===${JSON.stringify(name)}).click()`)
    await pause(200)
  }
  const change = async (label, value) => {
    await evaluate(`(() => {const el=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');
      if(!el?.getClientRects().length)throw new Error('Missing visible field: '+${JSON.stringify(label)});
      Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await pause(200)
  }
  for (const point of points) {
    // Invoke the mounting marker's click handler directly: this regression
    // checks creation fidelity, independently of canvas hit-buffer timing.
    await evaluate(`(() => {const marker=window.roofCreateStage().find('Circle').find(n=>
      Math.abs(n.x()/60-${point.x})<1e-6 && Math.abs(n.y()/60-${point.y})<1e-6 && n.isListening());
      if(!marker)throw new Error('Missing mounting marker');marker.fire('click',{evt:new MouseEvent('click')});})()`)
    await pause(200)
  }
  assert.equal(await evaluate(`[...document.querySelectorAll('.roof-placement-actions button')].find(el=>el.textContent.trim()==='Create').disabled`), false)
  await evaluate(`document.querySelector('[aria-label="Asymmetric roof sides"]').click()`)
  await tab('Height & joins')
  await change('Roof ridge height', 2.1)
  await evaluate(`document.querySelector('[aria-label="Fit supporting walls to roof"]').click()`)
  await tab('Advanced')
  await change('Roof mounted side', 'side1')
  await change('Roof ridge offset', 2.25)
  await change('Roof vertical offset', -0.15)
  await evaluate(`[...document.querySelectorAll('.roof-settings-panel label')].find(el=>el.textContent.trim()==='Clip house geometry').querySelector('input').click()`)
  const vertices = role => evaluate(`(() => {
    const result=[];const scene=window.roofCreateScene();scene.updateMatrixWorld(true);
    scene.traverse(o=>{if(o.userData.houseDesignerRole!==${JSON.stringify(role)})return;
      const p=o.geometry.attributes.position,index=o.geometry.index,v=o.position.clone();
      for(let i=0;i<(index?.count??p.count);i++){
        v.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(o.matrixWorld);result.push([v.x,v.y,v.z]);}});return result;
  })()`)
  await waitFor(`(() => {let count=0;window.roofCreateScene().traverse(o=>{if(o.userData.houseDesignerRole==='roof-placement-preview')count+=o.geometry.attributes.position.count});return count>0})()`)
  const previewVertices = await vertices('roof-placement-preview')
  await evaluate(`[...document.querySelectorAll('.roof-placement-actions button')].find(el=>el.textContent.trim()==='Create').click()`)
  await menu('Save')
  await waitFor('!!window.savedCreationProject')
  const saved = await evaluate('window.savedCreationProject')
  const roof = saved.floors[0].roofs[0]
  assert.ok(roof, 'the real app creates a roof')
  assert.equal(roof.asymmetricSides, true)
  assert.equal(roof.mountSide, 'side1')
  assert.equal(roof.ridgeOffset, 2.25)
  assert.equal(roof.ridgeHeight, 2.1)
  assert.equal(roof.heightOffset, -0.15)
  assert.equal(roof.fitSupportingWalls, true)
  assert.equal(roof.clipsGeometry, false)
  await waitFor(`(() => {let count=0;window.roofCreateScene().traverse(o=>{if(o.userData.houseDesignerRole==='roof-top')count+=o.geometry.attributes.position.count});return count>0})()`)
  const createdVertices = await vertices('roof-top')
  // The finished mesh subdivides panels for materials and wall fitting. Check
  // surface coverage and area rather than requiring identical triangulation.
  const triangles = vertices => Array.from({ length: vertices.length / 3 }, (_, i) =>
    new Triangle(...vertices.slice(i * 3, i * 3 + 3).map(p => new Vector3(...p))))
  const sameSurface = (actualVertices, expectedVertices) => {
    const actual = triangles(actualVertices), expected = triangles(expectedVertices)
    const area = mesh => mesh.reduce((total, triangle) => total + triangle.getArea(), 0)
    assert.ok(Math.abs(area(actual) - area(expected)) < 1e-4, 'roof surface area matches the preview')
    for (const [from, to] of [[actual, expected], [expected, actual]]) {
      for (const triangle of from) {
        for (const p of [triangle.a, triangle.b, triangle.c, triangle.getMidpoint(new Vector3())]) {
          const distance = Math.min(...to.map(t => t.closestPointToPoint(p, new Vector3()).distanceTo(p)))
          assert.ok(distance < 1e-4, `roof surfaces coincide within 0.1 mm (distance ${distance})`)
        }
      }
    }
  }
  sameSurface(createdVertices, previewVertices)
  // Loading the saved project must retain both the settings and visible shape.
  await evaluate(`window.showOpenFilePicker=async()=>[{getFile:async()=>new File([${JSON.stringify(JSON.stringify(saved))}],'roundtrip.house.json')}]`)
  await menu('Load')
  await pause(500)
  sameSurface(await vertices('roof-top'), previewVertices)
  console.log('Full app Create, Save and Load preserve asymmetric settings and the exact preview surface')
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close') } catch { child.kill() }
  } else child.kill()
  ws?.close()
  await exited
  // Only remove the isolated profile created by this test.
  const target = resolve(profile), root = resolve(tmpdir())
  assert.equal(dirname(target), root)
  assert.ok(target.startsWith(join(root, 'roof-create-preview-')))
  rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
