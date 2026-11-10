// Run sequentially so GPU measurements do not contend with another test.
import {spawnSync} from 'node:child_process'
for(const args of [
 ['single','walk','2048','full'],
 ['single','building','2048','full'],
 ['off','building','2048','baseline'],
 ['off','walk','2048','baseline'],
 ['cascaded','building','2048','prepare'],
 ['cascaded','building','1024','prepare'],
]){
 const result=spawnSync(process.execPath,['tests/browser/rendererAudit.mjs',...args],{stdio:'inherit',windowsHide:true})
 console.log('CASE COMPLETE',args.join(' '),'exit',result.status)
 if(result.error)throw result.error
}
