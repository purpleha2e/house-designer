import { lightingBrowser } from './lightingHarness.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// With Vite running: node tests/browser/roofShaderPreparation.mjs [port] [report-label]
const [port='5180',label='after']=process.argv.slice(2), out=`tmp/roof-shaders/${label}`
mkdirSync(out,{recursive:true})
const b=await lightingBrowser(), pause=ms=>new Promise(r=>setTimeout(r,ms)), report={}
const status=`(()=>{const s=roofState()?.scene,d=s?.userData;return {pending:d?.shaderWarmupPending,scan:d?.indirectScanPending,reflection:d?.indirectReflectionPending,gi:d?.indirectLighting&&{enabled:d.indirectLighting.enabled,state:d.indirectLighting.state,pending:d.indirectLighting.pendingLighting},activity:d?.viewportPreparation,phase:d?.progressiveStartup?.phase,profiles:d?.shaderWarmupProfile,preview:d?.geometryEditPreview}})()`
async function settle(label,limit=300000){const start=Date.now();let stable=0,last='';while(Date.now()-start<limit){const s=await b.evaluate(status);const next=JSON.stringify([s.pending,s.scan,s.activity?.message,s.activity?.completed,s.phase]);if(next!==last){console.log(label,Date.now()-start,next);last=next}if(s.pending===false&&!s.scan&&!s.reflection&&s.phase==='full'){if(++stable>=6)return Date.now()-start}else stable=0;await pause(500)}throw Error('Not settled '+label)}
try {
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.roofWorkerAudit=[];const NativeWorker=window.Worker;window.Worker=class extends NativeWorker {constructor(url,options){super(url,options);const record={url:String(url),started:performance.now()};roofWorkerAudit.push(record);this.addEventListener('message',()=>record.finished=performance.now());const stop=this.terminate.bind(this);this.terminate=()=>{record.terminated=performance.now();return stop()}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofShaderPreparation.html`})
 await b.wait('!!window.roofState?.() && !!document.querySelector(\'[aria-label="Project menu"]\')')
 report.startupMs=await settle('startup')
 await b.evaluate(`roofAudit.attach(roofState().gl,()=>roofState().scene.userData.viewportPreparation?.message,()=>roofState().scene.userData.projectGeneration)`)

 report.before=await b.evaluate(status)
 await b.evaluate(`roofAudit.setAction('placement');document.querySelector('[aria-label="Roof tools"]').click()`)
 await b.wait(`!!document.querySelector('[aria-label="Roof shape"]')`)
 for(const point of [{x:1.5,y:1.5},{x:6.5,y:1.5},{x:9.15,y:5.45},{x:5.3,y:9.2}]){
  await b.evaluate(`(()=>{const n=roofCreateStage().find('Circle').filter(n=>n.isListening()).sort((a,b)=>Math.hypot(a.x()/60-${point.x},a.y()/60-${point.y})-Math.hypot(b.x()/60-${point.x},b.y()/60-${point.y}))[0];if(!n||Math.hypot(n.x()/60-${point.x},n.y()/60-${point.y})>.4)throw Error('anchor');n.fire('click',{evt:new MouseEvent('click')})})()`);await pause(250)
 }
 await settle('placement')
 report.placement=await b.evaluate(status)
 await b.call('Profiler.enable');await b.call('Profiler.start')
 await b.evaluate(`roofAudit.setAction('create');window.createAt=performance.now();[...document.querySelectorAll('.roof-placement-actions button')].find(b=>b.textContent.trim()==='Create').click()`)
 report.createMs=await settle('create')
 report.cpu=(await b.call('Profiler.stop')).profile
 report.after=await b.evaluate(status)
 report.idle=[]
 for(let i=0;i<20;i++) {
  await pause(500)
  report.idle.push(await b.evaluate(`(()=>{const s=roofState().scene,a=[];s.traverse(o=>{if(o.geometry)a.push({role:o.userData.houseDesignerRole,geometry:o.geometry.uuid,attributes:Object.fromEntries(Object.entries(o.geometry.attributes).map(([k,v])=>[k,v.version]))})});return {pending:s.userData.shaderWarmupPending,profiles:s.userData.shaderWarmupProfile,geometry:a}})()`))
 }
 report.engineLog=await b.evaluate('window.houseDesignerEngineLog?.recent(200)')
 const firstIdle=report.idle[0]
 for(const sample of report.idle) {
  assert.equal(sample.pending,false,'a completed roof stays prepared while idle')
  assert.deepEqual(sample.geometry,firstIdle.geometry,'idle status updates preserve roof and gable geometry')
  assert.deepEqual(sample.profiles,firstIdle.profiles,'idle status updates do not restart resource preparation')
 }
 report.workers=await b.evaluate('roofWorkerAudit')
 report.materials=await b.evaluate(`(()=>{const a=[];roofState().scene.traverse(o=>{if(o.userData.houseDesignerRole?.startsWith('roof-')&&o.material)a.push({role:o.userData.houseDesignerRole,attributes:Object.keys(o.geometry.attributes),materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>({side:m.side,key:m.customProgramCacheKey(),type:m.type,defines:m.defines}))})});return a})()`)
 report.audit=await b.evaluate('roofAudit.snapshot()')
 const roofRoles=new Set(['roof-top','roof-shell','roof-eaves','roof-soffit','roof-underside'])
 const newRoofPrograms=report.audit.contexts.flatMap(context=>context.rows).filter(program=>program.created.action==='create' &&
   program.associations.some(material=>roofRoles.has(material.role)) && !program.cacheKey?.includes('surface-radiance'))
 report.newRoofDisplayPrograms=newRoofPrograms.length
 assert.equal(newRoofPrograms.length,0,'Create reuses roof display programs retained by startup warmup')
 assert.ok(report.materials.some(material=>material.role==='roof-top'),'the completed roof is present')
 assert.deepEqual(b.errors,[])
 console.log('RESULT',JSON.stringify({startupMs:report.startupMs,createMs:report.createMs}))
} catch(error){report.failure=String(error);report.body=await b.evaluate('document.body.textContent').catch(()=>null);console.error(error);process.exitCode=1}
finally{report.audit??=await b.evaluate('roofAudit.snapshot()').catch(()=>null);writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));b.close()}

