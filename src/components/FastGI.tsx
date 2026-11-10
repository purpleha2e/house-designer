/* eslint-disable react-hooks/immutability -- Imperative Three.js renderer resources. */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PointLight, SpotLight } from 'three'
import { createFastGI, fastGIRoom, type FastGIOptions } from '../fastGI'
import { prepareFastCaptureScene } from '../indirectCaptureScene'
import { indirectSurfaceSun } from '../indirectSurfaceRelighting'
import type { IndirectFloor } from '../indirectLighting'
import type { IndirectUniforms } from '../indirectLightingShader'
import { createFastGIDebug } from '../fastGIDebug'
import { setFastGIShaderFeature } from '../fastGIShader'

/** Console feature flag: houseDesignerFastGI.configure({enabled:true}).
 * Also accepts ?fastGI=1, and ?fastGI=captures for method A without geometry. */
export function FastGI({ floors, revision, enabled, blocked, featureEnabled, fallbackToPreview = false, probesEnabled = true, daylight, daylightBounceStrength, captureLights, uniforms }: {
  floors: IndirectFloor[]; revision: string; enabled: boolean; blocked:boolean; featureEnabled?:boolean; fallbackToPreview?: boolean; probesEnabled?:boolean; daylight:boolean; daylightBounceStrength:number; captureLights:readonly (PointLight|SpotLight)[]; uniforms: IndirectUniforms
}) {
  const { gl, scene, camera, invalidate } = useThree()
  const state = useRef<{ engine: ReturnType<typeof createFastGI>; key: string; debug: ReturnType<typeof createFastGIDebug> | null;
    options: FastGIOptions; error?: string }>({ engine: null, key: '', debug:null,
    options:{ enabled: /^(1|captures)$/.test(new URLSearchParams(location.search).get('fastGI')??''),
      hybrid:new URLSearchParams(location.search).get('fastGI')!=='captures',mode:'combined',viewsPerFrame:3 } })
  useEffect(()=>{if(featureEnabled!==undefined){state.current.options.enabled=featureEnabled;invalidate()}},[featureEnabled,invalidate])
  useEffect(()=>{
    const current=state.current
    const api={
      configure(options:Partial<FastGIOptions>) {
        Object.assign(current.options,options);current.options.viewsPerFrame=Math.max(1,Math.min(6,Math.floor(current.options.viewsPerFrame)||3))
        invalidate();return {...current.options}
      },
      refresh(){current.key='';invalidate()},
      get options(){return {...current.options}},get stats(){return current.error?{...current.engine?.stats,state:'unavailable',error:current.error}:current.engine?.stats??{state:'disabled'}},
      get engine(){return current.engine},
      get weight(){return uniforms.hdFastFeature.value&&uniforms.hdFastReady.value?uniforms.hdFastWeight.value:0},
      inspect(kind:Parameters<ReturnType<typeof createFastGIDebug>['inspect']>[0]='surfaces',view=0){
        if(!current.engine)throw Error('Enable experimental fast GI first')
        current.debug??=createFastGIDebug(gl,current.engine)
        return current.debug.inspect(kind,view)
      },
    }
    scene.userData.fastGI=api
    ;(window as unknown as Record<string,unknown>).houseDesignerFastGI=api
    return ()=>{
      current.debug?.dispose();current.engine?.dispose();uniforms.hdFastFeature.value=0
      // React refresh preserves refs while re-running effects. A disposed GPU
      // engine must not survive as the next component's supposedly ready field.
      current.debug=null;current.engine=null;current.key='';current.error=undefined
      delete scene.userData.fastGI
      if((window as unknown as Record<string,unknown>).houseDesignerFastGI===api) delete (window as unknown as Record<string,unknown>).houseDesignerFastGI
    }
  },[gl,invalidate,scene,uniforms])
  useFrame((_,delta)=>{
    const progress=scene.userData.indirectLighting
    const current=state.current,active=(current.options.enabled || fallbackToPreview && ['preview','fallback'].includes(progress?.state))&&enabled
    setFastGIShaderFeature(scene,uniforms.hdFastFeature,active)
    if(!active){if(current.engine){current.debug?.dispose();current.debug=null;current.engine.dispose();current.engine=null;current.key=''}return}
    if(gl.xr.isPresenting)return
    // Startup can still be publishing materials, geometry and sun shadows.
    // Never retain that temporary scene as the room's completed lighting.
    if(blocked||scene.userData.shaderWarmupPending){current.key='';invalidate();return}
    const room=fastGIRoom(floors,camera.position)
    if(!room) {
      current.error=undefined;current.key='';uniforms.hdFastReady.value=0
      current.debug?.dispose();current.debug=null;current.engine?.dispose();current.engine=null
      return
    }
    if(!current.engine){current.engine=createFastGI(gl,scene,uniforms);if(!current.engine){current.error='Requires WebGL2 float MRT and standard depth';return}}
    const sun=indirectSurfaceSun(scene)
    const key=JSON.stringify([room?.key,revision,scene.userData.fastGIRevision,current.options.hybrid,daylight,daylightBounceStrength,sun?.position.toArray(),sun?.color.toArray(),sun?.intensity])
    if(current.key!==key) {
      current.error=undefined
      current.key=key
      const id=current.engine.request(room,current.options.hybrid,daylight,daylightBounceStrength)
      const engine=current.engine
      void engine.prepare(id,()=>prepareFastCaptureScene(scene,()=>current.engine!==engine||engine.stats.revision!==id),captureLights)
    }
    const ready=progress?.state==='ready'&&!progress.pendingUpdate&&!progress.pendingLighting&&!scene.userData.indirectScanPending
    current.engine.stats.probeProgress=progress?.total?Math.min(1,progress.completed/progress.total):0
    // Turning off the original GI control isolates fast GI, even after the
    // background probes have completed. Both switches on retain refinement.
    const options=probesEnabled?current.options:{...current.options,mode:'fast' as const}
    const pending=current.engine.step(options,ready,Math.min(delta,.05))
    if(pending||current.engine.stats.state==='ready'&&(uniforms.hdFastWeight.value>0&&ready&&current.options.mode==='combined'))invalidate()
  })
  return null
}
