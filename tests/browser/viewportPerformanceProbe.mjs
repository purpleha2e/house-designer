// Diagnostic only. One fixed camera; no authored scene or quality mutations.
export function installViewportPerformanceProbe() {
  const intervals=[],passes={},render={calls:0,cpuMs:0},ambient={calls:0,cpuMs:0},restorers=[]
  let last=performance.now(),active=true,installed,composer,ambientRef,ambientOriginal,ambientWrapped
  const raf=now=>{intervals.push(now-last);last=now;if(active)requestAnimationFrame(raf)}
  requestAnimationFrame(raf)
  const findComposer=()=>{let found;const walk=f=>{if(!f)return;const p=f.memoizedProps;if(p?.composer?.current&&'selectionRevision'in p)found=p.composer.current;walk(f.child);walk(f.sibling)};for(const[root]of sceneEditTrace.roots)walk(root.current);return found}
  const install=setInterval(()=>{
    const s=previewState();if(!s)return
    if(installed!==s.gl){installed=s.gl;const original=s.gl.render;const wrapped=function(...args){const at=performance.now();try{return original.apply(this,args)}finally{render.calls++;render.cpuMs+=performance.now()-at}};s.gl.render=wrapped;restorers.push(()=>{if(s.gl.render===wrapped)s.gl.render=original})}
    const next=findComposer()
    if(next&&composer!==next){composer=next;next.passes.forEach((pass,index)=>{const key=index+':'+(pass.configuration?'AO':pass.name||pass.constructor.name),row=passes[key]={calls:0,cpuMs:0},original=pass.render;const wrapped=function(...args){const at=performance.now();try{return original.apply(this,args)}finally{row.calls++;row.cpuMs+=performance.now()-at}};pass.render=wrapped;restorers.push(()=>{if(pass.render===wrapped)pass.render=original})})}
    for(const subscriber of s.internal.subscribers){const ref=subscriber.ref,fn=ref.current;if(ref===ambientRef&&fn===ambientWrapped)continue;if(!String(fn).includes('ambientFillBudget'))continue;ambientRef=ref;ambientOriginal=fn;ambientWrapped=function(...args){if(window.viewportPerformance.previousFill)return;const at=performance.now();try{return fn.apply(this,args)}finally{ambient.calls++;ambient.cpuMs+=performance.now()-at}};ref.current=ambientWrapped;restorers.push(()=>{if(ref.current===ambientWrapped)ref.current=fn})}
  },1000)
  let variant='current'
  const percentile=(values,p)=>{const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]}
  window.viewportPerformance={previousFill:false,
    sample(){const frames=intervals.splice(0),sum=frames.reduce((a,b)=>a+b,0),s=previewState(),u=s?.scene.userData,light=[];s?.scene.traverse(o=>{if(['ambient-fill','ambient-sky-fill'].includes(o.userData.houseDesignerRole))light.push({role:o.userData.houseDesignerRole,intensity:o.intensity})});const result={at:performance.now(),variant,frames:frames.length,fps:frames.length*1000/sum,medianFrameMs:percentile(frames,.5),p95FrameMs:percentile(frames,.95),render:{...render},passes:Object.fromEntries(Object.entries(passes).map(([k,v])=>[k,{...v}])),ambientCallback:{...ambient},light,warm:u?.shaderWarmupPending,generation:u?.shaderWarmupGeneration,phase:u?.progressiveStartup?.phase,gi:u?.indirectLighting?.state,preparation:u?.viewportPreparation,ambientBudget:u?.ambientFillBudget,lightRevision:u?.liveLightRevision,geometry:s?.gl.info.memory,camera:s?.camera.position.toArray(),viewport:s&&[s.gl.domElement.width,s.gl.domElement.height]};render.calls=render.cpuMs=ambient.calls=ambient.cpuMs=0;Object.values(passes).forEach(row=>{row.calls=row.cpuMs=0});return result},
    variant(name){variant=name;this.previousFill=name==='previous';const s=previewState();if(name==='previous'){for(const subscriber of s.internal.subscribers)if(subscriber.ref===ambientRef)subscriber.ref.current=ambientWrapped;s.scene.traverse(o=>{if(o.userData.houseDesignerRole==='ambient-fill')o.intensity=.64;if(o.userData.houseDesignerRole==='ambient-sky-fill')o.intensity=0})}s.scene.userData.liveLightRevision=(s.scene.userData.liveLightRevision??0)+1;s.invalidate()},
    stop(){active=false;clearInterval(install);this.previousFill=false;if(ambientRef&&ambientOriginal)ambientRef.current=ambientOriginal;restorers.reverse().forEach(restore=>restore())},
  }
}
