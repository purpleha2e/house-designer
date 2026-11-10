import {createHash} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
const root='docs/lighting-correctness',run=process.argv[2]??'verified',base=`${root}/${run}`
const read=p=>JSON.parse(readFileSync(p,'utf8')),settings=read(`${base}/settings.json`),results=read(`${base}/results.json`),reference=read(`${base}/reference.json`),rooms=read(`${root}/reference-rooms/results.json`)
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,fmt=(x,n=4)=>Number.isFinite(x)?x.toFixed(n):'n/a',luma=a=>a[0]*.2126+a[1]*.7152+a[2]*.0722
const fence=String.fromCharCode(96).repeat(3)
const source=(p,needle)=>{const line=readFileSync(p,'utf8').split('\n').findIndex(l=>l.includes(needle))+1;return`[${p}:${line}](../../${p}#L${line})`}
const production=existsSync(`${root}/production-performance.json`)?read(`${root}/production-performance.json`):null
const productionBefore=read(`${root}/production-performance-before.json`)
const diagnosticPerformance=read(`${base}/performance.json`)
const referenceComparison=read(`${root}/reference-before-after.json`)
const before=read(`${root}/source-before.json`),after=Object.fromEntries(Object.keys(before.files).map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))
writeFileSync(`${root}/source-after.json`,JSON.stringify({files:after,changed:Object.keys(after).filter(p=>after[p]!==before.files[p]),additionalFilesWithoutBeforeHash:{'src/indirectCaptureScene.ts':createHash('sha256').update(readFileSync('src/indirectCaptureScene.ts')).digest('hex')}},null,2))
const seamBefore=read(`${root}/sky-seam/before.json`),seamAfter=read(`${root}/sky-seam/after.json`)
const matched=reference.results.filter(p=>p.sunVisibility),shadowMismatches=matched.filter(p=>Math.abs(p.sunVisibility[0]-p.bvhSunVisibility)>.1)
const negativeResiduals=results.flatMap(r=>r.points.filter(p=>!p.unavailable&&p.reflectedIrradiance.some(v=>v<-.001)))
const surfacetable=results.map(view=>`### ${view.camera.id}

Camera ${JSON.stringify(view.camera)}. Positions and normals below are GPU float32 values at visible pixels. The source mesh/material and full RGB values, all five HDR/sRGB results, material AO, local visibility and AO factor are in [measurements](${run}/${view.camera.id}/measurements.json).

| Surface | World position | Normal | Sun visible E | Probe sky E | Signed reflected residual E | Fill E | Screen AO |
|---|---|---|---:|---:|---:|---:|---:|
${view.points.map(p=>p.unavailable?`| ${p.name} | unavailable in this fixed view | — | — | — | — | — | — |`:`| ${p.name} | ${p.position.map(v=>fmt(v,3)).join(', ')} | ${p.normal.map(v=>fmt(v,2)).join(', ')} | ${fmt(luma(p.sunVisibleIrradiance))} | ${fmt(luma(p.skyIrradiance))} | ${fmt(luma(p.reflectedIrradiance))} | ${fmt(luma(p.artistFillIrradiance))} | ${fmt(p.screenAO,3)} |`).join('\n')}

${view.points.filter(p=>!p.unavailable).map(p=>{const r=reference.results.find(r=>r.camera===view.camera.id&&r.name===p.name),e=r?.reference;return`- **${p.name}:** albedo RGB ${p.albedo.map(v=>fmt(v,3)).join('/')}; material ${p.identity?.material||p.identity?.materialType||'unresolved'}, mesh ${p.identity?.mesh||p.identity?.ancestors?.find(a=>a.role)?.role||'unnamed'}. ${p.normal[1]<-.9?'Downward normal excludes direct sunlight; brightness depends on reflected transport and fill.':p.sunVisibleIrradiance.every(v=>v<.00001)?'No measured direct sun at this point; its orientation and visibility must both be considered.':'Direct sun is present at the measured normal and visibility.'} AO retains ${fmt(p.screenAO*100,1)}% of composed HDR luminance. ${e?`Independent sky/reflected E = ${fmt(luma(e.sky))}/${fmt(luma(e.reflected))}; probe total (sky plus signed residual) = ${fmt(luma(p.skyIrradiance)+luma(p.reflectedIrradiance))}.`:''}`}).join('\n')}`).join('\n\n')

const report=`# Extaplan lighting, shadows and GI correctness audit

Audit date: 2 November 2026. This is an audit of the actual dirty workspace, not only its committed revision. [Sampled input hashes](source-before.json), [final hashes](source-after.json), [exact runtime settings](${run}/settings.json), [comparison page](${run}/index.html), and [machine-readable results](${run}/results.json) make the result reproducible.

## Findings and scope

1. Direct shadow visibility is applied to direct light before the PBR direct BRDF. The final probe diffuse term is composed independently. All six cameras pass the HDR identity (B−C)≈(D−E), with a scale-aware RGBA16F rounding bound. This rejects the suspected final-shader multiplication of GI by the direct shadow map in these cases.
2. N8AO **does multiply the entire composed HDR colour**, including direct sunlight, local light, diffuse GI, authored fill, emission and specular reflections. It is a screen-space contact approximation, not a selective physically based indirect-visibility term. Material AO is another, separately applied term. They can overlap with GI occlusion. The broad ceiling/window-wall differences cannot automatically be assigned to AO; measured per-surface ratios are below.
3. The diffuse reference tests reveal substantial approximation error. A sealed room is exactly black, but the one-window room ceiling is too bright relative to the independent solver, and the connected room overestimates transported daylight. The furniture fixture does not reliably preserve the expected under-table/exposed-floor ordering. These are failed accuracy expectations, even though numerical isolation and the sealed-room check pass. This report does not certify the renderer as physically accurate.
4. The combined probe field and the independently reconstructed sky field use band-limited SH reconstruction. Their signed difference is recorded without hiding negative values (${negativeResiduals.length} sampled receivers have a component below −0.001). A negative residual, where present, is not physical negative reflected energy or a shadow/GI multiply. The independent path reference supplies the physical sky/reflected split.
5. A **physical capture/visibility bug** was reproduced and corrected: navigation-hidden floor/ceiling surfaces were omitted by the BVH material filter and capture traversal/material clones. A downward ray could miss an existing upper-floor cap. Three targeted regressions failed before the correction and pass afterward. Registered navigation visibility is now ignored by physical lighting inputs, while genuinely hidden objects remain excluded. No house geometry or authored lighting parameter was changed.
6. A **diagnostic-only bug** was also reproduced and corrected: diagnostic sky sampling omitted the production blend between storeys across an open stairwell. The test's maximum discrepancy fell from ${fmt(seamBefore.maxError,6)} to ${fmt(seamAfter.maxError,6)}. This helper correction does not change normal final-composite lighting.
7. Display shadow switches do not restart GI in the matrix. A separate code-level limitation remains: future transport evaluations reuse the sun's display shadow object/intensity. A later bake while display shadows are disabled is not established to be physically independent. The fixed-field diagnostic override isolates the final direct visibility term; it is not a claim that every subsequent bake is shadow-preference independent.

The saved Colin cache initially had 244 probes and no separated sky component. An incremental legacy upgrade could reuse incomplete direct/sky baselines. The before matrix freezes a completed full bake of the existing layout; the after matrix uses a fresh full bake after the physical visibility correction. Each five-case matrix uses its own single completed field. Both stages retain **301 identical probe positions and identical occupancy masks**, checked by buffer hashes. [Field checksums](verified/field-checksum.json) and [fresh-bake status](verified/fresh-bake.json) identify the after field and six completed passes. Quality, camera transforms, materials, sun, exposure, sky and authored settings match. The input hash manifest covers the listed sampled files; it did not include indirectCaptureScene.ts, whose capture-clone correction is also part of this audit. The shared baseline path reference is explicitly labelled: its scene inputs and receiver positions/normals match exactly, and it does not consume either probe field. Earlier trial captures with ambiguous diagnostic bindings or stale navigation visibility were discarded. The screenshots mentioned in the request were not attached as image files, so reproducible equivalent transforms were chosen. Some surfaces, especially columns and reveals, are not visible in every view; absent categories are not replaced with invented measurements.

## Composition from source to pixel

${fence}mermaid
flowchart LR
  Sun[Sun colour × intensity] --> SV[Shadow visibility]
  Lamps[Lamp power / solid angle] --> LF[Distance / cone / room visibility / shadow visibility]
  SV --> Direct[Direct PBR diffuse + specular BRDF]
  LF --> Direct
  Sky[Directional linear sky radiance] --> Capture[Opaque captures / six diffuse passes]
  Direct -->|diffuse only| Capture
  Capture --> SH[Radiance SH coefficients]
  SH --> Interp[Visibility-weighted volume + floor interpolation]
  Interp --> Probe[Cosine convolution / clamp / display strength]
  Fill[Authored indoor fill] --> Indirect[Indirect diffuse BRDF]
  Probe --> Indirect
  Env[Environment / saved reflection maps] --> Spec[Indirect specular / reflection visibility]
  Indirect --> MAO[Material AO]
  Spec --> MAO
  Direct --> Sum[Linear HDR composition + emission]
  MAO --> Sum
  Sum --> N8[N8AO on composed HDR]
  N8 --> ACES[Exposure / ACES]
  ACES --> Display[sRGB output]
${fence}

This diagram has separate capture and final-display uses of direct light; the final pixel does not add its own direct light to its probe field twice. Direct light reflected by another surface legitimately appears in indirect transport.

| Contribution | Actual calculation and combination | Source |
|---|---|---|
| Sun source | Colour interpolates between authored warm and daylight sRGB colours via Three Color's linear working space. Intensity is 0.55 + 0.75 × elevation blend. The actual vector is the light position minus target; the UI elevation is not itself the final vector. | ${source('src/components/ThreeDView.tsx','function getSunAppearance')}, ${source('src/components/ThreeDView.tsx','function SunLight(')} |
| Sun direct irradiance | max(n·l,0) × sun colour × intensity × shadow visibility. Three's RE_Direct_Physical applies diffuseContribution/PI and its specular BRDF. | ${source('node_modules/three/src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js','getDirectionalLightInfo')}, ${source('node_modules/three/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js','void RE_Direct_Physical')} |
| Shadow visibility | Hardware depth comparison. Custom projected PCF uses receiver-plane derivatives, texel centres, five Vogel taps, raster uncertainty bias and min(centre, filtered); mix(1,visibility,shadowIntensity). | ${source('src/materials/localShadowReceiver.ts','const projectedShadowReceiver')} |
| Local direct light | Point power/(4PI), spot power/PI via Three's light classes. Inverse-distance decay is bounded by max(distance^decay,.01); finite cutoff multiplies squared saturate(1−(d/r)^4). Spot cone adds smoothstep. Room/portal or cached lamp visibility multiplies source colour before PBR; a shadowed slot uses a map where enabled. | ${source('src/roomLightShader.ts','const maskedLightsChunk')}, ${source('src/components/ThreeDView.tsx','function FixedLocalLightPool')}, node_modules/three/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js |
| Diffuse sky | Upper hemisphere: base × (0.6+0.8y) clear, or base × (0.5+y) overcast. Escaped lower rays see a 0.2-reflectance ground budget. Indoor sky reaches probes through actual openings; exterior receivers can use an analytic sky integral. | ${source('src/daylightSky.ts','export function daylightSkyRadiance')}, ${source('src/indirectLightingShader.ts','else if(hdGIExteriorFootprint')} |
| Reflected diffuse | Six production transport passes reuse direct radiance plus the previous completed diffuse field. Surface response stores linear albedo × (1−metalness)/PI, material AO and optional fog. Direct-only baselines are reused rather than accumulated as deltas repeatedly. | ${source('src/indirectSurfaceCache.ts','vec3 hdResponse =')}, ${source('src/indirectSurfaceRelighting.ts','max(base + after - before')} |
| Probe representation | Cube solid-angle weights proportional to 1/length(p)^3, normalised to 4PI; coefficients are incoming radiance. L1 uses 4 coefficients. Irradiance basis is 0.886227 and 1.023328 × n; experimental L2 is not enabled here. | ${source('src/indirectProbeIntegration.ts','float weight =')}, ${source('src/indirectSH.ts','export function indirectSHIrradianceBasis')} |
| Interpolation | Relocated probe positions, compact (1−d²/r²)² kernel with r=1.75×spacing; exact BVH segment rejects blocked links. Valid measured black probes remain valid. Coefficients are averaged before directional evaluation. Volume/floor filtering renormalises coverage; reconstructed negative RGB is clamped to zero. Open storeys blend only where occupancy permits. | ${source('src/indirectVolume.ts','export function createIndirectVolumeLookup')}, ${source('src/indirectLightingShader.ts','vec3 hdGIVolumeSample')}, ${source('src/indirectLightingShader.ts','vec3 hdGIVolumeIrradiance')} |
| Indoor composition/fill | For an indoor receiver: irradiance = probeLight × probeStrength × displayStrength + indoorFill. It replaces the ordinary ambient/hemisphere diffuse term and zeros diffuse IBL. Exterior fallback adds analytic sky to the existing irradiance. Authored indoor fill is ${settings.fill}, not added after tone mapping. | ${source('src/indirectLightingShader.ts','irradiance = hdGICapture')}, ${source('src/components/ThreeDView.tsx','function AmbientFillLight')} |
| Reflection | PMREM and retained room reflection maps supply specular. Fallback radiance is attenuated by clamp(luminance(mean probe E + fill)/PI,0,1); local reflection maps bypass that fallback suppression. This is an artistic visibility approximation, not a specular transport solver. | ${source('src/indirectLightingShader.ts','float hdGIReflectionVisibility')}, ${source('src/components/PbrEnvironment.tsx','export function PbrEnvironmentProvider')} |
| Material AO | AO map R channel, (R−1)×intensity+1, multiplies indirect diffuse, clearcoat/sheen indirect and roughness/view-dependent specular occlusion. It does not multiply direct diffuse/specular. Each bounce receiver may legitimately apply its own material AO; no extra receiver albedo multiply was found. | ${source('node_modules/three/src/renderers/shaders/ShaderChunk/aomap_fragment.glsl.js','float ambientOcclusion')} |
| Screen AO | N8AO reconstructs occlusion from screen depth/normals; finalAo=pow(texel.r,intensity). With black AO colour, output = sceneHDR × finalAo. Radius ${settings.ao.radius} metres; screenSpaceRadius=false; intensity ${settings.ao.intensity}. | ${source('src/components/ThreeDView.tsx','aoRadius={0.28}')}, ${source('node_modules/n8ao/src/EffectCompositer.js','float finalAo =')}, ${source('node_modules/n8ao/src/EffectCompositer.js','vec3 aoApplied')} |
| Output | Linear offscreen HDR → N8AO → postprocessing ACES_FILMIC → sRGB. Without composer, renderer ACES handles the direct canvas path. Exposure = 2^EV; measured exposure ${settings.exposure}. Composer sets renderer NoToneMapping while mounted to prevent a second ACES pass. | ${source('src/components/ThreeDView.tsx','gl.outputColorSpace =')}, ${source('src/components/ThreeDView.tsx','<ToneMapping mode=')}, node_modules/@react-three/postprocessing/src/EffectComposer.tsx |

## Units, energy and colour space

All recorded E values are linear scene-relative RGB irradiance, not lux. Outgoing HDR RGB is scene-relative radiance after the material BRDF. Display RGB is the actual 8-bit sRGB framebuffer. The per-surface values come from float32 diagnostic shader targets, not from inverse tone mapping. Matrix HDR buffers are actual RGBA16F compositor inputs immediately before the tone-mapping pass, including screen AO where enabled. The independent reference reports irradiance and Monte Carlo standard errors separately.

Three decodes sRGB colour textures for lighting; data maps and half-float probe/volume textures use non-colour/linear conventions. The cube SH integration normalises solid angle to 4PI; receiver evaluation cosine-convolves by PI for l=0 and 2PI/3 for l=1. Surface response divides by PI once per diffuse bounce, and the final receiver applies its own albedo/PI once. Applying albedo at successive different surfaces is correct transport, not duplicate receiver reflectance. The audit found no final-lighting addition after tone mapping or second gamma conversion in the measured path.

The authored daylight gain is ${fmt(settings.sky.base[0]/.65,2)}. It scales injected sun/sky for diffuse captures once; it does not multiply the incoming bounce field on every pass. This is an artistic source gain, not an energy-normalisation correction. Exterior display sky and direct visible sun retain their separate unscaled display sources. Ambient/hemisphere artist fill exists outside the indoor probe receiver path; the indoor path replaces it with the scalar fill. Reflection visibility and negative-SH clamping are additional nonphysical approximations. No authored value was adjusted to improve a result.

## Toggle semantics and matrix

| Case | Direct shadow-map visibility | Reflected diffuse field | Screen AO |
|---|---|---|---|
| A | saved setting ON | ON | ON |
| B | saved setting ON | ON | OFF |
| C | forced 1 (maps bypassed with shadow.intensity=0) | ON | OFF |
| D | saved setting ON | OFF | OFF |
| E | forced 1 | OFF | OFF |

The saved local-light shadow preference is OFF and remains OFF in all cases. Lamps, room/portal visibility, reflection maps and artist fill remain fixed. This distinction matters: disabling direct shadow maps does not disable geometric room classification. The harness does not set renderer.shadowMap.enabled=false, change castShadow or remove lights. It uses light.shadow.intensity=0, preserving sampler/program layout and cached maps. It pauses the frame loop after completion and checks field object identity, generation, captured faces and **every coefficient** after each capture.

The normal UI “Indirect lighting” switch sets hdGIProbeStrength=0; that disables both sky and reflected terms carried by the probes. Setting hdGIEnabled=0 also removes indoor replacement/fill and changes environment handling. Neither isolates reflected GI. The diagnostic override instead substitutes cached reconstructed sky + the same fill for indoor diffuse irradiance and retains the original specular visibility term. The signed difference from the combined SH reconstruction is reported as a residual. It is a precise isolation of this approximate representation, not a new physical sky solver.

The normal AO UI switch can remove the compositor, return to renderer ACES and change the allowed DPR range. The matrix therefore disables only the existing N8AO pass, retaining the same tone-mapping pass, targets, resolution and DPR. Normal local-shadow controls can also change the room-mask fallback for shadowed slots; the diagnostic override leaves those uniforms fixed. The saved local-shadow setting is OFF in this house, so its fallback remains unchanged throughout this matrix.

Normal Shadows is an imperative display control; it retains programs/maps and does not trigger the fixed-field bake. However, ${source('src/indirectSurfaceRelighting.ts','material.uniforms.hdSunShadow.value.set(shadow.intensity')} and the shared capture sun shadow object show how a later transport request can depend on that preference. A production fix would need fresh physical sun visibility independent of display-map freshness, not merely forcing a cached intensity to one. That change was not silently introduced during this audit.

All images have ${settings.width}×${settings.height} pixels, DPR ${settings.dpr}, identical materials, geometry, sky, exposure and sun. Browser compositor screenshots include only the WebGL canvas; every HTML overlay is hidden. [Five-column comparison and all difference images](${run}/index.html). Signed linear differences use neutral grey=0 and 64 byte levels per radiance unit; display differences use 2 byte levels per sRGB byte. Exact signed RGB32F gzip arrays accompany the PNGs. Original RGBA16F gzip rows are bottom-up; RGB32F difference rows are top-down; all are little endian.

| Camera | Mean absolute A−B HDR | Mean absolute B−C HDR | Mean absolute B−D HDR | Max shadow-additivity residual |
|---|---:|---:|---:|---:|
${results.map(r=>`| ${r.camera.id} | ${fmt(r.differences['A-B'].hdr.meanAbsolute)} | ${fmt(r.differences['B-C'].hdr.meanAbsolute)} | ${fmt(r.differences['B-D'].hdr.meanAbsolute)} | ${fmt(r.shadowAdditivity.maxAbsoluteHDRResidual,6)} |`).join('\n')}

A large B−C difference is not automatically an error. Sun-facing surfaces become directly illuminated through opaque geometry when direct visibility is bypassed. Check n·l and the measured map/BVH visibility. A downward ceiling has zero direct sun cosine, so shadow bypass alone should not brighten its diffuse sunlight term. The numerical additivity check uses .002×(1+max absolute HDR component), because HDR highlights need a larger absolute half-float rounding bound than dim walls.

The full visible sample grids preserve lighting gradients numerically, independently of albedo and tone mapping. E below is the combined probe term before artist fill; minima/maxima can span a large part of the same plane, so they are not local derivatives.

| Camera | Ceiling min / max E | Window-wall min / max E |
|---|---:|---:|
${results.map(r=>`| [${r.camera.id} grid](${run}/${r.camera.id}/surface-grid.json) | ${r.gradients?.ceiling?fmt(r.gradients.ceiling.min.E)+' / '+fmt(r.gradients.ceiling.max.E):'not visible'} | ${r.gradients?.windowWall?fmt(r.gradients.windowWall.min.E)+' / '+fmt(r.gradients.windowWall.max.E):'not visible'} |`).join('\n')}

## Direct shadows and geometry

The sun uses a 2048² map, bias 0, normal bias 0.015 m, five-tap projected filtering and an orthographic frustum derived from scene bounds. The actual source vector, colour/intensity, near/far and map settings are saved in the runtime settings JSON. Bias can separate near contacts by 15 mm; filter and receiver-plane corrections can legitimately differ from a hard ray. The custom filter takes min(centre, average taps), which deliberately rejects some bright taps across ridges and can be darker than an average-only PCF filter. This is not a GI multiplier.

Wall/shadow sides are explicitly authored, including double-sided reveal/wall boundaries and different roof shell sides. Thin surfaces, invisible ceiling/slab shadow blockers, exterior roof geometry and navigation-faded materials must be considered as casters, not only what is opaque in a screenshot. Clear glazing is treated as an opening for bake/BVH visibility; mixed frame/pane models retain opaque frames. The reference snapshot covers visible opaque standard materials and excludes editor helpers/glazing. It does not prove equivalence with every shadow-only proxy, alpha cutout or transmission effect. Such geometry mismatch is a limitation, not evidence of a bad depth comparison.

The pure [sun visibility views](${run}/04-stairwell/sun-visibility.png) exclude GI, AO and material colour; clear panes are omitted and the background is black. The independent BVH compares hard visibility at exact GPU positions offset along geometric normals by 0.0002, 0.004 and 0.01 m. All raw first-occluder distances and local-lamp ray results are in [reference.json](${run}/reference.json). ${shadowMismatches.length} of ${matched.length} measured surface points differ from hard-ray sunlight visibility by more than 0.1. The list below retains differences for investigation rather than converting all filtering/bias differences into failures.

${shadowMismatches.length?shadowMismatches.map(p=>`- ${p.camera} / ${p.name}: map ${fmt(p.sunVisibility[0],3)}, BVH ${p.bvhSunVisibility}, offset results ${JSON.stringify(p.visibilityOffsets)}, first blocker ${p.firstOccluderDistance}.`).join('\n'):'No >0.1 discrepancy at the selected surface points.'}

## AO analysis

N8AO is a depth-based, temporally accumulated screen-space AO pass with denoising and explicit transparency handling. Radius is in world units, not pixels: ${settings.ao.radius} m. The test also captures 0.14 m radius and half intensity (${settings.ao.intensity/2}) from each fixed camera. A−B and the per-surface HDR luminance ratios measure the actual AO composite, while shader materialAO records the separate material map. Ratios are undefined for a perfectly black receiver and should not be interpreted as physical accessibility there. The local-light visibility channel is a source-weighted aggregate; when its unoccluded irradiance is zero, its recorded zero is undefined visibility, not a measurement of total occlusion.

The implementation applies the post AO once, not twice. Material AO is applied on the material's indirect terms and in diffuse transport response; this is a separate approximation at each receiving surface. Both it and N8AO can darken crevices already occluded by GI. XR uses authored contact decals instead of desktop N8AO, and baked floor lightmaps are disabled in this desktop fixture. The full-colour N8AO multiply is a known physical limitation; selectively applying it would require separating lighting components before composition. No extra render pass or expensive lighting feature was added to conceal it.

## Independent reference scenes

These use the production six-pass solver, unchanged L1 order, gain 1 and fill 0. The independent solver traces original scene triangles with original linear base-colour textures, hard source visibility and six diffuse secondary bounces, without production probes, SH, interpolation or replay. Each fixture uses 16,384 paths per point; the actual-house reference uses 8,192. It includes explicit lamps but excludes mesh emission, secondary normal-map perturbation and specular transport. Material AO is not in that reference. Reported standard errors quantify Monte Carlo uncertainty, not these systematic model differences.

| Fixture / receiver | Production probe E | Independent sky+reflected E | Relative RGB-mean error |
|---|---:|---:|---:|
${rooms.flatMap(r=>r.reference.results.map(p=>{const expected=p.reference.sky.map((v,c)=>v+p.reference.reflected[c]),a=mean(p.productionIrradiance),b=mean(expected);return`| ${r.kind} / ${p.name} | ${fmt(a)} | ${fmt(b)} | ${b>1e-8?fmt((a-b)/b*100,1)+'%':a===0?'zero matched':'nonzero'} |`})).join('\n')}

[Full fixture data](reference-rooms/results.json). The sealed room's five receivers and independent paths all return exactly zero. The sunlight fixture's shadow-OFF repeat changes direct HDR while preserving the GI generation and every coefficient. The two-room second receiver is lit through a doorway, but quantitative error remains large. The table/furniture fixture exposes excessive spatial smoothing; its under-table ordering is not accepted as physically validated. Probe counts are not increased to force either test to pass.

## Ceiling, window wall, stairwell and individual surfaces

White ceilings must be assessed using their actual albedo/normal and reflected E, not a presumed equal brightness to walls. Downward orientation legitimately rejects direct upper-hemisphere sun; it does not justify missing reflected light. The one-window fixture actually overestimates the reference ceiling. Actual-house results below separate these cases by receiver and include uncertainty in the linked reference data. Window-facing interior walls can look into the room and away from the opening, receive little direct escaped sky, and still need reflected transport. Low-order angular reconstruction and interpolation can erase those gradients or create positive sky lobes on occluded orientations. Increasing ambient, gain or exposure would not establish correctness.

The measured probe sky/reflected columns are reconstruction diagnostics. Their sum equals the actual combined probe contribution before fill (up to rounding); a negative signed residual is not physical negative reflected irradiance. The independent reference is used for physical interpretation. Source metadata identifies the actual visible mesh so an unrelated surface is not silently passed off as a reveal or column.

${surfacetable}

## Narrow correction and regression evidence

The physical visibility root cause is separate from the shader composition. ${source('src/indirectVisibility.ts','hasViewportSurfaceVisibility(material)')} now admits registered navigation-hidden material groups into the BVH; its ancestor filter similarly distinguishes camera hiding from genuine hiding. ${source('src/indirectCaptureScene.ts','hasViewportSurfaceVisibility(original)')} makes owned physical capture clones visible and uses the existing viewport visibility registry to include camera-hidden objects. The live editor's visibility is preserved. The three ray/capture/invariance regressions in tests/lightingSurfaceVisibility.test.ts failed before and pass after this correction.

The cache payload format and coefficient layout stay compatible. New saves carry captureVisibilityVersion=1. Old L1/L2 payloads still load through the existing compatibility path and remain displayed while the editor progressively rebuilds a full direct baseline. The old camera-dependent direct coefficients are not reused; otherwise a partial update could preserve the defect. This costs a one-time full rebuild for an old cache, not a new per-frame lighting feature. Cache loading, marker migration and exact old-buffer retention are regression-tested.

The independent reference snapshot uses the same camera-independent physical object eligibility, without borrowing GI radiance or transport. The harness applies the existing viewport visibility rules for each fixed camera before freezing frame callbacks, so upstairs floors are displayed normally. These are separate requirements: physical transport includes both sides' registered surfaces, while a normal camera displays the authored visible side.

The diagnostic root cause: the original hdDiagnosticSky sampled only the selected floor's sky slabs, while hdGIVolumeIrradiance blended adjacent storeys across an open, unblocked stairwell. Therefore sky-only and total-minus-sky views used different spatial reconstructions. Diagnostic sky now uses the same occupancy, support and smoothstep blend, including the missing-support fallback. It is compiled out of the normal shader family. The GPU regression covers both SH orders, both sides of the join and five heights: 20 cases, before maximum discrepancy ${fmt(seamBefore.maxError,6)}, after ${fmt(seamAfter.maxError,6)}. [Before](sky-seam/before.json), [after](sky-seam/after.json).

| Original diagnostic (top) / production reference (bottom) | Corrected diagnostic / production reference |
|---|---|
| ![Before](sky-seam/before.png) | ![After](sky-seam/after.png) |

The ${run} matrix repeats all comparisons after both corrections. [Before/after HDR differences](before-after.json) compare the matched cameras and authored settings; differences in normal lighting now include the corrected physical capture field and are expected. The baseline freezes the original completed field rather than silently upgrading it, while using corrected camera framing/visibility and reference instrumentation. The isolated sky regression above demonstrates the diagnostic-only change separately. The harness rebinds packed textures and checks their dimensions on every draw. Remaining angular/spatial transport and AO-model errors are reported, not hidden by adjusted settings.

Matched normal-composite before/after screenshots (A), with the same authored inputs:

| Before physical capture correction | After physical capture correction |
|---|---|
${results.map(r=>`| ![Before ${r.camera.id}](baseline/${r.camera.id}/A.png) | ![After ${r.camera.id}](${run}/${r.camera.id}/A.png) |`).join('\n')}

The geometric correction is **not an aggregate GI accuracy improvement**: across ${referenceComparison.matched} identical receiver positions/normals, mean absolute indirect-irradiance error against the independent reference is ${fmt(referenceComparison.meanBefore,6)} before and ${fmt(referenceComparison.meanAfter,6)} after. The sampled stairwell ceiling worsens, while the bedroom and hallway ceilings improve. [Matched numerical errors](reference-before-after.json) retain those regressions. The fix is supported by the physical ray/capture invariance tests; the remaining SH/interpolation/transport errors are still unresolved and the renderer is not certified as physically accurate. No ambient, gain, exposure or quality adjustment was used to make this comparison appear better.

The final repository suite has **1084 passed / 1087 tests**, including the four new physical visibility/cache regressions. The same three geometry failures were present in the initial 1080/1083 run: inter-storey internal roof clipping, Springfield loft roof/slab preservation, and reused spindle Cylinder UV/topology. The audit does not attribute those failures to lighting or silently repair unrelated work. Complete output is in [the retained test log](validation/lighting-correctness-unit-tests-final.log). Targeted lighting tests, GPU regressions, type checking and lint results are recorded in [validation.json](validation.json).

## Performance and retained overhead

No test instrumentation module is imported by a production entry point. Instrumentation uses an opt-in test page and restores original hooks, uniforms, render target, AO/shadow settings and frame scheduling. The normal-production performance run uses a URL without lightingDiagnostics and asserts that no diagnostic API exists. It measures the same completed field at the same 999×740 camera with an identical small navigation path, bracketing each feature change with restored samples. GPU times come from EXT_disjoint_timer_query_webgl2, not CPU submission timing. Frames with disjoint timing are excluded.

| Normal production feature case | Baseline CPU submission ms | Changed CPU ms | Baseline GPU ms | Changed GPU ms | GPU delta ms |
|---|---:|---:|---:|---:|---:|
${production?Object.entries(production.cases).map(([name,r])=>`| ${name} | ${fmt((r.before.cpuSubmissionMeanMs+r.after.cpuSubmissionMeanMs)/2,3)} | ${fmt(r.changed.cpuSubmissionMeanMs,3)} | ${fmt((r.before.gpuExecutionMeanMs+r.after.gpuExecutionMeanMs)/2,3)} | ${fmt(r.changed.gpuExecutionMeanMs,3)} | ${fmt(r.gpuDeltaMs,3)} |`).join('\n'):'| pending | | | | | |'}

The separate unchanged-renderer samples before/after the production corrections average ${fmt(productionBefore.cases['unchanged normal production renderer'].changed.gpuExecutionMeanMs,3)}/${fmt(production.cases['unchanged normal production renderer'].changed.gpuExecutionMeanMs,3)} ms GPU and ${fmt(productionBefore.cases['unchanged normal production renderer'].changed.cpuSubmissionMeanMs,3)}/${fmt(production.cases['unchanged normal production renderer'].changed.cpuSubmissionMeanMs,3)} ms CPU submission. Both have 64 programs, 271 draw calls and 76,811 triangles. These separate runs establish no material frame-cost regression, not a statistically demonstrated speed improvement. [Before timings](production-performance-before.json).

The probe-branch bypass is a cost experiment only: it also changes sky/fill/environment handling and is not matrix GI OFF. Shadow filtering disable retains maps. Forced map regeneration redraws the same casters every frame to measure update cost without changing sun or geometry. With unchanged inputs, the normal map update is cached. Positive/negative bracket noise must not be interpreted as an optimisation proof. [Raw normal-production timings](production-performance.json); [instrumented/restored diagnostic-family timings](${run}/performance.json). The packed diagnostic volumes, separate sky volumes and colour/depth diagnostic targets use about ${fmt(((settings.diagnosticBytes-settings.width*settings.height*8)*1.5+settings.width*settings.height*32)/1048576,1)} MiB, plus temporary CPU readback buffers (depth estimated at 32 bits per pixel). Normal production does not allocate those diagnostic resources. Existing GI cache compatibility and progressive behaviour are preserved.

The instrumentation-family GPU mean is ${fmt(diagnosticPerformance.diagnostic.cases['diagnostic shader'].changed.gpuExecutionMeanMs,3)} ms. After restoring the original material hooks, the matched diagnostic-family baseline GPU mean is ${fmt(diagnosticPerformance.restored.cases['GI display disabled'].before.gpuExecutionMeanMs,3)} ms. These sequential samples include load drift; use the normal-production bracketing table for feature-cost estimates. The production shader family omits the corrected diagnostic helper entirely.

## Reproduction

${fence}powershell
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
# Asset portal must also be available on 5174 for the actual model materials.
node tests/browser/lightingCorrectnessAudit.mjs 5180 docs/lighting-correctness/verified --fresh
node tests/browser/lightingCorrectnessRooms.mjs 5180
node tests/browser/lightingCorrectnessSkySeam.mjs 5180
node tests/browser/lightingCorrectnessProduction.mjs 5180
node tests/lightingCorrectnessVerification.mjs
node tests/lightingCorrectnessReport.mjs verified
node tests/lightingCorrectnessArtifacts.mjs
${fence}

Use --fresh for a full current bake with the original authored settings; use --restore=tmp/lighting-correctness-cache.json to replay the exported completed field. The matrix exports its completed field to tmp/lighting-correctness-cache.json; the source model is never saved. Run timing captures without another GPU workload. The fixture and actual-house numerical errors are evidence to retain as accuracy regressions, not thresholds to loosen until a desired appearance passes.
`
writeFileSync(`${root}/report.md`,report)
writeFileSync(`${root}/surface-measurements.csv`,'camera,surface,x,y,z,nx,ny,nz,sun_E,sky_E,signed_reflected_E,fill_E,screen_AO\n'+results.flatMap(r=>r.points.filter(p=>!p.unavailable).map(p=>[r.camera.id,p.name,...p.position,...p.normal,luma(p.sunVisibleIrradiance),luma(p.skyIrradiance),luma(p.reflectedIrradiance),luma(p.artistFillIrradiance),p.screenAO].join(','))).join('\n'))
console.log('WROTE',`${root}/report.md`,results.length,'cameras',reference.results.length,'reference receivers')
