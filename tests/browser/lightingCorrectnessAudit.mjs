// Actual Colin house, fixed inputs, completed field; never edits the saved project.
import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'

const b=await lightingBrowser(),port=process.argv[2]??5180,out=process.argv[3]??'docs/lighting-correctness/baseline'
mkdirSync(out,{recursive:true})
try {
  await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
  const restore=process.argv.find(a=>a.startsWith('--restore='))?.slice(10)
  if(restore){const cache=JSON.parse(readFileSync(restore,'utf8'));if(process.argv.includes('--freeze-cache'))cache.captureVisibilityVersion=1;await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}}`})}
  const fresh=process.argv.includes('--fresh')
  if(fresh&&!restore){const saved=JSON.parse(readFileSync('colin_house_v2.json','utf8')).indirectLighting;await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify({...saved,projectKey:'audit-fresh-no-cache-restore'})}}}`})}
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&lightingDiagnostics&lightingProfile&${process.argv.includes('--candidate')?'giSpatial=occluder-local&':''}${process.argv.includes('--legacy-sky')?'legacyDiagnosticSky&':''}${restore||fresh?'saved-gi':'saved-colin'}`})
  await b.wait('!!window.roofWallScene?.()',120000)
  await b.evaluate(`(()=>{const style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);roofWallScene().gl.setPixelRatio(1);roofWallScene().invalidate()})()`)
  const start=Date.now();let last=0
  while(true){
    const status=await b.evaluate(`({gi:roofWallScene().scene.userData.indirectLighting,startup:roofWallScene().scene.userData.progressiveStartup,shader:roofWallScene().scene.userData.shaderWarmupPending})`)
    if(Date.now()-last>15000){console.log('PREPARING',JSON.stringify({generation:status.gi?.generation,state:status.gi?.state,completed:status.gi?.completed,total:status.gi?.total,pass:status.gi?.pass,probes:status.gi?.probes,startup:status.startup?.phase,shader:status.shader}));last=Date.now()}
    if(status.gi?.state==='ready'&&!status.gi.pendingUpdate&&!status.gi.volumePending&&!status.gi.saving&&status.startup?.phase==='full'&&!status.shader)break
    assert.ok(Date.now()-start<900000,'completed GI field must become ready')
    assert.deepEqual(b.errors,[]);await new Promise(r=>setTimeout(r,500))
  }
  console.log('READY')
  await b.wait('!!roofWallScene().scene.userData.getBakedIndirectLighting?.()',300000)
  const cache=await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()')
  assert.ok(cache);writeFileSync(process.argv.find(a=>a.startsWith('--cache-output='))?.slice(15)??'tmp/lighting-correctness-cache.json',JSON.stringify(cache))
  const hash=p=>createHash('sha256').update(p.encoding==='gzip-base64'?gunzipSync(Buffer.from(p.data,'base64')):Buffer.from(p.data,'base64')).digest('hex')
  writeFileSync(`${out}/field-checksum.json`,JSON.stringify({captureVisibilityVersion:cache.captureVisibilityVersion,probes:cache.layout.probes.length,positions:hash(cache.positions),mask:hash(cache.mask),coefficients:cache.coefficients.map(hash),volume:hash(cache.volume),floor:hash(cache.floorLayer.data),sky:cache.skyCoefficients?.map(hash)},null,2))
  if(fresh)writeFileSync(`${out}/fresh-bake.json`,JSON.stringify(await b.evaluate('({...roofWallScene().scene.userData.indirectLighting})'),null,2))
  await b.evaluate(`houseDesignerLighting.setMode('Sky lighting only')`)
  await b.wait('!!houseDesignerLighting.components().packed',300000)
  await b.evaluate(`houseDesignerLighting.setMode('Final composite')`)
  await new Promise(r=>setTimeout(r,500))
  await b.evaluate(`(async()=>{const m=await import('/tests/browser/lightingCorrectnessInstrumentation.ts');window.correctness=await m.installLightingCorrectnessAudit(roofWallScene())})()`)
  const settings=await b.evaluate('correctness.settings()')
  writeFileSync(`${out}/settings.json`,JSON.stringify(settings,null,2));console.log('SETTINGS',JSON.stringify({width:settings.width,height:settings.height,probes:settings.probes,renderer:settings.renderer,packedEquivalence:settings.packedEquivalence,instrumentationEquivalence:settings.instrumentationEquivalence}))
  // The complete driver below deliberately uses the same browser/field throughout.
  if(process.argv.includes('--inspect')){
    const png=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/inspect.png`,Buffer.from(png.data,'base64'))
  }else{
    const {runAudit}=await import('./lightingCorrectnessDriver.mjs');await runAudit(b,out)
  }
  assert.deepEqual(b.errors,[])
}finally{b.close()}
