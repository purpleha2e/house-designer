import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'

const out=process.env.GI_DIAGNOSTIC_OUT??'docs/furniture-occlusion/baseline',port=process.argv[2]??5180
mkdirSync(out,{recursive:true})
const cachePath=process.argv.find(a=>a.startsWith('--cache='))?.slice(8)??'docs/gi-spatial-accuracy/baseline/field-cache.json',saved=readFileSync(cachePath,'utf8'),b=await lightingBrowser(),cache=JSON.parse(saved),fresh=process.argv.includes('--fresh'),removed=process.argv.includes('--removed'),displacement=process.argv.find(a=>a.startsWith('--displacement='))?.split('=')[1],editOnly=process.argv.includes('--edit-only')
if(fresh)cache.projectKey='furniture-diagnostic-force-fresh'
const save=(name,value)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${JSON.stringify(cache)}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi${removed?'&furniture-occlusion-removed':''}${displacement?'&furniture-occlusion-displacement='+displacement:''}`})
 console.log('LOAD preserved baseline')
 await b.wait('!!window.roofWallScene?.()',120000)
 await b.evaluate(`(async()=>window.furnitureAtlas=(await import('/tests/browser/giSpatialHouse.ts')).attachSpatialAtlas(roofWallScene()))()`)
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 if(fresh){await b.wait('!!roofWallScene().scene.userData.getBakedIndirectLighting?.()',120000);writeFileSync(`${out}/field-cache.json`,JSON.stringify(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()')))}
 console.log('BAKE READY',JSON.stringify(await b.evaluate('({...roofWallScene().scene.userData.indirectLighting})')))
 const timing=await b.evaluate('window.furnitureBakeTiming');if(timing)save('bake-timing',timing)
 await b.evaluate(`(()=>{const s=roofWallScene(),style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);s.gl.setPixelRatio(1);s.invalidate()})()`)
 await b.wait('roofWallScene().gl.domElement.height===740')
 await b.evaluate(`(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.audit=(await import('/tests/browser/furnitureOcclusionDiagnostics.ts')).furnitureOcclusionDiagnostics(roofWallScene())})()`)
 save('provenance',{modelSHA256:createHash('sha256').update(readFileSync('colin_house_v2.json')).digest('hex'),cacheSHA256:createHash('sha256').update(saved).digest('hex'),url:'?colin&materials&kitchen-diagnostics&saved-gi',date:new Date().toISOString()})
 save('baseline-settings',await b.evaluate('audit.status()'))
 const cameras=JSON.parse(readFileSync('docs/colin-contact-shading/verified/cameras.json'))
 save('cameras',cameras)
 const known=JSON.parse(readFileSync('docs/colin-contact-shading/receivers.json'))
 const all=[]
 for(const camera of cameras.filter(c=>process.argv.includes('--profile-only')?false:['kitchen-units','sofa-rear'].includes(c.id))){
  await b.evaluate(`audit.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},65)`)
  for(const [name,gi,mode]of [['GI',true,0],['no-probe-contribution',false,0],['normal',true,10],['irradiance',true,5],['constant-lit',true,9]]){
   const frame=await b.evaluate(`audit.capture(${gi},${mode})`),rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip:rect})
   writeFileSync(`${out}/${camera.id}-${name}.png`,Buffer.from(png.data,'base64'));writeFileSync(`${out}/${camera.id}-${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')))
  }
  const points=known.filter(p=>p.camera===camera.id).map(({name,x,y})=>({name,x,y}))
  const measurements=await b.evaluate(`(async()=>audit.stages(await audit.raster(${JSON.stringify(points)})))()`)
  all.push(...measurements.map(p=>({...p,camera:camera.id})))
  save(`${camera.id}-precision`,measurements);console.log('MEASURE',camera.id,JSON.stringify(measurements.map(p=>({name:p.name,position:p.position,owner:p.owner?.parents,gi:p.shaderIrradiance,exact:p.preFilterAtShaderPosition.rgb}))))
  if(camera.id==='sofa-rear'){
   const seamPixels=[...Array.from({length:13},(_,i)=>({name:`seat-back-${i}`,x:500,y:443+i*2})),...Array.from({length:9},(_,i)=>({name:`left-seat-boundary-${i}`,x:421+i*2,y:510})),...Array.from({length:9},(_,i)=>({name:`armrest-${i}`,x:220+i*3,y:432}))]
   const profile=await b.evaluate(`(async()=>audit.stages(await audit.raster(${JSON.stringify(seamPixels)})))()`);save('sofa-profiles',profile);all.push(...profile.map(p=>({...p,camera:camera.id})))
   save('sofa-triangles',await b.evaluate(`audit.triangleAudit(${JSON.stringify(profile)})`))
   for(const kind of ['basic','wireframe']){await b.evaluate(`audit.sofaMaterial('${kind}')`);const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});writeFileSync(`${out}/sofa-rear-${kind}.png`,Buffer.from(png.data,'base64'))}
  }
 }
 if(!process.argv.includes('--captures-only')){
 const layout=removed?JSON.parse(readFileSync('docs/furniture-occlusion/A-fresh/wall-profile.json')):undefined
 const profile=await b.evaluate(`audit.profile(${layout?JSON.stringify({top:layout.top,bounds:layout.bounds}):''})`);save('wall-profile',profile);all.push(...profile.points.map(p=>({...p,camera:'wall-profile'})));console.log('WALL PROFILE',profile.top,profile.points.length)
 if(!editOnly){await b.evaluate(`window.auditReference=undefined;window.auditReferenceError=undefined;audit.reference(${JSON.stringify(all)},8192,true).then(r=>window.auditReference=r,e=>window.auditReferenceError=String(e));true`)
 const began=Date.now();let last=0
 while(!await b.evaluate('!!window.auditReference||!!window.auditReferenceError')){if(Date.now()-last>15000){console.log('REFERENCE',await b.evaluate('roofWallScene().scene.userData.furnitureReferenceProgress'));last=Date.now()}assert.ok(Date.now()-began<240000,'Reference time bound');await new Promise(r=>setTimeout(r,500))}
 assert.equal(await b.evaluate('window.auditReferenceError'),undefined);save('reference',await b.evaluate('window.auditReference'))}
 if(fresh){await b.evaluate('audit.dispose()');await b.wait('!!roofWallScene().scene.userData.getBakedIndirectLighting?.()',120000);writeFileSync(`${out}/field-cache.json`,JSON.stringify(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()')));await b.evaluate(`(async()=>window.audit=(await import('/tests/browser/furnitureOcclusionDiagnostics.ts')).furnitureOcclusionDiagnostics(roofWallScene()))()`)}
 if(process.argv.includes('--incremental')){
  const generation=await b.evaluate('roofWallScene().scene.userData.indirectLighting.generation');await b.evaluate(`audit.dispose();window.updateRegressionFloors(current=>current.map(f=>({...f,models:f.models.filter(m=>m.id!=='46781408-4e43-455d-971c-4d580142191c')})))`);console.log('REMOVE editor floor-state update')
  await b.wait(`roofWallScene().scene.userData.indirectLighting.generation>${generation}&&(()=>{const s=roofWallScene(),g=s.scene.userData.indirectLighting;return g.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&!g.preparing&&!g.blocked&&!s.scene.userData.shaderWarmupPending&&!s.scene.userData.indirectScanPending})()`,600000)
  await b.wait('!!roofWallScene().scene.userData.getBakedIndirectLighting?.()',120000);writeFileSync(`${out}/incremental-field-cache.json`,JSON.stringify(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()')))
  await b.evaluate(`(async()=>window.audit=(await import('/tests/browser/furnitureOcclusionDiagnostics.ts')).furnitureOcclusionDiagnostics(roofWallScene()))()`)
  save('incremental-settings',await b.evaluate('audit.status()'));const incremental=await b.evaluate(`audit.profile(${JSON.stringify({top:profile.top,bounds:profile.bounds})})`);save('incremental-wall-profile',incremental)
  save('incremental-reference',await b.evaluate(`audit.reference(${JSON.stringify(incremental.points)},8192)`));await b.evaluate('audit.dispose()');await b.wait('!!roofWallScene().scene.userData.getBakedIndirectLighting?.()',120000);writeFileSync(`${out}/incremental-field-cache.json`,JSON.stringify(await b.evaluate('roofWallScene().scene.userData.getBakedIndirectLighting()')))
 }
 }
 save('browser-errors',b.errors);assert.deepEqual(b.errors,[])
 if(!process.argv.includes('--incremental'))await b.evaluate('audit.dispose()')
}catch(error){try{save('failure',{error:String(error),profile:await b.evaluate('roofWallScene()?.scene.userData.furnitureProfileFailure')})}catch{}throw error}finally{b.close()}
