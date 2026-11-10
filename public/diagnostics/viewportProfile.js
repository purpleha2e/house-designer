// Loaded only on explicit request from DevTools. Never creates a renderer,
// changes scene settings, submits a draw, or waits synchronously for the GPU.
let active = false
const scalar = value => value && Object.fromEntries(Object.entries(value).filter(([,v]) =>
  v == null || ['boolean','number','string'].includes(typeof v)))

// Sharing is bounded independently of scene size. Keep full detail out of the
// clipboard and Console; it can be downloaded as a file when needed.
export function summarizeProfile(value) {
  const profile=typeof value==='string'?JSON.parse(value):value
  if(!profile || !Array.isArray(profile.samples))throw Error('No completed viewport profile was found.')
  const round=value=>Number.isFinite(value)?Math.round(value*100)/100:null
  const short=value=>String(value??'').slice(0,100)
  const samples=profile.samples.filter(s=>s.elapsedMs>=250&&!s.hidden)
  const sum=key=>samples.reduce((total,s)=>total+(s[key]??0),0)
  const elapsed=sum('elapsedMs'),frames=sum('displayFrames')
  const aggregate=(key,identity)=>{
    const rows=new Map()
    for(const sample of samples)for(const item of sample[key]??[]){
      const id=identity(item),row=rows.get(id)??{id,calls:0,cpuMs:0}
      row.calls+=item.calls??0;row.cpuMs+=item.cpuMs??0;rows.set(id,row)
    }
    return [...rows.values()].sort((a,b)=>b.cpuMs-a.cpuMs).slice(0,5)
      .map(row=>({id:row.id,msPerFrame:round(row.cpuMs/Math.max(1,frames)),callsPerFrame:round(row.calls/Math.max(1,frames))}))
  }
  const gpu=new Map()
  for(const row of profile.gpu??[]){const id=short(row.pass),values=gpu.get(id)??[];values.push(row.ms);gpu.set(id,values)}
  const result={graphics:short(profile.graphics),seconds:round(elapsed/1000),displayFps:round(frames*1000/elapsed),
    callbackFps:round(sum('callbackFrames')*1000/elapsed),
    focusedSamples:samples.filter(s=>s.focused).length,visibleSamples:samples.length,
    hiddenSamples:profile.samples.filter(s=>s.hidden).length,
    trigger:profile.trigger&&{fps:round(profile.trigger.fps),waitedSeconds:round(profile.trigger.waitedMs/1000)},
    cpuPasses:aggregate('passes',row=>short(row.name)),
    cpuCallbacks:aggregate('callbacks',row=>row.index),cpuMatrices:aggregate('matrices',row=>row.index),
    gpuPasses:[...gpu].slice(0,5).map(([name,values])=>({name,samples:values.length,
      meanMs:round(values.reduce((a,b)=>a+b,0)/values.length),maxMs:round(values.reduce((a,b)=>Math.max(a,b),0))})),
    timeline:profile.samples.filter(s=>s.elapsedMs>=250).slice(0,12).map(s=>({second:round(s.at/1000),fps:round(s.displayFps),
      hidden:!!s.hidden,focused:!!s.focused,gi:short(s.lighting?.state),warm:!!s.warm,
      viewport:s.viewport?.slice(0,2),programs:s.programs,drawsPerFrame:round((s.native?.draws??0)/Math.max(1,s.displayFrames))})),
    errors:(profile.errors??[]).slice(0,2).map(short)}
  const text=JSON.stringify(result)
  // Guard future additions too: an unexpectedly large summary is never copied.
  return text.length<=5000?text:JSON.stringify({displayFps:result.displayFps,seconds:result.seconds,
    cpuPasses:result.cpuPasses,gpuPasses:result.gpuPasses,note:'Full detail available by file download.'})
}

export async function downloadProfile(value=window.extaplanProfileRaw??window.extaplanProfile) {
  value=await value
  if(!value || (typeof value!=='string' && !Array.isArray(value.samples)))
    throw Error('No completed profile remains in this tab. No new capture was started.')
  const blob=new Blob([typeof value==='string'?value:JSON.stringify(value)],{type:'application/json'})
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download='extaplan-viewport-profile.json'
  document.body.append(link)
  try{link.click()}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  return `Downloaded extaplan-viewport-profile.json (${Math.round(blob.size/1024)} KB).`
}

function finishCapture(profile) {
  window.extaplanProfileRaw=profile
  return summarizeProfile(profile)
}

export function findRuntime() {
  const el = document.getElementById('root')
  const key = el && Object.keys(el).find(k => k.startsWith('__reactContainer$'))
  let scene, composer
  const walk = fiber => {
    if (!fiber) return
    if (fiber.memoizedProps?.floors && 'showAllFloors' in fiber.memoizedProps) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const value = hook.memoizedState?.current
        if (value?.isScene) scene = value
        if (value?.passes && typeof value.render === 'function') composer = value
      }
    }
    walk(fiber.child); walk(fiber.sibling)
  }
  walk(el?.[key]?.stateNode?.current)
  const renderer = composer?.getRenderer?.() ?? composer?.renderer
  if (!scene || !composer || !renderer) throw Error('The finished 3D view is not available for profiling.')
  return {scene, composer, renderer}
}

export async function profileRuntime({scene, composer, renderer}, {durationMs=12000, sampleMs=1000, gpuTimers=true}={}) {
  const started = performance.now(), restorers=[], pending=[], samples=[], gpu=[], errors=[], visibility=[]
  const gl = renderer.getContext()
  const ext = !gpuTimers || composer.passes.some(pass => pass.debugMode) ? null : gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const device = gl.getExtension('WEBGL_debug_renderer_info')
  const graphics = gl.getParameter(device ? device.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
  const passes = composer.passes.map((pass,index) => ({index, name:'renderTransparency' in pass ? 'AO' : pass.name || `Pass ${index}`, calls:0, cpuMs:0}))
  const native = {draws:0, drawCpuMs:0, uploads:0, uploadCpuMs:0, uploadedBytes:0, inspections:0, inspectionCpuMs:0}
  const subscribers = scene.__r3f?.root?.getState?.().internal?.subscribers ?? []
  const callbacksCpu = subscribers.map((subscriber,index)=>({index,priority:subscriber.priority,
    source:String(subscriber.ref.current).slice(0,180),calls:0,cpuMs:0}))
  const matrices = [...new Set([scene,...composer.passes.map(pass=>pass.scene)].filter(Boolean))]
    .map((object,index)=>({object,index,calls:0,cpuMs:0}))
  const dispatch = {sampledCalls:0,sampledCpuMs:0,sampleEvery:16,totalCalls:0}
  let timer, frameTimer, previousFrame, callbacks=0, frames=0, sampleStarted=started, sampleCallbacks=0, sampleFrames=0, selected=-1, disjoint=0
  const wrap = (owner,key,create) => {
    const original=owner[key]
    if (typeof original !== 'function') return
    const replacement=create(original)
    owner[key]=replacement
    restorers.push(()=>{if(owner[key]===replacement)owner[key]=original})
  }
  const poll = () => {
    if (!ext) return
    const invalid=gl.isContextLost() || gl.getParameter(ext.GPU_DISJOINT_EXT)
    if (invalid) disjoint++
    for (let i=pending.length-1;i>=0;i--) {
      const row=pending[i]
      if (!invalid && !gl.getQueryParameter(row.query,gl.QUERY_RESULT_AVAILABLE)) continue
      if (!invalid) gpu.push({at:performance.now()-started,pass:row.pass,ms:gl.getQueryParameter(row.query,gl.QUERY_RESULT)/1e6})
      gl.deleteQuery(row.query);pending.splice(i,1)
    }
  }
  const sample = () => {
    poll()
    const now=performance.now(), u=scene.userData
    samples.push({at:now-started,elapsedMs:now-sampleStarted,callbackFrames:callbacks-sampleCallbacks,
      displayFrames:frames-sampleFrames,callbackFps:(callbacks-sampleCallbacks)*1000/(now-sampleStarted),
      displayFps:(frames-sampleFrames)*1000/(now-sampleStarted),hidden:document.hidden,focused:document.hasFocus(),
      warm:u.shaderWarmupPending,lighting:scalar(u.indirectLighting),preparation:u.viewportPreparation,
      ambient:u.ambientFillBudget,lightRevision:u.liveLightRevision,phase:u.progressiveStartup?.phase,
      native:{...native},passes:passes.map(row=>({...row})),programs:renderer.info.programs?.length,
      callbacks:callbacksCpu.map(row=>({...row})),matrices:matrices.map(({index,calls,cpuMs})=>({index,calls,cpuMs})),
      dispatch:{...dispatch},resources:{...renderer.info.memory},viewport:[renderer.domElement.width,renderer.domElement.height],
      clientSize:[renderer.domElement.clientWidth,renderer.domElement.clientHeight],devicePixelRatio:window.devicePixelRatio})
    for(const row of passes){row.calls=0;row.cpuMs=0}
    for(const row of [...callbacksCpu,...matrices]){row.calls=0;row.cpuMs=0}
    dispatch.sampledCalls=0;dispatch.sampledCpuMs=0;dispatch.totalCalls=0
    for(const key of Object.keys(native))native[key]=0
    sampleStarted=now;sampleCallbacks=callbacks;sampleFrames=frames
  }
  try {
    const recordVisibility=()=>visibility.push({at:performance.now()-started,hidden:document.hidden,focused:document.hasFocus()})
    for(const [target,event] of [[document,'visibilitychange'],[window,'focus'],[window,'blur']]){
      target.addEventListener?.(event,recordVisibility)
      restorers.push(()=>target.removeEventListener?.(event,recordVisibility))
    }
    recordVisibility()
    subscribers.forEach((subscriber,index)=>wrap(subscriber.ref,'current',original=>function(...args){
      const at=performance.now();try{return original.apply(this,args)}finally{callbacksCpu[index].calls++;callbacksCpu[index].cpuMs+=performance.now()-at}
    }))
    for(const row of matrices)wrap(row.object,'updateMatrixWorld',original=>function(...args){
      const at=performance.now();try{return original.apply(this,args)}finally{row.calls++;row.cpuMs+=performance.now()-at}
    })
    wrap(renderer,'renderBufferDirect',original=>function(...args){
      if(dispatch.totalCalls++%dispatch.sampleEvery!==0)return original.apply(this,args)
      const at=performance.now();try{return original.apply(this,args)}finally{dispatch.sampledCalls++;dispatch.sampledCpuMs+=performance.now()-at}
    })
    for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(gl,key,original=>function(...args){const at=performance.now();try{return original.apply(this,args)}finally{native.draws++;native.drawCpuMs+=performance.now()-at}})
    for(const key of ['bufferData','bufferSubData','texImage2D','texSubImage2D','texImage3D','texSubImage3D'])wrap(gl,key,original=>function(...args){const at=performance.now();try{return original.apply(this,args)}finally{native.uploads++;native.uploadCpuMs+=performance.now()-at;for(const arg of args)if(ArrayBuffer.isView(arg))native.uploadedBytes+=arg.byteLength}})
    for(const key of ['getProgramParameter','getActiveUniform','getActiveAttrib','getUniformLocation'])wrap(gl,key,original=>function(...args){const at=performance.now();try{return original.apply(this,args)}finally{native.inspections++;native.inspectionCpuMs+=performance.now()-at}})
    wrap(composer,'render',original=>function(...args){
      // One sampled pass per five display frames; avoid nested timer queries.
      selected=frames%5===0 ? Math.floor(frames/5)%passes.length : -1
      frames++
      return original.apply(this,args)
    })
    composer.passes.forEach((pass,index)=>wrap(pass,'render',original=>function(...args){
      const at=performance.now(),row=passes[index]
      let query
      if(ext && selected===index && pending.length<8 && !gl.isContextLost() && !gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)) {
        query=gl.createQuery()
        if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query)
      }
      try{return original.apply(this,args)}
      catch(error){errors.push(String(error));throw error}
      finally{
        if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({query,pass:row.name})}
        row.calls++;row.cpuMs+=performance.now()-at
      }
    }))
    const frame=now=>{if(previousFrame!==undefined)callbacks++;previousFrame=now;frameTimer=requestAnimationFrame(frame)}
    frameTimer=requestAnimationFrame(frame)
    timer=setInterval(sample,Math.max(10,sampleMs))
    await new Promise(resolve=>setTimeout(resolve,Math.max(25,Math.min(durationMs,30000))))
    clearInterval(timer);timer=undefined
    sample()
    // Bounded, asynchronous query drain. Unfinished samples are discarded.
    for(let i=0;pending.length&&i<10;i++){await new Promise(resolve=>setTimeout(resolve,20));poll()}
    return {graphics,gpuTimers:!!ext,disjoint,elapsedMs:performance.now()-started,samples,gpu,errors,visibility,
      log:window.houseDesignerEngineLog?.recent(15)}
  } finally {
    if(timer!==undefined)clearInterval(timer)
    if(frameTimer!==undefined)cancelAnimationFrame(frameTimer)
    restorers.reverse().forEach(restore=>restore())
    for(const row of pending)gl.deleteQuery(row.query)
  }
}

export async function capture(seconds=12) {
  if(active)throw Error('A viewport capture is already running.')
  active=true
  try{return finishCapture(await profileRuntime(findRuntime(),{durationMs:seconds*1000}))}
  finally{active=false}
}

// Wait without installing GPU/renderer instrumentation. Visibility changes reset
// the window so background throttling cannot trigger a slow-state capture.
export function waitForSlow(runtime, {thresholdFps=40,windowMs=1000,slowWindows=2,maxWaitMs=120000,onStatus=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
    const started=performance.now(),composer=runtime.composer,original=composer.render
    let frameId,timeout,frames=0,windowStarted,consecutive=0,finished=false
    const replacement=function(...args){frames++;return original.apply(this,args)}
    const reset=()=>{windowStarted=undefined;frames=0;consecutive=0}
    const listeners=[[document,'visibilitychange'],[window,'focus'],[window,'blur']]
    const finish=(error,result)=>{
      if(finished)return
      finished=true;cancelAnimationFrame(frameId);clearTimeout(timeout)
      for(const [target,event] of listeners)target.removeEventListener?.(event,reset)
      if(composer.render===replacement)composer.render=original
      if(error)reject(error);else resolve(result)
    }
    composer.render=replacement
    for(const [target,event] of listeners)target.addEventListener?.(event,reset)
    const frame=now=>{
      if(document.hidden || !document.hasFocus()){
        reset();onStatus('Waiting: click the 3D view and keep it visible')
      }else if(windowStarted===undefined){
        windowStarted=now;frames=0;onStatus('Watching for a sustained slowdown (up to 2 minutes)')
      }else if(now-windowStarted>=windowMs){
        const fps=frames*1000/(now-windowStarted)
        consecutive=fps<thresholdFps?consecutive+1:0
        onStatus(`Watching: ${Math.round(fps)} FPS`)
        if(consecutive>=slowWindows){finish(null,{fps,waitedMs:now-started});return}
        windowStarted=now;frames=0
      }
      frameId=requestAnimationFrame(frame)
    }
    frameId=requestAnimationFrame(frame)
    timeout=setTimeout(()=>finish(Error('No sustained foreground slowdown captured.')),maxWaitMs)
  })
}

export async function captureSlow(seconds=8) {
  if(active)throw Error('A viewport capture is already running.')
  active=true
  const notice=document.createElement('div')
  notice.style.cssText='position:fixed;top:50px;right:12px;z-index:2147483647;padding:10px;background:#17263a;color:white;font:14px sans-serif;pointer-events:none;max-width:340px'
  notice.textContent='Waiting: click the 3D view and keep it visible'
  document.body.append(notice)
  try{
    const runtime=findRuntime()
    const trigger=await waitForSlow(runtime,{onStatus:text=>{notice.textContent=text}})
    notice.textContent=`Capturing for ${seconds} seconds: keep the 3D view active`
    const result=await profileRuntime(runtime,{durationMs:seconds*1000})
    notice.textContent='Capture complete. extaplanProfile contains a short summary; full detail is available by download.'
    return finishCapture({...result,trigger})
  }catch(error){notice.textContent=String(error);throw error}
  finally{active=false;setTimeout(()=>notice.remove(),15000)}
}
