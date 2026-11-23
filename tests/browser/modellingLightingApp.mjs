import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { lightingBrowser } from './lightingHarness.mjs'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'

const out = 'tmp/modelling-lighting-app'
mkdirSync(out, { recursive: true })
const b = await lightingBrowser(), report = {}
const state = () => b.evaluate(`(()=>{const s=window.perfScene?.();return s?{modelling:s.scene.userData.modellingLighting, warmup:s.scene.userData.shaderWarmupPending, probe:s.scene.userData.indirectLighting?.state, programs:s.gl.info.programs.length}:null})()`)
async function wait(expression, ms = 180000) {
  const end = Date.now() + ms
  while (!await b.evaluate(expression)) {
    if (Date.now() > end) throw Error('Timed out: ' + expression + ' ' + JSON.stringify(await state()))
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}
const select = value => b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Lighting mode"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `${projectFileInputFixtureSource}
    window.confirm=()=>true;
    window.projectFileFixture=async()=>[{getFile:async()=>new File([await(await fetch('/test_room.json')).text()],'test_room.json')}];` })
  await b.call('Page.navigate', { url: 'http://127.0.0.1:5188/tests/browser/editorRegression.html?lightingModel=modelling' })
  await wait('!!window.perfScene?.() && !!document.querySelector(\'[aria-label="Project menu"]\')')
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Load')`)
  await b.evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Load').click()`)
  await wait(`window.perfScene?.()?.scene.userData.modellingLighting?.state==='ready'`, 240000)
  report.ready = await state()
  assert.ok(report.ready.modelling.publications > 0)
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await wait(`!!document.querySelector('[aria-label="Lighting mode"]')`)
  assert.equal(await b.evaluate(`document.querySelector('[aria-label="Lighting mode"]').value`), 'modelling')
  await select('existing')
  await wait(`window.perfScene?.()?.scene.userData.modellingLighting?.state==='disabled'`)
  report.existing = await state()
  await select('modelling')
  await wait(`window.perfScene?.()?.scene.userData.modellingLighting?.state==='ready'`)
  report.returned = await state()
  assert.ok(report.returned.modelling.publications > report.ready.modelling.publications)
  assert.equal(report.returned.programs, report.ready.programs, 'switching modes reuses prepared programs')
  await new Promise(resolve => setTimeout(resolve, 1800))
  report.idle = await state()
  assert.equal(report.idle.modelling.requests, report.returned.modelling.requests, 'a settled shell must not recapture continuously')
  assert.equal(await b.evaluate(`localStorage.getItem('house-designer-viewport-lighting-model-v1')`), 'modelling')
  await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  const shot = await b.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${out}/viewport.png`, Buffer.from(shot.data, 'base64'))
  assert.deepEqual(b.errors, [])
  report.passed = true
} catch (error) {
  report.error = String(error); report.final = await state(); throw error
} finally {
  report.errors = b.errors
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  b.close()
}
