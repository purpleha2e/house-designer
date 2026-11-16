import { projectDownloadFixtureSource } from './projectDownloadFixture.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lightingBrowser } from './lightingHarness.mjs'

const browser = await lightingBrowser()
const port = process.argv[2] ?? '5187'
const springfield = process.argv.includes('--springfield')
const output = `tmp/independent-floors/${springfield ? 'springfield' : 'fixture'}`
mkdirSync(output, { recursive: true })
const report = { steps: [] }
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const originalFetch = window.fetch;
    window.fixture = { activeFloorId: 'first', wallKind: 'external', threeDView: { floorViewId: 'all' },
      floors: ['Floor 0', 'Floor 1', 'Loft'].map((name, i) => ({ id: ['ground','first','loft'][i], name,
        elevation:i*2.6, roomHeight:2.4, slabThickness:.2, rooms:[], roofs:[],
        walls: [[0,0,4,0],[4,0,4,4],[4,4,0,4],[0,4,0,0]].map(([x,y,xx,yy],j)=>({
          id:i+'-wall-'+j,start:{x,y},end:{x:xx,y:yy},height:2.4,thickness:.2,kind:'external'})),
        models:[{id:i+'-window',modelId:'window-three-pane',position:{x:2,y:0},rotation:0,scale:1,
          wallAttachment:{wallId:i+'-wall-0',offset:2}},
          {id:i+'-light',modelId:'point-light',position:{x:2,y:2},height:1.8,rotation:0,scale:1,lightPower:100}] })) };
    window.fetch = (input, options) => String(input).includes('/colin_house_v2.json')
      ? ${springfield ? "originalFetch('/springfield_14.json', options)" : "Promise.resolve(new Response(JSON.stringify(fixture), {headers:{'Content-Type':'application/json'}}))"}
      : originalFetch(input, options);
    window.confirm = () => true;
    ${projectDownloadFixtureSource}window.projectDownloadFixture = async () => ({name:'floor-test.json',createWritable:async()=>({
      write:async data=>{window.savedProject=JSON.parse(typeof data==='string'?data:await data.text())},close:async()=>{}})});
  ` })
  await browser.call('Page.setInterceptFileChooserDialog', {enabled:true})
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${port}/` })
  await browser.wait(`!!document.querySelector('[aria-label="2D editing floor"]')`)
  console.log('Editor loaded; waiting for the 3D scene')
  await browser.evaluate(`(async()=>{
    const m=await import('/tests/browser/rendererTestModules.ts');window.floorScene=m.getEditorState;
    window.propsFor=name=>{const root=document.getElementById('root');
      const fiber=root[Object.keys(root).find(k=>k.startsWith('__reactContainer$'))].stateNode.current;
      let found;const walk=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)===name)found=f.memoizedProps;walk(f.child);walk(f.sibling)};
      walk(fiber);return found};
    window.floorSnapshot=()=>{const s=floorScene(),p=propsFor('ThreeDScene'),objects=[];
      s.scene.traverse(o=>{if(o.name.startsWith('model-transform-'))objects.push({name:o.name,uuid:o.uuid})});
      return {active:p.activeFloorId,all:p.showAllFloors,objects:objects.sort((a,b)=>a.name.localeCompare(b.name)),
        atlas:s.scene.userData.localShadowAtlas ? {...s.scene.userData.localShadowAtlas} : null,
        camera:s.camera.position.toArray(),rotation:s.camera.quaternion.toArray(),
        warmup:s.scene.userData.shaderWarmupGeneration,gi:s.scene.userData.indirectLighting?.generation};
    };
  })()`)
  await browser.wait(`!!floorScene()?.scene && !document.querySelector('.viewport-preparing-overlay') &&
    floorScene().scene.userData.progressiveStartup?.phase==='full' && !floorScene().scene.userData.shaderWarmupPending`, 240000)
  const ids = await browser.evaluate(`propsFor('FloorplanCanvas').floors.map(f=>f.id)`)
  await browser.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  await browser.evaluate(`(()=>{const toggle=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Light shadows').querySelector('input');if(!toggle.checked)toggle.click()})()`)
  await browser.wait(`!floorScene().scene.userData.shaderWarmupPending`)
  await browser.wait(`floorScene().scene.userData.localShadowAtlas?.ready===true`,180000)
  await browser.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
  const selectors = () => browser.evaluate(`({edit:document.querySelector('[aria-label="2D editing floor"]').value,
    view:document.querySelector('[aria-label="3D visible floors"]').value})`)
  assert.deepEqual(await selectors(), { edit: ids[1], view: 'all' })
  assert.equal(await browser.evaluate(`document.querySelector('[aria-label="2D editing floor"]').options.length`), ids.length)
  assert.equal(await browser.evaluate(`document.querySelector('[aria-label="3D visible floors"]').options.length`), ids.length + 1)
  const choose = async (label, value) => {
    await browser.evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  }
  const initial = await browser.evaluate('floorSnapshot()')
  console.log('3D scene ready', { models: initial.objects.length })
  assert.ok(initial.objects.length >= 3, 'Actual window models must be mounted before switching floors')
  report.initial = initial
  const initialShot = await browser.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${output}/all-floors.png`, Buffer.from(initialShot.data, 'base64'))
  for (const id of [ids[0], ids[2], ids[1]]) {
    const start = Date.now()
    await choose('2D editing floor', id)
    await browser.wait(`propsFor('FloorplanCanvas').activeFloor.id===${JSON.stringify(id)}`)
    // Observe beyond the deferred publication window, not only immediate props.
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.deepEqual(await selectors(), { edit: id, view: 'all' })
    assert.deepEqual(await browser.evaluate('floorSnapshot()'), initial, '2D switching must preserve 3D models, camera and lighting generation')
    report.steps.push({ action: '2D switch', id, elapsedMs: Date.now() - start })
  }
  console.log('PASS all-floor editing preserves mounted models, camera, lighting and warmup')
  const start = Date.now()
  await choose('3D visible floors', ids[0])
  await browser.wait(`propsFor('ThreeDScene').activeFloorId===${JSON.stringify(ids[0])} && !propsFor('ThreeDScene').showAllFloors`)
  await browser.wait(`floorSnapshot().objects.length>0 && floorSnapshot().objects.length<${initial.objects.length}`, 60000)
  report.steps.push({ action: '3D isolate', elapsedMs: Date.now() - start })
  assert.deepEqual(await selectors(), { edit: ids[1], view: ids[0] })
  await choose('2D editing floor', ids[2])
  await new Promise(resolve => setTimeout(resolve, 600))
  assert.deepEqual(await selectors(), { edit: ids[2], view: ids[0] })
  assert.equal((await browser.evaluate('floorSnapshot()')).active, ids[0])
  // Save/load must restore different 2D and 3D selections independently.
  const menuAction = async label => {
    await browser.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
    await browser.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`)
  }
  await menuAction('Save to device')
  await browser.wait('!!window.savedProject')
  assert.deepEqual(await browser.evaluate('({edit:savedProject.activeFloorId,view:savedProject.threeDView.floorViewId})'), {edit:ids[2],view:ids[0]})
  await choose('2D editing floor', ids[1])
  await choose('3D visible floors', 'all')
  await menuAction('Load')
  const savedPath = resolve(output, 'floor-test.json')
  writeFileSync(savedPath, await browser.evaluate('JSON.stringify(savedProject)'))
  const {root} = await browser.call('DOM.getDocument')
  const {nodeId} = await browser.call('DOM.querySelector', {nodeId:root.nodeId,selector:'input[type=file]'})
  await browser.call('DOM.setFileInputFiles', {nodeId,files:[savedPath]})
  await browser.wait(`document.querySelector('[aria-label="2D editing floor"]').value===${JSON.stringify(ids[2])}`)
  await browser.wait(`document.querySelector('[aria-label="3D visible floors"]').value===${JSON.stringify(ids[0])}`)
  assert.deepEqual(await selectors(), { edit: ids[2], view: ids[0] })
  if (!springfield) {
    await browser.evaluate(`document.querySelector('[aria-label="Floor tools"]').click()`)
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Delete current floor').click()`)
    await browser.wait(`document.querySelector('[aria-label="2D editing floor"]').options.length===2`)
    assert.equal((await selectors()).view, ids[0], 'Deleting another floor retains the 3D filter')
    await choose('2D editing floor', ids[0])
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Delete current floor').click()`)
    await browser.wait(`document.querySelector('[aria-label="3D visible floors"]').value==='all'`)
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="3D visible floors"]').options.length`), 2)
  }
  const shot = await browser.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${output}/selectors.png`, Buffer.from(shot.data, 'base64'))
  assert.deepEqual(browser.errors, [])
  console.log('PASS independent 3D filtering, persistence and floor deletion', report.steps)
} catch (error) {
  report.failure = String(error)
  report.diagnostic = await browser.evaluate(`({body:document.body.innerText.slice(-4000),
    startup:window.floorScene?.()?.scene.userData.progressiveStartup,
    preparation:window.floorScene?.()?.scene.userData.viewportPreparation,
    gi:window.floorScene?.()?.scene.userData.indirectLighting})`).catch(() => null)
  const shot = await browser.call('Page.captureScreenshot', { format: 'png' }).catch(() => null)
  if (shot) writeFileSync(`${output}/failure.png`, Buffer.from(shot.data, 'base64'))
  throw error
} finally {
  report.errors = browser.errors
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2))
  browser.close()
}
