import fs from 'node:fs'
import crypto from 'node:crypto'
import {DataUtils} from 'three'
import {readLocalLightInput} from './localLightIO.mjs'
const root='docs/sunlit-bounce',json=n=>JSON.parse(fs.readFileSync(`${root}/${n}.json`)),p=json('production'),r=json('reference'),surfaces=json('receivers').done.surfaces,frames=json('frame-performance'),perf=json('baseline-profile'),updates=json('incremental-performance'),audit=json('capture-audit'),angular=json('angular-audit'),spatial=json('spatial-audit'),input=json('inputs'),lum=a=>a[0]*.2126+a[1]*.7152+a[2]*.0722,f=v=>Number(v).toFixed(5),pct=v=>(100*v).toFixed(1)+'%',median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],table=(head,rows)=>[head.join(' | '),head.map(()=>'---').join(' | '),...rows.map(row=>row.join(' | '))].map(s=>'| '+s+' |').join('\n')
const rows=[],csv=['receiver,source,production,reference,error,absolute_error,relative_error,reference_95pct_halfwidth']
for(let i=0;i<7;i++)for(let source=1;source<=2;source++){const prod=lum(p.variants[0].receivers[i].gi)-lum(p.variants[source].receivers[i].gi),q=r.results[i].solarContributions[source],ref=lum(q.cumulative[5]),error=prod-ref,ci=1.96*lum(q.standardError[5]);rows.push([r.results[i].name,q.name,f(prod),f(ref)+' ± '+f(ci),f(error),f(Math.abs(error)),pct(error/ref)]);csv.push([r.results[i].name,q.name,prod,ref,error,Math.abs(error),error/ref,ci].join(','))}
fs.writeFileSync(`${root}/comparison.csv`,csv.join('\n')+'\n')
const bounceRows=[],bounceCSV=['receiver,source,pass,production_cumulative,production_increment,reference_cumulative,reference_increment,reference_95pct_halfwidth']
for(let i=0;i<7;i++)for(let source=1;source<=2;source++){let oldP=0,oldR=0;for(let pass=0;pass<6;pass++){const a=lum(p.variants[0].passes[pass].receivers[i].gi)-lum(p.variants[source].passes[pass].receivers[i].gi),b=lum(r.results[i].solarContributions[source].cumulative[pass]);bounceCSV.push([r.results[i].name,source===1?'duvet':'wall',pass+1,a,a-oldP,b,b-oldR,1.96*lum(r.results[i].solarContributions[source].standardError[pass])].join(','));oldP=a;oldR=b}if(i<2)bounceRows.push([r.results[i].name,source===1?'duvet production':'wall production',...p.variants[0].passes.map((v,j)=>f(lum(v.receivers[i].gi)-lum(p.variants[source].passes[j].receivers[i].gi)))]);if(i<2)bounceRows.push([r.results[i].name,source===1?'duvet reference':'wall reference',...r.results[i].solarContributions[source].cumulative.map(a=>f(lum(a)))])}
fs.writeFileSync(`${root}/per-bounce.csv`,bounceCSV.join('\n')+'\n')
const sourceData=readLocalLightInput(`${root}/reference-input.bin.gz`).reference,sourceExamples=[]
for(const category of [1,2]){const candidates=audit.results.flatMap(p=>p.groups[category-1].samples.map(s=>({...s,probe:p.index}))).filter(s=>s.mask>.5&&s.firstHit&&sourceData.sourceCategories[s.firstHit.triangle]===category&&s.gpu>.1);const sample=candidates.map(s=>{const cosine=Math.max(0,s.normal.slice(0,3).reduce((v,n,i)=>v+n*sourceData.sunDirection[i],0)),e=sourceData.sunIrradiance.map(v=>v*3.5*cosine),expected=e.map((v,c)=>v*s.response[c]);return{...s,incomingUnshadowed:e,expectedLambert:expected,rho:s.response.map(v=>v*Math.PI),ratio:lum(s.solar)/lum(expected)}}).sort((a,b)=>Math.abs(1-a.ratio)-Math.abs(1-b.ratio))[0];sourceExamples.push({category,...sample})}
fs.writeFileSync(`${root}/surface-cache-examples.json`,JSON.stringify(sourceExamples,null,2))
const hash=x=>crypto.createHash('sha256').update(fs.readFileSync(x)).digest('hex'),oldHashes=JSON.parse(fs.readFileSync('docs/ceiling-transport/source-hashes.json')).sha256.filter(x=>x.path.startsWith('src/')),productionUnchanged=oldHashes.every(x=>hash(x.path)===x.sha256),paths=[...oldHashes.map(x=>x.path),...fs.readdirSync('tests/browser').filter(n=>n.startsWith('sunlitBounce')).map(n=>'tests/browser/'+n),...fs.readdirSync('tests').filter(n=>n.startsWith('sunlitBounce')).map(n=>'tests/'+n),'tests/sceneLightingReference.ts','tests/browser/sceneReferenceSnapshot.ts','tests/browser/softGIView.ts','tests/tsconfig.sunlit-bounce.json'];fs.writeFileSync(`${root}/source-hashes.json`,JSON.stringify({productionUnchangedSinceRoofCorrection:productionUnchanged,sha256:paths.map(path=>({path,sha256:hash(path)}))},null,2))
const normal=readLocalLightInput(`${root}/field-A.bin.gz`),trace=json('baseline-trace').passes.at(-1);let baselineMax=0;for(const q of trace.coefficients)for(let c=0;c<3;c++)for(let k=0;k<4;k++)baselineMax=Math.max(baselineMax,Math.abs(q.rgb[c][k]-DataUtils.fromHalfFloat(normal.coefficients[c][q.index*4+k])))
const fullTable=table(['Receiver','Production GI','Reference GI','Difference'],r.results.map((q,i)=>{const a=lum(p.variants[0].receivers[i].gi),b=lum(q.sky)+lum(q.reflected);return[q.name,f(a),f(b),pct(a/b-1)]})),sourceTable=table(['Surface','World position','Linear rho RGB','Display direct E, Y','Expected solar L, Y at gain 3.5'],surfaces.map(s=>[s.name,s.position.map(f).join(', '),s.rho.map(f).join(', '),f(lum(s.directSunIrradiance)),f(lum(s.directSunDiffuse)*3.5)]))
const text=`# Sunlit duvet and wall bounce diagnosis

The duvet really does illuminate the bedroom, but the current representation redistributes that light inaccurately. At the ceiling, its six-pass contribution is **0.05335 versus 0.12599** in the independent reference (**57.7% low**). Behind the bed it is **59.6% low**. The opposite wall is within 1.8%, while the dark corner receives 140.3% too much duvet contribution. Wall bounce is within 2.1% at the ceiling but is also over-spread elsewhere. This is a spatial/directional fidelity problem, not an omitted diffuse reflection term or a uniformly dark renderer.

**Recommendation:** retain the current production configuration. No production correction was implemented. The strongest remaining cause is the fixed L1/probe reconstruction, which the requested constraints preserve. A gain or exposure increase would worsen receivers already too bright. The evidence does not justify a more expensive full-house capture-resolution change. Checkpoints A–C are complete; D was not entered because no specific, worthwhile correction within these constraints was demonstrated.

## Fixed experiment

Frozen source: current two-window Colin house, SHA-256 ${input.sha256}. Camera and authored sun are in [inputs.json](inputs.json); geometry, UVs, textures, material response and source labels are in [reference-input.bin.gz](reference-input.bin.gz). This scene uses **overcast sky**, unlike the earlier one-window clear-sky audit. Existing sun/sky strengths, gain 3.5, fill 0.18, EV 0, L1, 301 probes, 16-pixel captures and six passes were retained. Every reported final field/display uses the existing geometry-aware **10 cm floor filter**. Transport uses the authoritative unsmoothed floor data, as production does. The exterior roof-sky correction remains present.

A is normal. B subtracts only direct-sun diffuse radiance from the 3,020-triangle duvet component. C subtracts it from 55 selected room-facing wall/infill triangles. The complete mesh stays visible, with the same direct lighting, albedo, occlusion and later indirect response. Selection is saved in the source-category array and source metadata; wall selection uses whole triangles with room-facing normals and centroids in the bedroom bounds, including three upper infill triangles. Source subtraction uses the actual cached receiver/depth/normal/material samples and the existing solar shadow calculation. It does not blacken or remove objects.

All six passes use the existing Jacobi replay, half-float coefficients, BVH lookup, volume and floor builders. A reproduces every final production probe coefficient **bit for bit** (maximum difference ${baselineMax}). Each experiment uses a private field, and the original field is checked for changes. The reference carries the same source labels along identical random paths; subtracting tagged sunlight is mathematically equivalent to B/C for diffuse transport. The synthetic regression verifies that sky and lamp reflection survive exclusion.

## Irradiance comparison

Scene-relative linear irradiance luminance Y = 0.2126R + 0.7152G + 0.0722B, before albedo, fill, exposure or tone mapping; these are not lux. Reference: 262,144 paths per receiver, six source encounters, fixed seed. ± values are conservative 95% Monte Carlo half-widths obtained by weighting component standard errors. They do not cover modeling differences such as normal maps or filtered sun shadows.

${table(['Receiver','Reflected source','Production','Reference ± 95%','Signed error','Absolute error','Relative error'],rows)}

Full RGB results and per-channel uncertainty are in [reference.json](reference.json) and [production.json](production.json); [comparison.csv](comparison.csv) contains the numerical table. Differences are reflected sunlight attributable to a surface, not light emitted by it.

${fullTable}

## Earliest divergence and transport

${table(['Receiver','Contribution','Pass 1','Pass 2','Pass 3','Pass 4','Pass 5','Pass 6'],bounceRows)}

[per-bounce.csv](per-bounce.csv) contains cumulative and incremental contributions for both sources at all seven receivers. Passwise numbers precede display filtering; final comparison numbers include 10 cm filtering. Signed differences are retained (for example the shaded duvet's first-pass A−B is −0.00174), because L1 reconstruction and clamping do not guarantee source monotonicity.

The ceiling already has 0.02931 of production duvet illumination versus 0.08218 reference in pass one. Later bounces add light in both solvers; there is no missing second-through-sixth-pass operation. The first-pass deficit accounts for most of the final absolute discrepancy.

The 16-pixel source atlas contains 424 duvet pixels across all captures. Seven nearby probes record nonzero solar duvet radiance; four upper probes see 22–39 sunlit samples each. The largest useful captures, probes 430 and 441, have downward raw integrals 0.05685 and 0.06736; L1 reduces these to 0.04734 and 0.05464. At identical directions the hard-shadow reference raw values are 0.06550 and 0.08478. Capture/shadow/normal differences exist, but are substantially smaller than the receiver deficit. All per-probe solid angles, raw samples, exact triangle hits and directional comparisons are in [capture-audit.json](capture-audit.json).

Using independent reference radiance at the existing probes, then retaining production L1 and point interpolation, yields **0.03334** at the biased ceiling point, still far below the independent surface value **0.08218**. The corresponding wall-behind-bed blend is **0.01609**, versus **0.06356** at the surface. This counterfactual replaces captured radiance only; it is an attribution diagnostic, not a proposed implementation. The audited capture set covers the room's contributing probes. Results and original probe visibility are in [spatial-audit.json](spatial-audit.json).

Moving the production ceiling query from its biased point to 4 mm off the surface only changes first-bounce A−B from 0.02931 to 0.03071. Receiver bias alone therefore does not explain the loss. At the physical ceiling position, independent 64-pixel angular quadrature gives raw 0.07955 and L1 0.06033. Thus directional compression loses substantial light even before spatial averaging; spatial averaging loses more. The same broad representation overestimates the opposite wall and dark corner, flattening the room's variation.

### Capture resolution check

The diagnostic-only 16/32/64 comparison in [angular-audit.json](angular-audit.json) uses exact scene-ray quadrature at fixed probe positions and fixed sun/materials, before transport. It is **not a 32/64 GPU rebake**, and is not presented as one. The four upper probes' mean downward duvet integral is ${[16,32,64].map(size=>f(angular.filter(q=>q.name.startsWith('probe')&&q.size===size).reduce((s,q)=>s+q.raw,0)/4)).join(' / ')} at 16 / 32 / 64. Individual changes have mixed signs. The ceiling's own integral is 0.08428 / 0.09434 / 0.07955. These checks do not demonstrate systematic disappearance of the patch at 16 pixels, and perfect-probe-radiance reconstruction still has the large deficit. A costly six-pass 32/64 production comparison was therefore not pursued.

## Surface response

${sourceTable}

These measurements use the actual display material shader, not a white-color assumption. The duvet and frame have rho = (1,1,1), metalness 0, roughness 1, and no color or normal texture. The wall has high but slightly warm linear reflectance. Display direct E does not include the transport gain; expected source L above includes it exactly once. The shaded duvet sample has zero direct sun.

${table(['Cache source','Probe','Actual hit position','Cached rho RGB','Expected unoccluded Lambert L, Y','Actual solar cache L, Y'],sourceExamples.map(q=>[q.category===1?'duvet':'wall',q.probe,q.firstHit.point.map(f).join(', '),q.rho.map(f).join(', '),f(lum(q.expectedLambert)),f(lum(q.solar))]))}

The examples above select unshadowed, same-category cache samples and use stored normal/response with the authored solar direction and irradiance. The cache follows rho × E / pi to half-float precision. [surface-cache-examples.json](surface-cache-examples.json) retains RGB and normals. Other samples differ from exact-ray reference visibility because production uses filtered shadow maps and smooth/normal-mapped surface normals.

## Images and apparent brightness

Open [the comparison gallery](index.html). [Final composed](final-composed.png) and [direct disabled with the same GI](direct-disabled-same-gi.png) use the same camera, EV 0, materials, fill, filtered GI, AO and ACES pipeline. The bright duvet/wall patches disappear when direct sun is disabled; the completed GI is unchanged. [Direct-only](direct-sun.png), [sky-driven GI](gi-sky-only.png), [sun-driven GI](gi-sun-only.png), [total GI](gi-A.png), [duvet bounce](duvet-bounce.png) and [wall bounce](wall-bounce.png) all use the same fixed linear scale: RGB × 4, clipped to [0,1], without ACES or independent exposure. Duvet/wall images show the nonnegative display of signed A−B/A−C; raw HDR retains negative values. The separate orange/blue signed differences use **80× luminance**, orange positive and blue negative, explicitly for visibility.

Sky/sun views are source-only six-pass fields. Their boundary terms use the unchanged analytic sky/ground formulas and cached exterior response; solar includes sun-reflecting ground, and sky includes sky-reflecting ground. These omit the one local lamp and emission. Because production clamps reconstructed light, separately solved source fields need not sum exactly to A. The primary A/B/C differences do not rely on this display decomposition. The non-surface-sun residual is also retained, but is not mislabeled as pure sky. Cache sky + solar did not exceed the normal source atlas by more than 0.005 in any channel; residual lamp/emission and quantization are retained separately.

Physical missing bounce is part of the gloomy appearance: total ceiling GI is 28.3% low and wall-behind-bed GI is 36.4% low. But the spatial error also makes the dark corner 87.4% too bright. This loss of variation is consistent with the flat appearance. Material response is not suppressing the white bed. Fill contributes 0.18/pi = **0.05730** diffuse radiance on white surfaces: about 31% of the shaded duvet's GI-plus-fill irradiance and 60% at the sampled bed frame. That uniform contribution reduces relative contrast. A−B on the shaded duvet is only 0.03984/pi = **0.01268** radiance, about 6.9% of its GI-plus-fill level, so the genuine bounce can look subtle.

Exposure remains 1 (0 EV). ACES and sRGB reshape the final display, but cannot explain discrepancies already measured in linear irradiance. No photographic exposure calibration is proposed here because the physics/reconstruction comparison is not uniformly accurate. Such calibration would be a separate display choice, not a transport fix.

## Performance and validation

Fresh 301-probe bake: **${(perf.totalMs/1000).toFixed(2)} s**, including cold shader preparation. Cached sun-direction update and restoration: **${updates.map(q=>(q.elapsedMs/1000).toFixed(2)).join(' s / ')} s** end-to-end. Fixed-camera GPU median over 36 valid composed frames: **${median(frames.map(q=>q.gpuMs).filter(v=>v!==null)).toFixed(2)} ms**; CPU submission median ${median(frames.map(q=>q.cpuMs)).toFixed(2)} ms. Owned GI texture estimate: **${(perf.ownedTextureBytes/1048576).toFixed(2)} MiB**; the separate 10 cm display floor texture is ${(normal.filteredFloor.byteLength/1048576).toFixed(2)} MiB. These are owned texture estimates, not total driver VRAM. Profiles, individual frames and update traces are saved alongside this report. Private diagnostic fields and readbacks are additional offline allocations and are excluded from the production memory claim.

The primary replay uses the same GPU solver but diagnostic main-thread interpolation/readback instrumentation, so its wall times are not claimed as production bake times. The frozen A field matches production bit-for-bit. Five reference tests pass, including selective-source exclusion; the focused TypeScript diagnostic project passes. Production transport/shader/persistence hashes match the retained roof-correction versions (${productionUnchanged}). No new per-frame work or production defaults were introduced. No correction was proposed, so cross-room correction validation and before/after correction images are not claimed.

Diagnostic implementation checks caught and discarded an initially untagged reference snapshot (cached module), an initial cube-readback binding failure, blank compositor exports after MRT inspection, and duplicate opening-preview shader hooks on temporary live-scene material clones. The retained reference has 3,020 duvet and 55 wall triangles tagged. Contribution views now render detached proxies, with shader compilation checked before export, so editor effects cannot repatch their materials. Compositor render targets were recreated, then final images visually checked; valid frame timing is in frame-performance.json. Earlier timing in views.json is superseded. These were diagnostic harness issues, not evidence of a production GI bug.

## Reproduction

Use separate PowerShell terminals for the Vite fixture and retained isolated browser. The session reads the frozen project archive when present, forces a fresh bake, and never saves to the user's house file.

\`\`\`powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5181 --config tests/browser/doorFloorVite.config.mjs
node tests/browser/sunlitBounceSession.mjs --sunlit-bounce
node tests/browser/sunlitBounceRun.mjs
node --experimental-strip-types tests/sunlitBounceReference.mjs 262144
node --experimental-strip-types tests/sunlitBounceCapture.mjs
node --experimental-strip-types tests/sunlitBounceAngular.mjs
node --experimental-strip-types tests/sunlitBounceSpatial.mjs
node tests/sunlitBounceImages.mjs
node tests/sunlitBounceReport.mjs
node --test --test-isolation=none --experimental-strip-types tests/sceneLightingReference.test.ts tests/sunlitBounceReference.test.ts
node node_modules/typescript/bin/tsc -p tests/tsconfig.sunlit-bounce.json
\`\`\`

The standalone scripts can regenerate tables, angular/spatial checks and images from the retained binary data without reopening the app. [source-hashes.json](source-hashes.json) fixes the implementation. Binary archives use the typed-array container read by tests/localLightIO.mjs. All CSV/JSON/HDR measurements and the fixed project remain available for review.
`
fs.writeFileSync(`${root}/report.md`,text)
const figures=[['final-composed','Final composed · ACES · EV 0'],['direct-disabled-same-gi','Direct sun disabled · identical GI'],['direct-sun','Direct sunlight only · linear 4×'],['gi-sky-only','Sky-driven GI · linear 4×'],['gi-sun-only','Sun-driven GI · linear 4×'],['gi-A','Total GI · linear 4×'],['duvet-bounce','Duvet reflected sunlight · linear 4×'],['wall-bounce','Wall reflected sunlight · linear 4×'],['duvet-bounce-signed80','Duvet difference · signed Y × 80'],['wall-bounce-signed80','Wall difference · signed Y × 80'],['fill','Indoor fill · linear 4×']]
fs.writeFileSync(`${root}/index.html`,`<!doctype html><meta charset="utf-8"><title>Bedroom reflected sunlight</title><style>body{font:16px system-ui;background:#181b21;color:#eee;margin:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:24px}figure{margin:0}img{width:100%}figcaption{padding:10px 0}a{color:#a6ccff}p{max-width:950px;line-height:1.55}</style><h1>Bedroom reflected sunlight</h1><p>The duvet contributes real bounced light, but L1 and spatial reconstruction underestimate it near the bed and spread it too widely elsewhere. No production correction or brightness change was applied. <a href="report.md">Full report</a> · <a href="comparison.csv">Irradiance table</a> · <a href="per-bounce.csv">Per-bounce measurements</a></p><p>Diagnostic RGB images share linear 4× scaling without ACES. Signed differences use 80× luminance: orange positive, blue negative. Final and direct-disabled views share the original ACES display pipeline at EV 0.</p><main>${figures.map(([file,label])=>`<figure><a href="${file}.png"><img src="${file}.png" loading="lazy"></a><figcaption>${label}</figcaption></figure>`).join('')}</main>`)
console.log('Wrote report, gallery, CSV tables, source examples and hashes; baseline maximum error:',baselineMax)
