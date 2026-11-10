// Test-only bounded trace. No production imports, GPU readbacks or GL state changes.
export function installSceneEditPreload(options={}){
 const events=[],roots=new Map(),workers=new Map();let sequence=0,generation=0,nextRenderer=0,nextWorker=0,commits=0
 const record=(kind,data={})=>{events.push({seq:++sequence,at:performance.now(),generation,...data,kind});if(events.length>2400)events.shift()}
 window.sceneEditTrace={events,roots,workers,record,get commits(){return commits},get generation(){return generation},mark(kind,data){generation++;record(kind,data)}}
 const renderers=new Map()
 if(options.devtools!==false)window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers,inject(renderer){const id=++nextRenderer;renderers.set(id,renderer);return id},onCommitFiberRoot(id,root){commits++;roots.set(root,id);record('react.commit',{renderer:id})},onCommitFiberUnmount(){},onPostCommitFiberRoot(){},onScheduleFiberRoot(){},checkDCE(){}}
 const NativeWorker=window.Worker
 window.Worker=class extends NativeWorker{
  constructor(url,options){super(url,options);this.traceId=++nextWorker;this.traceRequest=0;this.tracePending=new Map();const row={id:this.traceId,url:String(url),pending:false};workers.set(this.traceId,row);record('worker.created',row)
   this.addEventListener('message',e=>{const data=e.data,key=data?.id??data?.requestId,entry=key===undefined?[...this.tracePending.values()][0]:[...this.tracePending.values()].find(p=>p.messageId===key),progress=!!data?.progress||!!data?.lampQuery||!!data?.stream||data?.type==='progress';if(!progress&&entry)this.tracePending.delete(entry.request);row.pending=this.tracePending.size>0;row.outstanding=this.tracePending.size;row.repliedAt=performance.now();record(progress?'worker.progress':'worker.response',{id:this.traceId,request:entry?.request??this.traceRequest,messageId:key,requestGeneration:entry?.generation??row.generation,ok:data?.ok,type:data?.type??data?.kind,lampQuery:!!data?.lampQuery})})
   this.addEventListener('error',e=>record('worker.error',{id:this.traceId,message:e.message}))
  }
  postMessage(data,...args){this.traceRequest++;const row=workers.get(this.traceId),oneWay=data?.kind==='lampResult'||(row.url.startsWith('blob:')&&data?.type==='init')||(row.url.includes('wallRoofClip.worker')&&!!data?.stream&&data.stream!=='start');if(!oneWay)this.tracePending.set(this.traceRequest,{request:this.traceRequest,messageId:data?.id??data?.requestId,generation});Object.assign(row,{pending:this.tracePending.size>0,outstanding:this.tracePending.size,request:this.traceRequest,messageId:data?.id??data?.requestId,kind:data?.kind??data?.type??data?.stream,requestedAt:performance.now(),generation});record(oneWay?'worker.one-way':'worker.request',{...row,messageKind:row.kind});return super.postMessage(data,...args)}
  terminate(){const row=workers.get(this.traceId);this.tracePending.clear();row.pending=false;row.outstanding=0;row.terminated=true;record('worker.terminated',{id:this.traceId,request:this.traceRequest});return super.terminate()}
 }
}

export async function installSceneEditTrace(s){
 const {getEditorFiber}=await import('./rendererTestModules.ts'),t=window.sceneEditTrace
 const original=s.gl.render;let submissions=0,mainRenders=0,houseCpuMs=0,lastRender=null,mainSampleAt=0,heartbeatAt=performance.now(),maxHeartbeatGap=0,heartbeats=0,rafCount=0,active=true,lastSignature=''
 const sunIn=scene=>{let light;scene.traverse(o=>{if(o.userData.houseDesignerRole==='sun-light')light={uuid:o.uuid,position:o.position.toArray(),world:o.matrixWorld.elements.slice(12,15)}});return light}
 s.gl.render=function(scene,camera){const main=camera===s.camera&&scene.isScene,at=performance.now();try{return original.apply(this,arguments)}finally{submissions++;if(main){houseCpuMs+=performance.now()-at;mainRenders++;if(performance.now()-mainSampleAt>200){mainSampleAt=performance.now();lastRender={at:mainSampleAt,scene:scene.uuid,prepared:!!scene.userData.preparedLightingViewport,sun:sunIn(scene)}}}}}
 const heartbeat=setInterval(()=>{const now=performance.now();maxHeartbeatGap=Math.max(maxHeartbeatGap,now-heartbeatAt);heartbeatAt=now;heartbeats++},100)
 const raf=()=>{rafCount++;if(active)requestAnimationFrame(raf)};requestAnimationFrame(raf)
 const simple=p=>p&&({sun:p.lightDirection&&{...p.lightDirection},temporary:p.floors?.some(f=>f.models?.some(m=>m.id==='renderer-audit-temporary-model')),targetPresent:t.targetModelId&&p.floors?.some(f=>f.models?.some(m=>m.id===t.targetModelId)),targetPosition:t.targetModelId&&p.floors?.find(f=>f.models?.some(m=>m.id===t.targetModelId))?.models.find(m=>m.id===t.targetModelId)?.position,selectedModelId:p.selectedModelId,finish:p.surfaceAssignments?.some(a=>a.customColor==='#778899'),assignmentCount:p.surfaceAssignments?.length,wallPending:p.isWallGeometryPending,roofPending:p.isRoofGeometryPending,cooperativePending:p.isCooperativePreparationPending})
 const walk=(fiber,visit)=>{if(!fiber)return;visit(fiber);walk(fiber.child,visit);walk(fiber.sibling,visit)}
 const components=root=>{const rows=[];walk(root,f=>{const name=typeof f.type==='function'?f.type.name:f.type?.type?.name;if(['App','FloorplanCanvas','ThreeDView','ThreeDScene','SunLight','RecoveryFixture','DeferredCanvasContents'].includes(name)){
   const row={name,props:simple(f.memoizedProps)};if(name==='ThreeDView'){row.hooks=[];let incoming,painted;for(let h=f.memoizedState;h;h=h.next){const v=h.memoizedState;if(v?.lightDirection){painted=v;row.hooks.push(simple(v))}else if(Array.isArray(v)&&v[0]?.lightDirection){incoming=v[0];row.hooks.push({deferred:simple(v[0])})}}row.publicationPending=incoming!==painted}
   if(name==='App'){row.hooks=[];let index=0;for(let h=f.memoizedState;h;h=h.next,index++){const v=h.memoizedState;if(Array.isArray(v)&&v[0]?.models)row.hooks.push({index,kind:'floors-state',value:simple({floors:v})});else if(v?.floors)row.hooks.push({index,kind:'input',value:simple(v)});else if(Array.isArray(v)&&v[0]?.floors)row.hooks.push({index,kind:'memoized-input',value:simple(v[0])})}}
   rows.push(row)
  }});return rows}
 const oldPredicate=()=>{let sun,temporary=false,finish=false;walk(getEditorFiber(),f=>{const p=f.memoizedProps;if(p?.lightDirection&&p.shadowMapSize)sun=p.lightDirection;if(p?.model?.id==='renderer-audit-temporary-model')temporary=true;if(p?.surfaceAssignments?.some(a=>a.customColor==='#778899'))finish=true});return{sun,temporary,finish}}
 function snapshot(){
  const u=s.scene.userData,n=s.gl.getContext().__rendererAudit,current=[]
  let bridge=getEditorFiber();while(bridge?.return)bridge=bridge.return
  const host=document.getElementById('root'),dom=host?.[Object.keys(host).find(k=>k.startsWith('__reactContainer$'))]
  if(dom?.stateNode?.current)t.roots.set(dom.stateNode,'dom-current')
  if(bridge?.stateNode?.current)t.roots.set(bridge.stateNode,'canvas-current')
  for(const [root,id]of t.roots)current.push({renderer:id,pendingLanes:root.pendingLanes,suspendedLanes:root.suspendedLanes,pingedLanes:root.pingedLanes,callbackPriority:root.callbackPriority,components:components(root.current)})
  const result={at:performance.now(),generation:t.generation,commits:t.commits,uiProfiler:window.rendererAuditReact&&{...window.rendererAuditReact},oldPredicate:oldPredicate(),current,physical:{temporary:!!s.scene.getObjectByName('model-transform-renderer-audit-temporary-model'),targetPresent:t.targetModelId&&!!s.scene.getObjectByName('model-transform-'+t.targetModelId),sun:sunIn(s.scene)},render:{submissions,houseSubmissions:mainRenders,houseCpuMs,lastRender,rafCount},heartbeat:{heartbeats,maxGapMs:maxHeartbeatGap,lastAt:heartbeatAt},phase:u.progressiveStartup,warm:u.shaderWarmupPending,warmGeneration:u.shaderWarmupGeneration,warmFailure:u.shaderWarmupFailure,warmProfiles:u.shaderWarmupProfile?.slice(-3).map(p=>({stages:p.stages,cancelled:p.cancelled,generation:p.generation})),preparation:u.viewportPreparation,gi:{...u.indirectLighting},softFloor:u.softFloorGI,programs:s.gl.info.programs.length,compileCalls:n?.compileCalls,linkCalls:n?.linkCalls,workers:[...t.workers.values()].map(w=>({...w})),health:u.getRendererHealth?.(false)}
  const signature=JSON.stringify({old:result.oldPredicate,current,physical:result.physical,warm:result.warm,warmGeneration:result.warmGeneration,preparation:result.preparation,gi:result.gi,workers:result.workers})
  if(signature!==lastSignature){lastSignature=signature;t.record('state.transition',{state:result})}
  return result
 }
 t.snapshot=snapshot;t.stop=()=>{active=false;clearInterval(heartbeat);s.gl.render=original};return snapshot()
}

export async function editorPlanModelPoint(id){
 const {default:Konva}=await import('konva'),p=window.editorProps('FloorplanCanvas'),m=p.activeFloor.models.find(m=>m.id===id)
 if(!m)throw Error('Requested model is not on the active floor')
 const stage=Konva.stages.find(s=>s.container().isConnected)
 const group=stage.find('Group').find(g=>Math.abs(g.x()-m.position.x*60)<.01&&Math.abs(g.y()-m.position.y*60)<.01&&g.draggable())
 if(!group)throw Error('Rendered model plan group missing')
 // Selection gizmos extend the group's bounds beyond the actual object.
 const footprint=group.find('Rect').find(n=>n.width()>10&&n.height()>10&&!n.draggable())
 const r=(footprint??group).getClientRect(),c=stage.container().getBoundingClientRect()
 return{x:c.x+r.x+r.width/2,y:c.y+r.y+r.height/2,model:{...m},bounds:r}
}

// Locate a visible wall from the existing CPU pick targets. The test then sends
// a real pointer click; it never calls the application's selection callback.
export async function editorWallPoint(){
 const {Raycaster,Vector2}=await import('./rendererTestModules.ts')
 const {isFadedWallSurface}=await import('/src/components/WallViewFade.tsx')
 const {isProximityFadedObject}=await import('/src/components/ProximityViewFade.tsx')
 let targets
 const visit=f=>{if(!f)return;for(let h=f.memoizedState;h;h=h.next){const a=h.memoizedState?.current;if(Array.isArray(a)&&a.some(t=>t?.object?.isObject3D&&t.kind))targets=a}visit(f.child);visit(f.sibling)}
 visit(window.editorCurrent())
 if(!targets)throw Error('Editor pick targets not ready')
 const s=window.editorState(),r=s.gl.domElement.getBoundingClientRect(),ray=new Raycaster()
 for(const fy of [.25,.35,.45,.55,.65])for(const fx of [.35,.45,.55,.65,.25,.75]){
  ray.setFromCamera(new Vector2(fx*2-1,1-fy*2),s.camera)
  const hits=targets.filter(t=>t.kind!=='room-surface-area'&&!isProximityFadedObject(t.object)).flatMap(t=>ray.intersectObject(t.object,true).map(hit=>({t,hit,surface:t.surface??t.groupTargets?.get(hit.face?.materialIndex??0)??t.resolveFallbackSurface?.(hit.point)}))).filter(v=>!v.surface||!isFadedWallSurface(v.t.object,v.surface)).sort((a,b)=>a.hit.distance-b.hit.distance)
  const hit=hits[0]
  if(['wall-face','wall-surface-fragment'].includes(hit?.surface?.type))return{x:r.x+r.width*fx,y:r.y+r.height*fy,surface:hit.surface}
 }
 throw Error('No unobscured wall found at the sampled viewport points')
}
