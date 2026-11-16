import { lightingBrowser } from '../../tests/browser/lightingHarness.mjs'
import { installSceneEditPreload } from '../../tests/browser/sceneEditTrace.js'
import { writeFileSync } from 'node:fs'
const browser=await lightingBrowser({uncapped:true})
try {
 await browser.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:2,mobile:true})
 await browser.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
 await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${installSceneEditPreload.toString()})();window.perfAudit={compiles:0,links:0,long:[],frames:[]};for(const [name,key] of [['compileShader','compiles'],['linkProgram','links']]){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){perfAudit[key]++;return original.apply(this,args)}}new PerformanceObserver(list=>perfAudit.long.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});let last=0;function tick(now){if(last)perfAudit.frames.push({at:now,ms:now-last});last=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);`})
 await browser.call('Page.navigate',{url:process.argv[2]??'http://127.0.0.1:5183/'})
 const samples=[];let readyAt=0,moving=false
 for(let i=0;i<48;i++){
  await new Promise(r=>setTimeout(r,5000))
  const s=await browser.evaluate(`(()=>{let store;const walk=f=>{if(!f)return;store??=f.memoizedProps?.value?.getState?.()?.scene?f.memoizedProps.value:undefined;for(let d=f.dependencies?.firstContext;d;d=d.next)if(d.memoizedValue?.getState?.()?.scene)store??=d.memoizedValue;walk(f.child);walk(f.sibling)};if(!window.auditStore)for(const root of sceneEditTrace.roots.keys())walk(root.current);window.auditStore??=store;const st=auditStore?.getState(),u=st?.scene.userData,p=perfAudit,frames=p.frames.splice(0).map(f=>f.ms).sort((a,b)=>a-b);return {at:performance.now(),fps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length),p95:frames[Math.floor(frames.length*.95)],compiles:p.compiles,links:p.links,long:p.long.splice(0),gi:u?.indirectLighting?.state,exterior:u?.exteriorSkyOcclusion,phase:u?.progressiveStartup,warm:u?.shaderWarmupPending,soft:u?.softFloorGI,programs:st?.gl.info.programs.length,text:document.body.innerText.slice(-250),workers:[...sceneEditTrace.workers.values()].filter(w=>w.pending),warmups:u?.shaderWarmupProfile?.map(p=>({startedAt:p.startedAt,stages:p.stages,cancelled:p.cancelled}))}})()`)
  samples.push(s);writeFileSync('tmp/publish-springfield/performance.json',JSON.stringify(samples,null,2));console.log(JSON.stringify({...s,long:s.long.map(t=>t.ms),warmups:undefined,phase:s.phase?.phase}))
  if(s.gi==='ready'&&s.exterior?.enabled&&!s.warm&&!readyAt){readyAt=s.at;console.log('ALL LIGHTING READY')}
  if(readyAt&&s.at-readyAt>10000&&!moving){moving=true;await browser.call('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',windowsVirtualKeyCode:87});console.log('START WALK')}
  if(readyAt&&s.at-readyAt>30000){await browser.call('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',windowsVirtualKeyCode:87});break}
 }
  await browser.evaluate(`(()=>{document.querySelector('[aria-label="Open tour menu"]')?.click();[...document.querySelectorAll('.viewer-modes button')].find(b=>b.textContent==='Fly').click();document.querySelector('[aria-label="Close tour menu"]')?.click();const s=auditStore.getState();s.camera.position.set(16,5,15);s.camera.lookAt(10,4,7);window.auditOriginalSky=s.scene.userData.getIndirectUniforms().hdExteriorSkyStrength.value;window.auditForceRender=true;const q=s.camera.quaternion.clone();let i=0;function tick(){if(!auditForceRender)return;s.camera.quaternion.copy(q);s.camera.rotateY((i++%2)*.00001);s.invalidate();requestAnimationFrame(tick)}requestAnimationFrame(tick)})()`)
 const shots=await browser.call('Page.captureScreenshot',{format:'png'});writeFileSync('tmp/publish-springfield/render-cost.png',Buffer.from(shots.data,'base64'))
 for(const mode of ['full','resolution75','noExterior','restored']){
  await browser.evaluate(`(()=>{const s=auditStore.getState(),u=s.scene.userData.getIndirectUniforms();s.setDpr(${mode==='resolution75'?.75:1});Object.defineProperty(u.hdExteriorSkyStrength,'value',{configurable:true,get:()=>${mode==='noExterior'?0:.75},set:()=>{}});perfAudit.frames=[];perfAudit.long=[]})()`)
  await new Promise(r=>setTimeout(r,6000))
  console.log('COST',mode,JSON.stringify(await browser.evaluate(`(()=>{const s=auditStore.getState(),f=perfAudit.frames.map(f=>f.ms).sort((a,b)=>a-b);return {fps:1000/(f.reduce((a,b)=>a+b,0)/f.length),p95:f[Math.floor(f.length*.95)],compiles:perfAudit.compiles,links:perfAudit.links,long:perfAudit.long.map(t=>t.ms),camera:s.camera.position.toArray(),dpr:s.gl.getPixelRatio(),canvas:[s.gl.domElement.width,s.gl.domElement.height]}})()`)))
 }
 console.log('ERRORS',JSON.stringify(browser.errors))
}finally{browser.close()}

