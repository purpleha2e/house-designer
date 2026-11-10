// Offline only: regenerate bounded program inventories and metrics from evidence.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const root='tmp/shader-preparation',out='docs/shader-preparation'
mkdirSync(`${out}/programs`,{recursive:true})
const read=p=>JSON.parse(readFileSync(p,'utf8')),sha=text=>createHash('sha256').update(text).digest('hex'),hash=p=>sha(readFileSync(p))
const stats=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return{count:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}}
const gaps=a=>a.slice(1).map((v,i)=>v-a[i])
const parameterSource=readFileSync('node_modules/three/src/renderers/webgl/WebGLPrograms.js','utf8').split('function getProgramCacheKeyParameters')[1].split('function getProgramCacheKeyBooleans')[0]
const parameters=[...parameterSource.matchAll(/array\.push\( parameters\.(\w+) \)/g)].map(m=>m[1])
const records=[]
for(const directory of readdirSync(root).filter(d=>existsSync(`${root}/${d}/report.json`))){
 const r=read(`${root}/${directory}/report.json`),programs=r.programAudit?.contexts?.flatMap(c=>c.rows)??[]
 const inventory=programs.map(p=>{
  const key=p.cacheKey,parts=key?.split(',')??[],precision=parts.findIndex(v=>['highp','mediump','lowp'].includes(v)),v=p.shaders.find(s=>s.type===35633),f=p.shaders.find(s=>s.type===35632)
  const state=precision>=0?Object.fromEntries(parameters.map((name,i)=>[name,parts[precision+i]])):undefined
  const fragmentSamplers=p.samplerUniforms.filter(u=>f?.samplers.includes(u.name.replace(/\[0\]$/,''))).reduce((sum,u)=>sum+u.size,0)
  return{...p,cacheKeySha256:key?sha(key):undefined,cacheParameters:state,vertexHash:v?.normalizedHash,fragmentHash:f?.normalizedHash,fragmentSamplerCount:fragmentSamplers,
   classification:{observedDraw:!!p.firstDraw,warmupOnly:!p.firstDraw&&p.created.operation==='compile',resourceProxyOnly:!p.firstDraw&&!!p.reflection,
    firstUseOnly:p.created.operation==='renderBufferDirect'&&!(p.created.target?.width===1&&p.created.target?.height===1),
    expensiveReflection:(p.reflection?.ms??0)>=500,potentiallyDelayable:!p.firstDraw&&p.created.operation==='compile'}}
 })
 if(inventory.length)writeFileSync(`${out}/programs/${directory}.json`,JSON.stringify(inventory,null,2))
 const grouped=new Map();for(const p of inventory){const key=p.vertexHash+':'+p.fragmentHash;(grouped.get(key)||grouped.set(key,[]).get(key)).push(p)}
 const duplicates=[...grouped.values()].filter(g=>g.length>1).map(g=>({ids:g.map(p=>p.id),keys:g.map(p=>p.cacheKeySha256),overlappingLifetime:g.some((a,i)=>g.some((b,j)=>j>i&&a.id.split(':')[0]===b.id.split(':')[0]&&(!a.deletedAt||a.deletedAt>b.createdAt)))}))
 let metrics
 if(r.prepared){const p=r.prepared,start=p.events.find(e=>e.type==='stage'&&e.stage==='fetch/decode/construct')?.at,end=r.renderer?.frameTimes.at(-1),within=at=>at>=start&&at<=end
  metrics={preparationMs:p.events.find(e=>e.type==='ready')?.totalMs,resources:r.renderer?.resources,
   mainLongTasks:stats(p.longTasks.filter(t=>within(t.at)).map(t=>t.ms)),heartbeat:stats(p.heartbeats.filter(t=>within(t.at)).map(t=>t.ms)),
   inputAcknowledgement:stats(p.inputs.map(i=>i.handlerMs)),inputToNextRaf:stats(p.inputs.filter(i=>i.nextRafAt).map(i=>i.nextRafAt-i.eventAt)),
   cameraToSubmission:stats(p.events.filter(e=>e.type==='camera-frame'&&e.id>0).map(e=>e.submittedAt-e.sentAt)),rendererIntervals:stats(gaps(r.renderer?.frameTimes??[])),gpuDisplaySamples:stats(r.renderer?.gpuSamples??[]),
   cancellation:r.final.events.some(e=>e.type==='job-settled'&&e.generation===2&&e.activeJobs===0),obsoleteRejected:r.final.events.some(e=>e.type==='rejected'),disposal:r.final.events.find(e=>e.type==='disposed')&&{lost:r.final.events.find(e=>e.type==='disposed').afterContextLoss,valid:r.final.events.find(e=>e.type==='disposed').validAfterContextLoss}}
 }else if(r.result){metrics={totalMs:r.result.totalMs,calls:r.result.calls.filter(c=>!c.name.startsWith('completion.')),initialCompletion:r.result.initialCompletion,completionBeforeReflection:r.result.completionBeforeReflection,completionPolls:r.result.calls.filter(c=>c.name==='completion.poll').length,
   heartbeat:stats(r.result.heartbeats),frames:stats(gaps(r.result.frames)),inputs:stats(r.result.inputs.map(i=>i.at-i.eventAt)),gpuMs:r.result.gpuElapsedMs,fragmentSamplers:r.result.fragmentSamplerCount,link:r.result.linkStatus,glError:r.result.glError,contextLost:r.contextLost}
 }else{metrics={initial:r.initialVisible,steps:r.steps?.map(({samples,...s})=>s),camera:r.camera,
   mainLongTasks:stats((r.raw?.tasks??[]).map(t=>t.ms)),mainRaf:stats(gaps(r.mainFrames??[])),inputAcknowledgement:stats((r.inputAcknowledgements??r.raw?.inputs??[]).map(i=>i.age??i.eventAge)),
   inputToNextRaf:stats(r.inputAcknowledgements?(r.inputAcknowledgements.filter(i=>i.nextRaf).map(i=>i.nextRaf-i.at+i.age)):(r.raw?.inputs??[]).map(i=>i.eventAge+i.ms)),state:r.state,final:r.final}}
 records.push({directory,failure:r.failure,incomplete:r.incomplete,errors:r.errors,metrics,
  programs:{created:inventory.length,reflected:inventory.filter(p=>p.reflection).length,drawn:inventory.filter(p=>p.firstDraw).length,deleted:inventory.filter(p=>p.deletedAt).length,warmupOnly:inventory.filter(p=>p.classification.warmupOnly).length,resourceProxyOnly:inventory.filter(p=>p.classification.resourceProxyOnly).length,
   maxFragmentSamplers:Math.max(0,...inventory.map(p=>p.fragmentSamplerCount)),reflection:stats(inventory.map(p=>p.reflection?.ms)),expensive:inventory.filter(p=>p.classification.expensiveReflection).map(p=>({id:p.id,threeId:p.threeId,key:p.cacheKeySha256,ms:p.reflection.ms,completion:p.reflection.completionBefore,phase:p.created.phase,role:p.created.material?.role,target:p.created.target,cacheParameters:p.cacheParameters})),duplicates,
   stages:inventory.map(p=>({id:p.id,compileCalls:p.shaders.map(s=>s.compile),link:p.link,completionObservedMs:p.completedAt&&p.link?p.completedAt-p.link.at:undefined,reflection:p.reflection,enumeration:p.uniformEnumeration,locations:p.locations,firstDraw:p.firstDraw&&{at:p.firstDraw.at,ms:p.firstDraw.ms}}))}})
}
const cpuProfiles=[]
for(const directory of readdirSync(root).filter(d=>existsSync(`${root}/${d}/cpu.cpuprofile`))){
 const p=read(`${root}/${directory}/cpu.cpuprofile`),nodes=new Map(p.nodes.map(n=>[n.id,n])),cost=new Map()
 p.samples?.forEach((id,i)=>{const f=nodes.get(id)?.callFrame;if(!f)return;const key=`${f.functionName||'(anonymous)'} ${f.url}:${f.lineNumber+1}`;cost.set(key,(cost.get(key)??0)+(p.timeDeltas[i]??0)/1000)})
 cpuProfiles.push({directory,durationMs:(p.endTime-p.startTime)/1000,topSampledSelfMs:[...cost].sort((a,b)=>b[1]-a[1]).slice(0,25)})
}
const historical=read('tmp/renderer-audit/building-single-2048-full.json'),historicalGroups=new Map()
for(const p of historical.samplers.programs){const key=p.vertexHash+':'+p.fragmentHash;(historicalGroups.get(key)||historicalGroups.set(key,[]).get(key)).push(p)}
const historicalDuplicates=[...historicalGroups.values()].filter(g=>g.length>1).map(g=>({ids:g.map(p=>p.id),names:g.map(p=>p.programName),vertexHash:g[0].vertexHash,fragmentHash:g[0].fragmentHash,keys:g.map(p=>p.cacheKey),prefixMatches:g.every(p=>p.cacheKey.slice(0,p.cacheKey.indexOf('standard-wall-shadow-receiver-v1:')>=0?p.cacheKey.indexOf('standard-wall-shadow-receiver-v1:'):100)===g[0].cacheKey.slice(0,100))}))
writeFileSync(`${out}/programs/historical-duplicates.json`,JSON.stringify({originalRetainedPrograms:historical.initial.three.programs,augmentedDiagnosticInventory:historical.samplers.programs.length,duplicates:historicalDuplicates},null,2))
const images=[]
for(const name of ['light-count','completion-gate']){
 const a=await sharp(`${root}/baseline-main/matched-camera.png`).extract({left:0,top:0,width:840,height:472}).removeAlpha().raw().toBuffer(),b=await sharp(`${root}/${name}-main/matched-camera.png`).extract({left:0,top:0,width:840,height:472}).removeAlpha().raw().toBuffer()
 let count=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)count++;max=Math.max(max,d)}images.push({reference:'baseline-main',candidate:name+'-main',width:840,height:472,differentComponents:count,maxDifference:max})
}
if(existsSync(`${root}/tour-reference-valid/matched-camera.png`)&&existsSync(`${root}/tour-final/matched-camera.png`)){
 const decoded=await Promise.all(['reference-valid','final'].map(label=>sharp(`${root}/tour-${label}/matched-camera.png`).extract({left:0,top:48,width:1000,height:620}).removeAlpha().raw().toBuffer()))
 let count=0,max=0,sum=0;for(let i=0;i<decoded[0].length;i++){const d=Math.abs(decoded[0][i]-decoded[1][i]);if(d)count++;max=Math.max(max,d);sum+=d}images.push({reference:'tour-reference-valid',candidate:'tour-final',readiness:'Both still preparing; not full enhanced-quality acceptance',crop:{left:0,top:48,width:1000,height:620},differentComponents:count,maxDifference:max,meanAbsoluteDifference:sum/decoded[0].length})
}
writeFileSync(`${out}/measurements.json`,JSON.stringify({units:'ms unless labelled counts/bytes; shader compilation completion is first observed, not driver CPU time',records,images,cpuProfiles},null,2))
const before=read(`${root}/before-hashes.json`),changed=before.filter(f=>hash(f.path)!==f.sha256).map(f=>({...f,after:hash(f.path)})),library=read(`${root}/library-hashes.json`).map(f=>({...f,unchanged:hash(f.path)===f.sha256}))
const files=['src/shaderWarmup.ts','src/components/IndirectLighting.tsx','src/components/SceneRenderer.tsx','src/components/ThreeDView.tsx','tests/shaderWarmup.test.ts','tests/browser/rendererIsolationRuntime.ts','tests/browser/shaderProgramAudit.mjs','tests/browser/shaderPreparation.html','tests/browser/shaderPreparationEntry.mjs','tests/browser/shaderPreparation.mjs','tests/browser/shaderPreparationBuild.mjs','tests/browser/shaderPreparationEditor.html','tests/browser/shaderPreparationEditor.tsx','tests/browser/shaderPreparationEditorHarness.mjs','tests/browser/shaderPreparationSimple.mjs','tests/browser/shaderSynchronization.html','tests/browser/shaderSynchronization.mjs','tests/browser/shaderSynchronizationHarness.mjs','tests/browser/shaderPreparationTour.html','tests/browser/shaderPreparationTour.tsx','tests/browser/shaderPreparationTour.mjs','scripts/shaderPreparationReport.mjs']
writeFileSync(`${out}/manifest.json`,JSON.stringify({files:files.map(path=>({path,sha256:hash(path)})),changedExistingSources:changed,authoredAndThreeUnchanged:before.filter(f=>!f.path.startsWith('src')).every(f=>hash(f.path)===f.sha256),otherSourceFilesUnchanged:before.filter(f=>!changed.some(c=>c.path===f.path)).every(f=>hash(f.path)===f.sha256),library,reportArtifacts:['REPORT.md','measurements.json','manifest.json','programs/*.json']},null,2))
console.log(JSON.stringify({records:records.map(r=>({name:r.directory,failure:r.failure,created:r.programs.created,reflectionMax:r.programs.reflection.max,taskMax:r.metrics.mainLongTasks?.max,expensive:r.programs.expensive.map(p=>({id:p.id,ms:p.ms,role:p.role}))})),images,changedSources:changed.map(f=>f.path)},null,2))
