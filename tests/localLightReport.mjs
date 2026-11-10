import fs from 'node:fs'
import crypto from 'node:crypto'
import sharp from 'sharp'
const out='docs/local-light',read=name=>JSON.parse(fs.readFileSync(`${out}/${name}.json`)),f=n=>Number(n).toFixed(5)
const definitions=['spatial','geometric','cell-four'],modes=['production','conservative','maskedRGB','maskedLuminance']
const bedroom=read('bedroom').points,grid=read('bedroom-grid').points,doors=Object.fromEntries(['original','moved','rotated'].map(k=>[k,read(k).points])),stairs=read('staircase'),rooms=read('rooms').results,perf=read('bake-performance'),thin=read('thin-wall')
function stats(points,key,mode){const delta=points.flatMap(p=>p.referenceRGB.map((v,c)=>p.variants[key][mode][c]-v)),sorted=delta.map(Math.abs).sort((a,b)=>a-b);return{mae:delta.reduce((s,v)=>s+Math.abs(v),0)/delta.length,bias:delta.reduce((s,v)=>s+v,0)/delta.length,p95:sorted[Math.floor(sorted.length*.95)],fallbacks:points.filter(p=>!p.variants[key].validLocal).length,points:points.length}}
const groups={bedroom,bedroomGrid:grid,bedroomLowOverhead:grid.filter(p=>p.signature[3]-p.position[1]<.8),bedroomExposed:grid.filter(p=>p.signature[3]-p.position[1]>=.8),...doors,stairs,...Object.fromEntries(rooms.map(r=>['room-'+r.kind,r.points]))}
const summary=Object.fromEntries(Object.entries(groups).map(([name,points])=>[name,Object.fromEntries(definitions.map(key=>[key,Object.fromEntries(modes.map(mode=>[mode,stats(points,key,mode)]))]))]))
fs.writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2))
const referenceProbes=JSON.parse(fs.readFileSync('docs/bedroom-daylight/reference.json')).probeReference
const probeCounterfactual=bedroom.map(p=>({name:p.name,variants:Object.fromEntries(Object.entries(p.variants).map(([key,q])=>{
 const local=q.candidates.filter(p=>p.local&&p.visible),covered=local.every(p=>referenceProbes.some(r=>r.index===p.index)),total=local.reduce((s,p)=>s+p.spatialWeight,0),basis=[.886227,1.023328*p.normal[1],1.023328*p.normal[2],1.023328*p.normal[0]]
 const irradiance=covered&&total?[0,1,2].map(c=>Math.max(0,local.reduce((s,p)=>{const coeff=referenceProbes.find(r=>r.index===p.index).referenceCoefficients;return s+p.spatialWeight/total*basis.reduce((s,v,k)=>s+v*coeff[k][c],0)},0))):null
 return[key,{covered,valid:q.validLocal,referenceProbeLocal:irradiance,productionLocal:q.local,independentReceiver:p.referenceRGB}]
}))}))
fs.writeFileSync(`${out}/bedroom-reference-probe-local.json`,JSON.stringify(probeCounterfactual,null,2))
const table=(head,rows)=>`| ${head.join(' | ')} |\n| ${head.map(()=> '---').join(' | ')} |\n${rows.map(row=>'| '+row.join(' | ')+' |').join('\n')}`
const errorsTable=names=>table(['Set (RGB MAE)','Production','Spatial local / mask','Geometry local / mask','Cell-four local / mask'],names.map(name=>[name,f(summary[name].spatial.production.mae),...definitions.map(k=>`${f(summary[name][k].conservative.mae)} / ${f(summary[name][k].maskedRGB.mae)}`)]))
const fileList=['tests/localLightReconstruction.ts','tests/localLightReconstruction.test.ts','tests/localLightReplay.ts','tests/localLightIO.mjs','tests/localLightBedroom.ts','tests/localLightRooms.ts','tests/localLightThinWall.ts','tests/localLightBake.ts','tests/localLightStored.ts','tests/localLightReport.mjs','tests/localLightVerify.mjs','tests/tsconfig.local-light.json','tests/browser/localLightSnapshot.ts','tests/browser/localLightSnapshot.mjs','tests/browser/localLightView.ts','tests/browser/localLightCapture.mjs']
const manifest={date:'2026-11-05',sources:fileList.map(path=>({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),productionFilesChanged:[],newArtifactsDirectory:out}
fs.writeFileSync(`${out}/source-manifest.json`,JSON.stringify(manifest,null,2))
// Static scientific comparison: shared colour scale, no interpolated evidence.
async function heatmap(name,points,key){
 const views=['reference','production','conservative','maskedRGB'],width=1120,height=420,minX=Math.min(...points.map(p=>p.position[0])),maxX=Math.max(...points.map(p=>p.position[0])),minZ=Math.min(...points.map(p=>p.position[2])),maxZ=Math.max(...points.map(p=>p.position[2])),scale=Math.max(...points.map(p=>p.referenceRGB[0]),...points.flatMap(p=>views.slice(1).map(m=>p.variants[key][m][0])))
 const color=v=>{const t=Math.max(0,Math.min(1,v/scale));return`rgb(${Math.round(30+225*t)},${Math.round(35+190*t)},${Math.round(80-55*t)})`}
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f6f5f2"/><g font-family="Arial" fill="#20252d"><text x="20" y="28" font-size="18">${name} — ${key}; red irradiance, shared scale 0–${scale.toFixed(3)}</text>`
 views.forEach((mode,i)=>{svg+=`<text x="${20+i*280}" y="60" font-size="15">${mode}</text>`;for(const p of points){const x=25+i*280+(p.position[0]-minX)/Math.max(.01,maxX-minX)*240,y=85+(p.position[2]-minZ)/Math.max(.01,maxZ-minZ)*290,value=mode==='reference'?p.referenceRGB[0]:p.variants[key][mode][0];svg+=`<rect x="${x}" y="${y}" width="10" height="10" fill="${color(value)}"/>`}})
 svg+='</g></svg>';fs.writeFileSync(`${out}/${name}-${key}.svg`,svg);await sharp(Buffer.from(svg)).png().toFile(`${out}/${name}-${key}.png`)
}
await heatmap('bedroom-grid',grid,'geometric');await heatmap('door-grid',doors.original.filter(p=>p.kind==='grid'),'cell-four')
let gpu=null
if(fs.existsSync(`${out}/gpu-performance.json`)){gpu=read('gpu-performance');gpu.summary=gpu.frames.map(({mode,frames})=>{const cpu=frames.map(p=>p.cpuMs).sort((a,b)=>a-b),g=frames.map(p=>p.gpuMs).filter(v=>v!==null).sort((a,b)=>a-b);return{mode,cpuMedian:cpu[Math.floor(cpu.length/2)],cpuP95:cpu[Math.floor(cpu.length*.95)],gpuMedian:g.length?g[Math.floor(g.length/2)]:null}});fs.writeFileSync(`${out}/gpu-summary.json`,JSON.stringify(gpu.summary,null,2))}
const images=[]
for(const camera of ['door','staircase'])for(const mode of ['baseline-10cm','conservative-10cm','masked-10cm']){const path=`${out}/${camera}-${mode}.png`;if(fs.existsSync(path))images.push({camera,mode,path})}
if(images.length===6){const panels=await Promise.all(images.map(async(image,i)=>({input:await sharp(image.path).resize(500,340,{fit:'contain',background:'#eeeeee'}).png().toBuffer(),left:(i%3)*500,top:Math.floor(i/3)*370+30})));let label=`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="740"><rect width="100%" height="100%" fill="#eee"/>`;images.forEach((im,i)=>label+=`<text x="${(i%3)*500+12}" y="${Math.floor(i/3)*370+22}" font-family="Arial" font-size="17">${im.camera}: ${im.mode}</text>`);label+='</svg>';await sharp(Buffer.from(label)).composite(panels).png().toFile(`${out}/comparison.png`)}
const mainFloor=bedroom.find(p=>p.name==='floor'),notch=doors.original.filter(p=>['trace-3','trace-4','trace-5','trace-6'].includes(p.name))
const stored=fs.existsSync(`${out}/stored-comparison.json`)?read('stored-comparison'):[]
const gradientMetrics=rooms.slice(0,4).map(room=>({kind:room.kind,variants:Object.fromEntries(definitions.map(key=>[key,Object.fromEntries(modes.map(mode=>{
 const errors=[]
 for(const z of [1.75,2,2.25,3.8]){const line=room.points.filter(p=>p.position[2]===z).sort((a,b)=>a.position[0]-b.position[0]);for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b.position[0]-a.position[0];for(let c=0;c<3;c++)errors.push(Math.abs((b.variants[key][mode][c]-a.variants[key][mode][c]-b.referenceRGB[c]+a.referenceRGB[c])/dx))}}
 return[mode,errors.reduce((a,b)=>a+b,0)/errors.length]
}))]))}))
fs.writeFileSync(`${out}/gradient-metrics.json`,JSON.stringify(gradientMetrics,null,2))
const report=`# Local-light-preserving reconstruction experiment

2026-11-05. **Do not integrate any candidate as a production default.** Light masking is rejected as a general correction: it removes useful darkening and worsens moved-door, rotated-door and staircase reference errors. Conservative geometry selection is promising for the bedroom, but fails the opening tests. Conservative cell-four reduces the exact probe-590 notch but worsens the dense bedroom floor and original door-grid average. No thresholds were retuned after these failures.

## What was held fixed

The existing completed L1 fields, 301 active probes (sparse IDs), six-pass coefficients, materials, illumination and sampling layouts were reused. The bedroom is the frozen daylight fixture; door poses use their own retained geometry/field pairs. These are different frozen lighting/geometry fixtures and are not interchanged. Bedroom capture asserts exact saved coefficients; all six bedroom point baselines and 1,200 door point baselines match saved results within 1e-7. There are no production source changes and no transport reruns for reconstruction candidates. Primary numbers have no 10 cm smoothing, no display ambient fill, and no direct source irradiance. Reference GI is sky + reflected diffuse irradiance.

Every point JSON records candidate IDs/positions, normal-dependent irradiance (raw and clamped), spatial and normalized weights, central visibility, local membership, existing region IDs, cell, support, fallback, sampling offset and independent reference with standard errors. Region labels are recorded only, never used for selection. [Input hashes](provenance.json), [frozen bedroom snapshot](bedroom-snapshot.json), [source manifest](source-manifest.json).

## Selection and masking

All definitions first retain the existing compact kernel radius 1.75 × spacing and exact probe-to-receiver segment. The spacing is 2 m in the house. No receiver-ring visibility fractions or boundary tapers are used.

* **Spatial:** local means distance below one probe spacing. This does not reliably distinguish the far side of a doorway.
* **Geometric:** cast six axis rays to the nearest opaque boundary (up to four spacings), record the six world-coordinate hit planes, and compare receiver/probe signatures. The RMS of differences divided by spacing, individually capped at one, must be ≤0.35. Six rays per active probe are prepared once, six per receiver are additional queries. These are enclosure descriptors, not a portal graph. Fixed world axes, furniture and rays escaping through an opening make this classifier imperfect and orientation-sensitive.
* **Cell-four:** within each half-spacing spatial cell, select the four globally nearest active probes to its centre, before visibility or coefficient inspection. Retain only eligible visible selected probes. Membership is stable within the cell but can jump at cell boundaries; this is a deliberate falsifiable candidate, not a claim of smooth global reconstruction.

Two visible local probes and local kernel support ≥0.1 are required. Otherwise all candidates return production. Passing this coverage check does **not** establish that the local radiance is representative. The existing floor confidence uses total production support, preventing a change in confidence from masquerading as a selection improvement.

Conservative reconstruction blends signed SH within the chosen set and evaluates/clamps afterward. Masking separately computes local and cross-set SH blends, evaluates nonnegative irradiance for the receiver normal, and uses cross-support / total-support as coupling. RGB masking applies **E = L + coupling × max(0, C − L)** to evaluated RGB. A second variant gates a convex RGB blend by luminance. Neither takes maxima of signed SH coefficients or sums a bright probe as a second source. RGB masking can alter hue; luminance gating can reduce individual channels. Both were measured. Their similar errors do not solve the missing transport/representativeness information: a brighter cross probe may simply measure the same incoming light elsewhere. No direction-resolved source identity is available in L1.

## Bedroom checkpoint and dense validation

Red irradiance at the original six receiver offsets:

${table(['Receiver','Independent','Stored L1','Point production','Geometry local / mask','Cell-four local / mask'],bedroom.map(p=>[p.name,f(p.referenceRGB[0]),f(p.stored[0]),f(p.variants.spatial.production[0]),...['geometric','cell-four'].map(k=>f(p.variants[k].conservative[0])+' / '+f(p.variants[k].maskedRGB[0]))]))}

At the target floor, geometry selection retains probes **${mainFloor.variants.geometric.candidates.filter(p=>p.local&&p.visible).map(p=>p.index).join(', ')}** and produces ${f(mainFloor.variants.geometric.conservative[0])}, versus ${f(mainFloor.referenceRGB[0])}. Its red error is ${(100*(mainFloor.variants.geometric.conservative[0]/mainFloor.referenceRGB[0]-1)).toFixed(1)}%, compared with ${(100*(mainFloor.variants.spatial.production[0]/mainFloor.referenceRGB[0]-1)).toFixed(1)}% for point production. This is a numerical improvement without brightness selection, but does not establish representative local radiance. With independently traced coefficients at those same probes, the selected blend is **0.10882**, about 29% too high: the apparent 0.07952 near-match partly offsets production capture error. Cell-four's independent-probe blend is 0.07347. On the shaded wall, independently traced cell-four probes yield 0.09692 versus 0.09561, whereas their production coefficients yield 0.26314. A selector cannot fix that large coefficient error. [Counterfactual local probe blends](bedroom-reference-probe-local.json) use the retained independent angular probe audit, not a replacement receiver reference. Its angular quadrature/path noise remains a limitation. No globally preferred probe height or brightness rule follows from these examples.

The floor sweep contains **344 actual floor locations at 20 cm spacing**, including low-overhead furniture areas and exposed floor. New independent references use 4,096 paths and six source encounters; the original six references retain 16,384 paths. Per-point Monte Carlo standard errors are retained; aggregate errors below are point estimates, not noise-free truth. Low-overhead is the geometric upward clearance below 0.8 m, not an object-specific lighting rule.

${errorsTable(['bedroomGrid','bedroomLowOverhead','bedroomExposed'])}

Geometry selection reduces aggregate floor MAE but increases mean signed bias from ${f(summary.bedroomGrid.spatial.production.bias)} to ${f(summary.bedroomGrid.geometric.conservative.bias)}; its masked bias is ${f(summary.bedroomGrid.geometric.maskedRGB.bias)}. It falls back at ${summary.bedroomGrid.geometric.conservative.fallbacks}/344 points. The fixed four set does not generalize from the single floor success. Where selection has insufficient support it explicitly falls back; no missing illumination is invented. [Floor map](bedroom-grid-geometric.png), [full floor data](bedroom-grid.json), [six receiver data](bedroom.json).

## Door, staircase and motion

Exact original probe-590 notch, red irradiance:

${table(['Sample','Reference','Production','Cell-four local','Cell-four masked'],notch.map(p=>[p.name,f(p.referenceRGB[0]),f(p.variants['cell-four'].production[0]),f(p.variants['cell-four'].conservative[0]),f(p.variants['cell-four'].maskedRGB[0])]))}

Probe 590 is cross-set under cell-four. Conservative reconstruction removes its abrupt replacement of the local estimate. Masking still allows other cross measurements to raise the samples outside the notch, so it reintroduces part of the contrast. The spatial selector wrongly calls probe 590 local; the geometry selector lacks sufficient local support here and falls back. A clear line of sight has not become a reliable classification of an opening.

${errorsTable(['original','moved','rotated','stairs'])}

Door sets have 400 points per pose, including a dense grid and control locations. Translation is −40 cm X and rotation +30°. Four exact-notch references retain the 65,536-path refinement. The staircase uses 24 retained independently traced points (16,384 paths), including the dark underside and streak area. These tables compare exact reconstruction, not the already filtered stored texture; the historic stored staircase MAE therefore differs. Masking increases staircase error for every selector. No universal smoothness or monotonic-opening claim is made.

${images.length===6?'[Door and staircase screenshots, 10 cm filter](comparison.png). The full set also contains unsmoothed frames.':'Screenshot capture status: incomplete; consult capture-failure.json. No heatmap is presented as a scene screenshot.'} The candidate preview is cell-four only. Exposure, materials, volume and probes remain fixed; the existing 10 cm geometry-aware floor filter is applied identically to baseline and candidate textures for final visual comparison. Masked preview represents the upward floor correction in L0 solely to use the existing display path; it does not validate other normals. No masked volume is fitted: positive-part directional irradiance generally cannot be represented exactly by L1.

Stored-texture RGB MAE (these correspond to the scene previews, unlike the exact-point table):

${table(['Preview','Original door','Staircase'],stored.map(r=>[r.mode,f(r.sets.door.mae),f(r.sets.staircase.mae)]))}

The visual comparison retains the dark staircase underside. The conservative floor softens the narrow feature but also shifts broader gradients. The masked floor is brighter and has worse staircase reference error, even with the 10 cm filter. Two initial screenshot attempts loaded the current authored project, which differs from the historical door fixture in three geometry transforms and sun direction; the app automatically rebuilt lighting. Those attempts were rejected by the frozen-texture check and contribute no measurements. The final screenshots load the recovered historical project, assert source=saved and exact coefficient equality, and use no new transport.

## Controlled two-room and leakage tests

Opaque 8 × 4 × 3 m enclosure, identical diffuse materials, fixed point lamp at (2, 2.5, 2), dividing wall at X=4. Opening widths are 0, 0.06, 0.6 and 1.6 m. Each configuration uses one fixed set of 36 probes (34 with the cabinet), with incoming radiance integrated over 256 sphere directions × 32 paths and projected to L1 once. Each candidate reuses those coefficients. Receiver references independently integrate 8,192 cosine paths with six source encounters; no interpolated probe reference is used. This isolates reconstruction and L1 error, not the production GPU transport solver.

${errorsTable(['room-closed','room-narrow','room-medium','room-open','room-thin-wall','room-cabinet','room-underside','room-slab','room-stairwell'])}

The closed and 6 mm barriers block every cross-wall candidate link, and the unlit room remains exactly black. Openings permit legitimate light into the dark room, but no candidate wins consistently across widths. Room-corner receivers at Z=3.8 are included. Cabinet, furniture underside, slab and stairwell fixtures retain hard geometry visibility. Geometry masking is especially poor under slabs and stairs: visible bright measurements can still be unrepresentative without crossing any opaque triangle. Thus absence of an illegal ray is insufficient to establish absence of a radiometric leak.

Mean absolute RGB spatial-gradient error along four room-crossing lines (irradiance per metre, comparing adjacent samples against the independent reference; reference noise contributes):

${table(['Opening','Production','Cell-four local','Cell-four mask','Geometry local','Geometry mask'],gradientMetrics.map(r=>[r.kind,...[r.variants.spatial.production,r.variants['cell-four'].conservative,r.variants['cell-four'].maskedRGB,r.variants.geometric.conservative,r.variants.geometric.maskedRGB].map(f)]))}

These are finite sampled gradients, not a proof of continuity. The fixed cell set admits discontinuities at cell boundaries, and visibility can still change within the local set. Fully open illumination is therefore not certified smooth by the apparent elimination of one narrow notch.

**The existing 6 mm end-to-end regression still fails:** exact receiver irradiance is ≈0.10000, while linearly filtered production floor irradiance is ${f(thin.productionFiltered[0])}. The wall lies between texels, so hardware filtering combines valid samples from opposite sides. Selection does not address this stage, and the 10 cm filter's no-cross-wall graph does not repair pre-existing leakage. This is retained as a failure, not misreported as a passed leak test. [Thin-wall reproduction](thin-wall.json), [controlled data](rooms.json).

## Performance and limits

Full existing floor/volume resolutions, same completed field, no per-fragment BVH work. The cell-four publication prototype reuses production visibility and exports its visible interpolation links; it adds membership bytes rather than a second visibility graph. The standalone diagnostic retains both representations, so memory is reported honestly.

${table(['CPU measurement (ms)','Floor','Volume'],[['Existing visibility preparation',f(perf.floor.geometryMs),f(perf.volume.geometryMs)],['Existing prepared interpolation',f(perf.floor.productionMs),f(perf.volume.productionMs)],['Same compact-graph production control',f(perf.floor.compactProductionMs),f(perf.volume.compactProductionMs)],['Graph export',f(perf.floor.graphExportMs),f(perf.volume.graphExportMs)],['Local classification within cold run',f(perf.floor.classificationMs),f(perf.volume.classificationMs)],['Cold conservative reconstruction',f(perf.floor.coldLocalMs),f(perf.volume.coldLocalMs)],['Warm conservative reconstruction',f(perf.floor.warmLocalMs),f(perf.volume.warmLocalMs)],['Warm masked reconstruction',f(perf.floor.maskedMs),'Not implemented: rejected'],['Coefficient-only dirty footprint',f(perf.floor.incrementalMs),f(perf.volume.incrementalMs)]])}

These single-process CPU timings include allocation/JIT and concurrent diagnostic load; the compact-graph control prevents attributing a representation speedup solely to local selection. Cold volume classification is a material regression. Floor/volume metadata add ${(perf.floor.additionalTypedBytes/1048576).toFixed(2)} / ${(perf.volume.additionalTypedBytes/1048576).toFixed(2)} MiB of typed arrays, plus JS cell sets; exported existing graph copies add ${(perf.floor.exportedGraphBytes/1048576).toFixed(2)} / ${(perf.volume.exportedGraphBytes/1048576).toFixed(2)} MiB while retained in this harness. Process memory before/after is in [raw timings](bake-performance.json), not claimed as an isolated algorithm allocation. Geometry edits invalidate visibility and signatures; moved/rotated runs rebuild them. Dirty-update timings measure coefficient-only reconstruction of ${perf.floor.incrementalCells} floor cells and ${perf.volume.incrementalCells} bottom-volume cells, not end-to-end interactive geometry edits.

One additional preview GPU floor texture is ${(perf.additionalGpuTextureBytes/1048576).toFixed(2)} MiB; a production swap could replace the existing texture. Floor shader work and sampler count are unchanged. ${gpu?table(['Mode','CPU frame median ms','CPU p95 ms','GPU median ms'],gpu.summary.map(r=>[r.mode,f(r.cpuMedian),f(r.cpuP95),r.gpuMedian===null?'Timer unavailable':f(r.gpuMedian)])):'GPU frame timing unavailable; capture has not completed.'} ${gpu?'These are 36-frame isolated headless-browser measurements, not a hardware-wide performance guarantee.':''}

Geometry candidate receiver sampling adds six enclosure queries per point plus 1,806 prepared probe rays; this was measured on the reference grids, not implemented across a full volume after its opening failures. A directional masked volume, full geometry-local GPU publication, and continuous interactive door motion were deliberately not pursued after rejection. No production integration is recommended on the strength of these incomplete validations.

## Decision and reproduction

**Checkpoint A:** local geometry can improve the original bedroom floor without brightness masking. **B:** masking is independently tested and rejected as a general solution. **C:** controlled rooms reveal no consistent winner, despite correct central occlusion. **D:** actual-house pose and dense-grid regressions reject both proposed conservative selectors for general use. **E:** warm reconstruction is affordable, but classification, incomplete representativeness and existing sub-texel leakage prevent promotion.

Keep production defaults unchanged. The most useful follow-up is a better receiver-local representativeness test or additional receiver information where coverage is inadequate, evaluated against both over-dark and over-bright references. The bedroom geometry result is a diagnostic lead, not an accepted room-specific rule. Dark measurements must remain capable of lowering an over-bright estimate when they are representative.

Run from the repository root (Node strip-types is used by the existing project):

\`\`\`powershell
node --experimental-strip-types tests/localLightReplay.ts --diagnostic-local-light
node --experimental-strip-types tests/localLightBedroom.ts --diagnostic-local-light
node --experimental-strip-types tests/localLightRooms.ts --diagnostic-local-light
node --experimental-strip-types tests/localLightThinWall.ts --diagnostic-local-light
node --experimental-strip-types tests/localLightBake.ts --diagnostic-local-light
node --experimental-strip-types tests/localLightStored.ts --diagnostic-local-light
node --test --test-isolation=none --experimental-strip-types tests/localLightReconstruction.test.ts tests/indirectSH.test.ts tests/indirectSpatialInterpolation.test.ts tests/softGIFilter.test.ts
node node_modules/typescript/bin/tsc -p tests/tsconfig.local-light.json --pretty false
node tests/localLightVerify.mjs
node tests/localLightReport.mjs
\`\`\`

Browser snapshot/capture runners require the existing diagnostic Vite server on 5181 and asset portal, and both require --diagnostic-local-light. The core/CLI/snapshot TypeScript scope is checked; the preview wrapper reuses the pre-existing softGIView browser harness and is verified by actual browser execution. The scoped regression suite passes 29 tests. Artifact verification checks 1,934 receivers, 5,802 reconstruction variants, all baseline hashes, exact final screenshot coefficients and 12 screenshots with no browser errors. Exact new source files:

${fileList.map(p=>'- `'+p+'`').join('\n')}

All output is under docs/local-light; tmp/local-light-bedroom-project.json and tmp/local-light-door-project.json are disposable frozen-project copies. Historical reports and existing user worktree changes are preserved.
`
fs.writeFileSync(`${out}/report.md`,report)
fs.writeFileSync(`${out}/index.html`,`<!doctype html><meta charset="utf-8"><title>Local-light reconstruction</title><style>body{font:16px system-ui;max-width:1500px;margin:32px auto;background:#f6f5f2;color:#20252d}img{max-width:100%}a{color:#245a8b}</style><h1>Local-light reconstruction: diagnostic comparison</h1><p>Rejected for production. Local geometry improves the bedroom target but does not generalize; masking worsens moved-door and staircase errors. Production defaults are unchanged.</p><p><a href="report.md">Full numerical report and limitations</a> · <a href="summary.json">Summary data</a></p>${images.length===6?'<h2>Scene screenshots, identical 10 cm smoothing</h2><img src="comparison.png">':''}<h2>Bedroom floor samples</h2><img src="bedroom-grid-geometric.png"><h2>Original door samples</h2><img src="door-grid-cell-four.png">`)
console.log('report generated',Object.keys(summary).length,'comparison sets; screenshots',images.length)
