// Opt-in test-entry diagnostics. No shader sources, GL handles or scene objects
// are retained in exported rows. No cache keys or renderer behavior are changed.
const now=()=>performance.timeOrigin+performance.now()
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('')
const normalise=source=>source.replace(/\r\n?/g,'\n').replace(/^#define SHADER_NAME .*$/mg,'').replace(/[ \t]+$/mg,'').trim()
export function createShaderProgramAudit(){
 const contexts=new WeakMap(),all=[],pending=[],frames=[],operations=[],renderers=new WeakSet()
 let replay
 let action='initial',activeMeta,current,rendererId=0
 function instrument(gl){
  if(contexts.has(gl))return contexts.get(gl)
  if(all.length>=32){const skipped={record:()=>undefined,setDrawMeta:()=>{},setReaders:()=>{}};contexts.set(gl,skipped);return skipped}
  const programs=new Map(),shaders=new WeakMap(),handles=new WeakMap(),contextId=all.length+1,rows=[],slow=[];all.push({contextId,rows,slow})
  let sourceText=new WeakMap(),shaderCount=0
  let readPhase=()=>'',readGeneration=()=>undefined
  const raw={},ids=new WeakMap();let nextId=0,bound,drawMeta
  const record=p=>programs.get(p)
  const context=()=>({action,phase:readPhase(),generation:readGeneration(),...activeMeta})
  const wrap=(name,fn)=>{const original=gl[name];if(typeof original!=='function')return;raw[name]=original.bind(gl);gl[name]=function(...args){return fn(raw[name],args)}}
  const timed=(name,original,args,row)=>{const at=now();try{return original(...args)}finally{const ms=now()-at;if(ms>=2&&slow.length<1500)slow.push({name,at,ms,program:row?.id,...context()})}}
  wrap('createShader',(fn,a)=>{const s=fn(...a);if(shaderCount++<800)shaders.set(s,{type:a[0]});return s})
  wrap('shaderSource',(fn,a)=>{const s=shaders.get(a[0]);if(s){if(!replay)sourceText.set(a[0],a[1]);s.length=a[1].length;s.defines=a[1].split('\n').filter(l=>/^#define /.test(l)).slice(0,180);s.samplers=[...a[1].matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?[iu]?sampler\w+\s+(\w+)/g)].map(m=>m[1]);s.gi=a[1].includes('hdGI');s.room=a[1].includes('hdRoom');const normal=normalise(a[1]);pending.push(Promise.all([digest(a[1]),digest(normal)]).then(([exact,normalized])=>{s.exactHash=exact;s.normalizedHash=normalized}))}return fn(...a)})
  wrap('compileShader',(fn,a)=>{const s=shaders.get(a[0]),at=now();const result=timed('compileShader',fn,a);if(s)s.compile={at,ms:now()-at};return result})
  wrap('createProgram',(fn,a)=>{const at=now(),p=fn(...a);if(rows.length>=400)return p;const r={id:`${contextId}:${++nextId}`,createdAt:at,createMs:now()-at,created:context(),stack:new Error().stack?.split('\n').slice(2,9),shaders:[],associations:[],uniformEnumeration:{calls:0,ms:0},locations:{calls:0,ms:0},draws:0,samplerUniforms:[]};ids.set(p,r.id);programs.set(p,r);rows.push(r);return p})
  wrap('attachShader',(fn,a)=>{const r=record(a[0]),s=shaders.get(a[1]);if(r&&s){r.shaders.push(s);let list=handles.get(a[0]);if(!list)handles.set(a[0],list=[]);list.push(a[1])}return fn(...a)})
  wrap('linkProgram',(fn,a)=>{const r=record(a[0]),at=now();const result=timed('linkProgram',fn,a,r);if(r){r.link={at,ms:now()-at};const list=handles.get(a[0]);if(!replay&&r.shaders.some(s=>s.type===gl.FRAGMENT_SHADER&&s.gi&&s.defines.includes('#define USE_NORMALMAP'))){replay={program:r.id,vertex:sourceText.get(list.find(s=>shaders.get(s).type===gl.VERTEX_SHADER)),fragment:sourceText.get(list.find(s=>shaders.get(s).type===gl.FRAGMENT_SHADER))};sourceText=new WeakMap()}}return result})
  wrap('getProgramParameter',(fn,a)=>{
   const r=record(a[0]),parameter=a[1],first=parameter===gl.ACTIVE_UNIFORMS&&r&&!r.reflection
   // One non-blocking completion sample immediately before first reflection.
   // This observes readiness; it does not wait or change the caller's sequence.
   let completionBefore
   if(first&&gl.getExtension('KHR_parallel_shader_compile'))completionBefore=fn(a[0],0x91b1)
   const at=now(),result=timed('getProgramParameter.'+({[gl.ACTIVE_UNIFORMS]:'ACTIVE_UNIFORMS',[gl.LINK_STATUS]:'LINK_STATUS',[0x91b1]:'COMPLETION_STATUS_KHR'}[parameter]??parameter),fn,a,r),ms=now()-at
   if(r){if(parameter===0x91b1){r.completionPolls=(r.completionPolls??0)+1;if(result&&!r.completedAt)r.completedAt=now();r.lastCompletion=result}
    if(first)r.reflection={at,ms,count:result,completionBefore,lastCompletion:r.lastCompletion,...context()}
    if(parameter===gl.LINK_STATUS)r.linkStatus=result
   }return result
  })
  for(const [name,key]of [['getActiveUniform','uniformEnumeration'],['getUniformLocation','locations']])wrap(name,(fn,a)=>{const r=record(a[0]),at=now(),result=fn(...a);if(r){r[key].calls++;r[key].ms+=now()-at;if(name==='getActiveUniform'&&result&&[35678,35680,35679,35682,36289,36292,36293,36298,36303,36306,36307,36311].includes(result.type)&&r.samplerUniforms.length<100)r.samplerUniforms.push({name:result.name,type:result.type,size:result.size})}return result})
  wrap('useProgram',(fn,a)=>{bound=a[0];return fn(...a)})
  for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'])wrap(name,(fn,a)=>{const r=record(bound),at=now(),result=timed(name,fn,a,r);if(r){r.draws++;if(!r.firstDraw)r.firstDraw={at,ms:now()-at,...context(),material:drawMeta}}return result})
  for(const name of ['texSubImage2D','texSubImage3D','bufferData','finish','flush','readPixels','clientWaitSync'])wrap(name,(fn,a)=>timed(name,fn,a,record(bound)))
  wrap('deleteProgram',(fn,a)=>{const r=record(a[0]);if(r)r.deletedAt=now();return fn(...a)})
  const api={gl,rows,record,raw,setDrawMeta:m=>{drawMeta=m},setReaders:(p,g)=>{readPhase=p;readGeneration=g}}
  contexts.set(gl,api);return api
 }
 const materialInfo=(material,object)=>({material:material.uuid,name:material.name,type:material.type,object:object?.uuid,objectName:object?.name,role:object?.userData?.houseDesignerRole,
  defines:material.defines,side:material.side,transparent:material.transparent,alphaTest:material.alphaTest,toneMapped:material.toneMapped,
  maps:Object.entries(material).filter(([,v])=>v?.isTexture).map(([slot,t])=>({slot,colorSpace:t.colorSpace,mapping:t.mapping,channel:t.channel})),
  geometry:object?.geometry&&{attributes:Object.keys(object.geometry.attributes),instanced:!!object.isInstancedMesh,batched:!!object.isBatchedMesh,skinned:!!object.isSkinnedMesh},receiveShadow:object?.receiveShadow,castShadow:object?.castShadow})
 function attach(renderer,getPhase=()=>'',getGeneration=()=>undefined){
  if(renderers.has(renderer))return;renderers.add(renderer);const api=instrument(renderer.getContext()),id=++rendererId;api.setReaders(getPhase,getGeneration)
  const target=()=>{const t=renderer.getRenderTarget();return{renderer:id,generation:getGeneration(),target:t?{width:t.width,height:t.height,type:t.texture.type,format:t.texture.format,colorSpace:t.texture.colorSpace,xr:!!t.isXRRenderTarget,samples:t.samples}:null,outputColorSpace:renderer.outputColorSpace,toneMapping:renderer.toneMapping,shadows:{enabled:renderer.shadowMap.enabled,type:renderer.shadowMap.type,autoUpdate:renderer.shadowMap.autoUpdate}}}
  const associate=scene=>{for(const p of renderer.info.programs??[]){const r=api.record(p.program);if(r){r.threeId=p.id;r.name=p.name;r.cacheKey=p.cacheKey;r.usedTimes=p.usedTimes}}scene?.traverse?.(object=>{for(const m of Array.isArray(object.material)?object.material:[object.material]){if(!m)continue;const props=renderer.properties.get(m);for(const p of props.programs?.values()??[]){const r=api.record(p.program);if(!r)continue;const token=m.uuid+':'+object.uuid;if(r.associations.length<24&&!r.associations.some(a=>a.token===token))r.associations.push({token,...materialInfo(m,object)})}}})}
  for(const name of ['compile','compileAsync','render']){const fn=renderer[name].bind(renderer);renderer[name]=function(...args){const old=activeMeta;activeMeta={...target(),operation:name};const at=now();let result;try{result=fn(...args);associate(args[0]);return result}finally{if(name==='render'&&frames.length<5000)frames.push({at,ms:now()-at,camera:args[1]?.position.toArray(),scene:args[0]?.uuid,basic:!!args[0]?.userData.initialViewportPreview,...activeMeta});if(name!=='render'&&operations.length<1000){const row={at,submittedMs:now()-at,...activeMeta};operations.push(row);if(result?.then)result.then(()=>{row.completedAt=now()},error=>{row.error=String(error)})}activeMeta=old}}}
  const direct=renderer.renderBufferDirect.bind(renderer);renderer.renderBufferDirect=function(...args){const old=activeMeta,m=materialInfo(args[3],args[4]);activeMeta={...target(),operation:'renderBufferDirect',material:m};api.setDrawMeta(m);try{return direct(...args)}finally{associate({traverse:fn=>fn(args[4])});activeMeta=old;api.setDrawMeta(undefined)}}
  const dispose=renderer.dispose.bind(renderer);renderer.dispose=()=>{associate(current);return dispose()}
  current=undefined
 }
 function interceptCanvas(){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){const gl=original.apply(this,args);if(args[0]==='webgl2'&&gl)instrument(gl);return gl}}
 return{attach,interceptCanvas,setAction:value=>{action=value},replay:()=>replay,async snapshot(){await Promise.all(pending);return{at:now(),contexts:all,frames,operations,limits:{contexts:32,shadersPerContext:800,programsPerContext:400,associationsPerProgram:24,slowCallsPerContext:1500,frames:5000,operations:1000},sourceStorage:'SHA-256 exact and normalized; removes SHADER_NAME and trailing whitespace only; no source strings exported; one shader pair separately retained for raw synchronization replay'}}}
}
