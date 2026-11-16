import { lightingBrowser } from '../../tests/browser/lightingHarness.mjs'
import { installSceneEditPreload } from '../../tests/browser/sceneEditTrace.js'
import { writeFileSync } from 'node:fs'
const browser=await lightingBrowser()
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
 console.log('ERRORS',JSON.stringify(browser.errors))
}finally{browser.close()}
