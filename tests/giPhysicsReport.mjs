import fs from 'node:fs'
import crypto from 'node:crypto'
const root='docs/gi-physics/',read=name=>JSON.parse(fs.readFileSync(root+name+'.json'))
const units=read('units-transfer'),names=['uniform-0','uniform-rgb','uniform-1','ceiling-source','sun-0','sun-1','sun-2','sun-away'],rooms=Object.fromEntries(names.map(n=>[n,read(n)]))
const error=(a,e)=>e===0?null:(a-e)/e,fmt=v=>v===null?'—':v.toFixed(6),pct=v=>v===null?'—':(100*v).toFixed(3)+'%'
const rows=(headers,data)=>['| '+headers.join(' | ')+' |','| '+headers.map(()=>'---').join(' | ')+' |',...data.map(r=>'| '+r.join(' | ')+' |')].join('\n')
const measured={generated:new Date().toISOString(),units:units.units,room:{},sun:[],checks:[]}
for(const [name,d] of Object.entries(rooms)){
 measured.room[name]=d.passes.map((p,k)=>({pass:p.pass,receivers:p.samples.map((s,i)=>{
  const ref=d.reference[i],expected=ref.cumulative[k],previous=k?d.passes[k-1].samples[i].rgb:[0,0,0]
  return{name:s.name,actual:s.rgb,expected,relativeError:s.rgb.map((a,c)=>error(a,expected[c])),actualIncrement:s.rgb.map((a,c)=>a-previous[c]),expectedIncrement:ref.increments[k],referenceStandardError:ref.cumulativeStderr?.[k]??ref.stderr[k]}
 }),approximateIncidentPower:[0,1,2].map(c=>p.faces.reduce((sum,f)=>sum+f.area*f.mean[c],0))}))
}
for(let i=0;i<4;i++){
 const rgb=name=>rooms[name].passes[5].samples[i].rgb,ref=name=>rooms[name].reference[i].cumulative[5],difference=(a,b)=>a.map((v,c)=>v-b[c])
 const offToOn=difference(rgb('sun-1'),rgb('sun-0')),expectedOffToOn=difference(ref('sun-1'),ref('sun-0'))
 const directionOnly=difference(rgb('sun-1'),rgb('sun-away')),expectedDirectionOnly=difference(ref('sun-1'),ref('sun-away'))
 const double=difference(rgb('sun-2'),rgb('sun-0'))
 measured.sun.push({name:rooms['sun-1'].passes[5].samples[i].name,offToOn,expectedOffToOn,relativeError:offToOn.map((v,c)=>error(v,expectedOffToOn[c])),directionOnly,expectedDirectionOnly,directionRelativeError:directionOnly.map((v,c)=>error(v,expectedDirectionOnly[c])),intensityDoublingRelativeError:double.map((v,c)=>error(v,2*offToOn[c]))})
}
const check=(name,passed,detail)=>measured.checks.push({name,passed,detail})
check('Lambert reflection and independent RGB',units.test1.tests.every(t=>t.actual.every((v,c)=>Math.abs(v-t.expected[c])<1e-7))&&units.test1.rgb.actual.every((v,c)=>Math.abs(v-units.test1.rgb.expected[c])<1e-7),'Absolute tolerance 1e-7 in normalized radiance; includes rho=0 and rho=1.')
check('sRGB material and texture decode',units.test1.colour.every(t=>t.actual.every(v=>Math.abs(error(v,t.expected))<.005)),'0.5% tolerance for hardware sRGB texture decode; material values are substantially closer.')
check('Two-surface physical irradiance',units.test2.every(t=>t.actual.every((v,c)=>t.expected[c]?Math.abs(error(v,t.expected[c]))<.02:Math.abs(v)<1e-7)),'2% point-irradiance tolerance; quadrature convergence and raw capture are reported separately.')
check('Second surface production shading',units.test2.every(t=>t.outgoingAtSecond.every((v,c)=>Math.abs(v-t.shaderExpectedFromCapturedSH[c])<1e-7)),'Production GPU volume decode and material rho/pi match the captured SH prediction; absolute radiance tolerance 1e-7.')
check('Uniform cavity accumulation',names.filter(n=>n.startsWith('uniform')).every(n=>measured.room[n].every(p=>p.receivers.every(r=>r.relativeError.every(e=>Math.abs(e)<.01)))),'1% finite-pass error tolerance, all six passes and RGB channels.')
check('Nonuniform six-pass cavity',measured.room['ceiling-source'][5].receivers.every(r=>r.actual.every((v,c)=>Math.abs(v-r.expected[c])<=Math.max(.02*r.expected[c],3*r.referenceStandardError[c]))),'2% or three Monte Carlo standard errors, whichever is larger.')
check('Sun enters GI and responds to intensity',measured.sun.every(r=>r.offToOn.every(v=>v>0)&&r.directionOnly.every(v=>v>0)&&r.intensityDoublingRelativeError.every(e=>Math.abs(e)<.01)),'Positive receiver deltas, under 1% doubling error; this is a response check, not an accuracy certificate.')
check('Reflected direct-sun transfer magnitude',measured.sun.every(r=>r.directionRelativeError.every(e=>Math.abs(e)<.02)),'2% tolerance. Entering-minus-away keeps sky and ground radiance identical.')
measured.passed=measured.checks.every(c=>c.passed)
const files=['src/indirectSH.ts','src/indirectProbeIntegration.ts','src/indirectLightingShader.ts','src/indirectSurfaceCache.ts','src/indirectSurfaceRelighting.ts','src/components/IndirectLighting.tsx','src/indirectLightingDiagnostic.ts','src/daylightSky.ts','tests/giPhysicsReference.ts','tests/browser/giPhysicsUnits.ts','tests/browser/giPhysicsRoom.tsx']
measured.sourceSha256=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))
fs.writeFileSync(root+'summary.json',JSON.stringify(measured,null,2))
const roomFinal=measured.room['ceiling-source'][5].receivers
const lines=[
'# GI physics audit — decision: validation fails',
'',
'The Lambertian BRDF and bounce recurrence are dimensionally consistent. The production L1 directional reconstruction does **not** reproduce physical irradiance accurately enough in the tested directional scenes. Do not treat this six-pass solver as verified energy-conserving, and keep the bedroom investigation paused. No production transport equation or default was changed in this audit.',
'',
'## Conventions and controls',
'',
'The application uses relative linear RGB light units, not calibrated watts (`src/daylightSky.ts:4`). For the isolated surface, one irradiance unit represents 1000 W/m² and one radiance unit represents 1000 W/(m²·sr). Thus E=1, rho=0.8 predicts L=0.8/π; multiplying both units by 1000 gives the requested physical equivalent. RGB channels are independent mathematical bands, not three measured broadband watt totals.',
'',
'All fixtures use linear render targets, no tone mapping, exposure=1, no ambient/fill, daylight gain=1, and no bounce multiplier. These fixed isolation controls do not alter application defaults. The actual room component runs six passes with the existing L1 representation and 16×16 cubemap faces, without the soft-floor experiment, Fast GI or reflections. No SH-order or probe-density sweep was performed.',
'',
'## 1. Single diffuse surface — pass',
'',
'Production MeshStandardMaterial diffuse capture, a uniform normally incident directional source, and Float32 readback give the following red-channel values. Green and blue inputs are respectively 500 and 250 equivalent W/m², and were checked separately for every reflectance.',
'',
rows(['Reflectance','Expected L (equivalent W/m²/sr)','Actual L','Relative error'],units.test1.tests.map(t=>[t.rho,fmt(t.expected[0]*1000),fmt(t.actual[0]*1000),pct(t.relativeError[0])])),
'',
'Maximum nonzero-channel relative error is '+pct(Math.max(...units.test1.tests.flatMap(t=>t.relativeError.map(Math.abs))))+'. Hemispherical outgoing flux πL equals rho·E within floating-point error: rho=0 absorbs all light, rho=1 reflects all incoming diffuse power. Mixed RGB reflectances [0.2,0.5,0.8] with irradiances [0.25,0.5,1] also pass.',
'',
rows(['Colour input','Encoded value','Expected linear radiance','Actual red radiance','Error'],units.test1.colour.map(t=>[t.kind,t.encoded.toFixed(6),fmt(t.expected),fmt(t.actual[0]),pct(error(t.actual[0],t.expected))])),
'',
'Material colours decode to linear values once. Hardware sRGB texture decoding differs by at most 0.30% in these samples; no missing or double gamma conversion was observed. Test 1 isolates diffuse reflection; dielectric specular reflection is excluded by the production diffuse-capture flag.',
'',
'## 2. Two-surface transfer — fails physical irradiance',
'',
'A 2 m × 2 m Lambertian source at z=0 has linear reflectance [0.8,0.5,0.2], receives irradiance [1,0.5,0.25], and faces small Lambertian receiver panels. Measurements use the center differential receiver. The independent reference integrates L·cos(source)·cos(receiver)/r² over the source area (512² cells). Its centered-square result also agrees with an analytic differential view factor within 0.0002%. Receiver rho=0.5 gives Lout=0.5E/π. The captured coefficients are placed in a spatially constant transport texture, then decoded and shaded by the production GPU shader on the receiver panel: outgoing radiance agrees with 0.5E_L1/π within 1e-7. Thus the BRDF/texture-unit conversion passes, while the supplied directional irradiance fails. This isolates one-way A→B transfer; the enclosed-room test supplies coupled multi-surface bounces.',
'',
rows(['Receiver','Reference E (red)','Raw capture cosine integral','L1 equation prediction','Production E','Error'],units.test2.map(t=>[t.name,fmt(t.expected[0]),fmt(t.raw[0]),fmt(t.l1Prediction[0]),fmt(t.actual[0]),pct(t.relativeError[0])])),
'',
'All three channels and the measured outgoing receiver radiance are in `units-transfer.json`. The raw capture diagnostic uses production cubemap pixels and is **not** the independent reference. It isolates capture error (under 1% here) from directional reconstruction. Reversed receiver normals, the source backside and an opaque black blocker all produce zero.',
'',
'The exact problematic approximation is:',
'',
'```text',
'Physical: E(n) = integral Li(w) * max(0, n·w) dw',
'Current L1: E(n) ≈ max(0, integral Li(w) * (1/4 + (n·w)/2) dw)',
'```',
'',
'The second expression follows directly from the existing radiance basis and cosine-convolution constants. It is a valid first-order SH approximation, not a missing π. Its forward directional response can be 25% low, while oblique directions can be too high. Clamping its negative lobes also removes the signed cancellation: for a collimated unit source, integrating this reconstructed irradiance over all receiver-normal orientations gives 1.125π instead of π. This is a directional consistency counterexample, not a claim of 12.5% total power gain in this room. A scalar brightness correction cannot make both equations agree.',
'',
'## 3. Six-pass room — uniform accumulation passes; directional room fails',
'',
'The fixture and independent CPU path tracer share a 4×3×4 m cavity of zero-thickness inward-facing Lambertian panels. The tracer uses analytic plane intersections and cosine-weighted paths; it imports no production probe, SH or interpolation code. It uses '+rooms['ceiling-source'].reference[0].samples.toLocaleString('en-GB')+' paths per receiver, with per-pass standard errors in each JSON file. Reference self-tests verify the analytic square view factor, box visibility/normals and the exact uniform-cavity solution.',
'',
'Pass k is cumulative through k source encounters. For emissive walls this is emission plus 0…k−1 diffuse reflections; for a directly sunlit source surface the first encounter already contains one reflection. Both production and reference are truncated to the same six encounters. Each new pass is baseline direct/emissive radiance plus rho/π times the previous cumulative irradiance, rather than adding the whole previous result again.',
'',
rows(['Uniform cavity','Expected final RGB','Actual floor RGB','Largest final receiver/channel error'],['uniform-0','uniform-rgb','uniform-1'].map(n=>{const rs=measured.room[n][5].receivers;return[n,rs[0].expected.map(fmt).join(', '),rs[0].actual.map(fmt).join(', '),pct(Math.max(...rs.flatMap(r=>r.relativeError.map(Math.abs))))]})),
'',
'For a uniform source Le=[1,0.5,0.25], Ek=πLe·sum(rho^j, j=0…k−1). The rho=1 room grows linearly with injected source energy, as expected; it has no finite steady state. It still loses up to about 0.94% numerically after six passes despite zero physical absorption/escape. This audit does not attribute that residual exclusively to half-float rounding.',
'',
'With only the ceiling emissive and all reflectances 0.5:',
'',
rows(['Receiver','Reference E6 red','Production E6 red','Error','Reference 1σ'],roomFinal.map(r=>[r.name,fmt(r.expected[0]),fmt(r.actual[0]),pct(r.relativeError[0]),fmt(r.referenceStandardError[0])])),
'',
rows(['Pass','Floor reference increment','Floor actual increment','Ceiling reference increment','Ceiling actual increment'],measured.room['ceiling-source'].map(p=>[p.pass,fmt(p.receivers[0].expectedIncrement[0]),fmt(p.receivers[0].actualIncrement[0]),fmt(p.receivers[2].expectedIncrement[0]),fmt(p.receivers[2].actualIncrement[0])])),
'',
'All receivers, RGB channels, cumulative values and pass increments are in `summary.json`. Uniform and nonuniform results show no gross repeated-reflectance or duplicated-π/accumulation error. They do not establish global conservation for arbitrary scenes: directional reconstruction and subsequent spatial sampling introduce additional losses/errors. The stored 8×8 face-area samples are approximate diagnostics with receiver offsets, and are not used as a conservation proof.',
'',
'## 4. Sunlight entering GI — response passes; magnitude fails',
'',
'The front wall has an opening x=1…3 m, y=0.7…2.5 m. Source direction is normalize([0,0.6,−1]), with intensities 0, 1 and 2. Receivers are on the floor, rear wall, ceiling and left wall. The scene uses the same specified sky/ground radiance in the independent reference. Sun-off versus sun-on includes the physical ground-sky response. A second comparison reverses only the sun azimuth: entering minus away keeps sky and ground radiance identical, isolating reflected direct sunlight.',
'',
rows(['Receiver','Off→on reference ΔE','Actual ΔE','Error','Entering−away reference ΔE','Actual ΔE','Error'],measured.sun.map(r=>[r.name,fmt(r.expectedOffToOn[0]),fmt(r.offToOn[0]),pct(r.relativeError[0]),fmt(r.expectedDirectionOnly[0]),fmt(r.directionOnly[0]),pct(r.directionRelativeError[0])])),
'',
'All four positions brighten when the sun is enabled. The largest RGB deviation from exact doubling of the sun-induced delta is '+pct(Math.max(...measured.sun.flatMap(r=>r.intensityDoublingRelativeError.map(Math.abs))))+'. Changing direction changes the captured indirect response. The missing-light hypothesis “sun never enters GI” is therefore rejected for this fixture, but the transferred amount is still inaccurate.',
'',
'## Source locations, corrections and checkpoint',
'',
'- Lambert rho/π: `node_modules/three/src/renderers/shaders/ShaderChunk/common.glsl.js:103`; incident cosine and diffuse reflection: `lights_physical_pars_fragment.glsl.js:529–563`.',
'- Capture radiance → SH: `src/indirectProbeIntegration.ts:21–43`; radiance/irradiance bases and final clamp: `src/indirectSH.ts:21–44`; production GPU reconstruction: `src/indirectLightingShader.ts:425–431`.',
'- Cached diffuse response rho/π: `src/indirectSurfaceCache.ts:275`; baseline + response × previous-pass irradiance: `src/indirectSurfaceCache.ts:369–387`; complete-pass publication: `src/components/IndirectLighting.tsx:713–731`.',
'- Directional-sun diffuse capture: `src/indirectSurfaceRelighting.ts:100–109`; final irradiance input to material shading: `src/indirectLightingShader.ts:675–687`.',
'',
'No fundamental scalar-factor or colour-space implementation error was demonstrated, so no speculative production equation correction was made. The demonstrated directional approximation error remains unresolved. Correct physical directional transport requires retaining/evaluating sufficient directional information and validating spatial transfer; it cannot be recovered exactly from four SH moments or repaired with an exposure/gain change. This audit therefore stops at the failed checkpoint instead of proceeding to bedroom brightness or certifying the solver. Earlier restrictions on further SH-order/probe-density experiments and unchanged production defaults remain respected.',
'',
'Test-fixture corrections made before the final measurements: exclude dielectric specular from the black occluder, and use zero-thickness room panels so the reference has exactly the same window geometry. These are harness corrections, not lighting fixes. `initial-harness-failure.json` preserves an earlier harness readback failure, resolved by unbinding the cubemap before asynchronous readback; it is not a failure from the final run.',
'',
'## Reproduce',
'',
'```powershell',
'node --test --test-isolation=none --experimental-strip-types tests/giPhysicsReference.test.ts',
'# Start the fixture server if it is not already running:',
'npx vite --config tests/browser/doorFloorVite.config.mjs --host localhost --port 5181',
'# In a separate terminal:',
'node --experimental-strip-types tests/browser/giPhysicsAudit.mjs',
'node tests/giPhysicsReport.mjs',
'```',
'',
'The report command intentionally exits 1 while physical acceptance checks fail; successful fixture execution is not a physics pass. `summary.json` records individual checks and source hashes. The browser run completed without WebGL/runtime errors. The new reference self-tests and the focused TypeScript check pass.',
]
fs.writeFileSync(root+'report.md',lines.join('\n')+'\n')
console.log(JSON.stringify({passed:measured.passed,checks:measured.checks,sun:measured.sun.map(s=>({name:s.name,error:s.directionRelativeError[0]}))},null,2))
process.exitCode=measured.passed?0:1
