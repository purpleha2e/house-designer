import {BoxGeometry,Color,DataTexture,DataUtils,DirectionalLight,HalfFloatType,Mesh,MeshStandardMaterial,PerspectiveCamera,RGBAFormat,Scene,WebGLRenderer,WebGLRenderTarget} from 'three'
import {createIndirectCaptureScene} from '../../src/indirectCaptureScene'
import {createMaterialVariationShader,defaultMaterialVariation} from '../../src/materials/proceduralVariation'
const renderer=new WebGLRenderer(),source=new Scene(),camera=new PerspectiveCamera(70,1,.1,30),target=new WebGLRenderTarget(80,80,{type:HalfFloatType})
renderer.setSize(320,320);document.body.appendChild(renderer.domElement)
const light=new DirectionalLight('white',2);light.position.set(3,7,5);source.add(light)
const texture=new DataTexture(new Uint8Array([255,90,20,255,30,100,230,255,230,230,230,255,80,120,80,255]),2,2,RGBAFormat);texture.needsUpdate=true
const geometry=new BoxGeometry(.6,.7,.4)
for(let i=0;i<36;i++){
  const material=new MeshStandardMaterial({color:new Color().setRGB(.7,.6,.5),map:texture,roughness:.8})
  Object.assign(material,createMaterialVariationShader({...defaultMaterialVariation,enabled:true,broadStrength:i<24?.1:.25}))
  const mesh=new Mesh(geometry,material);mesh.position.set((i%6)-2.5,Math.floor(i/6)*.6-1.4,Math.sin(i)*.4);mesh.rotation.set(i*.013,i*.17,0);source.add(mesh)
}
const render=async(batch:boolean)=>{
  source.userData.indirectWorldCaptureBatching=batch;const capture=createIndirectCaptureScene(source,false),pixels=new Uint16Array(80*80*4),images=[]
  try{
    let calls=0
    for(const p of [[0,1,7],[6,2,4],[-4,-1,5]]){camera.position.fromArray(p);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);renderer.setRenderTarget(target);renderer.render(capture.scene,camera);calls+=renderer.info.render.calls;await renderer.readRenderTargetPixelsAsync(target,0,0,80,80,pixels);images.push(Array.from(pixels,DataUtils.fromHalfFloat))}
    return {calls,images,merged:capture.mergedMeshes}
  }finally{capture.dispose()}
}
try{
  const before=await render(false),after=await render(true);let maximum=0,total=0,count=0
  for(let i=0;i<before.images.length;i++)for(let j=0;j<before.images[i].length;j++){const delta=Math.abs(before.images[i][j]-after.images[i][j]);maximum=Math.max(maximum,delta);total+=delta;count++}
  Object.assign(window,{captureBatchingResult:{beforeCalls:before.calls,afterCalls:after.calls,merged:after.merged,maxError:maximum,meanError:total/count,glError:renderer.getContext().getError()}})
}catch(error){Object.assign(window,{captureBatchingResult:{error:String(error)}})}
