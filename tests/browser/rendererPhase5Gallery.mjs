import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import sharp from 'sharp'
import {lightingBrowser} from './lightingHarness.mjs'
import {installNativeAudit} from './rendererAuditNative.js'
import {installBoundedAudit} from './rendererPhase5Native.js'
const out='tmp/renderer-phase5/gallery',b=await lightingBrowser(),report={comparisons:[],runs:[]},images=new Map()
mkdirSync(out,{recursive:true})
const read=name=>JSON.parse(readFileSync(`tmp/renderer-phase4/${name}.json`))
const old=read('gallery'),glass=read('gallery-glass'),stairs=read('stair-gallery')
const save=()=>writeFileSync(`${out}/results.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
async function frames(n=6){await b.evaluate(`new Promise(resolve=>{let left=${n};const tick=()=>{const s=rendererRecovery.state();s.scene.userData.displayEffectRevision=(s.scene.userData.displayEffectRevision??0)+1;s.invalidate();--left?requestAnimationFrame(tick):resolve()};requestAnimationFrame(tick)})`)}
async function ready(walk=false){await b.wait(`(()=>{const s=window.rendererRecovery?.state();if(!s)return false;const u=s.scene.userData,g=u.indirectLighting;return u.progressiveStartup?.phase==='full'&&!u.shaderWarmupPending&&!u.viewportPreparation?.pending&&${walk?"g?.state==='ready'&&!g.pendingUpdate&&!g.preparing&&!g.volumePending&&u.softFloorGI?.state==='ready'":'true'}})()`,90000)}
async function click(selector,text){
 await frames(2)
 const p=await b.evaluate(`(()=>{const a=[...document.querySelectorAll(${JSON.stringify(selector)})],e=${text?`a.find(e=>e.textContent.trim()===${JSON.stringify(text)})`:'a[0]'};if(!e||e.disabled)throw Error('Missing camera control');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
 for(const type of ['mousePressed','mouseReleased'])await b.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...p})
}
async function camera(entry,walk){
 const pose=entry.actual??entry.camera,requested=entry.camera??pose
 if(walk&&requested.floorName){
  if(!await b.evaluate("document.querySelector('.viewer-options').classList.contains('is-open')"))await click('.viewer-menu-toggle')
  if(await b.evaluate("document.querySelector('[aria-label=\"Current floor\"]').textContent")!==requested.floorName){
   await click('[aria-label="Floor navigation"] button',requested.floorName.includes('0')?'Downstairs':'Upstairs')
   await b.wait(`document.querySelector('[aria-label="Current floor"]').textContent===${JSON.stringify(requested.floorName)}`)
  }
  await click('[aria-label="Navigation mode"] button','Fly');await click('.viewer-menu-toggle');await ready(true)
 }
 await b.evaluate(`(()=>{const c=rendererRecovery.state().camera,p=${JSON.stringify(pose)};c.position.fromArray(p.position);if(p.quaternion)c.quaternion.fromArray(p.quaternion);else c.lookAt(...p.lookAt);c.fov=p.fov??55;c.updateProjectionMatrix();c.updateMatrixWorld()})()`)
 await frames()
 const actual=await b.evaluate('({position:rendererRecovery.state().camera.position.toArray(),quaternion:rendererRecovery.state().camera.quaternion.toArray(),fov:rendererRecovery.state().camera.fov})')
 assert.ok(actual.position.every((v,i)=>Math.abs(v-pose.position[i])<1e-7),'Camera must remain matched')
 return actual
}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installNativeAudit.toString()})();(${installBoundedAudit.toString()})()`})
 for(const [label,port]of [['before',5205],['after',5207]])for(const view of ['building','walk']){
  await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html?rendererShadows=single&rendererShadowSize=2048&view=${view}`})
  await ready(view==='walk');console.log('GALLERY READY',label,view)
  const run={label,view,cameras:[]};report.runs.push(run);save()
  const entries=[...old.runs.find(r=>r.label===`${view}-gallery-reference`).cameras]
  if(view==='walk')entries.push(...glass.runs[0].cameras,...stairs.poses.map(p=>({camera:{...p,id:'stair-'+p.id},actual:{...p,fov:55},stair:true})))
  for(const entry of entries){
   const id=entry.camera.id,actual=await camera(entry,view==='walk')
   await b.evaluate(`(()=>{const s=document.createElement('style');s.id='phase5-shot';s.textContent='body *{visibility:hidden!important}canvas${entry.stair?',.viewer-stair-button':''}{visibility:visible!important}';document.head.appendChild(s)})()`)
   const shot=await b.call('Page.captureScreenshot',{format:'png'}),png=Buffer.from(shot.data,'base64')
   await b.evaluate("document.getElementById('phase5-shot').remove()")
   writeFileSync(`${out}/${label}-${view}-${id}.png`,png)
   const key=view+'-'+id;run.cameras.push({id,actual})
   if(label==='before')images.set(key,png)
   else{
    const a=await sharp(images.get(key)).ensureAlpha().raw().toBuffer(),z=await sharp(png).ensureAlpha().raw().toBuffer();assert.equal(a.length,z.length)
    let changedPixels=0,maxDifference=0
    for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-z[i+c]);if(d)changed=true;maxDifference=Math.max(maxDifference,d)}if(changed)changedPixels++}
    report.comparisons.push({view,id,changedPixels,maxDifference});console.log('PIXELS',view,id,changedPixels)
   }
   const health=await b.evaluate(`(()=>{const s=rendererRecovery.state(),g=s.gl.getContext();return{lost:g.isContextLost(),error:g.getError(),failures:g.__rendererAudit.failures}})()`)
   assert.equal(health.lost,false);assert.equal(health.error,0);assert.deepEqual(health.failures,[]);save()
  }
 }
 assert.ok(report.comparisons.every(r=>r.changedPixels===0),'Lifecycle correction must preserve exact pixels')
 assert.deepEqual(b.errors,[]);report.finished=true;save()
}catch(error){report.failure=String(error.stack??error);save();throw error}finally{b.close()}
