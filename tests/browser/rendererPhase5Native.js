export function installBoundedAudit(pace=true){
  const raf=window.requestAnimationFrame.bind(window)
  if(pace)window.requestAnimationFrame=callback=>raf(()=>setTimeout(()=>callback(performance.now()),250))
  const get=HTMLCanvasElement.prototype.getContext
  window.phase5Contexts=[]
  HTMLCanvasElement.prototype.getContext=function(...args){
    const gl=get.apply(this,args);if(!gl||!gl.createBuffer||gl.__phase5Native)return gl
    const audit={buffers:[],vaos:[],created:performance.now()},bound=new Map(),bufferIds=new WeakMap();gl.__phase5Native=audit;phase5Contexts.push(new WeakRef(gl))
    for(const [kind,create,remove] of [['buffers','createBuffer','deleteBuffer'],['vaos','createVertexArray','deleteVertexArray']]){
      const ids=new WeakMap(),c=gl[create],d=gl[remove]
      gl[create]=function(...args){const object=c.apply(this,args);if(object){const r={id:audit[kind].length,at:performance.now(),operation:window.phase5Operation??'initial',ref:new WeakRef(object)};ids.set(object,r);if(kind==='buffers')bufferIds.set(object,r);audit[kind].push(r)}return object}
      gl[remove]=function(object){const r=object&&ids.get(object);if(r)r.deletedAt=performance.now();return d.call(this,object)}
    }
    const bind=gl.bindBuffer,data=gl.bufferData
    gl.bindBuffer=function(target,buffer){bound.set(target,buffer&&bufferIds.get(buffer));return bind.call(this,target,buffer)}
    gl.bufferData=function(target,array,...args){const r=bound.get(target);if(r){r.bytes=typeof array==='number'?array:array?.byteLength;r.attributes=window.phase5AttributeArrays?.get(array)}return data.call(this,target,array,...args)}
    return gl
  }
  window.phase5NativeSnapshot=()=>phase5Contexts.map(ref=>{const gl=ref.deref();if(!gl)return{collected:true};const a=gl.__phase5Native
    return Object.fromEntries(['buffers','vaos'].map(kind=>[kind,{created:a[kind].length,deleted:a[kind].filter(r=>r.deletedAt).length,
      outstanding:a[kind].filter(r=>!r.deletedAt).length,actual:a[kind].filter(r=>!r.deletedAt&&r.ref.deref()&&gl[kind==='buffers'?'isBuffer':'isVertexArray'](r.ref.deref())).length,
      collected:a[kind].filter(r=>!r.deletedAt&&!r.ref.deref()).length}]))})
  window.phase5NativeTrace=()=>phase5Contexts.map(ref=>{const gl=ref.deref();if(!gl)return{collected:true};return Object.fromEntries(['buffers','vaos'].map(kind=>[kind,gl.__phase5Native[kind].slice(-256).map(({ref,...r})=>({...r,reachable:!!ref.deref(),valid:!!ref.deref()&&gl[kind==='buffers'?'isBuffer':'isVertexArray'](ref.deref())}))]))})
}
