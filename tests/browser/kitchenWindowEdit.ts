import type {RootState} from '@react-three/fiber'

/** Real authored edit, automatic production GI; no diagnostic feature toggles. */
export function measureKitchenWindowEdit(s:RootState,move:()=>void){
  return new Promise((resolve,reject)=>{
    const before=s.scene.userData.indirectLighting,generation=before.generation,started=performance.now(),render=s.gl.render
    let geometryVisibleMs=0,firstProbeMs=0,firstPublishedMs=0,done=false
    s.gl.render=function(scene,camera){
      const value=render.call(this,scene,camera)
      if(!geometryVisibleMs&&(scene===s.scene||scene.userData.retainedViewport))scene.traverse(o=>{if(o.userData.wallOpeningPreview&&o.children.length)geometryVisibleMs=performance.now()-started})
      return value
    }
    const cleanup=()=>{done=true;s.gl.render=render}
    move()
    function tick(){
      if(done)return
      const g=s.scene.userData.indirectLighting,elapsedMs=performance.now()-started
      if(g.generation>generation&&g.completed>0)firstProbeMs||=elapsedMs
      if(g.generation>generation&&g.previewUpdates>0)firstPublishedMs||=elapsedMs
      if(g.generation>generation&&g.state==='ready'&&!g.volumePending&&!g.pendingUpdate&&!g.pendingLighting&&!g.saving){
        cleanup();resolve({geometryVisibleMs,firstProbeMs,firstPublishedMs,totalMs:elapsedMs,status:{...g},performance:s.scene.userData.getLightingPerformance()});return
      }
      if(g.state==='fallback'||elapsedMs>900000){cleanup();reject(Error('Window edit failed: '+JSON.stringify(g)));return}
      requestAnimationFrame(tick)
    }requestAnimationFrame(tick)
  })
}
