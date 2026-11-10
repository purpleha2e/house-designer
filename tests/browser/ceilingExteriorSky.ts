import {FloatType,LinearSRGBColorSpace,Mesh,MeshStandardMaterial,NoToneMapping,OrthographicCamera,PlaneGeometry,RGBAFormat,Scene,Vector3,WebGLRenderer,WebGLRenderTarget} from 'three'
import {createIndirectField} from '../../src/indirectLighting'
import {applyIndirectLightingShader,createIndirectUniforms} from '../../src/indirectLightingShader'
import {createIndirectCaptureScene} from '../../src/indirectCaptureScene'
/** Render the real capture shader above occupied floor-plan cells. Exterior
 * roof tops need sky; interior receivers and roof undersides must stay dark. */
export async function ceilingExteriorSky(){
 const renderer=new WebGLRenderer({antialias:false});renderer.setSize(4,4);renderer.toneMapping=NoToneMapping
 const polygon=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],field=createIndirectField([{id:'room',elevation:0,height:2.4,rooms:[{signature:'room',polygon}]}],0,1),u=createIndirectUniforms(field)
 const mask=field.mask.image.data as Uint8Array;for(let i=0;i<mask.length;i+=4){mask[i]=255;mask[i+1]=255;mask[i+2]=255}field.mask.needsUpdate=true
 u.hdGICapture.value=1;u.hdGIDiffuseCapture.value=1;u.hdGIIndoorFill.value=0;u.hdSkyMode.value=1;u.hdSkyRadianceBase.value.set(2.275,2.52,2.87);u.hdSkySunIrradiance.value.set(0,0,0)
 const material=new MeshStandardMaterial({roughness:1,metalness:0});material.color.setRGB(.5,.5,.5);applyIndirectLightingShader(material,u)
 const scene=new Scene(),plane=new Mesh(new PlaneGeometry(.1,.1),material);scene.add(plane)
 const camera=new OrthographicCamera(-.01,.01,.01,-.01,.001,2),target=new WebGLRenderTarget(1,1,{type:FloatType,format:RGBAFormat,colorSpace:LinearSRGBColorSpace,depthBuffer:false}),results=[]
 try{for(const config of [
  {name:'exterior roof top',height:3,normal:[0,1,0],sky:true},
  {name:'pitched exterior roof',height:3,normal:[-.46947156,.88294759,0],sky:true},
  {name:'roof underside',height:3,normal:[0,-1,0],sky:false},
  {name:'interior upward receiver',height:1,normal:[0,1,0],sky:false},
  {name:'interior downward receiver',height:1,normal:[0,-1,0],sky:false},
 ]){
  const n=new Vector3().fromArray(config.normal).normalize();plane.position.set(.5,config.height,.5);plane.quaternion.setFromUnitVectors(new Vector3(0,0,1),n);camera.position.copy(plane.position).addScaledVector(n,.5);camera.up.set(0,0,1);camera.lookAt(plane.position);camera.updateMatrixWorld(true);scene.updateMatrixWorld(true)
  const capture=createIndirectCaptureScene(scene,true)
  try{renderer.setRenderTarget(target);renderer.clear();renderer.render(capture.scene,camera);const pixels=new Float32Array(4);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,pixels)
   // Independent analytic cosine integral of the authored linear sky and .2 ground.
   const y=n.y,product=2/3*(Math.sqrt(Math.max(0,1-y*y))+(Math.PI-Math.acos(y))*y),factor=(.6*Math.PI*(1+y)/2+.8*product+.2*17/15*Math.PI*(1-y)/2)*.5/Math.PI
   const expected=config.sky?[2.275,2.52,2.87].map(v=>v*factor):[0,0,0],actual=Array.from(pixels.slice(0,3));results.push({...config,actual,expected,error:actual.map((v,c)=>v-expected[c])})
  }finally{capture.dispose()}
 }
 return{results,maxError:Math.max(...results.flatMap(r=>r.error.map(Math.abs))),glError:renderer.getContext().getError()}
 }finally{renderer.dispose();field.dispose();target.dispose();plane.geometry.dispose();material.dispose()}
}
