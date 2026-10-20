// With Vite running: node tests/browser/planZoomRegression.mjs [port]
import assert from 'node:assert/strict'
import { createBrowserTestProfile, spawnBrowserTest as spawn } from './browserTestProcess.mjs'

const port = process.argv[2] ?? '5186'
const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--no-first-run', '--no-default-browser-check', '--window-size=1000,850',
  `--user-data-dir=${createBrowserTestProfile('plan-zoom-')}`, 'about:blank',
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
    if (request) {
      pending.delete(result.id)
      result.error ? request.reject(result.error) : request.resolve(result.result)
    }
    if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
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
  await call('Page.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  const load = async (fixture, ready) => {
    await call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/${fixture}.html` })
    for (let i = 0; i < 600; i++) {
      if (await evaluate(ready)) return
      assert.deepEqual(errors, [])
      await pause(100)
    }
    throw Error(`Fixture did not load: ${fixture}`)
  }
  const checkWheel = async (stageExpression, description) => {
    await pause(350)
    // Observe actual scene draws, including every frame BEFORE the debounced
    // React viewport commit. Checking zoom buttons or settled frames misses this bug.
    await evaluate(`(() => {
      window.zoomCheckRestore?.();
      const stage = ${stageExpression};
      const strokes = () => stage.find(n => typeof n.stroke === 'function' && n.stroke() && n.strokeEnabled());
      const screenWidth = n => n.strokeWidth() * (n.strokeScaleEnabled() ? Math.abs(n.getAbsoluteScale().x) : 1);
      const baseline = new Map(strokes().map(n => [n._id, screenWidth(n)]));
      const baselineDash = new Map(strokes().map(n => [n._id, n.dash()?.join(',')]));
      const zoomLabel = document.querySelector('[aria-label="Reset zoom"]').textContent;
      const result = window.zoomCheck = { frames: 0, errors: [], startScale: stage.scaleX(), moved: false, uncommitted: false };
      const restores = [];
      for (const layer of stage.getLayers()) {
        const draw = layer.drawScene;
        restores.push(() => { layer.drawScene = draw });
        layer.drawScene = function (...args) {
          result.frames++;
          if (Math.abs(stage.scaleX() - result.startScale) > .001) {
            result.moved = true;
            if (document.querySelector('[aria-label="Reset zoom"]').textContent === zoomLabel) result.uncommitted = true;
          }
          for (const node of strokes()) {
            const expected = baseline.get(node._id);
            if (expected !== undefined && Math.abs(screenWidth(node) - expected) > .001 && result.errors.length < 5)
              result.errors.push(node.getClassName() + ' ' + node.stroke() + ': ' + expected + ' -> ' + screenWidth(node));
            if (expected !== undefined && baselineDash.get(node._id) !== node.dash()?.join(',') && result.errors.length < 5)
              result.errors.push('Dash pattern changed at release: ' + node.getClassName());
          }
          return draw.apply(this, args);
        };
      }
      window.zoomCheckRestore = () => restores.forEach(restore => restore());
    })()`)
    // Roof settings can cover the canvas: route wheel events to an uncovered point.
    const point = await evaluate(`(() => {
      const bounds = ${stageExpression}.container().getBoundingClientRect();
      for (let y = Math.min(innerHeight - 20, bounds.bottom - 20); y > bounds.top + 60; y -= 40)
        for (let x = bounds.left + 20; x < bounds.right - 20; x += 40)
          if (document.elementFromPoint(x, y)?.closest('.konvajs-content')) return {x, y};
      throw Error('No uncovered 2D canvas point');
    })()`)
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    for (const deltaY of [-100, -100, -100, -100, -100, -100, 100, 100, 100, 100, 100, 100]) {
      await call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY })
      await pause(40)
    }
    await pause(350)
    const result = await evaluate('zoomCheck')
    assert.ok(result.moved, `${description}: real wheel events must zoom the stage`)
    assert.ok(result.uncommitted, `${description}: check live frames before React updates its zoom state`)
    assert.ok(result.frames >= 4, `${description}: observe frames throughout the gesture`)
    assert.deepEqual(result.errors, [], `${description}: screen widths must stay fixed during wheel zoom and after release`)
    console.log(`PASS: ${description}, ${result.frames} scene draws during wheel zoom in/out and release`)
  }

  await load('objectHandlesRegression', '!!window.handleStage?.()')
  await evaluate(`handleSetFloor(f => ({...f, walls: [
    {id:'south',start:{x:0,y:0},end:{x:6,y:0},height:2.4,thickness:.2,kind:'external'},
    {id:'east',start:{x:6,y:0},end:{x:6,y:5},height:2.4,thickness:.2,kind:'external'},
    {id:'north',start:{x:6,y:5},end:{x:0,y:5},height:2.4,thickness:.2,kind:'external'},
    {id:'west',start:{x:0,y:5},end:{x:0,y:0},height:2.4,thickness:.2,kind:'external'}
  ]}))`)
  for (const mode of ['Move', 'Rotate', 'Scale']) {
    await evaluate(`document.querySelector('[aria-label="${mode}"]').click()`)
    await checkWheel('handleStage()', `walls, grid, dimensions, object outlines and ${mode} handles`)
  }
  await load('bayRoofRegression', '!!window.bayStage?.()')
  for (const type of ['lean-to', 'hip', 'up-and-over', 'bay']) {
    await evaluate(`loadRoof('${type}')`)
    await checkWheel('bayStage()', `${type} roof outlines and handles`)
  }
  assert.deepEqual(errors, [])
} finally {
  ws?.close()
  child.kill()
}
