import {FloatType,Mesh,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,Vector3,WebGLRenderTarget} from 'three'
import type {RootState} from '@react-three/fiber'
import {indirectLightingShaderDeclarations,indirectShaderDefines} from '../../src/indirectLightingShader'
import type {ReferenceReceiver} from '../sceneLightingReference'
import {barrierTexture,injectBarrierShader} from '../giBarrierShader'
import type {BarrierBuild} from './giBarrierComparison'

export async function barrierReceivers(s:RootState,build:BarrierBuild,points:ReferenceReceiver[]){
 const uniforms=s.scene.userData.getIndirectUniforms(),scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),geometry=new PlaneGeometry(2,2),target=new WebGLRenderTarget(points.length,1,{type:FloatType,depthBuffer:false}),before=s.gl.getRenderTarget(),auto=s.gl.autoClear,modes:Record<string,unknown>={}
 const varyings='#ifdef HD_GI_CONTACT_RECEIVERS\nflat varying vec2 hdGIContactLinkValue;\n#endif\nvarying vec3 hdGIWorldPosition,hdGIReceiverWorldOffset;varying vec2 hdGIReceiverBiasLimit;varying vec4 hdGICornerPlane0,hdGICornerPlane1,hdGIWallMountPlane0,hdGIWallMountPlane1;'
 try{
  for(const mode of ['legacy','A','B'] as const){
   const atlas=mode==='legacy'?undefined:barrierTexture(mode==='A'?build.a:build.b)
   let fragment=`#include <common>\n${indirectLightingShaderDeclarations}\nuniform vec3 points[${points.length}],normals[${points.length}],geometricNormals[${points.length}];void main(){int i=int(gl_FragCoord.x);vec3 p;float floorReceiver;float id=hdGIReceiver(points[i],vec3(0.),geometricNormals[i],hdGIFloorLayerReady,p,floorReceiver);vec3 light=vec3(0.),meanLight;if(id>=0.)light=hdGIVolumeIrradiance(id,p,normals[i],floorReceiver,meanLight);else if(hdGIExteriorFootprint(points[i])||geometricNormals[i].y>=-.01)light=hdSkyDiffuseIrradiance(normals[i],hdSkyDisplayRadianceBase,hdSkyDisplaySunIrradiance);gl_FragColor=vec4(light,id+1.);}`
   if(mode!=='legacy')fragment=injectBarrierShader(fragment,mode)
   const material=new ShaderMaterial({defines:indirectShaderDefines(uniforms),uniforms:{...uniforms,...atlas?.uniforms,points:{value:points.map(p=>new Vector3().fromArray(p.position))},normals:{value:points.map(p=>new Vector3().fromArray(p.normal))},geometricNormals:{value:points.map(p=>new Vector3().fromArray(p.geometricNormal))}},depthTest:false,depthWrite:false,toneMapped:false,vertexShader:`${varyings}void main(){\n#ifdef HD_GI_CONTACT_RECEIVERS\nhdGIContactLinkValue=vec2(0.);\n#endif\nhdGIWorldPosition=vec3(0.);hdGIReceiverBiasLimit=vec2(1e6);hdGIReceiverWorldOffset=vec3(0.);hdGICornerPlane0=vec4(0.);hdGICornerPlane1=vec4(0.);hdGIWallMountPlane0=vec4(0.);hdGIWallMountPlane1=vec4(0.);gl_Position=vec4(position.xy,0.,1.);}`,fragmentShader:fragment}),quad=new Mesh(geometry,material);scene.add(quad)
   const values=new Float32Array(points.length*4);s.gl.setRenderTarget(target);s.gl.autoClear=true;s.gl.render(scene,camera);await s.gl.readRenderTargetPixelsAsync(target,0,0,points.length,1,values)
   modes[mode]=points.map((p,i)=>({...p,rgb:Array.from(values.subarray(i*4,i*4+3)),floorIndex:values[i*4+3]-1,exterior:values[i*4+3]<.5}))
   scene.remove(quad);material.dispose();atlas?.texture.dispose()
  }
  return{modes,glError:s.gl.getContext().getError()}
 }finally{s.gl.setRenderTarget(before);s.gl.autoClear=auto;geometry.dispose();target.dispose()}
}
