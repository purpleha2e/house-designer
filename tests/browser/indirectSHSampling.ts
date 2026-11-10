import {DataUtils,HalfFloatType,Mesh,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,SphericalHarmonics3,Vector3,WebGLRenderer,WebGLRenderTarget} from 'three'
import {createIndirectField} from '../../src/indirectLighting'
import {createIndirectUniforms,indirectShaderDefines,indirectVolumeShaderDeclarations,updateIndirectUniforms} from '../../src/indirectLightingShader'
import {createIndirectBounceField} from '../../src/indirectLivePreview'
import {createPackedDiagnosticField} from '../../src/lightingDiagnosticFields'
import {lightingDiagnosticGLSL} from '../../src/lightingDiagnostics'
import {evaluateIndirectSHOrder} from '../../src/indirectSH'
const renderer=new WebGLRenderer(),target=new WebGLRenderTarget(1,1,{type:HalfFloatType}),scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),geometry=new PlaneGeometry(2,2)
try{
 let maxError=0,samples=0
 for(const order of [1,2]as const){
  const field=createIndirectField([{id:'floor',elevation:0,height:2.4,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}]}],0,order),sky=createIndirectBounceField(field),sh=new SphericalHarmonics3(),skySH=new SphericalHarmonics3()
  for(let c=0;c<field.coefficientCount;c++)for(let channel=0;channel<3;channel++){sh.coefficients[c].setComponent(channel,DataUtils.fromHalfFloat(DataUtils.toHalfFloat(c===0?1.1:Math.sin(c*1.3+channel)*.15)));skySH.coefficients[c].setComponent(channel,DataUtils.fromHalfFloat(DataUtils.toHalfFloat(c===0?.7:Math.cos(c*.8+channel)*.12)))}
  const fill=(data:Uint16Array,n:number,height:number,coeff:SphericalHarmonics3)=>{for(let z=0;z<n;z++)for(let c=0;c<field.coefficientCount;c++)for(let y=0;y<height;y++)for(let x=0;x<n;x++){const i=((z*height*field.coefficientCount+c*height+y)*n+x)*4;for(let k=0;k<3;k++)data[i+k]=DataUtils.toHalfFloat(coeff.coefficients[c].getComponent(k));data[i+3]=DataUtils.toHalfFloat(c===0?1:0)}}
  fill(field.volume.data,field.volume.n,field.volume.height,sh);fill(field.floorLayer.data,field.floorLayer.n,field.floorLayer.height,sh);field.floorLayer.ready=true
  fill(sky.volume.data,sky.volume.n,sky.volume.height,skySH);fill(sky.floorLayer.data,sky.floorLayer.n,sky.floorLayer.height,skySH);sky.floorLayer.ready=true
  const packed=await createPackedDiagnosticField(field,sky,()=>false);if(!packed)throw Error('packing cancelled')
  const u=createIndirectUniforms(field),normal={value:new Vector3()},floor={value:0},mode={value:0}
  const material=new ShaderMaterial({defines:{...indirectShaderDefines(u),HD_LIGHTING_DIAGNOSTICS:1},uniforms:{...u,hdDiagnosticSkyReady:{value:1},hdLightingDiagnostic:{value:0},normal,floor,mode},depthTest:false,depthWrite:false,toneMapped:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`#include <common>
${indirectVolumeShaderDeclarations}
${lightingDiagnosticGLSL}
uniform vec3 normal;uniform float floor,mode;void main(){vec3 mean;vec3 p=vec3(.5,1.2,.5);gl_FragColor=vec4(mode>.5?hdDiagnosticSky(0.,p,normal,floor):hdGIVolumeIrradiance(0.,p,normal,floor,mean),1.);}`})
  const mesh=new Mesh(geometry,material);scene.add(mesh)
  try{
   renderer.setRenderTarget(target);await renderer.compileAsync(scene,camera)
   for(const usePacked of [false,true]){updateIndirectUniforms(u,usePacked?packed.field:field);u.hdGIUseVolume.value=1
    for(const sampleSky of usePacked?[false,true]:[false])for(const floorLayer of [false,true])for(let i=0;i<24;i++){
     normal.value.set(Math.sin(i*1.7),Math.cos(i*.8),Math.sin(i*.9+.3)).normalize();floor.value=floorLayer?1:0;mode.value=sampleSky?1:0
     renderer.setRenderTarget(target);renderer.render(scene,camera);const pixels=new Uint16Array(4);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,pixels)
     const expected=evaluateIndirectSHOrder(sampleSky?skySH:sh,normal.value,order)
     for(let c=0;c<3;c++)maxError=Math.max(maxError,Math.abs(DataUtils.fromHalfFloat(pixels[c])-expected.getComponent(c)));samples++
    }
   }
  }finally{scene.remove(mesh);material.dispose();packed.dispose();sky.dispose();field.dispose()}
 }
 Object.assign(window,{indirectSHSamplingResult:{maxError,samples,glError:renderer.getContext().getError()}})
}catch(error){Object.assign(window,{indirectSHSamplingResult:{error:String(error)}})}finally{geometry.dispose();target.dispose();renderer.dispose()}
