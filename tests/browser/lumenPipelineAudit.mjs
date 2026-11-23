import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { roomViews } from './lumenRoomViews.mjs'

export async function runLumenPipelineAudit({browser,evaluate,capture,select,report,save,folder,mode,landing}) {
  const view=landing?'landing':'room',tag=view+'-'+mode
  const uv=landing?{carpet:[.53,.84],wall:[.38,.53],ceiling:[.46,.085]}:
    {leftWall:[.38,.53],backWall:[.63,.52],ceiling:[.46,.085],floor:[.53,.84],reveal:[260/1585,520/934],patioWall:[.681,.54]}
  const status='roofWallScene().scene.userData.lumenGI'
  await browser.wait(`${status}?.bounceReady`,360000)
  await evaluate(async()=>{
    const s=roofWallScene(),{installRendererAudit}=await import('/tests/browser/rendererAuditProbe.js')
    window.audit=await installRendererAudit(s)
    await audit.configure({giShader:false,probeGI:false})
  })
  const native=()=>browser.evaluate('({...roofWallScene().scene.userData.viewportShaderAudit.totals})')
  report.nativeBefore=await native()
  report.composition=await evaluate(async()=>{
    const {checkLumenComposition}=await import('/tests/browser/lumenComposition.ts')
    return checkLumenComposition()
  })
  report.feedbackControl=await evaluate(async()=>{
    const {checkLumenFeedback}=await import('/tests/browser/lumenFeedback.ts');return checkLumenFeedback()
  })
  await save()
  assert.ok(report.composition.every(r=>r.maxLinearError<=.002 && r.maxDisplayError<=1),JSON.stringify(report.composition))
  if(mode==='pipeline-after'){
    for(const [i,actual] of report.feedbackControl.sweeps.entries()){
      for(const [name,expected] of Object.entries(report.feedbackControl.expected[i]))assert.ok(Math.abs(actual[name]-expected)<.00004)
    }
  }
  await evaluate(()=>{window.restoreLumen=audit.lumenDirectOnly(true)})
  try{await capture(tag+'-direct')}finally{await evaluate(()=>window.restoreLumen())}
  report.layers={}
  for(const [value,label] of [[22,'gi-one'],[21,'gi-16'],[0,'final']]){
    await select('Lumen GI view',value)
    await browser.wait(`roofWallScene().scene.userData.lumenOptions.diagnostic===${value}`)
    await capture(tag+'-'+label)
    const data=await evaluate((uv,value)=>audit.captureLumenLinear(uv,value===0),uv,value)
    report.layers[label]=data.samples
    if(data.image)await writeFile(new URL(tag+'-linear.png',folder),Buffer.from(data.image.split(',')[1],'base64'))
  }
  report.diagnosticGainError=Math.max(...Object.keys(uv).flatMap(k=>report.layers['gi-16'][k].map((v,c)=>Math.abs(v-16*report.layers['gi-one'][k][c]))))
  assert.ok(report.diagnosticGainError<.008,`The rendered diagnostic gain diverged by ${report.diagnosticGainError}`)
  const {data:components,info}=await sharp(await readFile(new URL(tag+'-final.png',folder))).removeAlpha().raw().toBuffer({resolveWithObject:true})
  report.displayed=Object.fromEntries(Object.entries(uv).map(([name,[u,v]])=>{
    const offset=(Math.floor(v*info.height)*info.width+Math.floor(u*info.width))*3
    return [name,Array.from(components.subarray(offset,offset+3))]
  }))
  report.pixels=await evaluate(async uv=>{
    const samples={};for(const [name,point] of Object.entries(uv))samples[name]=await roofWallScene().scene.userData.inspectLumenPixel(...point)
    return samples
  },uv)
  await save()
  report.reference=await evaluate(async pixels=>{
    const {checkLumenPixels}=await import('/tests/browser/lumenPixelReference.ts');return checkLumenPixels(roofWallScene(),pixels,true)
  },report.pixels)
  if(!landing){
    await evaluate(()=>audit.configure({ao:false,giShader:false,probeGI:false}))
    report.withoutAO=await evaluate(async uv=>{
      const samples={};for(const [name,point] of Object.entries(uv)){
        const p=await roofWallScene().scene.userData.inspectLumenPixel(...point)
        samples[name]={base:p.baseSceneLinear,compositedIndirect:p.compositedIndirect}
      }
      return samples
    },uv)
    await evaluate(()=>audit.configure({giShader:false,probeGI:false}))
  }
  const fixed=Object.fromEntries(Object.entries(report.reference).filter(([,r])=>r.hit && !r.unmatched).map(([name,r])=>[name,r.hit]))
  const cache=()=>evaluate(points=>audit.readLumenWorld(points),fixed)
  const worldStatus=()=>browser.evaluate(`(({geometryBuilds,bvhBuilds,cacheHits,cacheMisses})=>({geometryBuilds,bvhBuilds,cacheHits,cacheMisses}))(${status})`)
  const screen=()=>evaluate(async points=>{
    const s=roofWallScene(),out={}
    for(const [name,{position}] of Object.entries(points)){
      const projected=s.camera.position.clone().fromArray(position).project(s.camera)
      if(Math.abs(projected.x)>.98 || Math.abs(projected.y)>.98 || Math.abs(projected.z)>1)continue
      const uv=[projected.x*.5+.5,.5-projected.y*.5],p=await s.scene.userData.inspectLumenPixel(...uv)
      const error=Math.hypot(...position.map((v,c)=>v-p.receiverPositionMaterial[c]))
      if(error<=.09 && p.receiverPositionMaterial[3]>=0)out[name]={sampleDistance:error,indirect:p.compositedIndirect}
    }
    return out
  },fixed)
  const measureWorld=async stage=>({stage,lighting:await cache(),screen:await screen(),status:await worldStatus()})
  report.world=[await measureWorld('start')]
  if(!landing){
    for(const [stage,offset] of [['near patio',-3.30],['back from patio',0],['opposite wall',2.76],['return',0]]){
      await evaluate(async({position,offset})=>{
        const s=roofWallScene();s.camera.position.set(position[0],position[1],position[2]+offset)
        s.camera.updateMatrixWorld(true)
        for(let i=0;i<5;i++){s.scene.userData.displayEffectRevision++;s.invalidate();await new Promise(requestAnimationFrame)}
      },{position:roomViews.room.position,offset})
      await browser.wait(`${status}?.state==='ready' && ${status}.bounceReady && !${status}.refining`,360000)
      report.world.push(await measureWorld(stage))
    }
    await capture(tag+'-returned')
    const [initial,returned]=await Promise.all(['final','returned'].map(async name=>
      sharp(await readFile(new URL(tag+'-'+name+'.png',folder))).resize(320).removeAlpha().raw().toBuffer()))
    assert.equal(initial.length,returned.length)
    report.returnedMAE=initial.reduce((sum,value,i)=>sum+Math.abs(value-returned[i]),0)/initial.length
  }
  report.nativeAfter=await native();await save()
  if(mode==='pipeline-after'&&!landing){
    for(const sample of report.world.slice(1)){
      assert.deepEqual(sample.status,report.world[0].status)
      assert.deepEqual(sample.lighting,report.world[0].lighting)
    }
  }
  assert.deepEqual(report.nativeAfter,report.nativeBefore)
  assert.deepEqual(browser.errors,[])
}
