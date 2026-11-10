/* eslint-disable react-hooks/immutability -- Renderer-owned environment resources. */
import {useEffect,useState} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {CubeUVReflectionMapping,DataTexture,DirectionalLight,HalfFloatType,LinearFilter,LinearSRGBColorSpace,RGBAFormat,Vector3,type Texture} from 'three'
import {createDaylightSky,type DaylightSkyMode} from '../daylightSky'
import {waitForViewportIdle} from '../viewportScheduling'
import {prepareTextureReplacement} from '../textureUpload'
import {daylightEnvironmentPixels} from '../daylightEnvironmentPixels'

export type DaylightEnvironmentSources={clear:Uint16Array;overcast:Uint16Array;ground:Uint16Array}
function template(){
  const texture=new DataTexture(new Uint16Array(336*256*4),336,256,RGBAFormat,HalfFloatType)
  texture.mapping=CubeUVReflectionMapping;texture.colorSpace=LinearSRGBColorSpace;texture.minFilter=texture.magFilter=LinearFilter;texture.generateMipmaps=false;texture.flipY=false
  return texture
}

/** Background, reflection fallback and GI use the same linear radiance model.
 * The authored indirect bounce gain remains a transport-only multiplier; it
 * does not change scene exposure or the displayed sun/sky radiance. */
export function DaylightEnvironment({mode,strength=1,onLoaded,background,enabled,sources}:{mode:DaylightSkyMode;strength?:number;onLoaded:(texture:Texture|null)=>void;background:boolean;enabled:boolean;sources:DaylightEnvironmentSources}){
  const {gl,scene,invalidate}=useThree()
  // Offline PMREM bases preserve the 336×256 shader layout without runtime
  // filtering. The small display cube is independent of that fixed atlas size.
  const [resources]=useState(()=>({sky:createDaylightSky(32),template:template(),texture:null as DataTexture|null,sun:null as DirectionalLight|null,irradiance:new Vector3(),direction:new Vector3(),key:'',version:0,disposed:false}))
  useEffect(()=>{
    resources.disposed=false
    return()=>{resources.disposed=true;resources.version++;if(scene.background===resources.sky.texture)scene.background=null;onLoaded(null)}
  },[onLoaded,resources,scene])
  useEffect(()=>()=>{resources.texture?.dispose();resources.template.dispose();resources.sky.dispose()},[resources])
  useEffect(()=>{if(enabled&&background)scene.background=resources.sky.texture;else if(scene.background===resources.sky.texture)scene.background=null;invalidate()},[enabled,background,scene,resources,invalidate])
  useFrame(()=>{
    if(!enabled)return
    if(!resources.sun?.parent)scene.traverse(o=>{if(o instanceof DirectionalLight&&o.userData.houseDesignerRole==='sun-light')resources.sun=o})
    const sun=resources.sun
    if(!sun||sun.userData.indirectPreview)return
    resources.direction.subVectors(sun.position,sun.target.position).normalize()
    resources.irradiance.set(sun.color.r,sun.color.g,sun.color.b).multiplyScalar(sun.intensity*Math.max(0,resources.direction.y))
    const key=JSON.stringify([mode,strength,...resources.irradiance]);if(key===resources.key)return;resources.key=key
    const skyStarted=performance.now();resources.sky.update(mode,strength,resources.irradiance);const skyCpuMs=performance.now()-skyStarted;invalidate()
    const version=++resources.version,cancelled=()=>resources.disposed||resources.version!==version,irradiance=resources.irradiance.clone()
    void waitForViewportIdle(cancelled).then(async ready=>{
      if(!ready)return
      const started=performance.now(),pixels=daylightEnvironmentPixels(sources[mode],sources.ground,irradiance,strength),basisCpuMs=performance.now()-started
      const texture=await prepareTextureReplacement(gl,resources.template,cancelled,pixels);if(!texture)return
      scene.userData.daylightEnvironment={updates:(scene.userData.daylightEnvironment?.updates??0)+1,skyCpuMs,basisCpuMs,pmremCpuSubmissionMs:0,width:336,height:256,sourceSize:32}
      const previous=resources.texture;resources.texture=texture;onLoaded(texture);invalidate()
      // Materials receive the replacement through React before releasing the
      // previous texture, avoiding a transient disposed environment texture.
      await waitForViewportIdle(cancelled);previous?.dispose()
    }).catch(error=>console.error('Daylight environment unavailable:',error))
  })
  return null
}
