import fs from 'node:fs'
import crypto from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {DataUtils} from 'three'
const out='docs/gi-l2-physics',read=p=>JSON.parse(fs.readFileSync(`${out}/${p}.json`)),optional=p=>fs.existsSync(`${out}/${p}.json`)?read(p):null
const fmt=(v,n=4)=>v===null||v===undefined?'not measured':v.toFixed(n),pct=v=>fmt(v*100,2)+'%',err=(a,e)=>e?(a/e-1):null,median=a=>{const s=a.filter(Number.isFinite).sort((a,b)=>a-b),n=s.length;return n?(s[Math.floor((n-1)/2)]+s[Math.floor(n/2)])/2:null}
const table=(head,rows)=>['| '+head.join(' | ')+' |','| '+head.map(()=>'---').join(' | ')+' |',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n')
const names=['uniform-0','uniform-rgb','uniform-1','ceiling-source','sun-0','sun-1','sun-2','sun-away'],math=read('math'),units=[1,2].map(o=>read(`l${o}-units`)),rooms=[1,2].map(o=>Object.fromEntries(names.map(n=>[n,read(`l${o}-${n}`)]))),house=[1,2].map(o=>read(`house/l${o}-receivers`)),base=[1,2].map(o=>read(`house/l${o}-baseline`))
const transport=rooms.map(r=>Object.fromEntries(names.map(n=>[n,r[n].passes.map((p,k)=>({pass:k+1,receivers:p.samples.map((s,i)=>({name:s.name,actual:s.rgb,expected:r[n].reference[i].cumulative[k],relativeError:s.rgb.map((v,c)=>err(v,r[n].reference[i].cumulative[k][c])),increment:s.rgb.map((v,c)=>v-(k?r[n].passes[k-1].samples[i].rgb[c]:0)),referenceIncrement:r[n].reference[i].increments[k]}))}))])))
const sun=rooms.map(r=>r['sun-1'].passes[5].samples.map((s,i)=>{const ref=s.rgb.map((_,c)=>r['sun-1'].reference[i].cumulative[5][c]-r['sun-away'].reference[i].cumulative[5][c]),actual=s.rgb.map((v,c)=>v-r['sun-away'].passes[5].samples[i].rgb[c]);return{name:s.name,actual,expected:ref,error:actual.map((v,c)=>err(v,ref[c]))}}))
const views=['bedroom-window','bedroom-sunlit-wall','bedroom-opposite-corner','kitchen','staircase','doors','hallway','living-room']
const imageMetrics=[]
for(const view of views)for(const mode of ['authored','white']){
 const buffers=[1,2].map(o=>{const b=gunzipSync(fs.readFileSync(`${out}/house/l${o}-${view}-${mode}.rgba16f.gz`));return new Uint16Array(b.buffer,b.byteOffset,b.byteLength/2)})
 let a=0,b=0,sq=0,count=0,max=0
 for(let i=0;i<buffers[0].length;i+=4){const x=[0,1].map(k=>[.2126,.7152,.0722].reduce((s,w,c)=>s+w*DataUtils.fromHalfFloat(buffers[k][i+c]),0));if(!x.every(Number.isFinite))continue;a+=x[0];b+=x[1];sq+=(x[1]-x[0])**2;max=Math.max(max,Math.abs(x[1]-x[0]));count++}
 imageMetrics.push({view,mode,L1Mean:a/count,L2Mean:b/count,relativeMeanChange:b/a-1,rmse:Math.sqrt(sq/count),maxDifference:max,note:'Linear pre-tone-map scene luminance, all image pixels including sky/direct light. No HUD. A change is not itself an accuracy improvement.'})
}
const perf=[1,2].map(o=>{
 const frames=optional(`house/l${o}-original-window-steady`)??read(`house/l${o}-steady-frames`),repeat=optional(`house/l${o}-cold-repeat`),final=optional(`house/l${o}-final-steady`)
 return{order:o,coldFullBakeMs:base[o-1].profile.totalMs,coldRepeatMs:repeat?.totalMs,steadyGPUms:median(frames.map(f=>f.gpuMs)),steadyCPUms:median(frames.map(f=>f.cpuMs)),frameSamples:frames.length,authoredGPUms:median(final?.modes.authored.map(f=>f.gpuMs)??[]),whiteRepeatGPUms:median(final?.modes.white.map(f=>f.gpuMs)??[]),ownedTextureBytes:base[o-1].profile.ownedTextureBytes,fieldMemory:house[o-1].memory,updates:Object.fromEntries(['sun-cold','sun-warm','sun-restore','furniture-cold','furniture-warm'].map(n=>[n,optional(`house/l${o}-${n}`)]))}
})
const reference=optional('house/l1-path-reference'),bench=optional('bench-room')
const measured={generated:new Date().toISOString(),transport,sun,house,houseReference:reference,imageMetrics,performance:perf,roomBench:bench,decision:'Retain production L1; keep existing L2 opt-in experimental. Directional physics improves materially, but wall errors remain and the bedroom does not become consistently brighter or clearly more natural.'}
const changed=['tests/browser/giPhysicsUnits.ts','tests/browser/giPhysicsRoom.tsx','tests/browser/roofWallRegression.tsx','tests/sceneLightingReference.ts','tests/sceneLightingReference.test.ts','tests/giL2Math.mjs','tests/giL2Report.mjs','tests/browser/giL2Audit.mjs','tests/browser/giL2House.mjs','tests/browser/giL2HouseView.ts','tests/browser/giL2HouseUpdates.mjs','tests/browser/giL2HouseReference.worker.ts','tests/browser/giL2Bench.mjs','tests/browser/giL2Progress.mjs','tests/browser/giL2FinalReview.mjs']
const sources=['src/indirectProbeIntegration.ts','src/indirectSH.ts','src/indirectSurfaceCache.ts','src/indirectSurfaceRelighting.ts','src/indirectVolume.ts','src/indirectFloorLighting.ts','src/indirectLightingShader.ts','src/components/IndirectLighting.tsx','src/indirectLightingPersistence.ts','src/indirectLightingClient.ts',...changed]
measured.sourceSha256=Object.fromEntries(sources.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))
fs.writeFileSync(`${out}/summary.json`,JSON.stringify(measured,null,2))
const roomRows=rooms[0]['ceiling-source'].passes[5].samples.map((s,i)=>[s.name,fmt(rooms[0]['ceiling-source'].reference[i].cumulative[5][0]),fmt(s.rgb[0]),pct(transport[0]['ceiling-source'][5].receivers[i].relativeError[0]),fmt(rooms[1]['ceiling-source'].passes[5].samples[i].rgb[0]),pct(transport[1]['ceiling-source'][5].receivers[i].relativeError[0])])
const stageRows=base[0].profile.stages.map(a=>{const b=base[1].profile.stages.find(b=>b.name===a.name);return[a.name,fmt(a.cpuMs,1),fmt(b?.cpuMs,1),fmt(a.wallMs,1),fmt(b?.wallMs,1)]})
const report=[
'# L2 GI experiment — retain L1 as production default',
'',
measured.decision,
'',
'[Side-by-side screenshots](index.html) · [Existing-code audit](code-audit.md) · [All measurements and source hashes](summary.json)',
'',
'## Checkpoints',
'',
'A passes: projection, convolution, rotation and GPU evaluation agree. B shows sufficient aggregate improvement to justify C, with explicit wall regressions. C does not establish a convincing bedroom improvement. D records the cost; no global adoption is recommended. No production rendering source or default was changed.',
'',
'Controls: identical source geometry/materials, 16² cube faces, six passes, probe layout, BVH and visibility weights. No exposure, fill, gain, BRDF, bounce-count or smoothing adjustment between candidates. L2 is the existing `?giSH=2` feature flag; absence selects L1. Cache versions distinguish L1 (9) and L2 (10). The house runs assert 301 probes and the requested selected order; both complete 1806 probe-pass updates. Fast GI, contact-probe experiments and soft GI filtering are off in both candidates.',
'',
'## A. Mathematical validation',
'',
'Projection stores signed radiance SH. Irradiance convolution applies π, 2π/3 and π/4 exactly once. The Lambertian material remains rho/π. Direct numerical cosine integration uses 16,384 radiance directions and 2,048 receiver normals; collimated sources have exact discrete-direction references. All RGB channels are recorded separately in `math.json`.',
'',
table(['Distribution','L1 angular RMSE, red','L2 RMSE','L2 maximum absolute error','Minimum unclamped L2'],math.results.map(r=>[r.name,fmt(r.orders[0].channels[0].rmse,6),fmt(r.orders[1].channels[0].rmse,6),fmt(r.orders[1].channels[0].maxError,6),fmt(r.orders[1].channels[0].minUnclamped,6)])),
'',
`Rotation covariance maximum discrepancy: ${fmt(math.rotationMaxError,8)}. Existing GPU volume/floor/packed diagnostic tests: ${read('gpu-volume-floor-sampling').samples} samples, maximum absolute error ${fmt(read('gpu-volume-floor-sampling').maxError,7)} with half-float output. The actual two-surface material shader agrees with CPU SH irradiance × rho/π within 1e-7 radiance.`,
'',
'L2 still rings. For a collimated unit source its unclamped minimum is −0.039584. Final clamping changes the orientation-integrated irradiance by approximately +3.07% relative to the physical reference, versus +12.50% for L1. These are orientation-space consistency measurements, not total house-power measurements. Intermediate coefficients remain signed; final clamping is unchanged. L2 is an improved approximation, not an energy-conservation proof.',
'',
'## B. Controlled transport',
'',
'The original two-surface fixture is unchanged. Reference is independent area quadrature; raw is direct cosine integration of the captured cubemap. Values below are red-channel irradiance in the audit’s relative linear units. Full RGB and measured receiver outgoing radiance are in `l1-units.json` / `l2-units.json`.',
'',
table(['Receiver','Reference','Raw capture','L1','L1 error','L2','L2 error'],units[0].test2.map((a,i)=>{const b=units[1].test2[i];return[a.name,fmt(a.expected[0],6),fmt(a.raw[0],6),fmt(a.actual[0],6),a.expected[0]?pct(a.relativeError[0]):'absolute '+fmt(a.actual[0],6),fmt(b.actual[0],6),b.expected[0]?pct(b.relativeError[0]):'absolute '+fmt(b.actual[0],6)]})),
'',
'The reversed receiver exposes L2 ringing (0.003538 instead of zero). The zero-thickness opaque blocker and source backside are zero for both. This validates those capture-visibility cases; it is not a full certification of interpolation through thin house walls.',
'',
'The entire six-pass transport uses the selected order, including cached surface replay. Each `l*-<case>.json` records every probe’s signed coefficients, representative raw outgoing/captured radiance (all six faces of the first probe), each receiver’s irradiance, reflected rho·E/π, cumulative illumination and pass time. The independent reference is the same one-million-path result used in the physics audit. Six passes mean six source encounters: no extra escaped-sky encounter is included.',
'',
'Nonuniform emissive-ceiling cavity, six completed passes:',
'',
table(['Receiver','Reference','L1','L1 error','L2','L2 error'],roomRows),
'',
'The ceiling improves substantially, but the floor changes from a small underestimate to a similar overestimate and both walls worsen. This is directional redistribution, not a global brightness increase. Uniform black, independent-RGB reflectance [0.2,0.5,0.8], and unit-reflectance cavities stay within 1% in both modes across all passes. The finite unit-reflectance solution grows linearly with source injection; its small residual numerical loss remains.',
'',
table(['Pass','Floor L1 increment','Floor L2 increment','Floor reference','Ceiling L1 increment','Ceiling L2 increment','Ceiling reference'],transport[0]['ceiling-source'].map((p,k)=>[k+1,fmt(p.receivers[0].increment[0]),fmt(transport[1]['ceiling-source'][k].receivers[0].increment[0]),fmt(p.receivers[0].referenceIncrement[0]),fmt(p.receivers[2].increment[0]),fmt(transport[1]['ceiling-source'][k].receivers[2].increment[0]),fmt(p.receivers[2].referenceIncrement[0])])),
'',
'Reflected sunlight, entering minus pointing away (same sky and ground radiance):',
'',
table(['Receiver','Reference ΔE','L1 ΔE','L1 error','L2 ΔE','L2 error'],sun[0].map((s,i)=>[s.name,fmt(s.expected[0],6),fmt(s.actual[0],6),pct(s.error[0]),fmt(sun[1][i].actual[0],6),pct(sun[1][i].error[0])])),
'',
'The primary floor error improves from −37.67% to +5.14%. Rear-wall error worsens from −13.89% to −20.76%, left-wall error also worsens slightly; ceiling improves in absolute error. Sun-off, on, double intensity and away fields are all retained. No surface was separately tuned.',
'',
'## C. Bedroom and house',
'',
'The current authored house was frozen once. Camera/sun/sky/settings from the original bedroom audit were restored only in that fixture; original historical project bytes were not available. Both candidates use those same inputs, exposure 1, fill 0.18 and saved daylight gain 3.5. These authored values were held fixed, not optimized. Fresh caches were generated in separate browsers; no L1 coefficient cache was reused for L2. Neutral-white screenshots change only display material mode, not transport albedo.',
'',
table(['Bedroom receiver','L1 red E','L2 red E','Change'],house[0].points.map((p,i)=>[p.name,fmt(p.irradiance?.[0]),fmt(house[1].points[i].irradiance?.[0]),p.irradiance?pct(err(house[1].points[i].irradiance[0],p.irradiance[0])):'unavailable'])),
'',
'These are geometric-normal field measurements with ordinary receiver bias, not pixel luminance. Near-surface values and positions are also saved. The shaded wall/corner increase, while the bed, floor, ceiling and sunlit wall decrease. L2 therefore does not solve the reported bedroom darkness by itself. The authored screenshots remain visually similar; no clear overall improvement in natural illumination is established.',
'',
reference?table(['Independent bedroom reference','Reference sky + reflected E, red','L1 error','L2 error'],reference.results.map((r,i)=>{const e=r.sky[0]+r.reflected[0];return[r.name,fmt(e),pct(err(house[0].points[i].irradiance[0],e)),pct(err(house[1].points[i].irradiance[0],e))]})):'Independent bedroom reference is pending.',
'',
'House reference limitations: diffuse geometry/material/texture paths at the same biased sample positions, six source encounters; excludes display fill, screen-space AO, specular and normal-map detail. Standard errors and snapshot metadata are retained. It is a diagnostic comparison, not ground truth for every final pixel. The sample named sunlit wall lies on the wall containing the sunlight patch; the reference reports zero direct sun at that particular point.',
'',
'Substantial errors are present before exposure and tone mapping, so exposure cannot explain these measured transport discrepancies. This experiment establishes that higher SH order alone is insufficient. It does not yet separate house capture, probe placement and spatial interpolation as the remaining cause; that narrower diagnosis is the recommended next experiment.',
'',
'A specific spatial sensitivity is already visible in the retained samples: at the dark corner, moving the lookup from 4 mm off the surface to the ordinary 180 mm receiver bias reduces red irradiance from 0.10103 to 0.06774 in L1 and from 0.11377 to 0.07409 in L2 (about one third). The other five locations change by less than 2.5% under the same near-surface comparison. This local sensitivity supports inspecting reconstruction/bias at the corner; it does not prove that probe placement or capture is correct elsewhere, nor that the near-surface lookup is physically preferable.',
'',
'Visual inspection: the existing stair-floor streak and open-door floor band remain. L2 changes their contrast rather than removing them; the stair wall/baseboard transition is more pronounced in the neutral view. The kitchen remains broadly similar, with some redistribution near surfaces/reveals. No severe new high-frequency ringing is evident in the retained views, but the mathematical backside lobe remains a limitation. Kitchen, stairs, open doors, hallway, living room, furniture and window reveals are included in the gallery. A dedicated multi-room thin-wall interpolation fixture was not run; the two-surface zero-thickness blocker is the available controlled visibility check.',
'',
'## D. Performance and memory',
'',
optional('environment')?`Measured on ${read('environment').browser.unmaskedRenderer}, ${read('environment').cpu}; browser/OS/runtime details are retained in \`environment.json\`. Rendered image size is 1199 × 900.`:'Environment metadata unavailable.',
'',
'Benchmarks are sequential isolated Chrome profiles. “Cold” means a new browser/renderer, not a cleared operating-system/GPU-driver shader cache. Browser and driver warmup, scheduling and order effects are substantial; one faster L2 run is not evidence that L2 intrinsically accelerates GI. GPU frame values come from timer queries, not the screenshot HUD FPS. Initial steady frames use the original window camera in neutral-white display mode. The final review repeats both authored and white modes, with 36 warmup frames followed by 36 measured frames each. Raw radiance tracing is disabled for the room timing run. The L1 house-reference worker ran and terminated before its incremental-update measurements, introducing a possible warmup asymmetry. A failed attempt caused by an unavailable asset server is archived separately; completed comparisons use the restored server.',
'',
table(['House metric','L1','L2'],[
 ['Initial full GI profile (ms)',fmt(perf[0].coldFullBakeMs,1),fmt(perf[1].coldFullBakeMs,1)],
 ['Fresh-browser repeat profile (ms)',fmt(perf[0].coldRepeatMs,1),fmt(perf[1].coldRepeatMs,1)],
 ['Steady median GPU frame (ms)',fmt(perf[0].steadyGPUms,3),fmt(perf[1].steadyGPUms,3)],
 ['Steady median CPU submission (ms)',fmt(perf[0].steadyCPUms,3),fmt(perf[1].steadyCPUms,3)],
 ['Final authored median GPU frame (ms)',fmt(perf[0].authoredGPUms,3),fmt(perf[1].authoredGPUms,3)],
 ['Final white median GPU frame (ms)',fmt(perf[0].whiteRepeatGPUms,3),fmt(perf[1].whiteRepeatGPUms,3)],
 ['Tracked GI texture allocation (MiB)',fmt(perf[0].ownedTextureBytes/2**20,2),fmt(perf[1].ownedTextureBytes/2**20,2)],
 ['CPU volume interpolation capacity (MiB)',fmt(base[0].gi.interpolationProfile.volume.capacityBytes/2**20,2),fmt(base[1].gi.interpolationProfile.volume.capacityBytes/2**20,2)],
 ['CPU floor interpolation capacity (MiB)',fmt(base[0].gi.interpolationProfile.floor.capacityBytes/2**20,2),fmt(base[1].gi.interpolationProfile.floor.capacityBytes/2**20,2)],
 ['Volume lookup preparation timer (ms)',fmt(base[0].gi.interpolationProfile.warmVolumeCpuMs,1),fmt(base[1].gi.interpolationProfile.warmVolumeCpuMs,1)],
 ['Floor lookup preparation timer (ms)',fmt(base[0].gi.interpolationProfile.warmFloorCpuMs,1),fmt(base[1].gi.interpolationProfile.warmFloorCpuMs,1)],
 ['Median volume evaluation timer (ms)',fmt(median(base[0].gi.interpolationProfile.evaluations.map(e=>e.volumeMs)),1),fmt(median(base[1].gi.interpolationProfile.evaluations.map(e=>e.volumeMs)),1)],
 ['Median floor evaluation timer (ms)',fmt(median(base[0].gi.interpolationProfile.evaluations.map(e=>e.floorMs)),1),fmt(median(base[1].gi.interpolationProfile.evaluations.map(e=>e.floorMs)),1)],
 ...['volumeBytes','floorBytes','coefficientBytes'].map(k=>[k+' (MiB)',fmt(house[0].memory[k]/2**20,3),fmt(house[1].memory[k]/2**20,3)]),
 ...['sun-cold','sun-warm','sun-restore','furniture-cold','furniture-warm'].map(n=>[n+' completed update (ms)',fmt(perf[0].updates[n]?.elapsedMs,1),fmt(perf[1].updates[n]?.elapsedMs,1)]),
 ]),
'',
bench?table(['Controlled cavity','L1 median ms','L2 median ms','Change'],[0,1].map(w=>{const a=median(bench.filter(b=>b.order===1&&(w?b.warm>0:b.warm===0)).map(b=>b.elapsedMs)),b=median(bench.filter(b=>b.order===2&&(w?b.warm>0:b.warm===0)).map(b=>b.elapsedMs));return[w?'Warm full bake (4 trials/order)':'Fresh-browser bake (2 trials/order)',fmt(a,1),fmt(b,1),pct(err(b,a))]})):'Controlled repeat timing pending.',
'',
`The house repeat increases full bake time by ${pct(err(perf[1].coldRepeatMs,perf[0].coldRepeatMs))}, slightly missing the <20% target. The small cavity stays within that target, but does not represent house-scale preparation. The final authored GPU median difference is ${perf[1].authoredGPUms===null?'pending':fmt(perf[1].authoredGPUms-perf[0].authoredGPUms,3)+' ms'}, ${perf[1].authoredGPUms-perf[0].authoredGPUms>=.5?'exceeding':'within'} the <0.5 ms target in this sample. This is specific to the tested camera and hardware, with substantial cross-run variability; the white-mode result has the opposite sign, so the precise intrinsic shader overhead is not isolated. Warm sunlight and furniture update completion times rise by ${pct(err(perf[1].updates['sun-warm']?.elapsedMs,perf[0].updates['sun-warm']?.elapsedMs))} and ${pct(err(perf[1].updates['furniture-warm']?.elapsedMs,perf[0].updates['furniture-warm']?.elapsedMs))}; single trials do not establish an input-latency bound, but these completion-time regressions weigh against adoption. Tracked texture allocation rises by ${pct(err(perf[1].ownedTextureBytes,perf[0].ownedTextureBytes))}; that cost has no demonstrated bedroom benefit here.`,
'',
'Coefficient/volume/floor payloads increase by exactly 2.25× at unchanged dimensions. Total tracked GI textures increase by less because geometry/surface buffers do not scale with SH order. These are allocated payload bytes, not whole-process VRAM or heap usage; browser/driver allocation overhead and all asset textures are outside that figure. Worker interpolation capacities and preparation/evaluation CPU times are in each profile/status. Per-pass timing is in the cavity benchmark and transport records. CPU submission and asynchronous wall spans overlap and must not be added together.',
'',
'Initial house stage timings (CPU submission and asynchronous wall spans, ms):',
'',
table(['Stage','L1 CPU','L2 CPU','L1 wall span','L2 wall span'],stageRows),
'',
'## Accepted changes and next step',
'',
'Accepted: reuse and validate the existing L2 flag; parameterize the original fixtures; retain raw per-pass/RGB measurements and paired screenshots; add an explicit six-encounter option to the test-only house reference. Rejected: changing production defaults, adding brightness compensation, altering the BRDF, increasing density/bounces, or changing visibility/smoothing. No production source edits were needed.',
'',
'Validation: 23 SH/cache/client tests and four independent-reference tests passed, along with focused TypeScript checking, the numerical SH suite, 288 GPU sampling checks, and completed production transport fixtures. All 36 gallery images load in both material modes without browser errors. The L1 two-surface rerun matches the prior audit values exactly. The authored project SHA-256 still matches the frozen-input metadata.',
'',
'Recommendation: keep L2 available experimentally, retain L1 as default. Next isolate actual-bedroom capture versus spatial reconstruction at the measured receivers, using the retained directional reference. The controlled physics gain alone does not justify adoption while several surfaces worsen and the bedroom visual benefit is unconvincing. Preserve the unchanged exposure and source controls during that next investigation.',
'',
'Exact source/test files changed in this experiment:',
'',
...changed.map(p=>'- `'+p+'`'),
'',
'Generated artifacts: this report, `code-audit.md`, `index.html`, JSON/HDR/PNG measurements under `docs/gi-l2-physics/`, and the isolated frozen input `tmp/gi-l2-house-project.json`. No authored project file was written.',
'',
'## Reproduce',
'',
'```powershell',
'npx vite --config tests/browser/doorFloorVite.config.mjs --host localhost --port 5181',
'# Asset portal on port 5174 is also needed for the house fixtures.',
'node --test --test-isolation=none --experimental-strip-types tests/indirectSH.test.ts tests/indirectLightingPersistence.test.ts tests/indirectLightingClient.test.ts tests/sceneLightingReference.test.ts',
'node --experimental-strip-types tests/giL2Math.mjs',
'node --experimental-strip-types tests/browser/giL2Audit.mjs',
'node --experimental-strip-types tests/browser/giL2House.mjs',
'node --experimental-strip-types tests/browser/giL2HouseUpdates.mjs',
'node --experimental-strip-types tests/browser/giL2Bench.mjs',
'node tests/giL2Report.mjs',
'node --experimental-strip-types tests/browser/giL2FinalReview.mjs',
'node tests/giL2Report.mjs',
'```',
]
fs.writeFileSync(`${out}/report.md`,report.join('\n')+'\n')
const galleryViews=fs.existsSync(`${out}/house/l2-original-window-authored.png`)?['original-window',...views]:views
fs.writeFileSync(`${out}/index.html`,`<!doctype html><meta charset="utf-8"><title>L1 / L2 GI comparison</title><style>body{font:16px system-ui;background:#17191d;color:#e8e8eb;margin:24px}a{color:#9cc9ff}header{position:sticky;top:0;background:#17191df5;padding:12px;z-index:2}select{font:inherit;padding:8px}section{margin:28px 0}h2{font-size:18px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%;display:block}figcaption{padding:8px;background:#262a30}button{font:inherit;padding:6px}p{max-width:1000px}</style><header><strong>L1 / L2: unchanged lighting and exposure</strong> <select id="mode"><option value="authored">Authored materials</option><option value="white">Neutral white display</option></select> <a href="report.md">Report</a> · <a href="summary.json">Raw summary</a></header><p>Fresh six-pass fields, 301 probes each. L2 remains opt-in. White display uses the same authored transport albedos. The original-window view retains the initial renderer FOV; other views are wider diagnostic cameras. Ignore HUD FPS: use timer-query measurements in the report.</p>${galleryViews.map(v=>`<section><h2>${v.replaceAll('-',' ')}</h2><div class="pair">${[1,2].map(o=>`<figure><a data-link="house/l${o}-${v}" href="house/l${o}-${v}-authored.png"><img loading="lazy" data-base="house/l${o}-${v}" src="house/l${o}-${v}-authored.png"></a><figcaption>L${o}${o===1?' — production default':' — experiment'}</figcaption></figure>`).join('')}</div></section>`).join('')}<script>document.querySelector('#mode').onchange=e=>{document.querySelectorAll('[data-base]').forEach(i=>i.src=i.dataset.base+'-'+e.target.value+'.png');document.querySelectorAll('[data-link]').forEach(a=>a.href=a.dataset.link+'-'+e.target.value+'.png')}</script>`)
console.log(measured.decision)
