import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {gunzipSync} from 'node:zlib'
import sharp from 'sharp'
import {auditCameras} from './browser/lightingCorrectnessDriver.mjs'
const root='docs/gi-spatial-accuracy',read=p=>JSON.parse(readFileSync(`${root}/${p}`,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex'),unpack=p=>p.encoding==='gzip-base64'?gunzipSync(Buffer.from(p.data,'base64')):Buffer.from(p.data,'base64')
const logs=['gi-spatial-baseline-rooms.log','gi-spatial-experiments-all.log','gi-spatial-candidate-fixtures.log','gi-spatial-house-baseline.log','gi-spatial-house-candidate.log','gi-spatial-navigation.log','gi-spatial-gpu-receivers.log','gi-spatial-source-reference.log','gi-spatial-gpu-preview.log','gi-spatial-composition.log','gi-spatial-unit-tests-final.log','gi-spatial-eslint-final.log','gi-spatial-build-final.log','gi-spatial-targeted-tests-final.log']
mkdirSync(`${root}/validation`,{recursive:true})
for(const log of logs){const bytes=readFileSync(`tmp/${log}`);writeFileSync(`${root}/validation/${log}`,bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,''))}
const log=p=>readFileSync(`${root}/validation/${p}`,'utf8'),summary=p=>Object.fromEntries(['tests','pass','fail'].map(k=>[k,Number(log(p).match(new RegExp(`ℹ ${k} (\\d+)`))?.[1])]))
assert.deepEqual(summary('gi-spatial-unit-tests-final.log'),{tests:1096,pass:1093,fail:3})
assert.deepEqual(summary('gi-spatial-targeted-tests-final.log'),{tests:25,pass:25,fail:0})
assert.equal(log('gi-spatial-eslint-final.log').trim(),'')
const build=log('gi-spatial-build-final.log').match(/built in ([\d.]+)s/);assert.ok(build)
const caches={}
for(const stage of ['baseline','candidate']){
 copyFileSync(`tmp/gi-spatial-${stage}-cache.json`,`${root}/${stage}/field-cache.json`)
 const cache=read(`${stage}/field-cache.json`),status=read(`${stage}/house/status.json`),gpu=read(`${stage}/house/gpu-receivers.json`),projection=read(`${stage}/house/projection.json`),edit=read(`${stage}/house/window-edit.json`),navigation=read(`${stage}/house/navigation.json`)
 assert.equal(cache.layout.probes.length,301);assert.equal(cache.layout.spatialInterpolation,stage==='candidate'?'occluder-local':'legacy');assert.equal(cache.layout.shOrder??1,1)
 assert.equal(status.gi.fullPassPublications,6);assert.equal(status.gi.completed,status.gi.total);assert.equal(status.gi.saved,true);assert.equal(status.diagnosticsLoaded,false)
 assert.equal(gpu.receivers.length,39);assert.equal(gpu.source,'saved');assert.equal(gpu.glError,0);assert.equal(projection.probes.length,301);assert.ok(projection.maxCoefficientDifference<.01)
 for(const p of gpu.receivers)assert.ok(p.rgb.every(Number.isFinite))
 assert.ok(gpu.receivers.some(p=>p.exterior),'exterior fallback is measured rather than passed off as missing GI')
 assert.equal(edit.gi.interpolationProfile.floor.reuseAccepted,true);assert.equal(edit.gi.interpolationProfile.volume.reuseAccepted,true)
 assert.equal(navigation.glError,0);assert.equal(navigation.memoryAfterEachEdit.length,3)
 assert.equal(new Set(navigation.memoryAfterEachEdit.map(m=>m.textures)).size,1,'repeat edits retain stable texture counts')
 caches[stage]={positions:sha(unpack(cache.positions)),mask:sha(unpack(cache.mask)),coefficients:cache.coefficients.map(p=>sha(unpack(p))),volume:sha(unpack(cache.volume)),floor:sha(unpack(cache.floorLayer.data)),settings:{...cache.settings,spatialInterpolation:undefined}}
}
assert.equal(caches.baseline.positions,caches.candidate.positions);assert.equal(caches.baseline.mask,caches.candidate.mask);assert.deepEqual(caches.baseline.settings,caches.candidate.settings)
const composition=read('candidate/composition/results.json'),settings=read('candidate/composition/settings.json'),field=read('candidate/composition/field-checksum.json')
assert.equal(composition.length,6);assert.equal(settings.packedEquivalence.roundingViolations,0);assert.equal(settings.instrumentationEquivalence.roundingViolations,0)
assert.deepEqual(field.coefficients,caches.candidate.coefficients);assert.equal(field.volume,caches.candidate.volume);assert.equal(field.floor,caches.candidate.floor)
const oldReference=JSON.parse(readFileSync('docs/lighting-correctness/verified/reference.json','utf8'))
const sharedReference={...oldReference,sharedReference:{source:'../../../lighting-correctness/verified/reference.json',scope:'Independent physical reference reused at exactly equal receiver positions/normals; no GI coefficient dependence.'},results:composition.flatMap(v=>v.points.filter(p=>!p.unavailable).map(p=>{const old=oldReference.results.find(q=>q.camera===v.camera.id&&q.name===p.name);assert.ok(old);assert.deepEqual(old.position,p.position);assert.deepEqual(old.normal,p.normal);return{...old,...p}}))}
writeFileSync(`${root}/candidate/composition/reference.json`,JSON.stringify(sharedReference,null,2))
const galleryPath=`${root}/candidate/composition/index.html`;writeFileSync(galleryPath,readFileSync(galleryPath,'utf8').replace('href="../production-performance-before.json"','href="../house/performance.json"'))
const images=[]
const verifyImage=async p=>{const file=`${root}/${p}`,metadata=await sharp(file).metadata(),stats=await sharp(file).stats();assert.equal(metadata.width,999);assert.equal(metadata.height,740);assert.ok(stats.channels.slice(0,3).some(c=>c.stdev>1));images.push({file:p,sha256:sha(readFileSync(file))})}
const hdr=p=>{const bytes=gunzipSync(readFileSync(`${root}/${p}`));assert.equal(bytes.length,999*740*8);for(let i=0;i<bytes.length;i+=2)assert.notEqual((bytes.readUInt16LE(i)>>>10)&31,31,'finite HDR');return bytes}
for(const stage of ['baseline','candidate'])for(const camera of auditCameras)for(const mode of ['neutral','authored']){await verifyImage(`${stage}/house/${camera.id}/${mode}.png`);hdr(`${stage}/house/${camera.id}/${mode}.rgba16f.gz`)}
for(const r of composition){
 assert.equal(r.shadowAdditivity.violations,0)
 for(const mode of ['A','B','C','D','E']){
  const u=r.configurations[mode].unchanged;for(const k of ['generationUnchanged','facesUnchanged','fieldSame','coefficientsUnchanged','packedBound'])assert.equal(u[k],true)
  await verifyImage(`candidate/composition/${r.camera.id}/${mode}.png`);hdr(`candidate/composition/${r.camera.id}/${mode}.rgba16f.gz`)
 }
}
const preview=read('gpu-preview.json');assert.equal(preview.length,2);assert.ok(preview.find(p=>p.mode==='occluder-local').localCells>0)
for(const r of preview)for(const p of r.results)for(const k of ['volume','floor']){assert.ok(p[k].error<=.003);assert.equal(p[k].coverage,0)}
const cancellation=read('candidate/cancellation.json');assert.equal(cancellation.cancellation.maxError,0);assert.equal(cancellation.cancellation.interrupted,true)
const metrics=read('metrics.json');assert.equal(metrics.fixtures.length,9);for(const p of metrics.fixtures)assert.equal(p.probes,26)
assert.equal(metrics.fixtures.find(p=>p.kind==='sealed').after.worst,0)
const thinWall=read('thin-wall.json');assert.ok(thinWall.results.every(r=>r.filteredFloorIrradiance>r.exactReceiverIrradiance+.1),'retain the known post-filter thin-wall failure, not a false correctness pass')
let links=0
for(const file of ['report.md','index.html','candidate/composition/index.html']){
 const content=readFileSync(`${root}/${file}`,'utf8'),refs=file.endsWith('.md')?[...content.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]):[...content.matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1])
 for(const ref of refs){if(/^(https?:|data:|#)/.test(ref))continue;assert.ok(existsSync(resolve(dirname(`${root}/${file}`),ref.split('#')[0])),`${file}: ${ref}`);links++}
 assert.ok(!content.includes('#L0'))
}
const validation={date:'2026-11-02',decision:'Opt-in experiment only; legacy remains default. Accuracy and performance targets are not certified.',unit:summary('gi-spatial-unit-tests-final.log'),targeted:summary('gi-spatial-targeted-tests-final.log'),preexistingFailures:['inter-storey internal roof clipping','Springfield loft roof/slab preservation','reused spindle Cylinder topology/UVs'],knownAccuracyFailures:{thinWallFilter:thinWall.results,standardTableProfile:'RMSE increases slightly despite improving one under-table receiver',twoRoomExcess:'Unresolved'},build:{passed:true,viteSeconds:Number(build[1]),includesTypecheck:true},scopedLint:{passed:true,log:'validation/gi-spatial-eslint-final.log'},fixtureBakes:18,fixtureProbeCount:26,houseFullBakes:2,houseProbeCount:301,passes:6,identicalHouseProbePositions:true,identicalHouseMasks:true,authoredSettingsUnchanged:true,caches,houseReceiverGPU:39,houseL2ProjectionProbes:301,optionalGPUPreview:{modes:2,coverageMismatches:0,toleranceUnchanged:.003},rapidEditCancellation:{interrupted:true,finalFieldMaximumError:0},composition:{cameras:6,configurations:5,shadowAdditivityViolations:0,coefficientChangesFromDisplaySwitches:0},imagesChecked:images.length,localLinksChecked:links,images}
writeFileSync(`${root}/validation.json`,JSON.stringify(validation,null,2))
console.log('PASS spatial evidence:',images.length,'scene PNGs and finite HDR buffers,',links,'local links, exact field/cache invariants; validation.json written')
