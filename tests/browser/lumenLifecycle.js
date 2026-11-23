/** Observe actual submitted frames of the editor during a short repeated walk.
 * Count a presentation opportunity only when WebGLRenderer drew the scene. */
export function watchEditorLoad(pose){
 const rows=[]
 const longTasks=[]
 const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())longTasks.push({duration:entry.duration,at:entry.startTime})})
 if(PerformanceObserver.supportedEntryTypes.includes('longtask'))observer.observe({type:'longtask'})
 let lastTime=0,lastPhase='',lastFrame=-1,lastPresented=0,root,active=true,matched=false
 const tick=t=>{
   if(!active)return
   const s=window.perfScene?.()
   if(s){
     const u=s.scene.userData
     if(!matched && Math.hypot(s.camera.position.x-pose.position[0],s.camera.position.z-pose.position[2])<.2)matched=true
     if(matched){
       if(s.camera.fov!==pose.fov){s.camera.fov=pose.fov;s.camera.updateProjectionMatrix()}
       const started=u.progressiveStartup
       const phase=started?.phase??'mount'
       const frame=s.gl.info.render.frame
       if(frame!==lastFrame){
         if(phase===lastPhase && lastPresented && s.gl===root)rows.push({phase,dt:t-lastPresented,rAF:t-lastTime,width:s.gl.domElement.width,height:s.gl.domElement.height,gi:u.lumenGI?.state,giFrames:u.lumenGI?.frames,cacheStage:u.lumenGI?.cacheProfile?.submissions.slice()})
         lastPresented=t
       }
       lastFrame=frame;lastPhase=phase;root=s.gl
       s.camera.position.x=pose.position[0]+.045*Math.sin(t*.0015)
       s.camera.updateMatrixWorld(true);s.invalidate();lastTime=t
     }
   }
   requestAnimationFrame(tick)
 }
 requestAnimationFrame(tick)
 return ()=>{active=false;observer.disconnect();const s=window.perfScene();s.camera.position.fromArray(pose.position);s.camera.updateMatrixWorld(true);
 const output={};for(const phase of new Set(rows.map(r=>r.phase))){
 const v=rows.filter(r=>r.phase===phase && r.width===s.gl.domElement.width && r.height===s.gl.domElement.height).map(r=>r.dt).sort((a,b)=>a-b);if(!v.length)continue;const med=v[Math.floor(v.length/2)],p95=v[Math.min(v.length-1,Math.floor(v.length*.95))];
 output[phase]={count:v.length,median:med,p95,medianFPS:1000/med}
 }return {phases:output,raw:rows,longTasks,startup:{...s.scene.userData.progressiveStartup},width:s.gl.domElement.width,height:s.gl.domElement.height,dpr:s.gl.getPixelRatio()}}
}
