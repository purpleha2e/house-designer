import fs from 'node:fs'
import crypto from 'node:crypto'
import {LOCAL_SUN_PREVIEW_BUDGET} from '../src/localSunPreview.ts'
const root='docs/combined-sun-preview',decode=b=>b.length>1&&b.readUInt16LE(0)===0xfeff?b.toString('utf16le').slice(1):b.toString('utf8').replace(/^\uFEFF/,'')
const read=p=>JSON.parse(decode(fs.readFileSync(p))),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const shader=read(root+'/shader-pixels.json'),room=read(root+'/browser-progress.json'),hardware=read(root+'/hardware-events.json')
for(const [from,to]of [['tmp/combined-sun-tests.txt','tests.txt'],['tmp/combined-sun-final-types.txt','typecheck.txt'],['tmp/combined-sun-bundle.txt','bundle.txt'],['tmp/combined-sun-lint.txt','lint.txt']])fs.writeFileSync(root+'/'+to,decode(fs.readFileSync(from)))
if(!/pass 98/.test(fs.readFileSync(root+'/tests.txt','utf8'))||!/fail 0/.test(fs.readFileSync(root+'/tests.txt','utf8'))||fs.readFileSync(root+'/typecheck.txt','utf8').trim()||fs.readFileSync(root+'/lint.txt','utf8').trim()||!/built in/.test(fs.readFileSync(root+'/bundle.txt','utf8'))||!shader.ok||shader.errors.length)throw Error('Successful small checks are required')
const files=['src/components/IndirectLighting.tsx','src/components/SunBounceExperiment.tsx','src/components/LocalSunPreview.tsx','src/components/ThreeDView.tsx','src/components/SceneRenderer.tsx','src/indirectLightingShader.ts','src/indirectSunBouncePreparation.ts','src/localSunPreview.ts','src/localSunPreviewSnapshot.ts','src/localSunPreview.worker.ts','src/localSunPreviewFilter.ts','tests/localSunPreview.test.ts','tests/localSunPreviewFilter.test.ts','tests/indirectSunBouncePreparation.test.ts','tests/browser/localSunPreview.mjs','tests/browser/combinedSunPreview.mjs','tests/browser/combinedSunShader.ts','tests/browser/combinedSunShader.html','tests/browser/combinedSunShader.mjs','tests/combinedSunPreviewReport.mjs']
const starting=read(root+'/starting-hashes.json'),previous=read('docs/local-sun-preview/changed-files.json')
for(const f of previous.files)if(starting[f.path]===undefined)starting[f.path]=f.sha256
const assets=['colin_house_v2.json','src/models/assets/king_bed.glb','src/models/assets/panel_interior_door_open_low_detail.glb','src/materials/catalog/dulux-timeless-matt.json'],checkpoint=read('docs/first-bounce-sun/changed-files.json')
const authoredAssets=assets.map(path=>({path,sha256:hash(path),matchesCheckpointB:hash(path)===checkpoint.productionUnchanged[path]}))
fs.writeFileSync(root+'/changed-files.json',JSON.stringify({note:'Combined-preview follow-up. Existing unrelated workspace changes are retained. Null starting hashes mean an initial hash was not captured; added files are included explicitly.',files:files.map(path=>({path,startingSha256:starting[path]??null,sha256:hash(path)})),authoredAssets},null,2))
const result={status:'Implementation complete; full-bedroom presentation verification interrupted',budget:LOCAL_SUN_PREVIEW_BUDGET,tests:98,typecheck:'passed',bundle:'passed',scopedLint:'passed',gpuComposition:'passed: real pixels match non-solar GI + local sunlight; capture contribution zero',gpuCases:shader.value.checks,fullRoom:{status:room.stage,error:room.error,lastPreview:room.scene?.preview,sourceSeparation:room.scene?.separation,note:'This run used the former larger preview budget. It reached six-pass source-separation readiness but was interrupted during local tracing. It is not a completed combined-room visual validation.'},hardwareEvents:hardware,hardwareInterpretation:'Windows recorded fatal processor Cache Hierarchy Error events at reboot. These events do not establish the root cause or prove application causation.',fullRoomTestRestarted:false}
fs.writeFileSync(root+'/validation.json',JSON.stringify(result,null,2))
const instructions=`Enable **3D menu → Local sunlight bounce preview (Experimental)** and select **Combined with existing GI**. After preparation, hold **Hold to compare original** in the top toolbar. The status is shown beneath the toolbar. First use can prepare source separation if no warm relightable cache exists. The normal automatic/manual lighting preference is preserved.`
fs.writeFileSync(root+'/README.md',`# Combined local sunlight preview

The combined preview is implemented and builds. Full-bedroom combined-image verification was interrupted during the machine failure and has not been restarted. The isolated GPU composition checks passed; no completed new combined-bedroom screenshot is presented as evidence.

${instructions}

## Composition and scope

For supported screen samples, indirect diffuse = **six-pass non-solar probe GI + locally traced first-bounce sunlight**. The non-solar field is recomputed with directional sunlight and solar-ground environment removed; sky, lamps and emission remain. This avoids adding the local estimate on top of the existing sunlight term. Direct lighting and ambient fill are retained; fill is applied once. Existing specular treatment and exposure remain. Later sunlight bounces and solar-ground indirect lighting are omitted in this version.

Unsupported/edge-rejected samples keep their existing GI. The sun-only diagnostic remains selectable. Neither temporary source-separated field nor the view-local image is saved in the project lighting cache. Preparing missing capture data can run a normal GI bake, while a warm cache is reused. Disabling the preview releases its owned textures/worker; cancelling source separation restores touched replay-atlas records when their generation is still current.

## Display fixes and bounded work

- Camera projection replaces canvas-pixel lookup, making sampling independent of DPR and render-target dimensions/offsets.
- Camera-hidden roofs/walls are skipped by camera rays while remaining physical bounce/shadow blockers. Their visibility is refreshed per view.
- Active status is published after a successful display draw. Empty supported coverage is reported as unavailable. Pending shader preparation can resume a matching prepared image.
- The preview is now at most **96 pixels on its longest side, 64 rays per pixel**, with a **16 MiB texture-readback budget** and maximum 256-pixel texture side. This is about 22% of the previous maximum hemisphere-ray workload and one quarter of the former texture budget. It is not a cap on the entire application's memory.
- A 3 × 3 display-only filter averages supported, nearby, similarly oriented coplanar surfaces. It rejects thin-wall, normal and unsupported boundaries. Transport/reference results are never filtered.
- Sampler sharing is retained, including the 16-fragment-sampler device. No new arbitrary lighting gain was introduced.

## Checks and limits

98 targeted tests pass, including Lambertian transport, texture/material handling, source separation, cancellation restoration, packing, camera-only visibility and denoising boundaries. TypeScript, production bundling and scoped lint pass. The tiny WebGL regression checks actual pixels at DPR 2 across three target sizes/offsets: original, sunlight-only, combined and capture isolation. Combined pixels match non-solar + local sunlight rather than full GI + local sunlight.

The full-room log records all six normal GI passes completed and six-pass non-solar preparation ready (about 35 seconds for source separation in that run). It then stops during local tracing. Those timings are from the former larger-budget run; the lighter full-room version has not been benchmarked or visually validated. Windows recorded fatal WHEA processor cache-hierarchy errors around reboot; the event alone does not determine their underlying cause. The heavy browser test is stopped.

See [verification details](validation.json), [GPU pixel measurements](shader-pixels.json), [interrupted room run](browser-progress.json), [Windows hardware events](hardware-events.json), [tests](tests.txt), [bundle log](bundle.txt), and [exact changed files](changed-files.json).

## Reproduction

The small shader regression uses the local test server and an isolated browser profile:

~~~powershell
node tests/browser/combinedSunShader.mjs
~~~

The full-house regression is deliberately opt-in and is not restarted by this report script:

~~~powershell
node tests/browser/combinedSunPreview.mjs --full-room
~~~
`)
fs.writeFileSync(root+'/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Combined local sunlight preview</title><style>body{background:#142029;color:#e8eff2;font:16px/1.6 system-ui;margin:0}main{max-width:1000px;margin:auto;padding:28px}a{color:#a5d9ed}.status{border-left:4px solid #d5b77c;background:#302e28;padding:16px}code{background:#283e48;padding:3px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:10px;border-bottom:1px solid #40535b}</style><main><h1>Combined local sunlight preview</h1><p class="status"><strong>Implemented and builds.</strong> Full-bedroom combined-image verification was interrupted by the machine failure. The heavy test has been stopped. This page does not claim a completed combined-bedroom visual test.</p><p>Enable <strong>3D menu → Local sunlight bounce preview (Experimental)</strong>, then select <strong>Combined with existing GI</strong>. Hold <strong>Hold to compare original</strong> in the top toolbar after preparation.</p><h2>What is combined</h2><p>Sky/lamp GI without sunlight + locally traced first sunlight bounce. Direct light and ambient fill remain. Later sunlight bounces are omitted. Existing sunlight is replaced rather than counted twice.</p><h2>Lighter preview</h2><p>96-pixel longest side · 64 rays/pixel · 16 MiB texture-readback cap · surface-aware denoising. The ray budget is about 22% of the previous maximum. This does not cap the entire application's memory.</p><h2>Verified checks</h2><table><tr><th>Check</th><th>Outcome</th></tr><tr><td>Targeted tests</td><td>98 passed</td></tr><tr><td>TypeScript / production bundle / scoped lint</td><td>Passed</td></tr><tr><td>Actual GPU composition pixels</td><td>Passed at DPR 2 and three target sizes/offsets</td></tr><tr><td>Full-bedroom source separation</td><td>Six passes completed before interruption</td></tr><tr><td>Full-bedroom combined image</td><td>Unverified after interruption</td></tr></table><p>Windows recorded fatal processor cache-hierarchy events around reboot. The event does not establish the underlying cause.</p><p><a href="README.md">Full scope and instructions</a> · <a href="validation.json">Verification</a> · <a href="shader-pixels.json">GPU pixels</a> · <a href="hardware-events.json">Hardware events</a> · <a href="changed-files.json">Changed files</a></p></main></html>`)
console.log(JSON.stringify({report:root+'/index.html',tests:98,typecheck:'passed',bundle:'passed',roomVisualCheck:'interrupted',files:files.length}))
