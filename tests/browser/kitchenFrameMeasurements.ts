import {Mesh,MeshBasicMaterial,NormalBlending,Vector3,type Material} from 'three'
import type {RootState} from '@react-three/fiber'
import type {EffectComposer} from 'postprocessing'

type Counter={frames:number;displayFrames:number;cpuMs:number;gpuMs:number;gpuSamples:number;calls:number;triangles:number;elapsedMs:number}
const counter=():Counter=>({frames:0,displayFrames:0,cpuMs:0,gpuMs:0,gpuSamples:0,calls:0,triangles:0,elapsedMs:0})
export function installKitchenLiveFrames(s:RootState){
  const gl=s.gl,c=gl.getContext() as WebGL2RenderingContext,timer=c.getExtension('EXT_disjoint_timer_query_webgl2'),render=gl.render
  const bins:Record<string,Counter>={},queries:{q:WebGLQuery;bin:Counter}[]=[]
  let frame=0,shown=-1,previous=performance.now(),stopped=false,samples=0
  const phase=()=>{const g=s.scene.userData.indirectLighting;return g?.state==='ready'&&g.fullPassPublications>=6?'after':g?.bakeStartedAt?'during':'before'}
  const bin=()=>bins[phase()]??=(counter())
  gl.render=function(scene,camera){
    if(scene!==s.scene&&!scene.userData.retainedViewport)return render.call(this,scene,camera)
    const b=bin(),before={...gl.info.render},start=performance.now(),q=timer&&queries.length===0&&++samples%8===0&&!c.getQuery(timer.TIME_ELAPSED_EXT,c.CURRENT_QUERY)?c.createQuery():null
    if(q)c.beginQuery(timer!.TIME_ELAPSED_EXT,q)
    try{return render.call(this,scene,camera)}finally{if(q){c.endQuery(timer!.TIME_ELAPSED_EXT);queries.push({q,bin:b})}b.cpuMs+=performance.now()-start;b.calls+=gl.info.render.calls-before.calls;b.triangles+=gl.info.render.triangles-before.triangles;if(shown!==frame){shown=frame;b.displayFrames++}}
  }
  function tick(now:number){
    if(stopped)return
    const b=bin();b.frames++;b.elapsedMs+=now-previous;previous=now;frame++
    for(let i=queries.length-1;i>=0;i--){const {q,bin}=queries[i];if(!c.getQueryParameter(q,c.QUERY_RESULT_AVAILABLE))continue;if(!c.getParameter(timer!.GPU_DISJOINT_EXT)){bin.gpuMs+=c.getQueryParameter(q,c.QUERY_RESULT)/1e6;bin.gpuSamples++}c.deleteQuery(q);queries.splice(i,1)}
    requestAnimationFrame(tick)
  }requestAnimationFrame(tick)
  return {report(){return {scope:'live natural frames: CPU/GPU draw measurements cover main-scene geometry only; AO/composite measured separately',bins:Object.fromEntries(Object.entries(bins).map(([key,b])=>[key,{...b,animationFps:b.frames*1000/b.elapsedMs,displayFps:b.displayFrames*1000/b.elapsedMs}]))}},dispose(){stopped=true;gl.render=render;queries.forEach(({q})=>c.deleteQuery(q))}}
}

/** Same camera path, viewport, lights and converged field in every case. Manual
 * display frames pause R3F GI invalidation while render features are isolated. */
export async function measureKitchenFrames(s:RootState,composer?:EffectComposer,experiment?:{cases:[string,()=>void][];restore:()=>void}){
  const gl=s.gl,c=gl.getContext() as WebGL2RenderingContext,timer=c.getExtension('EXT_disjoint_timer_query_webgl2')
  const position=s.camera.position.clone(),rotation=s.camera.quaternion.clone(),frameloop=s.frameloop,generation=s.scene.userData.indirectLighting.generation
  const materials=new Set<Material>();s.scene.traverse(o=>{if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)})
  const original=[...materials].map(m=>({m,visible:m.visible,envMap:'envMap'in m?m.envMap:null,normalMap:'normalMap'in m?m.normalMap:null}))
  const invisibleProxies=[...materials].filter(m=>m instanceof MeshBasicMaterial&&m.visible&&m.transparent&&m.opacity===0&&!m.depthWrite&&!m.stencilWrite&&m.blending===NormalBlending)
  const environment=s.scene.environment,shadows=gl.shadowMap.enabled,gi=s.scene.userData.getIndirectUniforms(),enabled=gi.hdGIEnabled.value
  const ao=composer?.passes.find(p=>'configuration'in p&&'aoRadius'in (p.configuration as object)),aoEnabled=ao?.enabled
  const room=await import('../../src/roomLightShader'),roomUniforms=new Set<ReturnType<typeof room.getRoomLightUniforms>>()
  for(const m of materials){const u=room.getRoomLightUniforms(m);if(u)roomUniforms.add(u)}const roomValues=[...roomUniforms].map(u=>[u!,u!.enabled.value] as const)
  const draw=()=>{gl.setRenderTarget(null);gl.autoClear=true;if(composer)composer.render(1/60);else gl.render(s.scene,s.camera)}
  const reset=()=>{experiment?.restore();gi.hdGIEnabled.value=enabled;gl.shadowMap.enabled=shadows;s.scene.environment=environment;if(ao)ao.enabled=aoEnabled!;for(const x of original){x.m.visible=x.visible;if('envMap'in x.m&&x.m.envMap!==x.envMap){x.m.envMap=x.envMap;x.m.needsUpdate=true}if('normalMap'in x.m&&x.m.normalMap!==x.normalMap){x.m.normalMap=x.normalMap;x.m.needsUpdate=true}}roomValues.forEach(([u,v])=>u.enabled.value=v)}
  const result:Record<string,unknown>={hardware:{renderer:c.getParameter(c.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL??c.RENDERER),width:gl.domElement.width,height:gl.domElement.height,dpr:gl.getPixelRatio(),gpuTimer:!!timer,composer:!!composer},cases:{}}
  async function sample(ms:number,measure:boolean){
    const start=performance.now(),cpu:number[]=[],gpu:number[]=[],queries:WebGLQuery[]=[],calls:number[]=[],triangles:number[]=[];let count=0
    await new Promise<void>(resolve=>{function frame(now:number){
      // A repeatable 2.5 cm translation keeps the visible room effectively fixed
      // while requiring actual navigation frames instead of idle throttling.
      s.camera.position.copy(position).add(new Vector3(Math.sin((now-start)/1000)*.025,0,0));s.camera.quaternion.copy(rotation);s.camera.updateMatrixWorld(true)
      for(let i=queries.length-1;i>=0;i--){const q=queries[i];if(!c.getQueryParameter(q,c.QUERY_RESULT_AVAILABLE))continue;if(!c.getParameter(timer!.GPU_DISJOINT_EXT))gpu.push(c.getQueryParameter(q,c.QUERY_RESULT)/1e6);c.deleteQuery(q);queries.splice(i,1)}
      const q=measure&&timer&&queries.length<2&&!c.getQuery(timer.TIME_ELAPSED_EXT,c.CURRENT_QUERY)?c.createQuery():null,before={...gl.info.render},at=performance.now()
      if(q)c.beginQuery(timer!.TIME_ELAPSED_EXT,q);draw();if(q){c.endQuery(timer!.TIME_ELAPSED_EXT);queries.push(q)}
      cpu.push(performance.now()-at);calls.push(gl.info.render.calls-before.calls);triangles.push(gl.info.render.triangles-before.triangles);count++
      if(now-start<ms)requestAnimationFrame(frame);else resolve()
    }requestAnimationFrame(frame)})
    queries.forEach(q=>c.deleteQuery(q));s.camera.position.copy(position);s.camera.quaternion.copy(rotation);s.camera.updateMatrixWorld(true)
    const elapsedMs=performance.now()-start,mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length),quantile=(a:number[],q:number)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))]
    return {elapsedMs,displayFps:count*1000/elapsedMs,cpuSubmissionMeanMs:mean(cpu),cpuSubmissionP95Ms:quantile(cpu,.95),gpuExecutionMeanMs:gpu.length?mean(gpu):null,gpuSamples:gpu.length,meanDrawCalls:mean(calls),meanTriangles:mean(triangles),programs:gl.info.programs?.length,glError:c.getError()}
  }
  s.setFrameloop('never')
  try{
    const cases:[string,()=>void][]=experiment?.cases??[['GI display disabled',()=>gi.hdGIEnabled.value=0],['shadows disabled',()=>gl.shadowMap.enabled=false],['AO disabled',()=>{if(ao)ao.enabled=false}],['reflections disabled',()=>{s.scene.environment=null;for(const {m}of original)if('envMap'in m){m.envMap=null;m.needsUpdate=true}}],['room visibility disabled',()=>roomValues.forEach(([u])=>u.enabled.value=0)],['normal maps disabled',()=>{for(const {m}of original)if('normalMap'in m){m.normalMap=null;m.needsUpdate=true}}],['invisible pick proxies omitted',()=>invisibleProxies.forEach(m=>m.visible=false)]]
    // Warm every shader variant before timing, and bracket each change with
    // the restored scene so thermal/load drift is visible instead of attributed
    // to whichever feature happened to run later.
    result.variantWarmups={};result.invisibleProxyMaterials=invisibleProxies.length
    for(const [name,change]of cases){reset();change();(result.variantWarmups as Record<string,unknown>)[name]=await sample(1200,false)}
    for(const [name,change]of cases){
      reset();await sample(600,false);const before=await sample(2000,true)
      change();await sample(600,false);const changed=await sample(2000,true)
      reset();await sample(600,false);const after=await sample(2000,true)
      const baselineCpu=(before.cpuSubmissionMeanMs+after.cpuSubmissionMeanMs)/2,baselineGpu=before.gpuExecutionMeanMs!==null&&after.gpuExecutionMeanMs!==null?(before.gpuExecutionMeanMs+after.gpuExecutionMeanMs)/2:null
      ;(result.cases as Record<string,unknown>)[name]={before,changed,after,cpuDeltaMs:changed.cpuSubmissionMeanMs-baselineCpu,gpuDeltaMs:baselineGpu!==null&&changed.gpuExecutionMeanMs!==null?changed.gpuExecutionMeanMs-baselineGpu:null}
    }
    result.generationUnchanged=generation===s.scene.userData.indirectLighting.generation;return result
  }finally{reset();s.camera.position.copy(position);s.camera.quaternion.copy(rotation);s.camera.updateMatrixWorld(true);s.setFrameloop(frameloop);s.invalidate()}
}
