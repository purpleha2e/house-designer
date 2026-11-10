import {lightingBrowser} from './lightingHarness.mjs'
import {mkdirSync,writeFileSync} from 'node:fs'
const mode=process.argv[2]??'single',view=process.argv[3]??'building',port=process.argv[4]??5191
if(!['single','cascaded','off'].includes(mode)||!['building','walk'].includes(view))throw Error('Invalid comparison')
const server=await fetch(`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html`,{signal:AbortSignal.timeout(5000)})
if(!server.ok)throw Error(`Test server unavailable: ${server.status}`)
const out='tmp/renderer-recovery';mkdirSync(out,{recursive:true})
const b=await lightingBrowser(),report={mode,view,width:1280,height:720,dpr:1,events:[],samples:{}}
const save=()=>writeFileSync(`${out}/${view}-${mode}.json`,JSON.stringify({...report,errors:b.errors,logs:b.logs},null,2))
try{
 await b.call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false})
 await b.call('Log.enable')
 await b.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
 const original=HTMLCanvasElement.prototype.getContext;window.recoveryContexts=[];
 HTMLCanvasElement.prototype.getContext=function(type,...args){const gl=original.call(this,type,...args);if(!gl||!['webgl','webgl2'].includes(type)||gl.__recovery)return gl;
 const resources={textures:new Set(),framebuffers:new Set(),renderbuffers:new Set(),programs:new Set()},events=[];
 const record={gl,canvas:this,resources,events};gl.__recovery=record;window.recoveryContexts.push(record);
 for(const [kind,create,remove]of [['textures','createTexture','deleteTexture'],['framebuffers','createFramebuffer','deleteFramebuffer'],['renderbuffers','createRenderbuffer','deleteRenderbuffer'],['programs','createProgram','deleteProgram']]){
  const make=gl[create],drop=gl[remove];gl[create]=function(...a){const x=make.apply(this,a);if(x)resources[kind].add(x);return x};gl[remove]=function(x){resources[kind].delete(x);return drop.call(this,x)};
 }
 this.addEventListener('webglcontextlost',e=>events.push({type:'lost',at:performance.now(),message:e.statusMessage}));
 this.addEventListener('webglcontextrestored',()=>events.push({type:'restored',at:performance.now()}));
 return gl;};})()`})
 await b.call('Page.navigate',{url:`http://127.0.0.1:${port}/tests/browser/rendererRecovery.html?rendererShadows=${mode}&view=${view}`})
 const deadline=Date.now()+240000;let lastLog=0
 while(Date.now()<deadline){
  const state=await b.evaluate(`(()=>{const s=window.rendererRecovery?.state();if(!s)return null;const u=s.scene.userData,g=u.indirectLighting;return{phase:u.progressiveStartup,warm:u.shaderWarmupPending,gi:g&&{state:g.state,source:g.source,probes:g.probes,pass:g.pass,completed:g.completed,preparing:g.preparing,warming:g.warming,volumePending:g.volumePending,pendingUpdate:g.pendingUpdate,shaderError:g.shaderError},cover:!!document.querySelector('.viewport-preparing-overlay'),lost:s.gl.getContext().isContextLost(),programs:s.gl.info.programs?.length,preparation:u.viewportPreparation}})()`)
  report.lastState=state
  if(state?.phase?.phase==='full'&&!state.warm)break
  if(Date.now()-lastLog>15000){console.log('PREPARING',mode,view,JSON.stringify(state));lastLog=Date.now();save()}
  if(b.errors.some(x=>/shader|texture.*units|context.*lost|INVALID_/i.test(x))){report.preparationFailure=true;break}
  await new Promise(r=>setTimeout(r,250))
 }
 if(report.lastState?.phase?.phase!=='full'){report.preparationFailure=true;save();throw Error('Full viewport did not prepare: '+JSON.stringify(report.lastState))}
 report.hardware=await b.evaluate(`(()=>{const s=rendererRecovery.state(),g=s.gl.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return{renderer:g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER),maxFragmentTextures:g.getParameter(g.MAX_TEXTURE_IMAGE_UNITS),timer:!!g.getExtension('EXT_disjoint_timer_query_webgl2'),width:s.gl.domElement.width,height:s.gl.domElement.height,dpr:s.gl.getPixelRatio(),authoredModels:rendererRecovery.projectModels}})()`)
 console.log('READY',JSON.stringify(report.hardware));save()
 await b.evaluate(`(()=>{
 const s=rendererRecovery.state(),r=s.gl,g=r.getContext(),render=r.render.bind(r),timer=g.getExtension('EXT_disjoint_timer_query_webgl2');
 const p=window.recoveryProfile={active:false,cpu:[],gpu:[],calls:0,triangles:0,renders:0,pending:[],depth:0};
 r.render=function(...args){if(!p.active||p.depth)return render(...args);const at=performance.now(),calls=r.info.render.calls,triangles=r.info.render.triangles,q=timer?g.createQuery():null;
 p.depth++;if(q)g.beginQuery(timer.TIME_ELAPSED_EXT,q);
 try{return render(...args)}finally{if(q){g.endQuery(timer.TIME_ELAPSED_EXT);p.pending.push(q)}p.depth--;p.cpu.push(performance.now()-at);p.calls+=r.info.render.calls-calls;p.triangles+=r.info.render.triangles-triangles;p.renders++}};
 window.recoverySample=(duration,moving)=>new Promise(resolve=>{
  const position=s.camera.position.clone(),quaternion=s.camera.quaternion.clone(),frames=[],cpu=[],programsBefore=r.info.programs.length,at=performance.now();let last=at,activeFrames=0,lastRenders=0;
  Object.assign(p,{active:true,cpu:[],gpu:[],calls:0,triangles:0,renders:0});
  const tick=now=>{frames.push(now-last);cpu.push(p.cpu.reduce((a,b)=>a+b,0));p.cpu=[];last=now;if(p.renders!==lastRenders){activeFrames++;lastRenders=p.renders}
   if(moving){const t=(now-at)/1000;s.camera.position.copy(position);s.camera.position.x+=Math.sin(t*.8)*.25;s.camera.position.z+=Math.cos(t*.8)*.25;s.camera.rotation.y+=.001;s.camera.updateMatrixWorld();s.invalidate()}
   for(let i=p.pending.length-1;i>=0;i--){const q=p.pending[i];if(!g.getQueryParameter(q,g.QUERY_RESULT_AVAILABLE))continue;if(!g.getParameter(timer.GPU_DISJOINT_EXT))p.gpu.push(g.getQueryParameter(q,g.QUERY_RESULT)/1e6);g.deleteQuery(q);p.pending.splice(i,1)}
   if(now-at<duration){requestAnimationFrame(tick);return}p.active=false;s.camera.position.copy(position);s.camera.quaternion.copy(quaternion);s.camera.updateMatrixWorld();s.invalidate();
   const sorted=[...frames].sort((a,b)=>a-b),percent=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))],sum=a=>a.reduce((x,y)=>x+y,0),seconds=(now-at)/1000,record=g.__recovery;
   const errors=[];for(let i=0;i<8;i++){const e=g.getError();if(!e)break;errors.push(e)}
   resolve({animationFPS:frames.length/seconds,presentedFPS:activeFrames/seconds,frameMedianMs:percent(.5),frameP95Ms:percent(.95),worstFrameMs:percent(1),cpuRenderMsPerFrame:sum(cpu)/frames.length,gpuMsPerAnimationFrame:sum(p.gpu)/frames.length,gpuSamples:p.gpu.length,drawCallsPerPresentedFrame:p.calls/Math.max(1,activeFrames),trianglesPerPresentedFrame:p.triangles/Math.max(1,activeFrames),programs:r.info.programs.length,newPrograms:r.info.programs.length-programsBefore,textures:r.info.memory.textures,geometries:r.info.memory.geometries,nativeResources:record&&Object.fromEntries(Object.entries(record.resources).map(([k,v])=>[k,v.size])),contextEvents:record?.events,lost:g.isContextLost(),framebufferStatus:g.checkFramebufferStatus(g.FRAMEBUFFER),glErrors:errors,heap:performance.memory?.usedJSHeapSize,gi:s.scene.userData.indirectLighting,canvas:{width:r.domElement.width,height:r.domElement.height},target:r.getRenderTarget()&&{width:r.getRenderTarget().width,height:r.getRenderTarget().height}})
  };requestAnimationFrame(tick)
 });return true;})()`)
 for(const [name,duration,moving]of [['stationary',4000,false],['moving',6000,true],['extendedMoving',20000,true],['settledAfterNavigation',4000,false]]){
  report.samples[name]=await b.evaluate(`recoverySample(${duration},${moving})`);save();console.log(name,JSON.stringify({...report.samples[name],gi:{state:report.samples[name].gi?.state,probes:report.samples[name].gi?.probes}}))
 }
 const shot=await b.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${view}-${mode}.png`,Buffer.from(shot.data,'base64'))
 save()
}catch(error){report.failure=String(error);save();console.error(error);process.exitCode=1}finally{b.close()}
