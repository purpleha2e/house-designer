import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './tests/browser/browserTestProcess.mjs'

const project = JSON.parse(readFileSync('colin_house_v2.json', 'utf8'))
const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1000,850',
  `--user-data-dir=${createBrowserTestProfile('front-door-fit-')}`, 'about:blank',
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
    if (request) { pending.delete(result.id); result.error ? request.reject(result.error) : request.resolve(result.result) }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
    if (result.method === 'Runtime.consoleAPICalled' && result.params.type === 'error') errors.push(result.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params, sessionId) => new Promise((resolve, reject) => {
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
  async function until(expression, description) {
    const start = Date.now()
    while (Date.now() - start < 240000) {
      if (await evaluate(expression)) return
      await pause(250)
    }
    throw Error(`Timed out: ${description}: ${JSON.stringify(errors)}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(project.indirectLighting)}}}` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?colin&materials&saved-gi&strict` })
  await until('!!window.roofWallScene?.()', 'scene mounted')
  await evaluate(`(()=>{const s=window.roofWallScene();s.setDpr(.75);window.updateRegressionActiveFloor(window.regressionFloors[0].id);s.camera.position.set(5.1,1.6,20.5);s.camera.lookAt(4.8,1.3,18.2);s.controls?.target?.set(4.8,1.3,18.2);s.invalidate()})()`)
  await until(process.argv.includes('--geometry-only')
    ? `!!window.roofWallScene().scene.getObjectByName('Cube003') && !window.roofWallScene().scene.userData.shaderWarmupPending`
    : 'window.roofWallScene().scene.userData.indirectLighting?.state === "ready" && !window.roofWallScene().scene.userData.shaderWarmupPending', 'lighting ready')
  console.log('Front door ready')
  console.log(JSON.stringify(await evaluate(`(async()=>{const {modelsById}=await import('/src/models/modelLibrary.ts');const s=window.roofWallScene(),door=s.scene.getObjectByName('model-transform-116348ab-520b-464f-9fd3-eeb172fec98a');return {definition:modelsById.get('front-door'),doorPosition:door.position.toArray(),doorRotation:door.rotation.toArray(),openings:window.regressionFloors[0].walls.find(w=>w.id==='db43181c-810a-4ce1-8f2a-8aa49c4d00c3').openings,lighting:s.scene.userData.indirectLighting}})()`),null,2))
  await evaluate(`(()=>{const s=window.roofWallScene();s.camera.position.set(5.1,1.6,20.5);s.camera.lookAt(4.8,1.3,18.2);s.controls?.target?.set(4.8,1.3,18.2);s.camera.updateMatrixWorld();s.scene.updateMatrixWorld(true);s.invalidate()})()`)
  await pause(2000)
  const display = await evaluate(`(async()=>{const {Box3,Vector3}=await import('/node_modules/.vite/deps/three.js');const s=window.roofWallScene(),door=s.scene.getObjectByName('model-transform-116348ab-520b-464f-9fd3-eeb172fec98a'),nodes=[];door.traverse(o=>{if(o.geometry)nodes.push({name:o.name,bounds:new Box3().setFromObject(o).min.toArray(),max:new Box3().setFromObject(o).max.toArray(),visible:o.visible,parent:o.parent?.visible})});return{camera:s.camera.position.toArray(),direction:s.camera.getWorldDirection(new Vector3()).toArray(),body:document.body.innerText,canvas:s.gl.domElement.getBoundingClientRect().toJSON(),nodes,blocked:s.scene.userData.shaderWarmupPending}})()`)
  console.log('Display', JSON.stringify(display,null,2))
  if (process.argv[3] !== 'before') {
    const frame=display.nodes.find(n=>n.name==='Cube003')
    assert.ok(frame,'actual imported frame exists')
    assert.ok(Math.abs(frame.max[0]-frame.bounds[0]-.97)<.00001,'rendered frame matches opening width')
    assert.ok(Math.abs(frame.max[1]-frame.bounds[1]-2.1)<.00001,'rendered frame matches opening height')
    assert.ok(Math.abs((frame.max[0]+frame.bounds[0])/2-4.851567924957679)<.00001,'rendered frame is centred on its doorway')
    assert.ok(Math.abs(frame.max[2]-18.31040857438819)<.00001,'frame face seats at the wall inset')
  }
  for (const mode of ['normal', 'no-shadows', 'no-door']) {
    await evaluate(`(()=>{const s=window.roofWallScene();s.gl.shadowMap.enabled=${mode !== 'no-shadows'};const door=s.scene.getObjectByName('model-transform-116348ab-520b-464f-9fd3-eeb172fec98a');door.visible=${mode !== 'no-door'};s.invalidate()})()`)
    await pause(2000)
    writeFileSync(`.tmp-front-door-fit-${process.argv[3] ?? 'before'}-${mode}.png`, Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  }
  console.log('Errors',JSON.stringify(errors))
} finally { ws?.close(); child.kill() }
