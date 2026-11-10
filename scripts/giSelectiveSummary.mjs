import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import sharp from 'sharp'
const root='docs/gi-selective',read=p=>JSON.parse(readFileSync(`${root}/${p}.json`)),m=read('metrics'),a=read('acceleration'),fmt=(v,n=3)=>v.toFixed(n),rows=m.cohorts.detailed.candidates,all=m.cohorts['face-centre'],range=s=>`${fmt(s.mean)} (${fmt(s.min)}–${fmt(s.max)})`
let report=`# Selective GI and reusable BVH investigation

Both candidates remain experimental. The allocation-free BVH is correct in the tested cases but fails the traversal performance gate. Local 16/32-ray sampling improves detailed accuracy consistently; projecting those samples into a compact vertex residual fails the seam/exposed-surface criteria. No production integration or default changes were made. Stage 3 dynamic integration is deliberately not executed.

## Conditions and evidence

Colin house: 468,518 triangles, 705 instances, 569 unique local geometries; sofa: 3,020 triangles. Existing completed 301-probe, six-bounce L1 field, authored exposure/ambient/materials unchanged. Intel Core i9-9880H; AMD Radeon Pro 5600M through ANGLE D3D11. Capture canvas 999 × 740, DPR 1. Project/cache hashes, renderer and exact field coefficients are in provenance.json and surface/provenance.json. This builds on the dirty working tree recorded by [the preceding investigation](../gi-next/REPORT.md); this task does not claim all existing repository modifications.

Independent detailed references were increased from 8,192 to 32,768 paths, six bounces. The 3,020 face-centre references reuse the preceding 256-path run; their finite-sampling error limits close rankings. Reference and candidate share scene geometry/texture extraction and the BVH library, but use separate integrators; candidate selection never reads reference values. Several detailed receivers duplicate physical positions; 34 rows are diagnostics, not 34 independent locations. Raw RGB errors, seeds and per-surface data are retained in metrics.json, per-surface.csv and surface/local.json.

## A. Allocation-free reusable traversal

The new any-hit path removes per-ray vector/hit allocations, nearest-hit work, normal/identity reconstruction, inverse calculation and map lookup. It caches inverse matrices and geometry pointers, packs TLAS bounds/metadata, traverses near-first, and copies BLAS topology through the public API. The inverse-transformed direction is deliberately not normalized: its parameter remains world distance under nonuniform/negative scale. Material eligibility is resolved during snapshot construction. Nearest queries remain available and unchanged; this is not the full production query contract.

60,000 distinct deterministic house rays were reused in five configurations: 300,000 ray/configuration comparisons. Seven alternating-order timed repetitions followed warmup. Table values are medians in milliseconds for 60,000 any-hit queries.

| Configuration | Production flat | Original prototype | Optimized prototype |
|---|---:|---:|---:|
${a.results.map(r=>`| ${r.label} | ${fmt(r.timings.all.medianMs.flat,1)} | ${fmt(r.timings.all.medianMs.original,1)} | ${fmt(r.timings.all.medianMs.optimized,1)} |`).join('\n')}

Cold early-hit cohort (2,600 rays, nearest hit < 0.3 m): 4.2 / 23.4 / 6.4 ms. Cold miss cohort (36,195 rays): 12.6 / 38.1 / 34.2 ms. The miss-heavy regression remains the clearest bottleneck. Overlapping object bounds and two hierarchy levels are plausible causes, not a demonstrated instruction-level profile. We did not launch a speculative hierarchy redesign after the failed gate.

All hit/miss and non-tie identity comparisons pass. Maximum distance difference is 0.00002482 m. Each configuration has 79 coincident/equal-distance primitive ambiguities, recorded separately rather than counted as identity failures. These random rays cover actual architectural/furniture geometry; they are not proof of every degenerate tangent case. Synthetic tests cover thin walls, mirrored/nonuniform transforms, glazing/material eligibility, additions/removals and geometry revisions.

| Geometry preparation | Production flat | Optimized local |
|---|---:|---:|
| Cold build | ${fmt(a.flatBuildMs,1)} ms | ${fmt(a.blasAndInstancesMs+a.tlasBuildMs,1)} ms |
| Sofa +20 cm | ${fmt(a.edits[0].flatUpdateMs,1)} ms | ${fmt(a.edits[0].localTransformAndRefitMs,1)} ms |
| 100 repeated transforms | Not measured in this cohort | Mean ${fmt(a.transform100.meanMs,3)} ms; max ${fmt(a.transform100.maxMs,1)} ms |

Zero BLAS rebuilds for transform-only edits. Reported zero-time rotations/reflections are below timer resolution, not literally free. Geometry/tree payload: flat 31.662 MB (excludes production's extra any-hit arrays); local 25.515 MB plus 9.585 MB BLAS query arrays and 0.096 MB packed TLAS = 35.196 MB. JS objects/allocator overhead and process peak memory are excluded. This is not a complete like-for-like memory-win claim. Both old nearest data and new any-hit copies remain resident.

**Checkpoint A fails:** optimized traversal is about 2.4× faster than the old prototype, but 1.8–1.94× slower than production. Worker snapshots, triangle-box contract, stable production IDs and integrated edit timing were therefore not implemented.

## B. Selective local sampling

Selected 16/34 detailed rows and 1,613/3,020 face centres. Rules: offset crosses geometry; fragile probe visibility near a blocker; probe/volume disagreement near a blocker; explicit known faces 151 and 1049. No darkness threshold or reference-driven sample selection. Most selections come from offset crossings. This selects about half of the sofa and is not a tiny sparse patch.

Each cosine-hemisphere ray reads sky on a miss; at its first hit it reads exact shadowed direct illumination plus the completed GI volume, multiplied by actual UV diffuse albedo and (1-metalness)/π. Receiver direct lighting remains separate. The local estimate replaces indirect irradiance; the 50% variant is a convex blend. The signed L1 control subtracts sampled SH and adds its analytic integral; final nonnegative clamping adds bias. The terminal volume is a biased approximation, can inherit interpolation error and does not reproduce a strictly truncated six-bounce integral. Geometry rays use a 0.2 mm surface bias; the terminal field is read 2 mm beyond the hit normal. No new global probes/bounces or per-fragment rays.

Eight fixed seeds per budget, prefix-related across budgets. The reported averages summarize eight separate deployments; they are not a 256-ray result disguised as 32 rays. Significant regression means per-point RGB MAE worsens by >0.02, a reporting threshold rather than a statistical hypothesis test.

Detailed baseline: volume MAE 0.225961, RMSE 0.257683, max component error 0.580719. Previous vertex: MAE 0.201066, RMSE 0.245362, max 0.514232; 17/34 regressions, 11 significant. The earlier 18/34 count used the lower-sample reference.

| Rays | Method | Detailed MAE mean (seed range) | Mean RMSE | Worst component error over seeds | Mean significant regressions /34 | All-face MAE mean |
|---|---|---:|---:|---:|---:|---:|
${rows.map(r=>`| ${r.budget} | ${r.method} | ${range(r.stats.mae)} | ${fmt(r.stats.rmse.mean)} | ${fmt(r.stats.max.max)} | ${fmt(r.stats.significantRegressions.mean,2)} | ${fmt(all.candidates.find(c=>c.budget===r.budget&&c.method===r.method).stats.mae.mean)} |`).join('\n')}

All-face baseline: volume MAE 0.256214 / RMSE 0.420563 / max 2.934509; previous vertex 0.141483 / 0.244005 / 1.546399, with 579 significant regressions. The 32-ray replacement has 246–263 significant regressions and MAE 0.151680–0.152625. It improves production overall but does not beat previous vertex on this coverage metric. Unselected regions retain baseline error, including the maximum.

4/8-ray replacement is inconsistent at detailed points. At 32 rays mean per-point/channel seed SD is 0.05138 on detailed rows, and individual outliers remain. The named seam's scalar RGB mean ranges 0.239–0.702 versus reference 0.290; the reference's Monte Carlo uncertainty is recorded in metrics.json. Face 1049 gives 0.232–0.269 versus reference 0.193 and production zero. Half blending reduces variance but under-corrects the severe seam; SH control does not materially improve the mean result. The 32-ray raw replacement warranted one bounded storage test.

## Compact storage and rendered validation

Stored a replacement-minus-baseline residual in three float vertex attributes: 108,720 bytes. The expanded geometry payload including that attribute is 398,640 bytes. Face-centre residuals project to area-weighted vertex groups only within edge-connected components and exact matching positions/normals. Hard normal boundaries and disconnected cushions are not deliberately welded. This is simple interpolation, not a lightmap or an added denoising system. Unselected faces contribute zero residual; interpolation can still affect their neighbours. Negative final irradiance is clamped.

Validation uses only face-centre samples to construct attributes; detailed receivers are held out. All eight 32-ray seeds were tested after storage. Detailed MAE becomes **0.191916** (0.187989–0.197151), RMSE 0.243700, worst component error 0.556020, with 5–6 significant regressions. All-face MAE becomes **0.165360**, RMSE 0.264058, worst component error 2.448753 and 272–299 significant regressions. These CPU predictions apply interpolated residuals to each saved receiver's production baseline; they are not a fresh per-pixel raster accuracy measurement.

The named seat/back seam improves to mean 0.239 versus reference 0.290, but **face 1049 remains essentially black: 0–0.0091 versus reference 0.193**. The neighbouring exposed seat-back-4 sample becomes 0.819–0.919 versus reference 0.380 and baseline 0.660. A centroid correction cannot represent the baseline's sharp within-triangle receiver-offset change. Thus the representation fails even though its overall average improves. No adoption based solely on mean MAE.

White mode is useful here: it removes material texture/specular distractions and exposes residual bands/facets. It is a display override; authored materials still determine bounced transport. Primary captures disable compositor AO and fake AO geometry. Both authored and white views use identical cameras/lighting. Final candidate captures use the first predeclared seed (1723), not the best-looking seed. Numerical acceptance still uses all eight seeds.

## Timing, memory and limits

| Preparation stage | Measured time |
|---|---:|
| Reference-scene/texture snapshot | 11,252.6 ms |
| Local estimator BVH/setup | 1,709.8 ms |
| Selection, 3,054 rows | 49.5 ms |
${[4,8,16,32].map(b=>`| ${b} rays, 1,629 selected rows | ${fmt(m.timings.budgets[b].cpuMs.mean,1)} ms mean (${fmt(m.timings.budgets[b].cpuMs.min,1)}–${fmt(m.timings.budgets[b].cpuMs.max,1)}) |`).join('\n')}
| Vertex storage setup | 12.5–24.2 ms across display runs |
| Residual projection/upload preparation | 1.4–6.2 ms per seed across display runs |
| Independent 32,768-path reference (validation only) | 61,301.6 ms |

32-ray sampling includes roughly 86,528 total ray queries, 34,400 direct shadow rays and 52,083 completed-field reads, not merely 32 cheap visibility tests per selected point. Combined cold preparation for one 32-ray seed is about **13.8 seconds** before worker/message/publication overhead. The approximately 0.80-second sampling stage alone is not end-to-end achievement of the aspirational one-second target. Reusing a production CPU material/geometry snapshot could avoid work, but that integration was not measured. Texture snapshot alone is 765,019,168 bytes; geometry, BVH, worker copies, JS data, renderer resources and temporary extraction targets are additional. The 108.7 KB final attribute does not describe peak preparation memory.

First updated lighting, full local update after editing, and full-house bake comparisons are **not measured for these candidates**, since neither passed the final adoption gate. Previous production-only cold/warm timings remain in the preceding report and are not presented as matched integrated speedups. No saved-project schema, GI cache format or production shader was changed. Generation checks reject stale worker output/display use; this isolated experiment is not a production cancellation/invalidation implementation.

## Decision and next steps

Retain the optimized reusable query and selective estimator as opt-in test tools. Reject production integration of the current BVH and vertex residual. The point estimator is useful evidence that local sampling can correct receiver-offset errors, but storage and terminal-field limitations remain. Do not add an extensive denoiser, raise global probe counts or revive the rejected triangle atlas to rescue this result. A future separately scoped study could test a few geometry-aware samples at offset discontinuities and profile TLAS overlap, with its own acceptance gate. No whole-house lighting or movement improvement is claimed here.

## Reproduction and changed files

Run the asset portal and Vite on ports 5174 and 5181, then:

\`\`\`powershell
node tests/browser/giSelective.mjs 5181 --bvh
$env:GI_SELECTIVE_OUT='docs/gi-selective/surface'
node tests/browser/giSelective.mjs 5181 --local
$env:GI_SELECTIVE_OUT='docs/gi-selective/captures'
node tests/browser/giSelective.mjs 5181 --display
node scripts/giSelectiveReport.mjs
node scripts/giSelectiveSummary.mjs
node node_modules/typescript/bin/tsc -p tests/tsconfig.gi-selective.json --pretty false
node node_modules/typescript/bin/tsc -b --pretty false
\`\`\`

Updated existing test prototypes: tests/giNextAcceleration.ts, tests/giNextAcceleration.test.ts, tests/browser/giNextAcceleration.ts. Added tests/giParametricSegmentQuery.ts, tests/giSelectiveEstimator.ts and its tests, tests/browser/giSelectiveSurface.ts and worker, tests/browser/giSelectiveDisplay.ts, tests/browser/giSelective.mjs, tests/tsconfig.gi-selective.json, and the two report scripts. Two RGB tuples in tests/browser/sceneReferenceSnapshot.ts were made explicit to fix its existing type errors without changing values. No production source was edited by this investigation.
`
if(existsSync(`${root}/captures/frames.json`)){
 const f=read('captures/frames');const mean=v=>v.reduce((s,x)=>s+x,0)/v.length
 report+='\n## GPU measurements — comparison not validated\n\nThe following are raw full-composer timer readings, not evidence of candidate overhead. Later capture checks failed to establish reliable mode changes across all views. Authored AO was restored for timing; same last sofa camera, three repetitions per requested mode. Each run contains before/changed/after windows, all requesting the same mode.\n\n| Requested mode (unverified) | Mean GPU ms | Range of run means | Mean CPU submission ms |\n|---|---:|---:|---:|\n'
 for(const mode of [0,1]){const runs=f.filter(r=>r.mode===mode).map(r=>Object.values(r.result.cases)[0]),gpu=runs.map(r=>mean(['before','changed','after'].map(k=>r[k].gpuExecutionMeanMs))),cpu=runs.map(r=>mean(['before','changed','after'].map(k=>r[k].cpuSubmissionMeanMs)));report+=`| ${mode?'Stored residual':'Production branch, instrumented material'} | ${fmt(mean(gpu))} | ${fmt(Math.min(...gpu))}–${fmt(Math.max(...gpu))} | ${fmt(mean(cpu))} |\n`}
 report+='\n**No GPU-overhead conclusion is supported.** These measurements also include test attribute/material infrastructure in both branches, rather than comparing against a pristine production build. Scheduling/thermal variation is visible in the raw runs. Peak driver VRAM is not measured. The final guarded capture run never reached GPU timing.\n'
}
report+='\n## Regression checks\n\n218 selected Node regression tests passed, zero failures (tests.tap). Coverage includes visibility through real openings, open door angles, stairwells versus slabs, physical geometry hidden for navigation, glazing eligibility, geometry/cache invalidation, saved GI persistence, cancelled worker work and rapid/coalesced edits. This includes the BVH and estimator energy tests. Production TypeScript build and the dedicated experiment TypeScript check both passed. These are unit/synthetic regressions plus the cached-house browser fixture; the conditional Stage 3 end-to-end dynamic edit matrix was not run for rejected candidates.\n\nReproduce the selected suite in PowerShell:\n\n```powershell\n$files=rg --files tests -g "*test.ts" | Where-Object { $_ -match "indirect|giNext|giSelective|giBarrier|lighting|Lighting|sceneVisibility|roomLight|daylight|viewportScan|partitioned" }\nnode --test --test-isolation=none --experimental-strip-types @files\n```\n'
report+='\n## Visual evidence\n\n![Detailed accuracy across ray budgets](accuracy.png)\n\n'
for(const camera of ['sofa-rear','sofa-left','sofa-right'])report+=`[${camera}: white comparison](${camera}-white-comparison.png) · [authored comparison](${camera}-authored-comparison.png)\n\n`
report+='The final guarded run is under validated-captures/; the folder name denotes the attempted validation, not a blanket pass. Its capture-checks.json records five completed checks before the laptop shutdown interrupted the last view (Runtime.evaluate timeout). **Only sofa-rear white mode both changes HDR and restores the baseline hash exactly.** Authored rear/right views change but fail exact restoration; both left views remain identical. Right-white images exist but their restoration check is incomplete. These limitations are printed on the comparison images. The surviving white round-trip is useful visual evidence, not proof of per-pixel irradiance accuracy or GPU performance.\n\nEarlier captures/, display/, display-verified/ and display-final/ runs are diagnostic only. Shader compilation waits, extra warm frames and canvas-resize waits did not establish reliable mode switching in every view; the underlying cause remains unresolved. An early attempt also lacked the asset service, and another exposed a CDP serialization error from returning the compiled Scene. All failed evidence is retained. The quantitative CPU rejection is independent of these display issues, so no further expensive capture retries or integration were pursued.\n'
writeFileSync(`${root}/REPORT.md`,report)
const width=1050,height=620,bar=34,x0=280,scale=1800
const chartRows=[['Production',.2259608062,0,0],['Previous vertex',.2010657315,0,0],...rows.filter(r=>r.method==='replace').map(r=>[`${r.budget} rays, point estimates`,r.stats.mae.mean,r.stats.mae.min,r.stats.mae.max]),['32 rays, stored correction',.1919160763,.1879894819,.1971509851]]
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="#172431"><text x="30" y="45" font-size="25">Detailed sofa error: sampling gains do not survive storage</text><text x="30" y="76" font-size="16">RGB MAE · 34 diagnostic rows · 32,768-path independent reference</text>${chartRows.map(([label,v,min,max],i)=>{const y=120+i*58;return `<text x="24" y="${y+23}" font-size="16">${label}</text><rect x="${x0}" y="${y}" width="${v*scale}" height="${bar}" fill="${i===6?'#b95036':i<2?'#81919e':'#257c89'}"/>${max?`<path d="M${x0+min*scale},${y+17}H${x0+max*scale}" stroke="#142e39" stroke-width="3"/>`:''}<text x="${x0+Math.max(v,max)*scale+10}" y="${y+23}" font-size="16">${v.toFixed(3)}</text>`}).join('')}<text x="30" y="570" font-size="16">Lines show seed range, not confidence intervals. Eight seeds evaluated separately.</text><text x="30" y="595" font-size="16">Stored correction rejected: face 1049 stays dark and a neighbouring seam sample overbrightens.</text></g></svg>`
await sharp(Buffer.from(svg)).png().toFile(`${root}/accuracy.png`)
const checks=existsSync(`${root}/validated-captures/capture-checks.json`)?read('validated-captures/capture-checks'):[]
for(const camera of ['sofa-rear','sofa-left','sofa-right'])for(const mode of ['white','authored']){const prefix=`${root}/validated-captures/${camera}-${mode}`,paths=[`${prefix}-production.png`,`${prefix}-local.png`];if(!paths.every(existsSync))continue;const check=checks.find(c=>c.camera===camera&&c.white===(mode==='white')),verified=check?.changes&&check?.restoresExactly,size=await sharp(paths[0]).metadata(),status=verified?'HDR mode change and exact baseline restoration verified':'DIAGNOSTIC ONLY — mode validation failed or was interrupted',label=Buffer.from(`<svg width="${size.width*2}" height="75"><rect width="100%" height="100%" fill="${verified?'white':'#fff1db'}"/><g font-family="Arial" font-size="20"><text x="20" y="26">${status}</text><text x="20" y="58">${verified?'Production':'Requested production mode (unverified)'}</text><text x="${size.width+20}" y="58">32-ray stored correction · rejected candidate</text></g></svg>`);await sharp({create:{width:size.width*2,height:size.height+75,channels:3,background:'white'}}).composite([{input:label,left:0,top:0},...paths.map((input,i)=>({input,left:i*size.width,top:75}))]).png().toFile(`${root}/${camera}-${mode}-comparison.png`)}
