import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {cpus,totalmem} from 'node:os'
import {lightingBrowser} from './lightingHarness.mjs'
const port=process.argv[2]??5181,out=process.env.GI_NEXT_OUT??'docs/gi-next/experiments',flags=new Set(process.argv.slice(3)),b=await lightingBrowser()
mkdirSync(out,{recursive:true});const save=(name,value)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2))
const cache=readFileSync('docs/gi-next/baseline/field-cache.json','utf8'),known=[...JSON.parse(readFileSync('docs/gi-next/baseline/sofa-rear-precision.json')),...JSON.parse(readFileSync('docs/gi-next/baseline/sofa-profiles.json'))],cameras=JSON.parse(readFileSync('docs/gi-next/baseline/cameras.json'))
const ready=`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`
async function longJob(expression,key,timeout=600000){await b.evaluate(`window.${key}=undefined;window.${key}Error=undefined;(${expression}).then(v=>window.${key}=v,e=>window.${key}Error=String(e));true`);const started=Date.now();let last=0;while(!await b.evaluate(`!!window.${key}||!!window.${key}Error`)){if(Date.now()-last>15000){console.log(key,await b.evaluate('roofWallScene().scene.userData.giNextReferenceProgress??roofWallScene().scene.userData.indirectLighting.state'));last=Date.now()}assert.ok(Date.now()-started<timeout,`${key} timeout`);await new Promise(r=>setTimeout(r,500))}const error=await b.evaluate(`window.${key}Error`);assert.equal(error,undefined);return b.evaluate(`window.${key}`)}
try{
  await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
  const loadedCache=JSON.parse(cache);if(flags.has('--fresh'))loadedCache.projectKey='gi-next-force-fresh'
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(loadedCache)}}}`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi&lightingProfile`});await b.wait(ready,600000)
  console.log('READY')
  save('pipeline-profile',await b.evaluate('({status:roofWallScene().scene.userData.indirectLighting,performance:roofWallScene().scene.userData.getLightingPerformance(),startup:roofWallScene().scene.userData.progressiveStartup})'))
  await b.evaluate(`(()=>{const style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);roofWallScene().gl.setPixelRatio(1);roofWallScene().invalidate()})()`);await b.wait('roofWallScene().gl.domElement.height===740')
  await b.evaluate(`(async()=>window.nextView=(await import('/tests/browser/giSpatialHouse.ts')).spatialHouseView(roofWallScene()))()`)
  save('provenance',{date:new Date().toISOString(),flags:[...flags],cpu:cpus()[0].model,logicalCPUs:cpus().length,hostMemoryBytes:totalmem(),projectSHA256:createHash('sha256').update(readFileSync('colin_house_v2.json')).digest('hex'),cacheSHA256:createHash('sha256').update(cache).digest('hex'),settings:await b.evaluate('nextView.status()')})
  if(flags.has('--frames'))save('pristine-frames',await b.evaluate('nextView.performance()'))
  if(flags.has('--bvh')){console.log('BVH');const r=await b.evaluate(`(async()=>{const m=await import('/tests/browser/giNextAcceleration.ts');return m.accelerationExperiment(roofWallScene())})()`);save('acceleration',r);assert.ok(r.results.every(row=>row.hitMismatch===0&&row.anyMismatch===0&&row.identityMismatch===0&&row.maxDistanceError<.0001),'BVH correctness gate')}
  let surface=false
  if(flags.has('--surface')||flags.has('--depth')){
    console.log('SURFACE');save('surface',await b.evaluate(`(async()=>{window.nextSurface=(await import('/tests/browser/giNextSurface.ts')).surfaceExperiment(roofWallScene(),${JSON.stringify(known)});return {metadata:nextSurface.metadata,points:nextSurface.points,coverage:nextSurface.coverage}})()`));surface=true
    if(flags.has('--reference'))save('surface-reference',await longJob('nextSurface.reference()','surfaceReference'))
    if(flags.has('--depth')){console.log('DEPTH');save('depth-fixtures',await longJob(`import('/tests/browser/giNextDepthFixtures.ts').then(m=>m.depthFixtures(roofWallScene().gl))`,'depthFixtures'));save('depth',await longJob('nextSurface.depth()','depthResult'))}
  }
  if(flags.has('--surface')){
    for(const camera of cameras){await b.evaluate(`nextView.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},65)`)
      for(const [label,mode]of [['production',0],['vertex',1],['lightmap',2]]){
        await b.evaluate(`nextSurface.setMode(${mode})`);const frame=await b.evaluate(`nextView.capture(${flags.has('--white')})`),png=await b.call('Page.captureScreenshot',{format:'png'})
        writeFileSync(`${out}/${camera.id}-${label}.png`,Buffer.from(png.data,'base64'));writeFileSync(`${out}/${camera.id}-${label}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
        if(camera.id==='sofa-rear'&&!flags.has('--captures-only'))save(`frames-${label}`,await b.evaluate('nextView.performance()'))
      }
    }
  }
  if(surface)await b.evaluate('nextSurface.dispose()')
  await b.evaluate('nextView.dispose()')
  if(flags.has('--edits')){
    const results=[]
    for(const kind of ['sofa','sofa-return','window']){
      console.log('EDIT',kind)
      const expression=`new Promise((resolve,reject)=>{const s=roofWallScene(),started=performance.now(),old=s.scene.userData.indirectLighting.generation,root=s.scene.getObjectByName('model-transform-96cca887-d5d4-4fef-a941-c3638911c06a'),oldX=root.position.x;let geometryMs=null,firstProbeMs=null,firstDisplayedMs=null;
        ${kind.startsWith('sofa')?`window.updateRegressionFloors(floors=>floors.map(f=>({...f,models:f.models.map(m=>m.id==='96cca887-d5d4-4fef-a941-c3638911c06a'?{...m,position:{...m.position,x:m.position.x+${kind==='sofa'?.2:-.2}}}:m)})))`:`window.regressionMoveWindow(.2)`};
        const tick=()=>{const g=s.scene.userData.indirectLighting;if(geometryMs===null&&${kind.startsWith('sofa')?'root.position.x!==oldX':`!s.scene.userData.indirectScanPending&&g.generation>old`})geometryMs=performance.now()-started;if(firstProbeMs===null&&g.generation>old&&g.completed>0)firstProbeMs=performance.now()-started;if(firstDisplayedMs===null&&g.generation>old&&g.previewUpdates>0&&g.displayed)firstDisplayedMs=performance.now()-started;
          if(g.generation>old&&g.state==='ready'&&!g.volumePending&&!g.pendingUpdate&&!g.saving){resolve({kind:'${kind}',geometryMs,geometryScope:'${kind.startsWith('sofa')?'object transform observed':'new generation observed; not a direct visible-geometry measurement'}',firstProbeMs,firstDisplayedMs,completeMs:performance.now()-started,status:g,performance:s.scene.userData.getLightingPerformance()});return}if(performance.now()-started>180000){reject(Error('Edit exceeded three minutes'));return}requestAnimationFrame(tick)};requestAnimationFrame(tick)})`
      results.push(await longJob(expression,`edit${kind.replaceAll('-','')}`));save('production-edits',results)
    }
  }
  save('browser-errors',b.errors);assert.deepEqual(b.errors,[])
}catch(error){save('failure',{error:String(error),errors:b.errors});throw error}finally{b.close()}
