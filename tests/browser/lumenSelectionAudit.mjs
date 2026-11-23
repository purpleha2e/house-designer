export async function auditWallSelection(browser,profileCPU=true){
  if(profileCPU){
    await browser.call('Profiler.enable')
    await browser.call('Profiler.setSamplingInterval',{interval:1000})
  }
  await browser.evaluate(`(async()=>{
    const s=perfScene(),r=s.gl,g=r.getContext()
    const {scene}=s, pickOps=[],tasks=[],frames=[]
    const props=()=>{
      const host=document.getElementById('root'),key=Object.keys(host).find(k=>k.startsWith('__reactContainer$'))
      const queue=[host[key]?.stateNode?.current]
      while(queue.length){const f=queue.pop();if(!f)continue;if((f.type?.name??f.type?.type?.name)==='ThreeDView')return f.memoizedProps;queue.push(f.sibling,f.child)}
    }
    const counters=()=>{
      const u=scene.userData,gi=u.lumenGI,ctx=g.__rendererAudit
      return {builds:gi.geometryBuilds,bvhs:gi.bvhBuilds,misses:gi.cacheMisses,relights:gi.relights,
        daylight:gi.daylightReady,feedback:gi.bounceReady,cache:[...gi.cacheProfile.submissions],
        programs:{...u.viewportShaderAudit.totals},textures:ctx.textureUploads,buffers:ctx.bufferUploads}
    }
    for(const [obj,name] of [[r,'readRenderTargetPixels'],[r,'readRenderTargetPixelsAsync'],[r,'render'],[g,'readPixels'],[g,'getBufferSubData'],[g,'clientWaitSync']]){
      const original=obj[name];obj[name]=function(...args){const at=performance.now();try{return original.apply(this,args)}finally{
        const ms=performance.now()-at
        if(window.selectionTrial&&((name!=='render'&&ms>=.1)||ms>=8||r.getRenderTarget()?.texture?.name?.includes('Pick')))
          pickOps.push({name,at,ms,target:r.getRenderTarget()?.texture?.name,size:r.getRenderTarget()&&[r.getRenderTarget().width,r.getRenderTarget().height]})
      }}
    }
    const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration}))))
    observer.observe({type:'longtask'})
    let last=performance.now();function tick(now){if(window.selectionTrial)frames.push(now-last);last=now;requestAnimationFrame(tick)}requestAnimationFrame(tick)
    r.domElement.addEventListener('pointerup',()=>{if(window.selectionTrial)window.selectionTrial.pointerUp??=performance.now()},true)
    window.selectionMeasure={start:()=>{pickOps.length=tasks.length=frames.length=0;const p=props()
      return window.selectionTrial={start:performance.now(),surface:p?.selectedSurface,wall:p?.selectedWallId,counters:counters()}},
      result:()=>{const p=props(),u=scene.userData,trial=window.selectionTrial;window.selectionTrial=null
        return {trial,surface:p?.selectedSurface,wall:p?.selectedWallId,counters:counters(),maxFrameGap:Math.max(0,...frames),tasks,pickOps,cacheState:u.lumenGI.state,
          pickLog:window.houseDesignerEngineLog?.entries.filter(e=>e.type==='color-pick').at(-1)}}}
  })()`)
  const rows=[]
  for(const [u,v] of [[.34,.55],[.66,.43],[.40,.42]]){
    const point=await browser.evaluate(`(()=>{const r=perfScene().gl.domElement.getBoundingClientRect();return {x:r.x+r.width*${u},y:r.y+r.height*${v}}})()`)
    await browser.evaluate('selectionMeasure.start()')
    if(profileCPU)await browser.call('Profiler.start')
    await browser.call('Input.dispatchMouseEvent',{...point,type:'mousePressed',button:'left',buttons:1,clickCount:1})
    await browser.call('Input.dispatchMouseEvent',{...point,type:'mouseReleased',button:'left',buttons:0,clickCount:1})
    await browser.evaluate('new Promise(resolve=>setTimeout(resolve,850))')
    const row=await browser.evaluate('selectionMeasure.result()')
    rows.push(row)
    if(!profileCPU)continue
    const {profile}=await browser.call('Profiler.stop')
    const hottest=new Map(),nodes=new Map(profile.nodes.map(node=>[node.id,node])),parents=new Map()
    for(const node of profile.nodes)for(const child of node.children??[])parents.set(child,node.id)
    for(const [i,id] of profile.samples.entries()){
      const stack=[]
      for(let node=nodes.get(id);node&&stack.length<8;node=nodes.get(parents.get(node.id))){
        const f=node.callFrame, source=f.url.split('/').at(-1)?.split('?')[0]
        stack.push(`${f.functionName||'(anonymous)'} ${source}:${f.lineNumber+1}`)
      }
      if(stack[0].startsWith('(idle)')||stack[0].startsWith('(root)'))continue
      const key=stack.join(' ← ')
      hottest.set(key,(hottest.get(key)??0)+profile.timeDeltas[i]/1000)
    }
    row.hotspots=Array.from(hottest).sort((a,b)=>b[1]-a[1]).slice(0,32)
  }
  if(profileCPU)await browser.call('Profiler.disable')
  return rows
}
