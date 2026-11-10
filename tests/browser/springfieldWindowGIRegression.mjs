// Real Springfield bake, with the downstairs toilet lamp switched off in an
// isolated test copy. Verify wall filtering against exact probe visibility.
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='tmp/springfield-window-gi-fixed'
mkdirSync(out,{recursive:true})
const errors=()=>b.errors.filter(e=>!/^THREE\.BufferGeometryUtils: \.merge(Attributes|Geometries)\(\) failed/.test(e))
async function wait(e){const end=Date.now()+600000;while(!await b.evaluate(e)){assert.deepEqual(errors(),[]);if(Date.now()>end)throw Error(e);await new Promise(r=>setTimeout(r,250))}}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1500,height:950,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`const f=fetch;window.fetch=(i,o)=>f(String(i?.url??i).includes('/bb35ad04a6c60479b06147e9ddd58e7e/processed/model.glb')?'/src/models/assets/interior_door_closed.glb':i,o);window.confirm=()=>false;window.showOpenFilePicker=async()=>[{getFile:async()=>{const p=await(await fetch('/springfield_14.json')).json();p.floors[0].models.find(m=>m.id==='04d995c9-4188-4e94-9bbe-f13e03af4bc5').lightEnabled=false;delete p.indirectLighting;return new File([JSON.stringify(p)],'springfield_14.json')}}];`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${process.argv[2]??5180}/tests/browser/editorRegression.html`})
 await wait('!!window.perfScene?.()')
 await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
 await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`perfScene().scene.userData.indirectLighting?.probes>300&&!document.querySelector('.viewport-preparing-overlay')`)
 await b.evaluate(`(()=>{const s=perfScene();document.querySelector('.editor-grid').style.gridTemplateColumns='200px 8px minmax(360px,1fr)';s.camera.position.set(9.85,3.9,8.3);s.camera.lookAt(10.45,3.9,11.78);s.camera.updateMatrixWorld();s.invalidate()})()`)
 await wait(`(()=>{const d=perfScene().scene.userData,g=d.indirectLighting;return d.roomLightOcclusion?.ready&&g?.state==='ready'&&g.capturedFaces>0&&!g.preparing&&!g.pendingLighting&&!g.saving})()`)
 console.log('Fresh Springfield GI ready')
 const result=await b.evaluate(`(async()=>{
  const s=perfScene(),field=s.scene.userData.getLightingField();
  const {Vector3}=await import('/tests/browser/rendererTestModules.ts');
  const {createIndirectVisibility}=await import('/src/indirectVisibility.ts');
  const {inspectIndirectPoint,sampleDisplayedIndirect}=await import('/src/indirectLightingDiagnostic.ts');
  const visibility=createIndirectVisibility(s.scene),samples=[],normal=new Vector3(0,0,-1),step=field.bounds.size/(field.volume.n-1);
  try{for(const [x,y] of [[10.5,2.9],[10.5,3.1],[11.1,3.7],[10.5,4.65]]){
    const p=new Vector3(x,y,11.6369934082),report=inspectIndirectPoint(field,visibility,p,normal,[]);
    samples.push({x,y,display:report.displayed.rgb,exact:report.exactAtShiftedSample.rgb,old:sampleDisplayedIndirect(field,1,p.clone().addScaledVector(normal,.02+.5*step),normal).rgb,coverage:report.displayed.coverage});
  }}finally{visibility.dispose()}
  return {samples,status:s.scene.userData.indirectLighting,occlusion:s.scene.userData.roomLightOcclusion};
 })()`)
 writeFileSync(out+'/result.json',JSON.stringify(result,null,2))
 for(const s of result.samples){
   assert.ok(s.coverage>.99)
   for(let c=0;c<3;c++)assert.ok(Math.abs(s.display[c]-s.exact[c])<.025+Math.abs(s.exact[c])*.15,`wall (${s.x},${s.y}) channel ${c} must agree with visible probes`)
 }
 const lower=result.samples[0]
 assert.ok(lower.old[0]>lower.display[0]*1.3,'old half-cell filter reproduces far-side light on the window wall')
 const p=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/after.png',Buffer.from(p.data,'base64'))
 assert.deepEqual(errors(),[])
 console.log('PASS window wall GI',JSON.stringify(result.samples))
}finally{b.close()}
