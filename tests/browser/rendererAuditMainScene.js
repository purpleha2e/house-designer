// Opt-in detailed window for the existing rendererAudit.sample protocol.
// Never enabled during baseline timing. All wrappers are restored in finally.
import {getEditorFiber,Object3D,Frustum,Matrix3,Matrix4} from './rendererTestModules.ts'
import {modelsById} from '../../src/models/modelLibrary.ts'

const composerIn=f=>f&&(f.memoizedProps?.composer?.current??composerIn(f.child)??composerIn(f.sibling))
const visit=(f,fn)=>{if(!f)return;fn(f);visit(f.child,fn);visit(f.sibling,fn)}
export async function profileMainScene(s,audit,duration=5000,moving=true){
 const r=s.gl,g=r.getContext(),composer=composerIn(getEditorFiber()),main=composer.passes[0]
 const restore=[],timings=new Map(),categories=new Map(),objects=new Map(),uniforms=new Map(),locations=new Map()
 const placementTypes=new Map(),modelViews=new WeakSet(),worlds=new WeakSet(),materialSet=new Set()
 const collect=f=>{const floors=f.memoizedProps?.floors;if(Array.isArray(floors))for(const floor of floors)for(const m of floor.models??[])placementTypes.set(m.id,modelsById.get(m.modelId)?.objectType??'other')}
 visit(getEditorFiber(),collect)
 const host=document.getElementById('root'),container=host?.[Object.keys(host).find(k=>k.startsWith('__reactContainer$'))]
 if(container?.stateNode?.current)visit(container.stateNode.current,collect)
 let inMain=false,inShadow=false,current=null,mainExecutions=0
 const rowFor=name=>{let row=categories.get(name);if(!row)categories.set(name,row={objects:new Set(),submittedObjects:new Set(),drawCalls:0,triangles:0,directCalls:0,directMs:0,materials:new Set(),programs:new Set(),textureBindings:0,textures:new Set()});return row}
 function category(o,m){
  if(m?.transparent||m?.transmission>0)return 'glass/transparency'
  let id=o.userData.modelIds?.[0],role=o.userData.houseDesignerRole??''
  for(let p=o;p;p=p.parent){id??=p.userData.houseDesignerBatchModelId??p.userData.modelId??(p.name.startsWith('model-transform-')?p.name.slice(16):undefined);if(!role)role=p.userData.houseDesignerRole??''}
  const type=placementTypes.get(id)
  if(type==='window'||type==='dormer-window')return 'windows'
  if(type?.includes('door'))return 'doors'
  if(type==='stairs')return 'stairs'
  if(type==='decor')return 'decorative objects'
  if(type==='lighting')return 'lighting helpers'
  if(id||role==='model-batch')return 'imported furniture'
  if(role.includes('wall')||role==='skirting')return 'walls'
  if(role.includes('ceiling')||role.includes('slab'))return 'ceilings'
  if(role.includes('floor')||role==='ground-plane')return 'floors'
  if(role.includes('roof'))return 'other architectural geometry'
  if(/light|helper|probe/.test(role)||o.isHelper)return 'lighting helpers'
  return 'other scene objects'
 }
 s.scene.traverse(o=>{worlds.add(o.matrixWorld);modelViews.add(o.modelViewMatrix);if(!o.geometry||!o.material)return;objects.set(o.uuid,{uuid:o.uuid,name:o.name,role:o.userData.houseDesignerRole,geometry:o.geometry.uuid,groups:o.geometry.groups.length,instances:o.isInstancedMesh?o.count:1,visible:o.visible,modelIds:o.userData.modelIds,materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>m.uuid)});for(const m of Array.isArray(o.material)?o.material:[o.material]){rowFor(category(o,m)).objects.add(o.uuid);materialSet.add(m)}})
 const active=()=>inMain&&!inShadow
 const add=(key,dt=0,count=1)=>{let row=timings.get(key);if(!row)timings.set(key,row={calls:0,ms:0});row.calls+=count;row.ms+=dt}
 function wrap(owner,key,make){const original=owner[key];if(typeof original!=='function')return;owner[key]=make(original);restore.push(()=>owner[key]=original)}
 function timed(owner,key,label,qualify=()=>true){let depth=0;wrap(owner,key,fn=>function(...args){if(!active()||!qualify.call(this,...args))return fn.apply(this,args);const outer=depth++===0,at=outer?performance.now():0;try{return fn.apply(this,args)}finally{depth--;add(label,outer?performance.now()-at:0)}})}
 // Material/program uniform locations are reflected outside the measured window.
 const walkUniform=(u,prefix='')=>{const name=prefix?`${prefix}.${u.id}`:String(u.id);if(u.addr)locations.set(u.addr,name);for(const c of u.seq??[])walkUniform(c,name)}
 for(const p of r.info.programs)for(const u of p.getUniforms().seq)walkUniform(u)
 const lastValues=new Map()
 function observeUniform(key,location,args,ms){
  const name=locations.get(location)??'(unreflected)',id=key+':'+name
  let row=uniforms.get(id);if(!row)uniforms.set(id,row={method:key,name,calls:0,ms:0,unchanged:0,elements:0})
  const values=args.flatMap(v=>typeof v==='number'?[v]:ArrayBuffer.isView(v)||Array.isArray(v)?Array.from(v):[]),previous=lastValues.get(location)
  row.calls++;row.ms+=ms;row.elements+=values.length
  if(previous&&previous.length===values.length&&previous.every((n,i)=>n===values[i]))row.unchanged++
  lastValues.set(location,values)
 }
 try{
  wrap(main,'render',fn=>function(...args){const previous=inMain;inMain=true;mainExecutions++;try{return fn.apply(this,args)}finally{inMain=previous}})
  wrap(r.shadowMap,'render',fn=>function(...args){const previous=inShadow;inShadow=true;try{return fn.apply(this,args)}finally{inShadow=previous}})
  wrap(r,'renderBufferDirect',fn=>function(...args){if(!active())return fn.apply(this,args);const [camera,scene,geometry,material,object,group]=args,name=category(object,material),row=rowFor(name),previous=current,before=r.info.render.calls,tri=r.info.render.triangles,at=performance.now();current=row;row.directCalls++;row.submittedObjects.add(object.uuid);row.materials.add(material.uuid);try{return fn.apply(this,args)}finally{row.directMs+=performance.now()-at;row.drawCalls+=r.info.render.calls-before;row.triangles+=r.info.render.triangles-tri;const p=r.properties.get(material).currentProgram;if(p)row.programs.add(p.id);current=previous}})
  for(const key of ['traverse','updateMatrixWorld','updateWorldMatrix'])timed(Object3D.prototype,key,'Object3D.'+key)
  timed(Frustum.prototype,'intersectsObject','frustum culling')
  timed(Matrix4.prototype,'multiplyMatrices','model-view matrix',function(){return modelViews.has(this)})
  timed(Matrix4.prototype,'multiplyMatrices','world matrix multiply',function(){return worlds.has(this)})
  timed(Matrix3.prototype,'getNormalMatrix','normal matrix')
  timed(r.state,'setMaterial','material GPU-state setup')
  const lists=new WeakSet()
  wrap(r.renderLists,'get',fn=>function(...args){const list=fn.apply(this,args);if(!lists.has(list)){lists.add(list);for(const key of ['init','push','unshift','finish','sort'])timed(list,key,'render-list '+key)}return list})
  for(const key of ['useProgram','activeTexture','bindTexture','enable','disable','depthFunc','depthMask','cullFace','frontFace','blendFuncSeparate','blendEquationSeparate','drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(g,key,fn=>function(...args){if(!active())return fn.apply(this,args);const at=performance.now();try{return fn.apply(this,args)}finally{add('GL.'+key,performance.now()-at);if(key==='bindTexture'&&current){current.textureBindings++;if(args[1])current.textures.add(args[1])}}})
  for(const key of ['uniform1f','uniform1fv','uniform1i','uniform1iv','uniform2f','uniform2fv','uniform2iv','uniform3f','uniform3fv','uniform3iv','uniform4f','uniform4fv','uniform4iv','uniformMatrix2fv','uniformMatrix3fv','uniformMatrix4fv'])wrap(g,key,fn=>function(location,...args){if(!active())return fn.call(this,location,...args);const at=performance.now();let dt;try{return fn.call(this,location,...args)}finally{dt=performance.now()-at;add('GL.'+key,dt);observeUniform(key,location,args,dt)}})
  const result=await audit.sample(duration,moving)
  const duplicates=new Map(),geometryReuse=new Map()
  for(const o of objects.values()){let group=geometryReuse.get(o.geometry);if(!group)geometryReuse.set(o.geometry,group=[]);group.push(o)}
  for(const m of materialSet){const p=r.properties.get(m),values={};for(const [key,u]of Object.entries(p.uniforms??{})){const v=u.value;values[key]=v?.isTexture?v.uuid:v?.toArray?v.toArray():ArrayBuffer.isView(v)?Array.from(v):typeof v==='number'||typeof v==='boolean'?v:undefined}const signature=JSON.stringify({type:m.type,key:m.customProgramCacheKey(),transparent:m.transparent,side:m.side,depthWrite:m.depthWrite,blending:m.blending,alphaTest:m.alphaTest,values});let row=duplicates.get(signature);if(!row)duplicates.set(signature,row=[]);row.push({uuid:m.uuid,name:m.name,program:p.currentProgram?.id})}
  return{durationMs:result.durationMs,mainExecutions,warning:'Detailed wrappers add overhead; timers overlap and are not additive. Use normal sample/CDP profile for frame cost.',timings:[...timings].map(([name,v])=>({name,...v,callsPerMain:v.calls/mainExecutions,msPerMain:v.ms/mainExecutions})),categories:[...categories].map(([name,v])=>({name,objects:v.objects.size,submittedObjects:v.submittedObjects.size,drawCallsPerMain:v.drawCalls/mainExecutions,trianglesPerMain:v.triangles/mainExecutions,directCallsPerMain:v.directCalls/mainExecutions,instrumentedDirectMsPerMain:v.directMs/mainExecutions,materials:v.materials.size,programs:v.programs.size,textureBindingsPerMain:v.textureBindings/mainExecutions,distinctBoundTextures:v.textures.size})),uniforms:[...uniforms.values()].map(v=>({...v,callsPerMain:v.calls/mainExecutions,msPerMain:v.ms/mainExecutions})).sort((a,b)=>b.calls-a.calls),objects:[...objects.values()],repeatedGeometry:[...geometryReuse.values()].filter(a=>a.length>1),duplicateMaterialCandidates:[...duplicates.values()].filter(a=>a.length>1),sample:result}
 }finally{for(const undo of restore.reverse())undo()}
}
