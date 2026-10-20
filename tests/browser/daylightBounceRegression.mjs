// Run against a local Vite server: node tests/browser/daylightBounceRegression.mjs 5191
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${createBrowserTestProfile('daylight-bounce-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    child.on('error', reject)
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
  await call('Runtime.enable'); await call('Page.enable')
  const ready = async (after = -1) => {
    for (let i = 0; i < 1800; i++) {
      assert.deepEqual(errors, [])
      const state = await evaluate('window.lightingState?.()?.scene.userData.indirectLighting')
      if (state?.state === 'ready' && state.generation > after && !state.pendingUpdate && !state.volumePending) return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw Error('Probe bake timed out')
  }
  const measure = () => evaluate(`(async () => {
    const {getIndirectLightingUniforms} = await import('/src/indirectLightingShader.ts')
    const {DataUtils} = await import('/node_modules/.vite/deps/three.js')
    const s = lightingState(); let u; const lights = []
    s.scene.traverse(o => { if(o.isLight) lights.push([o.type,o.intensity]); if(o.isMesh && !u) for(const m of Array.isArray(o.material)?o.material:[o.material]) u ||= getIndirectLightingUniforms(m) })
    const energy = ['hdGIRed','hdGIGreen','hdGIBlue'].reduce((sum,key) => {
      const data = u[key].value.image.data
      for(let i=0;i<data.length;i+=4) sum += DataUtils.fromHalfFloat(data[i])
      return sum
    }, 0)
    return {energy,lights}
  })()`)
  for (const mode of ['cached', 'uncached', 'local']) {
    await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5191}/tests/browser/indirectLightingRegression.html?bounce&${mode}` })
    const initial = await ready(), normal = await measure()
    assert.ok(normal.energy > 0)
    if (mode === 'cached') assert.equal(initial.surfaceRelighting, true)
    if (mode === 'uncached') assert.equal(initial.surfaceRelighting, false)
    await evaluate('setDaylightBounceStrength(2)')
    const boostedState = await ready(initial.generation), boosted = await measure()
    assert.deepEqual(boosted.lights, normal.lights, 'display lights retain their original intensities')
    const ratio = boosted.energy / normal.energy
    assert.ok(Math.abs(ratio - (mode === 'local' ? 1 : 2)) < .035, `${mode}: unexpected energy ratio ${ratio}`)
    await evaluate('setDaylightBounceStrength(1)')
    await ready(boostedState.generation)
    const restored = await measure()
    assert.ok(Math.abs(restored.energy / normal.energy - 1) < .02, 'return to 1x restores the original lighting')
    console.log(JSON.stringify({ mode, ratio, restoredRatio: restored.energy / normal.energy }))
  }
} finally { ws?.close(); child.kill() }
