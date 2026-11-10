import {DataUtils,HalfFloatType,Mesh,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,WebGLRenderer,WebGLRenderTarget} from 'three'
import {createIndirectField} from '../../src/indirectLighting'
import {createIndirectBounceField} from '../../src/indirectLivePreview'
import {createIndirectUniforms,indirectShaderDefines,indirectVolumeShaderDeclarations,updateIndirectUniforms} from '../../src/indirectLightingShader'
import {createPackedDiagnosticField} from '../../src/lightingDiagnosticFields'
import {lightingDiagnosticGLSL} from '../../src/lightingDiagnostics'
const renderer=new WebGLRenderer(),scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),target=new WebGLRenderTarget(1,1,{type:HalfFloatType}),geometry=new PlaneGeometry(2,2)
const polygon=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]
try{
 const results=[]
 for(const order of [1,2] as const){
  const field=createIndirectField([{id:'lower',elevation:0,height:5.1,rooms:[{signature:'lower',polygon}]},{id:'upper',elevation:2.7,height:2.4,rooms:[{signature:'upper',polygon}]}],0,order),sky=createIndirectBounceField(field)
  const mask=field.mask.image.data as Uint8Array
  for(let i=0;i<mask.length;i+=4){mask[i]=255;mask[i+1]=255;mask[i+2]=255}
  field.mask.needsUpdate=true
  // Different constant L0 on either storey makes a missing seam blend observable.
  for(const f of [field,sky]){const {n,height}=f.volume;for(let z=0;z<n;z++)for(let y=0;y<height;y++)for(let x=0;x<n;x++){const i=((z*height*f.coefficientCount+y)*n+x)*4;for(let c=0;c<3;c++)f.volume.data[i+c]=DataUtils.toHalfFloat(y<14?1:.2);f.volume.data[i+3]=DataUtils.toHalfFloat(1)}f.volume.maps[0].needsUpdate=true}
  const packed=await createPackedDiagnosticField(field,sky,()=>false);if(!packed)throw Error('cancelled')
  const u=createIndirectUniforms(field),mode={value:0},point={value:[.5,2.76,.5]},floor={value:0}
  const material=new ShaderMaterial({defines:{...indirectShaderDefines(u),HD_LIGHTING_DIAGNOSTICS:1},uniforms:{...u,hdDiagnosticSkyReady:{value:1},hdLightingDiagnostic:{value:0},mode,point,floor},vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`#include <common>
${indirectVolumeShaderDeclarations}
${lightingDiagnosticGLSL}
uniform float mode,floor;uniform vec3 point;void main(){vec3 mean;gl_FragColor=vec4(mode>.5?hdDiagnosticSky(floor,point,vec3(0.,-1.,0.),0.):hdGIVolumeIrradiance(floor,point,vec3(0.,-1.,0.),0.,mean),1.);}`,depthTest:false,depthWrite:false,toneMapped:false}),mesh=new Mesh(geometry,material)
  scene.add(mesh)
  try{for(const id of [0,1])for(const y of [2.61,2.71,2.76,2.81,2.91]){
    point.value=[.5,y,.5];floor.value=id;const values=[]
    for(const diagnostic of [false,true]){mode.value=diagnostic?1:0;updateIndirectUniforms(u,diagnostic?packed.field:sky);u.hdGIUseVolume.value=1;renderer.setRenderTarget(target);renderer.render(scene,camera);const p=new Uint16Array(4);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,p);values.push(DataUtils.fromHalfFloat(p[0]))}
    results.push({order,floor:id,y,productionSky:values[0],diagnosticSky:values[1],error:Math.abs(values[0]-values[1])})
  }}finally{scene.remove(mesh);material.dispose();packed.dispose();sky.dispose();field.dispose()}
 }
 Object.assign(window,{skySeamResult:{results,maxError:Math.max(...results.map(r=>r.error)),glError:renderer.getContext().getError()}})
}catch(error){Object.assign(window,{skySeamResult:{error:String(error)}})}finally{renderer.dispose();target.dispose();geometry.dispose()}
