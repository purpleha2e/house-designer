// Uses lighting-test.json; fixed diagnostic work budget makes convergence comparable.
process.env.ROOM_SETTLED ??= '1';process.env.ROOM_REFERENCE ??= '1';
import { houseBounceReference } from './houseBounceReference.mjs';
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {lightingBrowser} from './lightingHarness.mjs'
import {projectFileInputFixtureSource} from './projectFileInputFixture.mjs'
const out=process.env.ROOM_AUDIT_OUT??'tmp/lighting-lab/room-regression';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={}
const base=process.argv[2]??'http://127.0.0.1:5188',production=base.includes(':4173')
const save=()=>writeFileSync(out+'/report.json',JSON.stringify({...report,errors:b.errors},null,2))
const editorWait=async (expression,timeout=180000)=>{const end=Date.now()+timeout;while(!await b.evaluate(expression)){if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,200))}}
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false})
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>false;${projectFileInputFixtureSource}window.projectFileFixture=async()=>[{getFile:async()=>{const p=await(await fetch('http://127.0.0.1:5188/lighting-test.json')).json();window.houseTestSelected=true;return new File([JSON.stringify(p)],'lighting-test.json')}}];`})
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
 const wait=async expression=>{const end=Date.now()+300000;while(!await evaluate(expression)){const failure=await evaluate(`document.querySelector('#loading')?.textContent`);if(failure?.startsWith('Could not start:'))throw Error(failure);if(Date.now()>end)throw Error('Timed out '+expression);await new Promise(r=>setTimeout(r,150))}}
 report.stage='preparing-house';save()
 await wait('window.houseLightingLab?.stats().frames>120')
 // This is an isolated snapshot comparison. A dev-server reload halfway
 // through accumulation invalidates both its camera and reference samples.
 if(!production)await evaluate(`(async()=>{const {createHotContext}=await import('/@vite/client');const h=createHotContext('/tests/frozen-room-reference');for(const event of ['vite:beforeFullReload','vite:beforeUpdate'])h.on(event,()=>new Promise(()=>{}));})()`);
 report.initial=await evaluate('houseLightingLab.stats()');save()

 if(process.env.ROOM_SETTLED){await evaluate('void Object.defineProperty(houseLightingLab,"tilesPerFrame",{configurable:true,get:()=>128,set:()=>{}})');await wait('Math.min(...houseLightingLab.samples)>300')}
 else await wait('houseLightingLab.stats().frames>900');
 writeFileSync(out+'/room.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 report.views=await evaluate('Promise.all([[-.5,0],[0,0],[.65,0],[.85,0]].map(p=>houseLightingLab.measureView(...p)))');
 report.temporal=await evaluate(`(async()=>{
 const {DataUtils}=await import('http://127.0.0.1:5188/node_modules/three/build/three.module.js');
 const lab=houseLightingLab,w=lab.data.width,h=lab.data.height,sum=new Float64Array(w*h),squares=new Float64Array(w*h),pixels=new Uint16Array(w*h*4),count=90;
 for(let sample=0;sample<count;sample++){
   for(let f=0;f<3;f++)await new Promise(r=>requestAnimationFrame(r));
   await lab.renderer.readRenderTargetPixelsAsync(lab.filtered,0,0,w,h,pixels);
   for(let i=0;i<w*h;i++){const v=DataUtils.fromHalfFloat(pixels[i*4]);sum[i]+=v;squares[i]+=v*v;}
 }
 return lab.data.cards.map((c,id)=>{
   const values=[],relative=[];let mean=0,valid=0;
   for(let y=3;y<13;y++)for(let x=3;x<13;x++){
     const i=(Math.floor(id/32)*16+y)*w+(id%32)*16+x,m=sum[i]/count,sd=Math.sqrt(Math.max(0,squares[i]/count-m*m));
     if(m>.001){mean+=m;valid++;values.push(sd);relative.push(sd/m);}
   }
   relative.sort((a,b)=>a-b);return {id,name:c.name,centre:c.centre,updates:lab.samples[id],mean:mean/Math.max(valid,1),noise:values.reduce((a,b)=>a+b,0)/Math.max(valid,1),relativeP95:relative[Math.floor(relative.length*.95)]??0};
 });})()`);
 report.final=await evaluate('houseLightingLab.stats()');
 if(process.env.ROOM_REFERENCE){report.reference=await evaluate('('+houseBounceReference.toString()+')('+JSON.stringify(report.views)+',131072)')}

 report.controlledTileBudget=128;
 for(const view of report.views){
   const measured=report.temporal.find(c=>c.id===view.chart);
   assert.ok(measured.relativeP95<.03,'Settled wall lighting must not visibly shimmer: '+JSON.stringify(measured));
 }
 for(let i=0;i<report.views.length;i++)for(let c=0;c<3;c++){
   const ratio=report.views[i].bounce[c]/report.reference[i].rgb[c];
   assert.ok(ratio>.88&&ratio<1.12,'Wall bounce must remain within 12% of the independent reference: '+ratio);
 }
 save();
 // Exercise the user's lamp-on case at the normal adaptive runtime budget.
 await evaluate(`(()=>{const lab=houseLightingLab;delete lab.tilesPerFrame;lab.tilesPerFrame=32;
   lab.camera.rotateY(.35);document.querySelectorAll('[data-lamp]').forEach(input=>{if(!input.checked)input.click()});})()`);
 const lampStart=await evaluate('houseLightingLab.stats().frames');await wait(`houseLightingLab.stats().frames>${lampStart+600}`);
 report.lamps=await evaluate('houseLightingLab.stats()');
 writeFileSync(out+'/lamps.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 // Keep an A/B capture of the former nearest-mask reconstruction at identical
 // geometry, exposure, lamp power and accumulated bounced light.
 await evaluate(`(()=>{const lab=houseLightingLab;window.savedLightingStep=lab.step;lab.step=()=>{};
   lab.scene.children[0].material.forEach(m=>{m.userData.filteredShadowShader=m.fragmentShader;m.fragmentShader=m.fragmentShader.replace('#define HOUSE_SMOOTH_SHADOWS','');m.needsUpdate=true;});})()`);
 const nearestStart=await evaluate('houseLightingLab.stats().frames');await wait(`houseLightingLab.stats().frames>${nearestStart+5}`);
 writeFileSync(out+'/lamps-nearest-shadows.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate(`(()=>{const lab=houseLightingLab;lab.step=window.savedLightingStep;
   lab.scene.children[0].material.forEach(m=>{m.fragmentShader=m.userData.filteredShadowShader;delete m.userData.filteredShadowShader;m.needsUpdate=true;});})()`);
 assert.deepEqual(b.errors,[]);
 report.stage='passed';save();console.log(JSON.stringify({stage:report.stage,final:report.final,views:report.views,reference:report.reference}));
}catch(error){report.error=String(error);save();throw error}finally{b.close()}
