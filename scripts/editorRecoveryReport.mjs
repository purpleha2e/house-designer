import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
const root = 'tmp/usability-recovery', out = 'docs/usability-recovery'
mkdirSync(out, { recursive: true })
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const stats = values => {
  const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b)
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length*.5)], p95: sorted[Math.floor(sorted.length*.95)], max: sorted.at(-1) }
}
const cold = label => {
  const r = read(`${root}/${label}/report.json`), b = r.browser
  return { label, firstPreparedStageMs: r.firstGeometry, firstUncoveredMs: r.firstUncovered,
    longTasksOnly: stats(b.tasks.map(t=>t.ms)), rafIntervals: stats(b.frames.map(f=>f.ms)),
    keyEventToNextRaf: stats(b.inputs.map(i=>i.eventAge+i.ms)), errors: r.errors }
}
const summary = { status: 'NOT ACCEPTED: remaining multi-second main-thread stalls; visual correctness incomplete',
  cold: ['before','before-trace','project-boundary','production-profile',...(existsSync(`${root}/final-smoke/report.json`)?['final-smoke']:[])].map(cold),
  validationTiming: { before: read(`${root}/material-validation-before.json`), after: read(`${root}/material-validation-after.json`) },
  replacements: {}, simple: {}, limitations: [
    'Development and production measurements are separate; no controlled production before/after speedup claim.',
    'P95 long-task duration is NOT P95 of all main-thread tasks.',
    'Draw-signature changes in early reports include compositor pass changes; discard them as visible-edit latency.',
    'React plan-state observation is NOT a measured Konva paint or end-to-end usable-editor latency.',
    'Springfield has an external door asset returning 404; complete-asset visual acceptance is unavailable.',
    'No completed seven-wall GI visual comparison or definitive blotch root cause.',
    'Long production trace streams did not flush within the harness bound; CPU profiles, observations and shorter raw traces were retained.',
  ] }
if (existsSync(`${root}/final-smoke/trace.json`)) {
  const events = read(`${root}/final-smoke/trace.json`).traceEvents
  const main = events.find(e=>e.ph==='M'&&e.name==='thread_name'&&e.args.name==='CrRendererMain')
  const tasks = events.filter(e=>e.ph==='X'&&e.pid===main.pid&&e.tid===main.tid&&e.name==='ThreadControllerImpl::RunTask')
  summary.rollingTraceMainTasks = { scope:'Final rolling-buffer window only; excludes discarded cold-start events',
    windowMs:(Math.max(...tasks.map(t=>t.ts+t.dur))-Math.min(...tasks.map(t=>t.ts)))/1000, ...stats(tasks.map(t=>t.dur/1000)) }
}
for (const label of ['before','after']) {
  const r = read(`${root}/${label}-replacement/report.json`)
  summary.replacements[label] = { steps: r.steps, transitions: r.samples.filter((s,i,a)=>!i||s.project!==a[i-1].project||s.cover!==a[i-1].cover||s.phase?.phase!==a[i-1].phase?.phase),
    longTasksOnly: stats(r.raw.tasks.map(t=>t.ms)), workers: { total: r.raw.workers.length, terminated: r.raw.workers.filter(w=>w.terminated).length }, errors: r.errors }
}
for (const label of ['before','after','production-edits']) {
  const r = read(`${root}/${label}-simple/report.json`)
  summary.simple[label] = { planStateObservationMs: r.steps.filter(s=>s.observed).map(s=>({action:s.action,ms:s.observed-s.at})),
    longTasksOnly: stats(r.raw.tasks.map(t=>t.ms)), pointerToNextRaf: stats(r.raw.inputs.map(i=>i.eventAge+i.ms)),
    camera: r.camera&&{ elapsedMs:r.camera.after.at-r.camera.before.at, distance:Math.hypot(...r.camera.after.camera.map((v,i)=>v-r.camera.before.camera[i])), preparing:r.camera.before.warm, gi:r.camera.before.gi.state }, final:r.final, errors:r.errors }
}
summary.floorPublication = read(`${root}/floor-publication/report.json`)
writeFileSync(`${out}/measurements.json`, JSON.stringify(summary,null,2))
const files = [
 'src/App.tsx','src/components/ThreeDView.tsx','src/components/SceneRenderer.tsx','src/components/SoftFloorGI.tsx',
 'src/editorPreparationTrace.ts','src/softFloorGISource.ts','src/indirectVisibility.ts','src/opaqueViewportScene.ts','src/projectViewState.ts','src/materials/localMaterials.ts','src/textureUpload.ts',
 'tests/localMaterials.test.ts','tests/opaqueViewportScene.test.ts','tests/projectViewState.test.ts','tests/softFloorGISource.test.ts','tests/textureUploadFailure.test.ts',
 'tests/browser/lightingHarness.mjs','tests/browser/rendererTestModules.ts','tests/browser/editorRegression.tsx','tests/browser/projectPreparationRegression.mjs',
 'tests/browser/editorUsabilityRecovery.mjs','tests/browser/editorRecoveryWorkflow.mjs','tests/browser/editorRecoveryDev.mjs','tests/browser/editorRecoveryBuild.mjs',
 'tests/browser/softFloorPublication.html','tests/browser/softFloorPublication.tsx','tests/browser/softFloorPublication.mjs','scripts/editorRecoveryReport.mjs',
]
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const authored = read(`${root}/authored-project-hashes.json`).map(r=>({path:r.Path,before:r.Hash.toLowerCase(),after:hash(r.Path),unchanged:r.Hash.toLowerCase()===hash(r.Path)}))
const manifest = { authored, files: files.map(path=>{const before=`${root}/before-source/${path.split('/').at(-1)}`;return {path,sha256:hash(path),...(path.startsWith('src/')&&existsSync(before)?{beforeSha256:hash(before)}:{})}}) }
writeFileSync(`${out}/manifest.json`,JSON.stringify(manifest,null,2))
console.log(JSON.stringify({cold:summary.cold.map(r=>({label:r.label,first:r.firstPreparedStageMs,uncovered:r.firstUncoveredMs,max:r.longTasksOnly.max})),authored:authored.map(a=>({path:a.path,unchanged:a.unchanged}))},null,2))
