import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
import {houseShadowTraversalCheck} from './houseShadowTraversal.mjs'
const out='tmp/lighting-lab/house';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={}
const base=process.argv[2]??'http://127.0.0.1:5188',production=base.includes(':4173')
const save=()=>writeFileSync(out+'/report.json',JSON.stringify({...report,errors:b.errors},null,2))
const editorWait=async (expression,timeout=180000)=>{const end=Date.now()+timeout;while(!await b.evaluate(expression)){if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,200))}}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>{const p=await(await fetch('http://127.0.0.1:5188/springfield_14.json')).json();p.threeDView.camera.position={x:10.3,y:4.15,z:11.15};p.threeDView.camera.quaternion={x:-.0095,y:0,z:0,w:.9999549};window.houseTestSelected=true;return new File([JSON.stringify(p)],'springfield_14.json')}}];`})
 await b.call('Page.navigate',{url:base+(production?'/':'/tests/browser/editorRegression.html')})
 await editorWait(`!!document.querySelector('[aria-label="Project menu"]')`)
 await b.evaluate(`document.querySelector('[aria-label="Project menu"]').click()`)
 await editorWait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load')`)
 await b.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Load').click()`)
 report.stage='loading-editor';save()
 await editorWait('window.houseTestSelected===true')
 await new Promise(r=>setTimeout(r,1500))
 // The lab owns its lighting; legacy editor probe baking is not a prerequisite.
 await editorWait(production?`!document.querySelector('.viewport-preparing-overlay')`:`(()=>{const s=perfScene();return s&&!document.querySelector('.viewport-preparing-overlay')&&!s.scene.userData.shaderWarmupPending})()`,600000)
 await b.evaluate(`document.querySelector('[aria-label="3D view menu"]').click()`)
 await editorWait(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Open house lighting lab'&&!b.disabled)`)
 await b.call('Runtime.evaluate',{expression:`[...document.querySelectorAll('button')].find(b=>b.textContent==='Open house lighting lab').click()`,userGesture:true})
 report.stage='opening-house';save()
 const end=Date.now()+30000;let target
 while(!target){target=(await b.browserCall('Target.getTargets')).targetInfos.find(t=>t.url.includes('lighting-lab/index.html?house'));if(Date.now()>end)throw Error('House lab tab did not open');await new Promise(r=>setTimeout(r,100))}
 const {sessionId}=await b.browserCall('Target.attachToTarget',{targetId:target.targetId,flatten:true})
 const call=(method,params={})=>b.browserCall(method,params,sessionId)
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false})
 // The harness keeps the original tab artificially focused. Release that
 // emulation so it pauses in the background as it does during normal use.
 await b.call('Emulation.setFocusEmulationEnabled',{enabled:false})
 await b.browserCall('Target.activateTarget',{targetId:target.targetId})
 report.editorHidden=await b.evaluate('document.hidden')
 assert.equal(report.editorHidden,true)
 const wait=async expression=>{const end=Date.now()+180000;while(!await evaluate(expression)){const failure=await evaluate(`document.querySelector('#loading')?.textContent`);if(failure?.startsWith('Could not start:'))throw Error(failure);if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,150))}}
 report.stage='preparing-house';save()
 await wait('window.houseLightingLab?.stats().frames>120')
 report.initial=await evaluate('houseLightingLab.stats()');save()
 assert.ok(report.initial.proxyInstances>0,'Springfield solid panel doors must use lighting proxies')
 assert.ok(report.initial.lightingTriangles<report.initial.triangles,'Lighting proxies must reduce transport geometry while retaining visible triangles')
 assert.ok(report.initial.sharedDetailInstances>0,'Decorative detail must share lighting receivers')
 report.skirtingCaptureCards=await evaluate('houseLightingLab.data.cards.filter(card=>/skirting/.test(card.name)).length')
 assert.equal(report.skirtingCaptureCards,0,'Skirting must not allocate captures or participate in the lighting geometry')
 report.earlyLanding=await evaluate(`Promise.all([[-.7,0],[0,.8],[0,.2]].map(p=>houseLightingLab.measureView(...p)))`)
 await wait('houseLightingLab.stats().pendingDirect===0&&houseLightingLab.stats().frames>500')
 report.ready=await evaluate('houseLightingLab.stats()')
 assert.equal(report.ready.feedbackFailed,false,'Visible-surface readback must remain available')
 assert.ok(report.ready.visibleCards>0,'The actual view must identify lighting receivers')
 report.readyLanding=await evaluate(`Promise.all([[-.7,0],[0,.8],[0,.2]].map(p=>houseLightingLab.measureView(...p)))`)
 assert.ok(report.readyLanding[1].updates>1,'The nearby ceiling must receive repeated bounce updates before the distant house sweep finishes')
 if(process.env.HOUSE_LAB_AUDIT){
   report.landingInput=await evaluate('houseLightingLab.previousInput')
   report.landingLight=[]
   for(let i=0;i<4;i++){
     report.landingLight.push(await evaluate(`Promise.all([[-.7,0],[0,.8],[0,.2]].map(p=>houseLightingLab.measureView(...p)))`));save()
     const at=await evaluate('houseLightingLab.stats().frames');await wait(`houseLightingLab.stats().frames>${at+300}`)
   }
 }
 writeFileSync(out+'/landing.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 await evaluate('document.querySelector(\'[data-lamp="15"]\').click()')
 const litFrame=await evaluate('houseLightingLab.stats().frames');await wait(`houseLightingLab.stats().frames>${litFrame+120}`)
 report.litLanding=await evaluate('houseLightingLab.stats()')
 writeFileSync(out+'/landing-light-on.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 await evaluate('document.querySelector(\'[data-lamp="15"]\').click()')
 report.toggle=await evaluate(`(async()=>{const gl=houseLightingLab.renderer.getContext(),link=gl.linkProgram;window.newShaderLinks=0;gl.linkProgram=function(...a){newShaderLinks++;return link.apply(this,a)};const start=performance.now();document.querySelector('[data-lamp="0"]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {elapsedMs:performance.now()-start,pending:houseLightingLab.stats().pendingDirect}})()`)
 assert.equal(report.toggle.pending,0,'Prepared lamp visibility must relight on the next display frames')
 await wait('houseLightingLab.stats().pendingDirect===0')
 // Restore the saved light state before visual comparisons; the test toggle
 // must not brighten the downstairs kitchen used to judge this change.
 await evaluate(`document.querySelector('[data-lamp="0"]').click()`)
 await evaluate(`(()=>{houseLightingLab.camera.position.set(6.4,4.15,5.1);houseLightingLab.camera.lookAt(9.9,4,3.9)})()`)
 const frame=await evaluate('houseLightingLab.stats().frames');await wait(`houseLightingLab.stats().frames>${frame+120}`)
 writeFileSync(out+'/bedroom.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 await evaluate(`(()=>{houseLightingLab.camera.position.set(3.5,1.65,5.3);houseLightingLab.camera.lookAt(11.8,1.35,2.7)})()`)
 const kitchenFrame=await evaluate('houseLightingLab.stats().frames');await wait(`houseLightingLab.stats().frames>${kitchenFrame+600}`)
 report.kitchenInput=await evaluate('houseLightingLab.previousInput')
 report.kitchen=await evaluate('houseLightingLab.stats()')
 writeFileSync(out+'/kitchen.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 if(process.env.PROTOTYPE_LIGHTS){
   await evaluate(`(()=>{const lab=houseLightingLab;lab.setInput({...lab.previousInput,daylight:true,sunColour:[0,0,0],lights:lab.previousInput.lights.map(light=>({...light,power:90,color:'#fff5e3',falloff:2,distance:0}))});document.querySelectorAll('[data-lamp]').forEach(box=>box.checked=true)})()`)
   const matchedAt=await evaluate('houseLightingLab.stats().frames');await wait(`houseLightingLab.stats().frames>${matchedAt+900}`)
   report.prototypeLightingInput=await evaluate('houseLightingLab.previousInput')
   writeFileSync(out+'/kitchen-prototype-lights.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'))
 }
 report.final=await evaluate('houseLightingLab.stats()');report.shaderLinks=await evaluate('newShaderLinks')
 assert.equal(report.shaderLinks,0);assert.deepEqual(report.final.viewport,report.initial.viewport)
 assert.ok(report.final.triangles>10000);assert.ok(report.final.preparedCards>=report.initial.preparedCards)
 // Exercise source removal through uniforms, then inspect the actual GPU cache.
 await evaluate(`(()=>{const lab=houseLightingLab,input=lab.previousInput;lab.setInput({...input,daylight:false,lights:input.lights.map(light=>({...light,power:0}))})})()`)
 await wait('houseLightingLab.stats().pendingDirect===0')
 report.dark=await evaluate(`(async()=>{const lab=houseLightingLab,t=lab.direct,pixels=new Uint16Array(t.width*t.height*4);await lab.renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,pixels);let nonzero=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]||pixels[i+1]||pixels[i+2])nonzero++;return{nonzero,stats:lab.stats()}})()`)
 assert.equal(report.dark.nonzero,0,'Turning all sources off must remove actual direct lighting')
 assert.equal(await evaluate('newShaderLinks'),0)
 if(process.env.VERIFY_SHADOWS&&!production){
   report.shadowTraversal=await evaluate(houseShadowTraversalCheck)
   assert.ok(report.shadowTraversal.covered>1000)
   assert.equal(report.shadowTraversal.differences,0,'Any-hit shadows must match the original closest-hit shadow masks')
 }
 const relevant=b.errors.filter(e=>!/BufferGeometryUtils.*(?:mergeAttributes|mergeGeometries)/.test(e));assert.deepEqual(relevant,[])
 report.stage='passed';save();console.log(JSON.stringify(report))
 if(process.env.HOUSE_LAB_HOLD)await new Promise(r=>setTimeout(r,60000))
}catch(error){report.error=String(error);save();throw error}finally{b.close()}
