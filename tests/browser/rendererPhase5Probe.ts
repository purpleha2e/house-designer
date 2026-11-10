/* eslint-disable @typescript-eslint/no-explicit-any -- Opt-in diagnostics inspect heterogeneous Three/R3F owners. */
import {BufferGeometry} from 'three'

// Opt-in, bounded ownership diagnostics. Weak references never keep GPU owners alive.
if (new URLSearchParams(location.search).has('phase5')) {
  const records = new Map<number, any>()
  const roots = new Map<number, {ref:WeakRef<any>;kind:string}>()
  const arrays = new WeakMap<object, any[]>(), attributeIds = new WeakMap<object, number>()
  let nextAttributeId=0
  Object.assign(window,{phase5AttributeArrays:arrays})
  let operation = 'initial', allocations = 0
  function record(g: BufferGeometry) {
    let r = records.get(g.id)
    if (!r && records.size < 12000) {
      r = {id:g.id, uuid:g.uuid, type:g.type, createdAt:performance.now(), operation,revision:(window as any).rendererRecovery?.revision,
        ref:new WeakRef(g), owners:[], disposals:[]}
      // Sample allocation sites only in this explicitly enabled diagnostic fixture.
      if (++allocations % 8 === 0) r.stack = new Error().stack
      records.set(g.id,r)
    }
    return r
  }
  const setAttribute = BufferGeometry.prototype.setAttribute
  const attribute=(g:BufferGeometry,name:string,a:any)=>{
    const array=a?.array??a?.data?.array
    if(!array)return
    let id=attributeIds.get(a);if(id===undefined){id=++nextAttributeId;attributeIds.set(a,id)}
    const list=arrays.get(array)??[]
    if(!list.some(v=>v.geometry===g.id&&v.name===name))list.push({geometry:g.id,name,attribute:id})
    arrays.set(array,list)
  }
  BufferGeometry.prototype.setAttribute = function(...args) {record(this);attribute(this,args[0],args[1]); return setAttribute.apply(this,args)}
  const setIndex=BufferGeometry.prototype.setIndex
  BufferGeometry.prototype.setIndex=function(...args){const result=setIndex.apply(this,args);record(this);attribute(this,'index',this.index);return result}
  const dispose = BufferGeometry.prototype.dispose
  BufferGeometry.prototype.dispose = function() {record(this)?.disposals.push({at:performance.now(),operation});return dispose.call(this)}
  // WebGLRenderer defines render on instances; state() installs the wrapper once.
  Object.assign(window,{phase5:{records,setOperation:(name:string)=>operation=name,
    install(s:any) {
      if(s.gl.__phase5)return
      s.gl.__phase5=true
      const trackRoot=(scene:any,kind:string)=>{if(roots.size<1000)roots.set(scene.id,{ref:new WeakRef(scene),kind})}
      for(const method of ['compile','compileAsync']){
        const original=s.gl[method]
        s.gl[method]=function(scene:any,...args:any[]){
          scene.traverse((o:any)=>{if(!o.geometry)return;let owner=o;while(owner.parent)owner=owner.parent;trackRoot(owner,owner===s.scene?'live':'shader-prototype-root')})
          return original.call(this,scene,...args)
        }
      }
      const original=s.gl.render
      s.gl.render=function(scene:any,...args:any[]) {
        trackRoot(scene,scene===s.scene?'live':scene.userData.retainedViewport?'retained':scene.userData.preparedLightingViewport?'prepared-lighting':'temporary-render-root')
        scene.traverse((o:any)=>{if(!o.geometry)return;const r=record(o.geometry);if(!r)return
          if(r.owners.length<8&&!r.owners.some((v:any)=>v.id===o.id))r.owners.push({id:o.id,name:o.name,type:o.type,role:o.userData.houseDesignerRole,parent:o.parent?.name,materials:(Array.isArray(o.material)?o.material:[o.material]).filter(Boolean).map((m:any)=>m.uuid)})
          for(const [name,a]of Object.entries(o.geometry.attributes))attribute(o.geometry,name,a)
          attribute(o.geometry,'index',o.geometry.index)
          r.renderedRevision=(window as any).rendererRecovery?.revision
          r.renderedAt=performance.now();r.renderOperation=operation
        })
        return original.call(this,scene,...args)
      }
    },
    snapshot(s:any) {
      const live=new Set<number>();s?.scene.traverse((o:any)=>{if(o.geometry)live.add(o.geometry.id)})
      const references=new Map<number,object[]>()
      for(const [id,root]of roots){const scene=root.ref.deref();if(!scene)continue;scene.traverse((o:any)=>{if(!o.geometry)return;const list=references.get(o.geometry.id)??[];if(!list.some((v:any)=>v.id===id))list.push({id,kind:root.kind,active:scene===s?.scene});references.set(o.geometry.id,list)})}
      return {operation,at:performance.now(),three:s?.gl.info.memory,programs:s?.gl.info.programs?.length,
        geometries:[...records.values()].map(({ref,...r})=>({...r,reachable:!!ref.deref(),liveScene:live.has(r.id),references:references.get(r.id)??[]}))}
    }}})
}
