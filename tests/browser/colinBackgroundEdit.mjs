// Attach only to the newest isolated, currently running GI benchmark browser.
// Record its completed cold bake, then move a window before the polling harness
// exits. Both measurements are kept in that harness's downloadable profile.
import {readdirSync,existsSync,readFileSync,statSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
const root=resolve('node_modules/.cache/browser-test-profiles')
const profiles=readdirSync(root).filter(p=>p.startsWith('gi-pipeline-')&&existsSync(join(root,p,'DevToolsActivePort'))).sort((a,b)=>statSync(join(root,b)).birthtimeMs-statSync(join(root,a)).birthtimeMs)
if(!profiles.length)throw Error('No isolated GI benchmark is running')
const [port,path]=readFileSync(join(root,profiles[0],'DevToolsActivePort'),'utf8').trim().split(/\r?\n/)
const ws=new WebSocket(`ws://127.0.0.1:${port}${path}`);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map()
ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}})
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params,sessionId}))})
try{
  const {targetInfos}=await send('Target.getTargets'),target=targetInfos.find(t=>t.url.includes('/tests/browser/roofWallRegression.html'))
  if(!target)throw Error('Isolated benchmark tab not found')
  const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})
  const r=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`new Promise((resolve,reject)=>{
    const deadline=performance.now()+450000;
    const frame=()=>{
      const s=window.roofWallScene?.(),p=s?.scene.userData.indirectLighting;
      if(performance.now()>deadline){reject(Error('Cold GI did not finish'));return}
      if(!p||p.state!=='ready'||p.volumePending||p.pendingUpdate){requestAnimationFrame(frame);return}
      const initial={status:{...p},performance:s.scene.userData.getLightingPerformance(),at:performance.now()};
      window.giProfile.initialBeforeWindowEdit=initial;
      const started=performance.now(),generation=p.generation,render=s.gl.render.bind(s.gl);let visibleMs=0,firstProbeMs=0;
      s.gl.render=(scene,camera)=>{const result=render(scene,camera);if(!visibleMs&&(scene===s.scene||scene.userData.retainedViewport))scene.traverse(o=>{if(o.userData.wallOpeningPreview&&o.children.length)visibleMs=performance.now()-started});return result};
      p.state='updating';p.pendingUpdate=true;window.regressionMoveWindow(.25);
      const edited=()=>{
        const next=s.scene.userData.indirectLighting;if(!firstProbeMs&&next.generation>generation&&next.completed>0)firstProbeMs=performance.now()-started;
        if(next.generation>generation&&next.state==='ready'&&!next.volumePending&&!next.pendingUpdate){
          s.gl.render=render;
          const result={visibleMs,firstProbeMs,totalMs:performance.now()-started,status:{...next},performance:s.scene.userData.getLightingPerformance(),gpuPreviewState:s.scene.userData.fastGI?.stats.state};
          window.giProfile.windowEdit=result;resolve({initial,edit:result});return
        }
        if(performance.now()-started>120000){reject(Error('Window GI update exceeded two minutes'));return}requestAnimationFrame(edited)
      };requestAnimationFrame(edited)
    };requestAnimationFrame(frame)
  })`},sessionId)
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails))
  // The profiling harness must use --settle-ms=9000 (or longer) so these
  // post-edit navigation measurements finish before it closes the browser.
  const viewport=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const s=roofWallScene(),render=s.gl.render.bind(s.gl),position=s.camera.position.clone(),generation=s.scene.userData.indirectLighting.generation;
    let shown=false;s.gl.render=(scene,camera)=>{const value=render(scene,camera);if(scene===s.scene||scene.userData.retainedViewport)shown=true;return value};
    const sample=moving=>new Promise(resolve=>{const start=performance.now();let frames=0,displayFrames=0;
      function frame(now){frames++;if(shown)displayFrames++;shown=false;
        if(moving){s.camera.position.x=position.x+Math.sin((now-start)/1000)*.1;s.camera.updateMatrixWorld();s.invalidate()}
        if(now-start<3000)requestAnimationFrame(frame);else resolve({animationFps:frames*1000/(now-start),displayFps:displayFrames*1000/(now-start),elapsedMs:now-start})
      }requestAnimationFrame(frame)});
    try{const stationary=await sample(false),moving=await sample(true);const result={stationary,moving,generationStable:generation===s.scene.userData.indirectLighting.generation,width:s.gl.domElement.width,height:s.gl.domElement.height,glError:s.gl.getContext().getError()};giProfile.viewportAfterEdit=result;return result}
    finally{s.gl.render=render;s.camera.position.copy(position);s.camera.updateMatrixWorld();s.invalidate()}
  })()`},sessionId)
  if(viewport.exceptionDetails)throw Error(JSON.stringify(viewport.exceptionDetails))
  r.result.value.viewport=viewport.result.value
  writeFileSync('tmp/colin-background-edit.json',JSON.stringify(r.result.value,null,2));console.log(JSON.stringify(r.result.value))
}finally{ws.close()}
