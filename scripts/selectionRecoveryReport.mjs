import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
const root='tmp/selection-recovery',labels=['reference-full','reference-ownership','final-acceptance','final-gesture','final-edits']
const stats=xs=>{xs=xs.filter(Number.isFinite).sort((a,b)=>a-b);return{n:xs.length,min:xs[0],median:xs[Math.floor(xs.length/2)],max:xs.at(-1)}}
const rows=labels.map(label=>{
 const r=JSON.parse(readFileSync(`${root}/${label}/report.json`,'utf8')),events=r.raw.events
 const analysisPath=`${root}/${label}/frame-analysis.json`,frameAnalysis=existsSync(analysisPath)?JSON.parse(readFileSync(analysisPath,'utf8')):undefined
 const inputs=events.filter(e=>e.kind==='test.input')
 const timeline=inputs.map((m,i)=>{
  const end=inputs[i+1]?.at??Infinity,within=events.filter(e=>e.at>=m.at&&e.at<end),up=within.find(e=>e.kind==='picker.pointerup'),pick=within.find(e=>e.kind==='pick.result'),commit=within.find(e=>e.kind==='react.selection.commit')
  const frame=up&&frameAnalysis?.measurements.find(f=>f.pointerAt===up.eventAt)
  return{label:m.label,at:m.at,pointerAt:up?.eventAt,transforming:up?.transforming,picked:pick?.modelId??pick?.targetKind,pickMs:pick?.ms,stateMs:up&&commit?commit.at-up.eventAt:undefined,frameEstimateMs:frame?.ms,frame:frame?.frame}
 })
 const cutoff=r.steps.find(s=>s.label==='selection while moving')?.before.at??r.steps.find(s=>s.label==='select before edit')?.before.at??Infinity
 return{label,complete:!r.failure,measurementLimit:r.failure,initial:r.initial,late:r.late,timeline,coldState:stats(timeline.filter(t=>t.label.startsWith('cold')).map(t=>t.stateMs)),coldFrameEstimates:stats(timeline.filter(t=>t.label.startsWith('cold')).map(t=>t.frameEstimateMs)),readyState:stats(timeline.filter(t=>r.steps.some(s=>s.label===t.label&&!s.before.warm&&s.before.gi?.state==='ready')).map(t=>t.stateMs)),unchanged:r.selectionOnlyUnchanged,readySteps:r.steps.filter(s=>!s.after.warm&&s.after.gi?.state==='ready').length,selectionRequests:events.filter(e=>e.kind==='warmup.request'&&e.at>=r.initial.at&&e.at<cutoff),failures:events.filter(e=>e.kind==='warmup.failure'),batchUnregister:events.filter(e=>e.kind==='batch.unregister'&&e.at<cutoff),firstNativeDelta:Object.fromEntries(Object.entries(r.steps[0].after.native).map(([k,v])=>[k,v-(r.steps[0].before.native[k]??0)])),errors:r.errors,edit:r.edit?.state,materialEdit:r.materialEdit?.state,injectedFailure:r.injectedFailure,replacement:r.replacement}
})
mkdirSync('docs/selection-recovery',{recursive:true})
writeFileSync('docs/selection-recovery/measurements.json',JSON.stringify(rows,null,2))
console.log(JSON.stringify(rows.map(r=>({label:r.label,complete:r.complete,cold:r.coldState,frames:r.coldFrameEstimates,ready:r.readyState,readySteps:r.readySteps,unchanged:r.unchanged,nativeBuffers:r.firstNativeDelta.createBuffer,requests:r.selectionRequests.map(e=>({at:e.at,generation:e.generation,caller:e.stack?.[1]})),failures:r.failures.map(e=>({at:e.at,message:e.message,project:e.project,generation:e.generation})),unregister:r.batchUnregister.length})),null,2))
