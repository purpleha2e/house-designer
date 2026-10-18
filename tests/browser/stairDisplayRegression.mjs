// Run against Vite: node tests/browser/stairDisplayRegression.mjs [port]
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createBrowserTestProfile, spawnBrowserTest } from './browserTestProcess.mjs'

const child = spawnBrowserTest('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--window-size=1000,850',
  `--user-data-dir=${createBrowserTestProfile('stair-display-')}`, 'about:blank',
], { windowsHide: true })
let ws
try {
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', data => { const m = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]) })
    child.on('error', reject); child.on('exit', code => reject(Error(`Chrome exited ${code}`)))
  })
  ws = new WebSocket(endpoint); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', event => {
    const r = JSON.parse(event.data), p = pending.get(r.id)
    if (p) { pending.delete(r.id); r.error ? p.reject(r.error) : p.resolve(r.result) }
    if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails)
    if (r.method === 'Runtime.consoleAPICalled' && r.params.type === 'error') errors.push(r.params.args.map(a => a.value ?? a.description))
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })) })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async expression => {
    const start = Date.now()
    while (Date.now() - start < 60000) {
      if (await evaluate(expression)) return
      if (errors.length) throw Error(JSON.stringify(errors))
      await pause(100)
    }
    throw Error(`Timed out: ${expression}`)
  }
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.navigate', { url: `http://127.0.0.1:${process.argv[2] ?? 5186}/tests/browser/stairDisplayRegression.html` })
  await until('!!window.stairDisplay?.get().display')
  await evaluate(`window.displayMatches=()=>{
    const {source,display,model,renderer}=stairDisplay.get();source.updateMatrixWorld(true);
    const meshes=[],highlights=[];display.traverse(o=>{if(o.isMesh&&o.visible)(o.userData.selectionDecoration?highlights:meshes).push(o)});
    const parts=[];model.traverse(o=>{if(o.isMesh&&!o.userData.selectionDecoration)parts.push(o)});
    const difference=(a,b)=>Math.max(...a.elements.map((v,i)=>Math.abs(v-b.elements[i])));
    const matched=parts.map(part=>({part:part.name,draw:meshes.find(m=>m.geometry===part.geometry),highlight:highlights.find(m=>m.geometry===part.geometry),source:part}));
    return{cached:display!==source,retained:!!display.userData.retainedViewport,parts:parts.length,
      matches:matched.every(x=>x.draw&&x.highlight&&difference(x.draw.matrixWorld,x.source.matrixWorld)<1e-7&&difference(x.highlight.matrixWorld,x.source.matrixWorld)<1e-7),
      programs:renderer.info.programs.length};}`)
  await until('window.displayMatches().cached && window.displayMatches().matches')
  const result = []
  for (const phase of ['startup', 'retained']) {
    if (phase === 'retained') {
      await evaluate('stairDisplay.block(false)'); await until('!window.displayMatches().cached')
      await pause(300); await evaluate('stairDisplay.block(true)'); await until('window.displayMatches().retained')
    }
    await pause(300)
    const programs = (await evaluate('window.displayMatches()')).programs
    for (const pose of [
      { rotation: -Math.PI / 2, mirror: false, flip: false, x: 0, z: 0, sx: 1, sy: 1, sz: 1 },
      { rotation: .6, mirror: true, flip: true, x: -.5, z: .4, sx: 1.2, sy: .9, sz: .75 },
      { rotation: Math.PI, mirror: false, flip: false, x: .3, z: -.2, sx: .8, sy: 1, sz: 1.1 },
    ]) {
      await evaluate(`stairDisplay.pose(${JSON.stringify(pose)})`)
      await pause(100); await until('window.displayMatches().matches')
      const report = await evaluate('window.displayMatches()')
      assert.equal(report.cached, true); assert.equal(report.parts, 6); assert.equal(report.programs, programs, 'transforms compile no new shader programs')
      result.push({ phase, rotation: pose.rotation, ...report })
    }
    writeFileSync(`.tmp-viewer-stair-display-${phase}.png`, Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(result, null, 2))
  console.log('PASS: Displayed stairs, live selection and placement match during startup and retained lighting preparation; no transform shader compiles.')
} finally { ws?.close(); child.kill() }
