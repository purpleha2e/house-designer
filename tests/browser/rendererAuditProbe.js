import {getEditorFiber} from './rendererTestModules.ts'
import {getIndirectLightingUniforms} from '../../src/indirectLightingShader.ts'
import {ACESFilmicToneMapping,Object3D} from './rendererTestModules.ts'
import {getRoomLightUniforms} from '../../src/roomLightShader.ts'

const sum=a=>a.reduce((x,y)=>x+y,0)
const distribution=a=>{const s=[...a].sort((x,y)=>x-y),q=p=>s[Math.min(s.length-1,Math.floor(s.length*p))]??null;return{count:s.length,mean:s.length?sum(s)/s.length:null,median:q(.5),p95:q(.95),p99:q(.99),worst:q(1)}}
const samplerDeclarations=source=>{const names=new Set();for(const m of source.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?[iu]?sampler\w+\s+([^;]+);/g))for(const part of m[1].split(',')){const name=part.trim().match(/^\w+/)?.[0];if(name)names.add(name)}return names}
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('')
function findComposer(fiber){if(!fiber)return null;const value=fiber.memoizedProps?.composer?.current;if(value?.passes)return value;return findComposer(fiber.child)||findComposer(fiber.sibling)}

export async function installRendererAudit(s){
 const r=s.gl,g=r.getContext(),native=g.__rendererAudit,timer=g.getExtension('EXT_disjoint_timer_query_webgl2')
 const composer=findComposer(getEditorFiber());if(!composer)throw Error('Actual EffectComposer not found')
 const ao=composer.passes.find(p=>p.configuration&&typeof p.configuration.aoRadius==='number')
 const names=['MAX_TEXTURE_IMAGE_UNITS','MAX_VERTEX_TEXTURE_IMAGE_UNITS','MAX_COMBINED_TEXTURE_IMAGE_UNITS','MAX_3D_TEXTURE_SIZE','MAX_ARRAY_TEXTURE_LAYERS','MAX_TEXTURE_SIZE','MAX_CUBE_MAP_TEXTURE_SIZE','MAX_COLOR_ATTACHMENTS','MAX_DRAW_BUFFERS','MAX_FRAGMENT_UNIFORM_VECTORS','MAX_VERTEX_UNIFORM_VECTORS']
 const debug=g.getExtension('WEBGL_debug_renderer_info'),limits=Object.fromEntries(names.map(n=>[n,g.getParameter(g[n])]))
 const original={render:r.render.bind(r),shadow:r.shadowMap.render.bind(r.shadowMap),compose:composer.render.bind(composer),setTarget:r.setRenderTarget.bind(r),toneMapping:r.toneMapping}
 const gi=new Set(),room=new Set(),materials=new Set(),textureLabels=new Map(),targets=new Map(),targetIds=new WeakMap()
 const samplerTypes=new Map(['SAMPLER_2D','SAMPLER_CUBE','SAMPLER_3D','SAMPLER_2D_SHADOW','SAMPLER_CUBE_SHADOW','SAMPLER_2D_ARRAY','SAMPLER_2D_ARRAY_SHADOW','INT_SAMPLER_2D','INT_SAMPLER_3D','INT_SAMPLER_CUBE','INT_SAMPLER_2D_ARRAY','UNSIGNED_INT_SAMPLER_2D','UNSIGNED_INT_SAMPLER_3D','UNSIGNED_INT_SAMPLER_CUBE','UNSIGNED_INT_SAMPLER_2D_ARRAY'].map(n=>[g[n],n]))
 const samplerBinding=type=>/CUBE/.test(type)?[g.TEXTURE_CUBE_MAP,g.TEXTURE_BINDING_CUBE_MAP]:/3D/.test(type)?[g.TEXTURE_3D,g.TEXTURE_BINDING_3D]:/ARRAY/.test(type)?[g.TEXTURE_2D_ARRAY,g.TEXTURE_BINDING_2D_ARRAY]:[g.TEXTURE_2D,g.TEXTURE_BINDING_2D]
 const labelTexture=(texture,label)=>{if(!texture?.isTexture)return;const handle=r.properties.get(texture).__webglTexture,id=handle&&native.ids.get(handle);if(id){let list=textureLabels.get(id);if(!list)textureLabels.set(id,list=new Set());list.add(label)}}
 const trackTarget=target=>{if(!target)return null;let id=targetIds.get(target);if(!id){id=targets.size+1;targetIds.set(target,id);target.addEventListener('dispose',()=>{const record=targets.get(id);if(record)record.disposed=true})}
  let record=targets.get(id);if(!record||record.width!==target.width||record.height!==target.height){record={id,width:target.width,height:target.height,depth:target.depth,samples:target.samples,multiview:target.multiview,depthBuffer:target.depthBuffer,depthTexture:!!target.depthTexture,textures:target.textures.map(t=>({uuid:t.uuid,name:t.name,type:t.type,format:t.format,internalFormat:t.internalFormat,colorSpace:t.colorSpace,mipmaps:t.generateMipmaps}))};targets.set(id,record)}return id}
 const refresh=()=>{s.scene.traverse(o=>{const shadow=o.shadow;if(shadow?.map){trackTarget(shadow.map);labelTexture(shadow.map.depthTexture,`${o.userData.houseDesignerRole??o.type}.shadow.depth`);labelTexture(shadow.map.texture,`${o.type}.shadow.color`)}
  for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);const a=getIndirectLightingUniforms(m),b=getRoomLightUniforms(m);if(a)gi.add(a);if(b)room.add(b);for(const [key,v]of Object.entries(m))if(v?.isTexture)labelTexture(v,`${m.name||m.type}.${key}`);const u=r.properties.get(m).uniforms;for(const [key,v]of Object.entries(u??{}))if(v?.value?.isTexture)labelTexture(v.value,`uniform.${key}`)}});labelTexture(s.scene.environment,'scene.environment');labelTexture(s.scene.background,'scene.background');for(const value of Object.values(composer))if(value?.isWebGLRenderTarget)trackTarget(value);for(const pass of composer.passes)for(const [key,value]of Object.entries(pass))if(value?.isWebGLRenderTarget)trackTarget(value)}
 refresh();const sharedGI=s.scene.userData.getIndirectUniforms?.();if(sharedGI)gi.add(sharedGI)
 let active=false,passMode=false,captureBindings=false,currentPass='outside-composer',renderContext=null,rootDepth=0,queryOpen=null
 let cpu=[],gpu=[],passData=new Map(),rootFrames=0,rootRenderCalls=0,pending=[],lastSampleConfig={},activeMaterial=null
 const samplerReports=new Map(),programSeen=new WeakSet(),callbackWrappers=new Map()
 let callbackData=new Map()
 const getPass=key=>{let v=passData.get(key);if(!v)passData.set(key,v={executions:0,cpuMs:0,gpuMs:[],calls:0,triangles:0,switches:0,target:null});return v}
 const beginQuery=label=>{if(!active||!timer||queryOpen||pending.length>128)return null;const query=g.createQuery();g.beginQuery(timer.TIME_ELAPSED_EXT,query);queryOpen={query,label};return queryOpen}
 const endQuery=token=>{if(!token||queryOpen!==token)return;g.endQuery(timer.TIME_ELAPSED_EXT);pending.push(token);queryOpen=null}
 const poll=()=>{const disjoint=timer&&g.getParameter(timer.GPU_DISJOINT_EXT);for(let i=pending.length-1;i>=0;i--){const p=pending[i];if(!g.getQueryParameter(p.query,g.QUERY_RESULT_AVAILABLE))continue;const ms=g.getQueryParameter(p.query,g.QUERY_RESULT)/1e6;if(!disjoint){if(p.label==='frame')gpu.push(ms);else getPass(p.label).gpuMs.push(ms)}g.deleteQuery(p.query);pending.splice(i,1)}}
 const targetLabel=target=>{const id=trackTarget(target);return target?`target${id}:${target.width}x${target.height}`:'canvas'}
 const partLabel=(object,camera)=>{const override=object.overrideMaterial,mat=object.material;return`${currentPass}/${object===s.scene?'house':object.userData?.preparedLightingViewport?'prepared-house':object.type}/${camera.type}/${override?.type??mat?.name??mat?.type??'scene-materials'}/${targetLabel(r.getRenderTarget())}`}
 const renderCore=(...args)=>{
  if(!active)return original.render(...args)
  const label=partLabel(...args),context={label,shadowCpu:0,shadowCalls:0,shadowTriangles:0,token:null},previous=renderContext
  renderContext=context;const at=performance.now(),calls=r.info.render.calls,tri=r.info.render.triangles,switches=native.switches
  try{return original.render(...args)}finally{endQuery(context.token);const row=getPass(label);row.executions++;row.cpuMs+=performance.now()-at-context.shadowCpu;row.calls+=r.info.render.calls-calls-context.shadowCalls;row.triangles+=r.info.render.triangles-tri-context.shadowTriangles;row.switches+=native.switches-switches;row.target=r.getRenderTarget()?targets.get(trackTarget(r.getRenderTarget())):null;rootRenderCalls++;renderContext=previous}
 }
 r.render=(...args)=>renderCore(...args)
 r.shadowMap.render=(...args)=>{
  if(!active)return original.shadow(...args)
  const context=renderContext,label=`${currentPass}/shadow-map-dispatch`,at=performance.now(),calls=r.info.render.calls,tri=r.info.render.triangles
  const token=passMode?beginQuery(label):null
  try{return original.shadow(...args)}finally{endQuery(token);const duration=performance.now()-at,row=getPass(label),deltaCalls=r.info.render.calls-calls,deltaTri=r.info.render.triangles-tri;row.executions++;row.cpuMs+=duration;row.calls+=deltaCalls;row.triangles+=deltaTri;if(context){context.shadowCpu+=duration;context.shadowCalls+=deltaCalls;context.shadowTriangles+=deltaTri;if(passMode)context.token=beginQuery(context.label)}}
 }
 let postprocess=true
 composer.render=(...args)=>{
  if(ao&&lastSampleConfig.ao!==undefined)ao.enabled=lastSampleConfig.ao
  if(lastSampleConfig.giShader===false)for(const [u]of savedGI)u.hdGIEnabled.value=0
  if(lastSampleConfig.probeGI===false)for(const [u]of savedGI)u.hdGIProbeStrength.value=0
  if(!active)return postprocess?original.compose(...args):original.render(s.scene,s.camera)
  const outer=rootDepth++===0,at=performance.now(),token=outer&&!passMode?beginQuery('frame'):null
  try{return postprocess?original.compose(...args):renderCore(s.scene,s.camera)}finally{endQuery(token);rootDepth--;if(outer){rootFrames++;cpu.push(performance.now()-at)}}
 }
 for(const [index,pass]of composer.passes.entries()){const render=pass.render.bind(pass);pass.render=(...args)=>{const previous=currentPass;currentPass=`${index}:${pass.constructor.name}${pass.effects?'('+pass.effects.map(e=>e.name||e.constructor.name).join('+')+')':''}`;try{return render(...args)}finally{currentPass=previous}}}
 const direct=r.renderBufferDirect.bind(r)
 r.renderBufferDirect=(...args)=>{const before=activeMaterial;activeMaterial=args[3];try{return direct(...args)}finally{activeMaterial=before}}
 function introspect(explicitProgram){
  if(!captureBindings)return
  const program=explicitProgram??g.getParameter(g.CURRENT_PROGRAM);if(!program||programSeen.has(program))return;programSeen.add(program)
  const wrapper=r.info.programs.find(p=>p.program===program);if(!wrapper)return
  const vertex=g.getShaderSource(wrapper.vertexShader)??'',fragment=g.getShaderSource(wrapper.fragmentShader)??''
  const stages={vertex:samplerDeclarations(vertex),fragment:samplerDeclarations(fragment)},samplers=[],units={vertex:new Set(),fragment:new Set(),combined:new Set()},conflicts=new Map(),slot=g.getParameter(g.ACTIVE_TEXTURE)
  try{for(let i=0,n=g.getProgramParameter(program,g.ACTIVE_UNIFORMS);i<n;i++){
   const info=g.getActiveUniform(program,i),type=samplerTypes.get(info.type);if(!type)continue
   const base=info.name.replace(/\[\d+\].*$/,''),assigned=Array.from({length:info.size},(_,index)=>g.getUniform(program,g.getUniformLocation(program,info.size>1?info.name.replace('[0]',`[${index}]`):info.name))),stage=Object.keys(stages).filter(s=>stages[s].has(base)),bindings=[]
   for(const unit of assigned){units.combined.add(unit);for(const s of stage)units[s].add(unit);let kinds=conflicts.get(unit);if(!kinds)conflicts.set(unit,kinds=new Set());kinds.add(type);const [target,binding]=samplerBinding(type);if(!explicitProgram){g.activeTexture(g.TEXTURE0+unit);const texture=g.getParameter(binding),id=texture&&native.ids.get(texture);if(id&&!textureLabels.has(id))textureLabels.set(id,new Set([`bound.${base}`]));bindings.push({unit,target,textureId:id??null,labels:id?[...textureLabels.get(id)??[]]:[]})}}
   samplers.push({name:info.name,type,size:info.size,stages:stage,units:assigned,bindings})
  }}finally{g.activeTexture(slot)}
  const id=native.ids.get(program)
  samplerReports.set(id,{id,observedAtDraw:!explicitProgram,programName:wrapper?.name,material:!explicitProgram&&activeMaterial&&{name:activeMaterial.name,type:activeMaterial.type,uuid:activeMaterial.uuid,cacheKey:activeMaterial.customProgramCacheKey()},activeSamplers:samplers,stageUnits:Object.fromEntries(Object.entries(units).map(([k,v])=>[k,[...v].sort((a,b)=>a-b)])),conflicts:[...conflicts].filter(([,v])=>v.size>1).map(([unit,types])=>({unit,types:[...types]})),vertex,fragment,cacheKey:wrapper?.cacheKey})
 }
 for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const fn=g[name];if(fn)g[name]=function(...a){introspect();return fn.apply(this,a)}}
 const multi=g.getExtension('WEBGL_multi_draw');if(multi)for(const name of ['multiDrawArraysWEBGL','multiDrawElementsWEBGL','multiDrawArraysInstancedWEBGL','multiDrawElementsInstancedWEBGL']){const fn=multi[name];if(fn)multi[name]=function(...a){introspect();return fn.apply(this,a)}}
 const savedGI=[...gi].map(u=>[u,u.hdGIEnabled.value,u.hdGIProbeStrength.value]),savedRoom=[...room].map(u=>[u,u.enabled.value]),savedAO=ao?.enabled
 async function configure(options={}){
  active=false;postprocess=options.postprocess!==false;r.toneMapping=postprocess?original.toneMapping:ACESFilmicToneMapping;if(ao)ao.enabled=options.ao===false?false:savedAO
  for(const [u,enabled,strength]of savedGI){u.hdGIEnabled.value=options.giShader===false?0:enabled;u.hdGIProbeStrength.value=options.probeGI===false?0:strength}
  for(const [u,enabled]of savedRoom)u.enabled.value=options.roomVisibility===false?0:enabled
  lastSampleConfig={postprocess,ao:ao?.enabled,giShader:options.giShader!==false,probeGI:options.probeGI!==false,roomVisibility:options.roomVisibility!==false}
  if(!postprocess){const target=r.getRenderTarget();try{r.setRenderTarget(null);await r.compileAsync(s.scene,s.camera)}finally{r.setRenderTarget(target)}}
  s.scene.userData.displayEffectRevision=(s.scene.userData.displayEffectRevision??0)+1;s.invalidate()
  await new Promise(resolve=>setTimeout(resolve,600))
 }
 function snapshot(){refresh();const errors=[];for(let i=0;i<8;i++){const e=g.getError();if(!e)break;errors.push(e)}
  return{hardware:{vendor:g.getParameter(debug?debug.UNMASKED_VENDOR_WEBGL:g.VENDOR),renderer:g.getParameter(debug?debug.UNMASKED_RENDERER_WEBGL:g.RENDERER),version:g.getParameter(g.VERSION),limits,timer:!!timer},canvas:{width:r.domElement.width,height:r.domElement.height,dpr:r.getPixelRatio()},camera:{position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray()},three:{textures:r.info.memory.textures,geometries:r.info.memory.geometries,programs:r.info.programs.length},native:{live:Object.fromEntries(Object.entries(native.live).map(([k,v])=>[k,v.size])),textureUploads:native.textureUploads,bufferUploads:native.bufferUploads,compileCalls:native.compileCalls,compileCpuMs:native.compileCpuMs,linkCalls:native.linkCalls,events:native.events},targets:[...targets.values()],textures:[...native.textures.values()].map(t=>({...t,labels:[...textureLabels.get(t.id)??[]]})),buffers:[...native.buffers.values()],renderbuffers:[...native.renderbuffers.values()],programTiming:[...native.programs.values()],effectiveGI:[...gi].map(u=>({enabled:u.hdGIEnabled.value,strength:u.hdGIProbeStrength.value,volume:u.hdGIUseVolume.value})),passEnabled:composer.passes.map(p=>p.enabled),workers:window.rendererAuditWorkers.map(w=>({...w,kinds:{...w.kinds}})),reactUI:window.rendererAuditReact&&{...window.rendererAuditReact},heap:performance.memory?.usedJSHeapSize,framebuffer:g.isContextLost()?null:g.checkFramebufferStatus(g.FRAMEBUFFER),lost:g.isContextLost(),errors,health:s.scene.userData.getRendererHealth?.(false),softFloor:s.scene.userData.softFloorGI,gi:s.scene.userData.indirectLighting,config:lastSampleConfig}
 }
 function captureCallbacks(){for(const sub of s.internal.subscribers){const ref=sub.ref;if(callbackWrappers.has(ref)&&ref.current===callbackWrappers.get(ref))continue;const fn=ref.current,label=`priority${sub.priority}:${fn.name||fn.toString().slice(0,140)}`;const wrapper=(...a)=>{if(!active)return fn(...a);const at=performance.now();try{return fn(...a)}finally{let row=callbackData.get(label);if(!row)callbackData.set(label,row={calls:0,ms:0,worst:0});const dt=performance.now()-at;row.calls++;row.ms+=dt;row.worst=Math.max(row.worst,dt)}};callbackWrappers.set(ref,wrapper);ref.current=wrapper}}
 async function sample(duration=30000,moving=false,passes=false){
  const base=s.camera.position.clone(),rotation=s.camera.quaternion.clone(),before=snapshot(),frames=[];let start,last,previousFrames=0,presented=0
  cpu=[];gpu=[];passData=new Map();callbackData=new Map();rootFrames=0;rootRenderCalls=0;passMode=passes;captureCallbacks();active=true
  await new Promise(resolve=>{const tick=now=>{
   if(start===undefined){start=last=now}else{frames.push(now-last);last=now;if(rootFrames!==previousFrames){presented++;previousFrames=rootFrames}}
   poll();const t=(now-start)/1000
   if(moving){s.camera.position.copy(base);s.camera.position.x+=Math.sin(t*.8)*.25;s.camera.position.z+=Math.cos(t*.8)*.25;s.camera.quaternion.copy(rotation);s.camera.rotateY(Math.sin(t*.5)*.15);s.camera.updateMatrixWorld()}
   // A fixed image is actively rendered for a fair frame-budget measurement;
   // idle walkthroughs intentionally submit no frames. No lighting is changed.
   s.scene.userData.displayEffectRevision=(s.scene.userData.displayEffectRevision??0)+1;s.invalidate()
   if(now-start<duration){requestAnimationFrame(tick);return}resolve()
  };requestAnimationFrame(tick)})
  active=false;await new Promise(resolve=>setTimeout(resolve,100));poll();s.camera.position.copy(base);s.camera.quaternion.copy(rotation);s.camera.updateMatrixWorld();s.invalidate()
  const after=snapshot(),ms=sum(frames)
  return{durationMs:ms,frames:frames.length,animationFPS:frames.length*1000/ms,presentedFPS:presented*1000/ms,frameMs:distribution(frames),cpuFrameMs:distribution(cpu),gpuFrameMs:distribution(gpu),gpuTimingMode:passes?'per-render-pass, not whole frame':'whole composer frame',timerQueriesRemaining:pending.length,renderCalls:rootRenderCalls,passes:[...passData].map(([name,v])=>({name,...v,gpuMs:distribution(v.gpuMs),executionsPerFrame:v.executions/Math.max(1,rootFrames),cpuMsPerFrame:v.cpuMs/Math.max(1,rootFrames),drawCallsPerFrame:v.calls/Math.max(1,rootFrames),trianglesPerFrame:v.triangles/Math.max(1,rootFrames)})),callbacks:[...callbackData].map(([name,v])=>({name,...v,cpuMsPerFrame:v.ms/Math.max(1,rootFrames)})),before,after,newPrograms:after.three.programs-before.three.programs,newTextureUploads:after.native.textureUploads-before.native.textureUploads,newBufferUploads:after.native.bufferUploads-before.native.bufferUploads,newWorkerMessages:sum(after.workers.map(w=>w.messages))-sum(before.workers.map(w=>w.messages))}
 }
 async function captureSamplers(){refresh();captureBindings=true;for(let i=0;i<4;i++){s.scene.userData.displayEffectRevision=(s.scene.userData.displayEffectRevision??0)+1;s.invalidate();await new Promise(requestAnimationFrame)}for(const p of r.info.programs)introspect(p.program);captureBindings=false;const output=[]
  for(const entry of samplerReports.values()){const {vertex,fragment,...data}=entry;data.vertexHash=await hash(vertex.replace(/^#define SHADER_NAME .*/mg,''));data.fragmentHash=await hash(fragment.replace(/^#define SHADER_NAME .*/mg,''));data.vertexDeclarations=[...samplerDeclarations(vertex)];data.fragmentDeclarations=[...samplerDeclarations(fragment)];output.push(data)}
  output.sort((a,b)=>b.stageUnits.fragment.length-a.stageUnits.fragment.length)
  const worst=output[0],source=worst&&samplerReports.get(worst.id)
  return{programs:output,worstSource:source&&{id:source.id,vertex:source.vertex,fragment:source.fragment}}
 }
 // Separate counting window: prototype instrumentation must not distort the
 // normal CPU/GPU timing windows. Restore every method even on test failure.
 async function countSceneOperations(moving=false){
  const rows=new Map(),saved=[]
  for(const key of ['traverse','updateMatrixWorld','updateWorldMatrix']){
   const original=Object3D.prototype[key];saved.push([key,original])
   Object3D.prototype[key]=function(...args){
    if(active){let row=rows.get(currentPass);if(!row)rows.set(currentPass,row={traverse:0,traverseRoots:0,updateMatrixWorld:0,matrixRoots:0,updateWorldMatrix:0});row[key]++;if(this===ao.scene){if(key==='traverse')row.traverseRoots++;if(key==='updateMatrixWorld')row.matrixRoots++}}
    return original.apply(this,args)
   }
  }
  try{const result=await sample(1000,moving);return{frames:result.cpuFrameMs.count,rows:[...rows].map(([pass,counts])=>({pass,totals:counts,perFrame:Object.fromEntries(Object.entries(counts).map(([key,n])=>[key,n/result.cpuFrameMs.count]))}))}}
  finally{for(const [key,original]of saved)Object3D.prototype[key]=original}
 }
 return{configure,sample,snapshot,captureSamplers,countSceneOperations,composerPasses:composer.passes.map(p=>({name:p.constructor.name,enabled:p.enabled,configuration:p.configuration&&Object.fromEntries(['aoRadius','aoSamples','denoiseSamples','denoiseIterations','halfRes','transparencyAware','intensity'].map(k=>[k,p.configuration[k]]))}))}
}

