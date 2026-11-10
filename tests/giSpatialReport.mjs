import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Vector3} from 'three'
import sharp from 'sharp'
import {indirectSHIrradianceBasis} from '../src/indirectSH.ts'
import {auditCameras} from './browser/lightingCorrectnessDriver.mjs'
const root='docs/gi-spatial-accuracy',read=p=>JSON.parse(readFileSync(`${root}/${p}`,'utf8')),mean=a=>a.reduce((s,v)=>s+v,0)/a.length,fmt=(v,n=4)=>Number.isFinite(v)?v.toFixed(n):'n/a'
const target=p=>p.reference.sky.map((v,c)=>v+p.reference.reflected[c]),valid=(kind,variant,p)=>!(kind==='furniture'&&variant==='cabinet'&&p.position[1]<.08&&p.position[0]>=1.7&&p.position[0]<=3.3&&p.position[2]>=1.4&&p.position[2]<=2.6)
function metrics(points,value){const errors=points.flatMap(p=>value(p).map((v,c)=>v-target(p)[c]));return{mae:mean(errors.map(Math.abs)),rmse:Math.sqrt(mean(errors.map(e=>e*e))),worst:Math.max(...errors.map(Math.abs)),meanSigned:mean(errors)}}
const cases=[['sealed','table'],['window','table'],['two-rooms','table'],...['table','removed','raised','lowered','sideways','cabinet'].map(v=>['furniture',v])]
const comparisons=cases.map(([kind,variant])=>{
 const baseline=read(`experiments/${kind}-${variant}.json`),candidate=read(`candidate/${kind}-${variant}.json`)
 assert.deepEqual(candidate.field.positions,baseline.field.positions,'fixed probe budget and positions')
 const points=baseline.points.filter(p=>valid(kind,variant,p)),changed=candidate.points.filter(p=>valid(kind,variant,p))
 const profiles=points.filter(p=>/^(profile|doorway)-/.test(p.name)),candidateProfiles=changed.filter(p=>/^(profile|doorway)-/.test(p.name))
 const gradient=points=>{const values=points.map(p=>mean(p.shaderEquivalent.rgb));return{min:Math.min(...values),max:Math.max(...values),largestAdjacentJump:Math.max(0,...values.slice(1).map((v,i)=>Math.abs(v-values[i]))),minimumVisibleProbeCount:Math.min(...points.map(p=>p.candidates.current.coverage)),minimumSupport:Math.min(...points.map(p=>p.candidates.current.support))}}
 return{kind,variant,baseline,candidate,summary:{kind,variant,receivers:points.length,probes:baseline.field.positions.length,before:metrics(points,p=>p.shaderEquivalent.rgb),after:metrics(changed,p=>p.shaderEquivalent.rgb),profile:profiles.length?{receivers:profiles.length,before:metrics(profiles,p=>p.shaderEquivalent.rgb),after:metrics(candidateProfiles,p=>p.shaderEquivalent.rgb),beforeGradient:gradient(profiles),afterGradient:gradient(candidateProfiles)}:null,baselineBakeMs:baseline.production.elapsedMs,candidateBakeMs:candidate.production.elapsedMs}}
})
const projected=(coefficients,links,normal,order)=>{const basis=indirectSHIrradianceBasis(new Vector3().fromArray(normal),order);return[0,1,2].map(c=>Math.max(0,links.reduce((sum,p)=>sum+p.weight*basis.reduce((sum,b,k)=>sum+b*(coefficients.get(p.index)?.[k]?.[c]??0),0),0)))}
const fourWay=[],budget=[],probeErrors=[]
for(const r of comparisons.filter(r=>r.baseline.probes.length)){
 const captured=new Map(r.baseline.probes.map(p=>[p.index,p.capturedCoefficients])),independent=new Map(r.baseline.probes.map(p=>[p.index,p.referenceCoefficients]))
 for(const p of r.baseline.points){
  const results=Object.fromEntries([['L1/current',1,'current'],['L2/current',2,'current'],['L1/local',1,'occluder-local'],['L2/local',2,'occluder-local']].map(([name,order,method])=>[name,projected(captured,p.candidates[method].links,p.normal,order)]))
  fourWay.push({scene:r.kind,receiver:p.name,reference:target(p),...results})
  const exact=p.candidates.current.links.reduce((sum,l)=>{const q=r.baseline.probes.find(q=>q.index===l.index)?.values.find(v=>v.normal.every((n,i)=>Math.abs(n-p.normal[i])<1e-5));return sum.map((v,c)=>v+l.weight*(q?.referenceRaw[c]??0))},[0,0,0])
  const angular=projected(independent,p.candidates.current.links,p.normal,1),production=results['L1/current'],final=p.shaderEquivalent.rgb,ref=target(p)
  const delta=(a,b)=>a.map((v,c)=>v-b[c])
  const terms={spatial:delta(exact,ref),angular:delta(angular,exact),captureAndFeedback:delta(production,angular),gridAndReceiverBias:delta(final,production)}
  for(let c=0;c<3;c++)assert.ok(Math.abs(Object.values(terms).reduce((s,a)=>s+a[c],0)-(final[c]-ref[c]))<1e-10)
  budget.push({scene:r.kind,receiver:p.name,terms,finalError:delta(final,ref),reference:ref})
 }
 for(const probe of r.baseline.probes)probeErrors.push({scene:r.kind,index:probe.index,position:probe.position,sourceSkyMAE:probe.sourceSkyMAE,captureRawMAE:mean(probe.values.flatMap(v=>v.capturedRaw.map((x,c)=>Math.abs(x-v.referenceRaw[c])))),l1AngularMAE:mean(probe.values.flatMap(v=>v.referenceL1.map((x,c)=>Math.abs(x-v.referenceRaw[c])))),l2AngularMAE:mean(probe.values.flatMap(v=>v.referenceL2.map((x,c)=>Math.abs(x-v.referenceRaw[c])))),coefficientDifference:probe.maxCoefficientDifference})
}
mkdirSync(`${root}/plots`,{recursive:true})
function chart(name,title,series,shaded){
 const w=1000,h=390,left=75,right=25,top=45,bottom=75,maxX=Math.max(...series.flatMap(s=>s.points.map(p=>p[0]))),minX=Math.min(...series.flatMap(s=>s.points.map(p=>p[0]))),maxY=Math.max(...series.flatMap(s=>s.points.map(p=>p[1])))*1.1,x=v=>left+(v-minX)/(maxX-minX)*(w-left-right),y=v=>h-bottom-v/maxY*(h-top-bottom)
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" fill="#222"><text x="${left}" y="25" font-size="18">${title}</text>${shaded?`<rect x="${x(shaded[0])}" y="${top}" width="${x(shaded[1])-x(shaded[0])}" height="${h-top-bottom}" fill="#f2f2f2"/>`:''}${Array.from({length:6},(_,i)=>{const v=maxY*i/5;return`<path d="M${left},${y(v)}H${w-right}" stroke="#ddd"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end" font-size="12">${fmt(v,2)}</text>`}).join('')}<path d="M${left},${top}V${h-bottom}H${w-right}" fill="none" stroke="#333"/>${series.map((s,i)=>`<path d="${s.points.map(([a,b],j)=>`${j?'L':'M'}${x(a)},${y(b)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5"/><text x="${left+i*245}" y="${h-18}" fill="${s.color}" font-size="13">${s.name}</text>`).join('')}${Array.from({length:9},(_,i)=>{const v=minX+(maxX-minX)*i/8;return`<text x="${x(v)}" y="${h-bottom+22}" text-anchor="middle" font-size="12">${fmt(v,1)}</text>`}).join('')}<text x="${w/2}" y="${h-43}" text-anchor="middle" font-size="13">Receiver x (m); linear RGB-mean irradiance on vertical axis</text></g></svg>`
 writeFileSync(`${root}/plots/${name}.svg`,svg)
}
for(const r of comparisons.filter(r=>r.summary.profile)){
 const a=r.baseline.points.filter(p=>/^(profile|doorway)-/.test(p.name)),b=r.candidate.points.filter(p=>/^(profile|doorway)-/.test(p.name))
 chart(`${r.kind}-${r.variant}`,`${r.kind} / ${r.variant}; fixed sources, 26 probes, six passes`,[{name:'Legacy production',color:'#2869b2',points:a.map(p=>[p.position[0],mean(p.shaderEquivalent.rgb)])},{name:'Opt-in production',color:'#c64f31',points:b.map(p=>[p.position[0],mean(p.shaderEquivalent.rgb)])},{name:'Independent reference',color:'#21864d',points:a.map(p=>[p.position[0],mean(target(p))])}],r.kind==='furniture'&&r.variant!=='removed'?[r.variant==='sideways'?2.5:1.7,r.variant==='sideways'?4.1:3.3]:null)
}
const house={}
for(const stage of ['baseline','candidate']){
 const status=read(`${stage}/house/status.json`),experiment=read(`${stage}/house/experiment.json`),projection=read(`${stage}/house/projection.json`),performance=read(`${stage}/house/performance.json`),edit=read(`${stage}/house/window-edit.json`)
 assert.equal(status.positions.length,301);assert.equal(projection.probes.length,301);assert.equal(status.diagnosticsLoaded,false)
 assert.ok(projection.maxCoefficientDifference<.01,'independent projection reproduces captured L1 coefficients')
 const gpuFile=`${stage}/house/gpu-receivers.json`,gpu=existsSync(`${root}/${gpuFile}`)?read(gpuFile):null
 const receivers=Array.isArray(gpu)?gpu:gpu?.receivers
 const accuracyPoints=experiment.points.map(p=>({...p,gpu:receivers?.find(q=>q.name===p.name&&q.camera===p.camera)}))
 house[stage]={status,experiment,projection,performance,edit,gpu:receivers,accuracy:metrics(accuracyPoints,p=>p.gpu?.rgb??p.shaderEquivalent.rgb)}
}
assert.deepEqual(house.baseline.status.positions,house.candidate.status.positions)
for(const key of ['width','height','dpr','exposure','volumeBytes','floorBytes'])assert.equal(house.baseline.status[key],house.candidate.status[key])
const capturedHouse=new Map(house.baseline.projection.probes.map(p=>[p.index,p.coefficients]))
for(const p of house.baseline.experiment.points){if(house.baseline.gpu?.find(q=>q.name===p.name&&q.camera===p.camera)?.exterior)continue;const values=Object.fromEntries([['L1/current',1,'current'],['L2/current',2,'current'],['L1/local',1,'occluder-local'],['L2/local',2,'occluder-local']].map(([name,order,method])=>[name,projected(capturedHouse,p.candidates[method].links,p.normal,order)]));fourWay.push({scene:'Colin',camera:p.camera,receiver:p.name,reference:target(p),...values})}
const half=h=>{const s=h&32768?-1:1,e=h>>>10&31,m=h&1023;assert.notEqual(e,31);return e===0?s*2**-14*m/1024:s*2**(e-15)*(1+m/1024)}
const differences=[]
for(const camera of auditCameras){
 const dir=`${root}/comparisons/${camera.id}`;mkdirSync(dir,{recursive:true})
 for(const mode of ['neutral','authored']){
  const buffers=['baseline','candidate'].map(stage=>gunzipSync(readFileSync(`${root}/${stage}/house/${camera.id}/${mode}.rgba16f.gz`)))
  const w=999,h=740,absolute=Buffer.alloc(w*h*3),signed=Buffer.alloc(w*h*3),deltas=[]
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){const i=((h-1-y)*w+x)*8+c*2,d=half(buffers[1].readUInt16LE(i))-half(buffers[0].readUInt16LE(i)),o=(y*w+x)*3+c;deltas.push(d);absolute[o]=Math.max(0,Math.min(255,Math.round(Math.abs(d)*128)));signed[o]=Math.max(0,Math.min(255,Math.round(127.5+d*64)))}
  await sharp(absolute,{raw:{width:w,height:h,channels:3}}).png().toFile(`${dir}/${mode}-absolute.png`);await sharp(signed,{raw:{width:w,height:h,channels:3}}).png().toFile(`${dir}/${mode}-signed.png`)
  differences.push({camera:camera.id,mode,meanAbsolute:mean(deltas.map(Math.abs)),meanSigned:mean(deltas),maxAbsolute:deltas.reduce((a,b)=>Math.max(a,Math.abs(b)),0)})
 }
 // Per-receiver independent reference overlay; a full reference image is not implied.
 const samples=house.baseline.experiment.points.filter(p=>p.camera===camera.id)
 const max=Math.max(...samples.map(p=>mean(target(p)))),overlay=`<svg xmlns="http://www.w3.org/2000/svg" width="999" height="740"><image href="data:image/png;base64,${readFileSync(`${root}/baseline/house/${camera.id}/neutral.png`).toString('base64')}" width="999" height="740"/>${samples.map(p=>{const v=mean(target(p)),t=Math.min(1,v/Math.max(.001,max));return`<circle cx="${p.pixel.x}" cy="${p.pixel.y}" r="9" fill="rgb(${Math.round(t*255)},70,${Math.round((1-t)*255)})" stroke="white"/><text x="${p.pixel.x+13}" y="${p.pixel.y}" fill="white" stroke="black" stroke-width=".2" font-family="Arial" font-size="13">${p.name}: ${fmt(v,3)}</text>`}).join('')}</svg>`
 writeFileSync(`${dir}/reference-receivers.svg`,overlay)
 const chosen=samples.find(p=>p.name==='floor')??samples[0],links=chosen?.candidates.current.links??[],points=house.baseline.experiment.field.positions
 const influence=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="650"><rect width="100%" height="100%" fill="#fafafa"/><text x="25" y="25" font-size="16">${camera.id}: ${chosen?.name}; top-down probe links</text>${points.map(p=>`<circle cx="${60+p.position[0]*35}" cy="${50+p.position[2]*30}" r="2" fill="#bbb"/>`).join('')}${links.map(l=>`<line x1="${60+chosen.position[0]*35}" y1="${50+chosen.position[2]*30}" x2="${60+l.position[0]*35}" y2="${50+l.position[2]*30}" stroke="${l.blocked?'#d44':'#187343'}" stroke-width="${l.blocked?1:1+l.weight*15}" opacity=".7"/>`).join('')}<text x="25" y="625" font-size="13">Green: visible weighted support. Red: BVH-rejected segment. Width: normalized weight.</text></svg>`
 writeFileSync(`${dir}/probe-influence.svg`,influence)
}
const aggregateFour=Object.fromEntries([...new Set(fourWay.map(p=>p.scene))].map(scene=>{const rows=fourWay.filter(p=>p.scene===scene);return[scene,Object.fromEntries(['L1/current','L2/current','L1/local','L2/local'].map(k=>{const errors=rows.flatMap(p=>p[k].map((v,c)=>v-p.reference[c]));return[k,{mae:mean(errors.map(Math.abs)),rmse:Math.sqrt(mean(errors.map(e=>e*e))),worst:Math.max(...errors.map(Math.abs))}]}))]}))
const budgetSummary=Object.fromEntries(['window','two-rooms','furniture'].map(scene=>{const rows=budget.filter(p=>p.scene===scene&&['floor by window','ceiling','rear wall','second room floor','under table','exposed floor'].includes(p.receiver));return[scene,Object.fromEntries(Object.keys(rows[0].terms).map(term=>[term,{mae:mean(rows.flatMap(p=>p.terms[term].map(Math.abs))),signed:mean(rows.flatMap(p=>p.terms[term]))}]))]}))
writeFileSync(`${root}/metrics.json`,JSON.stringify({fixtures:comparisons.map(r=>r.summary),fourWay:aggregateFour,budget:budgetSummary,house:{baseline:house.baseline.accuracy,candidate:house.candidate.accuracy},differences},null,2))
writeFileSync(`${root}/error-budget.json`,JSON.stringify({budget,probeErrors,fourWay},null,2))
const sources=read('baseline/source.json'),after=Object.fromEntries(Object.keys(sources.files).map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))
assert.equal(after['colin_house_v2.json'],sources.files['colin_house_v2.json'])
writeFileSync(`${root}/source-after.json`,JSON.stringify({files:after,changed:Object.keys(after).filter(p=>after[p]!==sources.files[p]),newProductionFile:'src/indirectSpatialInterpolation.ts'},null,2))
const source=(path,needle)=>{const n=readFileSync(path,'utf8').split('\n').findIndex(l=>l.includes(needle))+1;assert.ok(n);return`[${path}:${n}](../../${path}#L${n})`}
const table=comparisons.map(r=>`| ${r.kind}/${r.variant} | ${r.summary.receivers} | ${fmt(r.summary.before.mae)} → ${fmt(r.summary.after.mae)} | ${fmt(r.summary.before.rmse)} → ${fmt(r.summary.after.rmse)} | ${fmt(r.summary.before.worst)} → ${fmt(r.summary.after.worst)} |`).join('\n')
const reproduction=read('baseline/reference-rooms/results.json'),selection=[['window','ceiling'],['window','rear wall'],['two-rooms','rear wall'],['two-rooms','second room floor'],['two-rooms','exposed floor'],['furniture','under table'],['furniture','exposed floor']]
const b=house.baseline,c=house.candidate,perf=s=>s.performance.cases['unchanged normal renderer'].changed
const navigation=['baseline','candidate'].map(stage=>existsSync(`${root}/${stage}/house/navigation.json`)?read(`${stage}/house/navigation.json`):null)
const thinWall=read('thin-wall.json')
const houseProbe=p=>({source:p.firstPassSourceMAE,capture:mean(p.values.flatMap(v=>v.capturedRaw.map((x,c)=>Math.abs(x-v.referenceRaw[c])))),l1:mean(p.values.flatMap(v=>v.referenceL1.map((x,c)=>Math.abs(x-v.referenceRaw[c])))),l2:mean(p.values.flatMap(v=>v.referenceL2.map((x,c)=>Math.abs(x-v.referenceRaw[c]))))})
const houseProbeMeans=[b,c].map(stage=>{const rows=stage.experiment.probes.map(houseProbe);return Object.fromEntries(['source','capture','l1','l2'].map(k=>[k,mean(rows.map(p=>p[k]))]))})
const report=`# GI spatial accuracy, leakage and occlusion investigation

2 November 2026. The legacy implementation remains the default. The new **occluder-local floor interpolation is opt-in** with <code>?giSpatial=occluder-local</code>. It improves selected furniture receivers without adding probes, bounces, textures or per-frame shader work. It does not fix connected-room overillumination, and the standard-table profile has a small RMSE regression. The evidence does not support enabling it globally.

A separate **spatial leakage defect is reproduced after visibility-weighted texel construction**: across a 6 mm opaque wall, exact receiver irradiance is ${fmt(thinWall.results[0].exactReceiverIrradiance)}, but filtering neighbouring valid floor texels produces ${fmt(thinWall.results[0].filteredFloorIrradiance)}. The candidate also fails. This is an unresolved accuracy failure, not a successful occlusion test. Its correction needs a barrier-aware reconstruction experiment; changing probe weights alone does not fix it.

[Six-camera neutral and authored comparison](index.html), [metrics](metrics.json), [full error budget](error-budget.json), [original source hashes](baseline/source.json), [final source hashes](source-after.json), and retained [legacy](baseline/field-cache.json)/[opt-in](candidate/field-cache.json) field caches.

## Reproduced baseline

The original fixture runner was rerun before solver changes. These values reproduce the previous audit, including its raw texture sampling convention. The subsequent experiments also record the actual shader's normal-offset sampling separately; ceilings/walls can differ from that original diagnostic. Floors use the existing 4 cm floor layer. Values are linear scene-relative RGB-mean irradiance, with gain 1, fill 0 and six passes. Sunlight, sky, materials and geometry were not brightened.

| Fixture / receiver | Production | Reference | Absolute error | Relative error |
|---|---:|---:|---:|---:|
${selection.map(([kind,name])=>{const p=reproduction.find(r=>r.kind===kind).reference.results.find(p=>p.name===name),a=mean(p.productionIrradiance),v=mean(target(p));return`| ${kind}/${name} | ${fmt(a)} | ${fmt(v)} | ${fmt(Math.abs(a-v))} | ${fmt((a-v)/v*100,1)}% |`}).join('\n')}

[Full original rerun](baseline/reference-rooms/results.json). The extended suite has 33 receiver samples across furniture and 25 through the doorway, plus five primary receivers per fixture. Profiles use identical random seeds and reference estimates in both stages. Reported Monte Carlo standard errors remain in each result. Percent errors at dark receivers are not used as the aggregate selection criterion.

## Source, capture, angular and spatial error budget

The same final radiance atlas is independently projected to L1 and L2: no new capture, extra pass, source change or probe relocation. All 26 fixture probes and all 301 house probes are covered by the projection. CPU projection agrees with stored GPU L1 coefficients to ${fmt(Math.max(...probeErrors.map(p=>p.coefficientDifference)),6)} in fixtures and ${fmt(b.projection.maxCoefficientDifference,6)} in Colin (half-float reduction/quantisation differences).

Independent probe integration uses original scene triangles, original reflectance and textures, exact hard source visibility, the same cube quadrature directions and 16 paths per direction in fixtures (8 at ten selected house probes). The independent receiver solver uses 32,768 paths for primary fixture receivers and 8,192 along profiles, with six secondary diffuse bounces. The house retains the previous audit's 39 exact physical receiver positions/normals and independent results: geometry, materials and authored sources are unchanged. This shared reference is not new Monte Carlo evidence and does not depend on either probe field. Mesh emission, secondary normal mapping and specular transport are excluded from the diffuse reference.

The overcast fixtures have wall/ceiling reflectance 0.8, floor 0.35 and furniture 0.65, with geometric normals and no texture/AO maps. Sky radiance is RGB (0.65,0.72,0.82) × (0.5 + direction.y) above the horizon; the known diffuse ground supplies the lower hemisphere. The independent sky snapshot already includes the house's authored gain; a regression checks that the new directional reader does not apply it twice. The affected house probe estimates were regenerated after correcting that test helper. Production lighting and the normalized gain-1 fixture results were unaffected.

Pass convention matters: the six production passes start with a direct/escaped-sky capture, so the overcast six-pass field contains up to five reflected-sky interactions. The independent six-surface-bounce reference retains one further reflected-sky order. This is disclosed rather than changing the historical benchmark or silently raising production bounce count. The capture/feedback budget includes finite-depth truncation as well as reconstruction feedback; its positive excess is not explained by the missing extra order. Probe-reference angular comparisons use identical reference paths and do not depend on this convention.

| Scene | Spatial-only MAE / signed | Added L1 angular MAE / signed | Capture + feedback MAE / signed | Grid + receiver offset MAE / signed |
|---|---:|---:|---:|---:|
${Object.entries(budgetSummary).map(([scene,terms])=>`| ${scene} | ${Object.values(terms).map(t=>`${fmt(t.mae)} / ${fmt(t.signed)}`).join(' | ')} |`).join('\n')}

The budget is telescoping at the same receivers: (independent raw probe irradiance interpolated to the receiver − independent receiver irradiance), then (independent L1 probe reconstruction − raw probe integration), then (production captured L1 − independent L1), then (actual shader-equivalent texture sample − direct probe blend). Signed RGB terms sum exactly to the final error. Absolute term magnitudes do not add because errors can cancel. Capture/feedback includes the upstream effect of spatial and SH approximations during previous diffuse passes; it is not a claim of independent causal variance decomposition.

First-pass escaped-sky radiance is checked independently at the same probe directions. Its mean irradiance discrepancy is ${fmt(mean(probeErrors.map(p=>p.sourceSkyMAE)))}; finite 16×16 rasterisation and aperture silhouettes contribute. The completed incoming-radiance error before SH is ${fmt(mean(probeErrors.map(p=>p.captureRawMAE)))}. Thus otherwise valid probe measurements are not the sole cause: completed captures already contain transport error. At identical independent probe paths, mean angular MAE falls from ${fmt(mean(probeErrors.map(p=>p.l1AngularMAE)))} in L1 to ${fmt(mean(probeErrors.map(p=>p.l2AngularMAE)))} in L2. L2 removes much of the angular error, while spatial errors and feedback remain.

At the ten sampled Colin probes, legacy/opt-in first-pass source MAE is ${fmt(houseProbeMeans[0].source)}/${fmt(houseProbeMeans[1].source)}, completed raw capture MAE is ${fmt(houseProbeMeans[0].capture)}/${fmt(houseProbeMeans[1].capture)}, and independent L1/L2 angular MAE for the legacy positions is ${fmt(houseProbeMeans[0].l1)}/${fmt(houseProbeMeans[0].l2)}. This house source check includes directly lit surface radiance as well as escaped sky; comparing the complete first pass with sky alone would mislabel expected sun/lamp reflection as error. These kitchen/dining probe samples do not provide an exhaustive house-wide transport error budget. All 301 probes are projected for the captured-radiance four-way comparison, while only these ten receive independent directional path integration.

## Spatial experiments and actual full-transport candidate

Every diagnostic uses identical positions, coefficients, support radius and exact BVH segments. Compared methods are nearest visible probe, current compact kernel, same-room restriction, portal-connected visibility and inverse-distance powers 1/2/3. The adopted experiment uses inverse squared distance, regularised over 15 cm, only for floor texels below a nearby downward-facing opaque underside. It excludes structural ceilings using the existing height mask. All other receivers retain the legacy kernel. Visibility still rejects blocked links; geometric support and its existing weak-support attenuation are preserved separately from radiance weights.

${source('src/indirectSpatialInterpolation.ts','indirectLocalFloorReceiver')} contains the opt-in and underside rule. ${source('src/indirectVolume.ts','const localFloorCells=')} caches the geometry classification. ${source('src/indirectVolume.ts','return support')} retains original support; ${source('src/indirectVolume.ts','visibleSupports?.push')} exports equivalent GPU graph weights. ${source('src/indirectFloorLighting.ts','indirectLocalFloorReceiver(field')} covers the CPU floor fallback. The optional GPU preview carries original support in an existing unused link-texture channel, preserving weak-support confidence even when only part of a probe set has been captured; its extra accumulation is compiled only for the opt-in variant. A temporary CPU support array is exported only when this optional graph is requested. The new mode travels through fields, workers and settings, and ${source('src/indirectLightingPersistence.ts','field spatial interpolation differ')} prevents experimental volumes being saved under a legacy settings key.

The following table is the **full six-pass production rerun**, including feedback, not just a post-bake reweighting. All probes and their locations match. No AO is used to conceal occlusion error.

| Fixture | Valid receivers | RGB MAE before → after | RMSE before → after | Worst channel error before → after |
|---|---:|---:|---:|---:|
${table}

The cabinet's footprint contains solid geometry, not an accessible floor receiver; those samples remain in raw evidence and plots but are excluded from the valid-receiver aggregate. They must not be presented as successful lighting measurements. These scene-level furniture meshes are included in the BVH/captures, but the original fixture does not register them as editable model obstacle bounds, so regular probes are not reallocated as they are for authored models. Some low-table/cabinet coverage errors are consequently already present at capture positions. The experiment does not silently add underside probes. The new classifier requires a downward-facing underside; a single opaque sheet wound upward can still occlude BVH links but does not activate local weighting. That unvalidated thin-sheet case retains the legacy rule and is another reason not to promote this experiment as a general furniture solution.

## Two-room leakage

The existing fixture has a physical partition with a doorway but one logical room polygon. Diagnostic same-room labels therefore use the physical x=2.5 m partition; production labels and probe positions remain unchanged. BVH-rejected solid-wall links are retained in results. Visible cross-room weights at the second-room floor are ${fmt(comparisons.find(r=>r.kind==='two-rooms').baseline.points[3].candidates.current.crossRoomWeight*100,1)}%. Those segments pass through the real doorway, and portal restriction reproduces the current result. Banning them can reduce numerical error by throwing away valid light paths; that is not accepted as a physically correct replacement.

![Doorway profile](plots/two-rooms-table.svg)

The floor-only experiment leaves this fixture unchanged. Direct visibility is necessary but does not make incoming radiance spatially constant along that segment: broad kernels borrow window-side radiance through valid openings and low-order angular reconstruction adds light to occluded orientations. Exact visibility blocks a solid wall, yet valid doorway links can still interpolate an inaccurate field. Separate regressions test solid-wall blocking, open-door influence, slabs, open stairwells and navigation-hidden physical geometry. No room label is treated as an occluder.

The extra thin-wall control isolates a different stage: a ${fmt(thinWall.wallThickness*1000,1)} mm wall lies between two valid samples of the ${fmt(thinWall.floorStep*1000,2)} mm floor grid. Exact links reject the far-side bright probe, but bilinear filtering blends valid texels from opposite sides. Legacy and opt-in both return ${fmt(thinWall.results[0].filteredFloorIrradiance)}, versus exact ${fmt(thinWall.results[0].exactReceiverIrradiance)} at the actual receiver. [Raw failing accuracy case](thin-wall.json). The wall remains in the physical BVH; this is not missing geometry. Thus passing segment-visibility tests does not certify the displayed reconstruction against all thin solid boundaries. The ordinary 150 mm partition fixture does not expose this sub-grid case.

## Furniture profile and variants

${comparisons.filter(r=>r.kind==='furniture').map(r=>`### ${r.variant}\n\n![${r.variant} irradiance profile](plots/furniture-${r.variant}.svg)\n\nValid profile RMSE ${fmt(r.summary.profile.before.rmse)} → ${fmt(r.summary.profile.after.rmse)}; largest adjacent production change ${fmt(r.summary.profile.beforeGradient.largestAdjacentJump)} → ${fmt(r.summary.profile.afterGradient.largestAdjacentJump)}. Minimum visible support count ${r.summary.profile.beforeGradient.minimumVisibleProbeCount}. The grey span marks the furniture footprint; the cabinet footprint is not an accessible receiver.`).join('\n\n')}

The standard table's under-table primary receiver changes from ${fmt(mean(comparisons.find(r=>r.kind==='furniture'&&r.variant==='table').baseline.points[3].shaderEquivalent.rgb))} to ${fmt(mean(comparisons.find(r=>r.kind==='furniture'&&r.variant==='table').candidate.points[3].shaderEquivalent.rgb))}, against reference ${fmt(mean(target(comparisons.find(r=>r.kind==='furniture'&&r.variant==='table').baseline.points[3])))}. It becomes darker than the exposed receiver as expected. That local improvement does not erase the small whole-profile regression. Removing the table restores the original field behaviour; raised/lowered/sideways configurations and the cabinet are separate production bakes with the same 26-probe budget. Profiles disclose discontinuities rather than smoothing the plotted data.

Along the profile at z=2.1 m, the independent reference is genuinely brighter at some central under-table positions than at nearby exposed locations. The primary receiver at x=3, z=2.3 m has a different ordering. Uniformly darkening the table footprint is therefore not a general physical correction; the experiment over-darkens part of that central profile. This directly supports the decision to leave it experimental.

## Controlled angular × spatial comparison

All four cells use the same captured incoming radiance; L2's extra coefficients are projected from that atlas. Interpolation is evaluated directly at receiver positions without texture filtering or surface normal bias, so these are representation diagnostics, not four independent feedback bakes. In Colin the entire 301-probe projection is used at the 38 indoor-classified receivers; the exterior-fallback receiver is assessed separately in the GPU check. L2 is not enabled globally; it multiplies coefficient texture storage and blend work by 9/4 and cannot repair missing local measurements.

| Scene | L1/current RMSE | L2/current | L1/local | L2/local |
|---|---:|---:|---:|---:|
${Object.entries(aggregateFour).map(([scene,v])=>`| ${scene} | ${Object.values(v).map(x=>fmt(x.rmse)).join(' | ')} |`).join('\n')}

## Colin visual and accuracy regression

[All six cameras, neutral/authored, signed and absolute HDR differences, independent receiver overlays and probe visibility](index.html). Neutral receivers use the existing clay view: albedo 0.8, roughness 1, geometric normals and no specular/emission on eligible surfaces; transparent glazing is retained. The transport retains authored materials in both views. This isolates receiver-material appearance and is **not** a separate all-neutral transport bake. Camera transforms, geometry, sun, exposure, ambient and bounce gain match. Screen AO is disabled equally for these spatial comparisons. Original half-float HDR compositor buffers accompany every image.

Absolute difference PNGs use 128 byte levels per radiance unit; signed PNGs use neutral grey = 0 and 64 levels per unit. Only diffuse representation/transport changes are varied. Independent overlays are sampled receiver results, not a full reference render. Influence diagrams show exact visible/blocked probe segments in plan.

House ${b.gpu?'GPU production-receiver':'approximate CPU'} MAE: ${fmt(b.accuracy.mae)} → ${fmt(c.accuracy.mae)}; RMSE ${fmt(b.accuracy.rmse)} → ${fmt(c.accuracy.rmse)}; worst channel error ${fmt(b.accuracy.worst)} → ${fmt(c.accuracy.worst)}. The canonical GPU receiver check includes actual mask classification, adjacent-storey blending and exterior-sky fallback, while setting per-mesh corner/mount offsets to zero. In particular, the stairwell floor uses exterior sky, not a missing indoor volume; the raw CPU floor sampler's zero at that point is not an accurate description of its visible shader lighting. The CPU spatial-only rows remain in the evidence for diagnostics. Actual GPU HDR screenshots are authoritative for the complete material/mesh path. Old per-point physical reference data is reused only at the same geometry positions and normals.

## Performance, memory and incremental behaviour

| Measurement | Legacy | Opt-in |
|---|---:|---:|
| Full 301-probe bake, bake-start to completed/exportable | ${fmt(b.status.bakeMs/1000,2)} s | ${fmt(c.status.bakeMs/1000,2)} s |
| First progressive preview after bake start | ${fmt(b.status.gi.firstPreviewMs/1000,2)} s | ${fmt(c.status.gi.firstPreviewMs/1000,2)} s |
| Local 0.25 m window edit, first visible changed field | ${fmt(b.edit.firstUsefulMs/1000,2)} s | ${fmt(c.edit.firstUsefulMs/1000,2)} s |
| Local edit complete | ${fmt(b.edit.elapsedMs/1000,2)} s | ${fmt(c.edit.elapsedMs/1000,2)} s |
| Normal-renderer GPU mean | ${fmt(perf(b).gpuExecutionMeanMs,3)} ms | ${fmt(perf(c).gpuExecutionMeanMs,3)} ms |
| CPU submission mean | ${fmt(perf(b).cpuSubmissionMeanMs,3)} ms | ${fmt(perf(c).cpuSubmissionMeanMs,3)} ms |
| Draw calls / shader programs | ${perf(b).meanDrawCalls} / ${perf(b).programs} | ${perf(c).meanDrawCalls} / ${perf(c).programs} |
| Display volume + floor texture data | ${fmt((b.status.volumeBytes+b.status.floorBytes)/1048576,2)} MiB | ${fmt((c.status.volumeBytes+c.status.floorBytes)/1048576,2)} MiB |
| Existing surface atlas budget | ${fmt(b.status.gi.surfaceCacheBytes/1048576,2)} MiB | ${fmt(c.status.gi.surfaceCacheBytes/1048576,2)} MiB |
| CPU full floor interpolation capacity | ${fmt(b.status.gi.interpolationProfile.floor.capacityBytes/1048576,2)} MiB | ${fmt(c.status.gi.interpolationProfile.floor.capacityBytes/1048576,2)} MiB |

These are measured single runs on ${b.status.renderer}, 999×740, DPR 1, identical normal production shader families, with no diagnostic material hooks. GPU timings use disjoint timer queries; CPU submission is not GPU time. The existing cached-atlas relighting, batching, six progressive publications, generation checks and visibility reuse remain active. The edit reports retain ${b.edit.gi.interpolationProfile.floor.retainedStates}/${c.edit.gi.interpolationProfile.floor.retainedStates} floor visibility states (legacy/candidate), with both reusing compatible graphs. Additional classification storage is one byte per floor lookup cell, plus the smaller preview floor; graph weights and GPU textures have unchanged layouts. No frame shader branch is added. Timings do not demonstrate a speedup, and the requested 2/10/30 second targets are not met by these runs. Main-frame smoothness during active updating is evaluated separately where available, not inferred from a ready-scene GPU mean.

The candidate followed the baseline in the same development environment, so driver/program and file caches differ. The shorter candidate fresh-bake time is not attributed to the interpolation rule. The candidate's stationary local edit is slower. No repeated counterbalanced full-bake performance claim is made.

${navigation.every(Boolean)?`Separate restored-cache runs include an 8-second camera path and three edits. Animation-gap p95 over each complete record is ${fmt(navigation[0].animationGaps.p95Ms,2)}/${fmt(navigation[1].animationGaps.p95Ms,2)} ms (legacy/candidate). Worst gaps are ${fmt(navigation[0].animationGaps.maxMs,1)}/${fmt(navigation[1].animationGaps.maxMs,1)} ms: significant hitches remain. These statistics include periods after camera motion and are not a claim of uninterrupted navigation. The first edit from a restored cache takes ${fmt(navigation[0].firstEdit.elapsedMs/1000,2)}/${fmt(navigation[1].firstEdit.elapsedMs/1000,2)} s, with first changed display at ${fmt(navigation[0].firstEdit.firstUsefulMs/1000,2)}/${fmt(navigation[1].firstEdit.firstUsefulMs/1000,2)} s. Unlike the freshly baked stationary-edit runs, restored scenes have no retained surface atlas/worker visibility cache at the start. The live draw report separates main-scene geometry timing from the compositor and preserves long tasks. After three completed edits, texture counts are ${navigation[0].memoryAfterEachEdit.map(m=>m.textures).join('/')} and ${navigation[1].memoryAfterEachEdit.map(m=>m.textures).join('/')} respectively. This is a short stability check, not an indefinite leak proof. [Legacy live trace](baseline/house/navigation.json), [candidate trace](candidate/house/navigation.json).`:'Live-navigation/repeated-edit measurements are not yet included; no smoothness or long-run memory claim is made.'}

## Rejected approaches and decision

- Global nearest/inverse-distance kernels: can improve one occluded point while worsening window gradients and the second-room doorway receiver; all alternatives remain in raw results.
- Same-room exclusion: removes geometrically valid doorway support and multi-room paths. Portal labels alone are insufficient; the explicit doorway check adds no improvement over the existing exact geometry visibility here.
- L2 globally: strong angular benefit on identical paths, but not a spatial-leak solution; 2.25× coefficient storage/arithmetic and unmeasured full L2 feedback costs do not justify a global default change in this iteration.
- Adaptive reallocation/surface-attached samples: useful next experiments for low furniture and sharp openings, but relocating a fixed budget changes captures, incremental atlas identities and coverage. No validated constant-budget reallocation is claimed here. The current experiment intentionally preserves exact probe locations.
- GPU receiver BVH rays: would add geometry textures, per-fragment traversal and WebGL2 shader work. This experiment changes prepared CPU graph weights and needs no such per-frame feature. No unbenchmarked GPU visibility solution was adopted.

The next targeted candidate should preserve barrier connectivity through the final floor texture filter. Manually filtering four corners would require up to 16 L1 coefficient fetches instead of the current four hardware-filtered fetches, plus barrier metadata. That is a fetch-count estimate, not a measured GPU cost. It should first be prototyped against the retained thin-wall failure and benchmarked on Colin before any production adoption. Coarser room labels cannot describe arbitrary furniture sheets or thin doors, and simply increasing volume resolution is not accepted as a correction here.

The local floor experiment is retained behind a flag for review. **The production default remains legacy.** Thin-wall texture leakage, connected-room excess, strong low-table/cabinet coverage error, angular clamping/feedback, and update-time targets remain unresolved. This is a measurable limited spatial experiment, not a claim that the GI system is now physically accurate.

## Validation and reproduction

[Validation results](validation.json) retain full tests, targeted solid-wall/doorway and navigation-hidden-geometry regressions, cache-key isolation, CPU/GPU-graph equivalence, moved-furniture reuse, build, typecheck and lint. All snapshots and profiles are reproducible from the scripts below. The source project is never saved by the browser tests.

The final full suite has **1,093 passing / 1,096 tests**, with the same three pre-existing geometry failures. All 25 targeted tests pass. The original [30-image shadow/GI/AO isolation matrix](candidate/composition/index.html) also passes on the completed opt-in field: six HDR shadow-additivity checks, no coefficient changes from display switches, and verified packed diagnostic equivalence. [Real GPU preview checks](gpu-preview.json) cover full/partial capture and measured-black edits in both modes with the existing 0.003 tolerance and no coverage mismatch. The rapid-edit cancellation test matches a fresh final field exactly. The production build and scoped lint pass; raw logs are retained in the validation folder.

~~~powershell
# Existing dev server 5180; asset portal 5174.
node tests/browser/lightingCorrectnessRooms.mjs 5180 docs/gi-spatial-accuracy/baseline/reference-rooms
node tests/browser/giSpatialExperiments.mjs 5180 docs/gi-spatial-accuracy/experiments --all
node tests/browser/giSpatialExperiments.mjs 5180 docs/gi-spatial-accuracy/candidate --all --candidate --no-angular
node tests/browser/giSpatialHouse.mjs 5180
node tests/browser/giSpatialHouse.mjs 5180 --candidate
node tests/browser/giSpatialNavigation.mjs 5180
node tests/browser/giSpatialReceiverGPU.mjs 5180
node tests/browser/giSpatialSourceReference.mjs 5180
node tests/browser/giSpatialGpuPreview.mjs 5180
node --experimental-strip-types tests/giSpatialThinWall.mjs
node tests/browser/lightingCorrectnessAudit.mjs 5180 docs/gi-spatial-accuracy/candidate/composition --candidate --restore=tmp/gi-spatial-candidate-cache.json --captures-only --cache-output=tmp/gi-spatial-composition-cache.json
node --experimental-strip-types tests/giSpatialReport.mjs
node tests/giSpatialArtifacts.mjs
~~~
`
writeFileSync(`${root}/report.md`,report)
const gallery=`<!doctype html><meta charset="utf-8"><title>GI spatial comparisons</title><style>body{font:15px system-ui;background:#1c2028;color:#eee;margin:24px}a{color:#9df}.row{display:flex;gap:12px;overflow:auto}figure{margin:0;min-width:300px;flex:1}img{width:100%}figcaption{padding:7px}section{margin:28px 0}</style><h1>GI spatial comparison</h1><p>Legacy and opt-in occluder-local floor interpolation. Same 301 probes, sources, geometry, camera and exposure. AO off. Neutral receiver view preserves authored transport materials.</p><p><a href="report.md">Report</a> · <a href="metrics.json">Numerical comparisons</a></p>${auditCameras.map(camera=>`<section><h2>${camera.id}</h2><code>${JSON.stringify(camera)}</code>${['neutral','authored'].map(mode=>`<h3>${mode}</h3><div class="row">${[['Legacy',`baseline/house/${camera.id}/${mode}.png`],['Opt-in',`candidate/house/${camera.id}/${mode}.png`],['Absolute HDR difference',`comparisons/${camera.id}/${mode}-absolute.png`],['Signed HDR difference',`comparisons/${camera.id}/${mode}-signed.png`]].map(([label,path])=>`<figure><a href="${path}"><img src="${path}"></a><figcaption>${label}</figcaption></figure>`).join('')}</div>`).join('')}<div class="row"><figure><img src="comparisons/${camera.id}/reference-receivers.svg"><figcaption>Independent receiver reference overlay (sampled irradiance)</figcaption></figure><figure><img src="comparisons/${camera.id}/probe-influence.svg"><figcaption>Visible/blocked probe influence</figcaption></figure></div></section>`).join('')}`
writeFileSync(`${root}/index.html`,gallery)
console.log('WROTE spatial report, metrics, telescoping budget, profiles and six-camera gallery')
if(!existsSync(`${root}/validation.json`))writeFileSync(`${root}/validation.json`,JSON.stringify({status:'Final checks pending'},null,2))
