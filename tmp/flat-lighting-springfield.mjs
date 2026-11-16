import {projectFileInputFixtureSource} from '../tests/browser/projectFileInputFixture.mjs'
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
const b=await lightingBrowser(),out='tmp/flat-lighting/springfield'
mkdirSync(out,{recursive:true})
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1488,height:1050,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>new File([await(await fetch('/springfield_14.json')).text()],'springfield_14.json')}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?lightingDiagnostics&giSH=2'})
 await b.wait('!!window.perfScene?.()',240000)
 await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await b.wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
 await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 for(let i=0;i<450;i++){
  await new Promise(r=>setTimeout(r,2000))
  const state=await b.evaluate(`({status:perfScene().scene.userData.indirectLighting,warm:perfScene().scene.userData.shaderWarmupPending,overlay:!!document.querySelector('.viewport-preparing-overlay'),text:document.querySelector('[aria-label="3D engine status"]')?.textContent})`)
  if(i%10===0)console.log(JSON.stringify({state,errors:b.errors}).slice(0,3000))
  if(state.status?.probes>300&&state.status.state==='ready'&&!state.status.volumePending&&!state.status.pendingUpdate&&!state.overlay&&!state.warm)break
  if(i===449)throw Error('Springfield bake did not complete')
 }
 await b.evaluate(`(()=>{const s=perfScene();document.querySelector('.editor-grid').style.gridTemplateColumns='100px 8px minmax(360px,1fr)';s.camera.position.set(10.3,4.15,11.15);s.camera.lookAt(10.3,4.05,5.9);s.camera.updateMatrixWorld();s.invalidate()})()`)
 await new Promise(r=>setTimeout(r,2000))
 if(process.argv.includes('--interactive')){
  console.log('READY FOR MEASUREMENTS')
  let last=''
  while(true){
   const path='tmp/flat-lighting/command.json'
   if(existsSync(path)){
    const text=readFileSync(path,'utf8')
    if(text!==last){last=text;const task=JSON.parse(text);if(task.stop)break
     try{const result=await b.evaluate(task.expression);writeFileSync(out+'/'+task.name+'.json',JSON.stringify(result??null,null,2));if(task.screenshot)writeFileSync(out+'/'+task.name+'.png',Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'));console.log('DONE',task.name)}
     catch(error){writeFileSync(out+'/'+task.name+'-error.txt',String(error));console.log('ERROR',task.name,String(error).slice(0,500))}
    }
   }
   await new Promise(r=>setTimeout(r,250))
  }
 }else{
 const measurements=await b.evaluate(`(async()=>{const m=await import('/tests/browser/flatIndirectLighting.ts');return m.measureSpringfieldLanding()})()`)
 writeFileSync(out+'/measurements.json',JSON.stringify(measurements,null,2))
 const materials={}
 for(const [name,mode,strength,fill]of [['combined','Final composite',1],['direct','Direct lighting only',1],['indirect','Probe indirect only',1],['gi-off','Final composite',0],['no-fill','Final composite',1,0]]){
  materials[name]=await b.evaluate(`(async()=>{const m=await import('/tests/browser/flatIndirectLighting.ts');return m.captureLandingMaterial('${mode}',${strength},${fill??'undefined'})})()`)
  await b.evaluate(`houseDesignerLighting.setMode('${mode}');perfScene().scene.userData.getIndirectUniforms().hdGIProbeStrength.value=${strength};${fill===0?'perfScene().scene.userData.getIndirectUniforms().hdGIIndoorFill.value=0;':''}perfScene().invalidate()`)
  await new Promise(r=>setTimeout(r,600))
  writeFileSync(out+'/'+name+'.png',Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await b.evaluate(`perfScene().scene.userData.getIndirectUniforms().hdGIProbeStrength.value=1;perfScene().scene.userData.getIndirectUniforms().hdGIIndoorFill.value=.32`)
 }
 writeFileSync(out+'/materials.json',JSON.stringify(materials,null,2))
 await b.evaluate(`houseDesignerLighting.setMode('Final composite');perfScene().invalidate()`)
 await new Promise(r=>setTimeout(r,300))
 }
 writeFileSync(out+'/initial.png',Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 writeFileSync(out+'/initial.json',JSON.stringify(await b.evaluate(`({status:perfScene().scene.userData.indirectLighting,performance:perfScene().scene.userData.getLightingPerformance?.(),uniforms:Object.fromEntries(Object.entries(perfScene().scene.userData.getIndirectUniforms?.()??{}).filter(([k,v])=>typeof v.value==='number').map(([k,v])=>[k,v.value]))})`),null,2))
 console.log('CAPTURED',JSON.stringify(b.errors).slice(0,2500))
}finally{b.close()}
