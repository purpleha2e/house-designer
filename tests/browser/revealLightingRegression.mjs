// Run with Vite: node tests/browser/revealLightingRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'
import { writeFileSync } from 'node:fs'

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=950,1000',
  `--user-data-dir=${createBrowserTestProfile('reveal-lighting-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]) })
    child.on('error', reject); child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
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
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? '5180'}/tests/browser/revealLightingRegression.html` })
  let result
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 250))
    result = await evaluate('window.revealResult')
    if (result || errors.length) break
  }
  assert.deepEqual(errors, [])
  assert.ok(result, 'fixture renders')
  console.log(JSON.stringify(result))
  assert.ok(Math.min(...result.windowFrame.legacy) > 100, 'reproduce exterior ambient on a shaded interior frame')
  assert.ok(Math.max(...result.windowFrame.fixed) < 30, 'room-facing frame receives dark indoor GI')
  assert.deepEqual(result.windowFrame.exteriorFixed, result.windowFrame.exteriorLegacy,
    'outward-facing frame retains its exterior lighting')
  assert.deepEqual(result.withoutAttribute, result.legacy, 'ordinary geometry defaults to its original surface position')
  assert.ok(Math.max(...result.corner.legacy) - Math.min(...result.corner.legacy) > 20,
    'reproduce the bright strip on the wall beside an inside corner')
  assert.ok(Math.max(...result.corner.fixed) - Math.min(...result.corner.fixed) <= 1,
    'inside corner footprint stays clear of the bright neighbouring room')
  for (const surface of ['header', 'jamb']) {
    const spread = values => Math.max(...values) - Math.min(...values)
    assert.ok(spread(result.legacy[surface]) > 30, `${surface}: reproduce the old lighting border`)
    assert.ok(spread(result.fixed[surface]) <= 1, `${surface}: consistent lighting across the whole interior reveal`)
    assert.deepEqual(result.exteriorFixed[surface], result.exteriorLegacy[surface], `${surface}: exterior lighting unchanged`)
    assert.ok(spread(result.neighbours.legacy[surface]) > 30, `${surface}: reproduce light borrowed from the bright room`)
    assert.ok(spread(result.neighbours.fixed[surface]) <= 1, `${surface}: sample the owning room throughout the reveal`)
    assert.ok(Math.max(...result.neighbours.fixed[surface]) < Math.max(...result.neighbours.legacy[surface]) - 30,
      `${surface}: bright-room light does not bleed through the wall edge`)
  }
  for (const fixed of [false, true]) {
    await evaluate(`window.renderReveal(${fixed}, false)`)
    writeFileSync(`.tmp-reveal-regression-${fixed ? 'fixed' : 'before'}.png`,
      Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  for (const fixed of [false, true]) {
    await evaluate(`window.renderWindowFrame(${fixed}, false)`)
    writeFileSync(`.tmp-frame-gi-${fixed ? 'fixed' : 'before'}.png`,
      Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  console.log('Reveal lighting regression passed')
} finally { ws?.close(); child.kill() }
