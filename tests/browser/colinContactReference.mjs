import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
const b=await lightingBrowser(),port=process.argv[2]??5180,out='docs/colin-contact-shading',views=JSON.parse(readFileSync(`${out}/verified/cameras.json`)).filter(v=>['sofa-rear','kitchen-units','table-legs'].includes(v.id))
const pixels={
 'sofa-rear':[{name:'sofa seat-back dark seam',x:500,y:455},{name:'sofa right dark back panel',x:778,y:430},{name:'sofa cushion control',x:750,y:400}],
 'kitchen-units':[{name:'wall immediately above worktop',x:718,y:349},{name:'wall above contact band',x:718,y:290},{name:'worktop rear contact',x:770,y:424}],
 'table-legs':[{name:'floor flare beside near table leg',x:333,y:630},{name:'floor 4 cm away',x:320,y:640},{name:'floor outside near leg',x:350,y:640},{name:'floor control',x:330,y:660},{name:'floor by far table leg',x:690,y:375}],
}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1000,height:740,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.regressionSavedGI={project:{indirectLighting:${readFileSync('docs/gi-spatial-accuracy/baseline/field-cache.json','utf8')}}}`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/roofWallRegression.html?colin&materials&kitchen-diagnostics&saved-gi`});console.log('LOAD reference scene')
 await b.wait(`window.roofWallScene?.()?.scene.userData.progressiveStartup?.phase==='full'&&roofWallScene().scene.userData.indirectLighting?.state==='ready'&&!roofWallScene().scene.userData.indirectLighting.pendingUpdate&&!roofWallScene().scene.userData.shaderWarmupPending`,600000)
 await b.evaluate(`(async()=>{const s=roofWallScene(),style=document.createElement('style');style.textContent='html,body,#root{width:1000px!important;min-width:0!important;height:740px!important;margin:0!important;overflow:hidden!important}.editor-pane{height:740px!important}body *{visibility:hidden!important}body canvas{visibility:visible!important}';document.head.appendChild(style);s.gl.setPixelRatio(1);s.invalidate();window.contact=(await import('/tests/browser/colinContactDiagnostics.ts')).contactDiagnostics(s);await contact.warm()})()`)
 const measured=[]
 for(const v of views){await b.evaluate(`contact.setCamera(${JSON.stringify(v.position)},${JSON.stringify(v.lookAt)},65)`);const points=await b.evaluate(`contact.measure(${JSON.stringify(pixels[v.id])})`);console.log('MEASURE',v.id,JSON.stringify(points.map(p=>({name:p.name,support:p.support,crossing:p.firstCrossedSurface,offset:p.receiverOffsetDistance}))));measured.push(...points.map(p=>({...p,camera:v.id})));writeFileSync(`${out}/receivers.json`,JSON.stringify(measured,null,2))}
 console.log('TRACE independent six-bounce paths at',measured.filter(p=>p.validPhysicalReceiver).length,'validated physical surface points;',measured.filter(p=>!p.validPhysicalReceiver).length,'excluded mismatches')
 const reference=await b.evaluate(`contact.reference(${JSON.stringify(measured)})`);assert.equal(reference.results.length,measured.filter(p=>p.validPhysicalReceiver).length);mkdirSync(out,{recursive:true});writeFileSync(`${out}/reference.json`,JSON.stringify(reference,null,2));writeFileSync(`${out}/reference-settings.json`,JSON.stringify(await b.evaluate('contact.status()'),null,2));assert.deepEqual(b.errors,[]);await b.evaluate('contact.dispose()');console.log('PASS independent contact reference')
}finally{b.close()}
