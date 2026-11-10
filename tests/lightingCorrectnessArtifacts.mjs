import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
import {gunzipSync} from 'node:zlib'
import sharp from 'sharp'

const root='docs/lighting-correctness',read=p=>JSON.parse(readFileSync(`${root}/${p}`,'utf8'))
const logs=['lighting-correctness-unit-tests.log','lighting-correctness-unit-tests-final.log','lighting-correctness-targeted-tests.log','lighting-physical-visibility-tests.log','lighting-surface-visibility-before.log','lighting-surface-visibility-after.log','lighting-correctness-build-final.log','lighting-correctness-eslint-final.log','lighting-correctness-typecheck-final.log']
mkdirSync(`${root}/validation`,{recursive:true})
for(const log of logs){const bytes=readFileSync(`tmp/${log}`);writeFileSync(`${root}/validation/${log}`,bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,''))}
const summary=log=>Object.fromEntries(['tests','pass','fail'].map(k=>[k,Number(readFileSync(`${root}/validation/${log}`,'utf8').match(new RegExp(`ℹ ${k} (\\d+)`))?.[1])]))
assert.deepEqual(summary(logs[0]),{tests:1083,pass:1080,fail:3})
assert.deepEqual(summary(logs[1]),{tests:1087,pass:1084,fail:3})
assert.equal(summary(logs[2]).fail,0)
assert.equal(summary(logs[3]).fail,0)
assert.equal(summary(logs[4]).fail,3)
assert.equal(summary(logs[5]).fail,0)
assert.match(readFileSync(`${root}/validation/${logs[6]}`,'utf8'),/built in 12\.28s/)
for(const log of logs.slice(7))assert.equal(readFileSync(`${root}/validation/${log}`,'utf8').trim(),'','final successful lint/typecheck commands emitted no errors')
const checked=[]
for(const stage of ['baseline','verified']){
 const results=read(`${stage}/results.json`),settings=read(`${stage}/settings.json`)
 assert.equal(results.length,6)
 assert.equal(settings.packedEquivalence.roundingViolations,0)
 assert.equal(settings.instrumentationEquivalence.roundingViolations,0)
 for(const r of results){
  assert.equal(r.shadowAdditivity.violations,0)
  for(const mode of ['A','B','C','D','E']){
   const unchanged=r.configurations[mode].unchanged
   for(const k of ['fieldSame','coefficientsUnchanged','generationUnchanged','facesUnchanged','packedBound'])assert.equal(unchanged[k],true)
   assert.equal(unchanged.uniformHeight,unchanged.packedHeight)
   const p=`${root}/${stage}/${r.camera.id}/${mode}.png`,image=sharp(p),metadata=await image.metadata(),stats=await image.stats()
   assert.equal(metadata.width,999);assert.equal(metadata.height,740)
   assert.ok(stats.channels.slice(0,3).some(c=>c.stdev>1),'scene image has visible variation')
   const hdr=gunzipSync(readFileSync(p.replace('.png','.rgba16f.gz')))
   assert.equal(hdr.length,999*740*8)
   for(let i=0;i<hdr.length;i+=2)assert.notEqual((hdr.readUInt16LE(i)>>>10)&31,31,'finite half-float HDR')
   checked.push({file:p.slice(root.length+1),sha256:createHash('sha256').update(readFileSync(p)).digest('hex')})
  }
  for(const pair of ['A-B','B-C','B-D','D-E'])for(const kind of ['linear','display']){
   const p=`${root}/${stage}/${r.camera.id}/${pair}-${kind}`
   assert.ok(existsSync(`${p}.png`))
   assert.equal(gunzipSync(readFileSync(`${p}.rgb32f.gz`)).length,999*740*3*4)
  }
 }
}
const before=read('baseline/field-checksum.json'),after=read('verified/field-checksum.json'),bake=read('verified/fresh-bake.json'),reference=read('verified/reference.json'),performance=read('production-performance.json'),seam=read('sky-seam/after.json')
assert.equal(before.positions,after.positions);assert.equal(before.mask,after.mask)
assert.equal(after.probes,301);assert.equal(after.captureVisibilityVersion,1)
assert.equal(bake.fullPassPublications,6);assert.equal(bake.completed,bake.total)
assert.equal(bake.reusedProbes,0);assert.equal(bake.saved,true)
assert.equal(reference.results.length,39)
assert.ok(reference.results.every(p=>!p.identity.unresolved))
assert.equal(seam.results.length,20);assert.equal(seam.maxError,0)
assert.equal(performance.diagnosticsLoaded,false);assert.equal(performance.generationUnchanged,true)
for(const c of Object.values(performance.cases))for(const k of ['before','changed','after'])assert.equal(c[k].glError,0)
const files=['report.md','baseline/index.html','verified/index.html']
let links=0
for(const p of files){
 const contents=readFileSync(`${root}/${p}`,'utf8')
 const refs=p.endsWith('.md')?[...contents.matchAll(/\]\(([^)]+)\)/g)].map(x=>x[1]):[...contents.matchAll(/(?:href|src)="([^"]+)"/g)].map(x=>x[1])
 for(const ref of refs){if(/^(https?:|#)/.test(ref))continue;assert.ok(existsSync(resolve(dirname(`${root}/${p}`),ref.split('#')[0])),`${p} link exists: ${ref}`);links++}
 assert.ok(!contents.includes('#L0'),'source links resolve to actual lines')
}
const validation={date:'2026-11-02',unitBefore:summary(logs[0]),unitAfter:summary(logs[1]),preexistingFailures:['inter-storey internal roof clipping','Springfield loft roof/slab preservation','reused spindle Cylinder topology/UVs'],targetedLighting:summary(logs[2]),physicalVisibilityAndPersistence:summary(logs[3]),physicalRegressionBefore:summary(logs[4]),physicalRegressionAfter:summary(logs[5]),build:{passed:true,seconds:12.28,log:`validation/${logs[6]}`},matrices:{stages:2,camerasPerStage:6,configurationsPerCamera:5,screenshots:checked.length,signedDifferencePairsPerStage:24,hdrAndDisplay:true,fieldUnchangedWithinEachStage:true,allHDRFinite:true,samplerBindingsChecked:true},reference:{receivers:39,sharedBaselineReferenceAtExactlyEqualPositionsAndNormals:true,accuracyCertified:false},skySeam:{cases:20,maxErrorBefore:read('sky-seam/before.json').maxError,maxErrorAfter:seam.maxError},bake:{probes:301,passes:6,identicalBeforeAfterPositions:true,identicalBeforeAfterMasks:true,reusedProbes:0},normalProduction:{diagnosticsLoaded:false,generationUnchanged:true,glErrors:0},linksChecked:links,screenshots:checked}
validation.typecheck={passed:true,command:'npx tsc -b --pretty false',log:'validation/lighting-correctness-typecheck-final.log'}
validation.lint={passed:true,scope:'Five corrected production files, modified persistence/visibility tests, lightingCorrectness harness/report/verification scripts and physical reference snapshot; whole-repository lint is not certified.',log:'validation/lighting-correctness-eslint-final.log'}
writeFileSync(`${root}/validation.json`,JSON.stringify(validation,null,2))
console.log('PASS artifact verification:',checked.length,'scene screenshots, HDR/differences, invariants,',links,'local links; validation.json written')
console.log('Artifact bytes:',checked.reduce((s,p)=>s+statSync(`${root}/${p.file}`).size,0),'for scene PNGs')
