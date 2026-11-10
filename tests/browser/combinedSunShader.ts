import {Data3DTexture,DataUtils,HalfFloatType,LinearSRGBColorSpace,Mesh,MeshStandardMaterial,NoToneMapping,PerspectiveCamera,PlaneGeometry,Scene,WebGLRenderer,WebGLRenderTarget} from 'three'
import {createIndirectField} from '../../src/indirectLighting'
import {applyIndirectLightingShader,createIndirectUniforms,updateIndirectUniforms} from '../../src/indirectLightingShader'
import {packSunBounceTexture} from '../../src/indirectSunBounce'
import {packLocalSunPreview} from '../../src/localSunPreview'

async function run(){
 const gl=new WebGLRenderer();gl.setSize(32,32);gl.setPixelRatio(2);gl.outputColorSpace=LinearSRGBColorSpace;gl.toneMapping=NoToneMapping;document.body.append(gl.domElement)
 const field=createIndirectField([{id:'f',elevation:0,height:3,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}]}]}],0)
 const full=field.volume.maps[0],a=full.image
 const fill=(irradiance:number)=>{const out=new Uint16Array((a.data as Uint16Array).length);for(let z=0;z<a.depth;z++)for(let y=0;y<a.height/4;y++)for(let x=0;x<a.width;x++){const i=((z*a.height+y)*a.width+x)*4;out[i]=out[i+1]=out[i+2]=DataUtils.toHalfFloat(irradiance/.886227);out[i+3]=DataUtils.toHalfFloat(1)}return out}
 ;(a.data as Uint16Array).set(fill(2));full.needsUpdate=true
 const off=new Data3DTexture(fill(.2),a.width,a.height,a.depth);off.type=full.type;off.format=full.format;off.minFilter=full.minFilter;off.magFilter=full.magFilter
 const solar=packSunBounceTexture(full,off),floor=packSunBounceTexture(field.floorLayer.texture,field.floorLayer.texture)
 const image=new Float32Array(4*4*4),normals=new Float32Array(image.length),values=[.1,.3,.7,.9]
 for(let y=0;y<4;y++)for(let x=0;x<4;x++){const i=(y*4+x)*4;image.set([values[x],values[x],values[x],1],i);normals.set([0,0,1,1],i)}
 const packed=packLocalSunPreview(solar,image,normals),u=createIndirectUniforms(field);updateIndirectUniforms(u,field)
 u.hdGIUseVolume.value=1;u.hdGIIndoorFill.value=0;u.hdSunBounceFeature.value=1;u.hdSunBouncePacked.value=1;u.hdSunBounceReady.value=1
 u.hdLocalSunFeature.value=1;u.hdLocalSunReady.value=1;u.hdLocalSunSize.value.set(4,4);u.hdLocalSunPackedSize.value.copy(packed.layout);u.hdLocalSunVolumeScale.value=packed.scale
 u.hdGIVolume.value=packed.texture;u.hdGIFloorLayer.value=floor
 const camera=new PerspectiveCamera(90,1,.01,10);camera.position.set(1,1.5,1.5);camera.lookAt(1,1.5,.5);camera.updateMatrixWorld();u.hdLocalSunViewProjection.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
 const scene=new Scene(),geometry=new PlaneGeometry(2,2),material=new MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0,toneMapped:false}),mesh=new Mesh(geometry,material);mesh.position.set(1,1.5,.5);scene.add(mesh)
 applyIndirectLightingShader(material,u)
 const checks:unknown[]=[]
 try{
  await gl.compileAsync(scene,camera)
  for(const [width,height,offset]of [[32,32,0],[16,24,3],[48,16,5]]){
   const target=new WebGLRenderTarget(width+offset*2,height+offset*2,{type:HalfFloatType});target.viewport.set(offset,offset,width,height)
   try{
    const sample=async()=>{gl.setRenderTarget(target);gl.clear();gl.render(scene,camera);const pixels=new Uint16Array(4);await gl.readRenderTargetPixelsAsync(target,offset+Math.floor(width*.25),offset+Math.floor(height*.5),1,1,pixels);return DataUtils.fromHalfFloat(pixels[0])}
    u.hdLocalSunDisplay.value=0;const original=await sample();if(original<.1)throw Error('No original GI reached the receiver')
    const uv=(Math.floor(width*.25)+.5)/width,index=uv*4-.5,lower=Math.max(0,Math.min(3,Math.floor(index))),upper=Math.max(0,Math.min(3,Math.floor(index)+1)),fraction=index-Math.floor(index),local=values[lower]*(1-fraction)+values[upper]*fraction
    u.hdLocalSunDisplay.value=1;u.hdLocalSunCombined.value=0;const sunOnly=await sample()
    u.hdLocalSunCombined.value=1;const combined=await sample()
    u.hdGICapture.value=1;const capture=await sample();u.hdGICapture.value=0
    const expectedOnly=original*local/2,expectedCombined=original*(.2+local)/2
    if(Math.abs(sunOnly-expectedOnly)>.002||Math.abs(combined-expectedCombined)>.002||capture>.0001)throw Error(JSON.stringify({width,height,offset,original,sunOnly,combined,capture,expectedOnly,expectedCombined}))
    checks.push({width,height,offset,original,sunOnly,combined,capture,expectedOnly,expectedCombined})
   }finally{gl.setRenderTarget(null);target.dispose()}
  }
  return{checks,pixelRatio:gl.getPixelRatio(),maxSamplers:gl.getContext().getParameter(gl.getContext().MAX_TEXTURE_IMAGE_UNITS)}
 }finally{packed.texture.dispose();solar.dispose();floor.dispose();off.dispose();material.dispose();geometry.dispose();field.dispose();gl.dispose()}
}
Object.assign(window,{combinedShaderResult:run().then(value=>({ok:true,value}),error=>({ok:false,error:String(error)}))})
