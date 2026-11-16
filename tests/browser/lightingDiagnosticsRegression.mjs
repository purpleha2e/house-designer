import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const browser=await lightingBrowser(),out='tmp/lighting-diagnostics'
try{
  mkdirSync(out,{recursive:true});await browser.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/probeDaylightReference.html?probe&lightingDiagnostics`});await browser.wait('!!window.probeDaylight&&!!window.houseDesignerLighting')
  await browser.evaluate(`probeDaylight.run('overcast',6,false)`)
  const material=await browser.evaluate(`(async()=>{
    const {Vector3}=await import('/tests/browser/rendererTestModules.ts');
    const {captureLandingMaterial}=await import('/tests/browser/flatIndirectLighting.ts');
    window.landingMeasurements=[[2.5,2.795,1],[.005,1.4,1],[2.5,.005,1]].map((p,i)=>{const q=new Vector3(...p).project(probeDaylight.camera);return {name:String(i),pixel:{x:Math.floor((q.x+1)*.5*probeDaylight.renderer.domElement.width),y:Math.floor((1-q.y)*.5*probeDaylight.renderer.domElement.height)}}});
    const combined=await captureLandingMaterial('Final composite',1,0),direct=await captureLandingMaterial('Direct lighting only',1,0),indirect=await captureLandingMaterial('Probe indirect only',1,0),fill=await captureLandingMaterial('Probe indirect only',1,.8),off=await captureLandingMaterial('Probe indirect only',0,.8);
    return {combined,direct,indirect,fill,off};
  })()`)
  for(let i=0;i<material.combined.length;i++)for(let c=0;c<3;c++){
    assert.ok(Math.abs(material.combined[i].rgb[c]-material.direct[i].rgb[c]-material.indirect[i].rgb[c])<.002,'linear direct + probe diffuse reconstructs the fixture without fill')
    assert.equal(material.indirect[i].rgb[c],material.fill[i].rgb[c],'probe-only excludes ambient fill')
    assert.equal(material.off[i].rgb[c],0,'disabled probes cannot contribute in probe-only view')
  }
  assert.ok(material.indirect.some(p=>p.rgb.some(v=>v>.01)),'probe-only contains measured energy')
  const before=await browser.evaluate(`(()=>{window.diagnosticOriginalField=probeDaylight.scene.userData.getLightingField();const s=probeDaylight.scene.userData.indirectLighting;return {generation:s.generation,capturedFaces:s.capturedFaces,textures:probeDaylight.renderer.info.memory.textures,programs:probeDaylight.renderer.info.programs.length}})()`),views=[]
  for(const mode of ['Final composite','Direct lighting only','Probe indirect only','Indirect irradiance false colour','Sky lighting only','Indirect reflected only','World normals','Albedo','Matte white','Probe irradiance','Probe visibility']){
    await browser.evaluate(`houseDesignerLighting.setMode('${mode}')`);await browser.wait(`houseDesignerLighting.mode==='${mode}'`)
    if(mode==='Sky lighting only')await browser.wait('probeDaylight.scene.userData.getIndirectUniforms().hdDiagnosticSkyReady.value===1')
    await new Promise(r=>setTimeout(r,250))
    const view=await browser.evaluate(`({mode:houseDesignerLighting.mode,generation:probeDaylight.scene.userData.indirectLighting.generation,faces:probeDaylight.scene.userData.indirectLighting.capturedFaces,same:diagnosticOriginalField===probeDaylight.scene.userData.getLightingField(),glError:probeDaylight.renderer.getContext().getError(),report:houseDesignerLighting.report()})`);views.push(view)
    assert.equal(view.generation,before.generation);assert.equal(view.faces,before.capturedFaces);assert.equal(view.same,true);assert.equal(view.glError,0)
    if(['Direct lighting only','Probe indirect only','Indirect irradiance false colour'].includes(mode))assert.equal(await browser.evaluate('probeDaylight.renderer.info.programs.length'),before.programs,'display mode reuses prepared programs')
    const png=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${mode.toLowerCase().replaceAll(' ','-')}.png`,Buffer.from(png.data,'base64'))
  }
  await browser.evaluate(`houseDesignerLighting.setMode('Final composite')`);await new Promise(r=>setTimeout(r,200))
  writeFileSync(`${out}/report.json`,JSON.stringify({before,views,material,errors:browser.errors},null,2));assert.deepEqual(browser.errors,[])
  console.log('PASS all eleven diagnostic views preserve GI generation, capture count and displayed field; direct/probe/false-colour switches reuse programs')
}finally{browser.close()}
