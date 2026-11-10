// Raw WebGL control: exact captured Extaplan GLSL or a small shader, without
// Three's program/material selection. One bounded program per page.
const q=new URLSearchParams(location.search),kind=q.get('kind')??'cheap',mode=q.get('mode')??'poll',canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2',{antialias:true,powerPreference:'high-performance'})
const r={kind,mode,calls:[],heartbeats:[],frames:[],inputs:[],stages:[]},clock=()=>performance.timeOrigin+performance.now(),turn=()=>new Promise(resolve=>requestAnimationFrame(resolve))
let running=true,last=clock(),count=0,handle
const heartbeat=setInterval(()=>{const at=clock();r.heartbeats.push(at-last);last=at;document.querySelector('#pulse').textContent=String(++count)},20)
const frame=()=>{r.frames.push(clock());if(running)handle=requestAnimationFrame(frame)};handle=requestAnimationFrame(frame)
document.querySelector('#ack').onpointerdown=e=>{const row={at:clock(),eventAt:performance.timeOrigin+e.timeStamp};r.inputs.push(row);requestAnimationFrame(()=>row.rafAt=clock());document.querySelector('#ack').textContent=`Input ${r.inputs.length}`}
const timed=(name,fn)=>{const at=clock();try{return fn()}finally{r.calls.push({name,at,ms:clock()-at})}}
const cheap={vertex:'#version 300 es\nin vec3 position;void main(){gl_Position=vec4(position,1.0);}',fragment:'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.2,0.6,0.8,1.0);}'}
async function run(){
 try{
  document.querySelector('#run').disabled=true;r.startedAt=clock();const ext=gl.getExtension('KHR_parallel_shader_compile'),timer=gl.getExtension('EXT_disjoint_timer_query_webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info')
  r.support={renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),parallel:!!ext,fragmentUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)}
  const source=kind==='cheap'?cheap:await(await fetch('/shader-replay.json')).json(),program=timed('createProgram',()=>gl.createProgram()),shaders=[]
  for(const [key,type]of [['vertex',gl.VERTEX_SHADER],['fragment',gl.FRAGMENT_SHADER]]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source[key]);timed('compileShader',()=>gl.compileShader(s));gl.attachShader(program,s)}
  timed('linkProgram',()=>gl.linkProgram(program));r.linkedAt=clock();r.initialCompletion=ext?timed('completion.initial',()=>gl.getProgramParameter(program,ext.COMPLETION_STATUS_KHR)):undefined
  if(mode==='poll'&&ext){const until=clock()+20000;while(!timed('completion.poll',()=>gl.getProgramParameter(program,ext.COMPLETION_STATUS_KHR))){if(clock()>until)throw Error('Bounded parallel compile deadline');await turn()}r.completedAt=clock()}
  r.completionBeforeReflection=ext?gl.getProgramParameter(program,ext.COMPLETION_STATUS_KHR):undefined
  const n=timed('ACTIVE_UNIFORMS',()=>gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS));r.activeUniforms=n
  r.linkStatus=gl.getProgramParameter(program,gl.LINK_STATUS);if(!r.linkStatus)throw Error(gl.getProgramInfoLog(program)+'\n'+shaders.map(s=>gl.getShaderInfoLog(s)).join('\n'))
  const uniforms=[];timed('uniformEnumeration',()=>{for(let i=0;i<n;i++){const u=gl.getActiveUniform(program,i);uniforms.push({...u,name:u.name,type:u.type,size:u.size,location:gl.getUniformLocation(program,u.name)})}})
  gl.useProgram(program);const textures=[],samplerUnits=new Map();let nextUnit=0
  function sampler(type){if(samplerUnits.has(type))return samplerUnits.get(type);const unit=nextUnit++;samplerUnits.set(type,unit);gl.activeTexture(gl.TEXTURE0+unit);const texture=gl.createTexture();textures.push(texture)
   const target=type===gl.SAMPLER_CUBE?gl.TEXTURE_CUBE_MAP:type===gl.SAMPLER_3D?gl.TEXTURE_3D:type===gl.SAMPLER_2D_ARRAY?gl.TEXTURE_2D_ARRAY:gl.TEXTURE_2D
   gl.bindTexture(target,texture);gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
   if(type===gl.SAMPLER_2D_SHADOW){gl.texImage2D(target,0,gl.DEPTH_COMPONENT16,1,1,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_SHORT,null);gl.texParameteri(target,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE)}
   else if(target===gl.TEXTURE_CUBE_MAP)for(let i=0;i<6;i++)gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]))
   else if(target===gl.TEXTURE_3D||target===gl.TEXTURE_2D_ARRAY)gl.texImage3D(target,0,gl.RGBA8,1,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]))
   else gl.texImage2D(target,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]))
   return unit
  }
  const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),samplers=new Set([gl.SAMPLER_2D,gl.SAMPLER_CUBE,gl.SAMPLER_3D,gl.SAMPLER_2D_ARRAY,gl.SAMPLER_2D_SHADOW])
  timed('bindUniforms',()=>{for(const u of uniforms){if(samplers.has(u.type))gl.uniform1iv(u.location,new Int32Array(u.size).fill(sampler(u.type)));else if(u.type===gl.FLOAT_MAT4){const a=new Float32Array(u.size*16);for(let i=0;i<u.size;i++)a.set(identity,i*16);gl.uniformMatrix4fv(u.location,false,a)}else if(u.type===gl.FLOAT_MAT3)gl.uniformMatrix3fv(u.location,false,new Float32Array([1,0,0,0,1,0,0,0,1]));else if(u.type===gl.FLOAT&&(u.name==='opacity'||u.name==='roughness'||u.name==='toneMappingExposure'))gl.uniform1f(u.location,1);else if(u.type===gl.FLOAT_VEC3&&['diffuse','ambientLightColor'].includes(u.name))gl.uniform3f(u.location,1,1,1)}})
  r.fragmentSamplerCount=uniforms.filter(u=>samplers.has(u.type)&&new RegExp('uniform\\s+(?:(?:lowp|mediump|highp)\\s+)?[iu]?sampler\\w+\\s+'+u.name.replace(/\[0\]$/,'')+'\\b').test(source.fragment)).reduce((sum,u)=>sum+u.size,0)
  const vao=gl.createVertexArray(),buffers=[];gl.bindVertexArray(vao)
  for(const [name,size,data]of [['position',3,[-.8,-.8,0,.8,-.8,0,0,.8,0]],['normal',3,[0,0,1,0,0,1,0,0,1]],['uv',2,[0,0,1,0,.5,1]]]){const location=gl.getAttribLocation(program,name);if(location<0)continue;const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0)}
  gl.viewport(0,0,256,256);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT)
  const query=timer?gl.createQuery():null;if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query)
  timed('firstDraw',()=>gl.drawArrays(gl.TRIANGLES,0,3));r.drawSubmittedAt=clock();if(query)gl.endQuery(timer.TIME_ELAPSED_EXT)
  const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();const until=clock()+10000
  while(gl.clientWaitSync(fence,0,0)===gl.TIMEOUT_EXPIRED){if(clock()>until)throw Error('GPU fence deadline');await turn()}r.gpuCompleteAt=clock();gl.deleteSync(fence)
  if(query&&gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(timer.GPU_DISJOINT_EXT))r.gpuElapsedMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6
  if(query)gl.deleteQuery(query);r.glError=gl.getError();if(r.glError!==gl.NO_ERROR)throw Error('GL error '+r.glError)
  r.totalMs=clock()-r.startedAt;document.querySelector('#status').textContent='Completed; final shader linked, uniforms bound and triangle drawn';r.done=true
  window.rawCleanup=()=>{buffers.forEach(b=>gl.deleteBuffer(b));textures.forEach(t=>gl.deleteTexture(t));gl.deleteVertexArray(vao);shaders.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();running=false;cancelAnimationFrame(handle);clearInterval(heartbeat);r.contextLost=gl.isContextLost()}
 }catch(error){r.error=String(error);r.done=true;document.querySelector('#status').textContent=r.error}
}
Object.assign(window,{rawShaderProbe:r});document.querySelector('#run').onclick=run
