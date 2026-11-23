import type { ShaderPass } from 'postprocessing'
import { DataTexture, DataUtils, FloatType, PerspectiveCamera, RGBAFormat, ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three'
import type { ReferenceSceneData } from '../../src/diffuseSceneMaterials'
import { buildLumenCache } from '../../src/lumenSurfaceCache'
import { LumenViewportPass } from '../../src/lumenViewportPass'

/** Two diffuse planes with a known exterior-ground contribution on the upper
 * plane. Every sampled direction from either central receiver hits the other
 * plane, so the existing two feedback sweeps have an analytic answer. */
export async function checkLumenFeedback() {
  const quad=(y:number)=>[-2,y,-2,-2,y,2,2,y,2,-2,y,-2,2,y,2,2,y,-2]
  const positions=new Float32Array([...quad(0),...quad(.42)])
  const data:ReferenceSceneData={positions,uvs:new Float32Array(24),materialIndices:new Uint16Array(4),
    materials:[{color:[.5,.5,.5],metalness:0,map:-1,matrix:[1,0,0,0,1,0,0,0,1],wrapS:1001,wrapT:1001}],
    textures:[],sunDirection:[0,1,0],sunIrradiance:[0,0,0],skyBase:[1,1,1],skySun:[0,0,0],skyMode:'clear',daylightGain:1,lights:[]}
  const cache=buildLumenCache(data,[0,.2,0]),atlas=cache.atlas
  const renderer=new WebGLRenderer(),pass=new LumenViewportPass(new PerspectiveCamera())
  const {surfaceBouncePass,surfaceBounceMaterial,surfaceBounceAtlases}=pass as unknown as {
    surfaceBouncePass:ShaderPass;surfaceBounceMaterial:ShaderMaterial;surfaceBounceAtlases:WebGLRenderTarget[]
  }
  const textures:DataTexture[]=[]
  const texture=(values:Float32Array)=>{
    const tex=new DataTexture(values,atlas.width,atlas.height,RGBAFormat,FloatType);tex.needsUpdate=true;textures.push(tex);return tex
  }
  const input=new WebGLRenderTarget(1,1)
  try{
    pass.upload(atlas)
    const ground=new Float32Array(atlas.width*atlas.height*4),zeros=texture(ground.slice())
    let floor=-1,ceiling=-1,floorDistance=1,ceilingDistance=1
    for(let i=0;i<atlas.count;i++){
      const [x,y,z]=atlas.positions.subarray(i*4,i*4+3),distance=x*x+z*z
      if(y>.2){
        ground[i*4]=.2;ground[i*4+1]=.2
        if(distance<ceilingDistance){ceiling=i;ceilingDistance=distance}
      }else if(distance<floorDistance){floor=i;floorDistance=distance}
    }
    if(floor<0 || ceiling<0)throw Error('Missing analytic feedback receivers')
    const u=surfaceBounceMaterial.uniforms
    u.skyVisibility.value=zeros;u.reflectedSun.value=zeros;u.groundVisibility.value=texture(ground)
    u.skyBase.value.setScalar(1);u.groundDiffuse.value.setScalar(.8)
    const read=async(target:WebGLRenderTarget,index:number,side:number)=>{
      const texel=new Uint16Array(4)
      await renderer.readRenderTargetPixelsAsync(target,index%atlas.width,Math.floor(index/atlas.width),1,1,texel,undefined,side)
      return DataUtils.fromHalfFloat(texel[0])
    }
    const sweeps=[]
    for(let i=0;i<2;i++){
      const target=surfaceBounceAtlases[i]
      u.previousFront.value=i?surfaceBounceAtlases[0].texture:zeros
      u.previousBack.value=i?surfaceBounceAtlases[0].textures[1]:zeros
      u.surfaceBounceOrder.value=i
      surfaceBouncePass.render(renderer,input,target)
      sweeps.push({floor:await read(target,floor,0),ceiling:await read(target,ceiling,1)})
    }
    return {sweeps,expected:[{floor:.04,ceiling:0},{floor:.04,ceiling:.02}]}
  }finally{
    input.dispose();pass.dispose();textures.forEach(t=>t.dispose());cache.dispose();renderer.dispose();renderer.forceContextLoss()
  }
}
