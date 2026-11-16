import assert from 'node:assert/strict'
import { lightingBrowser } from './lightingHarness.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectFileInputFixtureSource } from './projectFileInputFixture.mjs'
import { installRenderLoopPreload } from './renderLoopAuditProbe.mjs'
const roof=process.argv.includes('--roof')
const production=process.argv.includes('--production')
const internal=process.argv.includes('--internal')
const duringPreparation=process.argv.includes('--during-preparation')
const materialName=process.argv.find(a=>a.startsWith('--material='))?.slice('--material='.length)
const projectPath=process.argv.find(a=>a.startsWith('--project='))?.slice('--project='.length)
const savedProject=projectPath?JSON.parse(readFileSync(projectPath,'utf8')):undefined
if(savedProject) {
 if(roof)savedProject.surfaceAssignments=savedProject.surfaceAssignments.filter(a=>a.target.type!=='roof')
 delete savedProject.indirectLighting
 writeFileSync('tmp/roof-material-input.json',JSON.stringify(savedProject))
}
const b=await lightingBrowser()
try {
 if(production)await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installRenderLoopPreload.toString()})();${projectFileInputFixtureSource};window.projectFileFixture=async()=>[{getFile:async()=>new File([${JSON.stringify(readFileSync('tests/fixtures/roofShaderRoom.json','utf8'))}],'roofShaderRoom.house.json')}];window.roofState=()=>loopFind().state;window.roofCreateStage=()=>{let stage;const visit=f=>{if(!f)return;for(let h=f.memoizedState;h;h=h.next){const v=h.memoizedState?.current;if(v?.getClassName?.()==='Stage')stage=v}visit(f.child);visit(f.sibling)};for(const [root]of loopPreload.hook.roots)visit(root.current);return stage}`})
 await b.call('Page.navigate',{url:`http://localhost:${process.argv[2]??5181}/${production?'':`tests/browser/${roof&&!savedProject?'roofShaderPreparation':'materialApplyLatency'}.html${savedProject?'?project=/tmp/roof-material-input.json':''}`}`})
 if(production) {
  await b.wait(`!!document.querySelector('[aria-label="Project menu"]')`)
  await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
  if(savedProject) {
   await b.evaluate('window.projectFileFixture=undefined')
   await b.call('Page.setInterceptFileChooserDialog',{enabled:true})
  }
  await b.evaluate(`[...document.querySelectorAll('.project-menu-dropdown button')].find(b=>b.textContent.trim()==='Load').click()`)
  if(savedProject) {
   const {root}=await b.call('DOM.getDocument')
   const {nodeId}=await b.call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'})
   await b.call('DOM.setFileInputFiles',{nodeId,files:[resolve('tmp/roof-material-input.json')]})
  }
  await b.wait(`!!document.querySelector('[aria-label="2D editing floor"] option[value="${savedProject?.activeFloorId??'5af889f7-1a8e-4bf9-9b9e-1c28acb4f09c'}"]')`)
 }
 await b.wait(duringPreparation?`(()=>{let wall=false;window.roofState?.()?.scene.traverse(o=>{if(o.userData.houseDesignerRole==='wall-engine-render')wall=true});return wall})()`:`!!window.roofState?.()&&roofState().scene.userData.progressiveStartup?.phase==='full'&&!roofState().scene.userData.shaderWarmupPending`,120000)
 console.log('Startup ready',roof?'roof':'wall',await b.evaluate('performance.now()'))
 if(roof&&!savedProject) {
  await b.evaluate(`document.querySelector('[aria-label="Roof tools"]').click()`)
  await b.wait(`!!document.querySelector('[aria-label="Roof shape"]')`)
  for(const point of [{x:1.5,y:1.5},{x:6.5,y:1.5},{x:9.15,y:5.45},{x:5.3,y:9.2}]) {
   await b.evaluate(`(()=>{const n=roofCreateStage().find('Circle').filter(n=>n.isListening()).sort((a,b)=>Math.hypot(a.x()/60-${point.x},a.y()/60-${point.y})-Math.hypot(b.x()/60-${point.x},b.y()/60-${point.y}))[0];if(!n||Math.hypot(n.x()/60-${point.x},n.y()/60-${point.y})>.4)throw Error('anchor');n.fire('click',{evt:new MouseEvent('click')})})()`)
  }
  await b.wait(`!roofState().scene.userData.shaderWarmupPending`,120000)
  await b.evaluate(`[...document.querySelectorAll('.roof-placement-actions button')].find(b=>b.textContent.trim()==='Create').click()`)
  await b.wait(`(()=>{let top=false;roofState().scene.traverse(o=>{if(o.userData.houseDesignerRole==='roof-top')top=true});return top&&!roofState().scene.userData.shaderWarmupPending&&!roofState().scene.userData.indirectScanPending})()`,120000)
  console.log('Roof created')
 }
 await b.evaluate(`window.materialProps=predicate=>{const host=document.getElementById('root'),key=Object.keys(host).find(k=>k.startsWith('__reactContainer$'));let found;const visit=f=>{if(!f)return;if(predicate(f.memoizedProps))found=f.memoizedProps;visit(f.child);visit(f.sibling)};visit(host[key].stateNode.current);return found};
 const p=materialProps(p=>p?.onSelectSurface&&p.floors),f=p.floors[0];if(!p.selectedSurface)p.onSelectSurface(${roof?"{type:'roof',floorId:f.id,roofId:f.roofs[0].id}":internal?"{type:'wall-face',floorId:f.id,wallId:f.walls[0].id,side:1,wallFaces:f.walls.map(w=>({wallId:w.id,side:1}))}":"{type:'wall-face',floorId:f.id,wallId:f.walls[0].id,side:1}"});`)
 await b.wait(`materialProps(p=>p?.onSelectSurface&&p.floors)?.selectedSurface?.type==='${roof?'roof':'wall-face'}'`)
 await b.wait(`!!materialProps(p=>p?.onApplyMaterial)`)
 if(production)await b.evaluate(`window.materialCatalog={surfaceMaterialsById:new Map(materialProps(p=>Array.isArray(p?.surfaceMaterials)).surfaceMaterials.map(m=>[m.id,m]))}`)
 else await b.evaluate(`import('/src/materials/materialCatalog.ts').then(m=>{window.materialCatalog=m;
   const c=document.createElement('canvas');c.width=c.height=8;const ctx=c.getContext('2d');ctx.fillStyle='#a06040';ctx.fillRect(0,0,8,8);const base=c.toDataURL();ctx.fillStyle='#8080ff';ctx.fillRect(0,0,8,8);const normal=c.toDataURL();
   m.registerLocalSurfaceMaterials([{id:'regression-pbr-brick',manufacturer:'Regression',productName:'Brick',category:'tile',materialType:'brick',pbr:{baseColor:'#ffffff',baseColorTextureUrl:base,normalTextureUrl:normal,roughnessTextureUrl:base,${process.argv.includes('--extra-map')?'ambientOcclusionTextureUrl:base,':''}roughness:1}}])
 })`)
 await b.evaluate(`window.materialLongCalls=[];const s=roofState(),gl=s.gl.getContext(),original=gl.getProgramParameter.bind(gl),render=s.gl.render.bind(s.gl);s.gl.render=(scene,...args)=>{window.materialPass={live:scene===s.scene,retained:scene.userData.retainedViewport,prepared:scene.userData.preparedLightingViewport,basic:scene.userData.basicGeometryViewport};try{return render(scene,...args)}finally{window.materialPass=undefined}};gl.getProgramParameter=(...args)=>{const at=performance.now(),result=original(...args),ms=performance.now()-at;if(ms>100)materialLongCalls.push({ms,pass:window.materialPass,draw:window.materialDraw,stack:new Error().stack,key:s.gl.info.programs.find(p=>p.program===args[0])?.cacheKey});return result}`)
 await b.evaluate(`(()=>{const s=roofState(),render=s.gl.renderBufferDirect.bind(s.gl);s.gl.renderBufferDirect=(...args)=>{
   const m=args[3],o=args[4];window.materialDraw={role:o.userData.houseDesignerRole,material:m.customProgramCacheKey()};const result=render(...args);window.materialDraw=undefined;const w=window.materialDisplayWatch,target=s.gl.getRenderTarget();
   if(w&&!w.previewMs&&args[0]===s.camera&&(!target||target.width>8)&&m.color?.getHexString()===w.color)s.scene.traverse(source=>{
     if(source.geometry!==o.geometry)return;const materials=Array.isArray(source.material)?source.material:[source.material];
     const assigned=source.userData.wallMaterialKeys?.some((key,i)=>key.includes(w.id)&&materials[i]?.map===m.map);
     if(assigned&&(!w.textured||m.map))w.previewMs=performance.now()-w.at;
   });
   if(w&&!w.ms&&args[0]===s.camera&&(!target||target.width>8)&&${roof?"o.userData.houseDesignerRole==='roof-top'":"o.userData.houseDesignerRole==='wall-engine-render'&&JSON.stringify(o.userData.wallMaterialKeys).includes(w.id)"}&&
     m.color?.getHexString()===w.color&&(!w.textured||(m.map&&m.normalMap&&m.roughnessMap)))w.ms=performance.now()-w.at;
   return result
 }})()`)
 await b.evaluate(`window.materialProgramsBefore=roofState().gl.info.programs.map(p=>p.cacheKey)`)
 const selections=materialName?await b.evaluate(`[...materialCatalog.surfaceMaterialsById.values()].filter(m=>m.productName===${JSON.stringify(materialName)}).map(m=>m.id)`):process.argv.includes('--extra-map')?['regression-pbr-brick']:process.argv.includes('--catalog')?await b.evaluate(`${JSON.stringify(savedProject?['Slate tiles','Terracotta roof tile','Slate tiles']:roof?['Terracotta roof tile','New Red Brick','Terracotta roof tile']:['New Red Brick','Terracotta roof tile','Reclaimed old bricks','New Red Brick'])}.map(name=>[...materialCatalog.surfaceMaterialsById.values()].find(m=>m.productName===name)?.id)`):['dulux-blush-matt','dulux-timeless-matt','regression-pbr-brick','dulux-green-matt','regression-pbr-brick']
 assert.ok(selections.length,'requested material exists')
 await b.call('Profiler.enable');await b.call('Profiler.start')
 for(const [index,id] of selections.entries()) {
  assert.ok(id,'requested catalog material exists')
  // Distinct near-white tints distinguish this edit from a retained frame of
  // another textured product (both catalog base colours are plain white).
  const tint=roof?`#ffff${(254-index).toString(16)}`:undefined
  await b.evaluate(`window.applyAt=performance.now();window.materialDisplayWatch={id:'${id}',color:${tint?JSON.stringify(tint.slice(1)):`materialCatalog.surfaceMaterialsById.get('${id}').pbr.baseColor.slice(1)`},textured:!!materialCatalog.surfaceMaterialsById.get('${id}').pbr.normalTextureUrl,at:applyAt};materialProps(p=>p?.onApplyMaterial).onApplyMaterial({materialId:'${id}',customColor:${JSON.stringify(tint)},textureScale:1,textureRotation:0,wallSide:${internal?'1':"'both'"},wallMode:'full'})`)
  // Wait for the assignment's preparation, not the preceding ready frame.
  await b.wait(`roofState().scene.userData.shaderWarmupProfile?.some(p=>p.startedAt>=applyAt)`,60000)
  await b.wait(`!roofState().scene.userData.shaderWarmupPending&&!roofState().scene.userData.indirectScanPending`,60000)
  await b.wait('!!materialDisplayWatch.ms',60000)
  const result=await b.evaluate(`({ms:performance.now()-applyAt,visibleMs:materialDisplayWatch.ms,previewVisibleMs:materialDisplayWatch.previewMs,profiles:roofState().scene.userData.shaderWarmupProfile.filter(p=>p.startedAt>=applyAt).map(p=>({stages:p.stages,batches:p.batches}))})`)
  console.log('MEASURE material apply',id,JSON.stringify(result))
  assert.ok(result.ms<(duringPreparation?30000:4000),`${id} completes without losing an edit: ${JSON.stringify(result)}`)
  if(duringPreparation&&!roof)assert.ok(result.previewVisibleMs<4000,'the assigned texture appears while initial lighting is preparing')
  // First use may introduce a real texture/geometry variant. The total latency
  // budget above still applies; switching back must reuse its compiled program.
  if(!duringPreparation&&selections.slice(0,index).includes(id))assert.ok(result.profiles.every(p=>p.batches.every(batch=>batch.readyMs<1000)),`${id} reuses compiled shader variants`)
  console.log('PASS material apply',id,JSON.stringify(result))
 }
 if(process.argv.includes('--patio')) {
  await b.evaluate(`window.patioDrawAt=0;window.patioGeometry=null;const ps=roofState(),pr=ps.gl.renderBufferDirect.bind(ps.gl);ps.gl.renderBufferDirect=(...args)=>{const result=pr(...args),target=ps.gl.getRenderTarget();if(window.patioAt&&!patioDrawAt&&args[0]===ps.camera&&(!target||target.width>8)){
    if(!patioGeometry){const model=materialProps(p=>p?.onSelectSurface&&p.floors).floors[0].models.find(m=>m.modelId===window.patioId),root=model&&ps.scene.getObjectByName('model-transform-'+model.id),geometries=new Set();let vertices=0;root?.traverse(o=>{if(o.isMesh&&o.geometry){let decoration=false;for(let p=o;p;p=p.parent)decoration||=!!p.userData.selectionDecoration;if(!decoration){geometries.add(o.geometry);vertices+=o.geometry.attributes.position?.count??0}}});if(vertices>100)patioGeometry=geometries}
    if(patioGeometry?.has(args[4].geometry))patioDrawAt=performance.now();}return result}`)
  await b.evaluate(`materialProps(p=>p?.onOpenModelSelector).onOpenModelSelector('objects')`)
  await b.wait(`!!materialProps(p=>p?.onSelectModel&&p.models)`)
  await b.evaluate(`(()=>{const p=materialProps(p=>p?.onSelectModel&&p.models);window.patioId=p.models.find(m=>m.wallMount==='patio-door'&&m.id.includes('closed'))?.id??p.models.find(m=>m.wallMount==='patio-door')?.id;if(!patioId)throw Error('No patio door available');p.onSelectModel(patioId)})()`)
  await b.wait(`materialProps(p=>p?.onPlaceModel&&p.placementModel)?.placementModel?.id===patioId`)
  await b.evaluate(`(()=>{const p=materialProps(p=>p?.onPlaceModel&&p.placementModel),f=p.floors[0],w=f.walls[0];window.patioAt=performance.now();p.onPlaceModel({floorId:f.id,position:{x:(w.start.x+w.end.x)/2,y:(w.start.y+w.end.y)/2},rotation:Math.atan2(w.end.y-w.start.y,w.end.x-w.start.x),wallOpeningBottom:0,wallAttachment:{wallId:w.id,offset:Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y)/2,side:1}})})()`)
  await b.wait(`materialProps(p=>p?.onSelectSurface&&p.floors).floors[0].models.some(m=>m.modelId===patioId)`)
  await b.wait(`(()=>{const s=roofState(),p=materialProps(p=>p?.onSelectSurface&&p.floors),m=p.floors[0].models.find(m=>m.modelId===patioId),root=s.scene.getObjectByName('model-transform-'+m.id);let meshes=0;root?.traverse(o=>{if(o.isMesh&&o.geometry.attributes.position?.count>0)meshes++});return meshes>0&&!s.scene.userData.shaderWarmupPending&&!s.scene.userData.indirectScanPending})()`,60000)
  await b.wait('!!patioDrawAt',10000)
  const patio=await b.evaluate(`({ms:performance.now()-patioAt,visibleMs:patioDrawAt-patioAt,profiles:roofState().scene.userData.shaderWarmupProfile.filter(p=>p.startedAt>=patioAt),openings:materialProps(p=>p?.onSelectSurface&&p.floors).floors[0].walls.flatMap(w=>w.openings??[]).length})`)
  console.log('Patio doors ready',JSON.stringify(patio));assert.ok(patio.openings>0);assert.ok(patio.visibleMs<2500,'finished door geometry appears while detailed shading prepares');assert.ok(patio.ms<10000,'detailed door shading completes')
 }
 assert.deepEqual(await b.evaluate('materialLongCalls'),[],'material changes do not block on program inspection')
 assert.deepEqual(b.errors,[])
} finally {
 if(savedProject)writeFileSync('tmp/slate-material-cpu.json',JSON.stringify(await b.call('Profiler.stop').catch(()=>null)))
 writeFileSync('tmp/roof-material-profile.json',JSON.stringify(await b.evaluate(`({body:document.body.innerText,assignments:window.materialProps?.(p=>p?.onSelectSurface&&p.floors)?.surfaceAssignments,before:window.materialProgramsBefore,after:roofState().gl.info.programs.map(p=>p.cacheKey),calls:window.materialLongCalls,profiles:roofState().scene.userData.shaderWarmupProfile,watch:window.materialDisplayWatch,meshes:(()=>{const a=[];roofState().scene.traverse(o=>{if((o.userData.houseDesignerRole?.startsWith('roof-')||o.userData.houseDesignerRole==='wall-engine-render')&&o.material)a.push({role:o.userData.houseDesignerRole,roofId:o.userData.roofId,materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>({color:m.color?.getHexString(),key:m.customProgramCacheKey(),side:m.side,map:!!m.map,normalMap:!!m.normalMap}))})});return a})()})`).catch(()=>null),null,2))
 b.close()
}
