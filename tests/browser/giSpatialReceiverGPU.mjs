import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),port=process.argv[2]??5180,points=JSON.parse(readFileSync('docs/lighting-correctness/verified/reference.json','utf8')).results.map(p=>({name:p.name,camera:p.camera,position:p.position,normal:p.normal,geometricNormal:p.geometricNormal}))
try{
 for(const stage of ['baseline','candidate']){
  const cache=JSON.parse(readFileSync(`tmp/gi-spatial-${stage}-cache.json`,'utf8'))
  await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}}`})
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi${stage==='candidate'?'&giSpatial=occluder-local':''}`})
  await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.indirectLighting.pendingUpdate&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
  const result=await b.evaluate(`(async()=>{const s=roofWallScene(),old=s.internal.active;s.internal.active=false;try{const m=await import('/tests/browser/giSpatialReceiverGPU.ts');return{receivers:await m.sampleSpatialReceiversGPU(s,${JSON.stringify(points)}),mode:s.scene.userData.getLightingField().spatialInterpolation,source:s.scene.userData.indirectLighting.source,generation:s.scene.userData.indirectLighting.generation,glError:s.gl.getContext().getError()}}finally{s.internal.active=old}})()`)
  assert.equal(result.glError,0);assert.equal(result.source,'saved');assert.equal(result.mode,stage==='candidate'?'occluder-local':'legacy')
  writeFileSync(`docs/gi-spatial-accuracy/${stage}/house/gpu-receivers.json`,JSON.stringify(result,null,2));console.log('PASS GPU receiver equations',stage,result.receivers.length)
  const path=`docs/gi-spatial-accuracy/${stage}/house/experiment.json`,experiment=JSON.parse(readFileSync(path,'utf8'))
  const probeReference=await b.evaluate(`(async()=>{const s=roofWallScene(),m=await import('/tests/browser/sceneReferenceSnapshot.ts'),snapshot=await m.snapshotReferenceScene(s);return new Promise((resolve,reject)=>{const worker=new Worker('/tests/browser/giSpatialReferenceProbes.worker.ts',{type:'module'});worker.onmessage=e=>{worker.terminate();if(e.data.ok)resolve(e.data);else reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({scene:snapshot.data,probes:${JSON.stringify(experiment.probes)},size:${cache.settings.diffuseProbeResolution??16}})})})()`)
  experiment.scope='Spatial diagnostics share one completed six-pass field. Ten kitchen/dining probes use eight independent paths per cube direction; the sky snapshot is already gain-scaled.';experiment.probes=probeReference.probes;experiment.independentProbeReference={pathsPerDirection:8,depth:6,skyConvention:probeReference.skyConvention};writeFileSync(path,JSON.stringify(experiment,null,2));console.log('PASS correctly normalized house probe reference',stage,experiment.probes.length)
 }
 assert.deepEqual(b.errors,[])
}finally{b.close()}
