// With Vite running: node tests/browser/roofFootprintClippingRegression.mjs [port] [screenshot.png]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { once } from 'node:events'
import assert from 'node:assert/strict'

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

  await evaluate(`(async()=>{const data=await fetch('/colin_house_v2.json').then(r=>r.text());window.showOpenFilePicker=async()=>[{getFile:async()=>new File([data],'colin_house_v2.json')}];document.querySelector('[aria-label="Project menu"]').click()})()`)
  await pause(300)
  await evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(el=>el.textContent.trim()==='Load').click()`)
  await pause(25000)
  await evaluate(`(async()=>{const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');const s=[..._roots.values()][0].store.getState();s.controls?.target.set(4.8,2.8,17.4);s.camera.position.set(4.8,4.6,22);s.camera.lookAt(4.8,2.8,17.4);s.controls?.update();s.invalidate();})()`)
  await pause(4000)

  const probes=await evaluate(`(async()=>{const {Vector3,Raycaster}=await import('/node_modules/.vite/deps/three.js');const scene=window.roofCreateScene();scene.updateMatrixWorld(true);const meshes=[];scene.traverse(o=>{if(o.isMesh&&(o.userData.houseDesignerRole==='wall-engine-render'||(o.userData.houseDesignerRole==='roof-top'&&o.userData.roofId==='316c6436-0af8-4dc5-9790-ad4352f645cc')))meshes.push(o)});return [[3.14,16.7],[3.14,17],[3.19,17.45]].map(([x,z])=>{const hit=new Raycaster(new Vector3(x,2.5,z),new Vector3(0,-1,0)).intersectObjects(meshes,false)[0];return {x,z,role:hit?.object.userData.houseDesignerRole,roofId:hit?.object.userData.roofId,y:hit?.point.y}})})()`)
  for(const probe of probes){assert.equal(probe.role,'roof-top',JSON.stringify(probe));assert.equal(probe.roofId,'316c6436-0af8-4dc5-9790-ad4352f645cc');assert.ok(probe.y<2.4)}
  const junction = await evaluate(`(async () => {
    const {Vector3, Raycaster} = await import('/node_modules/.vite/deps/three.js');
    const walls = []; window.roofCreateScene().traverse(o => {
      if (o.isMesh && o.userData.houseDesignerRole === 'wall-engine-render') walls.push(o);
    });
    const probe = (origin, direction) => {
      const hit = new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObjects(walls, false)[0];
      const material = hit && (Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material);
      return {point: hit?.point.toArray(), normal: hit?.face.normal.toArray(), floorId: hit?.object.userData.floorId, textured: !!material?.map};
    };
    return {
      corner: [2.5, 3.5, 4.2].flatMap(y => [3.125, 3.135, 3.14].map(x => probe([x,y,17], [0,0,-1]))),
      strip: [16.8, 17, 17.2].map(z => probe([3.4,2.36,z], [-1,0,0])),
      cornerPatch: probe([3.4,2.34,16.475], [-1,0,0]),
      lowCorner: [[3.163,2.345],[3.182,2.388],[3.2,2.394]].map(([x,y]) => {
        const origin = new Vector3(4.2,3.7,21.5);
        return probe(origin.toArray(),new Vector3(x,y,16.504285263).sub(origin).normalize().toArray());
      }),
      interior: probe([3.4,1.5,16.3],[-1,0,0]),
    };
  })()`)
  for (const hit of junction.corner) {
    assert.ok(hit.point && Math.abs(hit.point[2] - 16.504285263) < 0.002, `the brick corner has no vertical gap: ${JSON.stringify(hit)}`)
    assert.ok(hit.textured, `the corner retains its facade finish: ${JSON.stringify(hit)}`)
  }
  for (const hit of junction.strip) {
    assert.ok(hit.point && Math.abs(hit.point[0] - 3.120947) < 0.002, `the roof-cut reveal is closed: ${JSON.stringify(hit)}`)
    assert.ok(hit.textured, `the exposed reveal continues the brick facade, not interior paint: ${JSON.stringify(hit)}`)
  }
  assert.ok(junction.cornerPatch.textured, 'the exposed patch beside the overhang continues the brick finish')
  for (const hit of junction.lowCorner) {
    assert.ok(hit.point && Math.abs(hit.point[2] - 16.504285263) < 0.002,
      `the low view hits the closing facade, not the interior behind it: ${JSON.stringify(hit)}`)
    assert.equal(hit.floorId,'db559ff8-8f78-4b2c-8093-d57d78580c07')
    assert.ok(hit.normal[2] > 0.99 && hit.textured)
  }
  assert.ok(junction.interior.point && !junction.interior.textured, 'the interior wall keeps its paint')
  console.log('Centred porch roof, corner closure and brick reveal pass all rendered probes')
  if (process.argv[3]) {
    await evaluate(`(async()=>{const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');const s=[..._roots.values()][0].store.getState();s.camera.position.set(4.2,3.7,21.5);s.camera.lookAt(3.5,2.35,17);s.camera.fov=25;s.camera.updateProjectionMatrix();s.invalidate()})()`)
    await pause(1000)
    const shot = await call('Page.captureScreenshot', { format: 'png' })
    writeFileSync(process.argv[3], Buffer.from(shot.data, 'base64'))
  }
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
