/* eslint-disable react-hooks/immutability -- This opt-in preview owns its GPU textures. */
import {useEffect,useLayoutEffect,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {Vector2,type Data3DTexture} from 'three'
import {snapshotLocalSunPreview} from '../localSunPreviewSnapshot.ts'
import {LOCAL_SUN_PREVIEW_BUDGET,localSunCameraKey,packLocalSunPreview} from '../localSunPreview.ts'
import type {IndirectUniforms} from '../indirectLightingShader.ts'
import {requestShaderWarmup} from '../shaderWarmupState.ts'

/** Temporary camera-local diffuse preview. Moving/editing immediately hides
 * the old image. Off/unmount terminates the worker and releases every texture. */
export function LocalSunPreview({revision,onStatus,compareOriginal=false,combined=false}:{revision:string;onStatus:(status:string)=>void;compareOriginal?:boolean;combined?:boolean}){
  const state=useThree(),latest=useRef(onStatus),compare=useRef(compareOriginal)
  useLayoutEffect(()=>{latest.current=onStatus;compare.current=compareOriginal},[onStatus,compareOriginal])
  useEffect(()=>{state.scene.userData.displayEffectRevision=(state.scene.userData.displayEffectRevision??0)+1;state.invalidate()},[compareOriginal,state])
  const tick=useRef<()=>void>(()=>{})
  useEffect(()=>{
    const {scene,gl,camera,invalidate}=state
    let stopped=false,worker:Worker|undefined,uniforms:IndirectUniforms|undefined,preparing=false,prepared=false,failed=false,feature=false,id=0,renderKey='',cameraKey='',lastChange=performance.now(),busy=false,previousState='',lastMessage=''
    const size=new Vector2()
    let packed:ReturnType<typeof packLocalSunPreview>|undefined,packingSource:Data3DTexture|undefined
    let presentedId=-1,activeMessage=''
    let primaryVisibility:(()=>Uint8Array)|undefined
    const report=(text:string)=>{if(text!==lastMessage){lastMessage=text;latest.current(text)}Object.assign(scene.userData.localSunPreview??={},{message:text,active:!!uniforms?.hdLocalSunReady.value&&presentedId===id,busy})}
    const hide=()=>{if(uniforms?.hdLocalSunReady.value){uniforms.hdLocalSunReady.value=0;presentedId=-1;scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1;invalidate()}}
    const cancel=()=>{id++;worker?.postMessage({kind:'cancel'});busy=false;renderKey='';hide()}
    const markShaders=()=>{requestShaderWarmup(scene);scene.traverse(o=>{const m=Reflect.get(o,'material');if(m)for(const material of Array.isArray(m)?m:[m])material.needsUpdate=true});invalidate()}
    const fail=(text:string)=>{failed=true;cancel();worker?.terminate();worker=undefined;report('Preview unavailable: '+text)}
    scene.userData.bindLocalSunPreview=()=>{
      if(!packed||!uniforms?.hdLocalSunReady.value)return
      uniforms.hdLocalSunDisplay.value=compare.current?0:1
      if(compare.current)return
      camera.updateMatrixWorld();gl.getDrawingBufferSize(size)
      if(renderKey!==localSunCameraKey(camera.matrixWorld.elements,camera.projectionMatrix.elements,size.x,size.y)){
        cancel();lastChange=performance.now();return
      }
      const source=uniforms.hdGIVolume.value
      if(source!==packingSource){fail('Lighting texture changed; switch the preview off and on to refresh');return}
      uniforms.hdGIVolume.value=packed.texture;uniforms.hdLocalSunVolumeScale.value=packed.scale
      return(presented:boolean)=>{
        uniforms!.hdGIVolume.value=source;uniforms!.hdLocalSunVolumeScale.value=1
        if(presented&&presentedId!==id){presentedId=id;Object.assign(scene.userData.localSunPreview,{presented:true});report(activeMessage)}
      }
    }
    tick.current=()=>{
      if(stopped||failed)return
      if(!Reflect.get(camera,'isPerspectiveCamera')){fail('This preview requires a perspective camera');return}
      uniforms=scene.userData.getIndirectUniforms?.();if(!uniforms)return
      uniforms.hdLocalSunCombined.value=combined?1:0
      uniforms.hdLocalSunDisplay.value=compare.current?0:1
      gl.getDrawingBufferSize(size);camera.updateMatrixWorld()
      const key=localSunCameraKey(camera.matrixWorld.elements,camera.projectionMatrix.elements,size.x,size.y),progress=scene.userData.indirectLighting
      const publication=JSON.stringify([progress?.generation,progress?.state,progress?.previewUpdates,progress?.fullPassPublications])
      if(publication!==previousState){previousState=publication;if(prepared||preparing){fail('Lighting changed; switch the preview off and on to refresh');return}}
      if(key!==cameraKey){cameraKey=key;lastChange=performance.now();cancel();report('Hold the camera still to trace sunlight')}
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
        preparing=true;report('Preparing local sunlight preview')
        void snapshotLocalSunPreview(state,()=>stopped,report).then(snapshot=>{
          if(stopped)return
          const data=snapshot.data;primaryVisibility=snapshot.primaryVisibility
          worker=new Worker(new URL('../localSunPreview.worker.ts',import.meta.url),{type:'module'})
          worker.onerror=e=>fail(e.message||'The tracing worker stopped')
          worker.onmessage=e=>{
            if(stopped)return
            const m=e.data
            if(m.kind==='prepared'){prepared=true;preparing=false;Object.assign(scene.userData.localSunPreview,{triangles:m.triangles,textureBytes:m.textureBytes});invalidate();return}
            if(m.kind==='error'){fail(m.error);return}
            if(m.id!==id)return
            if(m.kind==='progress'){report(`Tracing reflected sunlight: ${m.percent}%`);return}
            if(m.kind==='image'){
              busy=false
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
              Object.assign(scene.userData.localSunPreview,{ms:m.ms,unsupported:m.unsupported,receivers:m.receivers,supportedPixels:m.supportedPixels,reasons:m.reasons,width:m.width,height:m.height,rays:m.rays,denoised:m.denoised})
              Object.assign(scene.userData.localSunPreview,{combined})
              activeMessage=`${combined?'Combined GI':'Local sunlight'} active (${(m.ms/1000).toFixed(1)} s; ${m.unsupported} unsupported pixels)`
              report('Trace ready; waiting for the displayed frame');invalidate()
            }
          }
          const transfer=[data.positions.buffer,data.normals.buffer,data.uvs.buffer,data.materialIndices.buffer,data.owners.buffer,...data.textures.map(t=>t.pixels.buffer)]
          worker.postMessage({kind:'prepare',data},transfer)
        }).catch(e=>{if(!stopped)fail(String(e))})
      }
      if(prepared&&!busy&&renderKey!==cameraKey){
        renderKey=cameraKey;busy=true;id++
        const width=Math.max(16,Math.round(LOCAL_SUN_PREVIEW_BUDGET.maxDimension*Math.min(1,size.x/size.y))),height=Math.max(16,Math.round(LOCAL_SUN_PREVIEW_BUDGET.maxDimension*Math.min(1,size.y/size.x)))
        const visibleTriangles=primaryVisibility?.()
        worker!.postMessage({kind:'render',id,camera:{world:camera.matrixWorld.toArray(),projectionInverse:camera.projectionMatrixInverse.toArray(),width,height,rays:LOCAL_SUN_PREVIEW_BUDGET.rays,visibleTriangles}},visibleTriangles?[visibleTriangles.buffer]:[])
      }
    }
    const timer=window.setInterval(()=>invalidate(),200);invalidate()
    return()=>{
      stopped=true;tick.current=()=>{};window.clearInterval(timer);worker?.terminate();hide()
      if(uniforms){uniforms.hdLocalSunFeature.value=0;uniforms.hdLocalSunReady.value=0;uniforms.hdLocalSunCombined.value=0;markShaders()}
      packed?.texture.dispose();delete scene.userData.bindLocalSunPreview;delete scene.userData.localSunPreview;latest.current('');invalidate()
    }
    // Scene/input revision explicitly restarts the opt-in snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[state.scene,state.gl,state.camera,revision,combined])
  useFrame(()=>tick.current(),-1)
  return null
}
