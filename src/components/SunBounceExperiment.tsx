/* eslint-disable react-hooks/immutability -- Owned display-only GPU resources. */
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import type {IndirectField} from '../indirectLighting'
import type {IndirectUniforms} from '../indirectLightingShader'
import {SoftFloorGI} from './SoftFloorGI'
import {packSunBounceTexture} from '../indirectSunBounce'
import type {Data3DTexture} from 'three'

export type SunBounceSnapshot={field:IndirectField;generation:number;key:string;identity:object;geometryKey:string;ready:boolean;daylight:boolean}
export function SunBounceExperiment({strength,cm,uniforms,snapshot,prepare,onStatus,separateSun=false}:{strength:number;cm:number;uniforms:IndirectUniforms;snapshot:()=>SunBounceSnapshot;prepare:(cancelled:()=>boolean)=>Promise<IndirectField|undefined>;onStatus?:(text:string)=>void;separateSun?:boolean}){
  const {scene,gl,camera,invalidate}=useThree(),latest=useRef({strength,snapshot,prepare,onStatus,separateSun})
  useLayoutEffect(()=>{latest.current={strength,snapshot,prepare,onStatus,separateSun}},[strength,snapshot,prepare,onStatus,separateSun])
  const packed=useRef<{key:string;volume:Data3DTexture;floor:Data3DTexture}|undefined>(undefined)
  const disposePacked=useCallback(()=>{packed.current?.volume.dispose();packed.current?.floor.dispose();packed.current=undefined},[])
  const state=useRef<{id:number;busy:boolean;key?:string;identity?:object;field?:IndirectField;failedKey?:string}>({id:0,busy:false})
  const localRequest=useRef(false)
  const [filtered,setFiltered]=useState<IndirectField|null>(null)
  useEffect(()=>()=>{state.current.id++;state.current.field?.dispose();disposePacked();uniforms.hdSunBounceReady.value=0;delete scene.userData.sunBounceExperiment},[scene,uniforms,disposePacked])
  useFrame(()=>{
    const now=latest.current.snapshot(),s=state.current,key=JSON.stringify([now.key,now.generation])
    if(latest.current.separateSun)localRequest.current=true
    else if(localRequest.current&&latest.current.strength===1){
      localRequest.current=false;s.id++;s.key=undefined;s.identity=undefined;s.field?.dispose();s.field=undefined
      disposePacked();setFiltered(null);uniforms.hdSunBounceReady.value=0
      scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1;invalidate()
    }
    const valid=now.ready&&now.daylight&&s.key===key&&s.identity===now.identity&&!!s.field
    uniforms.hdSunBounceStrength.value=latest.current.strength
    const filtersReady=!cm||(scene.userData.softFloorGI?.state==='ready'&&scene.userData.sunOffSoftFloorGI?.state==='ready'&&scene.userData.sunOffSoftFloorGI.cm===cm)
    if(s.key&&(s.key!==key||s.identity!==now.identity)){s.id++;s.key=undefined;s.field?.dispose();s.field=undefined;disposePacked();setFiltered(null)}
    const status=scene.userData.sunBounceExperiment??={state:'idle'}
    if(valid&&filtersReady&&(latest.current.strength!==1||latest.current.separateSun)){
      const restore=scene.userData.bindSoftFloorGI?.(),restoreOff=scene.userData.bindSunOffSoftFloorGI?.()
      try{
        const full=uniforms.hdGIVolume.value as Data3DTexture,floor=uniforms.hdGIFloorLayer.value as Data3DTexture,off=s.field!,offFloor=uniforms.hdSunOffFloor.value as Data3DTexture
        const textureKey=JSON.stringify([full.uuid,full.version,floor.uuid,floor.version,off.volume.maps[0].uuid,offFloor.uuid,cm])
        if(packed.current?.key!==textureKey){
          disposePacked();const volume=packSunBounceTexture(full,off.volume.maps[0]),floorTexture=packSunBounceTexture(floor,offFloor)
          const started=performance.now();gl.initTexture(volume);gl.initTexture(floorTexture);packed.current={key:textureKey,volume,floor:floorTexture}
          status.packingMs=performance.now()-started;status.packedTextureBytes=(volume.image.data as Uint16Array).byteLength+(floorTexture.image.data as Uint16Array).byteLength
          scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1
        }
      }finally{restoreOff?.();restore?.()}
    }
    uniforms.hdSunBounceReady.value=valid&&filtersReady&&!!packed.current?1:0
    Object.assign(status,{strength:latest.current.strength,key,ready:valid&&filtersReady&&!!packed.current,preparing:s.busy})
    if(valid){status.state=filtersReady?'ready':'filtering';latest.current.onStatus?.(filtersReady?'Ready - instant diffuse adjustment':'Preparing floor smoothing...');return}
    if(latest.current.strength===1&&!latest.current.separateSun){status.state='idle';latest.current.onStatus?.('');return}
    if(!now.daylight){status.state='inactive';latest.current.onStatus?.('Inactive at night');return}
    if(!now.ready){status.state='waiting';latest.current.onStatus?.('Waiting for completed lighting');return}
    if(s.busy||(s.failedKey===key&&s.identity===now.identity))return
    s.busy=true;const id=++s.id,started=performance.now();status.state='preparing';latest.current.onStatus?.('Preparing sunlight separation...')
    const cancelled=()=>s.id!==id||(!latest.current.separateSun&&latest.current.strength===1)||latest.current.snapshot().identity!==now.identity||JSON.stringify([latest.current.snapshot().key,latest.current.snapshot().generation])!==key||!latest.current.snapshot().ready
    void (async()=>{
      if(uniforms.hdSunBounceFeature.value<.5){
        uniforms.hdSunBounceFeature.value=1
        scene.traverse(object=>{const m=(object as unknown as {material?:{needsUpdate:boolean}|{needsUpdate:boolean}[]}).material;if(m)for(const material of Array.isArray(m)?m:[m])material.needsUpdate=true})
        await gl.compileAsync(scene,camera)
        if(cancelled())return
      }
      return latest.current.prepare(cancelled)
    })().then(field=>{
      if(!field)return
      if(cancelled()){field.dispose();return}
      s.field=field;s.key=key;s.identity=now.identity;setFiltered(field)
      uniforms.hdSunOffVolume.value=field.volume.maps[0];uniforms.hdSunOffFloor.value=field.floorLayer.texture
      Object.assign(status,{preparationMs:performance.now()-started,textureBytes:field.volume.data.byteLength+field.floorLayer.data.byteLength,state:'ready'})
      scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1
    }).catch(error=>{if(cancelled())return;s.failedKey=key;s.identity=now.identity;status.state='error';status.error=String(error);latest.current.onStatus?.('Sun bounce experiment unavailable: '+String(error))}).finally(()=>{s.busy=false;invalidate()})
    invalidate()
  })
  useEffect(()=>{
    scene.userData.getSunBounceFields=()=>({full:latest.current.snapshot().field,sunOff:state.current.field})
    return()=>{delete scene.userData.getSunBounceFields}
  },[scene])
  useEffect(()=>{
    const bind=()=>{
      const s=state.current,now=latest.current.snapshot(),textures=packed.current
      if((latest.current.strength===1&&!latest.current.separateSun)||!uniforms.hdSunBounceReady.value||!textures||!now.ready||s.identity!==now.identity||s.key!==JSON.stringify([now.key,now.generation]))return
      const volume=uniforms.hdGIVolume.value,floor=uniforms.hdGIFloorLayer.value
      uniforms.hdGIVolume.value=textures.volume;uniforms.hdGIFloorLayer.value=textures.floor;uniforms.hdSunBouncePacked.value=1
      return()=>{uniforms.hdGIVolume.value=volume;uniforms.hdGIFloorLayer.value=floor;uniforms.hdSunBouncePacked.value=0}
    }
    scene.userData.bindSunBounceGI=bind
    return()=>{delete scene.userData.bindSunBounceGI}
  },[scene,uniforms])
  useEffect(()=>{scene.userData.displayEffectRevision=(scene.userData.displayEffectRevision??0)+1;invalidate()},[strength,scene,invalidate])
  return filtered?<SoftFloorGI cm={cm} uniforms={uniforms} sourceUniform="hdSunOffFloor" bindingKey="bindSunOffSoftFloorGI" statusKey="sunOffSoftFloorGI" snapshot={()=>{const now=latest.current.snapshot();return {field:filtered,generation:now.generation,geometryKey:now.geometryKey,ready:now.ready&&state.current.field===filtered&&state.current.key===JSON.stringify([now.key,now.generation])}}}/>:null
}
