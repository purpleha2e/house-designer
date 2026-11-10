import {spawnSync} from 'node:child_process'
for(const args of [
 ['tests/browser/rendererAudit.mjs','single','walk','2048','full'],
 ['tests/browser/rendererAuditLifecycle.mjs'],
]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',windowsHide:true})
 console.log('CASE COMPLETE',args.join(' '),'exit',result.status)
 if(result.error)throw result.error
}
