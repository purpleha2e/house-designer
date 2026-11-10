import fs from 'node:fs'
import {gzipSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {lightingBrowser} from './lightingHarness.mjs'
const out='docs/door-pipeline';fs.mkdirSync(out,{recursive:true})
const r=JSON.parse(fs.readFileSync('docs/door-confidence/original-results.json')),ids=[...new Set(r.points.flatMap(p=>p.links.filter(l=>l.central).map(l=>l.index)))]
const b=await lightingBrowser()
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1310,height:888,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='#root,.editor-pane{height:888px!important}';document.head.append(style)})`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5181/tests/browser/roofWallRegression.html?artefact-audit&materials&saved-colin&door-confidence-fresh'})
 await b.wait('!!window.roofWallScene?.()',120000)
 await b.evaluate(`(async()=>{const m=await import('/tests/browser/doorPipelineCapture.ts');window.pipelineCapture=m.attachDoorPipelineCapture(roofWallScene(),${JSON.stringify(ids)})})()`)
 const started=Date.now()
 while(true){
  const state=await b.evaluate('roofWallScene().scene.userData.indirectLighting');console.log(JSON.stringify({elapsed:Date.now()-started,state}))
  if(state?.state==='ready'&&!state.pendingUpdate&&!state.volumePending&&!state.saving)break
  if(Date.now()-started>600000)throw Error('Bake timeout')
  if(b.errors.length)throw Error(b.errors.join('\n'))
  await new Promise(r=>setTimeout(r,5000))
 }
 const result=await b.evaluate('pipelineCapture.finish()')
 fs.writeFileSync(`${out}/capture.json.gz`,gzipSync(JSON.stringify(result)))
 const saved=await b.evaluate('({...roofWallScene().scene.userData.getBakedIndirectLighting(),reflections:[]})')
 fs.writeFileSync(`${out}/reproduced-field.json`,JSON.stringify(saved))
 assert.equal(result.glError,0);assert.equal(result.probeCount,301);assert.equal(result.passes.length,5)
 console.log('CAPTURE COMPLETE',result.size,result.passes.map(p=>p.observedPass));assert.deepEqual(b.errors,[])
}finally{b.close()}
