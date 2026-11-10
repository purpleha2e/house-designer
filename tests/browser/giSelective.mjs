import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {lightingBrowser} from './lightingHarness.mjs'
import {gzipSync} from 'node:zlib'
const port=process.argv[2]??5181,flags=new Set(process.argv.slice(3)),out=process.env.GI_SELECTIVE_OUT??'docs/gi-selective',b=await lightingBrowser()
mkdirSync(out,{recursive:true});const save=(name,value)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2))
const cache=readFileSync('docs/gi-next/baseline/field-cache.json','utf8')
try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${cache}}}`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi&lightingProfile`})
  await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
  await b.evaluate(`(async()=>window.view=(await import('/tests/browser/giSpatialHouse.ts')).spatialHouseView(roofWallScene()))()`)
  save('provenance',{date:new Date().toISOString(),flags:[...flags],projectSHA256:createHash('sha256').update(readFileSync('colin_house_v2.json')).digest('hex'),cacheSHA256:createHash('sha256').update(cache).digest('hex'),state:await b.evaluate('view.status()')})
  if(flags.has('--bvh')){console.log('BENCHMARK 60,000 rays, five transforms, alternating order, seven repetitions');const result=await b.evaluate(`import('/tests/browser/giNextAcceleration.ts').then(m=>m.accelerationExperiment(roofWallScene(),{samples:60000,repeats:7}))`);save('acceleration',result);assert.ok(result.results.every(r=>r.hitMismatch===0&&r.anyMismatch===0&&r.identityMismatch===0&&r.maxDistanceError<.0001));console.log(JSON.stringify(result.results.map(r=>({label:r.label,timings:r.timings}))))}
  if(flags.has('--local')){
    const previous=JSON.parse(readFileSync('docs/gi-next/experiments/surface.json')),reference=JSON.parse(readFileSync('docs/gi-next/experiments/surface-reference.json')),detailed=JSON.parse(readFileSync('docs/gi-next/baseline/reference.json'))
    await b.evaluate(`window.localInput=${JSON.stringify({previous,reference,detailed})};true`)
    await b.evaluate(`window.localDone=undefined;window.localError=undefined;import('/tests/browser/giSelectiveSurface.ts').then(m=>m.selectiveExperiment(roofWallScene(),localInput)).then(r=>window.localDone=r,e=>window.localError=String(e));true`)
    const started=Date.now();let last=0;while(!await b.evaluate('!!window.localDone||!!window.localError')){if(Date.now()-last>15000){console.log('LOCAL',await b.evaluate('roofWallScene().scene.userData.selectiveProgress'));last=Date.now()}assert.ok(Date.now()-started<600000);await new Promise(r=>setTimeout(r,500))}
    assert.equal(await b.evaluate('window.localError'),undefined);save('local',await b.evaluate('window.localDone'))
  }
  if(flags.has('--display')){
    const local=JSON.parse(readFileSync('docs/gi-selective/surface/local.json'));const input={points:local.points.map(p=>({cohort:p.cohort,face:p.face,barycentric:p.barycentric,volume:p.volume})),experiments:local.experiments.filter(e=>e.budget===32).map(e=>({seed:e.seed,values:e.values.map(v=>({replace:v.replace}))}))}
    await b.evaluate(`window.displayInput=${JSON.stringify(input)};true`)
    await b.evaluate(`import('/tests/browser/giSelectiveDisplay.ts').then(m=>window.display=m.selectiveDisplay(roofWallScene(),displayInput))`)
    const runs=[];for(let i=0;i<8;i++)runs.push(await b.evaluate(`(()=>{display.setRun(${i});return{seed:displayInput.experiments[${i}].seed,values:display.predictions()}})()`));save('stored',{runs,metadata:await b.evaluate('display.metadata()')})
    await b.evaluate(`(()=>{const style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);roofWallScene().gl.setPixelRatio(1);display.setRun(0)})()`)
    await b.wait('roofWallScene().gl.domElement.height===740');await b.evaluate('new Promise(r=>setTimeout(r,250))');const cameras=JSON.parse(readFileSync('docs/gi-next/baseline/cameras.json')).filter(c=>c.id==='sofa-rear');cameras.push({id:'sofa-left',position:[1.2,1.8,15.5],lookAt:[2.5,.65,16.3]},{id:'sofa-right',position:[1.2,1.8,17.5],lookAt:[2.5,.65,16.3]})
    const captureChecks=[]
    for(const camera of cameras){await b.evaluate(`view.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},65)`);for(const white of [false,true]){
      let baseline,changed
      for(const [index,mode]of [0,1,0].entries()){
        await b.evaluate(`display.setMode(${mode});roofWallScene().gl.compileAsync(roofWallScene().scene,roofWallScene().camera).then(()=>true)`)
        await b.evaluate(`(async()=>{for(let i=0;i<6;i++)await view.capture(${white});return true})()`)
        const frame=await b.evaluate(`view.capture(${white})`),hash=createHash('sha256').update(frame.hdr).digest('hex')
        if(index===2){captureChecks.push({camera:camera.id,white,baseline,changed,restored:hash,restoresExactly:hash===baseline,changes:changed!==baseline});save('capture-checks',captureChecks);continue}
        if(index===0)baseline=hash;else changed=hash
        const png=await b.call('Page.captureScreenshot',{format:'png'}),name=`${camera.id}-${white?'white':'authored'}-${mode?'local':'production'}`;writeFileSync(`${out}/${name}.png`,Buffer.from(png.data,'base64'));writeFileSync(`${out}/${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
      }
    }}
    assert.ok(captureChecks.every(c=>c.restoresExactly&&c.changes),'Capture modes must change HDR and restore baseline exactly')
    const frames=[];for(const mode of [0,1,1,0,0,1]){await b.evaluate(`display.setMode(${mode})`);frames.push({mode,result:await b.evaluate('view.performance()')})}save('frames',frames);save('display-metadata',await b.evaluate('display.metadata()'));await b.evaluate('display.dispose()')
  }
  save('browser-errors',b.errors);assert.deepEqual(b.errors,[]);await b.evaluate('view.dispose()')
}catch(error){save('failure',{error:String(error),errors:b.errors});throw error}finally{b.close()}



