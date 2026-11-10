import fs from 'node:fs'
import crypto from 'node:crypto'
import sharp from 'sharp'
const root='docs/local-sun-preview',result=JSON.parse(fs.readFileSync(root+'/browser-progress.json','utf8'))
if(result.stage!=='passed'||result.active.unsupported||!result.instantOriginal||!result.instantPreview||!result.cameraStaleHidden||!result.disabledRestored||result.errors.length)throw Error('A successful current browser verification is required')
const decode=buffer=>buffer.length>1&&buffer.readUInt16LE(0)===0xfeff?buffer.toString('utf16le').slice(1):buffer.toString('utf8')
for(const [from,to]of [['tmp/local-sun-preview-tests.txt','tests.txt'],['tmp/local-sun-preview-build.txt','build.txt'],['tmp/local-sun-preview-lint.txt','lint.txt']])fs.writeFileSync(root+'/'+to,decode(fs.readFileSync(from)))
if(!fs.readFileSync(root+'/tests.txt','utf8').includes('pass 93')||!fs.readFileSync(root+'/build.txt','utf8').includes('built in')||fs.readFileSync(root+'/lint.txt','utf8').trim())throw Error('Checks must pass')
const names=['src/localSunGather.ts','src/localSunTransport.ts','src/localSunPreview.ts','src/localSunPreviewSnapshot.ts','src/localSunPreview.worker.ts','src/components/LocalSunPreview.tsx','src/indirectLightingShader.ts','src/components/ThreeDView.tsx','src/components/SceneRenderer.tsx','tests/localFinalGather.ts','tests/firstBounceSun.ts','tests/firstBounceSun.test.ts','tests/localSunPreview.test.ts','tests/browser/localSunPreview.mjs','tests/localSunPreviewReport.mjs']
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),starting=JSON.parse(fs.readFileSync(root+'/starting-hashes.json','utf8')),checkpoint=JSON.parse(fs.readFileSync('docs/first-bounce-sun/changed-files.json','utf8'))
for(const file of checkpoint.files)if(starting[file.path]===undefined&&file.path==='tests/firstBounceSun.test.ts')starting[file.path]=file.sha256
const fixtureHash=hash('tmp/local-sun-preview-project.json'),currentHash=hash('colin_house_v2.json')
const pixels=async name=>sharp(root+'/'+name+'.png').removeAlpha().raw().toBuffer({resolveWithObject:true})
const original=await pixels('original'),held=await pixels('original-held'),local=await pixels('local-first-bounce'),restored=await pixels('restored')
const difference=(a,b)=>{if(a.data.length!==b.data.length)throw Error('Screenshot size changed');let sum=0,max=0,changed=0;for(let i=0;i<a.data.length;i++){const d=Math.abs(a.data[i]-b.data[i]);sum+=d;max=Math.max(max,d);if(d>2)changed++}return{meanAbsoluteByteDifference:sum/a.data.length,maxByteDifference:max,channelsDifferingByMoreThanTwo:changed}}
const images={originalVsLocal:difference(original,local),originalVsHeld:difference(original,held),originalVsRestored:difference(original,restored),note:'Whole screenshots include a comparison button and changing status text. This measures image differences; it is not a physical accuracy metric.'}
fs.writeFileSync(root+'/image-review.json',JSON.stringify(images,null,2))
fs.writeFileSync(root+'/changed-files.json',JSON.stringify({note:'Visual-preview follow-up, explicitly authorized by the user after diagnostic Checkpoint B. Pre-existing workspace changes are retained. The two old diagnostic entry points re-export the promoted, shared transport kernels.',files:names.map(path=>({path,startingSha256:starting[path]??null,sha256:hash(path)})),fixtureProjectSHA256:fixtureHash,currentProjectSHA256:currentHash,currentProjectMatchesTestFixture:fixtureHash===currentHash},null,2))
const seconds=(result.active.ms/1000).toFixed(1)
fs.writeFileSync(root+'/README.md',`# Local sunlight bounce: visual preview

Use **3D view menu → Local sunlight bounce preview (Experimental)**, beside the sunlight controls. Daylight and Indirect lighting must be enabled. Keep the camera still until tracing finishes. Then hold **Hold to compare original** in the top toolbar for an immediate original/preview comparison. Moving the camera hides the previous result and traces the new view after a pause. Unchecking the preview terminates its worker, releases its GPU texture and restores the normal shader feature set. It defaults off and is not saved with the house or lighting cache.

The preview replaces supported pixels' **entire indirect diffuse term with one reflected sunlight bounce**. Direct lights, ambient fill, exposure, tone mapping and the existing specular treatment remain. It excludes sky bounce, lamp bounce, emission bounce and later diffuse bounces. Overall darkening can therefore be expected; this is a visual check of local sunlight distribution, not the final combined GI solution. Unsupported/material-boundary screen samples retain original lighting.

## Verified on the saved bedroom

- Existing geometry: ${result.active.triangles.toLocaleString('en-GB')} triangles.
- ${result.active.width} × ${result.active.height} view samples, 128 deterministic cosine directions each.
- ${result.active.unsupported} unsupported CPU receiver estimates. Edge/normal rejection in the display filter is separate and can retain original lighting at silhouettes.
- CPU tracing: ${seconds} seconds in the isolated headless browser. Initial asset loading and shader preparation add time. This is a slow, static-view prototype; hold-to-compare reuses the prepared image immediately.
- Texture snapshot: ${(result.active.textureBytes/1048576).toFixed(2)} MiB, bounded to 64 MiB and at most 512 pixels per texture side. Larger texture sets use a lower shared resolution.
- The existing GI sampler carries the temporary image in appended volume slices. Original coefficients are copied unchanged, with a guard slice preserving trilinear boundaries. No additional fragment texture sampler is required; the 16-sampler test device passes.
- Live base colour, alpha testing, opaque-pipeline alpha, metalness maps, per-map UV transforms, visible sides and shadow sides are captured. Unsupported vertex colours, deformed geometry, separate map UV channels, stochastic alpha and blended/transmitting surfaces are rejected. Source reflection uses geometric normals; view receivers use their original smooth normals and geometric origin offsets. Normal maps are not a full renderer-parity claim.
- 93 targeted tests passed; production build passed; scoped lint passed. The browser verified real pointer input for original comparison, camera invalidation, disabling/restoration and texture release. No WebGL/shader errors.

## Visual review

See [the comparison](index.html), [the preview](local-first-bounce.png), [the original held for comparison](original-held.png), [browser verification](browser-progress.json), [image differences](image-review.json) and [exact changed files](changed-files.json).

The first 128-ray render is noisy. These images do not replace the matched high-sample seven-receiver measurements in [Checkpoint B](../first-bounce-sun/index.html). Judge the local spatial distribution around the sunlit bedding; final production-quality combined lighting still needs a separately reviewed integration.

## Reproduce

Start the existing asset portal on port 5174 and Vite on port 5181, then run:

~~~powershell
node tests/browser/localSunPreview.mjs
~~~

The browser regression uses a disposable Chrome profile and an isolated copy of the current house. It closes its browser on exit. It does not write the authored project. Run this report script after successful tests/build/lint and browser verification.
`)
fs.writeFileSync(root+'/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local sunlight bounce preview</title><style>body{margin:0;background:#152128;color:#e4edf1;font:16px/1.5 system-ui}main{max-width:1450px;margin:auto;padding:26px}h1{font-size:32px}a{color:#a5d8ec}.note{padding:16px;background:#2c383e;border-left:4px solid #b6d6a2}.images{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img{width:100%;height:auto}figcaption{padding:12px 0}button{font:inherit;padding:9px 18px;margin:15px 10px 15px 0}#single{max-width:1000px}label{display:block;margin:12px 0}@media(max-width:800px){.images{grid-template-columns:1fr}}</style><main><h1>Local sunlight bounce: the bedroom</h1><p>Use <strong>3D view menu → Local sunlight bounce preview (Experimental)</strong>. After tracing, hold <strong>Hold to compare original</strong> in the top toolbar.</p><p class="note">This preview replaces indirect diffuse lighting with one sunlight bounce. Direct light and ambient fill remain. Sky bounce, lamp bounce and later bounces are excluded, so a darker overall image is expected. The 128-ray preview remains noisy. These are actual captures at the same camera and exposure.</p><p><a href="README.md">Scope, checks and instructions</a> · <a href="browser-progress.json">Browser verification</a> · <a href="changed-files.json">Changed files</a></p><div class="images"><figure><figcaption>Original saved GI</figcaption><img src="original-held.png" alt="Saved bedroom lighting with the original lighting held for comparison"></figure><figure><figcaption>Local first-bounce sunlight preview</figcaption><img src="local-first-bounce.png" alt="Actual bedroom render with locally traced reflected sunlight"></figure></div><h2>Same-position comparison</h2><p>Hold the button to switch this saved image to the original.</p><button id="compare">Hold to compare original</button><br><img id="single" src="local-first-bounce.png" alt="Bedroom comparison"><script>const button=document.getElementById('compare'),image=document.getElementById('single');const original=()=>{image.src='original-held.png';button.textContent='Showing original'},preview=()=>{image.src='local-first-bounce.png';button.textContent='Hold to compare original'};button.addEventListener('pointerdown',original);for(const event of ['pointerup','pointerleave','pointercancel','blur'])button.addEventListener(event,preview);button.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();original()}});button.addEventListener('keyup',preview);</script></main></html>`)
console.log(JSON.stringify({report:root+'/index.html',tests:93,browser:'passed',unsupported:result.active.unsupported,traceSeconds:Number(seconds),files:names.length}))
