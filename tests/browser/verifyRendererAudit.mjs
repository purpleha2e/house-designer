import {readFileSync,existsSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const pointer=JSON.parse(readFileSync('tmp/renderer-recovery/backup.json','utf8').replace(/^\uFEFF/,''))
const manifest=JSON.parse(readFileSync(pointer.backup+'/manifest.json','utf8').replace(/^\uFEFF/,''))
const changed=[],missing=[],authored=[]
for(const item of manifest){
 if(!existsSync(item.path)){missing.push(item.path);continue}
 const actual=createHash('sha256').update(readFileSync(item.path)).digest('hex').toUpperCase()
 if(actual!==item.sha256)changed.push(item.path)
 if(item.path==='colin_house_v2.json')authored.push({path:item.path,before:item.sha256,after:actual,unchanged:actual===item.sha256})
}
const head=(process.argv[2]??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'})).trim()
const report={backup:pointer.backup,filesChecked:manifest.length,head,headUnchanged:head===pointer.head,changedSinceRecoveryBackup:changed,missingSinceBackup:missing,authoredProjects:authored,
 newTaskFiles:['src/rendererRecovery.ts','src/rendererHealth.ts','tests/rendererRecovery.test.ts','tests/rendererHealth.test.ts','tests/browser/rendererRecovery.html','tests/browser/rendererRecovery.tsx','tests/browser/rendererRecovery.mjs','tests/browser/rendererAudit.mjs','tests/browser/rendererAuditProbe.js','tests/browser/rendererAuditPair.js','tests/browser/rendererAuditNative.js','tests/browser/rendererAuditMatrix.mjs','tests/browser/rendererAuditFinish.mjs','tests/browser/rendererAuditLifecycle.mjs','tests/browser/summarizeRendererAudit.mjs','tests/browser/verifyRendererAudit.mjs']}
writeFileSync('tmp/renderer-audit/preservation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
if(!report.headUnchanged||authored.some(a=>!a.unchanged)||missing.length)process.exitCode=1
