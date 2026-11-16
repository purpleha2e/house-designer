/* eslint-disable react-hooks/immutability -- This opt-in preview owns its GPU textures. */
import {useEffect,useLayoutEffect,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {Vector2,type Data3DTexture} from 'three'
import {snapshotLocalSunPreview} from '../localSunPreviewSnapshot.ts'
import {LOCAL_SUN_PREVIEW_BUDGET,localSunCameraKey,packLocalSunPreview} from '../localSunPreview.ts'
import type {IndirectUniforms} from '../indirectLightingShader.ts'
import {requestShaderWarmup} from '../shaderWarmupState.ts'
import {LIGHTING_REFINEMENT,type LightingRefinementQuality} from '../lightingRefinement.ts'
import {isViewportInteracting} from '../viewportScheduling.ts'

/** Progressive camera-local diffuse refinement. Moving/editing immediately hides
 * the old image. Off/unmount terminates the worker and releases every texture. */
export function LocalSunPreview({revision,onStatus,compareOriginal=false,combined=false,quality,manualRequest}:{revision:string;onStatus:(status:string)=>void;compareOriginal?:boolean;combined?:boolean;quality?:Exclude<LightingRefinementQuality,'fast'>;manualRequest?:number}){
  const state=useThree(),latest=useRef(onStatus),compare=useRef(compareOriginal)
  const request=useRef(manualRequest),consumedRequest=useRef(0)
  useLayoutEffect(()=>{request.current=manualRequest},[manualRequest])
  useLayoutEffect(()=>{latest.current=onStatus;compare.current=compareOriginal},[onStatus,compareOriginal])
  useEffect(()=>{state.scene.userData.displayEffectRevision=(state.scene.userData.displayEffectRevision??0)+1;state.invalidate()},[compareOriginal,state])
  const tick=useRef<()=>void>(()=>{})
  useEffect(()=>{
    const {scene,gl,camera,invalidate}=state
    let stopped=false,worker:Worker|undefined,uniforms:IndirectUniforms|undefined,preparing=false,prepared=false,failed=false,feature=false,id=0,snapshotVersion=0,renderKey='',cameraKey='',lastChange=performance.now(),busy=false,previousState='',lastMessage=''
    let armed=request.current===undefined
    const budget=quality?LIGHTING_REFINEMENT[quality]:{dimension:LOCAL_SUN_PREVIEW_BUDGET.maxDimension,rays:LOCAL_SUN_PREVIEW_BUDGET.rays,bounces:1}
    const size=new Vector2()
    let packed:ReturnType<typeof packLocalSunPreview>|undefined,packingSource:Data3DTexture|undefined
    let presentedId=-1,activeMessage=''
    let primaryVisibility:(()=>Uint8Array)|undefined
    const report=(text:string)=>{if(text!==lastMessage){lastMessage=text;latest.current(text)}Object.assign(scene.userData.localSunPreview??={},{message:text,active:!!uniforms?.hdLocalSunReady.value&&presentedId===id,busy})}
    const hide=()=>{if(uniforms?.hdLocalSunReady.value){uniforms.hdLocalSunReady.value=0;presentedId=-1;scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1;invalidate()}}
    const cancel=()=>{id++;worker?.postMessage({kind:'cancel'});busy=false;renderKey='';hide()}
    const refresh=()=>{cancel();snapshotVersion++;worker?.terminate();worker=undefined;prepared=false;preparing=false;packed?.texture.dispose();packed=undefined;packingSource=undefined;lastChange=performance.now()}
    const markShaders=()=>{requestShaderWarmup(scene);scene.traverse(o=>{const m=Reflect.get(o,'material');if(m)for(const material of Array.isArray(m)?m:[m])material.needsUpdate=true});invalidate()}
    const fail=(text:string)=>{failed=true;cancel();snapshotVersion++;prepared=false;preparing=false;worker?.terminate();worker=undefined;packed?.texture.dispose();packed=undefined;report('Preview unavailable: '+text)}
    scene.userData.bindLocalSunPreview=()=>{
      if(!packed||!uniforms?.hdLocalSunReady.value)return
      uniforms.hdLocalSunDisplay.value=compare.current?0:1
      if(compare.current)return
      camera.updateMatrixWorld();gl.getDrawingBufferSize(size)
      if(renderKey!==localSunCameraKey(camera.matrixWorld.elements,camera.projectionMatrix.elements,size.x,size.y)){
        cancel();lastChange=performance.now();return
      }
      const source=uniforms.hdGIVolume.value
      if(source!==packingSource){refresh();report('Refreshing lighting refinement...');return}
      uniforms.hdGIVolume.value=packed.texture;uniforms.hdLocalSunVolumeScale.value=packed.scale
      return(presented:boolean)=>{
        uniforms!.hdGIVolume.value=source;uniforms!.hdLocalSunVolumeScale.value=1
        if(presented&&presentedId!==id){presentedId=id;Object.assign(scene.userData.localSunPreview,{presented:true});report(activeMessage)}
      }
    }
    tick.current=()=>{
      if(stopped||(failed&&(request.current===undefined||request.current<=consumedRequest.current)))return
      if(gl.xr.isPresenting){if(busy||renderKey)cancel();lastChange=performance.now();report('Using probe lighting in VR');return}
      if(!Reflect.get(camera,'isPerspectiveCamera')){fail('This preview requires a perspective camera');return}
      uniforms=scene.userData.getIndirectUniforms?.();if(!uniforms)return
      uniforms.hdLocalSunCombined.value=combined?1:0
      uniforms.hdLocalSunDisplay.value=compare.current?0:1
      gl.getDrawingBufferSize(size);camera.updateMatrixWorld()
      const key=localSunCameraKey(camera.matrixWorld.elements,camera.projectionMatrix.elements,size.x,size.y),progress=scene.userData.indirectLighting
      const manual=request.current!==undefined
      if(manual&&request.current!>consumedRequest.current){
        consumedRequest.current=request.current!;armed=true;failed=false;cancel();cameraKey=key;lastChange=performance.now()
        report('Preparing this view; moving stops refinement')
      }
      const publication=JSON.stringify([progress?.generation,progress?.state,progress?.previewUpdates,progress?.fullPassPublications])
      if(publication!==previousState){previousState=publication;if(prepared||preparing)refresh()}
      if(key!==cameraKey){
        const moved=!!cameraKey;cameraKey=key;lastChange=performance.now();cancel()
        if(manual&&moved){armed=false;if(preparing){snapshotVersion++;preparing=false}report('Stopped by movement; choose Refine this view to restart')}
        else report(quality?'Move freely; lighting refines when still':'Hold the camera still to trace sunlight')
      }
      if(manual&&!armed)return
      if(isViewportInteracting()){if(busy){cancel();report('Paused for interaction; resumes when still')}lastChange=performance.now();return}
      const roomReady=progress?.state==='ready'||(progress?.state==='preview'&&progress?.diffuseReady&&!progress?.preparing&&!progress?.blocked)
      if(!roomReady||scene.userData.shaderWarmupPending){
        hide();lastChange=performance.now()
        report(scene.userData.shaderWarmupPending?'Preparing preview shaders...':`Preparing room lighting${progress?.total?` (${Math.floor(100*(progress.completed??0)/progress.total)}%)`:''}`);return
      }
      if(!feature){
        uniforms.hdLocalSunFeature.value=1;feature=true;markShaders()
      }
      if(combined&&!scene.userData.sunBounceExperiment?.ready){
        hide();lastChange=performance.now()
        const separation=scene.userData.sunBounceExperiment
        if(separation?.state==='error'){fail(separation.error??'Sunlight separation failed');return}
        report('Preparing sky and lamp GI without sunlight'+(separation?.passes?` (${separation.passes} passes)`:'')+'...');return
      }
      if(packed&&renderKey===cameraKey&&!busy&&!uniforms.hdLocalSunReady.value){
        uniforms.hdLocalSunReady.value=1
        scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1;invalidate()
      }
      if(performance.now()-lastChange<700)return
      if(!prepared&&!preparing){
        preparing=true;const attempt=++snapshotVersion;report(quality?'Preparing surface lighting...':'Preparing local sunlight preview')
        void snapshotLocalSunPreview(state,()=>stopped||attempt!==snapshotVersion,report,!!quality).then(snapshot=>{
          if(stopped||attempt!==snapshotVersion)return
          const data=snapshot.data;primaryVisibility=snapshot.primaryVisibility
          worker=new Worker(new URL('../localSunPreview.worker.ts',import.meta.url),{type:'module'})
          worker.onerror=e=>fail(e.message||'The tracing worker stopped')
          worker.onmessage=e=>{
            if(stopped)return
            const m=e.data
            if(m.kind==='prepared'){prepared=true;preparing=false;Object.assign(scene.userData.localSunPreview,{triangles:m.triangles,textureBytes:m.textureBytes});invalidate();return}
            if(m.kind==='error'){fail(m.error);return}
            if(m.id!==id)return
            if(m.kind==='progress'){
              Object.assign(scene.userData.localSunPreview??={},{workerProgress:m.percent,workerPhase:m.phase,elapsedMs:m.ms,totalRays:m.totalRays})
              report(quality?`${m.phase??'Refining surface lighting'}: ${m.percent}%${m.samples?` (${m.samples}/${m.target} samples)`:''} · ${Math.floor((m.ms??0)/1000)}s`:`Tracing reflected sunlight: ${m.percent}%`);return
            }
            if(m.kind==='image'){
              busy=m.done===false
              if(m.supportedPixels===0){fail('No supported visible surfaces in this view; move inside a room and retry');return}
              // Camera keys and ids both have to match; late results never bind.
              camera.updateMatrixWorld();gl.getDrawingBufferSize(size)
              if(renderKey!==localSunCameraKey(camera.matrixWorld.elements,camera.projectionMatrix.elements,size.x,size.y))return
              const old=packed
              // Bind the same display volume used by the floor/strength effects.
              const restoreFloor=scene.userData.bindSoftFloorGI?.(),restoreOff=scene.userData.bindSunOffSoftFloorGI?.(),restoreSun=scene.userData.bindSunBounceGI?.()
              try{
                packingSource=uniforms!.hdGIVolume.value as Data3DTexture
                packed=packLocalSunPreview(packingSource,m.image,m.normals)
                const context=gl.getContext() as WebGL2RenderingContext
                if(packed.texture.image.depth>context.getParameter(context.MAX_3D_TEXTURE_SIZE))throw Error('Preview exceeds this GPU texture size limit')
                uniforms!.hdLocalSunPackedSize.value.copy(packed.layout)
                gl.initTexture(packed.texture)
              }catch(e){fail(String(e));return}
              finally{restoreSun?.();restoreOff?.();restoreFloor?.()}
              uniforms!.hdLocalSunSize.value.set(m.width,m.height)
              uniforms!.hdLocalSunViewProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
              uniforms!.hdLocalSunReady.value=1
              old?.texture.dispose()
              scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1
              Object.assign(scene.userData.localSunPreview,{ms:m.ms,unsupported:m.unsupported,receivers:m.receivers,supportedPixels:m.supportedPixels,reasons:m.reasons,width:m.width,height:m.height,rays:m.rays,denoised:m.denoised,quality,bounces:m.bounces,totalRays:m.totalRays,complete:m.done!==false})
              Object.assign(scene.userData.localSunPreview,{combined})
              activeMessage=quality?`${LIGHTING_REFINEMENT[quality].label.split(' — ')[0]} lighting ${m.done===false?'refining':'ready'} · ${m.rays} samples${m.unsupported?' · probes retained on unsupported surfaces':''}`:`${combined?'Combined GI':'Local sunlight'} active (${(m.ms/1000).toFixed(1)} s; ${m.unsupported} unsupported pixels)`
              presentedId=-1
              report('Trace ready; waiting for the displayed frame');invalidate()
            }
          }
          const transfer=[data.positions.buffer,data.normals.buffer,data.uvs.buffer,data.materialIndices.buffer,data.owners.buffer,...data.textures.map(t=>t.pixels.buffer)]
          worker.postMessage({kind:'prepare',data},transfer)
        }).catch(e=>{if(!stopped&&attempt===snapshotVersion)fail(String(e))})
      }
      if(prepared&&!busy&&renderKey!==cameraKey){
        renderKey=cameraKey;busy=true;id++
        const width=Math.max(16,Math.round(budget.dimension*Math.min(1,size.x/size.y))),height=Math.max(16,Math.round(budget.dimension*Math.min(1,size.y/size.x)))
        const visibleTriangles=primaryVisibility?.()
        worker!.postMessage({kind:'render',id,camera:{world:camera.matrixWorld.toArray(),projectionInverse:camera.projectionMatrixInverse.toArray(),width,height,rays:budget.rays,bounces:budget.bounces,visibleTriangles}},visibleTriangles?[visibleTriangles.buffer]:[])
      }
    }
    const timer=window.setInterval(()=>invalidate(),200);invalidate()
    return()=>{
      stopped=true;tick.current=()=>{};window.clearInterval(timer);worker?.terminate();hide()
      if(uniforms&&feature){uniforms.hdLocalSunFeature.value=0;uniforms.hdLocalSunReady.value=0;uniforms.hdLocalSunCombined.value=0;markShaders()}
      packed?.texture.dispose();delete scene.userData.bindLocalSunPreview;delete scene.userData.localSunPreview;latest.current('');invalidate()
    }
    // Scene/input revision explicitly restarts the opt-in snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[state.scene,state.gl,state.camera,revision,combined,quality])
  useFrame(()=>tick.current(),-1)
  return null
}
