import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
const out='tmp/lighting-lab/daylight-comparison';mkdirSync(out,{recursive:true})
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
 const exteriorUrl=new URL(target.url);exteriorUrl.searchParams.set('prototypeDaylight','0');exteriorUrl.searchParams.set('daylightOnly','1');
 await call('Page.navigate',{url:exteriorUrl.href});
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
 assert.equal(report.initial.daylightMode,'exterior');
 assert.ok(report.initial.proxyInstances>0&&report.initial.lightingTriangles<report.initial.triangles);
 writeFileSync(out+'/landing-proxies.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));

 const shot=async name=>writeFileSync(out+'/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const frames=async count=>{const at=await evaluate('houseLightingLab.stats().frames');await wait('houseLightingLab.stats().frames>'+String(at+count))};
 await evaluate('houseLightingLab.camera.position.set(11.2,1.65,3.8);houseLightingLab.camera.lookAt(5.2,1.4,4.0);document.querySelectorAll("[data-lamp]").forEach(box=>{if(box.checked)box.click()});houseLightingLab.setInput({...houseLightingLab.previousInput,daylight:true,sunColour:[0,0,0]})');await frames(600);
 report.exterior=await evaluate('houseLightingLab.stats()');await shot('exterior');
 report.exteriorSamples=await evaluate("Promise.all([-.65,-.35,0,.35,.65].flatMap(x=>[-.65,-.4,-.1,.25,.55].map(y=>houseLightingLab.measureView(x,y).then(hit=>({x,y,hit})))))");save();
 await evaluate('document.querySelector("#prototype-daylight").click()');
 await wait('window.houseLightingLab?.uniforms.prototypeDaylight.value===1&&houseLightingLab.stats().frames>600');
 report.prototype=await evaluate('houseLightingLab.stats()');report.emitters=await evaluate('houseLightingLab.materials.filter(m=>m.uniforms.daylightEmitter?.value===1).length/3');
 assert.equal(report.prototype.daylightMode,'windows');
 assert.ok(report.prototype.proxyInstances>0&&report.prototype.lightingTriangles<report.prototype.triangles);
 assert.ok(report.emitters>0,'Exterior window glazing must supply the prototype daylight');
 assert.deepEqual(await evaluate('houseLightingLab.camera.position.toArray()'),[11.2,1.65,3.8]);
 assert.equal(await evaluate('houseLightingLab.previousInput.lights.some(l=>l.power!==0)'),false);
 assert.deepEqual(await evaluate('houseLightingLab.previousInput.sunColour'),[0,0,0]);
 report.prototypeSamples=await evaluate("Promise.all([-.65,-.35,0,.35,.65].flatMap(x=>[-.65,-.4,-.1,.25,.55].map(y=>houseLightingLab.measureView(x,y).then(hit=>({x,y,hit})))))");await shot('prototype');report.stage='compared';save();
 report.revealSamples=await evaluate("Promise.all([.57,.59,.61,.63,.65,.67,.69].flatMap(x=>[-.3,0,.2].map(y=>houseLightingLab.measureView(x,y).then(hit=>({x,y,hit})))))");save();
 const reveal=report.revealSamples.find(sample=>sample.x===.59&&sample.y===0).hit;
 assert.ok(reveal.name.includes('wall-engine-render')&&reveal.normal[0]>.99,'Lounge reveal must face into the window opening');
 await evaluate('(()=>{const gl=houseLightingLab.renderer.getContext(),original=gl.linkProgram;window.newLinks=0;gl.linkProgram=function(...args){newLinks++;return original.apply(this,args)}})()');
 await evaluate('document.querySelector("#daylight").click()');await frames(2);await shot('dark');
 report.darkSamples=await evaluate("Promise.all([[-.65,-.1],[0,.25],[0,.55]].map(p=>houseLightingLab.measureView(...p)))");
 assert.ok(report.darkSamples.every(s=>Math.max(...s.bounce.slice(0,3))<.02),'Removing daylight must extinguish the window lighting');
 assert.equal(await evaluate('newLinks'),0);
 // Reopening the normal launch URL must retain the selected source model.
 await call('Page.navigate',{url:base+'/lighting-lab/index.html?house=1'});
 await wait('window.houseLightingLab?.stats().frames>240');
 report.reopened=await evaluate('houseLightingLab.stats()');
 assert.equal(report.reopened.daylightMode,'windows');
 assert.equal(await evaluate('document.querySelector("#prototype-daylight").checked'),true);
 await evaluate('document.querySelector("#prototype-daylight").checked=false');
 await wait('document.querySelector("#prototype-daylight").checked===true&&document.querySelector("#daylight-mode").textContent==="Prototype daylight"');
 await shot('landing-prototype');
 report.stage='passed';save();console.log(JSON.stringify(report));
}catch(error){report.error=String(error);save();throw error}finally{b.close()}

