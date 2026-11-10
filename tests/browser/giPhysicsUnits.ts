import {CubeCamera,DataTexture,DataUtils,DirectionalLight,FloatType,HalfFloatType,LinearSRGBColorSpace,Mesh,MeshStandardMaterial,NearestFilter,NoToneMapping,OrthographicCamera,PlaneGeometry,RGBAFormat,Scene,SRGBColorSpace,Vector3,WebGLCubeRenderTarget,WebGLRenderer,WebGLRenderTarget,type Camera} from 'three'
import {createIndirectField,evaluateIndirectSH} from '../../src/indirectLighting'
import {applyIndirectLightingShader,createIndirectUniforms} from '../../src/indirectLightingShader'
import {createIndirectCaptureScene} from '../../src/indirectCaptureScene'
import {createIndirectProbeIntegrator} from '../../src/indirectProbeIntegration'
import {squareTransfer,srgbLinear,type V} from '../giPhysicsReference'
import type {IndirectSHOrder} from '../../src/indirectSH'

export async function runPhysicsUnits(order:IndirectSHOrder=1){
 const renderer=new WebGLRenderer({antialias:false});renderer.setSize(32,32);renderer.toneMapping=NoToneMapping;renderer.toneMappingExposure=1
 const field=createIndirectField([],0,order),u=createIndirectUniforms(field);u.hdGICapture.value=1;u.hdGIDiffuseCapture.value=1;u.hdGIIndoorFill.value=0
 const scene=new Scene(),material=new MeshStandardMaterial({roughness:1,metalness:0}),plane=new Mesh(new PlaneGeometry(2,2),material),sun=new DirectionalLight();sun.position.set(0,0,2);sun.userData.houseDesignerRole='sun-light';scene.add(plane,sun,sun.target);applyIndirectLightingShader(material,u)
 const camera=new OrthographicCamera(-.5,.5,.5,-.5,.01,10);camera.position.set(0,0,2);camera.lookAt(0,0,0);camera.updateMatrixWorld()
 const target=new WebGLRenderTarget(1,1,{type:FloatType,format:RGBAFormat,colorSpace:LinearSRGBColorSpace,depthBuffer:false})
 const render=async()=>{scene.updateMatrixWorld(true);const capture=createIndirectCaptureScene(scene,true);try{renderer.setRenderTarget(target);renderer.clear();renderer.render(capture.scene,camera);const p=new Float32Array(4);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,p);renderer.setRenderTarget(null);return Array.from(p.slice(0,3))}finally{capture.dispose()}}
 const tests=[]
 for(const rho of [0,.2,.5,.8,1]){
  material.color.setRGB(rho,rho,rho);sun.color.setRGB(1,.5,.25);sun.intensity=1
  const actual=await render(),expected=[1,.5,.25].map(e=>e*rho/Math.PI)
  tests.push({rho,irradiance:[1,.5,.25],expected,actual,relativeError:actual.map((v,c)=>expected[c]?(v-expected[c])/expected[c]:v),reflectedFraction:actual.map((v,c)=>Math.PI*v/[1,.5,.25][c])})
 }
 const colour=[]
 for(const encoded of [.2,.5,.8]){
  material.color.setRGB(encoded,encoded,encoded,SRGBColorSpace);sun.color.setRGB(1,1,1)
  colour.push({kind:'sRGB material colour',encoded,linearExpected:srgbLinear(encoded),materialLinear:material.color.toArray(),expected:srgbLinear(encoded)/Math.PI,actual:await render()})
  const byte=Math.round(encoded*255),texture=new DataTexture(new Uint8Array([byte,byte,byte,255]),1,1);texture.colorSpace=SRGBColorSpace;texture.minFilter=texture.magFilter=NearestFilter;texture.needsUpdate=true
  material.map=texture;material.color.setRGB(1,1,1);material.needsUpdate=true
  colour.push({kind:'sRGB base-colour texture',encoded:byte/255,expected:srgbLinear(byte/255)/Math.PI,actual:await render()});material.map=null;material.needsUpdate=true;texture.dispose()
 }
 material.color.setRGB(.2,.5,.8);sun.color.setRGB(.25,.5,1);const rgb={reflectance:[.2,.5,.8],irradiance:[.25,.5,1],expected:[.2*.25/Math.PI,.5*.5/Math.PI,.8/Math.PI],actual:await render()}
 material.color.setRGB(.8,.5,.2);sun.color.setRGB(1,.5,.25);scene.updateMatrixWorld(true)
 const capture=createIndirectCaptureScene(scene,true),cube=new WebGLCubeRenderTarget(16,{type:HalfFloatType,format:RGBAFormat,colorSpace:LinearSRGBColorSpace,generateMipmaps:false}),cc=new CubeCamera(.001,20,cube);cc.coordinateSystem=renderer.coordinateSystem;cc.updateCoordinateSystem();const integrator=createIndirectProbeIntegrator(16,'cube',[0,1,2,3,4,5],false,order)
 const blockerMaterial=new MeshStandardMaterial({color:0,roughness:1});applyIndirectLightingShader(blockerMaterial,u)
 const blocker=new Mesh(new PlaneGeometry(20,20),blockerMaterial);blocker.position.z=.5
 // A small physical second surface samples a spatially constant copy of the
 // captured SH field, exercising production volume decoding and the material
 // BRDF without introducing probe interpolation into this isolated test.
 const receiverField=createIndirectField([{id:'receiver',elevation:-2,height:4,rooms:[{signature:'receiver',polygon:[{x:-4,y:-4},{x:4,y:-4},{x:4,y:4},{x:-4,y:4}]}]}],0,order),count=receiverField.coefficientCount
 const receiverUniforms=createIndirectUniforms(receiverField);receiverUniforms.hdGIUseVolume.value=1;receiverUniforms.hdGICapture.value=2;receiverUniforms.hdGIDiffuseCapture.value=1;receiverUniforms.hdGIIndoorFill.value=0
 const receiverMaterial=new MeshStandardMaterial({roughness:1,metalness:0});receiverMaterial.color.setRGB(.5,.5,.5);applyIndirectLightingShader(receiverMaterial,receiverUniforms)
 const receiverScene=new Scene(),receiver=new Mesh(new PlaneGeometry(.04,.04),receiverMaterial);receiverScene.add(receiver)
 const receiverCamera=new OrthographicCamera(-.01,.01,.01,-.01,.001,2)
 const transfer=[]
 for(const [name,point,normal,blocked] of [
  ['distance 1',[0,0,1],[0,0,-1],false],['distance 2',[0,0,2],[0,0,-1],false],['off-axis',[1,0,1],[0,0,-1],false],['receiver tilted 60 degrees',[0,0,1],[Math.sqrt(.75),0,-.5],false],['receiver reversed',[0,0,1],[0,0,1],false],['source backside',[0,0,-1],[0,0,1],false],['blocked',[0,0,1],[0,0,-1],true],
 ] as [string,V,V,boolean][]){
  if(blocked)capture.scene.add(blocker);else blocker.removeFromParent()
  cc.position.fromArray(point);cc.updateMatrixWorld(true)
  for(let face=0;face<6;face++){renderer.setRenderTarget(cube,face);renderer.clear();renderer.render(capture.scene,cc.children[face] as Camera)}
  renderer.setRenderTarget(null)
  const sh=await integrator.read(renderer,cube),actual=evaluateIndirectSH(sh,new Vector3(...normal),order).toArray(),radiance:V=[.8/Math.PI,.25/Math.PI,.05/Math.PI]
  const expected=squareTransfer(point,normal,radiance,512,blocked),coarse=squareTransfer(point,normal,radiance,256,blocked)
  // Raw captured hemisphere integral isolates capture discretisation from SH.
  const raw=[0,0,0],pixels=new Uint16Array(16*16*4);let total=0
  for(let face=0;face<6;face++){
   await renderer.readRenderTargetPixelsAsync(cube,0,0,16,16,pixels,face)
   for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const col=-1+(x+.5)/8,row=1-(y+.5)/8,p=face===0?[1,row,-col]:face===1?[-1,row,col]:face===2?[col,1,-row]:face===3?[col,-1,row]:face===4?[col,row,1]:[-col,row,-1],l=Math.hypot(...p),w=4/l**3;total+=w
    const cosine=Math.max(0,p.reduce((v,q,c)=>v+q*normal[c]/l,0));for(let c=0;c<3;c++)raw[c]+=DataUtils.fromHalfFloat(pixels[(y*16+x)*4+c])*cosine*w
   }
  }
  const volume=receiverField.volume
  for(let z=0;z<volume.n;z++)for(let k=0;k<count;k++)for(let y=0;y<volume.height;y++)for(let x=0;x<volume.n;x++){
   const offset=((z*volume.height*count+k*volume.height+y)*volume.n+x)*4
   for(let c=0;c<3;c++)volume.data[offset+c]=DataUtils.toHalfFloat(sh.coefficients[k].getComponent(c))
   volume.data[offset+3]=DataUtils.toHalfFloat(1)
  }
  volume.maps[0].needsUpdate=true;receiver.position.fromArray(point);receiver.quaternion.setFromUnitVectors(new Vector3(0,0,1),new Vector3(...normal));receiverScene.updateMatrixWorld(true)
  receiverCamera.position.copy(receiver.position).addScaledVector(new Vector3(...normal),.5);receiverCamera.lookAt(receiver.position);receiverCamera.updateMatrixWorld(true)
  renderer.setRenderTarget(target);renderer.clear();renderer.render(receiverScene,receiverCamera);const secondPixels=new Float32Array(4);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,secondPixels);renderer.setRenderTarget(null)
  const l1Prediction=squareTransfer(point,normal,radiance,512,blocked,'L1')
  transfer.push({name,point,normal,blocked,expected,referenceConvergence:expected.map((v,c)=>v-coarse[c]),l1Prediction,actual,raw:raw.map(v=>v*4*Math.PI/total),relativeError:actual.map((v,c)=>expected[c]?(v-expected[c])/expected[c]:v),receiverReflectance:.5,expectedOutgoingAtSecond:expected.map(v=>v*.5/Math.PI),outgoingAtSecond:Array.from(secondPixels.slice(0,3)),shaderExpectedFromCapturedSH:actual.map(v=>v*.5/Math.PI)})
 }
 capture.dispose();integrator.dispose();cube.dispose();blocker.geometry.dispose();(blocker.material as MeshStandardMaterial).dispose();receiverField.dispose();receiverMaterial.dispose();receiver.geometry.dispose();plane.geometry.dispose();material.dispose();field.dispose();target.dispose();renderer.dispose()
 return{order,units:'Dimensionally consistent relative irradiance/radiance. 1 irradiance unit may be mapped to 1000 W/m² and 1 radiance unit to 1000 W/(m² sr); the application sun is not calibrated in watts.',test1:{tests,colour,rgb},test2:transfer}
}
