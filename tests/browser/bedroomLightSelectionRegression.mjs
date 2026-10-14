// With Vite and the asset portal running: node tests/browser/bedroomLightSelectionRegression.mjs [port]
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const project = JSON.parse(readFileSync('colin_house_v2.json', 'utf8'))
const lampId = 'f65077fd-ee52-4de2-8da6-94a103473188'
const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1000,850',
  `--user-data-dir=${createBrowserTestProfile('bedroom-light-')}`, 'about:blank',
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
    for (let i = 0; i < 1800; i++) {
      if (await evaluate(expression)) return
      if (i % 200 === 0) console.log(description, await evaluate('window.roofWallScene?.()?.scene.userData.indirectLighting?.state'))
      await pause(100)
    }
    throw Error(`Timed out: ${description}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(project.indirectLighting)}}}` })
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5180}/tests/browser/roofWallRegression.html?colin&materials&upper-selection&saved-gi&strict` })
  await until('!!window.roofWallScene?.()', 'scene mounted')
  await evaluate('window.roofWallScene().setDpr(.5)')
  await until('window.roofWallScene().scene.userData.indirectLighting?.state === "ready" && !window.roofWallScene().scene.userData.shaderWarmupPending', 'lighting ready')
  console.log('Saved house lighting ready')
  const snapshot = () => evaluate(`(()=>{const s=window.roofWallScene(),lamp=window.regressionFloors[1].models.find(m=>m.id===${JSON.stringify(lampId)});
    const lights=s.scene.children.filter(o=>o.isPointLight&&o.visible&&o.power>0);
    return {powered:lights.length,shadows:lights.filter(o=>o.castShadow).length,bedroomPower:lights.find(o=>Math.abs(o.position.x-lamp.position.x)<.0001&&Math.abs(o.position.z-lamp.position.y)<.0001)?.power??0,
      positions:lights.map(o=>o.position.toArray()),generation:s.scene.userData.indirectLighting.generation,maxTextures:s.gl.capabilities.maxTextures};})()`)
  const snapshots = []
  for (const selected of [null, lampId, null]) {
    await evaluate(`window.selectRegressionModel(${JSON.stringify(selected)})`)
    await pause(1500)
    snapshots.push(await snapshot())
  }
  console.log(snapshots)
  const { data } = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync('.tmp-bedroom-light-unselected.png', Buffer.from(data, 'base64'))
  for (const result of snapshots) {
    assert.equal(result.powered, 4, 'all four enabled upstairs lamps emit light')
    assert.ok(result.bedroomPower > 0, 'front-bedroom lamp emits light without selection')
    assert.ok(result.shadows <= Math.max(1, result.maxTextures - 14), 'shadow maps stay within the texture budget')
    assert.deepEqual(result.positions, snapshots[0].positions, 'selection preserves the direct lights')
    assert.equal(result.generation, snapshots[0].generation, 'selection preserves the saved GI')
  }
  assert.deepEqual(errors, [])
  console.log('PASS: The saved front-bedroom light illuminates without selection; selection and deselection preserve all four lights.')
} finally { ws?.close(); child.kill() }
