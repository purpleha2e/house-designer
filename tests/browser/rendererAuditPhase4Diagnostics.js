// Complete upload counters supplement the established full-image/allocation
// tracker. No GL state is changed and unchanged frames make no wrapper calls.
export function installPhase4UploadAudit() {
 const original=HTMLCanvasElement.prototype.getContext
 HTMLCanvasElement.prototype.getContext=function(...args){
  const gl=original.apply(this,args)
  if(gl&&typeof gl.bufferSubData==='function'&&!gl.__rendererPhase4Uploads){
   const counts=gl.__rendererPhase4Uploads={}
   for(const name of ['bufferData','bufferSubData','texImage2D','texImage3D','texStorage2D','texStorage3D','texSubImage2D','texSubImage3D','compressedTexImage2D','compressedTexImage3D','compressedTexSubImage2D','compressedTexSubImage3D']){
    const fn=gl[name];if(!fn)continue;counts[name]=0
    gl[name]=function(...a){counts[name]++;return fn.apply(gl,a)}
   }
  }
  return gl
 }
}

// Narrow instrumentation only; never used for normal acceptance timings.
export async function phase4Diagnostics() {
 const s=rendererRecovery.state(),r=s.gl,g=r.getContext(),{Raycaster,Vector3,getEditorFiber}=await rendererRecovery.modules()
 const result={warning:'Inclusive setter, GL and callback timers overlap. Do not add them.',programs:[],uniforms:[],rays:[],state:[]}
 const materialVersions=new Map();s.scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materialVersions.set(m,m.version)})
 const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text.replace(/^#define SHADER_NAME .*/mg,''))))].map(v=>v.toString(16).padStart(2,'0')).join('')
 for(const p of r.info.programs)result.programs.push({id:p.id,key:p.cacheKey,usedTimes:p.usedTimes,vertex:await digest(g.getShaderSource(p.vertexShader)),fragment:await digest(g.getShaderSource(p.fragmentShader))})
 const groups=new Map()
 for(const p of result.programs){const hash=p.vertex+p.fragment;let group=groups.get(hash);if(!group)groups.set(hash,group=[]);group.push(p)}
 result.duplicateSources=[...groups.values()].filter(a=>a.length>1).map(a=>({ids:a.map(p=>p.id),differences:a.slice(1).map(p=>{const left=a[0].key.split(','),right=p.key.split(',');return left.flatMap((v,i)=>v===right[i]?[]:[{index:i,left:v,right:right[i]}])})}))
 const restore=[],rows=new Map(),values=new WeakMap(),locations=new Map(),nativeValues=new Map()
 const wrap=(o,k,make)=>{const original=o[k];o[k]=make(original);restore.push(()=>o[k]=original)}
 const row=(name)=>{let v=rows.get(name);if(!v)rows.set(name,v={name,calls:0,ms:0,unchanged:0});return v}
 let active=false
 const flat=value=>value?.isTexture?[value.uuid]:value?.elements?Array.from(value.elements):value?.toArray?value.toArray():Array.isArray(value)||ArrayBuffer.isView(value)?Array.from(value).flatMap(flat):value&&typeof value==='object'?Object.values(value).flatMap(flat):[value]
 const visit=(u,prefix,pid)=>{const name=prefix?prefix+'.'+u.id:String(u.id);if(u.addr)locations.set(u.addr,name);if(u.seq)for(const c of u.seq)visit(c,name,pid);else if(u.setValue)wrap(u,'setValue',fn=>function(gl,v,...args){if(!active)return fn.call(this,gl,v,...args);const a=flat(v),previous=values.get(u),entry=row('setter:'+name),at=performance.now();entry.calls++;if(previous&&previous.length===a.length&&previous.every((v,i)=>v===a[i]))entry.unchanged++;values.set(u,a);try{return fn.call(this,gl,v,...args)}finally{entry.ms+=performance.now()-at}})}
 for(const p of r.info.programs)for(const u of p.getUniforms().seq)visit(u,'',p.id)
 for(const name of ['uniform1f','uniform1fv','uniform1i','uniform1iv','uniform2f','uniform2fv','uniform2iv','uniform3f','uniform3fv','uniform3iv','uniform4f','uniform4fv','uniform4iv','uniformMatrix2fv','uniformMatrix3fv','uniformMatrix4fv'])wrap(g,name,fn=>function(location,...args){if(!active)return fn.call(this,location,...args);const entry=row('native:'+name+':'+(locations.get(location)??'(unreflected)')),a=args.flatMap(flat),previous=nativeValues.get(location);entry.calls++;if(previous&&previous.length===a.length&&previous.every((v,i)=>Object.is(v,a[i])))entry.unchanged++;nativeValues.set(location,a);const at=performance.now();try{return fn.call(this,location,...args)}finally{entry.ms+=performance.now()-at}})
 for(const name of ['useProgram','bindVertexArray','vertexAttribPointer','vertexAttribDivisor','bindBuffer','activeTexture','bindTexture','vertexAttrib1fv','vertexAttrib2fv','vertexAttrib3fv','vertexAttrib4fv','drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(g,name,fn=>function(...args){if(!active)return fn.apply(this,args);const entry=row('GL:'+name),at=performance.now();try{return fn.apply(this,args)}finally{entry.calls++;entry.ms+=performance.now()-at}})
 wrap(r.state,'setMaterial',fn=>function(...args){if(!active)return fn.apply(this,args);const entry=row('state:setMaterial'),at=performance.now();try{return fn.apply(this,args)}finally{entry.calls++;entry.ms+=performance.now()-at}})
 wrap(r.state,'useProgram',fn=>function(...args){if(!active)return fn.apply(this,args);const entry=row('state:useProgram'),at=performance.now();try{const changed=fn.apply(this,args);entry.switches=(entry.switches??0)+Number(changed);return changed}finally{entry.calls++;entry.ms+=performance.now()-at}})
 for(const m of materialVersions.keys())wrap(m,'customProgramCacheKey',fn=>function(...args){if(!active)return fn.apply(this,args);const entry=row('key:'+m.uuid+':'+m.name),at=performance.now();try{return fn.apply(this,args)}finally{entry.calls++;entry.ms+=performance.now()-at}})
 try{active=true;const sample=await rendererAudit.sample(2500,true);active=false;result.setterFrames=sample.cpuFrameMs.count;result.uniforms=[...rows.values()].filter(v=>v.name.startsWith('setter:'));result.state=[...rows.values()].filter(v=>!v.name.startsWith('setter:'))}finally{restore.reverse().forEach(fn=>fn())}
 result.stairLabels=[]
 const labels=f=>{if(!f)return;const p=f.memoizedProps;if(p?.position&&p.children?.props?.className==='viewer-stair-button'){const position=new Vector3(...p.position),direction=s.camera.getWorldDirection(new Vector3());result.stairLabels.push({position:p.position,label:p.children.props['aria-label'],behind:position.clone().sub(s.camera.position).angleTo(direction)>Math.PI/2})}labels(f.child);labels(f.sibling)};labels(getEditorFiber())
 const sizes=new WeakMap();s.scene.traverse(o=>{let count=0;o.traverse(()=>count++);sizes.set(o,count)})
 const ids=new WeakMap(),rayRows=new Map();let next=0,movement='',depth=0
 for(const name of ['intersectObject','intersectObjects'])wrap(Raycaster.prototype,name,fn=>function(...args){if(depth)return fn.apply(this,args);let id=ids.get(this);if(!id)ids.set(this,id=++next);const key=movement+':'+id;let entry=rayRows.get(key);if(!entry)rayRows.set(key,entry={id,movement,method:name,sharedR3FRaycaster:this===s.raycaster,calls:0,ms:0,roots:0,expandedCandidates:0,hits:0,stack:new Error().stack});const objects=name==='intersectObjects'?args[0]:[args[0]],at=performance.now();entry.roots+=objects.length;entry.expandedCandidates+=objects.reduce((n,o)=>n+(args[1]===false?1:sizes.get(o)??1),0);depth++;try{const hits=fn.apply(this,args);entry.hits+=hits.length;return hits}finally{depth--;entry.calls++;entry.ms+=performance.now()-at}})
 try{for(const moving of [false,true]){movement=moving?'moving':'stationary';const sample=await rendererAudit.sample(3000,moving);result.rays.push({movement,frames:sample.cpuFrameMs.count,callbacks:sample.callbacks,queries:[...rayRows.values()].filter(r=>r.movement===movement)})}}finally{restore.splice(0).reverse().forEach(fn=>fn())}
 result.materials=[];const seen=new Set();s.scene.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){if(seen.has(m))continue;seen.add(m);const p=r.properties.get(m);result.materials.push({uuid:m.uuid,name:m.name,type:m.type,version:m.version,versionDelta:m.version-(materialVersions.get(m)??m.version),program:p.currentProgram?.id,programKeys:p.programs?[...p.programs.keys()]:[],customKey:m.customProgramCacheKey(),defaultAttributes:m.defaultAttributeValues,groups:o.geometry?.groups.length,instanced:!!o.isInstancedMesh})}})
 return result
}
