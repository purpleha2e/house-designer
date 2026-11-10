// Runs before the app creates WebGL. Diagnostic metadata only; no GL state or
// rendering settings are changed. No readPixels/finish is used.
export function installNativeAudit() {
  const getContext=HTMLCanvasElement.prototype.getContext
  window.rendererAuditContexts=[]
  HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=getContext.call(this,type,...args)
    if(!gl||!['webgl','webgl2'].includes(type)||gl.__rendererAudit)return gl
    let next=0,activeUnit=0,currentProgram=null
    const ids=new WeakMap(),textures=new Map(),buffers=new Map(),programs=new Map(),renderbuffers=new Map()
    const live={textures:new Set(),buffers:new Set(),framebuffers:new Set(),renderbuffers:new Set(),programs:new Set(),shaders:new Set()}
    const bindings=new Map(),bufferBindings=new Map(),events=[],failures=[]
    const record={glRef:new WeakRef(gl),canvasRef:new WeakRef(this),ids,textures,buffers,programs,renderbuffers,live,bindings,events,failures,
      enabled:true,switches:0,compileCalls:0,linkCalls:0,textureUploads:0,bufferUploads:0,workerMessages:[],createdAt:performance.now()}
    gl.__rendererAudit=record;window.rendererAuditContexts.push(record)
    if(window.rendererAuditContexts.length>16)window.rendererAuditContexts.shift()
    const wrap=(name,body)=>{const original=gl[name];if(original)gl[name]=function(...a){return record.enabled===false?original.apply(gl,a):body(original,...a)}}
    for(const [kind,suffix,meta]of [['textures','Texture',textures],['buffers','Buffer',buffers],['framebuffers','Framebuffer',null],['renderbuffers','Renderbuffer',renderbuffers],['programs','Program',programs],['shaders','Shader',null]]){
      wrap(`create${suffix}`,(fn,...a)=>{const o=fn.apply(gl,a);if(o){const id=++next;ids.set(o,id);live[kind].add(id);meta?.set(id,{id,createdAt:performance.now()})}return o})
      wrap(`delete${suffix}`,(fn,o)=>{const id=o&&ids.get(o);if(id){live[kind].delete(id);const m=meta?.get(id);if(m)m.deletedAt=performance.now()}return fn.call(gl,o)})
    }
    wrap('activeTexture',(fn,unit)=>{activeUnit=unit-gl.TEXTURE0;return fn.call(gl,unit)})
    wrap('bindTexture',(fn,target,texture)=>{bindings.set(`${activeUnit}:${target}`,texture?ids.get(texture):null);return fn.call(gl,target,texture)})
    const textureFor=target=>textures.get(bindings.get(`${activeUnit}:${target>=34069&&target<=34074?gl.TEXTURE_CUBE_MAP:target}`))
    const image=(method,args)=>{
      const target=args[0],m=textureFor(target);if(!m)return
      const storage=method.startsWith('texStorage'),compressed=method.startsWith('compressed'),three=method.endsWith('3D')
      let level=storage?0:args[1],internal=args[2],width,height,depth=1,format,type,data
      if(storage){width=args[3];height=args[4];depth=three?args[5]:1;m.mipLevels=args[1]}
      else if(!three&&args.length===6&&!compressed){data=args[5];width=data?.videoWidth??data?.naturalWidth??data?.width;height=data?.videoHeight??data?.naturalHeight??data?.height;format=args[3];type=args[4]}
      else{width=args[3];height=args[4];depth=three?args[5]:1;format=compressed?undefined:args[three?7:6];type=compressed?undefined:args[three?8:7];data=args[three?9:8]}
      const key=`${target}:${level}`;m.levels??={};m.levels[key]={target,level,internal,width,height,depth,format,type,compressed,bytes:compressed?(args.findLast(x=>ArrayBuffer.isView(x))?.byteLength??0):undefined}
      m.target=target>=34069&&target<=34074?gl.TEXTURE_CUBE_MAP:target;m.uploads=(m.uploads??0)+1;record.textureUploads++
    }
    for(const method of ['texImage2D','texImage3D','texStorage2D','texStorage3D','compressedTexImage2D','compressedTexImage3D'])wrap(method,(fn,...a)=>{image(method,a);return fn.apply(gl,a)})
    wrap('generateMipmap',(fn,target)=>{const m=textureFor(target);if(m)m.generatedMipmaps=true;return fn.call(gl,target)})
    wrap('bindBuffer',(fn,target,buffer)=>{bufferBindings.set(target,buffer&&ids.get(buffer));return fn.call(gl,target,buffer)})
    wrap('bufferData',(fn,target,data,...a)=>{const m=buffers.get(bufferBindings.get(target));if(m){m.bytes=typeof data==='number'?data:data?.byteLength??0;m.target=target;m.uploads=(m.uploads??0)+1;record.bufferUploads++}return fn.call(gl,target,data,...a)})
    let renderbufferId
    wrap('bindRenderbuffer',(fn,target,buffer)=>{renderbufferId=buffer&&ids.get(buffer);return fn.call(gl,target,buffer)})
    for(const method of ['renderbufferStorage','renderbufferStorageMultisample'])wrap(method,(fn,...a)=>{const m=renderbuffers.get(renderbufferId),ms=method.endsWith('Multisample');if(m)Object.assign(m,{internal:a[ms?2:1],width:a[ms?3:2],height:a[ms?4:3],samples:ms?a[1]:1});return fn.apply(gl,a)})
    wrap('useProgram',(fn,program)=>{if(currentProgram!==program)record.switches++;currentProgram=program;return fn.call(gl,program)})
    wrap('compileShader',(fn,shader)=>{record.compileCalls++;const t=performance.now();const result=fn.call(gl,shader);record.compileCpuMs=(record.compileCpuMs??0)+performance.now()-t;return result})
    wrap('linkProgram',(fn,program)=>{record.linkCalls++;const m=programs.get(ids.get(program)),t=performance.now();if(m)m.linkStarted=t;const result=fn.call(gl,program);if(m)m.linkSubmitCpuMs=performance.now()-t;return result})
    const parallel=gl.getExtension('KHR_parallel_shader_compile')
    wrap('getProgramParameter',(fn,program,param)=>{
      const value=fn.call(gl,program,param),m=programs.get(ids.get(program))
      if(m&&param===parallel?.COMPLETION_STATUS_KHR&&value&&!m.observedReadyAt)m.observedReadyAt=performance.now()
      if(m&&param===gl.LINK_STATUS){m.linked=value;if(value===false&&!m.failureCaptured){
        m.failureCaptured=true;const shaders=gl.getAttachedShaders(program)??[],sources={}
        for(const shader of shaders)sources[gl.getShaderParameter(shader,gl.SHADER_TYPE)===gl.FRAGMENT_SHADER?'fragment':'vertex']=gl.getShaderSource(shader)
        if(failures.length<8)failures.push({programId:m.id,at:performance.now(),log:gl.getProgramInfoLog(program),...sources})
      }}return value
    })
    this.addEventListener('webglcontextlost',event=>{events.push({type:'lost',at:performance.now(),message:event.statusMessage});for(const set of Object.values(live))set.clear();bindings.clear();bufferBindings.clear()})
    this.addEventListener('webglcontextrestored',()=>events.push({type:'restored',at:performance.now()}))
    return gl
  }
  const WorkerBase=window.Worker
  window.rendererAuditWorkers=[]
  window.Worker=class extends WorkerBase{
    constructor(url,options){super(url,options);this.audit={url:String(url),createdAt:performance.now(),messages:0,received:0,kinds:{},terminated:false};window.rendererAuditWorkers.push(this.audit);this.addEventListener('message',()=>this.audit.received++)}
    postMessage(message,...args){this.audit.messages++;const kind=String(message?.kind??message?.type??'unknown');this.audit.kinds[kind]=(this.audit.kinds[kind]??0)+1;return super.postMessage(message,...args)}
    terminate(){this.audit.terminated=true;this.audit.terminatedAt=performance.now();return super.terminate()}
  }
}
