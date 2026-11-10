// Real editor replacement: correct basic geometry releases the cover even while
// an optional model and enhanced shaders remain pending. The asset substitution
// below is only a scheduling fault injection, never a visual reproduction.
// node tests/browser/projectPreparationRegression.mjs [vite-port]
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'

const b = await lightingBrowser(), port = process.argv[2] ?? 5180
const output = 'tmp/project-preparation'
mkdirSync(output, { recursive: true })
const unexpected = () => b.errors.filter(e => !/^THREE\.BufferGeometryUtils: \.merge(Attributes|Geometries)\(\) failed/.test(e))
async function wait(expression, timeout = 60000) {
  const end = Date.now() + timeout
  while (!await b.evaluate(expression)) {
    assert.deepEqual(unexpected(), [])
    if (Date.now() > end) throw Error('Timed out: ' + expression)
    await new Promise(resolve => setTimeout(resolve, 150))
  }
}
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.assetHeld=false;
    const assetGate=new Promise(resolve=>window.releaseAsset=resolve);
    const nativeFetch=fetch;
    window.fetch=async(input,init)=>{
      const url=typeof input==='string'?input:input.url??String(input);
      if(url.includes('/bb35ad04a6c60479b06147e9ddd58e7e/processed/model.glb')){
        assetHeld=true;await assetGate;
        return nativeFetch('/src/models/assets/interior_door_closed.glb',init);
      }
      return nativeFetch(input,init);
    };
    window.confirm=()=>false;
  ` })
  await b.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/editorRegression.html` })
  await wait(`!!document.querySelector('.viewport-preparing-overlay')`)
  await wait(`window.perfScene?.()?.scene.userData.progressiveStartup&&!document.querySelector('.viewport-preparing-overlay')`)
  console.log('Colin prepared; initial cover dismissed')
  await b.evaluate(`(async()=>{
    const contents=await(await fetch('/springfield_14.json')).text();
    window.showOpenFilePicker=async()=>[{getFile:async()=>new File([contents],'springfield_14.json')}];
    window.preparationTrace=[];window.loadStarted=performance.now();
    window.traceTimer=setInterval(()=>{const d=perfScene()?.scene.userData??{},o=document.querySelector('.viewport-preparing-overlay');
      preparationTrace.push({ms:performance.now()-loadStarted,covered:!!o,revision:o?.dataset.projectRevision,warming:d.shaderWarmupPending,preparation:d.viewportPreparation?.message})},100);
    document.querySelector('[aria-label="Project menu"]').click();
  })()`)
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
  await wait(`!!document.querySelector('.viewport-preparing-overlay')`)
  const cover = await b.evaluate(`(()=>{const e=document.querySelector('.viewport-preparing-overlay');return {revision:e.dataset.projectRevision,text:e.textContent,filter:getComputedStyle(e).backdropFilter}})()`)
  assert.equal(cover.text, 'Preparing 3D scene...')
  assert.equal(cover.filter, 'blur(8px)')
  assert.ok(Number(cover.revision) > 0)
  await wait('assetHeld')
  await wait(`!document.querySelector('.viewport-preparing-overlay')&&perfScene().scene.userData.projectGeneration===${Number(cover.revision)}`)
  const early = await b.evaluate(`({phase:perfScene().scene.userData.progressiveStartup,project:perfScene().scene.userData.projectGeneration,held:assetHeld})`)
  assert.equal(early.held, true)
  assert.ok(early.phase.geometryReadyMs >= 0, 'actual basic geometry was drawn before the asset gate released')
  const screenshot = await b.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(output + '/loading.png', Buffer.from(screenshot.data, 'base64'))
  console.log('Springfield basic geometry interactive while optional asset remains held')
  await b.evaluate('releaseAsset()')
  // Exercise input immediately; optional shader completion is not this gate.
  const cameraBefore = await b.evaluate(`(()=>{const s=perfScene();s.gl.domElement.focus();return s.camera.position.toArray()})()`)
  await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
  await new Promise(resolve => setTimeout(resolve, 700))
  await b.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
  const cameraAfter = await b.evaluate('perfScene().camera.position.toArray()')
  assert.ok(cameraAfter.some((value, i) => Math.abs(value - cameraBefore[i]) > .001), 'camera moves before enhanced shaders complete')
  await b.evaluate('clearInterval(traceTimer)')
  const result = await b.evaluate(`({elapsedMs:performance.now()-loadStarted,trace:preparationTrace,warmupPending:perfScene().scene.userData.shaderWarmupPending,warmup:perfScene().scene.userData.shaderWarmupProfile,gi:perfScene().scene.userData.indirectLighting})`)
  result.camera = { before: cameraBefore, after: cameraAfter }
  assert.equal(result.trace.some(s => s.warming && !s.covered), true, 'enhanced shader preparation is independent of interactive geometry')
  writeFileSync(output + '/result.json', JSON.stringify(result, null, 2))
  assert.deepEqual(unexpected(), [])
  console.log('PASS Springfield geometry and camera interactive before optional completion', Math.round(result.elapsedMs), 'ms (includes held asset)')
} catch (error) {
  writeFileSync(output + '/failure.json', JSON.stringify({ error: String(error), trace: await b.evaluate('window.preparationTrace??[]').catch(() => []), errors: b.errors }, null, 2))
  throw error
} finally { b.close() }
