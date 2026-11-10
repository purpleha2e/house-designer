// Recompute measurements from retained evidence; never starts a browser or GPU work.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const root='tmp/renderer-isolation',out='docs/renderer-isolation'
mkdirSync(out,{recursive:true})
const read=p=>JSON.parse(readFileSync(p,'utf8')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const stats=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return{count:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}}
const intervals=a=>a.slice(1).map((v,i)=>v-a[i])
const summaries=[]
for(const pair of ['pair-a','pair-b','pair-c'])for(const mode of ['main','worker']){
 const r=read(`${root}/${pair}-${mode}/report.json`),p=r.prepared,events=p.events,renderer=r.renderer
 const first=events.find(e=>e.type==='first-geometry'),ready=events.find(e=>e.type==='ready'),start=events.find(e=>e.type==='stage'&&e.stage==='fetch/decode/construct')?.at
 const end=renderer.frameTimes.at(-1),inWindow=at=>at>=start&&at<=end,disposed=r.final.events.find(e=>e.type==='disposed')
 const inputs=p.inputs.filter(e=>inWindow(e.at)),camera=events.filter(e=>e.type==='camera-frame'&&e.id>0),commands=new Map(r.final.cameraCommands.map(c=>[c.id,c]))
 const capture=r.captures.find(c=>c.name==='matched-camera'),capturedCommand=capture&&commands.get(capture.sequence)
 summaries.push({pair,mode,support:r.support,inputMethod:r.inputMethod??'Early harness: DOM target query before injection',
  firstGeometryFromFirstMainRafMs:first.at-p.mainFrames[0],firstGeometrySubmitCpuMs:first.cpuMs,
  firstGeometryScreenshotUpperBoundFromFirstMainRafMs:r.captures.find(c=>c.name==='basic').at-p.mainFrames[0],
  preparationTotalMs:ready.totalMs,stages:events.filter(e=>e.type==='stage').map(({report,...e})=>e),
  longTasks:stats(p.longTasks.filter(t=>inWindow(t.at)).map(t=>t.ms)),heartbeat:stats(p.heartbeats.filter(t=>inWindow(t.at)).map(t=>t.ms)),
  inputHandler:stats(inputs.map(i=>i.handlerMs)),inputNextRaf:stats(inputs.filter(i=>i.nextRafAt).map(i=>i.nextRafAt-i.eventAt)),
  mainRafIntervals:stats(intervals(p.mainFrames.filter(inWindow))),rendererFrameIntervals:stats(intervals(renderer.frameTimes.filter(inWindow))),
  messageRoundTrip:stats(p.messageTimes),cameraToSubmittedFrame:stats(camera.map(e=>e.submittedAt-e.sentAt)),
  matchedCameraVisibleUpperBoundMs:capturedCommand?capture.at-capturedCommand.sentAt:undefined,
  gpuDisplaySamples:stats(renderer.gpuSamples),native:renderer.native,resources:renderer.resources,
  generationRejected:r.final.events.some(e=>e.type==='rejected'),cancellationSettled:r.final.events.some(e=>e.type==='job-settled'&&e.generation===2&&e.activeJobs===0),
  disposal:{beforeContextLoss:disposed.report.resources,contextLost:disposed.afterContextLoss,validAfterContextLoss:disposed.validAfterContextLoss},errors:r.errors,
 })
}
const visuals=[]
for(const pair of ['pair-a','pair-b','pair-c']){
 const decoded=await Promise.all(['main','worker'].map(mode=>sharp(`${root}/${pair}-${mode}/matched-camera.png`).extract({left:0,top:0,width:840,height:472}).removeAlpha().raw().toBuffer()))
 let changed=0,max=0,sum=0;for(let i=0;i<decoded[0].length;i++){const d=Math.abs(decoded[0][i]-decoded[1][i]);if(d)changed++;max=Math.max(max,d);sum+=d}
 visuals.push({pair,width:840,height:472,excluded:'Bottom 8px camera sequence marker',differentRGBComponents:changed,maxComponentDifference:max,meanAbsoluteDifference:sum/decoded[0].length})
}
function startupGraph(folder){
 const base=resolve(folder),html=readFileSync(`${base}/index.html`,'utf8'),files=new Set()
 function visit(file){if(files.has(file))return;files.add(file);const source=readFileSync(file,'utf8');for(const m of source.matchAll(/^\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s*)?["']([^"']+)["']/gm)){if(m[1].startsWith('.')&&m[1].endsWith('.js'))visit(resolve(dirname(file),m[1]))}}
 for(const m of html.matchAll(/<script[^>]+src="([^"]+)"/g))visit(resolve(base,m[1].replace(/^\//,'')))
 const rows=[...files].map(path=>({path:path.slice(base.length+1).replaceAll('\\','/'),bytes:statSync(path).size}))
 return{folder,files:rows,totalStaticStartupJSBytes:rows.reduce((n,f)=>n+f.bytes,0)}
}
const startup=['before-valid-startup','after-observed-controls','after-valid-failure','after-valid-cancel'].map(label=>{const r=read(`${root}/bootstrap-${label}/report.json`);return{label,failure:r.failure,moments:r.raw.moments,initial:r.initialVisible,steps:r.steps.map(({samples,...s})=>s),requests:r.raw.requests,retry:r.retry,newBeforeRelease:r.newBeforeRelease,newAfterRelease:r.newAfterRelease,errors:r.errors}})
const bundles=[startupGraph('tmp/usability-recovery/production-final'),startupGraph(`${root}/production-final`)]
const defaultAsset=`${root}/production-final/assets/colin_house_v2-DAcxeGAg.json`
const measurement={recommendation:'REVISE APPROACH: no production renderer migration yet',units:'milliseconds unless labelled bytes/count',summaries,visuals,startup,bundles,defaultAsset:{path:defaultAsset,bytes:statSync(defaultAsset).size,sha256:hash(defaultAsset)},
 unsupportedFallback:read(`${root}/fallback-worker/report.json`).final.mode,
 caveats:['Pair C is authoritative for input: targets cached before preparation; no screenshots during preparation. A/B have target-query sampling bias; A also captures during preparation.',
 'Camera-frame is GL submission, GPU fence is completion, next rAF is not paint. Matched screenshot proves only its tagged final frame; continuous camera-to-visible latency during preparation is not measured.',
 'First geometry starts from first observed UI rAF, not navigation; screenshot is a later upper bound.',
 'GPU display queries mostly sample the basic fallback, not all preparation GPU execution. Resource counts and decoded bitmap bytes are not peak heap or VRAM.',
 'Small paired sequential sample, not a statistically controlled performance study; no full production renderer equivalence.']}
writeFileSync(`${out}/measurements.json`,JSON.stringify(measurement,null,2))
const production=['src/App.tsx','src/projectBootstrap.ts','src/components/ProjectBootstrap.tsx']
const prototype=['tests/browser/rendererIsolation.html','tests/browser/rendererIsolation.ts','tests/browser/rendererIsolation.worker.ts','tests/browser/rendererIsolationRuntime.ts','tests/browser/rendererIsolationProtocol.ts','tests/browser/rendererIsolation.tsconfig.json','tests/browser/rendererIsolation.mjs','tests/browser/rendererIsolationBuild.mjs','tests/browser/projectBootstrapRegression.mjs','tests/projectBootstrap.test.ts','tests/rendererIsolationProtocol.test.ts','scripts/rendererIsolationReport.mjs']
const prior=read('docs/usability-recovery/manifest.json')
const preserved=prior.files.filter(f=>f.path.startsWith('src/')&&f.path!=='src/App.tsx').map(f=>({path:f.path,unchanged:f.sha256===hash(f.path)}))
const authored=read(`${root}/authored-hashes.json`).map(f=>({...f,after:hash(f.path),unchanged:f.sha256===hash(f.path)}))
const library=read(`${root}/library-hashes.json`).map(f=>({...f,after:existsSync(f.path)?hash(f.path):null,unchanged:existsSync(f.path)&&f.sha256===hash(f.path)}))
const files=[...production,...prototype].map(path=>({path,kind:production.includes(path)?'production bootstrap':'isolated prototype/test/report',sha256:hash(path),...(path==='src/App.tsx'?{beforeSha256:hash(`${root}/before-source/App.tsx`)}:{})}))
writeFileSync(`${out}/manifest.json`,JSON.stringify({files,reportArtifacts:['docs/renderer-isolation/REPORT.md','docs/renderer-isolation/measurements.json','docs/renderer-isolation/manifest.json'],authored,preservedPhase1ProductionSources:preserved,unchangedEntryPoint:hash('src/main.tsx')===hash(`${root}/before-source/main.tsx`),libraryMetadata:library},null,2))
console.log(JSON.stringify({pairC:summaries.filter(s=>s.pair==='pair-c').map(({native,stages,disposal,support,...s})=>s),bundles,visuals,authoredUnchanged:authored.every(f=>f.unchanged),phase1Preserved:preserved.every(f=>f.unchanged),libraryUnchanged:library.every(f=>f.unchanged)},null,2))
