import {BufferGeometry,DataUtils,Float32BufferAttribute,Uint16BufferAttribute,FloatType,Mesh,MeshStandardMaterial,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,Vector3,WebGLRenderer,WebGLRenderTarget} from 'three'
import {createIndirectField,writeIndirectPosition,writeIndirectContactTexture} from '../../src/indirectLighting.ts'
import {createIndirectBounceField} from '../../src/indirectLivePreview.ts'
import {applyIndirectLightingShader,createIndirectUniforms,indirectShaderDefines,indirectVolumeShaderDeclarations,updateIndirectUniforms} from '../../src/indirectLightingShader.ts'
import {applyIndirectSurfaceCapture} from '../../src/indirectSurfaceCache.ts'
import {refineIndirectReceiverGeometry} from '../../src/indirectReceiverRefinement.ts'

const renderer=new WebGLRenderer({antialias:false});renderer.setSize(32,32);document.body.appendChild(renderer.domElement)
async function run(){
 const field=createIndirectField([{id:'room',elevation:0,height:2.8,rooms:[{signature:'room',polygon:[{x:-2,y:-2},{x:2,y:-2},{x:2,y:2},{x:-2,y:2}]}]}],0,1,'legacy',true)
 const probe=field.probes[0];field.probes.splice(1);probe.kind='contact';probe.position.set(0,.7,.1);writeIndirectPosition(field.positionData,probe.index,probe.position);field.contactReceiverTag=7
 field.coefficients.forEach(c=>c[probe.index*4]=DataUtils.toHalfFloat(.2/.886227))
 for(let i=0;i<field.volume.data.length;i+=4){field.volume.data[i]=field.volume.data[i+1]=field.volume.data[i+2]=DataUtils.toHalfFloat(10/.886227);field.volume.data[i+3]=DataUtils.toHalfFloat(1)}
 // Higher bands are zero, while every slab retains coverage.
 for(let z=0;z<field.volume.n;z++)for(let band=1;band<4;band++)for(let y=0;y<field.volume.height;y++)for(let x=0;x<field.volume.n;x++){
  const i=((z*field.volume.height*4+band*field.volume.height+y)*field.volume.n+x)*4;field.volume.data.fill(0,i,i+3)
 }field.volume.maps[0].needsUpdate=true
 const uniforms=createIndirectUniforms(field);uniforms.hdGIContactMode.value=1;updateIndirectUniforms(uniforms,field);uniforms.hdGIUseVolume.value=1;uniforms.hdGIIndoorFill.value=0;uniforms.hdWhiteModel.value=1
 const geometry=new PlaneGeometry(.4,.4),links=new Uint16Array(geometry.attributes.position.count*2),limits=new Float32Array(links.length)
 for(let i=0;i<links.length;i+=2){links[i]=1;links[i+1]=7;limits[i]=.01;limits[i+1]=32}
 geometry.setAttribute('hdGIContactLink',new Uint16BufferAttribute(links,2));geometry.setAttribute('hdGIReceiverMaxBias',new Float32BufferAttribute(limits,2))
 const material=new MeshStandardMaterial(),restore=applyIndirectLightingShader(material,uniforms),scene=new Scene(),mesh=new Mesh(geometry,material);mesh.position.y=.7;scene.add(mesh)
 const camera=new OrthographicCamera(-.2,.2,.2,-.2,.1,5);camera.position.set(0,.7,2);camera.lookAt(new Vector3(0,.7,0));camera.updateMatrixWorld(true)
 const target=new WebGLRenderTarget(1,1,{type:FloatType,depthBuffer:false}),read=async()=>{const values=new Float32Array(4);renderer.setRenderTarget(target);renderer.render(scene,camera);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,values);return Array.from(values)}
 const linked=await read();uniforms.hdGIContactLayout.value=8;const stale=await read();uniforms.hdGIContactLayout.value=7
 if(Math.abs(linked[0]-.2*.8/Math.PI)>.001)throw Error(`Contact SH evaluation failed: ${linked}`)
 if(stale[0]<1)throw Error(`Stale contact layout did not use the volume: ${stale}`)
 const bounce=createIndirectBounceField(field);writeIndirectContactTexture(bounce);field.coefficients.forEach(c=>c[probe.index*4]=DataUtils.toHalfFloat(1/.886227));updateIndirectUniforms(uniforms,field);updateIndirectUniforms(uniforms,bounce);const frozen=await read();if(Math.abs(frozen[0]-linked[0])>.00001)throw Error('Live display radiance changed an unfinished bounce snapshot');field.coefficients.forEach(c=>c[probe.index*4]=DataUtils.toHalfFloat(.2/.886227));updateIndirectUniforms(uniforms,field);uniforms.hdGIUseVolume.value=1;bounce.dispose()
 field.coefficients.forEach(c=>c[probe.index*4]=0);updateIndirectUniforms(uniforms,field);const black=await read();if(black[0]>.00001)throw Error('Measured black contact was replaced with volume lighting');field.coefficients.forEach(c=>c[probe.index*4]=DataUtils.toHalfFloat(.2/.886227));updateIndirectUniforms(uniforms,field)
 const mask=field.mask.image.data as Uint8Array,mx=Math.floor((0-field.bounds.minX)/field.bounds.size*512);let last=0
 for(let z=0;z<512;z++)if(mask[(z*512+mx)*4])last=z
 const boundary=field.bounds.minZ+(last+.5)/512*field.bounds.size;mesh.position.z=boundary;camera.position.z=boundary+2;camera.lookAt(new Vector3(0,.7,boundary));uniforms.hdGIContactLayout.value=8
 const indoorBoundary=await read();if(indoorBoundary[0]<1)throw Error('An interior face lost its own-side GI when its offset crossed the footprint')
 mesh.position.z=boundary+.2;camera.position.z=mesh.position.z+2;camera.lookAt(new Vector3(0,.7,mesh.position.z));const exteriorBoundary=await read();if(exteriorBoundary[0]>.00001)throw Error('A genuinely exterior face borrowed indoor GI')
 mesh.position.z=0;camera.position.z=2;camera.lookAt(new Vector3(0,.7,0));uniforms.hdGIContactLayout.value=7
 const surface=material.clone();surface.onBeforeCompile=material.onBeforeCompile;surface.customProgramCacheKey=material.customProgramCacheKey;Object.assign(surface,{defaultAttributeValues:Reflect.get(material,'defaultAttributeValues')});applyIndirectSurfaceCapture(surface);mesh.material=surface
 const mrt=new WebGLRenderTarget(1,1,{count:3,type:FloatType,depthBuffer:false});renderer.setRenderTarget(mrt);renderer.render(scene,camera);const normal=new Float32Array(4);await renderer.readRenderTargetPixelsAsync(mrt,0,0,1,1,normal,undefined,1)
 if(normal[3]!==-1)throw Error(`Surface cache lost the contact identity: ${normal}`)
 const quadMaterial=new ShaderMaterial({defines:indirectShaderDefines(uniforms),uniforms,depthTest:false,depthWrite:false,vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`${indirectVolumeShaderDeclarations}\nvoid main(){vec3 mean;gl_FragColor=vec4(hdGIContactIrradiance(1.,vec3(0.,0.,1.),mean),1.);}`}),quad=new Mesh(new PlaneGeometry(2,2),quadMaterial),replay=new Scene();replay.add(quad);renderer.setRenderTarget(target);renderer.render(replay,camera);const values=new Float32Array(4);await renderer.readRenderTargetPixelsAsync(target,0,0,1,1,values)
 if(Math.abs(values[0]-.2)>.001)throw Error(`Cached contact bounce failed: ${values}`)
 const normGeometry=new BufferGeometry();normGeometry.setAttribute('position',new Float32BufferAttribute([-.5,-.05,0,.5,-.05,0,0,.05,0],3));normGeometry.setAttribute('normal',new Float32BufferAttribute([new Vector3(.2,0,1),new Vector3(-.3,.2,1),new Vector3(.1,.5,1)].flatMap(n=>n.normalize().toArray()),3))
 const normMaterial=new MeshStandardMaterial();normMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','outgoingLight=normalize(vNormal)*.5+.5;\n#include <opaque_fragment>')};const restoreNorm=applyIndirectLightingShader(normMaterial,uniforms),normMesh=new Mesh(normGeometry,normMaterial),normScene=new Scene();normMesh.position.y=.7;normMesh.scale.set(1.7,.7,1.3);normMesh.updateMatrixWorld(true);normScene.add(normMesh)
 const normTarget=new WebGLRenderTarget(32,32,{type:FloatType,depthBuffer:false}),normalImage=async()=>{renderer.setRenderTarget(normTarget);renderer.render(normScene,camera);const pixels=new Float32Array(32*32*4);await renderer.readRenderTargetPixelsAsync(normTarget,0,0,32,32,pixels);return pixels},before=await normalImage(),refinement=refineIndirectReceiverGeometry(normGeometry,normMesh.matrixWorld,new Map([[0,[.02,32]]]))!
 const normalPixels=before.filter((v,i)=>i%4===0&&v>.25).length;if(normalPixels<32)throw Error('Normal comparison did not cover the refined surface')
 normMesh.geometry=refinement.geometry;const after=await normalImage(),normalDifference=Math.max(...before.map((v,i)=>Math.abs(v-after[i])));if(normalDifference>.00002)throw Error(`Subdivision changed shading normals: ${normalDifference}`)
 const glError=renderer.getContext().getError();if(glError)throw Error(`GL error ${glError}`)
 const result={linked,stale,frozen,black,indoorBoundary,exteriorBoundary,surfaceNormal:Array.from(normal),replay:Array.from(values),normalPixels,normalDifference,glError};restore();restoreNorm();normMaterial.dispose();normGeometry.dispose();refinement.geometry.dispose();refinement.release();normTarget.dispose();material.dispose();surface.dispose();geometry.dispose();quad.geometry.dispose();quadMaterial.dispose();target.dispose();mrt.dispose();field.dispose();return result
}
Object.assign(window,{contactRegression:run()})
