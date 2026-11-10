import {readFileSync,writeFileSync,readdirSync,statSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
const out='tmp/renderer-phase3',hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const existing={
 'src/shaderDiagnostics.ts':'shaderDiagnostics.ts','src/importedModelBatching.ts':'importedModelBatching.ts',
 'tests/browser/lightingHarness.mjs':'lightingHarness.mjs','tests/browser/rendererAuditNative.js':'rendererAuditNative.js',
 'tests/browser/rendererRecovery.tsx':'rendererRecovery.tsx','tests/browser/rendererAuditLifecycle.mjs':'rendererAuditLifecycle.mjs',
 'tests/browser/sceneEditRegression.mjs':'sceneEditRegression.mjs','tests/browser/sceneEditUI.mjs':'sceneEditUI.mjs'
}
const fresh=['src/rendererUniformArrays.ts','tests/rendererUniformArrays.test.ts',
 'tests/rendererUniformArraysExperiment.test.mjs','tests/rendererWindowBatchExperiment.test.mjs',
 'tests/browser/rendererAuditBuild.mjs','tests/browser/rendererAuditPhase3.mjs','tests/browser/rendererAuditMainScene.js',
 'tests/browser/rendererAuditFeatures.js','tests/browser/rendererAuditUniformArrays.js','tests/browser/rendererAuditWindowBatch.js',
 'tests/browser/summarizeRendererPhase3.mjs','tests/browser/reportRendererPhase3.mjs','tests/browser/rendererPhase3Manifest.mjs',
 'docs/renderer-phase3/REPORT.md']
// rendererAuditPair predates Phase 3; its previous dirty contents were not
// snapshotted separately. Attribute only the explicitly documented edits.
const files=[...Object.entries(existing).map(([path,before])=>({path,kind:'modified',beforeSha256:hash(`${out}/before/${before}`),sha256:hash(path)})),
 {path:'tests/browser/rendererAuditPair.js',kind:'modified',sha256:hash('tests/browser/rendererAuditPair.js'),changes:'Optional ON/OFF/OFF/ON counterbalance; record paired draw/triangle deltas.'},
 ...fresh.map(path=>({path,kind:'new',sha256:hash(path)}))]
const preserved={
 'src/App.tsx':'App.tsx','src/components/ThreeDView.tsx':'ThreeDView.tsx','src/ambientOcclusionResources.ts':'ambientOcclusionResources.ts',
 'src/components/WindowMesh.tsx':'WindowMesh.tsx','src/windowGeometry.ts':'windowGeometry.ts','src/roomLightShader.ts':'roomLightShader.ts',
 'tests/browser/rendererAuditProbe.js':'rendererAuditProbe.js'
}
const checks=Object.entries(preserved).map(([path,before])=>({path,sha256:hash(path),unchanged:hash(path)===hash(`${out}/before/${before}`)}))
checks.push({path:'colin_house_v2.json',sha256:hash('colin_house_v2.json'),unchanged:hash('colin_house_v2.json').toUpperCase()==='D2851C7E2F1C790595BDA4E1E1A4C3617C619C786A58DCE3205D45B365667870'})
if(checks.some(c=>!c.unchanged))throw Error('Protected source changed: '+JSON.stringify(checks.filter(c=>!c.unchanged)))
const artifacts=[]
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())walk(path);else if(!path.endsWith('/manifest.json'))artifacts.push({path,bytes:statSync(path).size})}}
walk(out)
writeFileSync(`${out}/manifest.json`,JSON.stringify({generated:new Date().toISOString(),files,preserved:checks,artifacts},null,2))
writeFileSync(`${out}/files.md`,'Changes are relative to the dirty working tree at task start, not Git HEAD.\n\n'+files.map(f=>`- ${f.path} (${f.kind})`).join('\n')+'\n\nProduction behaviour changes only in rendererUniformArrays.ts and its one-time shaderDiagnostics.ts setup call. The importedModelBatching.ts addition exposes the existing source marker solely for the disabled batching experiment. All other code changes are audit tooling, regressions or reporting. rendererAuditProbe.js is byte-for-byte unchanged.\n\nProtected-source hashes, changed-source hashes and the exact generated artifact path/size list are in [manifest.json](../../tmp/renderer-phase3/manifest.json). Generated evidence includes immutable production build snapshots, sourcemaps, JSON/CSV/CPU profiles, screenshots/differences, source backups and the receiver-plane counterexample. Existing user changes and experimental files were preserved.\n')
console.log(JSON.stringify({changedFiles:files.length,preserved:checks.length,artifacts:artifacts.length}))
