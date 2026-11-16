import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
import {projectFileInputFixtureSource} from '../tests/browser/projectFileInputFixture.mjs'
const out='tmp/bedroom-daylight-audit';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),status={}
const save=()=>writeFileSync(`${out}/status.json`,JSON.stringify({...status,errors:b.errors},null,2))
async function wait(expression){const end=Date.now()+600000;while(!await b.evaluate(expression)){status.current=await b.evaluate('window.perfScene?.()?.scene.userData.indirectLighting');save();if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,1000))}}
const shot=async name=>writeFileSync(`${out}/${name}.png`,Buffer.from((await b.call('Page.captureScreenshot',{format:'png'})).data,'base64'))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1488,height:1050,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>{const p=await(await fetch('/tmp/flat-lighting/audit-landing-legacy/daylight-fixture.json')).json();p.threeDView.exposureStops=0;p.threeDView.ambientLighting.ambientTerm=0;p.threeDView.ambientLighting.nightAmbientTerm=0;return new File([JSON.stringify(p)],'springfield_14.json')}}];`})
 await b.call('Page.navigate',{url:'http://127.0.0.1:5188/tests/browser/editorRegression.html?lightingDiagnostics&giSH=2'})
 await wait('!!window.perfScene?.()');await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`);await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 await wait(`(()=>{const s=perfScene()?.scene.userData,i=s?.indirectLighting;return i?.probes>300&&i.state==='ready'&&!i.volumePending&&!i.pendingUpdate&&!s.shaderWarmupPending&&!document.querySelector('.viewport-preparing-overlay')})()`)
 await b.evaluate(`(()=>{const s=perfScene();document.querySelector('.editor-grid').style.gridTemplateColumns='100px 8px minmax(360px,1fr)';s.camera.position.set(7.5,4.15,4);s.camera.lookAt(10,4.1,3.5);s.camera.updateMatrixWorld();s.invalidate();document.querySelector('[aria-label="Lighting diagnostics"]').style.visibility='hidden'})()`)
 await new Promise(r=>setTimeout(r,1500));await shot('bedroom-0ev')
 status.stage='reference';save()
 const measurements=await b.evaluate(`(async()=>{
 const s=perfScene(),{Vector3,Vector2,Matrix3,Matrix4,Raycaster,Mesh}=await import('/tests/browser/rendererTestModules.ts')
 const {isSelectionDecoration}=await import('/src/shaderWarmup.ts')
 const {createIndirectVisibility}=await import('/src/indirectVisibility.ts'),{inspectIndirectPoint}=await import('/src/indirectLightingDiagnostic.ts')
 const visibility=createIndirectVisibility(s.scene),ray=new Raycaster(),points=[],probes=[]
 try{
  const aperture=[[-.3,0,-1],[0,0,-1],[.3,0,-1]].map(d=>{const hit=visibility.hit(new Vector3(7.8,4.1,1.9),new Vector3(...d).normalize(),80);return{direction:d,blocked:!!hit,distance:hit?.distance}})
  for(const [name,x,y]of [['upper wall',.2,.5],['right wall',.6,.2],['wardrobe',-.15,0],['floor',0,-.6],['window-side wall',-.7,.2]]){
   ray.setFromCamera(new Vector2(x,y),s.camera);const hit=ray.intersectObjects(s.scene.children,true).find(h=>{
    if(!(h.object instanceof Mesh)||!h.face||isSelectionDecoration(h.object))return false
    for(let parent=h.object;parent;parent=parent.parent)if(!parent.visible)return false
    const m=Array.isArray(h.object.material)?h.object.material[h.face.materialIndex??0]:h.object.material
    return m.visible&&(!m.transparent||m.opacity>.99)
   })
   if(!hit)continue
   const matrix=hit.object.matrixWorld.clone();if(hit.object.isInstancedMesh&&hit.instanceId!==undefined){const instance=new Matrix4();hit.object.getMatrixAt(hit.instanceId,instance);matrix.multiply(instance)}
   const normal=hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(matrix)).normalize();if(normal.dot(ray.ray.direction)>0)normal.negate()
   const point={name,position:hit.point.toArray(),normal:normal.toArray(),geometricNormal:normal.toArray()};points.push(point)
   const diagnostic=s.scene.userData.lightingDiagnostics.snapshot()
   probes.push({name,point:point.position,inspection:inspectIndirectPoint(diagnostic.display??diagnostic.field,visibility,hit.point,normal,[],diagnostic.direct)})
  }
  const {snapshotReferenceScene}=await import('/tests/browser/sceneReferenceSnapshot.ts'),snapshot=await snapshotReferenceScene(s)
  const reference=await new Promise((resolve,reject)=>{const worker=new Worker('/tests/browser/lightingCorrectnessReference.worker.ts',{type:'module'});worker.onmessage=e=>{if(e.data.progress)return;worker.terminate();e.data.ok?resolve(e.data):reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({scene:snapshot.data,points,samples:2048,maxEncounters:6})})
  return{aperture,points,probes,reference,sky:snapshot.data.skyBase,sun:snapshot.data.sunIrradiance,lamps:snapshot.data.lights.length}
 }finally{visibility.dispose()}
})()`)
 writeFileSync(`${out}/measurements.json`,JSON.stringify(measurements,null,2))
 status.stage='measured';save();console.log('SAVED '+out)
}catch(error){status.error=String(error);save();throw error}finally{b.close()}
