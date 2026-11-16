import {lightingBrowser} from '../tests/browser/lightingHarness.mjs'
import {writeFileSync} from 'node:fs'
const b=await lightingBrowser(),report=[]
try {
 await b.call('Page.navigate',{url:'http://localhost:5181/tests/browser/materialApplyLatency.html'})
 await b.wait(`!!window.roofState?.()&&roofState().scene.userData.progressiveStartup?.phase==='full'&&!roofState().scene.userData.shaderWarmupPending`,90000)
 await b.evaluate(`window.materialProps=predicate=>{const host=document.getElementById('root'),key=Object.keys(host).find(k=>k.startsWith('__reactContainer$'));let found;const visit=f=>{if(!f)return;if(predicate(f.memoizedProps))found=f.memoizedProps;visit(f.child);visit(f.sibling)};visit(host[key].stateNode.current);return found};
 const p=materialProps(p=>p?.onSelectSurface&&p.floors),f=p.floors[0];p.onSelectSurface({type:'wall-face',floorId:f.id,wallId:f.walls[0].id,side:1});`)
 await b.wait(`!!materialProps(p=>p?.onApplyMaterial)`)
 await b.evaluate(`import('/src/materials/materialCatalog.ts').then(m=>window.materialCatalog=m)`)
 await b.evaluate(`import('/tests/browser/rendererTestModules.ts').then(m=>{window.materialProgress=m.useProgress;window.materialCanvasProps=predicate=>{let found;const visit=f=>{if(!f)return;if(predicate(f.memoizedProps))found=f.memoizedProps;visit(f.child);visit(f.sibling)};visit(m.getEditorFiber());return found}})`)
 await b.evaluate(`window.materialTasks=[];new PerformanceObserver(list=>materialTasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask'});
 window.materialGlCalls=[];const gl=roofState().gl.getContext();for(const name of ['getProgramParameter','getActiveUniform','getUniformLocation','drawElements','drawArrays','texImage2D']){const fn=gl[name].bind(gl);gl[name]=function(...args){const at=performance.now();const result=fn(...args);const ms=performance.now()-at;if(ms>8)materialGlCalls.push({name,at,ms,param:name==='getProgramParameter'?args[1]:undefined});return result}}
 window.materialKeys=()=>roofState().gl.info.programs.map(p=>({id:p.id,key:p.cacheKey}));`)
 report.push({initialKeys:await b.evaluate('materialKeys()')})
 const ids=await b.evaluate(`[...materialCatalog.surfaceMaterialsById.values()].map(m=>({id:m.id,name:m.productName,pbr:m.pbr}))`)
 console.log('catalog',ids.map(m=>m.name))
 const selections=process.argv.includes('--textures')?['New Red Brick','Terracotta roof tile','Reclaimed old bricks','New Red Brick'].map(name=>ids.find(m=>m.name===name)).filter(Boolean):ids.slice(0,3).concat(ids.slice(0,1))
 for(const m of selections){
  await b.evaluate(`window.materialAppliedAt=performance.now();materialProps(p=>p?.onApplyMaterial).onApplyMaterial({materialId:${JSON.stringify(m.id)},textureScale:1,textureRotation:0,wallSide:'both',wallMode:'full'})`)
  const row={id:m.id,samples:[]};report.push(row);let stable=0
  for(let i=0;i<300;i++){
   const s=await b.evaluate(`(()=>{const s=roofState(),d=s.scene.userData,w=materialCanvasProps(p=>p?.warmupKey&&p.onPendingChange),r=materialCanvasProps(p=>p?.onLightingReady&&'geometryPending' in p);return{ms:performance.now()-materialAppliedAt,pending:d.shaderWarmupPending,scan:d.indirectScanPending,reflection:d.indirectReflectionPending,phase:d.progressiveStartup?.phase,activity:d.viewportPreparation,programs:s.gl.info.programs.length,profile:d.shaderWarmupProfile?.at(-1),gi:d.indirectLighting?.state,gates:{warmup:w?.blocked,display:r?.blocked,geometry:r?.geometryPending,opaque:r?.opaquePending,loader:materialProgress.getState(),status:document.querySelector('[aria-label="3D engine status"]')?.textContent}}})()`)
   row.samples.push(s)
   if(!s.pending&&!s.scan&&!s.reflection&&s.phase==='full'){if(++stable>=5)break}else stable=0
   await new Promise(r=>setTimeout(r,200))
  }
  console.log('apply',m.id,JSON.stringify(row.samples.at(-1)))
  row.keys=await b.evaluate('materialKeys()');writeFileSync('tmp/material-apply-profile-keys.json',JSON.stringify(report,null,2))
 }
 report.push({errors:b.errors,log:await b.evaluate('window.houseDesignerEngineLog?.recent(100)'),tasks:await b.evaluate('materialTasks'),glCalls:await b.evaluate('materialGlCalls')})
}finally{writeFileSync('tmp/material-apply-profile.json',JSON.stringify(report,null,2));b.close()}
