import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser(),out='tmp/lighting-diagnostics'
try{
  mkdirSync(out,{recursive:true});await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/probeDaylightReference.html?probe&lightingDiagnostics`});await browser.wait('!!window.probeDaylight&&!!window.houseDesignerLighting')
  await browser.evaluate(`probeDaylight.run('overcast',6,false)`)
  const before=await browser.evaluate(`(()=>{window.diagnosticOriginalField=probeDaylight.scene.userData.getLightingField();const s=probeDaylight.scene.userData.indirectLighting;return {generation:s.generation,capturedFaces:s.capturedFaces,textures:probeDaylight.renderer.info.memory.textures}})()`),views=[]
  for(const mode of ['Final composite','Direct lighting only','Sky lighting only','Indirect reflected only','World normals','Albedo','Matte white','Probe irradiance','Probe visibility']){
    await browser.evaluate(`houseDesignerLighting.setMode('${mode}')`);await browser.wait(`houseDesignerLighting.mode==='${mode}'`)
    if(mode==='Sky lighting only')await browser.wait('probeDaylight.scene.userData.getIndirectUniforms().hdDiagnosticSkyReady.value===1')
    await new Promise(r=>setTimeout(r,250))
    const view=await browser.evaluate(`({mode:houseDesignerLighting.mode,generation:probeDaylight.scene.userData.indirectLighting.generation,faces:probeDaylight.scene.userData.indirectLighting.capturedFaces,same:diagnosticOriginalField===probeDaylight.scene.userData.getLightingField(),glError:probeDaylight.renderer.getContext().getError(),report:houseDesignerLighting.report()})`);views.push(view)
    assert.equal(view.generation,before.generation);assert.equal(view.faces,before.capturedFaces);assert.equal(view.same,true);assert.equal(view.glError,0)
    const png=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${mode.toLowerCase().replaceAll(' ','-')}.png`,Buffer.from(png.data,'base64'))
  }
  await browser.evaluate(`houseDesignerLighting.setMode('Final composite')`);await new Promise(r=>setTimeout(r,200))
  writeFileSync(`${out}/report.json`,JSON.stringify({before,views,errors:browser.errors},null,2));assert.deepEqual(browser.errors,[])
  console.log('PASS all nine diagnostic views preserve GI generation, capture count and displayed field; numeric probes and GPU timings available')
}finally{browser.close()}
