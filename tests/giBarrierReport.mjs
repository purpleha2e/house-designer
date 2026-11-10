import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {gunzipSync,gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
import {DataUtils} from 'three'
import {auditCameras} from './browser/lightingCorrectnessDriver.mjs'
const root='docs/gi-barrier-filtering',read=p=>JSON.parse(readFileSync(`${root}/${p}`)),save=(p,v)=>writeFileSync(`${root}/${p}`,JSON.stringify(v,null,2)),esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),source=read('baseline/source.json')
for(const [p,h]of Object.entries(source.files))assert.equal(hash(p),h,`Production/source input changed: ${p}`)
function accuracy(points,reference){
 const differences=points.flatMap((p,i)=>p.rgb.map((v,c)=>({error:Math.abs(v-reference[i][c]),relative:Math.abs(v-reference[i][c])/Math.max(.01,Math.abs(reference[i][c]))})))
 return{channels:differences.length,mae:differences.reduce((s,v)=>s+v.error,0)/differences.length,rmse:Math.sqrt(differences.reduce((s,v)=>s+v.error**2,0)/differences.length),maxAbsolute:Math.max(...differences.map(v=>v.error)),meanRelativeWith001Floor:differences.reduce((s,v)=>s+v.relative,0)/differences.length}
}
const rooms=read('reference-rooms.json').map(r=>({kind:r.kind,receivers:r.points.length,modes:Object.fromEntries(['legacy','A','B'].map(m=>[m,accuracy(r.barrier.readings.modes[m],r.points.map(p=>p.reference.sky.map((v,c)=>v+p.reference.reflected[c])))]))})),receivers=read('house/receivers.json'),reference=JSON.parse(readFileSync('docs/lighting-correctness/verified/reference.json')).results
assert.equal(receivers.glError,0,'Invalid canonical GPU receiver readings')
const house=Object.fromEntries(['legacy','A','B'].map(m=>[m,accuracy(receivers.modes[m],reference.map(p=>p.reference.sky.map((v,c)=>v+p.reference.reflected[c])))]))
save('accuracy.json',{units:'linear indirect irradiance RGB, same completed fields; relative denominator max(reference,.01)',rooms,house,houseLimitations:'39 retained points, canonical production receiver equations with zero per-mesh corner/mount offsets, independent 8192-sample six-bounce diffuse reference. Not a full per-pixel physical reference image.'})
const diagnostics=read('house/barrier-diagnostics.json'),frameMetrics=[]
const contact=[]
for(const camera of auditCameras){
 const dir=`house/${camera.id}`,png=await sharp(`${root}/${dir}/legacy.png`).metadata(),width=png.width,height=png.height,n=width*height*4
 assert.equal(width,999);assert.equal(height,740)
 for(const [column,mode]of ['legacy','A','B'].entries())contact.push({input:await sharp(`${root}/${dir}/${mode}.png`).resize(333,247).png().toBuffer(),left:column*333,top:auditCameras.indexOf(camera)*275+28})
 const load=m=>{const b=gunzipSync(readFileSync(`${root}/${dir}/${m}.rgba16f.gz`));assert.equal(b.byteLength,n*2);const h=new Uint16Array(b.buffer,b.byteOffset,n);return Float32Array.from(h,v=>DataUtils.fromHalfFloat(v))},base=load('legacy')
 for(const mode of ['A','B']){
  const next=load(mode),signed=new Float32Array(width*height*3),absolute=new Float32Array(signed.length),previewSigned=Buffer.alloc(signed.length),previewAbsolute=Buffer.alloc(signed.length);let sum=0,squared=0,max=0,count=0
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
   const i=(y*width+x)*3+c,v=next[((height-1-y)*width+x)*4+c]-base[((height-1-y)*width+x)*4+c];assert.ok(Number.isFinite(v));signed[i]=v;absolute[i]=Math.abs(v);sum+=Math.abs(v);squared+=v*v;max=Math.max(max,Math.abs(v));count++
   previewSigned[i]=Math.round(255*Math.max(0,Math.min(1,.5+v*.5)));previewAbsolute[i]=Math.round(255*Math.max(0,Math.min(1,Math.abs(v))))
  }
  for(const [name,values,bytes]of [['signed',signed,previewSigned],['absolute',absolute,previewAbsolute]]){writeFileSync(`${root}/${dir}/${mode}-${name}.rgb32f.gz`,gzipSync(Buffer.from(values.buffer)));await sharp(bytes,{raw:{width,height,channels:3}}).png().toFile(`${root}/${dir}/${mode}-${name}.png`)}
  frameMetrics.push({camera:camera.id,mode,mae:sum/count,rmse:Math.sqrt(squared/count),maximum:max,meaning:'HDR image difference from legacy, not physical error',format:'little-endian Float32 RGB, top-left row first'})
 }
 const dots=diagnostics.points.filter(p=>p.camera===camera.id&&!p.exterior).map(p=>{const rejected=p.samples.A.taps.filter(t=>t.weight>0&&t.support>0&&!t.valid).length;return`<circle cx="${p.pixel.x}" cy="${p.pixel.y}" r="9" fill="${rejected?'#ef7147':'#44deb1'}" stroke="black"/><text x="${p.pixel.x+12}" y="${p.pixel.y+5}" fill="white" stroke="black" paint-order="stroke" font-size="17">${esc(p.name)}: ${rejected} rejected</text>`}).join('')
 writeFileSync(`${root}/${dir}/tap-overlay.svg`,`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="data:image/png;base64,${readFileSync(`${root}/${dir}/legacy.png`).toString('base64')}" width="${width}" height="${height}"/>${dots}</svg>`)
}
save('hdr-differences.json',frameMetrics)
await sharp({create:{width:999,height:auditCameras.length*275,channels:3,background:'#182631'}}).composite([...contact,...auditCameras.map((c,i)=>({input:Buffer.from(`<svg width="999" height="28"><text x="5" y="20" fill="white" font-family="sans-serif" font-size="16">${c.id} · legacy / A / B</text></svg>`),left:0,top:i*275}))]).png().toFile(`${root}/contact-sheet.png`)
const thin=read('regressions.json')[0],taps=thin.samples.legacy.taps
writeFileSync(`${root}/thin-wall.svg`,`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="460" viewBox="0 0 1000 460"><rect width="1000" height="460" fill="#101d27"/><g fill="#eaf4f5" font-family="sans-serif"><text x="30" y="38" font-size="24">6 mm opaque wall · 39.855 mm texel spacing</text><text x="30" y="70">Same BVH-valid texels, same completed lighting field</text>${[0,1].map(k=>`<g transform="translate(${k*495},0)"><text x="35" y="115" font-size="23">${k?'A / B: barrier-aware taps':'Legacy: bilinear taps'}</text><rect x="257" y="140" width="12" height="205" fill="#a9b3bb"/><text x="275" y="165">6 mm</text><circle cx="252" cy="245" r="7" fill="#fff"/>${taps.map((t,i)=>{const x=t.position[0]<thin.wallX?130:395,y=i<2?190:305,invalid=x>260;return`<path d="M${x} ${y}L252 245" stroke="${invalid?'#f07764':'#46dfb3'}" stroke-width="3" ${k&&invalid?'stroke-dasharray="5 7" opacity=".4"':''}/><circle cx="${x}" cy="${y}" r="12" fill="${invalid?'#f5c267':'#49b8d2'}"/><text x="${x-30}" y="${y-20}">${t.l0Irradiance[0].toFixed(4)}</text>`}).join('')}<text x="35" y="390" font-size="25">E = ${thin.samples[k?'A':'legacy'].rgb[0].toFixed(4)}</text><text x="35" y="420">${k?'Cross-wall weights removed; valid weights normalized':'Bright-side texels cross the wall during filtering'}</text></g>`).join('')}</g></svg>`)
const performance=read('house/performance.json'),pre=read('house/preprocessing.json'),settings=read('house/settings.json'),dynamic=read('dynamic.json')
const candidates=Object.entries(performance.cases).map(([name,v])=>({name,accepted:false,reason:'GPU overhead exceeds 0.5 ms and accounted extra GI memory exceeds 10%',gpuDeltaMs:v.gpuDeltaMs,gpuMs:v.changed.gpuExecutionMeanMs,glError:v.changed.glError,bytes:name.startsWith('A')?pre.aBytes:pre.bBytes,baselineTextureBytes:settings.volumeBytes+settings.floorBytes}))
for(const c of candidates)assert.equal(c.glError,0,'Invalid house benchmark; do not publish')
for(const c of Object.values(performance.cases))for(const phase of ['before','changed','after'])assert.equal(c[phase].glError,0)
save('decision.json',{productionDefault:'legacy unchanged',sourceHashesUnchanged:true,candidates,combinedMetadataPreparationMs:pre.elapsedMs,existingVisibilityPreparationMs:pre.geometryMs+pre.warmMs,rapidEdits:read('cancellation.json'),dynamicCases:dynamic.length,referenceRooms:rooms.length,sixCameras:auditCameras.map(c=>c.id),cacheSHA256:hash('docs/gi-spatial-accuracy/baseline/field-cache.json')})
const style=`body{font:16px system-ui;background:#101b24;color:#e8eef4;margin:32px;max-width:1700px}a{color:#82d7fa}figure{margin:0}img{width:100%;background:#213541}figcaption{padding:8px}h2{margin-top:45px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.diff{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}code{color:#e7c778}`
writeFileSync(`${root}/index.html`,`<!doctype html><meta charset="utf-8"><title>GI barrier filtering evidence</title><style>${style}</style><h1>GI barrier filtering experiments</h1><p>Both candidates rejected; production retains legacy reconstruction. See <a href="report.md">engineering report</a> and <a href="decision.json">measured decision</a>. Authored materials and exposure, AO disabled equally in screenshots. Normal timing uses original AO.</p><img style="max-width:1000px" src="thin-wall.svg"><p>Difference previews use RGB signed mapping 0.5 + 0.5×ΔE, absolute mapping |ΔE|, clipped to [0,1]. Each preview links to unclipped float32 RGB gzip; these are rendered image differences, not physical-reference error.</p>${auditCameras.map(c=>`<h2>${esc(c.id)}</h2><div class="grid">${['legacy','A','B'].map(m=>`<figure><a href="house/${c.id}/${m}.png"><img src="house/${c.id}/${m}.png"></a><figcaption>${m} · <a href="house/${c.id}/${m}.rgba16f.gz">linear RGBA16F</a></figcaption></figure>`).join('')}</div><div class="diff">${['A','B'].flatMap(m=>['signed','absolute'].map(d=>`<figure><a href="house/${c.id}/${m}-${d}.rgb32f.gz"><img src="house/${c.id}/${m}-${d}.png"></a><figcaption>${m} ${d} Δ</figcaption></figure>`)).join('')}</div><details><summary>Receiver tap diagnostics</summary><img src="house/${c.id}/tap-overlay.svg"><p>Canonical receiver tap tests only; zero per-mesh corner/mount offsets; does not display cross-storey blend. A rejected segment indicates a geometric barrier, not proof of physical error at the surface.</p></details>`).join('')}<h2>Geometry metadata</h2><p>Teal: empty/open. Red: exact triangle lists. Yellow: B certified planes. Volume maps show slice 4 of 11 interpolation cells.</p><div class="grid">${diagnostics.maps.map(m=>`<figure><img src="house/barriers-${m.mode}-${m.layer}-${m.floor}.png"><figcaption>${m.mode}, ${m.layer}, floor ${m.floor}</figcaption></figure>`).join('')}</div>`)
const fmt=v=>v.toFixed(4),mib=v=>(v/1048576).toFixed(2),stage=pre.geometryMs+pre.warmMs
writeFileSync(`${root}/report.md`, `# GI barrier filtering: rejected prototypes

Both isolated candidates recover the 6 mm dark-side irradiance. Neither is accepted for production. The geometry metadata exceeds the memory budget, and normal-renderer timing is recorded below. The production default and all inspected production source hashes remain unchanged; neither experiment is combined with occluder-local. [Visual comparison gallery](index.html), [machine-readable decision](decision.json).

## Root cause and affected paths

Probe-to-texel visibility is geometrically valid, but final texture filtering has no barrier information. Two bright-side and two dark-side floor texels share one bilinear stencil; hardware blends them after visibility has already been resolved. Alpha records coverage, not surface side or connectivity. Confidence attenuation is already in RGB and must survive normalization.

| Production location | Role / potential crossing |
|---|---|
| [indirectVolume.ts:34](../../src/indirectVolume.ts#L34), lookup at 45, row writer at 225 | Linear 3D SH texture; BVH-valid probe links are evaluated at texel positions; actual Y is clamped to floor/ceiling; padded storey rows extend border values. Trilinear reconstruction can cross walls, panels, slabs, ceilings and roof triangles. |
| [indirectFloorLighting.ts:23](../../src/indirectFloorLighting.ts#L23), row writer at 37 | Linear floor SH texture, fixed elevation +16 mm; RGB contains confidence, alpha distinguishes supported and unsupported cells. Bilinear filtering can cross any opaque vertical barrier intersecting its plane. |
| [indirectLightingShader.ts:192](../../src/indirectLightingShader.ts#L192) | Selects floor/storey and biases the receiver along geometric normal; floor bias 4 mm, other surfaces depend on volume spacing. Corner and mount adjustments are separate. A biased point can already be on the wrong side before filtering. |
| [indirectLightingShader.ts:331](../../src/indirectLightingShader.ts#L331) | textureLod filters each SH coefficient, divides by filtered coverage, reconstructs irradiance. It cannot distinguish an opaque partition from open space. Floor selection changes the representation; there is no additional floor/volume blend inside this function. |
| [indirectLightingShader.ts:377](../../src/indirectLightingShader.ts#L377) | Optional adjacent-storey blend samples the other volume. Mask/ceiling heuristics can miss a thin intervening slab; the same geometric rejection must apply to that sample too. |
| [IndirectLighting.tsx:207](../../src/components/IndirectLighting.tsx#L207), preview publication at 1569 | Uploads completed/progressive display textures. A future integration must publish matching metadata atomically for every grid/generation, including coarse previews. |
| [indirectGpuPreview.ts:72](../../src/indirectGpuPreview.ts#L72), [indirectSurfaceRelighting.ts](../../src/indirectSurfaceRelighting.ts), [indirectLightingDiagnostic.ts](../../src/indirectLightingDiagnostic.ts) | Preview/replay/display diagnostics share reconstructed coefficient sampling or equivalent linear sampling. These are not independent geometric guarantees. No production replay or preview path is changed by these prototypes. |

The same operator can violate visibility across interior/exterior walls, closed doors, ceilings/slabs, roof surfaces and thin cabinets: it only requires a stencil to straddle opaque geometry. Open doorways, windows, panel edges and stair openings are valid transport paths. A gradient alone is not evidence of leakage. The slab fixture exercises the volume and adjacent-storey blend; horizontal ceiling/roof barriers follow the same segment test. Actual-house darkening alone is not classified as corrected leakage.

## Isolated implementations

**A — manual barrier filtering:** a worker finds actual opaque BVH triangles overlapping each floor/volume interpolation domain. A paged RGBA32F atlas stores sparse headers, deduplicated local triangles and lists. Boundary fragments explicitly fetch four floor/eight volume taps and reject receiver-to-sample segments that cross a triangle. Open cells retain hardware sampling. This is a local triangle scan, not per-fragment BVH traversal. The 10 µm segment tolerance is distinct from the larger probe-ray bias.

**B — geometry metadata:** the same worker certifies one/two parallel planes only where real triangles conservatively cover the complete cell section. A plane-side test replaces the triangle scan there; finite edges, openings and complex cells use A's exact fallback. There are no room labels, radiance thresholds, per-room textures or inferred connectivity. ${pre.planeCells} cells are certified; ${pre.fallbackCells} still need exact lists. B's remaining triangle pool explains its small memory saving.

Both sample existing SH coefficients and coverage, renormalize only valid supported weights, retain valid black measurements and preserve confidence. Source positions reproduce the existing volume height clamp. Border domains include the storey transition. They do not add probes, change SH order, six passes, gain, fill, sky, exposure or materials. Code is entirely under tests/; modes legacy/A/B exist only in the comparison harness, not the application URL flags.

Fetch cost: every sampled representation adds two metadata header fetches. A boundary needs up to 16/32 SH fetches for L1 floor/volume, plus a record and approximately four atlas fetches per examined triangle per tap; volume source positions also read the mask. B's certified case needs two plane fetches per tested tap instead of a triangle loop. Existing L1 hardware sampling uses four coefficient fetches. Counts are static shader work estimates, not GPU hardware transaction counters. A cell can contain ${pre.maxTriangles} triangles, making worst-case work unsuitable for interactive rendering.

## Preserved thin-wall failure and wider controls

Wall X=${thin.wallX}, thickness=0.006 m; receiver=(${thin.receiver.join(', ')}), 1 mm clear of the wall. Grid spacing=${thin.floorGridStep} m. Correct analytic irradiance=0.1000; independent visibility rejects exactly the cross-wall tap segments. The existing half-float SH path gives ${fmt(thin.exactProbeBlend)} on the dark side. [Before/after diagram](thin-wall.svg), [all exact taps/support/weights](regressions.json), [original baseline](baseline/thin-wall.json).

| Geometry | Legacy E | A E | B E |
|---|---:|---:|---:|
${read('regressions.json').map(r=>'| '+r.kind+' | '+['legacy','A','B'].map(m=>fmt(r.samples[m].rgb[0])).join(' | ')+' |').join('\n')}

The permanent test explicitly asserts that legacy violates the 0.1000 reference, and both candidates are within 0.001. Ten real-GPU fixtures independently agree with CPU manual sampling to 0.0015, including slab/storey blending. Ordinary 100/150 mm walls already have sufficient own-side taps at the retained receiver. Closed-door/panel/slab controls improve; openings retain illumination. [GPU results](gpu-regressions.json).

Independent six-bounce diffuse references, fixed 26-probe room fields, L1, six transport passes, fill zero:

| Room | Receivers | Legacy RMSE | A RMSE | B RMSE |
|---|---:|---:|---:|---:|
${rooms.map(r=>'| '+r.kind+' | '+r.receivers+' | '+['legacy','A','B'].map(m=>fmt(r.modes[m].rmse)).join(' | ')+' |').join('\n')}

All measured room receivers are unchanged by filtering. This establishes no regression at those points, not general physical correctness. [MAE, relative error, RMSE and maxima](accuracy.json), [raw references and readings](reference-rooms.json).

## Actual Colin house

All modes restore the identical completed legacy cache, 301 probe positions/coefficient arrays, authored geometry/materials and lighting settings. Six cameras: kitchen windows/inward, dining, stairwell, bedroom, hallway. Captures use exposure 1, 999×740, DPR 1, AO disabled equally; normal performance restores original AO. [18 screenshots, signed/absolute HDR differences, tap overlays and geometry maps](index.html), [settings](house/settings.json). HDR diffs are linear image changes, not a full physical-reference image. Green/red overlays show valid/rejected tap segments at retained receivers, not inferred brightness leakage.

At 39 independently traced points, canonical production receiver equations (zero per-mesh corner/mount offsets) give RMSE legacy ${fmt(house.legacy.rmse)}, A ${fmt(house.A.rmse)}, B ${fmt(house.B.rmse)}. This is no overall physical-accuracy improvement: MAE decreases slightly while RMSE increases slightly. Review of all six views found no missing surfaces or obvious new room-scale gradient break; HDR changes concentrate around surface/object boundaries. These point checks and visual review cannot validate every rendered surface or prove that all visible darkening is physically correct, particularly at unsupported areas and receiver offsets.

## Cost and decision

Actual GPU: ${settings.renderer}. Bracketed restored-before/changed/restored-after frames include the normal compositor and repeatable small camera motion; disjoint timer queries measure GPU execution separately from CPU submission. GL error must be zero in every measured phase.

| Candidate | GPU frame ms | Delta ms | Extra metadata MiB | Decision |
|---|---:|---:|---:|---|
${candidates.map(c=>'| '+c.name+' | '+c.gpuMs.toFixed(3)+' | '+c.gpuDeltaMs.toFixed(3)+' | '+mib(c.bytes)+' | Rejected |').join('\n')}

The existing display volume+floor total ${mib(settings.volumeBytes+settings.floorBytes)} MiB. Metadata adds approximately ${(100*pre.aBytes/(settings.volumeBytes+settings.floorBytes)).toFixed(1)}% of those textures, or about ${(100*pre.aBytes/(settings.volumeBytes+settings.floorBytes+37.04*1048576)).toFixed(1)}% even including the existing 37.04 MiB surface-atlas budget. Both exceed 10% on these accounted GI allocations; temporary CPU cells/BVH and duplicate CPU atlas buffers are additional. One candidate atlas is resident on GPU at a time. Driver-wide total residency is not measured.

Shared build of both metadata formats: ${pre.elapsedMs.toFixed(1)} ms, BVH querying ${pre.queryMs.toFixed(1)} ms, certificates ${pre.certificateMs.toFixed(1)} ms, A/B packing ${pre.aPackMs.toFixed(1)}/${pre.bPackMs.toFixed(1)} ms. Existing geometry build + visibility warm-up: ${stage.toFixed(1)} ms. Approximate A-only extra=${(pre.elapsedMs-pre.certificateMs-pre.bPackMs).toFixed(1)} ms; B-only extra=${(pre.elapsedMs-pre.aPackMs).toFixed(1)} ms, attributed from the shared run, not independent end-to-end bakes. [Raw preprocessing](house/preprocessing.json), [GPU timing](house/performance.json). Compilation is excluded from steady-state GPU means.

The 10% end-to-end bake/edit preparation target is not certified by this isolated restored-cache measurement. Comparing metadata time with the previously observed 90 s bake/28 s edit would mix separate runs. No additional full-house bake or production edit integration is warranted once memory and frame costs reject the candidates.

## Edits, generations and persistence

Thirteen synthetic snapshot transitions cover wall add/remove/move, window add/close, doorway open/close, furniture motion, slab add/remove and stair opening/boundary changes. Incremental A/B metadata matches a fresh rebuild and independent rays, including atlas byte size. Changes use the union of old/new bounds; reusing only new bounds would leave obsolete triangles. Typical small edits retain ${dynamic[1].statistics.reused} of ${dynamic[1].statistics.eligible} eligible cells. Layout keys include occupancy-mask hashes; a changed mask rejects reuse. [Raw edit tests](dynamic.json).

Rapid requests reject generations 1/2 and publish only generation 3, identical to a fresh final snapshot. [Cancellation test](cancellation.json). Cached PBR shader switching also has a zero-GL-error regression. Six camera captures and normal timing assert unchanged lighting generation/coefficient arrays; camera motion requests no metadata work. No production cache format changes: the original completed saved field is restored for every comparison, and derived metadata is never persisted. These are prototype invariants, not a claim that production editor latency or atomic metadata publication has been integrated or certified.

## Representation limit and recommendation

Barrier filtering can recover a discontinuity when separate, supported own-side texels exist, as the 6 mm case demonstrates. It cannot unmix coefficients already averaged across geometry, reconstruct a narrow pocket with no own-side sample, or correct a receiver bias that crossed the surface first. All taps rejected means unsupported reconstruction, not an independently measured black surface. Sparse probes and low-order SH retain their own transport/angular limitations.

Representing those cases needs extra spatial information: multiple side-specific measurements or surface-attached/adaptively located samples, plus geometric connectivity. No new architecture is implemented here. Retain legacy, preserve these regressions, and use these measured failures to constrain any later proposal; do not ship either prototype or enable occluder-local as a workaround.

## Verification and provenance

Production build passes. Full unit run: 1098 tests, 1095 pass, three previously recorded failures (inter-storey roof clipping, Springfield loft roof/slab preservation, reused spindle Cylinder topology/UVs). Final focused run adds occupancy invalidation and passes 3/3. Scoped lint passes. [Logs](validation/). Source/input hashes match the start of this task. Existing baseline artifacts are preserved.

Earlier sampler-binding trial frames/timings were invalid: Three retained a legacy per-material uniform bag while switching cached candidate programs, producing GL_INVALID_OPERATION and missing surfaces. Those timings are superseded by the zero-error results above; the harness now retains auxiliary uniform bindings in all modes and explicitly checks GL errors. The separate trial-barycentric directory is also excluded from all final metrics. Neither trial is evidence of lighting accuracy or performance.
`)
mkdirSync(`${root}/validation`,{recursive:true})
for(const [log,name]of [['unit','unit'],['focused','focused'],['build','build'],['lint','lint']]){const path=`tmp/gi-barrier-${log}.log`;if(existsSync(path)){const b=readFileSync(path);writeFileSync(`${root}/validation/${name}.log`,b[0]===255&&b[1]===254?b.toString('utf16le').slice(1):b)}}
assert.equal(read('gpu-regressions.json').results.length,10);assert.equal(dynamic.length,13);assert.equal(read('cancellation.json').latestMatchesFresh,true)
assert.deepEqual(read('cancellation.json').statuses,['rejected','rejected','fulfilled'])
for(const v of read('cached-programs.json'))assert.equal(v.glError,0)
assert.deepEqual(read('baseline/thin-wall.json'),JSON.parse(readFileSync('docs/gi-spatial-accuracy/thin-wall.json')))
const page=readFileSync(`${root}/index.html`,'utf8');for(const m of page.matchAll(/(?:src|href)="([^"]+)"/g))assert.ok(existsSync(`${root}/${m[1]}`),`Missing gallery asset ${m[1]}`)
save('validation/artifacts.json',{sourceHashesUnchanged:true,controlledGeometryCases:10,dynamicTransitions:13,rapidEdits:'only latest published',maskInvalidation:'focused test passed',cachedProgramSwitches:6,cameras:6,screenshots:18,hdrDifferencePairs:12,finiteDifferenceChannelsChecked:frameMetrics.length*999*740*3,legacyDefectPreserved:true,productionIntegration:'rejected; unchanged',performanceGL:'all phases zero',warning:'Three known full-suite failures remain; performance acceptance deliberately fails, not a green production release.'})
console.log('PASS source input hashes; generated six-camera HDR differences, receiver accuracy, diagnostic overlays and gallery')
