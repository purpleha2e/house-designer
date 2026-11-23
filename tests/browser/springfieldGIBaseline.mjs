import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { lightingBrowser } from './lightingHarness.mjs'
import { installNativeAudit } from './rendererAuditNative.js'

const root = new URL('../../', import.meta.url)
const out = new URL('docs/lumen-gi/', root)
const origin = process.argv[2] ?? 'http://127.0.0.1:5188'
const costSweep = process.argv.includes('--cost')
const daylight = process.argv.includes('--daylight')
const wallAudit = process.argv.includes('--phase3-wall-audit')
const camera = JSON.parse(await readFile(new URL('docs/lighting-lab/springfield-hall/landing-check/landing-view.json', root))).stats.camera
const project = await readFile(new URL('springfield_14.json', root))
const report = { sha256: createHash('sha256').update(project).digest('hex'), camera, samples: {} }
const browser = await lightingBrowser()
const save = () => writeFile(new URL(process.argv[3] ?? 'baseline.json', out), JSON.stringify(report, null, 2) + '\n')
try {
  await mkdir(out, { recursive: true })
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: '(' + installNativeAudit.toString() + ')()' })
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: 'Error.stackTraceLimit = 40' })
  await browser.call('Performance.enable')
  const options = new URLSearchParams('springfield-14&materials&preview-lighting&lightingModel=existing&giShaderAudit')
  if (costSweep) options.set('profileMaterialCost', '')
  if (daylight) options.set('daylight-only', '')
  if(process.argv.includes('--lumen')){options.set('giBackend','lumen');options.set('daylight-only','');options.set('lightingView','custom')}
  await browser.call('Page.navigate', { url: origin + '/tests/browser/roofWallRegression.html?' + options })
  const ready = "window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase === 'full' && !roofWallScene().scene.userData.shaderWarmupPending && !document.querySelector('.viewport-preparing-overlay')"
  await browser.wait(ready, 300000)
  console.log('Springfield renderer ready')
  await browser.evaluate(`(async () => {
    const state = roofWallScene(), pose = ${JSON.stringify(camera)}
    state.camera.position.fromArray(pose.position)
    state.camera.quaternion.fromArray(pose.quaternion)
    state.camera.fov = pose.fov
    state.camera.updateProjectionMatrix()
    state.camera.updateMatrixWorld(true)
    const { installRendererAudit } = await import('/tests/browser/rendererAuditProbe.js')
    window.audit = await installRendererAudit(state)
    await audit.configure({ giShader: false, probeGI: false })
  })()`)
  report.initial = await browser.evaluate(`(() => {
    const s = audit.snapshot()
    return { hardware:s.hardware, canvas:s.canvas, startup:roofWallScene().scene.userData.progressiveStartup,
      programs:s.three.programs, compiles:s.native.compileCalls, links:s.native.linkCalls, textures:s.three.textures,
      geometry:s.three.geometries, effectiveGI:s.effectiveGI, gi:s.gi?.state }
  })()`)
  await save()
  if(process.argv.includes('--lumen'))await browser.wait("roofWallScene().scene.userData.lumenGI?.daylightReady",300000)
  if (daylight) {
    const clip = await browser.evaluate(`(async () => {
      await audit.sample(1000, false)
      const r = roofWallScene().gl.domElement.getBoundingClientRect()
      return {x:r.x,y:r.y,width:r.width,height:Math.min(r.height,innerHeight-r.y),scale:1}
    })()`)
    const image = await browser.call('Page.captureScreenshot', { format:'png',clip })
    await writeFile(new URL('landing-daylight-off.png',out),Buffer.from(image.data,'base64'))
    report.daylight = await browser.evaluate(`(async () => {
      const {inspectLandingSun} = await import('/tests/browser/springfieldDaylight.ts')
      const floor = regressionFloors[1], room = floor.rooms.find(r => r.name === 'Room 5')
      const finish = regressionAssignments.findLast(a => a.target.floorId === floor.id && a.target.roomSignature === room.signature && a.target.type==='room-floor')
      return inspectLandingSun(roofWallScene(),finish.materialId,floor.elevation)
    })()`)
    await save()
    assert.equal(report.daylight.artificialLights,0)
    assert.ok(report.daylight.footprint.samples>0,'No matching landing surface in the reference geometry')
    assert.deepEqual(browser.errors, [])
  } else if (costSweep) {
    report.costSweep = {}
    report.shaderBypasses = await browser.evaluate('rendererMainFeatures.stats')
    assert.ok(report.shaderBypasses.flat && report.shaderBypasses.direct && report.shaderBypasses.shadow)
    for (const [label, feature, ao] of [['full',0,true],['aoOff',0,false],['shadowLookupOff',3,true],['directBRDFOff',9,true],['flatMaterial',8,true],['fullRepeat',0,true]]) {
      console.log('Profiling', label)
      report.costSweep[label] = await browser.evaluate(`(async () => {
        rendererMainFeatures.set(${feature})
        await audit.configure({giShader:false,probeGI:false,ao:${ao}})
        await audit.sample(1000,false)
        const p=await audit.sample(4000,false)
        return {cpu:p.cpuFrameMs, gpu:p.gpuFrameMs, frame:p.frameMs, passes:p.passes.map(pass=>[pass.name,pass.drawCallsPerFrame])}
      })()`)
      await save()
    }
    assert.deepEqual(browser.errors, [])
  } else {
    let lastNative = report.initial
    const edits = {
      stationary: null,
      camera: null,
      selection: "selectRegressionModel(regressionFloors[1].models.find(m => m.modelId.includes('door')).id)",
      sunlight: 'updateRegressionSunPosition(sun => ({...sun, azimuth:sun.azimuth+.16}))',
      sunlightMotion: `for (let i=0;i<12;i++) {
        updateRegressionSunPosition(sun => ({...sun, azimuth:sun.azimuth+.01}))
        await new Promise(resolve => setTimeout(resolve, 80))
      }`,
      sunlightIntensity: 'updateRegressionSunPosition(sun => ({...sun, strength:.5}))',
      material: `{
        const floor = regressionFloors[1]
        const room = floor.rooms.find(room => room.name === 'Room 5')
        const finish = regressionAssignments.findLast(a => a.target.type === 'room-floor'
          && a.target.floorId === floor.id && a.target.roomSignature === room.signature)
        if (!finish) throw Error('Missing Springfield landing finish')
        updateRegressionAssignments(list => list.map(a => a.id === finish.id ? {...a,materialId:'farrow-ball-hague-blue'} : a))
      }`,
      window: 'regressionMoveWindow(.12)',
      resizeWindow: `updateRegressionFloors(floors => floors.map((floor,index) => {
        if (index !== 1) return floor
        const window = floor.models.find(m => m.modelId.includes('window') && m.wallAttachment)
        return regressionTools.syncWallOpenings({...floor,models:floor.models.map(m => m.id===window.id ? {...m,widthScale:(m.widthScale??1)*1.05}:m)}, regressionTools.modelsById)
      }))`,
      furniture: `updateRegressionFloors(floors => floors.map((floor,index) => {
        if (index !== 1) return floor
        const bed = floor.models.find(m => m.modelId==='king-bed')
        return {...floor,models:floor.models.map(m => m===bed ? {...m,position:{...m.position,x:m.position.x+.2}}:m)}
      }))`,
      addWall: `updateRegressionFloors(floors => floors.map((floor,index) => index!==1 ? floor : {
        ...floor,walls:[...floor.walls,{id:'baseline-partition',kind:'internal',height:2.4,thickness:.12,start:{x:10.4,y:7.7},end:{x:11.4,y:7.7},openings:[]}]
      }))`,
      resizeWall: `updateRegressionFloors(floors => floors.map((floor,index) => index!==1 ? floor : {
        ...floor,walls:floor.walls.map(w => w.id==='baseline-partition' ? {...w,end:{...w.end,x:w.end.x+.3}} : w)
      }))`,
    }
    if (wallAudit) {
      edits.selection = `{
        const floor = regressionFloors[1]
        const wall = floor.walls.find(w => w.kind === 'internal')
        if (!wall) throw Error('Missing Springfield interior wall')
        selectRegressionSurface({type:'wall-face',floorId:floor.id,wallId:wall.id,side:-1})
      }`
      edits.material = `{
        if (regressionSurface?.type !== 'wall-face') throw Error('Springfield wall selection did not commit')
        const {wallId} = regressionSurface
        updateRegressionAssignments(list => [...list, {
          id:'phase3-wall-finish', materialId:'farrow-ball-hague-blue',
          target:{type:'wall-face',wallId,side:'both'},
        }])
      }`
    }
    for (const [name, edit] of Object.entries(edits)) {
      if (wallAudit && !['selection','material'].includes(name)) continue
      if (process.argv.includes('--sun-only') && !['selection','sunlight'].includes(name)) continue
      console.log('Sampling', name)
      const metrics = async () => (await browser.call('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration').value
      const taskStart = await metrics()
      const cacheBefore=process.argv.includes('--lumen')?await browser.evaluate('({...roofWallScene().scene.userData.lumenGI})'):undefined
      const started = performance.now()
      report.samples[name] = await browser.evaluate(`(async () => {
        const result = audit.sample(4000, ${name === 'camera'})
        ${edit ?? ''}
        const p = await result
        const native = p.after.native
        return { frameMs:p.frameMs, cpuSubmitMs:p.cpuFrameMs, gpuMs:p.gpuFrameMs, presentedFPS:p.presentedFPS,
          frameCallbackMs:p.callbacks.reduce((total,c) => total+c.cpuMsPerFrame,0),
          draws:p.passes.reduce((n,v)=>n+v.drawCallsPerFrame,0), triangles:p.passes.reduce((n,v)=>n+v.trianglesPerFrame,0),
          compiles:native.compileCalls-p.before.native.compileCalls, links:native.linkCalls-p.before.native.linkCalls,
          workerMessages:p.newWorkerMessages, effectiveGI:p.after.effectiveGI, errors:p.after.errors, camera:p.after.camera }
      })()`)
      report.samples[name].mainThreadTaskMsPerFrame = ((await metrics()) - taskStart) * 1000 / report.samples[name].frameMs.count
      try {
        await browser.wait(ready, 180000)
        if(cacheBefore){
          const changesLighting=['sunlight','sunlightMotion','sunlightIntensity','material','window','resizeWindow','furniture','addWall','resizeWall'].includes(name)
          const minRelights=cacheBefore.relights+Number(changesLighting)
          const daylight=process.argv.includes('--phase3-interactive')?'gi.cacheProfile?.firstDaylightMs>0':'gi.daylightReady'
          await browser.wait(`(()=>{const gi=roofWallScene().scene.userData.lumenGI;if(gi?.state==='error')throw Error(gi.detail);return gi?.state==='ready' && ${daylight} && gi.relights>=${minRelights}})()`,240000)
        }
      } catch (error) {
        report.failedReadiness = await browser.evaluate(`(() => {
          const u = roofWallScene().scene.userData
          return { operation:${JSON.stringify(name)}, startup:u.progressiveStartup, lumen:u.lumenGI, failure:u.shaderWarmupFailure,
            warmup:u.shaderWarmupProfile?.at(-1), preparing:u.viewportPreparation, audit:u.viewportShaderAudit }
        })()`)
        await save()
        throw error
      }
      report.samples[name].readyAtEndOfSampleMs = performance.now() - started
      if(cacheBefore){
        const after=await browser.evaluate('({...roofWallScene().scene.userData.lumenGI})')
        report.samples[name].lumen={cacheBuilds:after.geometryBuilds-cacheBefore.geometryBuilds,bvhBuilds:after.bvhBuilds-cacheBefore.bvhBuilds,relights:after.relights-cacheBefore.relights,invalidation:after.invalidation}
      }
      const native = await browser.evaluate(`(() => {
        const s = roofWallScene(), audit = s.gl.getContext().__rendererAudit
        return { compiles:audit.compileCalls, links:audit.linkCalls, events:s.scene.userData.viewportShaderAudit.events.slice(),
          firstUse:s.scene.userData.getRendererHealth().events.filter(e=>e.type==='shader-first-use'), origins:s.scene.userData.viewportShaderAudit.programOrigins }
      })()`)
      report.samples[name].compiles = native.compiles - lastNative.compiles
      report.samples[name].links = native.links - lastNative.links
      report.shaderEvents = native.events
      report.firstUse = native.firstUse
      report.programOrigins = native.origins
      lastNative = native
      await save()
      if(cacheBefore && ['selection','sunlight','sunlightMotion','sunlightIntensity'].includes(name))assert.equal(report.samples[name].lumen.cacheBuilds,0)
      if(cacheBefore && name==='selection')assert.equal(report.samples[name].lumen.relights,0)
      assert.ok(report.samples[name].cpuSubmitMs.count > 0, 'No submitted frames for ' + name)
      assert.deepEqual(report.samples[name].errors, [])
    }
    report.passProfile = await browser.evaluate(`(async () => (await audit.sample(2500,true,true)).passes.map(p=>({
      name:p.name, cpuMs:p.cpuMsPerFrame, gpuMs:p.gpuMs.mean == null ? null : p.gpuMs.mean*p.executionsPerFrame,
      draws:p.drawCallsPerFrame, triangles:p.trianglesPerFrame })))()`)
    report.traversal = await browser.evaluate('audit.countSceneOperations(true)')
    report.allocations = await browser.evaluate(`(() => {const s = audit.snapshot();return {
      textures:s.textures.filter(t=>!t.deletedAt), renderTargets:s.targets.filter(t=>!t.disposed),
      renderbuffers:s.renderbuffers.filter(t=>!t.deletedAt) }})()`)
    await save()
    assert.deepEqual(browser.errors, [])
    assert.deepEqual(report.shaderEvents, [], 'Native shader activity between initial readiness and the end of editing')
    assert.ok(Object.values(report.samples).every(p => p.links === 0 && p.compiles === 0), 'Stage A interaction shader gate failed')
  }
} finally { browser.close() }
