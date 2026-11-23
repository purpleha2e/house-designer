import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'

export async function runLumenBounceAudit({browser,evaluate,capture,select,report,save,folder,mode}){
  await evaluate(async()=>{
    const s=roofWallScene(),{installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(s)
    await audit.configure({giShader:false,probeGI:false})
  })
  await browser.wait('roofWallScene().scene.userData.lumenGI.bounceReady && !roofWallScene().scene.userData.lumenGI.refining',240000)
  const write=async(name,value)=>writeFile(new URL(name+'.json.gz',folder),gzipSync(JSON.stringify(value)))
  const start=async(expression,key)=>{
    await browser.evaluate(`window.bounceStudyResult=null;window.bounceStudyError=null;void (${expression}).then(value=>window.bounceStudyResult=value,error=>window.bounceStudyError=error.stack??String(error))`)
    await browser.wait('(()=>{if(window.bounceStudyError)throw Error(window.bounceStudyError);return !!window.bounceStudyResult})()',540000)
    return browser.evaluate('window.bounceStudyResult'+(key?'.'+key:''))
  }
  if(mode==='bounce-reference'){
    await start("import('/tests/browser/lumenBounceReference.js').then(m=>m.runBounceReference(roofWallScene(),audit.lumenPass()))",'metadata')
    report.reference=await browser.evaluate('bounceStudyResult.metadata')
    report.anchors=await browser.evaluate('bounceStudyResult.anchors')
    await save()
    for(const name of ['ceiling','ceiling-fine']){
      const ground=await evaluate(name=>bounceStudyResult.ground.find(g=>g.name===name),name)
      await write('bounce-ground-reference-'+name,ground)
    }
    return
  }
  const exact=JSON.parse(await readFile(new URL('world-image-reference.json',folder),'utf8')).reference
  const referenceImage=await readFile(new URL('world-path-reference.png',folder))
  const project=await readFile(new URL('../../../lighting-test.json',folder))
  report.nativeBaseline=await browser.evaluate('({...roofWallScene().scene.userData.viewportShaderAudit.totals})')
  report.apertures=await start("import('/tests/browser/lumenBounceProbe.js').then(m=>window.bounceProbe=m.prepareBounceStudy(roofWallScene(),audit))",'metadata')
  const baselineControl=['bounce-study','bounce-candidates','bounce-budget'].includes(mode)
  if(baselineControl){
    await start("bounceProbe.build({ground:'control',samples:8,sweeps:2})",'stages')
    await start('bounceProbe.present(2)')
    report.baselineControl=true
  }
  await capture(mode+'-final')
  const image=report.views[mode+'-final']
  assert.deepEqual(image.camera,exact.camera)
  assert.deepEqual(image.projection,exact.projection)
  assert.deepEqual(image.lights,exact.inputs)
  assert.equal(image.fill,0)
  assert.equal(image.exposure,exact.exposure)
  assert.equal(image.tone,exact.toneMapping)
  assert.deepEqual([image.width,image.height],[1585,934])
  report.reference={...exact,file:'world-path-reference.png',sha256:createHash('sha256').update(referenceImage).digest('hex')}
  report.projectSha256=createHash('sha256').update(project).digest('hex')
  report.cache=await browser.evaluate('roofWallScene().scene.userData.lumenGI')
  await save()
  for(const [id,label] of [[9,'sky'],[18,'ground'],[19,'first'],[20,'later'],[22,'indirect'],[10,'support']]){
    await select('Lumen GI view',id)
    await capture(mode+'-'+label)
  }
  await select('Lumen GI view',0)
  await start(baselineControl?'bounceProbe.readWorld(2)':'bounceProbe.readWorld()','summary')
  const exportWorld=async(name)=>{
    const grids=await browser.evaluate('bounceStudyResult.summary')
    const world=[]
    for(const grid of grids)world.push(await evaluate(name=>bounceStudyResult.grids.find(g=>g.name===name),grid.name))
    await write(name,world)
  }
  await exportWorld(mode+'-world')
  await save()
  console.log(mode,'baseline and lighting components captured')
  if(mode==='bounce-after'){
    report.motion=[]
    for(const [name,offset,opposite] of [['start',0,false],['window',0,false],['patio',-2.7,false],['away',1.4,false],['opposite',1.1,true],['return',0,false]]){
      report.motion.push(await evaluate((name,offset,opposite)=>bounceProbe.move(name,offset,opposite),name,offset,opposite))
      await save()
    }
    assert.ok(report.motion.every(x=>x.changed===0))
    await capture(mode+'-return')
    assert.deepEqual(await browser.evaluate('({...roofWallScene().scene.userData.viewportShaderAudit.totals})'),report.nativeBaseline)
    return
  }
  if(!baselineControl&&mode!=='bounce-orders')return
  if(mode==='bounce-study'){
    for(const term of ['sky','ground','first','later']){
      await start(`bounceProbe.ablate(${JSON.stringify(term)})`)
      await capture(mode+'-without-'+term)
    }
  }
  if(baselineControl)await start('bounceProbe.restore()')
  const arms=mode==='bounce-orders'?[
    {name:'baseline-no-ground-seed',ground:'control',noGround:true,samples:8,sweeps:2,store:[2]},
    {name:'corrected-no-ground-seed',noGround:true,samples:8,sweeps:2,store:[2]},
  ]:mode==='bounce-budget'?[
    {name:'reveal-budget-x',ground:'reveal-budget-x',samples:8,sweeps:2,store:[2],images:[2]},
    {name:'reveal-budget-y',ground:'reveal-budget-y',samples:8,sweeps:2,store:[2],images:[2]},
    {name:'reveal-budget-16',ground:'reveal-budget-16',samples:8,sweeps:2,store:[2],images:[2]},
  ]:mode==='bounce-candidates'?[
    {name:'ground-control',ground:'control',samples:8,sweeps:2,store:[2]},
    {name:'ground-reveal',ground:'reveal',samples:8,sweeps:2,store:[2],images:[2]},
    {name:'ground-reveal-extra',ground:'reveal-extra',samples:8,sweeps:2,store:[2],images:[2]},
  ]:[
    {name:'feedback-8x4',ground:'control',samples:8,sweeps:4,store:[1,2,3,4],images:[3,4]},
    {name:'feedback-32x2',ground:'control',samples:32,sweeps:2,store:[2],images:[2]},
    {name:'feedback-32x8',ground:'control',samples:32,sweeps:8,store:[8]},
    {name:'feedback-targeted',ground:'control',samples:8,sweeps:2,targeted:true,store:[2],images:[2]},
    {name:'ground-open',ground:'open',samples:8,sweeps:2,store:[2],images:[2]},
    {name:'ground-fixed',ground:'fixed',samples:8,sweeps:2,store:[2],images:[2]},
    {name:'ground-sky16',ground:'sky16',samples:8,sweeps:2,store:[2],images:[2]},
    {name:'ground-tiles6',ground:'tiles6',samples:8,sweeps:2,store:[2],images:[2]},
  ]
  report.arms=[]
  for(const arm of arms){
    try{
      const stages=await start(`bounceProbe.build(${JSON.stringify(arm)})`,'stages')
      report.arms.push({name:arm.name,stages})
      await save()
      for(const order of arm.store){
        await start(`bounceProbe.readWorld(${order})`,'summary')
        await exportWorld(mode+'-'+arm.name+'-'+order)
        if(arm.images?.includes(order)){
          await start(`bounceProbe.present(${order})`)
          await capture(mode+'-'+arm.name+'-'+order)
        }
      }
    }finally{await start('bounceProbe.restore()')}
    console.log(mode,arm.name,'complete')
  }
}
