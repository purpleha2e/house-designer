import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {readFile,writeFile} from 'node:fs/promises'

export async function runLumenVisibilityAudit({browser,evaluate,capture,report,save,folder}){
  const ready="roofWallScene().scene.userData.lumenGI?.bounceReady && !roofWallScene().scene.userData.lumenGI.refining"
  await evaluate(async()=>{
    const {installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(roofWallScene())
    await audit.configure({giShader:false,probeGI:false})
  })
  await browser.wait(ready,240000)
  await capture('visibility-a-patches')
  report.baseline=await evaluate(async()=>{
    const {scene,gl}=roofWallScene(),p=audit.lumenPass(),u=p.traceMaterial.uniforms
    return {architecture:{patchLimit:u.patchLimit.value,traceLimit:u.traceLimit.value,rays:u.bounceRays.value,
      feedbackSamples:p.surfaceBounceMaterial.uniforms.surfaceBounceSamples.value,feedbackSweeps:p.surfaceBounceAtlases.length,
      traceSize:[p.bounce.width,p.bounce.height],gridOrigin:p.displayMaterial.uniforms.gridOrigin.value.toArray()},status:scene.userData.lumenGI,
      limits:{drawBuffers:gl.getContext().getParameter(gl.getContext().MAX_DRAW_BUFFERS),fragmentTextures:gl.capabilities.maxTextures}}
  })
  await save()
  const reference=JSON.parse(await readFile(new URL('world-image-reference.json',folder),'utf8')).reference
  const baseline=report.views['visibility-a-patches']
  assert.equal(baseline.exposure,1)
  assert.equal(baseline.fill,0)
  assert.deepEqual(baseline.lights,reference.inputs)
  assert.equal(baseline.tone,reference.toneMapping)
  assert.equal(baseline.width,reference.width)
  assert.equal(baseline.height,reference.height)
  assert.deepEqual(baseline.camera,reference.camera)
  assert.deepEqual(baseline.projection,reference.projection)
  const referencePng=await readFile(new URL('world-path-reference.png',folder))
  report.reference={...reference,file:'world-path-reference.png',sha256:createHash('sha256').update(referencePng).digest('hex')}
  await save()
  const timing=()=>evaluate(async()=>{
    const frame=await audit.sample(2400,true),pass=await audit.sample(2400,true,true)
    const trace=pass.passes.find(row=>row.name.includes('QuarterResolutionTrace')||row.name.includes('AuditExactView'))
    return {fps:frame.presentedFPS,interval:frame.frameMs,gpu:frame.gpuFrameMs,cpu:frame.cpuFrameMs,trace:trace?.gpuMs??null}
  })
  report.timing={patches:await timing()}
  await browser.wait(ready,240000)
  await save()

  await evaluate(()=>{
    window.visibilityError=null
    window.visibilityAudit=null
    import('/tests/browser/lumenVisibilityProbe.js').then(({prepareVisibilityProbe})=>prepareVisibilityProbe(roofWallScene(),audit))
      .then(value=>window.visibilityAudit=value).catch(error=>window.visibilityError=error.stack??String(error))
  })
  const completed=key=>browser.wait(`(()=>{if(window.visibilityError)throw Error(visibilityError);return !!window.${key}})()`,480000)
  await completed('visibilityAudit')
  report.bvh=await browser.evaluate('visibilityAudit.metadata')
  await save()
  console.log('visibility snapshot ready',report.bvh)
  try{
    await evaluate(()=>{
      visibilityAudit.runPairs().then(value=>window.visibilityPairs=value)
        .catch(error=>window.visibilityError=error.stack??String(error))
    })
    await completed('visibilityPairs')
    report.pairs=await browser.evaluate('visibilityPairs.summary')
    report.independentUnmapped=await browser.evaluate('visibilityPairs.independentUnmapped')
    await writeFile(new URL('visibility-world.json',folder),JSON.stringify(await browser.evaluate('visibilityPairs.world')))
    const chunks=[]
    for(let offset=0;offset<report.pairs.count;offset+=800){
      const chunk=await evaluate((offset)=>JSON.stringify(visibilityPairs.rows.slice(offset,offset+800)),offset)
      chunks.push(chunk.slice(1,-1))
    }
    await writeFile(new URL('visibility-rays.json.gz',folder),gzipSync(`[${chunks.join(',')}]`))
    await save()
    console.log('visibility paired rays ready',report.pairs.count)

    await evaluate(()=>{
      visibilityAudit.activate().then(value=>window.visibilityRender=value)
        .catch(error=>window.visibilityError=error.stack??String(error))
    })
    await completed('visibilityRender')
    report.diagnostic=await browser.evaluate('visibilityRender')
    await capture('visibility-b-exact')
    report.timing.exact=await timing()
    await browser.wait(ready,240000)
    await save()

    await evaluate(()=>{
      visibilityAudit.activateFeedback().then(value=>window.visibilityFeedback=value)
        .catch(error=>window.visibilityError=error.stack??String(error))
    })
    await completed('visibilityFeedback')
    report.exactFeedback=await browser.evaluate('visibilityFeedback')
    await capture('visibility-b-exact-feedback')
  }finally{
    await evaluate(()=>visibilityAudit.restore())
  }
  await capture('visibility-a-restored')
  await save()
}
