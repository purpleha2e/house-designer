// Bounded real-editor reproduction. One owned, normally paced browser at a time.
// node tests/browser/editorUsabilityRecovery.mjs [label] [port] [duration-seconds]
import { lightingBrowser } from './lightingHarness.mjs'
import { installSceneEditPreload } from './sceneEditTrace.js'
import { mkdirSync, writeFileSync } from 'node:fs'
const [label = 'baseline', port = '5202', duration = '35'] = process.argv.slice(2)
const output = `tmp/usability-recovery/${label}`
mkdirSync(output, { recursive: true })
let traceComplete
const trace = new Promise(resolve => { traceComplete = resolve })
const b = await lightingBrowser({ onEvent: m => { if (m.method === 'Tracing.tracingComplete') traceComplete(m.params) } }), report = { label, samples: [] }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let tracing = false
try {
  await b.call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await b.call('Page.setInterceptFileChooserDialog', { enabled: true })
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    (${installSceneEditPreload.toString()})({devtools:true});
    window.recoveryTasks=[];window.recoveryFrames=[];window.recoveryInputs=[];
    new PerformanceObserver(list=>recoveryTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});
    let last=performance.now();const frame=at=>{if(recoveryFrames.length<8000)recoveryFrames.push({at,ms:at-last});last=at;requestAnimationFrame(frame)};requestAnimationFrame(frame);
    document.addEventListener('keydown',e=>{const at=performance.now();requestAnimationFrame(()=>recoveryInputs.push({at,ms:performance.now()-at,eventAge:at-e.timeStamp}))},true);
    window.showOpenFilePicker=undefined;const click=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file')window.recoveryFileInput=this;return click.call(this)};
    window.confirm=()=>true;
  ` })
  await b.call('Tracing.start', { traceConfig: { recordMode: 'recordContinuously', traceBufferSizeInKb: 8192,
    includedCategories: ['devtools.timeline','blink.user_timing','toplevel'] }, transferMode: 'ReturnAsStream' }); tracing = true
  await b.call('Profiler.enable'); await b.call('Profiler.start')
  await b.call('Page.navigate', { url: `http://127.0.0.1:${port}/tests/browser/editorRegression.html?lightingProfile=1` })
  await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`, 60000)
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
  await b.wait('!!window.recoveryFileInput', 5000)
  await b.evaluate(`window.recoveryLoadAt=performance.now();sceneEditTrace.mark('load Colin')`)
  const input = await b.call('Runtime.evaluate', { expression: 'recoveryFileInput', returnByValue: false })
  await b.call('DOM.setFileInputFiles', { objectId: input.result.objectId, files: [`${process.cwd()}/colin_house_v2.json`] })
  const start = Date.now()
  while (Date.now() - start < Math.min(60, Number(duration)) * 1000) {
    const row = await b.evaluate(`(()=>{const s=window.perfScene?.(),u=s?.scene.userData;return {at:performance.now(),sinceLoad:performance.now()-recoveryLoadAt,cover:document.querySelector('.viewport-preparing-overlay')?.dataset.projectRevision,phase:u?.progressiveStartup,preparation:u?.viewportPreparation,warm:u?.shaderWarmupPending,gi:u?.indirectLighting,soft:u?.softFloorGI,draws:s?.gl.info.render.calls,programs:s?.gl.info.programs.length,models:s?.scene.children.length}})()`)
    report.samples.push(row)
    if (!report.firstGeometry && row.phase) report.firstGeometry = row.sinceLoad
    if (!report.firstUncovered && row.cover === undefined && row.phase) report.firstUncovered = row.sinceLoad
    if (report.samples.length % 5 === 0) {
      await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 })
      await b.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 })
    }
    await pause(200)
  }
  const shot = await b.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${output}/cold.png`, Buffer.from(shot.data, 'base64'))
  report.browser = await b.evaluate(`({tasks:recoveryTasks,frames:recoveryFrames,inputs:recoveryInputs,events:sceneEditTrace.events,workers:[...sceneEditTrace.workers.values()],body:document.body.innerText,lighting:perfScene?.()?.scene.userData.getLightingPerformance?.()})`)
  const profile = await b.call('Profiler.stop'); writeFileSync(`${output}/cpu.cpuprofile`, JSON.stringify(profile.profile))
  console.log(JSON.stringify({ firstGeometry: report.firstGeometry, firstUncovered: report.firstUncovered, final: report.samples.at(-1), errors: b.errors }))
} catch (error) { report.failure = String(error); console.error(error); process.exitCode = 1 }
finally {
  if (tracing) {
    await b.call('Tracing.end').catch(() => {})
    const result = await Promise.race([trace, pause(10000)])
    if (result?.stream) {
      let contents = ''
      for (;;) { const chunk = await b.call('IO.read', { handle: result.stream }); contents += chunk.data; if (chunk.eof) break }
      writeFileSync(`${output}/trace.json`, contents)
      await b.call('IO.close', { handle: result.stream })
    }
  }
  writeFileSync(`${output}/report.json`, JSON.stringify({ ...report, errors: b.errors, logs: b.logs }, null, 2))
  b.close()
}
