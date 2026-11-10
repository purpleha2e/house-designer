import fs from 'node:fs'
import crypto from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {DataUtils} from 'three'
import sharp from 'sharp'
const out='docs/bedroom-daylight',read=p=>JSON.parse(fs.readFileSync(`${out}/${p}.json`)),names=['sun-0','sun-1','sun-2','sun-4','sky-0','sky-2'],cases=Object.fromEntries(names.map(n=>[n,read(n)])),reference=read('reference'),base=cases['sun-1'],zero=cases['sun-0']
const fmt=(v,n=5)=>Number.isFinite(v)?v.toFixed(n):'n/a',pct=v=>fmt(100*v,2)+'%',relative=(a,b)=>Math.abs(b)>1e-12?a/b-1:null,median=a=>{const s=a.filter(Number.isFinite).sort((a,b)=>a-b),n=s.length;return n?(s[Math.floor((n-1)/2)]+s[Math.floor(n/2)])/2:null}
const table=(h,r)=>['| '+h.join(' | ')+' |','| '+h.map(()=>'---').join(' | ')+' |',...r.map(a=>'| '+a.join(' | ')+' |')].join('\n')
const ref=Object.fromEntries(reference.sweeps.map(c=>[c.name,c.receivers])),sum=r=>r.sky.map((v,c)=>v+r.reflected[c])
const receiverResults=base.points.map((p,i)=>({name:p.name,position:p.position,normal:p.normal,samplePosition:p.samplePosition,bias:p.bias,
 cases:Object.fromEntries(names.map(name=>{const actual=cases[name].points[i].irradiance,expected=sum(ref[name][i]);return[name,{field:actual,material:cases[name].materialGPU[i].irradiance,expected,relativeError:actual.map((v,c)=>relative(v,expected[c])),direct:ref[name][i].direct}]})),
 sun:[1,2,4].map(scale=>{const actual=cases[`sun-${scale}`].points[i].irradiance.map((v,c)=>v-zero.points[i].irradiance[c]),expected=sum(ref[`sun-${scale}`][i]).map((v,c)=>v-sum(ref['sun-0'][i])[c]),unit=p.irradiance.map((v,c)=>v-zero.points[i].irradiance[c]);return{scale,actual,expected,relativeError:actual.map((v,c)=>relative(v,expected[c])),linearityError:actual.map((v,c)=>relative(v,unit[c]*scale))}})
}))
const passLinearity=[2,4].flatMap(scale=>base.trace.passes.map((pass,i)=>{const baseline=pass.coefficients.flatMap(p=>p.rgb.flat()),z=zero.trace.passes[i]?.coefficients.flatMap(p=>p.rgb.flat()),actual=cases[`sun-${scale}`].trace.passes[i]?.coefficients.flatMap(p=>p.rgb.flat());if(!z||!actual)return{scale,pass:i+1,unavailable:true};let error=0,signal=0,max=0;actual.forEach((v,k)=>{const expected=z[k]+scale*(baseline[k]-z[k]),d=v-expected;error+=d*d;signal+=(scale*(baseline[k]-z[k]))**2;max=Math.max(max,Math.abs(d))});return{scale,pass:i+1,relativeRMS:Math.sqrt(error/Math.max(1e-20,signal)),maxAbsoluteError:max}}))
const regions={sunPatch:[.57,.49,.59,.50],shadedWall:[.12,.30,.32,.45],ceiling:[.4,.07,.6,.14],bed:[.48,.76,.68,.85],window:[.805,.46,.84,.54]}
const images=[]
for(const name of names){
 const camera=read(`${name}-sunlit-wall-camera`),w=camera.width,h=camera.height,b=gunzipSync(fs.readFileSync(`${out}/${name}-sunlit-wall.rgba16f.gz`)),data=new Uint16Array(b.buffer,b.byteOffset,b.byteLength/2)
 const {data:png,info}=await sharp(`${out}/${name}-sunlit-wall.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true})
 const fullFrame={nonfinite:0,halfFloatSaturatedComponents:0,maxLinearComponent:0};for(let i=0;i<data.length;i++){if(i%4===3)continue;const v=DataUtils.fromHalfFloat(data[i]);if(!Number.isFinite(v))fullFrame.nonfinite++;else{fullFrame.maxLinearComponent=Math.max(fullFrame.maxLinearComponent,v);if(v>=65504)fullFrame.halfFloatSaturatedComponents++}}
 const values=Object.fromEntries(Object.entries(regions).map(([label,rect])=>{let count=0,mean=0,max=0,nonfinite=0,white=0;const rgb=[0,0,0]
  for(let y=Math.floor(rect[1]*h);y<Math.floor(rect[3]*h);y++)for(let x=Math.floor(rect[0]*w);x<Math.floor(rect[2]*w);x++){
   const offset=((h-1-y)*w+x)*4,v=[0,1,2].map(c=>DataUtils.fromHalfFloat(data[offset+c]));if(!v.every(Number.isFinite)){nonfinite++;continue}count++;v.forEach((q,c)=>rgb[c]+=q);mean+=v[0]*.2126+v[1]*.7152+v[2]*.0722;max=Math.max(max,...v)
   const o=(Math.min(info.height-1,Math.floor(y*info.height/h))*info.width+Math.min(info.width-1,Math.floor(x*info.width/w)))*4;if(png[o]>=254&&png[o+1]>=254&&png[o+2]>=254)white++
  }return[label,{rect,meanRGB:rgb.map(v=>v/count),meanLuminance:mean/count,maxLinearComponent:max,nonfinite,screenshotWhiteFraction:white/count}]
 }));images.push({name,fullFrame,regions:values})
}
const repeat=read('sun-1-repeat'),stability=base.points.map((p,i)=>({name:p.name,first:p.irradiance,restored:repeat.points[i].irradiance,relativeChange:repeat.points[i].irradiance.map((v,c)=>relative(v,p.irradiance[c]))}))
const probeStages=reference.reconstruction.map((r,i)=>{
 const weights=r.weightsAtBiasedPoint.probes.filter(p=>p.visible),sum=key=>[0,1,2].map(c=>weights.reduce((total,p)=>total+p.normalizedWeight*reference.probeReference.find(q=>q.index===p.index).receivers[i][key][c],0))
 return{name:base.points[i].name,weights:weights.map(p=>({index:p.index,weight:p.normalizedWeight})),capturedFirst:sum('capturedFirst'),referenceFirst:sum('referenceFirst'),capturedFinal:sum('capturedFinal'),referenceFinal:sum('referenceFinal')}
})
const changed=['src/sunStrength.ts','src/types.ts','src/App.tsx','src/components/ThreeDView.tsx','src/indirectLightingPersistence.ts','src/components/IndirectLighting.tsx','src/components/DaylightEnvironment.tsx','src/components/PbrEnvironment.tsx','src/daylightEnvironmentPixels.ts','tests/sunStrength.test.ts','tests/sceneLightingReference.ts','tests/sceneLightingReference.test.ts','tests/browser/sceneReferenceSnapshot.ts','tests/browser/roofWallRegression.tsx','tests/browser/bedroomDaylight.ts','tests/browser/bedroomDaylight.worker.ts','tests/browser/bedroomDaylight.mjs','tests/bedroomDaylightReport.mjs']
changed.push('src/components/useBuildingPreparation.ts','tests/browser/sunStrengthRegression.mjs')
const hashes=Object.fromEntries(changed.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))
const regression=fs.existsSync(`${out}/dropdown-regression.json`)?read('dropdown-regression'):null
const summary={generated:new Date().toISOString(),receiverResults,passLinearity,images,stability,probeStages,reconstruction:reference.reconstruction,referenceProbeBlends:reference.referenceProbeBlends,dropdownRegression:regression,sourceSHA256:hashes,changed}
fs.writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2))
const calibration=base.calibration,EskyUp=calibration.skyDisplay[0]*Math.PI*(.6+2*.8/3),EsunUp=calibration.sunIrradiance[0]*calibration.sunDirection[1]
const report=[
'# Bedroom daylight calibration and sun strength',
'',
'The Sun strength dropdown is available in the 3D menu: Off, 0.5×, 1× (default), 2× and 4×. It is stored with the sun and preserved when moving the sun. Old projects retain 1×. No production default or authored house file was changed.',
'',
'[Comparison screenshots](index.html) · [All RGB measurements and source hashes](summary.json) · [Independent reference and reconstruction](reference.json)',
'',
'## Controls and units',
'',
'The isolated fixture uses the same current authored geometry/materials and original bedroom camera/sun metadata as the L1/L2 audit. Historical project bytes are unavailable; frozen input hashes and the exact controls are in `inputs.json`. L1, 301 probes, 16² capture faces, six passes, daylight gain 3.5, fill 0.18, 0 EV and existing 10 cm floor filtering remain fixed. No door/stair investigation, density change, new smoothing, material edit or BVH replacement was made.',
'',
'Each sun setting completes a new six-pass solve using retained geometry and recalculated direct radiance; it does not multiply an old GI field. Sky settings start fresh renderer/bake sessions. The 1× sun is restored at the end to check stale-state errors. Sky is fixed during the sun sweep; the sun is fixed during the separate sky sweep. The ground environment contains separate sky-lit and sun-lit terms: changing sunlight naturally changes its sun-lit term, while broad sky radiance remains fixed.',
'',
table(['Calibration','Measured value'],[
 ['Three directional-light intensity',fmt(calibration.sunIntensity)],['Linear sun colour RGB',calibration.sunColor.map(v=>fmt(v)).join(', ')],['Visible source-normal irradiance RGB',calibration.sunIrradiance.map(v=>fmt(v)).join(', ')],['GI relighting source RGB',base.trace.lastSun.rgb.map(v=>fmt(v)).join(', ')],['Display sky base RGB',calibration.skyDisplay.map(v=>fmt(v)).join(', ')],['GI sky base RGB',calibration.skyCapture.map(v=>fmt(v)).join(', ')],['Indoor fill irradiance',fmt(calibration.fill)],['Exposure',`${fmt(calibration.exposure)} (0 EV)`],['Tone mapping','ACES Filmic compositor; renderer NoToneMapping during composed rendering'],
 ['Saved sun elevation control (degrees)',fmt(read('inputs').base.original.sun.elevation*180/Math.PI,2)],['Actual directional-light elevation (degrees)',fmt(Math.asin(calibration.sunDirection[1])*180/Math.PI,2)],
 ]),
'',
'These are relative linear scene units, not calibrated watts or lux. `getSunAppearance` supplies 0.55–1.3 according to elevation; this camera uses 1.3. The dropdown multiplies this source once. The GI relighter reads the same light and then applies the pre-existing 3.5× authored daylight gain once to source radiance. Consequently the visible and GI source intensities are not numerically identical: red 1.3 versus 4.55. The gain is not repeatedly applied at each bounce. No extra π factor was introduced.',
'',
'The cached capture disables its raster sun to avoid double counting, then adds the measured sun term through surface relighting. The saved elevation control also is not the actual light elevation: SunLight uses different scene-dependent horizontal and vertical distances. Both the actual direction and the control are held fixed here; this task does not silently alter that mapping.',
'',
`The clear upper sky uses base × (0.6 + 0.8 × direction.y); escaped ground uses reflectance 0.2. Unobstructed horizontal red sky irradiance is ${fmt(EskyUp)}, versus ${fmt(EsunUp)} from the current sun (${fmt(EskyUp/EsunUp,2)}× as much broad sky). This describes the existing relative sun/sky balance, not an outdoor photometric calibration. Indoor diffuse shading replaces scene ambient-light irradiance with GI plus the 0.18 fill; that fill does not enter transport.`,
'',
table(['Receiver material','Measured linear diffuse reflectance RGB','Roughness','Normal map'],base.materialGPU.map(p=>[p.name,p.albedo.map(v=>fmt(v)).join(', '),fmt(p.roughness,2),p.normalMap?'yes':'no'])),
'',
'Reflectance above is sampled through the actual textured material shader, including metalness. All these samples are nonmetallic. Floor normal-map and receiver corrections remain enabled. Values apply at the named sample, not every texel on the object.',
'',
'## Sun and sky sweeps',
'',
'Red-channel field irradiance is shown for readability; `summary.json` retains RGB independently. This is total GI, containing sky and source-reflected light. It is not sunlight alone.',
'',
table(['Receiver','Sun 0×','Sun 1×','Sun 2×','Sun 4×','Sky 0×, sun 1×','Sky 2×, sun 1×'],receiverResults.map(r=>[r.name,...names.map(n=>fmt(r.cases[n].field[0]))])),
'',
'Sun-driven indirect irradiance is the difference from the sun-disabled field. Linearity error compares the measured difference with source multiplier × the 1× difference.',
'',
table(['Receiver','ΔE 1×','ΔE 2×','2× linearity error','ΔE 4×','4× linearity error','Reference ΔE 1×'],receiverResults.map(r=>[r.name,fmt(r.sun[0].actual[0]),fmt(r.sun[1].actual[0]),pct(r.sun[1].linearityError[0]),fmt(r.sun[2].actual[0]),pct(r.sun[2].linearityError[0]),fmt(r.sun[0].expected[0])])),
'',
table(['Direct irradiance at biased reference position','Sun 0×','Sun 1×','Sun 2×','Sun 4×'],receiverResults.map(r=>[r.name,...['sun-0','sun-1','sun-2','sun-4'].map(n=>fmt(r.cases[n].direct[0]))])),
'',
'Direct values use the independent geometric visibility calculation and include any fixed explicit lamps. Their sun-on minus sun-off difference isolates sunlight. The existing “sunlit wall” sample is a point on the wall containing the sunlight patch; it does not necessarily lie inside the patch. The image ROI below measures an actual lit patch separately.',
'',
table(['Scale','Pass','Signed-coefficient linearity residual RMS / sunlight signal','Maximum absolute residual'],passLinearity.map(p=>[p.scale,p.pass,pct(p.relativeRMS),fmt(p.maxAbsoluteError,7)])),
'',
'Signed coefficients and all six publication boundaries are saved per case. Source-uniform assertions check direct intensity and GI intensity exactly once. Final SH irradiance is nonnegative-clamped before subsequent diffuse transport; that operation can make source-isolated differences nonlinear even though the BRDF itself is linear. Half-float quantisation also creates small differences. The per-pass residuals distinguish source scaling from later transport effects.',
'',
'Across the six receivers and RGB, the 4× sun-driven contribution differs from exact linear scaling by at most 1.64%. Signed-probe residual RMS is about 0.16% in the direct pass, rises to 3.03% at pass 2, then falls to 0.25% by pass 6. This places the main nonlinearity after the first SH reconstruction and its nonnegative clamp, rather than in the source multiplier. Quantisation prevents an exact zero residual in pass 1. Restoring 1× reproduces all six original field measurements exactly.',
'',
'## Independent reference and spatial reconstruction',
'',
'Reference: original textured diffuse scene, fixed source conventions, 16,384 paths per receiver, six source encounters. Baseline, sun-disabled and sky-disabled references use identical seeds. The 2×/4× sun and 2× sky references are algebraic combinations of those same paths: the independent diffuse estimator is linear in source radiance. This identity is separately tested; production fields are still solved and measured at every intensity, including their nonlinear clamps. Derived standard-error values are conservative upper bounds, not independent-trial errors. Hard visibility differs from display shadow filtering; specular, material normal maps, screen-space AO and display ambient fill are excluded. Probe-direction references use 16 paths per captured direction. Reconstruction uses the restored 1× field after verifying its irradiance agrees with the initial field within 0.001 absolute.',
'',
table(['Receiver','Reference E','Stored L1 E','L1 error','Actual material GI E, 10 cm filter','Reference-probe point blend','Production-probe point blend'],receiverResults.map((r,i)=>[r.name,fmt(r.cases['sun-1'].expected[0]),fmt(r.cases['sun-1'].field[0]),pct(r.cases['sun-1'].relativeError[0]),fmt(r.cases['sun-1'].material[0]),fmt(reference.referenceProbeBlends[i].referenceProbeBlend[0]),fmt(reference.referenceProbeBlends[i].productionProbeBlend[0])])),
'',
'The material column is the real material shader’s irradiance input before BRDF/ambient occlusion, with the constant fill removed. It retains normal maps, geometry receiver attributes and the 10 cm display binding. The independent and stored-field values use geometric normals. Point weights, contributing probes, visibility, receiver offsets, raw first/final captures and probe-reference comparisons are in `reference.json`. The reference-probe blend is a diagnostic counterfactual using independently traced radiance at the existing probe positions and the production point weights; the receiver reference itself uses no probes or interpolation.',
'',
reference.referenceReceiverSH?table(['Receiver','Independent raw cosine integral at receiver','Independent L1 at receiver','Independent probe blend'],reference.referenceReceiverSH.map((r,i)=>[r.name,fmt(r.raw[0]),fmt(r.l1[0]),fmt(reference.referenceProbeBlends[i].referenceProbeBlend[0])])):'Receiver-local angular reference was not recorded.',
'',
table(['Receiver','Weighted raw probe E, first pass','Independent first pass','Weighted raw probe E, final pass','Independent final pass'],probeStages.map(r=>[r.name,...['capturedFirst','referenceFirst','capturedFinal','referenceFinal'].map(k=>fmt(r[k][0]))])),
'',
'Raw probe columns integrate cube samples with the receiver normal before SH projection, then combine using the same visible point weights. They are diagnostics at probe locations, not irradiance at the receiver. Their RGB values and all contributing indices/weights are retained. First-pass differences include raster versus ray visibility and low-resolution sampling; final-pass differences additionally include approximate transport.',
'',
table(['Receiver','Probe-reference weight coverage','Exact point blend confidence','Stored / exact point blend, red','Bias (m)'],reference.reconstruction.map((r,i)=>[receiverResults[i].name,fmt(reference.referenceProbeBlends[i].coveredWeight,3),fmt(r.exactAtShiftedSample.confidence,3),fmt(r.displayed.rgb[0]/Math.max(1e-10,r.exactAtShiftedSample.unboundedRGB[0]),3),fmt(r.bias,4)])),
'',
table(['Receiver','Baseline error','2× sun error against its own reference','4× sun error against its own reference','2× sky error against its own reference'],receiverResults.map(r=>[r.name,...['sun-1','sun-2','sun-4','sky-2'].map(n=>pct(r.cases[n].relativeError[0]))])),
'',
'Each brighter case is compared with a reference using the same brighter source. Comparing a 4× image only against the original 1× reference would confuse source calibration with transport accuracy.',
'',
'## Image measurements and performance',
'',
'Raw linear RGBA16F images before tone mapping are retained alongside screenshots. The fixed ROIs below are defined in `summary.json` and avoid the HTML HUD. Image luminance includes direct light, GI, fill, material response and the unchanged display effects; it is not irradiance. Screenshot-white fractions detect near-white clipping in those regions.',
'',
'Some screenshots retain a transient HUD notice from compiling the diagnostic material-measurement shader. The GI-ready assertions and completed six-pass measurements precede every capture; those notices are not evidence of an unfinished GI solve. Compare the room pixels and recorded timings, not transient HUD messages.',
'',
table(['Case','Sun patch HDR Y','Shaded wall HDR Y','Ceiling HDR Y','Bed HDR Y','Window HDR Y','Patch near-white pixels'],images.map(im=>[im.name,...['sunPatch','shadedWall','ceiling','bed','window'].map(k=>fmt(im.regions[k].meanLuminance)),pct(im.regions.sunPatch.screenshotWhiteFraction)])),
'',
'Visual review: 2× sun raises the lit-patch HDR luminance by 64%, but the bed ROI by only 13%. At 4× sun, the patch is 2.93× baseline while shaded wall, ceiling and bed are only 1.30×, 1.38× and 1.39×. The room is warmer and somewhat brighter, but the direct patch dominates. With 2× sky, shaded wall/ceiling/bed rise by 22%/22%/29%, and the patch by only 11%; this is a broader, softer-looking lift. However, the window ROI rises by 85%, increasing window-to-bed contrast rather than resolving it. Shadow geometry and the 10 cm filter remain unchanged, and their soft gradients remain visible in both cameras.',
'',
'No HDR sample is nonfinite or saturated at the half-float limit in any complete sunlit-wall frame. The largest linear component is 1.761 at 4× sun; values above 1 remain valid HDR. None of the measured screenshot regions has near-white clipping (all RGB channels ≥254). The stronger direct patches are visually prominent but are not numerically clipped. This does not certify every small screen region against subjective overexposure.',
'',
table(['Case','GI profile total ms','Update to GI + filter ready ms','Filter work ms','GPU frame median ms','Programs after measurement'],names.map(n=>[n,fmt(cases[n].profile.totalMs,1),fmt(cases[n].update?.elapsedMs,1),fmt(cases[n].filter.statistics.filterMs,1),fmt(median(read(`${n}-frames`).map(f=>f.gpuMs)),3),cases[n].programs])),
'',
'The GI-profile column covers GI work, including its own preparation, not complete cold app startup or the subsequent display filter. Initial viewport shader warmup adds time before that profile. Incremental sun updates reuse geometry. The initial 10 cm filter graph preparation is recorded separately in each case (75.4 seconds for the baseline); it is unchanged existing work, not dropdown overhead. GPU timer samples vary substantially across sequential runs, so these data do not establish a frame-time improvement from changing light strength. Screenshot HUD FPS is not used. Reference calculation and diagnostic shader compilation are outside the GI profile. The restored 1× field is retained in `sun-1-repeat.json` and its differences are in the summary.',
'',
'The 4× live update encountered a cache-key React publication stall. Its 522-second wall time includes that stall and is not representative GI solve time. The worker calculation completed, but the queued React transition only committed after drawing was paused for 1.5 seconds in the isolated test browser. The restored 1× update needed the same idle opportunity. No source, coefficient or readiness flag was overridden. This scheduling issue is separate from radiometric response; all measured fields completed six passes. See `sun-4.json` for the intervention record.',
'',
'Correction: `useLightingCacheKeys` now publishes the completed result at normal update priority after yielding to viewport input, instead of using a non-expiring React transition. This releases the GI preparation gate without changing geometry or transport. The later control regression uses uninterrupted drawing and the same saved house; its first edit rebuilds the capture atlas missing from saved GI, while subsequent edits reuse it.',
'',
regression?table(['Post-fix dropdown','Update until saved GI ready (ms)','Complete transport passes','Program count before → after'],regression.results.map(r=>[r.strength+'×',fmt(r.elapsedMs,1),r.passes,`${r.before.programs} → ${r.programs}`])):'Control regression results are recorded separately.',
'',
'## Decision and changes',
'',
'No source or exposure default is promoted by this experiment. The new dropdown is a relative source control, not a correction for reconstruction error. Source-response measurements, image review and the probe-reference comparison determine the recommendation in the accompanying findings below.',
'',
'**Dominant causes: approximate bounce transport and spatial reconstruction (C and D).** At the ceiling, independently traced probe radiance with the existing point weights gives red E = 0.13789, close to the independent receiver value 0.13868. Production probes give 0.09445. The stored volume gives 0.09442 and the actual material gives 0.09443: almost no further loss occurs in those final stages. The weighted raw final probe integral is already 33.6% below its probe-location reference. This identifies biased production probe radiance/transport, rather than exposure, as the main ceiling deficit; it does not establish a new Lambertian-equation error.',
'',
'At the floor, independent receiver-local L1 gives 0.08373 versus receiver reference 0.08424. Moving to independently traced existing probes and their production weights drops this to 0.05045 (40.1% low); production probe transport reduces it further to 0.04193. Stored-field sampling gives 0.04190 and the real filtered/normal-mapped material gives 0.04543. Point and contributing grid confidence are 1, so confidence fading is not responsible here. Receiver/probe placement and spatial interpolation dominate this floor error; increasing SH order is not justified by this measurement.',
'',
'More specifically, floor probes 529 and 531–537 supply 69.5% of this receiver’s interpolation weight. They sit about 13–15 cm above the floor around the bed and have independent upward irradiance of only 0.01475–0.04132, versus 0.08424 at the receiver. They are visible to the receiver, but visibility alone does not make their incident illumination representative. This is a concrete target for a subsequent spatial reconstruction correction, not a reason to raise every light source.',
'',
'The shaded wall is overestimated (0.26374 versus 0.09561), so the room does not have a uniform energy deficit. Independently traced probes reduce its point blend to 0.10177. The bed and corner combine probe-radiance and sampling errors. The receiver-local angular comparison uses a coarser cube quadrature and fewer paths than the main reference, especially noisy at the bed; use it for stage diagnosis, not as a replacement ground truth.',
'',
'Sunlight is present and responds correctly to the control, but its spatial distribution remains biased. At 1× it contributes approximately one third of production floor and bed GI and 37.5% of ceiling GI. The broad sky is already a substantial source under the existing relative calibration. Exposure is fixed and cannot explain errors that are measured before tone mapping. The existing 0.18 fill also means a doubling of GI does not double the final material illumination.',
'',
'Recommendation: retain the 1× source default and L1/10 cm settings. Prioritise probe-to-surface reconstruction through successive bounces and the floor receiver/probe weighting, using the retained independent-probe counterfactuals to distinguish them. Preserve the existing BRDF and avoid compensating with a global brightness multiplier. Separately reconcile the sun control angle with the actual light direction before a future physical sun/sky calibration; changing it here would invalidate the fixed-direction comparison.',
'',
'Brighter sunlight can improve the image while leaving transport wrong. At 4×, floor relative error improves only from −50.3% to −47.5%; its absolute red deficit grows from 0.04234 to 0.07705. Ceiling relative error improves from −31.9% to −23.5%, while its absolute deficit grows from 0.04426 to 0.06209. The already over-bright shaded wall also gains more absolute error. These are comparisons against each setting’s own reference, not against the original 1× target.',
'',
'Source/test files changed:',
'',
'Key implementation locations: `src/components/ThreeDView.tsx:1593` (elevation-dependent source), `:1672` (strength applied once), `:21071` (dropdown), `:20272` (ACES compositor); `src/indirectSurfaceRelighting.ts:201` (sun RGB × intensity × existing daylight gain); `src/components/IndirectLighting.tsx:235` (separate display/capture sky scales); `src/indirectLightingShader.ts:687` (GI plus indoor fill); `src/App.tsx:570` (saved strength normalization).',
'',...changed.map(p=>'- `'+p+'`'),
'',
'Reproduce with the existing Vite test server on localhost:5181 and asset portal on localhost:5174:',
'',
'The exact isolated input is archived as `project.json.gz` (hash checked against `inputs.json`). `completed-baseline-cache.json.gz` supports the separate dropdown regression. The authored `colin_house_v2.json` was read only. Diagnostic retries and the old reference timeout are retained; only completed six-pass cases enter the comparison.',
'',
'Validation: 22 targeted tests passed; production TypeScript check passed. All six source cases completed six passes with no browser errors, and camera metadata is identical across cases for each view. `verification.json` checks the unchanged authored project hash. The gallery and live-dropdown browser checks are retained in `gallery-review.json` and `dropdown-regression.json`.',
'',
'```powershell',
'node --test --test-isolation=none --experimental-strip-types tests/sunStrength.test.ts tests/indirectLightingPersistence.test.ts tests/indirectContinuousLighting.test.ts tests/daylightSky.test.ts tests/sceneLightingReference.test.ts',
'npx tsc -p tsconfig.app.json --noEmit',
'node --experimental-strip-types tests/browser/bedroomDaylight.mjs',
'node tests/bedroomDaylightReport.mjs',
'node tests/browser/sunStrengthRegression.mjs',
'```',
]
fs.writeFileSync(`${out}/report.md`,report.join('\n')+'\n')
const featured=[['sun-1','Current sun / current sky'],['sun-2','2× sun / current sky'],['sun-4','4× sun / current sky'],['sky-2','Current sun / 2× sky'],['sun-0','Sun disabled / current sky'],['sky-0','Current sun / sky disabled']]
fs.writeFileSync(`${out}/index.html`,`<!doctype html><meta charset="utf-8"><title>Bedroom daylight comparison</title><style>body{font:16px system-ui;margin:24px;background:#181a1f;color:#e6e8ee}header{position:sticky;top:0;background:#181a1ff5;padding:12px;z-index:2}a{color:#9cc9ff}select{font:inherit;padding:7px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img{width:100%;display:block}figcaption{padding:12px;background:#262a32}p{max-width:1000px}</style><header><strong>Bedroom daylight</strong> <select id="view"><option value="window">Original window camera</option><option value="sunlit-wall">Sunlit wall and ceiling</option></select> <a href="report.md">Report</a> · <a href="summary.json">Measurements</a></header><p>L1 · six passes · 301 probes · 10 cm filter · fixed exposure, materials, sun direction, fill and bounce gain. These are isolated comparison scenes; production defaults remain unchanged. Ignore HUD FPS.</p><div class="grid">${featured.map(([id,label])=>`<figure><a data-id="${id}" href="${id}-window.png"><img data-id="${id}" src="${id}-window.png"></a><figcaption>${label}</figcaption></figure>`).join('')}</div><script>document.querySelector('#view').onchange=e=>document.querySelectorAll('[data-id]').forEach(n=>n[n.tagName==='IMG'?'src':'href']=n.dataset.id+'-'+e.target.value+'.png')</script>`)
console.log('Saved bedroom daylight tables, RGB summary and comparison gallery')
