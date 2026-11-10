// Isolated N8AO experiment, using the existing renderer audit and full fixture.
// Baseline always invokes upstream transparency with the existing shadow guard.
// Nothing is saved into the authored house or production renderer settings.
import {writeFileSync} from 'node:fs'

export async function installAORecovery(b){
 await b.evaluate(`(async()=>{
  const {getEditorFiber}=await import('/tests/browser/rendererTestModules.ts');
  const find=f=>{if(!f)return;const c=f.memoizedProps?.composer?.current;return c?.passes?c:find(f.child)||find(f.sibling)};
  const composer=find(getEditorFiber()),ao=composer.passes.find(p=>p.renderTransparency);
  const upstream=Object.getPrototypeOf(ao).renderTransparency;
  const production=ao.renderTransparency;
  let reuse=false;
  const experiment=function(renderer){
   const scene=this.scene,matrices=scene.matrixWorldAutoUpdate,shadow=renderer.shadowMap;
   const auto=shadow.autoUpdate,needs=shadow.needsUpdate;
   shadow.autoUpdate=false;shadow.needsUpdate=false;
   if(reuse)scene.matrixWorldAutoUpdate=false;
   try{return upstream.call(this,renderer)}finally{scene.matrixWorldAutoUpdate=matrices;shadow.autoUpdate=auto;shadow.needsUpdate=needs}
  };
  ao.renderTransparency=experiment;
  window.aoRecovery={composer,ao,set(value){reuse=value;if(ao.renderTransparency===production)ao.renderTransparency=experiment},restore(){ao.renderTransparency=production},
   inventory(){let objects=0,materialObjects=0,dwFalse=0,dwTrue=0,arrays=0;const arrayMaterials=[];ao.scene.traverse(o=>{objects++;const m=o.material;if(!m)return;materialObjects++;if(Array.isArray(m)){arrays++;arrayMaterials.push({object:o.name,visible:o.visible,materials:m.map(m=>({name:m.name,type:m.type,transparent:m.transparent,depthWrite:m.depthWrite,opacity:m.opacity,alphaTest:m.alphaTest,alphaMap:!!m.alphaMap}))})}if((m.transparent&&!m.depthWrite&&!o.userData.treatAsOpaque)||o.userData.cannotReceiveAO)dwFalse++;if(m.transparent&&m.depthWrite&&!o.userData.treatAsOpaque)dwTrue++});return{objects,materialObjects,dwFalse,dwTrue,arrays,arrayMaterials,configuration:{...ao.configuration},autoDetectTransparency:ao.autoDetectTransparency,scene:ao.scene.uuid}}
  };
 })()`)
}

export async function runAORecovery(b,report,save,out,name){
 await installAORecovery(b)
 report.aoInventory=await b.evaluate('aoRecovery.inventory()');save()
 try{
  for(const [label,reuse]of report.suite==='ao-pair'?[]:[['baseline-before',false],['matrix-reuse',true],['baseline-after',false]]){
   await b.evaluate(`aoRecovery.set(${reuse})`)
   await b.evaluate('rendererAudit.sample(5000,true)')
   for(const moving of [false,true]){
    const key=`${label}-${moving?'moving':'stationary'}`
    console.log('SAMPLING AO',key)
    const result=await b.evaluate(`rendererAudit.sample(30000,${moving})`)
    report.samples[key]=result;save()
    console.log('MEASURED AO',JSON.stringify({key,fps:result.presentedFPS,p95:result.frameMs.p95,cpu:result.cpuFrameMs.mean,gpu:result.gpuFrameMs.mean}))
   }
   report[label]={operations:await b.evaluate('rendererAudit.countSceneOperations(false)'),
    movingOperations:await b.evaluate('rendererAudit.countSceneOperations(true)'),
    passes:await b.evaluate('rendererAudit.sample(5000,true,true)')};save()
  }
  report.paired={}
  for(const moving of [false,true]){
   console.log('PAIRING AO',moving?'moving':'stationary')
   const result=await b.evaluate(`(async()=>{
    const {pairedRender}=await import('/tests/browser/rendererAuditPair.js');
    const ao=aoRecovery.ao,render=ao.renderTransparency;let transparencyCpu=0;
    ao.renderTransparency=function(...args){const at=performance.now();try{return render.apply(this,args)}finally{transparencyCpu=performance.now()-at}};
    try{return await pairedRender(rendererRecovery.state(),60000,{configure:reference=>aoRecovery.set(!reference),capture:()=>transparencyCpu},${moving})}finally{ao.renderTransparency=render}
   })()`)
   report.paired[moving?'moving':'stationary']=result;save()
   console.log('PAIRED AO',JSON.stringify({moving,cpu:result.pairedOnMinusOff.cpu,gpu:result.pairedOnMinusOff.gpu}))
  }
 }finally{await b.evaluate('aoRecovery.restore()')}
 report.aoFinalInventory=await b.evaluate('aoRecovery.inventory()')
 const shot=await b.call('Page.captureScreenshot',{format:'png'})
 writeFileSync(`${out}/${name}-matrix.png`,Buffer.from(shot.data,'base64'));save()
}
