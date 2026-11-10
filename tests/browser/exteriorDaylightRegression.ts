import {DataUtils,HalfFloatType,LinearSRGBColorSpace,Mesh,MeshStandardMaterial,OrthographicCamera,PlaneGeometry,Scene,Vector3,WebGLRenderer,WebGLRenderTarget} from 'three'
import {createIndirectField,INDIRECT_MASK_SIZE} from '../../src/indirectLighting'
import {applyIndirectLightingShader,createIndirectUniforms} from '../../src/indirectLightingShader'

// A saved, completely dark indoor field isolates exterior sky fallback. No
// direct sun, ambient fill, GI preparation, or probe captures can hide errors.
const field=createIndirectField([{id:'room',elevation:0,height:2.4,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]}]}])
const mask=field.mask.image.data as Uint8Array
for(let i=0;i<mask.length;i+=4)if(mask[i])mask[i+1]=mask[i+2]=255
field.mask.needsUpdate=true
const uniforms=createIndirectUniforms(field);uniforms.hdGIUseVolume.value=1;uniforms.hdGIIndoorFill.value=0;uniforms.hdSkyRadianceBase.value.set(.65,.72,.82)
const material=new MeshStandardMaterial({color:0xffffff,roughness:1});material.toneMapped=false;applyIndirectLightingShader(material,uniforms)
const scene=new Scene(),mesh=new Mesh(new PlaneGeometry(.012,.012),material);scene.add(mesh)
const renderer=new WebGLRenderer();renderer.outputColorSpace=LinearSRGBColorSpace;renderer.setSize(320,320);document.body.appendChild(renderer.domElement)
const target=new WebGLRenderTarget(32,32,{type:HalfFloatType,depthBuffer:false}),camera=new OrthographicCamera(-.01,.01,.01,-.01,.01,10),axis=new Vector3(0,0,1)
const row=Math.floor((2-field.bounds.minZ)/field.bounds.size*INDIRECT_MASK_SIZE)
let edge=0;for(let x=0;x<INDIRECT_MASK_SIZE;x++)if(mask[(row*INDIRECT_MASK_SIZE+x)*4])edge=x+1
const boundary=field.bounds.minX+edge/INDIRECT_MASK_SIZE*field.bounds.size
async function sample(p:Vector3,n:Vector3,capture=0,daylight=true,strength=1){
  uniforms.hdGICapture.value=capture;uniforms.hdSkyRadianceBase.value.set(.65,.72,.82).multiplyScalar(daylight?strength:0)
  uniforms.hdSkyDisplayRadianceBase.value.set(.65,.72,.82).multiplyScalar(daylight?strength:0)
  mesh.position.copy(p);mesh.quaternion.setFromUnitVectors(axis,n);camera.up.set(0,Math.abs(n.y)>.9?0:1,Math.abs(n.y)>.9?1:0);camera.position.copy(p).add(n);camera.lookAt(p);camera.updateMatrixWorld(true)
  renderer.setRenderTarget(target);renderer.render(scene,camera);const pixels=new Uint16Array(4);await renderer.readRenderTargetPixelsAsync(target,16,16,1,1,pixels);renderer.setRenderTarget(null)
  return [...pixels.slice(0,3)].map(DataUtils.fromHalfFloat)
}
try{
  const facadeA=new Vector3(boundary-.03,1,2),facadeB=new Vector3(boundary+.03,1,2),out=new Vector3(1,0,0),up=new Vector3(0,1,0),roof=new Vector3(2,field.ranges[0].top+.25,2)
  const results={facadeA:await sample(facadeA,out),facadeB:await sample(facadeB,out),roof:await sample(roof,up),underside:await sample(roof,up.clone().negate()),interior:await sample(new Vector3(2,1,2),up),night:await sample(roof,up,0,false),captureRoof:await sample(roof,up,1),captureFacadeA:await sample(facadeA,out,1),captureFacadeB:await sample(facadeB,out,1),glError:renderer.getContext().getError()}
  const skyIntensities=[]
  for(const strength of [0,.5,1,1.5,2,3])skyIntensities.push({strength,display:await sample(roof,up,0,true,strength),capture:await sample(roof,up,1,true,strength),underside:await sample(roof,up.clone().negate(),1,true,strength)})
  Object.assign(results,{skyIntensities})
  await sample(facadeB,out,1)
  // A saved indoor bounce boost must not wash out the visible exterior.
  uniforms.hdGICapture.value=0;uniforms.hdSkyRadianceBase.value.multiplyScalar(3.5)
  renderer.setRenderTarget(target);renderer.render(scene,camera);const boosted=new Uint16Array(4);await renderer.readRenderTargetPixelsAsync(target,16,16,1,1,boosted);renderer.setRenderTarget(null)
  Object.assign(results,{boostedFacade:[...boosted.slice(0,3)].map(DataUtils.fromHalfFloat)})
  // A wall meeting a pitched ceiling must stay indoors between the mask's
  // texel centres. Its upward-facing outer roof must still receive sky.
  const range=field.ranges[0]
  for(let z=0;z<INDIRECT_MASK_SIZE;z++)for(let x=0;x<INDIRECT_MASK_SIZE;x++){
    const i=(z*INDIRECT_MASK_SIZE+x)*4
    const ceiling=1+.4*(field.bounds.minZ+(z+.5)/INDIRECT_MASK_SIZE*field.bounds.size)
    const packed=Math.round(Math.max(0,Math.min(1,(ceiling-range.bottom)/(range.top-range.bottom)))*65535)
    mask[i+1]=packed>>8;mask[i+2]=packed&255
  }
  field.mask.needsUpdate=true
  const pitchedWall:number[][]=[],pitchedRoof:number[][]=[],pitchedUnderside:number[][]=[]
  for(let i=0;i<24;i++){
    const z=1.5+i*.002,ceiling=1+.4*z
    pitchedWall.push(await sample(new Vector3(2,ceiling-.0008,z),out))
    pitchedRoof.push(await sample(new Vector3(2,ceiling+.04,z),new Vector3(0,1,-.4).normalize()))
    pitchedUnderside.push(await sample(new Vector3(2,ceiling,z),new Vector3(0,-1,.4).normalize()))
  }
  Object.assign(results,{pitchedWall,pitchedRoof,pitchedUnderside})
  Object.assign(window,{exteriorDaylightResults:results})
}catch(error){Object.assign(window,{exteriorDaylightResults:{error:String(error)}})}
