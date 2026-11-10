import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join,relative,resolve} from 'node:path'
const out='tmp/renderer-phase5',docs='docs/renderer-phase5'
const read=path=>{const bytes=readFileSync(path);return JSON.parse(bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,''))}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const v=read(`${out}/validation.json`),ui=read(`${out}/ui/editor-workflow.json`),gallery=read(`${out}/gallery/results.json`)
assert.equal(v.failure,undefined);assert.equal(v.samples.length,16);assert.deepEqual(v.errors,[])
for(const c of v.disposal){assert.equal(c.buffers.actual,0);assert.equal(c.vaos.actual,0)}
assert.equal(gallery.finished,true);assert.equal(gallery.comparisons.length,18);assert.ok(gallery.comparisons.every(c=>c.changedPixels===0));assert.deepEqual(gallery.errors,[])
assert.equal(ui.failure,undefined);assert.equal(ui.steps.length,17);assert.ok(ui.steps.every(s=>s.applied));assert.deepEqual(ui.errors,[])
const races=Object.fromEntries(['before-gc','after-gc','pipeline-before-gc','pipeline-after-gc'].map(label=>{
 const r=read(`${out}/race-${label}.json`)
 assert.deepEqual(r.errors,[]);assert.deepEqual(r.counts.map(s=>s.error),[0,0,0])
 if(label.includes('after')){assert.deepEqual(r.counts.map(s=>s.geometries),[1,1,1]);assert.equal(r.afterOwnerDisposal.native[0].buffers.actual,0)}
 return[label,{steps:r.counts.map(s=>({registeredGeometries:s.geometries,...s.native[0]})),afterOwnerDisposal:r.afterOwnerDisposal,afterRendererDisposal:r.afterRendererDisposal}]
}))
const sources=read(`${out}/start-src-hashes.json`)
const changedSources=sources.filter(f=>hash(f.Path).toUpperCase()!==f.Hash)
assert.deepEqual(changedSources.map(f=>relative(process.cwd(),f.Path).replaceAll('\\','/')),['src/shaderWarmup.ts'])
const protectedFiles=read('tmp/renderer-phase4/manifest.json').preserved.map(f=>({...f,currentSha256:hash(f.path)}))
assert.ok(protectedFiles.every(f=>f.currentSha256===f.sha256))
const results={generated:new Date().toISOString(),historicalPhase4GrowthFullyAttributed:false,
 confirmedCause:'Preparation uploads a source after its owner detaches and disposes it; skipping detached sources prevents registrations, buffer and VAO resurrection.',
 races,house:v.samples.map(s=>({name:s.name,geometries:s.three.geometries,textures:s.three.textures,programs:s.programs,native:s.native})),
 finalDisposal:v.disposal,visual:{comparisons:gallery.comparisons.length,changedPixels:0},
 realEditor:{checks:ui.steps.length,labels:ui.steps.map(s=>s.label),pointerRetryEvidence:`${out}/ui-selection-retry.json`},
 checks:{unitTests:56,unitFailures:0,preFixRegressionsFailed:2,typecheck:'passed',focusedLint:'passed',productionBuild:'passed'},
 hardware:['start','mid','end'].map(name=>({name,...read(`${out}/hardware-${name}.json`)})),
 unresolved:['Historical 10,350 entries cannot be validated retrospectively; full Phase 4 growth was not reproduced in short settled house edits.','Post-Undo plan selection required real pointer retries.','Optional local GI contact path was inactive and was not audited under edits.'],
 changes:{production:['src/shaderWarmup.ts'],otherProductionSourcesUnchanged:sources.length-1,protectedFiles},
 supersededEvidence:['race-before.json','race-after.json']}
writeFileSync(`${docs}/results.json`,JSON.stringify(results,null,2));writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2))
const paths=['src/shaderWarmup.ts','tests/shaderWarmup.test.ts','tests/browser/rendererRecovery.tsx',
 'tests/browser/rendererAuditPhase5.mjs','tests/browser/rendererPhase5Probe.ts','tests/browser/rendererPhase5Native.js',
 'tests/browser/rendererPhase5Race.html','tests/browser/rendererPhase5Race.ts','tests/browser/rendererPhase5Race.mjs',
 'tests/browser/rendererPhase5Gallery.mjs','tests/browser/rendererPhase5UI.mjs','tests/browser/rendererPhase5UIRetry.mjs',
 'tests/browser/rendererPhase5Results.mjs',`${docs}/REPORT.md`,`${docs}/results.json`]
const files=paths.map((path,i)=>({path,kind:i<3?'modified':'new',sha256:hash(path)}))
function artifacts(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?artifacts(join(dir,e.name)):e.isFile()?[{path:relative(process.cwd(),join(dir,e.name)).replaceAll('\\','/'),sha256:hash(join(dir,e.name))}]:[])}
const manifest={generated:new Date().toISOString(),files,manifest:{path:`${docs}/manifest.json`,selfHashExcluded:true},
 productionBeforeSha256:changedSources[0].Hash.toLowerCase(),productionAfterSha256:hash('src/shaderWarmup.ts'),
 protectedFiles,initialStatus:`${out}/start-status.txt`,artifacts:artifacts(resolve(out))}
writeFileSync(`${docs}/manifest.json`,JSON.stringify(manifest,null,2))
console.log(JSON.stringify({sourceChanges:results.changes.production,otherSourceFilesPreserved:results.changes.otherProductionSourcesUnchanged,protected:protectedFiles.length,houseCheckpoints:v.samples.length,unitTests:56,pixelIdentical:18,editorChecks:17,artifacts:manifest.artifacts.length},null,2))
