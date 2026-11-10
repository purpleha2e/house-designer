import fs from 'node:fs'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
const dir='docs/door-confidence/',read=n=>JSON.parse(fs.readFileSync(dir+n,'utf8'))
const configurations=['original','moved','rotated','moved-fixed-original','rotated-fixed-original','original-fixed-fresh-original']
const datasets=Object.fromEntries(configurations.map(n=>[n,read(n+'-results.json')]))
const candidates=Object.keys(datasets.original.counters),ref=p=>p.reference.sky.map((v,c)=>v+p.reference.reflected[c])
const mean=a=>a.reduce((a,b)=>a+b,0)/Math.max(1,a.length),lum=v=>v[0]*.2126+v[1]*.7152+v[2]*.0722
const err=(p,k)=>ref(p).map((v,c)=>Math.abs(v-p.variants[k].rgb[c]))
const metrics={},pointMetrics={}
for(const [name,d]of Object.entries(datasets)){
 if(!d.ok)throw Error(name+' failed: '+d.error)
 const grid=d.points.filter(p=>p.kind==='grid'),byName=new Map(grid.map(p=>[p.name,p]))
 metrics[name]={};pointMetrics[name]=[]
 for(const p of d.points){
  const record={name:p.name,position:p.position,reference:ref(p),variants:{}}
  const [_,x,z]=p.name.split('-').map((v,i)=>i?Number(v):v)
  for(const k of candidates){
   const absolute=err(p,k),gradient={}
   if(p.kind==='grid')for(const [axis,q]of [['x',byName.get(`grid-${x+1}-${z}`)],['z',byName.get(`grid-${x}-${z+1}`)]])if(q){
    const distance=Math.hypot(...p.position.map((v,i)=>v-q.position[i])),actual=q.variants[k].rgb.map((v,c)=>(v-p.variants[k].rgb[c])/distance),expected=ref(q).map((v,c)=>(v-ref(p)[c])/distance)
    gradient[axis]={actual,reference:expected,error:actual.map((v,c)=>Math.abs(v-expected[c]))}
   }
   record.variants[k]={absolute,relative:ref(p).map((v,c)=>Math.abs(v)>1e-6?absolute[c]/Math.abs(v):null),gradient}
  }
  pointMetrics[name].push(record)
 }
 for(const k of candidates){
  const errors=grid.flatMap(p=>err(p,k)),controls=d.points.filter(p=>p.kind==='control')
  const gradients=pointMetrics[name].filter(p=>p.name.startsWith('grid-')).flatMap(p=>Object.values(p.variants[k].gradient).flatMap(g=>g.error))
  metrics[name][k]={rgbMAE:mean(errors),normalizedMAE:mean(errors)/mean(grid.flatMap(ref)),gradientMAE:mean(gradients),controlMAE:mean(controls.flatMap(p=>err(p,k))),controlMaxChange:Math.max(0,...controls.flatMap(p=>p.variants[k].rgb.map((v,c)=>Math.abs(v-p.variants.binary.rgb[c])))),totalQueries:d.counters.binary.queries+(k==='binary'?0:d.counters[k].queries),additionalQueries:k==='binary'?0:d.counters[k].queries,interpolationMs:d.counters.binary.ms+(k==='binary'?0:d.counters[k].ms)}
 }
}
fs.writeFileSync(dir+'metrics.json',JSON.stringify({metrics,pointMetrics},null,2))

const colour=(t,signed=false)=>{
 t=Math.max(0,Math.min(1,t))
 if(signed){const a=t<.5?[45,91,165]:[179,37,49],mix=Math.abs(t-.5)*2;return`rgb(${a.map(v=>Math.round(255*(1-mix)+v*mix)).join(',')})`}
 const stops=[[30,28,73],[48,89,134],[38,145,140],[137,196,100],[253,231,37]],f=t*4,i=Math.min(3,Math.floor(f));return`rgb(${stops[i].map((v,c)=>Math.round(v+(stops[i+1][c]-v)*(f-i))).join(',')})`
}
for(const name of ['original','moved','rotated']){
 const d=datasets[name],grid=d.points.filter(p=>p.kind==='grid'),max=Math.max(...grid.flatMap(p=>[lum(ref(p)),lum(p.variants.binary.rgb),lum(p.variants['ring8-0.08'].rgb),lum(p.variants['boundary-taper'].rgb)]))
 const titles=['Binary irradiance','8 rays / 8 cm irradiance','Boundary taper irradiance','Independent reference','8-ray signed error','8-ray mean confidence','Taper signed error','Taper mean confidence']
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1360" height="690"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="#233141"><text x="35" y="32" font-size="23">${name}: floor irradiance and candidate confidence</text>`
 for(let panel=0;panel<8;panel++){
  const left=35+(panel%4)*335,top=88+Math.floor(panel/4)*280,w=12,h=12
  svg+=`<text x="${left}" y="${top-18}" font-size="16">${titles[panel]}</text>`
  for(const p of grid){const [,x,z]=p.name.split('-').map((v,i)=>i?Number(v):v);let t
   if(panel<4)t=lum(panel===3?ref(p):p.variants[['binary','ring8-0.08','boundary-taper'][panel]].rgb)/max
   else if(panel%2===0)t=.5+(lum(p.variants[panel===4?'ring8-0.08':'boundary-taper'].rgb)-lum(ref(p)))/.4
   else t=p.variants.binary.support>0?p.variants[panel===5?'ring8-0.08':'boundary-taper'].support/p.variants.binary.support:null
   svg+=`<rect x="${left+x*w}" y="${top+(16-z)*h}" width="${w+.1}" height="${h+.1}" fill="${t===null?'#ddd':colour(t,panel===4||panel===6)}"/>`
  }
  const scale=panel<4?`Luminance 0 to ${max.toFixed(3)}`:panel%2===0?'Error -0.20 (blue) to +0.20 (red)':'Confidence 0 to 1; grey = no support'
  svg+=`<text x="${left}" y="${top+225}" font-size="12">${scale}</text>`
 }
 svg+='<text x="35" y="650" font-size="14">Same world grid and completed probe field within each configuration. Error = candidate minus independent reference.</text><text x="35" y="674" font-size="14">Heatmaps show luminance; acceptance also checks all RGB channels. No candidate was applied to production.</text></g></svg>'
 fs.writeFileSync(dir+name+'-heatmaps.svg',svg);await sharp(Buffer.from(svg)).png().toFile(dir+name+'-heatmaps.png')
}

const refined=read('original-notch-refined-results.json'),notch=refined.points.filter(p=>['trace-4','trace-5'].includes(p.name)),radiometric=read('radiometric-regressions.json')
const notchError=k=>mean(notch.flatMap(p=>err(p,k))),f=v=>v.toFixed(6)
const changed=['tests/doorVisibilityConfidence.ts','tests/doorVisibilityConfidence.test.ts','tests/doorConfidenceRadiometric.ts','tests/doorConfidenceReplay.mjs','tests/doorConfidenceReport.mjs','tests/browser/doorConfidence.worker.ts','tests/browser/doorConfidenceExperiment.ts','tests/browser/doorConfidenceArtifacts.mjs','tests/browser/doorConfidencePerformance.ts','tests/browser/roofWallRegression.tsx']
fs.writeFileSync(dir+'source-hashes.json',JSON.stringify(Object.fromEntries(changed.map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),null,2))
let report=`# Door-gap visibility confidence: rejected correction

**Neither hypothesis passed the accuracy gate. Production binary interpolation remains unchanged.** The broadest neighbourhood and the bounded continuity taper reduce the known red-channel dip, but increase RGB error at the notch and do not consistently improve the complete floor pattern across poses. No combined method or production feature flag was added because the independent candidates did not show complementary benefits.

## Controlled experiment

All candidates retain the production central BVH ray, spatial kernel, L1 basis and coefficient normalization. A blocked central ray always yields zero influence. The only experimental factor multiplies the existing unnormalized distance weight; support/confidence attenuation is then computed from the resulting weight sum. No completed lighting texture is blurred.

Production path inspected: src/indirectVolume.ts createIndirectVolumeLookup (line 46) caches distance weights and visibility states; sampleIndirectCoefficients (line 185) provides the direct equivalent. Visible weights contribute to support and the normalized SH blend. src/indirectFloorLighting.ts writeIndirectFloorRow (line 37) applies indirectFloorConfidence to that blend and stores half-float coefficients. The prototypes mirror this path in tests/doorVisibilityConfidence.ts; none of these production functions was edited for this experiment.

- Binary: existing one-ray decision.
- Neighbourhood: central ray plus 4 cardinal or 8 evenly spaced ring rays, with radii 1, 2, 4 and 8 cm. Confidence is visible rays / total rays, including the central ray, after central visibility gating. These predetermined distances span below and approximately one/two floor cells; they were not fitted to probe 590.
- One continuity alternative: on the existing floor lattice, find the nearest blocked neighbour within two cells, subtract half a cell to estimate the boundary, and smoothstep its distance over two cells. The central ray still gates every contribution. This is a bounded, discrete visibility-boundary taper, not a guarantee of mathematical continuity or a radiometric aperture measurement.

Each actual-house configuration uses 400 receivers: the original 17-texel trace, a 22 x 17 floor grid at approximately 8 cm spacing covering the visible streaks and perpendicular crossings, and 9 unaffected controls. Every diagnostic binary reconstruction is checked against sampleIndirectCoefficients to 1e-8 before comparison.

The original dense grid uses 6144 independent paths per receiver; the four known transition samples use 65536, and the remaining original trace uses its retained 16384-path measurements. Moved/rotated sweeps use 1536 paths per receiver. All references use six diffuse bounces, the corresponding actual scene triangles, authored materials and sun. Small sweep-score differences are not claimed statistically decisive; the high-sample notch result is the stronger rejection evidence. Secondary specular transport, mesh emission and secondary normal-map perturbations are absent from the reference.

## Results

Mean absolute error over all RGB components (linear irradiance). Grid columns cover the full 374-point pattern, rather than just the known notch.

| Method | Known notch, 65536 paths | Original grid | Moved grid | Rotated grid |
|---|---:|---:|---:|---:|
`
for(const k of candidates)report+=`| ${k} | ${f(notchError(k))} | ${f(metrics.original[k].rgbMAE)} | ${f(metrics.moved[k].rgbMAE)} | ${f(metrics.rotated[k].rgbMAE)} |\n`
report+=`
Probe 590 at (2.25,0.18,14) in the original field, first notch texel X=1.901466, Z=15.123:

| Method | Visibility confidence | Normalized influence | Irradiance RGB |
|---|---:|---:|---|
`
const p=refined.points.find(p=>p.name==='trace-4'),index=p.links.findIndex(l=>l.index===590)
for(const k of ['binary','ring8-0.04','ring8-0.08','boundary-taper']){const v=p.variants[k];report+=`| ${k} | ${f(v.confidence[index])} | ${f(v.normalizedWeights[index])} | ${v.rgb.map(f).join(', ')} |\n`}
report+=`\nIndependent RGB at that receiver: **${ref(p).map(f).join(', ')}**. Red moves closer while green/blue overshoot. This is why reducing the visibility discontinuity alone is insufficient.

The complete per-probe confidences, unnormalized/normalized weights, resulting SH coefficients and irradiance are in each *-results.json. [metrics.json](metrics.json) adds per-receiver RGB absolute/relative errors, X/Z spatial gradients, reference gradients, aggregate errors and query counts. Relative errors at a zero reference are null rather than misleading infinities.

### Original probe 590 trace

All receivers below have Z=15.123 and sample Y=0.016. Visibility is the central geometric test. Reference values use the refined measurements where available.

| X | Visible | Unnormalized weight | Normalized weight | Binary red | Reference red |
|---|---|---:|---:|---:|---:|
${datasets.original.points.filter(p=>p.kind==='trace').map(p=>{const i=p.links.findIndex(l=>l.index===590),v=p.variants.binary;return '| '+[f(p.position[0]),i>=0&&p.links[i].central?'yes':'no',f(i>=0?v.weights[i]:0),f(i>=0?v.normalizedWeights[i]:0),f(v.rgb[0]),f(ref(p)[0])].join(' | ')+' |'}).join('\n')}

## House geometry and probe identity

The actual Interior double doors open assembly was tested at its original pose, translated -0.4 m in world X, and rotated +30 degrees in the authored rotation convention about the original placement pivot. Other authored house geometry and active lighting settings remain unchanged. The transformed assembly is detached only in the test fixture, preserving the wall opening. Exact transforms and cameras are in each *-capture.json. The rotation is a deliberate assembly stress test, not a claim that a framed door would be installed at that angle.

The original source field had already been verified bit-for-bit against a fresh completed bake at the 17 trace points. This run also reevaluates all 400 receivers and every candidate using that retained fresh original field (original-fixed-fresh-original-results.json). Its maximum baseline RGB change from the original source field over these receivers is ${Math.max(...datasets.original.points.flatMap((p,i)=>p.variants.binary.rgb.map((v,c)=>Math.abs(v-datasets['original-fixed-fresh-original'].points[i].variants.binary.rgb[c])))).toExponential(4)}. The complete fields are not claimed bit-identical away from the 17 trace points. Moved and rotated production fields were completely recalculated; the rotated fixture explicitly rejects the old cache to require a fresh bake with no reused probes. Probe layouts and diffuse fields are preserved per configuration.

Within each pose, baseline and all candidates share one immutable completed field. Additional fixed-original-field tests use the original positions and coefficients against moved/rotated geometry and corresponding independent references. These counterfactuals isolate geometry/weight changes; their stale transported coefficients are **not** treated as correct fresh lighting. Probe indices are never equated across production layouts.

| Frozen-original-field stress test | Binary grid MAE | 8 rays / 8 cm | Boundary taper |
|---|---:|---:|---:|
`
for(const n of ['moved-fixed-original','rotated-fixed-original'])report+=`| ${n} | ${f(metrics[n].binary.rgbMAE)} | ${f(metrics[n]['ring8-0.08'].rgbMAE)} | ${f(metrics[n]['boundary-taper'].rgbMAE)} |\n`
report+=`
Screenshots: [original](original.png), [moved](moved.png), [rotated](rotated.png). These show the production baseline for each pose; there is no accepted after-fix screenshot. Candidate spatial results are in the heatmaps:

![Original comparisons](original-heatmaps.png)
![Moved comparisons](moved-heatmaps.png)
![Rotated comparisons](rotated-heatmaps.png)

Confidence heatmaps show distance-weighted mean confidence over centrally visible links. Unsupported receivers are grey. This avoids mislabelling a reassigned probe index as the original physical probe. Signed-error maps show luminance; full RGB errors are retained numerically.

## Regression evidence

Twelve focused tests verify central-ray exclusion, no opposite-side bright contribution through a 6 mm wall/closed door/slab, stable broad door/window/stairwell/open-room interpolation, constant-radiance conservation and deterministic repeated sampling. Cabinet, cushion-gap and table-leg geometries are included. Synthetic independent-reference fixtures also compare interpolation using two L1 probes whose L0 terms match independently measured upward irradiance. These isolate interpolation; they are not full production probe-transport bakes.

| Reference fixture | Binary RGB MAE | 8 rays / 8 cm | Boundary taper |
|---|---:|---:|---:|
`
for(const r of radiometric.results){const score=k=>mean(r.points.flatMap(p=>err(p,k)));report+=`| ${r.kind} | ${f(score('binary'))} | ${f(score('ring8-0.08'))} | ${f(score('boundary-taper'))} |\n`}
report+=`
The narrow but legitimate opening is not treated as automatically erroneous: it is evaluated against the same triangle-based reference. Its improvement does not compensate for worse actual-house results. The existing floor, interpolation-reuse and permanent 6 mm barrier tests are also run separately; see tests.txt.

## Performance and decision

Actual query counts for the 400 original-house receivers, including the common central rays:

| Method | Total BVH queries | Additional queries | Measured interpolation CPU ms |
|---|---:|---:|---:|
`
for(const k of candidates){const m=metrics.original[k];report+=`| ${k} | ${m.totalQueries} | ${m.additionalQueries} | ${m.interpolationMs.toFixed(2)} |\n`}
report+=`
These are diagnostic direct-sampler measurements, **not whole-house cached floor-build benchmarks**. The direct prototypes would add substantial ray work if naively deployed. Because accuracy failed, no production optimization or cache-format change was pursued. Baseline complete GI times were ${(read('moved-capture.json').profile.totalMs/1000).toFixed(2)} s (moved) and ${(read('rotated-capture.json').profile.totalMs/1000).toFixed(2)} s (rotated). Their six combined floor/volume worker round trips total ${(read('moved-capture.json').profile.stages.find(s=>s.name==='irradiance volume worker').wallMs/1000).toFixed(2)} s and ${(read('rotated-capture.json').profile.stages.find(s=>s.name==='irradiance volume worker').wallMs/1000).toFixed(2)} s; these do not isolate floor-only construction. Full counters are preserved in the capture files.

The unchanged rotated renderer's 60-frame baseline has CPU submission median ${read('frame-baseline.json').cpuSubmissionMs.median.toFixed(2)} ms, p95 ${read('frame-baseline.json').cpuSubmissionMs.p95.toFixed(2)} ms, and animation-frame interval median ${read('frame-baseline.json').animationFrameIntervalMs.median.toFixed(2)} ms. GPU execution time is not separately measured. Reported GI-owned GPU allocations are ${(read('moved-capture.json').profile.ownedTextureBytes/1048576).toFixed(2)} MiB moved and ${(read('rotated-capture.json').profile.ownedTextureBytes/1048576).toFixed(2)} MiB rotated; these differing baseline allocations are not a candidate memory comparison. A candidate whole-floor preparation/bake/incremental timing, GPU memory delta and normal-frame delta were not benchmarked: no candidate entered the renderer or its transport loop. Production adds zero rays, buffers, textures or shader work.

An additional 1 cm world-X translation of the rotated door measured the unchanged production incremental path: ${(read('incremental-profile.json').profile.totalMs/1000).toFixed(2)} s, partial=true, ${read('incremental-profile.json').state.reusedProbes} reused probes. Floor visibility preparation consumed ${read('incremental-profile.json').interpolationProfile.warmFloorCpuMs.toFixed(2)} ms; its six floor evaluations total ${read('incremental-profile.json').interpolationProfile.evaluations.reduce((s,e)=>s+e.floorMs,0).toFixed(2)} ms. The final floor cache rechecked ${read('incremental-profile.json').interpolationProfile.floor.visibilityTests} visibility links and retained ${read('incremental-profile.json').interpolationProfile.floor.retainedStates} existing states. These are measured baseline figures, not candidate performance claims. Full data: [incremental-profile.json](incremental-profile.json).

Replay memory (RSS/heap/external buffers) is recorded in Node replay results; the snapshots include approximately 0.8 GB of typed geometry/material/reference input per pose and are compressed losslessly on disk. This is investigation storage/working memory, not proposed production memory. Do not extrapolate the 400-receiver timing into a claim of acceptable whole-house overhead.

Acceptance: small radii leave the known notch essentially intact. The widest rings give a tiny aggregate original-grid improvement, but worsen moved/rotated grid scores and the high-sample notch RGB score. The single taper also fails RGB accuracy and consistent complete-streak improvement. Broad geometric constraints pass, but no candidate meets all required gates. Therefore **reject all candidates and retain binary production interpolation**. There is no basis for combining two rejected confidence heuristics. The remaining issue is the representativeness of the probe's low-order irradiance, which geometric visibility fraction alone did not correct.

## Reproduction and changed files

Start the asset portal and isolated Vite server, then the existing browser harness and artifact sink:

\`\`\`powershell
node server/asset-portal.mjs
node node_modules/vite/bin/vite.js --config tests/browser/doorFloorVite.config.mjs --host 127.0.0.1 --port 5181 --strictPort
node tests/browser/renderArtefactSession.mjs
node tests/browser/doorConfidenceArtifacts.mjs
\`\`\`

The browser entry startDoorConfidence in tests/browser/doorConfidenceExperiment.ts snapshots the current completed pose. The isolated fixture supports door-confidence-pose=moved or rotated and door-confidence-fresh; the latter preserves saved lighting settings while rejecting the saved field. The authoring JSON is never written.

The retained *-input.bin.gz files permit complete numerical replay without a browser, asset server or access to the original model:

\`\`\`powershell
node --max-old-space-size=4096 tests/doorConfidenceReplay.mjs original refine-notch
node --max-old-space-size=4096 tests/doorConfidenceReplay.mjs original refine-grid
node --max-old-space-size=4096 tests/doorConfidenceReplay.mjs moved
node --max-old-space-size=4096 tests/doorConfidenceReplay.mjs rotated
node --max-old-space-size=4096 tests/doorConfidenceReplay.mjs moved reuse-reference fixed-field=original
node --max-old-space-size=4096 tests/doorConfidenceReplay.mjs rotated reuse-reference fixed-field=original
node --max-old-space-size=4096 tests/doorConfidenceReplay.mjs original reuse-reference fixed-field=fresh-original
node --experimental-strip-types tests/doorConfidenceRadiometric.ts
node --test --test-isolation=none --experimental-strip-types tests/doorVisibilityConfidence.test.ts tests/indirectFloorLighting.test.ts tests/indirectInterpolationReuse.test.ts tests/giBarrierFiltering.test.ts
node tests/doorConfidenceReport.mjs
\`\`\`

Source files changed for this experiment (all diagnostic/test code):

${changed.map(p=>'- '+p).join('\n')}

Source hashes are in source-hashes.json. Remaining limits: the dense Monte Carlo maps have sampling error; the rotated assembly is a stress configuration; synthetic fixtures use a simplified two-probe representation; whole-floor optimized candidate performance is unmeasured. None of these limitations is concealed as a successful correction. The authorized bounded experiments are complete and the production artefact remains unresolved.
`
fs.writeFileSync(dir+'report.md',report)
console.log(JSON.stringify({decision:'reject',original:metrics.original['ring8-0.08'],report:dir+'report.md'}))
