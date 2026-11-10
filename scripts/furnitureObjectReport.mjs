import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import sharp from 'sharp'
import {Vector3} from 'three'
import {evaluateObjectGI} from '../tests/furnitureObjectGI.ts'
const root='docs/furniture-object-gi',read=p=>JSON.parse(readFileSync(`${root}/${p}.json`)),mean=a=>a.reduce((s,v)=>s+v,0)/a.length,fmt=(n,d=3)=>n.toFixed(d)
const sampling=read('sofa/sampling'),surface=JSON.parse(readFileSync('docs/gi-next/experiments/surface.json')),reference=JSON.parse(readFileSync('docs/gi-selective/surface/local.json')).detailed,metrics={methods:{},cpu:read('followup/cpu-repeated').map(r=>({strategy:r.strategy,meanTotalMs:mean(r.times),meanSelectionMs:mean(r.selection),meanBlendMs:mean(r.blend),minMs:Math.min(...r.times),maxMs:Math.max(...r.times)})),frames:{},move:read('details-final/editor-movement'),camera:read('details-final/automatic-camera-updates')}
for(const mode of ['production',...sampling.map(r=>r.mode)]){
 const values=mode==='production'?surface.points.map(p=>p.volume):sampling.find(r=>r.mode===mode).receivers.map(p=>p.rgb),deltas=surface.points.flatMap((p,i)=>{const r=reference.find(r=>r.name===p.name).reference;return values[i].map((v,c)=>v-r.sky[c]-r.reflected[c])})
 metrics.methods[mode]={mae:mean(deltas.map(Math.abs)),rmse:Math.sqrt(mean(deltas.map(v=>v*v))),maxError:Math.max(...deltas.map(Math.abs)),seams:surface.points.slice(0,3).map((p,i)=>({name:p.name,irradiance:values[i],mean:mean(values[i])}))}
}
const above=sampling.find(r=>r.mode==='above').result.coefficients
metrics.directions=Object.fromEntries(Object.entries({up:[0,1,0],down:[0,-1,0],positiveX:[1,0,0],negativeX:[-1,0,0],positiveZ:[0,0,1],negativeZ:[0,0,-1]}).map(([name,n])=>[name,evaluateObjectGI(above,new Vector3().fromArray(n))]))
for(const [name,path]of [['sofa-white','sofa/frames'],['several-white','followup/several-frames'],['sofa-authored','authored-timing/sofa'],['several-authored','authored-timing/several']]){
 if(!existsSync(`${root}/${path}.json`))continue
 metrics.frames[name]=read(path).map(r=>{const c=Object.values(r.result.cases)[0];return{mode:r.mode,gpuMs:mean(['before','changed','after'].map(k=>c[k].gpuExecutionMeanMs)),cpuMs:mean(['before','changed','after'].map(k=>c[k].cpuSubmissionMeanMs)),programs:c.changed.programs,drawCalls:c.changed.meanDrawCalls,triangles:c.changed.meanTriangles}})
}
writeFileSync(`${root}/metrics.json`,JSON.stringify(metrics,null,2))
let report=`# Object-level directional furniture GI

**Recommendation: NEEDS FURTHER VALIDATION as a general furniture feature; retain the sofa implementation as an opt-in experiment.** One above-bounds SH sample removes the sofa's severe black GI bands while retaining directional shading. It is cheap to prepare and updates promptly on movement. Larger surfaces lose spatial lighting detail, neighbouring mixed-mode cabinets can differ visibly, and the multi-object GPU results do not establish a reliable speedup. Production defaults and production source files are unchanged.

## Method and existing path

Imported objects live under model-transform-{id} groups in src/components/ThreeDView.tsx. Lamps/stairs carry separate metadata; this experiment explicitly selects known furniture roots rather than globally treating every imported model as furniture. Walls, floors and ceilings use separate scene objects. Production already calculates each model's world Box3 during the lighting scan in src/components/IndirectLighting.tsx. This experiment reuses that convention; transforms update bounds with the existing geometry.

Production's fragment shader in src/indirectLightingShader.ts classifies a receiver and samples the volume after a normal-dependent offset. At the sofa seam that offset was about 0.297 m, crossing a cushion after about 0.041 m. The completed L1 field stores radiance SH in three half-float coefficient arrays: constant, Y, Z, X. Irradiance uses the existing cosine-convolution constants 0.886227 and 1.023328. Standard Three PBR subsequently applies diffuse colour/BRDF, direct shadows, emission and specular response; compositor AO and fake AO geometry are separate.

The new tests/furnitureObjectGI.ts selects a single room using the world bounds centre, checks the bounds perimeter at <=10 cm intervals against that room and rejects uncertain/cross-room/height cases. A point must be in that room, outside the selected object's AABB and outside other model AABBs. This is conservative geometric exclusion, not triangle-level clearance certification; internal obstructions within one room remain a limitation.

For each representative position, blend the nearest eight completed valid probes **from that room only**, with weight 1/(distance² + 0.15²). Keep all twelve signed L1 coefficients. Multi-point strategies average the coefficients equally into the same single object SH set. No new probes, rays, BVHs, path tracing, surface textures or vertex baking. Existing global interpolation/transport is untouched.

The strategies are one point 12 cm above the bounding box; one point beside the nearest accessible box face at centre height; four accessible side/above positions; and eight such positions. Inaccessible sides use additional above-box positions. Final runs contain exactly 1/1/4/8 points; smoke's first eight-point attempt contained seven and is superseded. Positions and probe weights are in sofa/sampling.json. The centre alternative deliberately stays outside the box instead of guessing that an interior cushion gap is empty.

Each selected object gets private material copies and three vec4 uniforms. In the display branch, each pixel evaluates those coefficients with its existing world-space shading normal. It skips the receiver offset and volume lookup, replaces indirect diffuse irradiance, and retains the original capture branch. Direct lights/shadow maps, normal maps, roughness, metalness, emission, exposure and ambient fill are unchanged. The existing GI-dependent reflection-visibility gate now receives the shared directional estimate; the PBR reflection model itself is retained. No second diffuse GI term is added.

## Sofa results

Choose **one above-bounds sample**. Four/eight samples look similar and do not justify extra selection complexity in this scene. The centre-adjacent sample is dimmer and less representative of the exposed cushions. No object-specific brightness multiplier was used.

The front, left/right arms, seat/back seam and cushion views were captured with production/one/four/eight lighting, authored/white materials, and AO off/on. All 24 original baseline–candidate–baseline sequences restore the production HDR buffer exactly. The initial rear camera was blocked by the wall and is excluded as visual evidence. The final rear cutaway hides other beauty meshes after freezing the existing shadow maps; it changes neither saved transport nor sofa geometry, but cannot validate rear wall contact AO. Both cutaway material-mode round trips pass. Final rear comparisons cover production versus the chosen one-sample method.

Black triangular GI bands and the seam stripe are removed in the useful sofa views. Direct sun patches remain in both modes; their angular boundaries are not new GI artefacts. With AO off, local inter-cushion occlusion is deliberately reduced. AO on restores plausible local contact shading. White mode makes the removal of GI bands and the remaining broad directional response easy to assess. Fine physical indirect occlusion is deliberately sacrificed.

| Normal direction | Mean RGB irradiance, one sample |
|---|---:|
${Object.entries(metrics.directions).map(([n,v])=>`| ${n} | ${fmt(mean(v))} |`).join('\n')}

This is not one RGB brightness for every face: the shared field still responds to normal direction. It does eliminate spatial variation between equally oriented surfaces within the same object. Coefficients remain world-oriented when the object rotates; the pixel world normals rotate naturally.

The existing independent 32,768-path reference at 34 detailed receivers is used only as a major-error diagnostic, not the visual acceptance gate. No new reference transport was run.

| Method | Detailed MAE | RMSE | Maximum RGB-component error | Named seam, RGB mean |
|---|---:|---:|---:|---:|
${Object.entries(metrics.methods).map(([n,r])=>`| ${n} | ${fmt(r.mae)} | ${fmt(r.rmse)} | ${fmt(r.maxError)} | ${fmt(r.seams[0].mean)} |`).join('\n')}

The reference seam mean is about 0.290; production is 0.00268 and the one-sample result about 0.385. Face 1049 is about 0.232 against reference 0.193. These are purposeful broad-light approximations, not proof of physically exact contact illumination. Values use saved geometric receiver normals, not a fresh raster normal-map reconstruction. No reference values influence sample placement or weights.

## CPU cost and movement

200 repeated preparations per strategy in the completed cached house, including bounds calculation in the total. Values are means; individual sub-tasks can fall below browser timer resolution.

| Strategy | Total CPU ms | Room/position/probe selection ms | Coefficient blending ms |
|---|---:|---:|---:|
${metrics.cpu.map(r=>`| ${r.strategy} | ${fmt(r.meanTotalMs)} | ${fmt(r.meanSelectionMs)} | ${fmt(r.meanBlendMs)} |`).join('\n')}

Real React editor edit, sofa 20 cm toward the room interior: geometry observed at **${fmt(metrics.move.geometryMs,1)} ms**, coefficients ready at **${fmt(metrics.move.coefficientReadyMs,1)} ms**, and a candidate-material draw observed at **${fmt(metrics.move.firstCandidateDrawMs,1)} ms**. The update itself takes ${fmt(metrics.move.coefficientUpdateMs,1)} ms. The draw is measured by onAfterRender on the live/retained scene, not a GPU presentation timestamp. The next RAF opportunity is separately recorded (${fmt(metrics.move.firstUpdatedFrameMs,1)} ms). House generation advanced from ${metrics.move.generationBefore} to ${metrics.move.generationAfter}; its state was ${metrics.move.houseState} one second later. This is a sofa lighting refresh from the available field, **not completion of the house bake**. The normal background GI update remains enabled.

Warmed isolated 20 cm transforms render in about 15–18 ms, with 0.1 ms SH preparation and geometry updates below 0.1 ms clock resolution. Moving one metre into the room changes the constant red SH coefficient from 0.473 to 0.721; the 20 cm move changes it to 0.508. Returning restores the coefficients. A +20 cm move toward the adjacent room boundary correctly falls back to production instead of borrowing cross-room light. Camera-only movement with the automatic updater active leaves the coefficient update counter unchanged (${metrics.camera.before} → ${metrics.camera.after}), with no update events.

The first earlier un-warmed isolated render took 3,592 ms despite about 0.1 ms coefficient work. That stall was not profiled and is not hidden or attributed to SH computation. The final movement run explicitly warmed the display variant. Cold activation/compilation needs separate validation before product integration. The test-page updater watches transforms and field publication state; full app lifecycle integration is not installed by this experiment.

## GPU timing

AMD Radeon Pro 5600M through ANGLE D3D11, 999 × 740, DPR 1. Full compositor timer queries with AO enabled, navigation-like 2.5 cm camera motion, two runs per mode in A/B/B/A order. Each run averages its before/changed/after windows; all three windows request the same mode. Raw timing counts, program counts and GL errors are retained. The first runs used white mode; the later explicit authored-material run is separately labelled.

| Scene/material mode | Requested GI | GPU ms per run | CPU submission ms per run |
|---|---|---|---|
${Object.entries(metrics.frames).flatMap(([name,rows])=>['production',name==='sofa-white'?'four':'above'].map(mode=>{const r=rows.filter(r=>r.mode===mode);return`| ${name} | ${mode} | ${r.map(r=>fmt(r.gpuMs)).join(', ')} | ${r.map(r=>fmt(r.cpuMs)).join(', ')} |`})).join('\n')}

Sofa-only GPU time changes by roughly a tenth of a millisecond, too small for a strong speedup claim here. The white multi-object run regresses by about 0.56 ms (roughly 9%). Authored multi-object baseline windows drift substantially and program counts grow during the sequence; they do not establish a stable improvement or a clean overhead bound. Fewer texture reads therefore **do not justify claiming higher frame rate**. These results are a reason to keep the feature experimental. Private material/program variants and renderer scheduling are possible contributors, not isolated causes. No performance rewrite was attempted to rescue the result.

## Other furniture and memory

The same above-bounds rule, without tuning, was applied to the dining table, island, one cabinet, a bed and the available office chair. The island shares one coefficient set across five meshes; the cabinet across four. The table asset contains no chairs despite the historical followup filename table-chairs. No dining-chair asset exists in the supplied project/local model catalog, so **dining chairs remain untested**; the office chair is explicitly a substitute geometry test, not equivalent coverage.

The table and island remain directionally lit but flatter over large faces. The selected cabinet is visibly darker than neighbouring production-lit cabinets: mixed-mode adjacency needs review. The bed loses the production gradient across its large surface and looks flatter; we did not introduce a new local algorithm to compensate. Office-chair authored differences are small and its authored round trip is not bit-exact, so that view is qualitative only; white mode restores exactly. Bed authored/white and rear-cutaway round trips restore exactly. This single daylight state is not validation under night lighting, radically different sun positions or arbitrary room shapes.

The object SH payload is **48 bytes**, three vec4 uniforms; no additional sampled texture, geometry buffer or per-vertex data. Four/eight CPU positions still reduce to that same payload, so shader cost is identical across point counts. Material copies, per-object program variants, temporary sample/weight arrays, other-model AABBs and JS object overhead are additional; full driver VRAM/peak process memory is not measured. Existing production GI textures/probes remain resident and continue to light the house. No global memory reduction is claimed.

## Decision and scope

The simple model meets the central sofa quality/responsiveness goal in the tested scene, with deliberate loss of fine indirect occlusion. Keep the one-sample sofa path for review. Do not enable it globally: larger-object flatness, mixed cabinet boundaries, cold activation and multi-object GPU overhead still need validation. Room-boundary fallback is conservative and can visibly change lighting when it engages. Same-room membership alone cannot rule out light crossing an internal partition that shares one room polygon. No connectivity graph or per-frame visibility work was added.

Production source, global interpolation, probe count (301), six-bounce transport, exposure, ambient fill and authored material colours were not changed. All calculation uses the existing completed cache. Only the explicit real editor move invokes the normal background house update. The working tree already contained unrelated modifications; this report does not claim ownership of them.

## Reproduction

The feature boundary is the isolated test-page query **furnitureGI=object** plus explicit construction of furnitureObjectExperiment. It is not a new production settings toggle, and the query alone does not automatically enable every object. The CLI applies it only to the selected fixture roots. A missing flag throws; production materials are restored on dispose. No project/cache schema changes.

\`\`\`powershell
node server/asset-portal.mjs
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5181
$env:FURNITURE_GI_OUT='docs/furniture-object-gi/sofa'
node tests/browser/furnitureObjectGI.mjs 5181 --timings
$env:FURNITURE_GI_OUT='docs/furniture-object-gi/followup'
node tests/browser/furnitureObjectGI.mjs 5181 --followup
$env:FURNITURE_GI_OUT='docs/furniture-object-gi/details-final'
node tests/browser/furnitureObjectGI.mjs 5181 --details --verify-move
node tests/browser/furnitureObjectFrames.mjs 5181
node --experimental-strip-types scripts/furnitureObjectReport.mjs
node --test --test-isolation=none --experimental-strip-types tests/furnitureObjectGI.test.ts
node node_modules/typescript/bin/tsc -p tests/tsconfig.furniture-object.json --pretty false
\`\`\`

New files: tests/furnitureObjectGI.ts, tests/furnitureObjectGI.test.ts, tests/browser/furnitureObjectGI.ts, tests/browser/furnitureObjectGI.mjs, tests/browser/furnitureObjectFrames.mjs, tests/tsconfig.furniture-object.json, scripts/furnitureObjectReport.mjs and docs/furniture-object-gi/. The sampler/shader tests verify same-room exclusion, directional response, representative-point clearance and preservation of the capture/PBR composition contract. **220 selected regression tests pass, zero failures; both the dedicated experiment typecheck and production TypeScript build pass.** Final verification is recorded in verification.json and tests.tap. These are targeted GI/lighting regression tests, not the entire repository test suite.

## Images and retained evidence

[Front, authored, AO on](front-authored-ao-comparison.png) · [Front, white, AO off](front-white-noao-comparison.png) · [One/four/eight white comparison](front-four-way.png)

[Left arm](left-arm-white-ao-comparison.png) · [Right arm](right-arm-white-ao-comparison.png) · [Seat/back seam](seam-white-ao-comparison.png) · [Exposed cushions](cushions-white-ao-comparison.png) · [Rear cutaway](rear-cutaway-white-comparison.png)

[Dining table](table-white-comparison.png) · [Island](island-white-comparison.png) · [Cabinet](cabinet-authored-comparison.png) · [Bed](bed-authored-comparison.png) · [Office chair](office-chair-white-comparison.png)

All individual one/four/eight authored and white PNGs plus raw half-float HDR are in sofa/. Initial rear/bed views obscured by walls are retained but excluded from visual conclusions. Corrected bed and rear-cutaway images are in details-final/. An early cutaway readback failed during shader settling; the final driver bounds retries for that specific readback condition. Failed/interrupted attempts remain in their original folders. The rear beauty cutaway is explicitly a diagnostic display, not a change to architectural GI or a view of the normally visible room. GPU measurements use the normal scene, never that cutaway.
`
writeFileSync(`${root}/REPORT.md`,report)
async function comparison(name,paths,labels,width=800){const inputs=await Promise.all(paths.map(p=>sharp(p).resize({width}).png().toBuffer())),meta=await sharp(inputs[0]).metadata(),header=Buffer.from(`<svg width="${width*paths.length}" height="45"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="19">${labels.map((l,i)=>`<text x="${i*width+12}" y="30">${l}</text>`).join('')}</g></svg>`);await sharp({create:{width:width*paths.length,height:meta.height+45,channels:3,background:'white'}}).composite([{input:header,left:0,top:0},...inputs.map((input,i)=>({input,left:i*width,top:45}))]).png().toFile(`${root}/${name}.png`)}
for(const view of ['front','left-arm','right-arm','seam','cushions'])for(const material of ['white','authored'])for(const ao of ['ao','noao'])await comparison(`${view}-${material}-${ao}-comparison`,['production','above'].map(mode=>`${root}/sofa/${view}-${ao}-${material}-${mode}.png`),['Production','One shared directional SH sample'])
await comparison('front-four-way',['production','above','four','eight'].map(mode=>`${root}/sofa/front-noao-white-${mode}.png`),['Production','One above','Four points','Eight points'],500)
for(const [name,folder,file]of [['table','followup','table-chairs'],['island','followup','island'],['cabinet','followup','cabinet'],['bed','details-final','bed'],['office-chair','details-final','office-chair'],['rear-cutaway','details-final','rear-cutaway']])for(const material of ['white','authored'])await comparison(`${name}-${material}-comparison`,['production','above'].map(mode=>`${root}/${folder}/${file}-${material}-${mode}.png`),[name==='rear-cutaway'?'Production — rear cutaway':'Production',name==='office-chair'&&material==='authored'?'One sample — qualitative only':'One shared directional SH sample'])
console.log(JSON.stringify({methods:metrics.methods,cpu:metrics.cpu,frames:metrics.frames},null,2))
