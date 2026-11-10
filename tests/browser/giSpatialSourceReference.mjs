import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),root='docs/gi-spatial-accuracy',baseline=JSON.parse(readFileSync(`${root}/baseline/house/experiment.json`,'utf8')),cache=JSON.parse(readFileSync('tmp/gi-spatial-baseline-cache.json','utf8'))
try{
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi`})
 await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
 const result=await b.evaluate(`(async()=>{const m=await import('/tests/browser/sceneReferenceSnapshot.ts'),snapshot=await m.snapshotReferenceScene(roofWallScene());return new Promise((resolve,reject)=>{const worker=new Worker('/tests/browser/giSpatialReferenceProbes.worker.ts',{type:'module'});worker.onmessage=e=>{worker.terminate();if(e.data.ok)resolve(e.data);else reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({scene:snapshot.data,probes:${JSON.stringify(baseline.probes)},size:${cache.settings.diffuseProbeResolution??16},sourceOnly:true})})})()`)
 for(const stage of ['baseline','candidate']){
  const path=`${root}/${stage}/house/experiment.json`,experiment=JSON.parse(readFileSync(path,'utf8'))
  for(const p of experiment.probes){const q=result.probes.find(q=>q.index===p.index);assert.deepEqual(p.position,q.position);p.values=p.values.map(v=>{const source=q.values.find(q=>q.normal.every((n,i)=>n===v.normal[i]));return{...v,capturedFirstPass:v.capturedSky,referenceFirstPass:source.referenceFirstPass}});p.firstPassSourceMAE=p.values.flatMap(v=>v.capturedFirstPass.map((x,c)=>Math.abs(x-v.referenceFirstPass[c]))).reduce((a,b)=>a+b,0)/18;delete p.sourceSkyMAE}
  experiment.firstPassReference={method:'Independent first hit: escaped sky, or original textured diffuse response to hard-visible sun and lamps; no indirect bounce.',sharedPhysicalScene:true}
  writeFileSync(path,JSON.stringify(experiment,null,2))
 }
 assert.deepEqual(b.errors,[]);console.log('PASS independent first-pass source reference at ten identical house probes, including direct-lit surfaces as well as escaped sky')
}finally{b.close()}
