import {getEditorFiber} from './rendererTestModules.ts'
function find(f){return f&&(f.memoizedProps?.composer?.current??find(f.child)??find(f.sibling))}
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return{count:s.length,mean:s.reduce((a,b)=>a+b,0)/s.length,median:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)]}}
// Adjacent frames use the same camera/scene/program. This attributes the full
// GI receiver branch (including reflection attenuation), not pure texture cost.
export async function pairedGI(s,duration=60000){
 const u=s.scene.userData.getIndirectUniforms(),enabled=u?.hdGIEnabled.value
 if(!u)throw Error('Paired GI uniforms unavailable')
 try{return await pairedRender(s,duration,{configure:on=>{u.hdGIEnabled.value=on?enabled:0}})}finally{u.hdGIEnabled.value=enabled}
}
// Share the established adjacent-frame query protocol for AO experiments.
// `on` is the reference and `off` is the candidate; neither bypasses AO.
export async function pairedRender(s,duration,control,moving=false){
 const composer=find(getEditorFiber()),r=s.gl,g=r.getContext(),timer=g.getExtension('EXT_disjoint_timer_query_webgl2')
 if(!timer||!composer)throw Error('Paired render prerequisites unavailable')
 const original=composer.render.bind(composer),startCount=r.info.programs.length,records=[],pending=[],errors=[]
 const base=s.camera.position.clone(),rotation=s.camera.quaternion.clone()
 let active=true,index=0,disjoint=0
 composer.render=(...args)=>{
  if(!active)return original(...args)
  const i=index++,pair=Math.floor(i/2),on=control.counterbalance?((i%2===0)===(pair%2===0)):i%2===0,q=pending.length<8?g.createQuery():null
  control.configure(on)
  if(q)g.beginQuery(timer.TIME_ELAPSED_EXT,q)
  const at=performance.now(),calls=r.info.render.calls,triangles=r.info.render.triangles;let cpu
  try{return original(...args)}finally{cpu=performance.now()-at;if(q){g.endQuery(timer.TIME_ELAPSED_EXT);pending.push({q,on,pair,cpu,drawCalls:r.info.render.calls-calls,triangles:r.info.render.triangles-triangles,detail:control.capture?.()})}}
 }
 const poll=()=>{const bad=g.getParameter(timer.GPU_DISJOINT_EXT);for(let i=pending.length-1;i>=0;i--){const p=pending[i];if(!g.getQueryParameter(p.q,g.QUERY_RESULT_AVAILABLE))continue;if(bad)disjoint++;else records.push({on:p.on,pair:p.pair,cpu:p.cpu,drawCalls:p.drawCalls,triangles:p.triangles,detail:p.detail,gpu:g.getQueryParameter(p.q,g.QUERY_RESULT)/1e6});g.deleteQuery(p.q);pending.splice(i,1)}}
 const before={gi:{...s.scene.userData.indirectLighting},softFloor:s.scene.userData.softFloorGI,programs:startCount}
 let elapsed
 try{
  await new Promise(resolve=>{let start;const tick=now=>{start??=now;elapsed=now-start;poll();if(moving&&index%2===0){const t=elapsed/1000;s.camera.position.copy(base);s.camera.position.x+=Math.sin(t*.8)*.25;s.camera.position.z+=Math.cos(t*.8)*.25;s.camera.quaternion.copy(rotation);s.camera.rotateY(Math.sin(t*.5)*.15);s.camera.updateMatrixWorld()}s.scene.userData.displayEffectRevision=(s.scene.userData.displayEffectRevision??0)+1;s.invalidate();if(elapsed<duration)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)})
  active=false;await new Promise(resolve=>setTimeout(resolve,100));poll()
 }finally{active=false;composer.render=original;s.camera.position.copy(base);s.camera.quaternion.copy(rotation);s.camera.updateMatrixWorld();s.scene.userData.displayEffectRevision=(s.scene.userData.displayEffectRevision??0)+1;s.invalidate()}
 for(let i=0;i<8;i++){const e=g.getError();if(!e)break;errors.push(e)}
 const groups=new Map();for(const p of records){let group=groups.get(p.pair);if(!group)groups.set(p.pair,group={});group[p.on?'on':'off']=p}
 const complete=[...groups.values()].filter(p=>p.on&&p.off)
 return{elapsedMs:elapsed,frames:index,counterbalanced:control.counterbalance===true,hardware:g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),canvas:{width:r.domElement.width,height:r.domElement.height},before,after:{gi:{...s.scene.userData.indirectLighting},softFloor:s.scene.userData.softFloorGI,programs:r.info.programs.length},on:{cpu:stats(complete.map(p=>p.on.cpu)),gpu:stats(complete.map(p=>p.on.gpu)),drawCalls:stats(complete.map(p=>p.on.drawCalls)),triangles:stats(complete.map(p=>p.on.triangles))},off:{cpu:stats(complete.map(p=>p.off.cpu)),gpu:stats(complete.map(p=>p.off.gpu)),drawCalls:stats(complete.map(p=>p.off.drawCalls)),triangles:stats(complete.map(p=>p.off.triangles))},pairedOnMinusOff:{cpu:stats(complete.map(p=>p.on.cpu-p.off.cpu)),gpu:stats(complete.map(p=>p.on.gpu-p.off.gpu))},disjoint,pending:pending.length,errors,records}
}
