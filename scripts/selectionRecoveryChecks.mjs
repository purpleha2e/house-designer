import { ESLint } from 'eslint'
import { readFileSync,writeFileSync,readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
const out='tmp/selection-recovery',eslint=new ESLint(),rows=[]
for(const path of ['src/App.tsx','src/components/ModelSelectionHighlight.tsx','src/components/SceneRenderer.tsx','src/components/ThreeDView.tsx','src/shaderWarmupState.ts']){
 const clean=results=>results[0].messages.map(m=>({rule:m.ruleId,severity:m.severity,message:m.message.split('\n')[0]})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
 const before=clean(await eslint.lintText(readFileSync(`${out}/before-source/${path.split('/').at(-1)}`,'utf8'),{filePath:resolve(path)})),after=clean(await eslint.lintText(readFileSync(path,'utf8'),{filePath:resolve(path)}))
 const unmatched=[...before],newDiagnostics=[]
 for(const a of after){const i=unmatched.findIndex(b=>JSON.stringify(a)===JSON.stringify(b));if(i<0)newDiagnostics.push(a);else unmatched.splice(i,1)}
 rows.push({path,before,after,newDiagnostics})
}
writeFileSync(`${out}/lint-comparison.json`,JSON.stringify(rows,null,2))
const baseline=Object.fromEntries(JSON.parse(readFileSync(`${out}/before-hashes.json`,'utf8').replace(/^\uFEFF/,'')).map(row=>[row.path.replaceAll('\\','/'),row.sha256])),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const changed=Object.entries(baseline).filter(([p,h])=>hash(p)!==h).map(([p])=>p)
const files=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(p+'/'+e.name):[p+'/'+e.name])
const added=files('src').filter(p=>!(p in baseline))
writeFileSync(`${out}/source-preservation.json`,JSON.stringify({changed,added,houses:['colin_house_v2.json','springfield_14.json'].map(p=>({path:p,unchanged:hash(p)===baseline[p],sha256:hash(p)}))},null,2))
console.log(JSON.stringify({lint:rows.map(r=>({path:r.path,before:r.before.length,after:r.after.length,new:r.newDiagnostics})),changed,added}))
