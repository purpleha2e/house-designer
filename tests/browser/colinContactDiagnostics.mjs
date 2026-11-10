import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),out='docs/colin-contact-shading/verified',port=process.argv[2]??5180
const views=[
 {id:'sofa-kitchen',position:[1.5,1.4,13.6],lookAt:[-.2,.65,12.2]},
 {id:'sofa-rear',position:[1.1,1.4,16.4],lookAt:[2.8,.65,16.6]},
 {id:'kitchen-units',position:[4.55,1.4,13.2],lookAt:[6.1,.9,10.2]},
 {id:'table-legs',position:[3.1,1.45,9.0],lookAt:[1.8,.3,7.5]},
]
try{
 await b.call('Log.enable');await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json','utf8')}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi`})
 await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.indirectLighting.pendingUpdate&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
 await b.evaluate(`(()=>{document.querySelector('button[aria-label="3D view menu"]').click()})()`);await b.wait(`!![...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='GI probes')`)
 await b.evaluate(`[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='GI probes').querySelector('input').click()`);await b.wait(`roofWallScene().scene.getObjectByName('indirect-lighting-probes')?.count>0`)
 await b.evaluate(`(async()=>{const s=roofWallScene(),style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);s.gl.setPixelRatio(1);s.invalidate();window.contact=(await import('/tests/browser/colinContactDiagnostics.ts')).contactDiagnostics(s);await contact.warm()})()`)
 mkdirSync(out,{recursive:true});writeFileSync(`${out}/settings.json`,JSON.stringify(await b.evaluate('contact.status()'),null,2));writeFileSync(`${out}/cameras.json`,JSON.stringify(views,null,2))
 for(const view of views){const dir=`${out}/${view.id}`;mkdirSync(dir,{recursive:true});await b.evaluate(`contact.setCamera(${JSON.stringify(view.position)},${JSON.stringify(view.lookAt)},65)`)
  for(const [name,options]of [['baseline',{}],['no-probes',{probes:false}],['no-ao',{ao:false,fake:false}],['no-ao-no-probes',{ao:false,probes:false}],['no-shadows',{shadows:false}],['no-gi',{gi:false}],['small-bias',{smallBias:true}],['flat-ao',{flat:true}],['flat-no-ao',{flat:true,ao:false,fake:false}],['normals',{diagnostic:2,ao:false,fake:false}],['classification',{diagnostic:3,ao:false,fake:false}],['support',{diagnostic:5,ao:false,fake:false}]]){
   await b.evaluate(`contact.state(${JSON.stringify(options)})`);const frame=await b.evaluate('contact.capture()'),rect=await b.evaluate('(()=>{const r=roofWallScene().gl.domElement.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()');writeFileSync(`${dir}/${name}.rgba16f.gz`,gzipSync(Buffer.from(frame.hdr,'base64')));const png=await b.call('Page.captureScreenshot',{format:'png',clip:rect});writeFileSync(`${dir}/${name}.png`,Buffer.from(png.data,'base64'));console.log('CAPTURE',view.id,name)
  }
 }
 writeFileSync(`${out}/browser-log.json`,JSON.stringify(b.logs,null,2));assert.deepEqual(b.errors,[]);await b.evaluate('contact.dispose()');console.log('PASS contact shading component captures')
}finally{b.close()}
