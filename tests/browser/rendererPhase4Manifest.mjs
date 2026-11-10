import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs'
import {relative} from 'node:path'
const out='tmp/renderer-phase4',hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const protectedStart=JSON.parse(readFileSync(`${out}/protected-start.json`,'utf8').replace(/^\uFEFF/,''))
const preserved=protectedStart.map(entry=>({path:relative(process.cwd(),entry.Path).replaceAll('\\','/'),
 sha256:hash(entry.Path),unchanged:hash(entry.Path).toUpperCase()===entry.Hash.toUpperCase()}))
if(preserved.some(p=>!p.unchanged))throw Error('Protected task-start source changed: '+JSON.stringify(preserved.filter(p=>!p.unchanged)))
const files=['src/viewer/ViewerStairs.tsx','src/viewer/viewerStairOcclusion.ts','tests/viewerStairOcclusion.test.ts',
 'tests/browser/rendererAuditPhase4.mjs','tests/browser/rendererAuditPhase4Diagnostics.js',
 'tests/browser/rendererAuditOpeningUniforms.js','tests/browser/rendererAuditStairOcclusion.js',
 'tests/browser/rendererPhase4Telemetry.ps1','tests/browser/rendererPhase4Drift.mjs',
 'tests/browser/summarizeRendererPhase4.mjs','tests/browser/rendererPhase4Dev.mjs',
 'tests/browser/rendererPhase4Manifest.mjs','tests/browser/rendererPhase4Results.mjs','docs/renderer-phase4/REPORT.md'].map(path=>({path,
 kind:path==='src/viewer/ViewerStairs.tsx'?'modified':'new',sha256:hash(path),
 beforeSha256:path==='src/viewer/ViewerStairs.tsx'?hash(`${out}/before/ViewerStairs.tsx`):undefined}))
const artifacts=[]
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
 const path=dir+'/'+entry.name
 if(entry.isDirectory())walk(path)
 else if(path!==`${out}/manifest.json`)artifacts.push({path,bytes:statSync(path).size,
  sha256:/\.(json|csv|js|mjs|ts|tsx|html|md|cpuprofile|png|ps1)$/.test(path)?hash(path):undefined})
}}
walk(out)
writeFileSync(`${out}/manifest.json`,JSON.stringify({generated:new Date().toISOString(),files,preserved,artifacts},null,2))
console.log(JSON.stringify({files:files.length,preserved:preserved.length,artifacts:artifacts.length}))
