import {readFileSync,writeFileSync} from 'node:fs'
const root='docs/gi-directional-diagnostics',read=p=>JSON.parse(readFileSync(`${root}/${p}`,'utf8')),mean=v=>v.reduce((a,b)=>a+b,0)/v.length,num=v=>Number.isFinite(v)?v.toFixed(3):'n/a'
const controls=read('comparison-controls.json'),geometry=read('stairwell-l2-verified/geometry-change-profile.json'),room=read('reference-room/results.json')
const frame=(o,v)=>read(`production-frames/l${o}-${v}.json`),edits=[1,2].flatMap(o=>[0,1].map(i=>({order:o,repeat:i,...read(`production-frames/l${o}-edit-${i}.json`)})))
const optimized=[0,1].map(i=>read(`production-optimized/l1-edit-${i}.json`))
const bootstrap=read('surface-bootstrap-equivalence.json')
const comparisons=[],csv=['view,surface,order,direct,sky,reflected,other,referenceDirect,referenceSky,referenceReflected,probeReceiver,absoluteError,relativeError']
const tables=[]
for(const view of ['stairwell','kitchen']){
 const suffix=view==='kitchen'?'/kitchen':'',a=read(`stairwell-l1-verified${suffix}/surface-measurements.json`),b=read(`stairwell-l2-verified${suffix}/surface-measurements.json`)
 const references=b.fullReference.results,rows=[]
 for(let i=0;i<a.points.length;i++){
  const x=a.points[i],y=b.points[i],r=references[i]
  if(JSON.stringify(x.position)!==JSON.stringify(y.position)||JSON.stringify(x.normal)!==JSON.stringify(y.normal))throw Error('Receiver mismatch: '+x.name)
  const refTotal=r.direct.map((v,c)=>v+r.sky[c]+r.reflected[c]),error=p=>mean(refTotal.map((v,c)=>Math.abs(v-p.directIrradiance[c]-p.skyIrradiance[c]-p.reflectedIrradiance[c])))
  const e1=error(x),e2=error(y),probe=x.floor>=0&&y.floor>=0
  comparisons.push({view,name:x.name,probeReceiver:probe,l1:e1,l2:e2,referenceMean:mean(refTotal),l1Relative:e1/Math.max(1e-5,mean(refTotal)),l2Relative:e2/Math.max(1e-5,mean(refTotal))})
  for(const [order,p,e]of [[1,x,e1],[2,y,e2]])csv.push([view,p.name,order,...['directIrradiance','skyIrradiance','reflectedIrradiance','artistFillAndOtherIrradiance'].map(k=>mean(p[k])),mean(r.direct),mean(r.sky),mean(r.reflected),probe,probe?e:'',probe?e/Math.max(1e-5,mean(refTotal)):''].join(','))
  const triple=p=>['directIrradiance','skyIrradiance','reflectedIrradiance'].map(k=>num(mean(p[k]))).join(' / ')
  rows.push(`| ${x.name} | ${triple(x)} | ${triple(y)} | ${[r.direct,r.sky,r.reflected].map(v=>num(mean(v))).join(' / ')} | ${probe?num(e1)+' / '+num(e2):'exterior path'} |`)
 }
 tables.push(`### ${view}

Values are mean linear RGB irradiance in renderer units, not lux. Columns split direct / escaped sky / reflected transport. Ambient is excluded.

| Receiver | L1 D / S / R | L2 D / S / R | Independent CPU D / S / R | L1 / L2 absolute error |
|---|---:|---:|---:|---:|
${rows.join('\n')}`)
}
writeFileSync(`${root}/receiver-comparisons.csv`,csv.join('\n')+'\n')
const errors=['stairwell','kitchen'].map(view=>{const r=comparisons.filter(p=>p.view===view&&p.probeReceiver);return{view,l1:mean(r.map(p=>p.l1)),l2:mean(r.map(p=>p.l2)),l1Relative:mean(r.map(p=>p.l1Relative)),l2Relative:mean(r.map(p=>p.l2Relative))}})
writeFileSync(`${root}/receiver-error-summary.json`,JSON.stringify({scope:'Probe receivers only; exterior analytical sky fallback is reported separately and excluded from SH-order error averages.',errors,receivers:comparisons},null,2))
const frameRows=[1,2].flatMap(o=>['stairwell','kitchen'].map(v=>{const p=frame(o,v),samples=Object.values(p.cases)[0],bracket=[samples.before,samples.changed,samples.after];return`| L${o} ${v} | ${num(mean(bracket.map(s=>s.displayFps)))} | ${num(mean(bracket.map(s=>s.cpuSubmissionMeanMs)))} | ${num(mean(bracket.map(s=>s.gpuExecutionMeanMs)))} | ${bracket.map(s=>num(s.displayFps)).join(' / ')} |`}))
const editRows=edits.map(e=>`| L${e.order} ${e.repeat?'subsequent edit':'first edit after saved GI'} | ${num(e.geometryVisibleMs)} | ${num(e.firstPublishedMs/1000)} | ${num(e.totalMs/1000)} |`)
const optimizedRows=optimized.map((r,i)=>{const old=edits.find(e=>e.order===1&&e.repeat===i);if(r.status.probes!==244||r.status.fullPassPublications!==6||r.status.total!==old.status.total)throw Error('Optimization changed the probe/pass workload');return `| ${i?'subsequent edit':'first edit after saved GI'} | ${num(old.totalMs/1000)} | ${num(r.totalMs/1000)} | ${num((1-r.totalMs/old.totalMs)*100)}% | ${num(old.firstPublishedMs/1000)} / ${num(r.firstPublishedMs/1000)} | ${num(old.geometryVisibleMs)} / ${num(r.geometryVisibleMs)} |`})
const workRows=optimized.map((r,i)=>{const old=edits.find(e=>e.order===1&&e.repeat===i),count=(e,name)=>e.performance.stages.find(s=>s.name===name)?.count??0;return`| ${i?'subsequent edit':'first saved-cache edit'} | ${old.status.capturedFaces} / ${r.status.capturedFaces} | ${count(old,'diffuse face')} / ${count(r,'diffuse face')} | ${count(old,'probe reduction + asynchronous readback')} / ${count(r,'probe reduction + asynchronous readback')} | ${r.status.surfaceBootstrappedProbes??0} |`})
const mem=[1,2].map(o=>{const s=frame(o,'stairwell').storage;return`| L${o} | ${num(s.coefficients/1048576)} | ${num(s.volume/1048576)} | ${num(s.floor/1048576)} |`})
const roomRows=['away','direct','overcast'].map(condition=>{const r=order=>room.find(p=>p.shOrder===order&&p.condition===condition),mae=o=>mean(r(o).receivers.flatMap(p=>p.absoluteError)),relative=o=>mean(r(o).receivers.flatMap(p=>p.relativeError));return`| ${condition} | ${num(mae(1))} | ${num(mae(2))} | ${num(relative(1)*100)}% | ${num(relative(2)*100)}% |`})
const cold1=read('l1-baseline/lighting-performance.json'),cold2=read('stairwell-l2/lighting-performance.json'),p=geometry.partitioned
const document=`# Directional GI and stairwell investigation

The update path now records missing receiver data once instead of redrawing those probes on every remaining bounce. It keeps the existing six-pass Jacobi solver and its quality settings. L1 remains the production default. L2 is implemented end to end behind the URL flag \`giSH=2\`; it is an experiment, not a global quality upgrade. The house measurements show that angular order alone does not resolve the window and reveal errors. The performance targets are not established as achieved.

## Comparison controls

Colin house, 244 identical probes, six diffuse transport passes, identical occupancy masks, authored sunlight, materials, exposure 1, ambient 0.18 and daylight transport gain 3.5. Both quality comparisons use the same 13 saved reflection images. [Machine-checked controls](gi-directional-diagnostics/comparison-controls.json) record exact compressed position, mask and reflection payload equality.

The stairwell camera is (4.00001, 4.25, 15.8), FOV 55; the kitchen camera is (4.65001, 1.6, 9.95), FOV 45. Viewport 1199 by 850, DPR 1. Hardware: ${frame(1,'stairwell').hardware.renderer}. Production frame timings explicitly omit the diagnostic shader family.

| Stairwell L1 | Stairwell L2 |
|---|---|
| ![L1 stairwell](gi-directional-diagnostics/production-frames/l1-stairwell.png) | ![L2 stairwell](gi-directional-diagnostics/production-frames/l2-stairwell.png) |

| Kitchen L1 | Kitchen L2 |
|---|---|
| ![L1 kitchen](gi-directional-diagnostics/production-frames/l1-kitchen.png) | ![L2 kitchen](gi-directional-diagnostics/production-frames/l2-kitchen.png) |

All nine diagnostic views are in [L1 stairwell](gi-directional-diagnostics/stairwell-l1-verified/final-composite.png), [L2 stairwell](gi-directional-diagnostics/stairwell-l2-verified/final-composite.png) and their kitchen subdirectories. Switching views is checked not to recapture GI or change its generation. The earlier unsuffixed diagnostic run is preliminary; its CPU back-face offsets were corrected in the verified runs.

## Lighting findings

The below-window wall faces inward, away from the authored sun, and sees no directly escaped sky at the sampled point. Its darker appearance is partly physical. The opposite reveal normals have different sun cosines, but the independent geometry visibility checks find both sampled reveal points shaded in this sun position. Their direct terms are therefore zero; manually lighting up one reveal would be incorrect for these exact points.

There are also substantial approximation errors. The reference finds much more local window illumination at the reveals than the interpolated field supplies, while the ceiling and landing receive excess indirect light. L2 changes those errors in different directions. It cannot reconstruct a spatial gradient that the existing probe locations and interpolation have already smoothed away. The visibility-input and reference-model limitations below also contribute systematic error; the entire residual cannot be assigned to SH order alone.

The sill is classified outside the indoor probe receiver path. It is illuminated by the exterior analytical sky fallback, recorded in \`artistFillAndOtherIrradiance\`, rather than the probe sky/reflected channels. Its zero probe terms do not mean it is unlit. Keep it out of SH-order aggregate errors; its independent reference and raw final irradiance remain in the data. This boundary needs separate validation before changing receiver classification.

${tables.join('\n\n')}

| Probe receiver set | L1 mean absolute error | L2 mean absolute error | L1 mean relative error | L2 mean relative error |
|---|---:|---:|---:|---:|
${errors.map(e=>`| ${e.view} | ${num(e.l1)} | ${num(e.l2)} | ${num(e.l1Relative*100)}% | ${num(e.l2Relative*100)}% |`).join('\n')}

[All receiver values and relative errors](gi-directional-diagnostics/receiver-comparisons.csv). The independent actual-scene solver uses 16,384 cosine paths per receiver and six secondary bounces, original full-resolution base-colour textures, hard sun/lamp visibility and the authored daylight gain. It does not reuse SH, production probes, interpolation, replay or the production sky evaluator. It uses geometric secondary normals and diffuse transport; it excludes secondary normal-map perturbations, specular transport, shadow-map filtering and mesh-material emission. A scene audit found two emissive material colours, including an appliance display, with no emissive maps; their contributions are not in this reference. Explicit point/spot lamps are included. The analytical reference room has no mesh emitters. Monte Carlo standard errors are preserved in the raw JSON. These are diffuse reference measurements, not full PBR ground truth.

## Independent reference room

Both variants use identical production probe positions and six production transport passes. A separate analytical room path tracer supplies the comparison, at 131,072 paths per receiver. This includes interpolation and transport, unlike the earlier angular-only SH experiment.

| Condition | L1 absolute error | L2 absolute error | L1 relative error | L2 relative error |
|---|---:|---:|---:|---:|
${roomRows.join('\n')}

[Room results](gi-directional-diagnostics/reference-room/results.json). Cached replay is separately checked against fresh diffuse-only GPU captures in both orders, including every coefficient, sun changes, lamps, occlusion and emission. The fixture now sets the same diffuse-only capture flag as production; its old fresh reference incorrectly included specular highlights.

## Timing and storage

| Controlled renderer sample | Display FPS | CPU submission ms | GPU execution ms | Before / middle / after FPS |
|---|---:|---:|---:|---|
${frameRows.join('\n')}

These are the normal compositor and renderer on a repeatable 2.5 cm camera path, with diagnostics disabled. HUD counters in the comparison PNGs can accumulate during the manual draw harness; use the JSON tables for timing and per-frame work. The brackets show load drift; they are not a guarantee of whole-editor input throughput or 60 FPS. All rays, shaders and quality checks finish before these timings start.

| Real 0.25 m window edit | Geometry feedback ms | First updated light s | Completed GI s |
|---|---:|---:|---:|
${editRows.join('\n')}

### Accepted receiver-cache update fix

The baseline partially updated 110 first-pass probes and 153 later-pass probes. The extra 43 probes lacked receiver-atlas data. They therefore redrew the scene on every later bounce, and prevented batching until the uncached samples were drained. The fix records their static material/normal/position data on their first visit, evaluates direct light, then replays that pass against its immutable bounce input. Later passes use the same existing cache and reduction. No new GI engine, extra probes, fewer bounces or larger capture budget is introduced.

| L1 edit | Before total s | After total s | Reduction | Before / after first light s | Before / after geometry ms |
|---|---:|---:|---:|---:|---:|
${optimizedRows.join('\n')}

| Work | Geometry faces before / after | Fully lit diffuse faces before / after | Per-probe reductions before / after | Newly cached late probes |
|---|---:|---:|---:|---:|
${workRows.join('\n')}

The shader and geometry work counts establish what the optimization removes. Wall-clock results are one matched sequence per variant and remain sensitive to hardware load and compilation caches. The fix begins in later transport passes; any first-light or initial geometry timing difference must not be attributed to this change. The L2 first baseline edit overlapped a short validation startup attempt, so that cold-edit duration is observational rather than a clean causal comparison. The accepted before/after comparison uses the quiet L1 runs.

A six-pass regression deliberately removes four receiver samples after pass one. In both SH orders, all final coefficient/volume/floor values differ by at most ${Math.max(...bootstrap.map(r=>r.maxError))}, and rendered channel values by at most one 8-bit level. The outputs are not byte-identical; the difference is within the existing half-float precision. Three rapid input changes while a bootstrap readback is delayed produce final buffers exactly equal to a fresh bake (maximum error ${Math.max(...bootstrap.map(r=>r.cancellation.maxError))}). [Equivalence and cancellation results](gi-directional-diagnostics/surface-bootstrap-equivalence.json). The test waits explicitly for all six volume publications.

The first edit after loading saved GI has no warm preparation worker or cached receiver atlas. It must be distinguished from subsequent edits. An earlier first-edit run exceeded the old 180-second test protocol timeout; the corrected harness polls the running job without overlapping retries. Old light remains visible while new geometry and lighting are prepared.

Fresh six-pass runs measured ${num(cold1.performance.totalMs/1000)} seconds for L1 and ${num(cold2.performance.totalMs/1000)} seconds for L2 from GI preparation. These are diagnostic observations, not a causal speed ratio: startup shader state, saved reflection handling and other machine work differed. Both exceed the 30-second goal. Raw worker, interpolation, replay and readback stages are retained in their lighting-performance JSON files.

| Base lighting payload | Coefficients MiB | 3D volume MiB | Floor volume MiB |
|---|---:|---:|---:|
${mem.join('\n')}

L2 stores nine coefficients per colour instead of four: coefficient and volume payloads are exactly 2.25 times larger. The ordinary display still uses the existing two volume samplers; it performs nine coefficient fetches instead of four. The table gives exact half-float texture upload payloads, excluding driver padding, shadows, scene textures and extra work/display fields; it is not a process-wide VRAM measurement. L2 slab dimensions are checked against the device limit, including the doubled diagnostic sky slabs. Unsupported experimental layouts select L1 without lowering resolution.

## Geometry acceleration experiment

A real window move changed ${geometry.changedOrRemovedObjects} removed/changed object instances and ${geometry.changedOrAddedObjects} added/changed instances out of ${geometry.before.instances}. ${num(geometry.unchangedTriangleFraction*100)}% of current visibility-input world triangles remained byte-exact. The comparison uses full Float32 triangle multisets, not quantized hashes, and runs outside the edit timer.

The read-only prototype retains unchanged world-space per-part BVHs and builds a median AABB hierarchy over them. Cold preparation: ${num(p.cold.ms)} ms; edit preparation: ${num(p.edit.ms)} ms, reusing ${p.edit.reused} parts and rebuilding ${p.edit.rebuilt}. Whole-scene fresh construction: ${num(p.wholeBuildMs)} ms. On ${p.samples} deterministic finite segments, ${p.mismatches} occlusion results differed and maximum nearest-distance error was ${p.maxDistanceError}. Query times were ${num(p.wholeQueryMs)} ms whole-scene and ${num(p.partitionedQueryMs)} ms partitioned. These random segments are a smoke test, not a substitute for the actual interpolation-ray workload.

[Exact change counts and experiment](gi-directional-diagnostics/stairwell-l2-verified/geometry-change-profile.json). The retained geometry/tree payload is a lower bound, excluding JavaScript and query scratch storage. Small-scene regressions exercise thin walls, mirrored instances, movement, removal and restoration.

The prototype is not adopted. Integration must preserve GPU lamp primitive IDs, worker transfer ownership, cancellation and generation rules, bounded memory and exact interpolation results across repeated edits. The scene audit additionally found 32,662 opaque triangles in 22 visible imported-model batches excluded from the current production visibility snapshot. The independent CPU scene reference includes them. A replacement accelerator must first establish complete, consistent geometry input; matching the existing incomplete input does not establish physical correctness. This is the point to stop the acceleration rewrite and explain the dependency rather than ship a partially integrated tree.

## Spatial detail and rendering decisions

The read-only kernel sweep tests radius factors 1.75, 1.5, 1.25 and 1.0 plus a sharper exponent. It confirms mixed results: narrowing improves some side-wall/reveal sky measurements and worsens the landing, and previous kitchen measurements lose shaded-corner support. No global radius change is adopted. A future adaptive rule should combine local variance, opening proximity, visibility and coverage, then be checked for temporal seams during edits; static per-point improvement is insufficient. Raw support, coverage, links and kernel errors are preserved in the surface-measurement files.

Authored colours, exposure, roughness, sunlight, ambient, AO and reflection settings are unchanged. Contact shading and the wooden handrail are shown in the diagnostic and production images. No extra AO or reflection feature is enabled to conceal GI errors.

## Validation\n\nProduction build and 49 focused tests passed, with lint clean. All nine diagnostic modes render in the actual house without GI recapture or WebGL errors. Both orders pass nine cached-versus-fresh diffuse capture scenarios (maximum coefficient error 0.001923). A separate 288-sample GPU/CPU check covers both orders, volume and floor interpolation, and packed sky diagnostics (maximum error 0.000972, within half-float precision). L1, six-pass quality settings and the preview policy remain the defaults.\n\n## Accepted and deferred changes

Accepted: lazy caching of previously uncaptured later-pass receivers, with asynchronous generation checks and immutable Jacobi input rebinding; opt-in L2 through capture, Jacobi replay, storage, interpolation, receiver shaders, probe diagnostics and persistence; L1 remains the default. L1 caches stay version 5; L2 uses version 6 and cannot be mistaken for L1. Old project data remains readable. The optional GPU preview remains disabled for L2. Experimental L2 caches require the matching opt-in renderer; normal published tours should retain L1 until that experiment is validated. Diagnostic output stays in a prepared linear render-target family and receiver shaders compile cooperatively before measurement.

Deferred: global L2 adoption, global radius reduction, the partitioned production accelerator and larger per-frame capture budgets. The measurements do not establish that these changes improve both house accuracy and interactive responsiveness. In particular, safe sub-two-second updates depend on removing whole-scene preparation from the critical path while preserving consistent visibility and transport. No separate lighting engine or reduced-quality solver is introduced.

The under-two-second first update, under-ten-second edit, under-thirty-second cold bake and approximately 60 FPS targets remain goals, not completed claims. The detailed results above identify the remaining work: first-edit geometry feedback, whole-scene visibility/lamp preparation, background preparation of capture shader families, and incremental reuse of capture-scene geometry. The receiver-cache fix removes repeated later-pass work but does not solve those earlier dependencies.
`
writeFileSync('docs/gi-directional-stairwell-investigation.md',document)
console.log(JSON.stringify({errors,geometry:p,report:'docs/gi-directional-stairwell-investigation.md'}))
