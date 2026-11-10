import assert from 'node:assert/strict'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'

const port=process.argv[2]??5180,out='docs/furniture-occlusion/sofa-reference',b=await lightingBrowser();mkdirSync(out,{recursive:true})
const save=(name,value)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2))
try{
 const cache=readFileSync('docs/furniture-occlusion/A-fresh/field-cache.json','utf8')
 await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${cache}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi`})
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 await b.evaluate(`(()=>{const style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);roofWallScene().gl.setPixelRatio(1);roofWallScene().invalidate()})()`)
 await b.wait('roofWallScene().gl.domElement.height===740')
 await b.evaluate(`(async()=>window.audit=(await import('/tests/browser/furnitureOcclusionDiagnostics.ts')).furnitureOcclusionDiagnostics(roofWallScene()))()`)
 const cameras=JSON.parse(readFileSync('docs/furniture-occlusion/reproduction/cameras.json'))
 const all=[]
 for(const camera of cameras.filter(c=>['sofa-rear','kitchen-units'].includes(c.id))){
  await b.evaluate(`audit.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},65)`)
  const previous=JSON.parse(readFileSync(`docs/furniture-occlusion/reproduction/${camera.id}-precision.json`)),profile=camera.id==='sofa-rear'?JSON.parse(readFileSync('docs/furniture-occlusion/reproduction/sofa-profiles.json')):[],pixels=[...previous,...profile].map(({name,x,y})=>({name,x,y}))
  if(camera.id==='sofa-rear')pixels.push(...[{x:212,y:452},{x:218,y:463},{x:790,y:440},{x:780,y:420}].map((p,i)=>({...p,name:`armrest-patch-${i}`})))
  const points=await b.evaluate(`(async()=>audit.stages(await audit.raster(${JSON.stringify(pixels)})))()`);save(camera.id,points);all.push(...points.map(p=>({...p,camera:camera.id})))
  for(const [name,gi]of [['GI',true],['no-probe-contribution',false]]){await b.evaluate(`audit.capture(${gi})`);const rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()'),png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});writeFileSync(`${out}/${camera.id}-${name}.png`,Buffer.from(png.data,'base64'))}
  if(camera.id==='sofa-rear'){save('triangles',await b.evaluate(`audit.triangleAudit(${JSON.stringify(points)})`));save('topology',await b.evaluate('audit.sofaTopology()'));save('small-bias-candidate',await b.evaluate(`(async()=>audit.stages(await audit.raster(${JSON.stringify(pixels)},undefined,true)))()`))}
 }
 await b.evaluate(`window.auditReference=undefined;window.auditReferenceError=undefined;audit.reference(${JSON.stringify(all)},16384).then(r=>window.auditReference=r,e=>window.auditReferenceError=String(e));true`)
 const start=Date.now();let last=0
 while(!await b.evaluate('!!window.auditReference||!!window.auditReferenceError')){if(Date.now()-last>15000){console.log('REFERENCE',await b.evaluate('roofWallScene().scene.userData.furnitureReferenceProgress'));last=Date.now()}assert.ok(Date.now()-start<240000);await new Promise(r=>setTimeout(r,500))}
 assert.equal(await b.evaluate('window.auditReferenceError'),undefined);save('reference',await b.evaluate('window.auditReference'));save('settings',await b.evaluate('audit.status()'))
 await b.evaluate(`audit.dispose();true`)
 await b.evaluate(`(async()=>window.performanceView=(await import('/tests/browser/giSpatialHouse.ts')).spatialHouseView(roofWallScene()))()`)
 const camera=cameras.find(c=>c.id==='kitchen-units');await b.evaluate(`performanceView.setCamera(${JSON.stringify(camera.position)},${JSON.stringify(camera.lookAt)},65)`)
 save('normal-frame-performance',await b.evaluate('performanceView.performance()'));await b.evaluate('performanceView.dispose()');assert.deepEqual(b.errors,[]);console.log('PASS sofa reference and normal frame timing')
}finally{b.close()}
