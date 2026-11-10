// Public editor controls + read-only React/scene observations. No state forcing.
import { lightingBrowser } from './lightingHarness.mjs'
import { installSceneEditPreload } from './sceneEditTrace.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const [mode = 'simple', label = 'after', port = '5202'] = process.argv.slice(2)
const out = `tmp/shader-preparation/${label}-${mode}`
mkdirSync(out, { recursive: true })
const report = { mode, steps: [], samples: [], measurementLimits: ['Compositor pass geometry signatures are not visible edit latency; submissionChanges is diagnostic only.'] }, pause = ms => new Promise(r => setTimeout(r, ms))
let traceDone
const trace = new Promise(r => { traceDone = r })
const b = await lightingBrowser({ onEvent: m => { if (m.method === 'Tracing.tracingComplete') traceDone(m.params) } })
async function click(selector, text) {
  const p = await b.evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(selector)})],e=${text ? `a.find(e=>e.textContent.trim()===${JSON.stringify(text)})` : 'a[0]'};if(!e||e.disabled)throw Error('Control unavailable: '+${JSON.stringify(selector + ' ' + (text ?? ''))});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await mouse(p)
}
async function mouse(p) {
  await b.call('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 0, ...p })
  await b.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...p })
  await b.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...p })
}
async function shot(name) { const s = await b.call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(s.data, 'base64')) }
async function field(selector, text) {
  await click(selector)
  await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await b.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await b.call('Input.insertText', { text })
  await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await b.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
async function arm(label) { return b.evaluate(`(()=>{sceneEditTrace.mark(${JSON.stringify(label)});recoveryWatch={label:${JSON.stringify(label)},at:performance.now(),before:recoveryDraws.at(-1)?.signature};return recoveryWatch.at})()`) }
const snapshot = `(()=>{const s=perfScene?.(),u=s?.scene.userData,p=recoveryProps('ThreeDView'),plan=recoveryProps('FloorplanCanvas');return {at:performance.now(),project:p?.lightingResetRevision,sceneProject:u?.projectGeneration,floorIds:p?.floors.map(f=>f.id),planWalls:plan?.activeFloor.walls.length,planModels:plan?.activeFloor.models.length,cover:document.querySelector('.viewport-preparing-overlay')?.dataset.projectRevision,phase:u?.progressiveStartup,warm:u?.shaderWarmupPending,preparation:u?.viewportPreparation,gi:u?.indirectLighting,soft:u?.softFloorGI,draw:recoveryDraws.at(-1),camera:s?.camera.position.toArray(),resources:s&&{textures:s.gl.info.memory.textures,geometry:s.gl.info.memory.geometries,programs:s.gl.info.programs.length},lost:s?.gl.getContext().isContextLost()}})()`
async function observe(seconds) {
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) { report.samples.push(await b.evaluate(snapshot)); await pause(150) }
}
async function load(file) {
  await click('[aria-label="Project menu"]'); await click('button', 'Load')
  await b.wait('!!window.recoveryFileInput', 3000)
  const input = await b.call('Runtime.evaluate', { expression: 'recoveryFileInput', returnByValue: false })
  await b.evaluate(`window.recoveryFileInput=undefined;sceneEditTrace.mark(${JSON.stringify('load ' + file)})`)
  const at = await b.evaluate('performance.now()')
  await b.call('DOM.setFileInputFiles', { objectId: input.result.objectId, files: [`${process.cwd()}/${file}`] })
  report.steps.push({ action: 'load ' + file, at })
}
async function planPoint(x, y) { return b.evaluate(`(()=>{const s=recoveryKonva.stages.find(s=>s.container().isConnected),r=s.container().getBoundingClientRect();return{x:r.x+s.x()+${x}*60*s.scaleX(),y:r.y+s.y()+${y}*60*s.scaleY()}})()`) }
try {
  await b.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await b.call('Page.setInterceptFileChooserDialog', { enabled: true })
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    (${installSceneEditPreload.toString()})({devtools:true});
    window.recoveryTasks=[];window.recoveryDraws=[];window.recoveryInputs=[];window.recoveryVisibleEdits=[];window.recoveryWatch=undefined;
    new PerformanceObserver(list=>recoveryTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});
    window.confirm=m=>!m.startsWith('Save changes');window.showOpenFilePicker=undefined;
    const click=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file')window.recoveryFileInput=this;return click.call(this)};
    window.recoveryProps=name=>{const host=document.getElementById('root'),key=Object.keys(host).find(k=>k.startsWith('__reactContainer$'));let found;const visit=f=>{if(!f)return;if((f.type?.name??f.type?.type?.name)===name)found=f.memoizedProps;visit(f.child);visit(f.sibling)};visit(host[key].stateNode.current);return found};
    let installed;setInterval(()=>{const s=window.perfScene?.();if(!s||installed===s.gl)return;installed=s.gl;const render=s.gl.render;s.gl.render=function(scene,camera){const at=performance.now(),result=render.apply(this,arguments);if(camera===s.camera&&scene.isScene&&(scene===s.scene||'preparedLightingViewport' in scene.userData||scene.userData.retainedViewport||scene.userData.initialViewportPreview)&&recoveryDraws.length<4000){let meshes=0,signature=0;scene.traverseVisible(o=>{if(o.isMesh){meshes++;signature=(Math.imul(signature,31)+o.geometry.id)|0}});recoveryDraws.push({at,cpu:performance.now()-at,scene:scene.uuid,meshes,signature,initial:scene.userData.initialViewportPreview,basic:scene.userData.basicGeometryViewport,retained:scene.userData.retainedViewport,sceneProject:s.scene.userData.projectGeneration,project:recoveryProps('ThreeDView')?.lightingResetRevision});if(recoveryWatch&&recoveryWatch.before!==undefined&&signature!==recoveryWatch.before){recoveryVisibleEdits.push({...recoveryWatch,visibleAt:performance.now(),ms:performance.now()-recoveryWatch.at,signature});recoveryWatch=undefined}}return result}},100);
    document.addEventListener('pointerdown',e=>{const at=performance.now();requestAnimationFrame(()=>recoveryInputs.push({at,eventAge:at-e.timeStamp,ms:performance.now()-at}))},true);
  ` })
  await b.call('Tracing.start', { traceConfig: { recordMode: 'recordContinuously', traceBufferSizeInKb: 8192,
    includedCategories: ['devtools.timeline','blink.user_timing','toplevel'] }, transferMode: 'ReturnAsStream' })
  await b.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/shaderPreparationEditor.html?lightingProfile=1&editorTrace=1` })
  await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`, 60000)
  await b.wait('!!window.Konva',5000);await b.evaluate('window.recoveryKonva=window.Konva;true')
  if (mode === 'replacement') {
    await load('colin_house_v2.json'); await observe(30); await shot('colin')
    await load('springfield_14.json'); await observe(30); await shot('springfield')
    await click('[aria-label="Project menu"]'); await click('button', 'New'); await observe(8); await shot('new')
    await load('colin_house_v2.json'); await pause(400); await load('springfield_14.json'); await observe(8); await shot('rapid-replacement')
  } else {
    await click('[aria-label="Project menu"]'); await click('button', 'New')
    await b.wait(`recoveryProps('FloorplanCanvas')?.activeFloor.walls.length===1`, 5000)
    await shot('new-initial')
    await click('[aria-label="Wall tools"]'); await click('button', 'Add wall')
    await click('[aria-label="Wall tools"]')
    // New supplies one floor and its first wall. Draw six more through pointer input.
    for (const [i, points] of [ [[6.5,1.5],[6.5,6.5]], [[6.5,6.5],[1.5,6.5]], [[1.5,6.5],[1.5,1.5]], [[1.5,4],[6.5,4]], [[4,1.5],[4,4]], [[4,4],[4,6.5]] ].entries()) {
      await mouse(await planPoint(...points[0])); await pause(40)
      const at = await arm(`draw wall ${i+2}`)
      await mouse(await planPoint(...points[1]))
      await b.wait(`recoveryProps('FloorplanCanvas').activeFloor.walls.length===${i+2}`, 4000)
      report.steps.push({ action: `wall ${i+2} plan`, at, observed: await b.evaluate('performance.now()') })
    }
    await click('[aria-label="Wall tools"]'); await click('button', 'Stop adding walls'); await click('[aria-label="Wall tools"]'); await shot('seven-walls-initial')
    await observe(4); await shot('seven-walls-preparing')
    await click('[aria-label="Add windows or doors"]')
    report.openings = await b.evaluate(`[...document.querySelectorAll('.model-option')].map(e=>e.textContent)`)
    const windowName = await b.evaluate(`[...document.querySelectorAll('.model-option')].find(e=>/window/i.test(e.textContent)&&!/build/i.test(e.textContent))?.textContent.trim()`)
    if (!windowName) throw Error('No window available through the model selector')
    await click('.model-option', windowName)
    const point = await planPoint(3,1.5); await b.call('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 0, ...point }); await pause(80)
    const at = await arm('insert window')
    await mouse(point); await b.wait(`recoveryProps('FloorplanCanvas').activeFloor.models.length>0`, 5000)
    report.steps.push({ action: 'window inserted in plan', at, observed: await b.evaluate('performance.now()') })
    await shot('window-initial'); await observe(4); await shot('window-prepared')
    // Select a real wall in the plan, then use the normal material picker.
    // Project visible wall points into the actual canvas; use normal pointer
    // picking. Plan wall selection does not select a 3D material surface.
    let picked=false
    for(const [x,y,z]of [[6.5,1.2,3],[3,1.2,6.5],[4,1.2,3],[3,1.2,4]]){
      const point=await b.evaluate(`(()=>{const s=perfScene(),p=new s.camera.position.constructor(${x},${y},${z}).project(s.camera),r=s.gl.domElement.getBoundingClientRect();return{x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}})()`)
      await mouse(point);await pause(100)
      if(await b.evaluate(`!!recoveryProps('LeftToolRail')?.selectedSurface`)){picked=true;break}
    }
    assert.equal(picked,true,'a real 3D surface must be picked before assigning a material')
    await click('[aria-label="Materials"]')
    await field('[aria-label="Search materials"]','Slate')
    await b.wait('!!document.querySelector(".material-tree-item")',4000)
    const beforeAssignments=await b.evaluate(`recoveryProps('ThreeDView').surfaceAssignments.length`)
    await click('.material-tree-item');const finishAt=await arm('change wall material');await click('button','Apply material')
    await b.wait(`recoveryProps('ThreeDView').surfaceAssignments.length>${beforeAssignments}`,5000)
    report.steps.push({action:'material assignment',at:finishAt,observed:await b.evaluate('performance.now()'),assignments:await b.evaluate(`recoveryProps('ThreeDView').surfaceAssignments`)})
    await click('[aria-label="Materials"]');await observe(4);await shot('material-preparing')
    await b.evaluate('perfScene().gl.domElement.focus()')
    const beforeCamera = await b.evaluate(snapshot)
    await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 }); await pause(700)
    await b.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 })
    report.camera = { before: beforeCamera, after: await b.evaluate(snapshot) }; await shot('camera-during-gi')
    assert.equal(await b.evaluate(`recoveryProps('FloorplanCanvas').activeFloor.walls.length`), 7)
  }
  report.final = await b.evaluate(snapshot)
} catch (error) { report.failure = String(error); console.error(error); process.exitCode = 1; await shot('failure').catch(() => {}) }
finally {
  report.programAudit=await b.evaluate('shaderProgramAudit.snapshot()').catch(error=>({error:String(error)}))
  report.raw = await b.evaluate(`({stages:window.editorPreparationEvents,submissionChanges:recoveryVisibleEdits,events:sceneEditTrace.events,workers:[...sceneEditTrace.workers.values()],tasks:recoveryTasks,draws:recoveryDraws,inputs:recoveryInputs,body:document.body.innerText,lighting:window.perfScene?.()?.scene.userData.getLightingPerformance?.()})`).catch(() => ({}))
  await b.call('Tracing.end').catch(() => {})
  const result = await Promise.race([trace, pause(10000)])
  if (result?.stream) { let data = ''; for (;;) { const c = await b.call('IO.read', { handle: result.stream }); data += c.data; if (c.eof) break } writeFileSync(`${out}/trace.json`, data); await b.call('IO.close', { handle: result.stream }) }
  writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, errors: b.errors, logs: b.logs }, null, 2))
  console.log(JSON.stringify({ steps: report.steps, final: report.final, failure: report.failure, errors: b.errors }))
  b.close()
}
