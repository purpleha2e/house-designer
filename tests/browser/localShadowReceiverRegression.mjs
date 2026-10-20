// With Vite running: node tests/browser/localShadowReceiverRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=950,1000',
  `--user-data-dir=${createBrowserTestProfile('room-light-shadows-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) resolve(match[1])
    })
    child.on('error', reject)
  })
  ws = new WebSocket(endpoint)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data), request = pending.get(m.id)
    if (request) { pending.delete(m.id); m.error ? request.reject(m.error) : request.resolve(m.result) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (expression, label) => {
    for (let i = 0; i < 600; i++) { if (errors.length) throw Error(JSON.stringify(errors)); if (await evaluate(expression)) return; await pause(100) }
    throw Error(`Timed out: ${label}: ${JSON.stringify(errors)}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roomLightCornersRegression.html`})
  await until('window.roomLightCornerResult','room corner contact shadows')
  console.log('Room corners', JSON.stringify(await evaluate('window.roomLightCornerResult')))
  assert.deepEqual(errors, [])
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/localShadowReceiverRegression.html`})
  await until('window.localShadowResult','grazing receivers')
  const result=await evaluate('window.localShadowResult');console.log(JSON.stringify(result))
  for(const [name,value]of Object.entries(result)){
    assert.ok(value.fixed.samples>100,`${name}: enough visible receivers`)
    assert.ok(value.fixed.affected<=value.fixed.samples*(name==='curved'?.015:.01),`${name}: unobstructed surface stays lit`)
    assert.ok(value.fixed.mean>.99,`${name}: no grazing self-shadow bands`)
  }
  assert.ok(result.point.legacy.affected>result.point.legacy.samples*.05,'reproduce old point-shadow acne')
  await call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/stairLightPortalsRegression.html`})
  await until('window.stairPortalResult','cross-storey light portals')
  const portals=await evaluate('window.stairPortalResult');console.log(JSON.stringify(portals))
  assert.ok(portals.open.belowOpening>100,'upper-floor point light reaches the lower floor through the stair void')
  assert.equal(portals.sealed.belowOpening,0,'a closed slab blocks the same path')
  assert.equal(portals.open.belowSolid,0,'the remaining solid slab does not leak light')
  assert.equal(portals.sealedAgain.belowOpening,0,'closing the opening updates the light immediately')
  assert.equal(portals.open.programs,portals.sealed.programs,'opening changes reuse compiled shaders')
  assert.equal(portals.sealedAgain.programs,portals.open.programs)
  assert.ok(portals.ownStorey.belowOpening>100,'foreign-storey lamp also lights its own storey while the ground floor is active')
  assert.equal(portals.otherRoom.belowOpening,0,'a lamp behind a room partition cannot leak through the stair opening')
  const concave = await evaluate('window.stairConcaveRoomResult'); console.log(JSON.stringify(concave))
  assert.equal(concave.downstairs.belowOpening, 0, 'same-room endpoints cannot leak through an intervening room into the stair opening')
  assert.equal(concave.ownStorey.belowOpening, 0, 'the same obstruction is respected above the slab without a lighting seam')
  assert.ok(concave.clear.belowOpening > 100, 'an unobstructed lamp in the stairwell still illuminates downstairs')
  await until('window.stairGISeamResult','GI blending through the stairwell')
  const seam=await evaluate('window.stairGISeamResult');console.log(JSON.stringify(seam))
  assert.ok(Math.abs(seam.open[0]-seam.open[1])<15,'GI is continuous across a floor boundary in open air')
  assert.ok(seam.solid[1]-seam.solid[0]>100,'GI does not blend through a solid slab')
  const bands = await evaluate('window.stairWallPortalResult'); console.log(JSON.stringify(bands))
  bands.masked.forEach((value, i) => {
    assert.ok(bands.unmasked[i] > 10 && bands.unmasked[i] < 250, 'unsaturated wall receiver')
    assert.ok(Math.abs(value - bands.unmasked[i]) <= 1, `no false slab band at height ${bands.heights[i]}`)
  })
  assert.equal(bands.outside[7], 0, 'boundary texels still block paths outside the actual opening')
  assert.deepEqual(errors,[])
  console.log('Grazing shadow receiver regression passed')
}finally{ws?.close();child.kill()}
