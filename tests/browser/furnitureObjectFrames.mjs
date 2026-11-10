import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const port=process.argv[2]??5181,out='docs/furniture-object-gi/authored-timing',b=await lightingBrowser(),save=(n,v)=>writeFileSync(`${out}/${n}.json`,JSON.stringify(v,null,2));mkdirSync(out,{recursive:true})
try{
 const cache=readFileSync('docs/gi-next/baseline/field-cache.json','utf8')
 await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false});await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${cache}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi&lightingProfile&furnitureGI=object`})
 await b.wait(`(()=>{const s=window.roofWallScene?.(),g=s?.scene.userData.indirectLighting;return g?.state==='ready'&&!g.pendingUpdate&&!g.volumePending&&!g.saving&&s.scene.userData.progressiveStartup?.phase==='full'&&!s.scene.userData.shaderWarmupPending})()`,600000)
 await b.evaluate(`(()=>{const style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);roofWallScene().gl.setPixelRatio(1);roofWallScene().invalidate()})()`);await b.wait('roofWallScene().gl.domElement.height===740')
 await b.evaluate(`import('/tests/browser/giSpatialHouse.ts').then(m=>{window.v=m.spatialHouseView(roofWallScene());return true})`)
 const ids=['96cca887-d5d4-4fef-a941-c3638911c06a','2bbf6f90-bfa6-4dd9-a92a-aa17f74533f4','591a56ad-68d0-4700-adf4-5026cb531369','0cd5964a-7f82-4218-9629-3fbc28a2ed4f','32a12f70-10e3-45a6-8e3c-ac9026377d30']
 await b.evaluate(`import('/tests/browser/furnitureObjectGI.ts').then(m=>{window.controllers=${JSON.stringify(ids)}.map(id=>m.furnitureObjectExperiment(roofWallScene(),'model-transform-'+id));roofWallScene().scene.userData.getIndirectUniforms().hdWhiteModel.value=0;controllers[0].setAO(true);return true})`)
 save('provenance',{settings:await b.evaluate('v.status()'),whiteModel:false,AO:true,strategies:'One above-bounds sample per object; all pre-existing transport settings unchanged.'})
 for(const config of [{id:'sofa',position:[1.6,2.2,16.6],lookAt:[2.5,.6,16.6],indices:[0]},{id:'several',position:[3.1,1.6,9],lookAt:[2.4,.6,7.4],indices:[1,2,3,4]}]){
  await b.evaluate(`v.setCamera(${JSON.stringify(config.position)},${JSON.stringify(config.lookAt)},65);controllers.forEach(c=>c.setMode('production'));true`)
  const results=[]
  for(const mode of ['production','above','above','production']){console.log('FRAMES',config.id,mode);await b.evaluate(`${JSON.stringify(config.indices)}.forEach(i=>controllers[i].setMode('${mode}'));controllers[0].warm().then(()=>true)`);results.push({mode,result:await b.evaluate('controllers[0].frames()')});save(config.id,results)}
 }
 save('metadata',await b.evaluate('controllers.map(c=>c.metadata())'));save('browser-errors',b.errors);assert.deepEqual(b.errors,[]);await b.evaluate('controllers.forEach(c=>c.dispose());v.dispose()')
}catch(e){save('failure',{error:String(e),errors:b.errors});throw e}finally{b.close()}
