import {FloatType,Mesh,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,Vector3,WebGLRenderTarget} from 'three'
import type {RootState} from '@react-three/fiber'
import {indirectLightingShaderDeclarations,indirectShaderDefines} from '../../src/indirectLightingShader'
import type {ReferenceReceiver} from '../sceneLightingReference'

/** Canonical production receiver equations, including storey blending and
 * exterior sky fallback. Per-mesh corner/mount varyings are zero here. */
export async function sampleSpatialReceiversGPU(s:RootState,points:ReferenceReceiver[]){
 const uniforms=s.scene.userData.getIndirectUniforms(),scene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1),geometry=new PlaneGeometry(2,2)
 const receiverUniforms={...uniforms,points:{value:points.map(p=>new Vector3().fromArray(p.position))},normals:{value:points.map(p=>new Vector3().fromArray(p.normal))},geometricNormals:{value:points.map(p=>new Vector3().fromArray(p.geometricNormal))}}
 const varyings='#ifdef HD_GI_CONTACT_RECEIVERS\nflat varying vec2 hdGIContactLinkValue;\n#endif\nvarying vec3 hdGIWorldPosition,hdGIReceiverWorldOffset;varying vec2 hdGIReceiverBiasLimit;varying vec4 hdGICornerPlane0,hdGICornerPlane1,hdGIWallMountPlane0,hdGIWallMountPlane1;'
 const material=new ShaderMaterial({defines:indirectShaderDefines(uniforms),uniforms:receiverUniforms,depthTest:false,depthWrite:false,toneMapped:false,vertexShader:`${varyings}void main(){\n#ifdef HD_GI_CONTACT_RECEIVERS\nhdGIContactLinkValue=vec2(0.);\n#endif\nhdGIReceiverBiasLimit=vec2(1.e6);hdGIWorldPosition=vec3(0.);hdGIReceiverWorldOffset=vec3(0.);hdGICornerPlane0=vec4(0.);hdGICornerPlane1=vec4(0.);hdGIWallMountPlane0=vec4(0.);hdGIWallMountPlane1=vec4(0.);gl_Position=vec4(position.xy,0.,1.);}`,fragmentShader:`#include <common>
${indirectLightingShaderDeclarations}
uniform vec3 points[${points.length}],normals[${points.length}],geometricNormals[${points.length}];
void main(){int i=int(gl_FragCoord.x);vec3 p;float floorReceiver;float id=hdGIReceiver(points[i],vec3(0.),geometricNormals[i],hdGIFloorLayerReady,p,floorReceiver);vec3 light=vec3(0.),meanLight;if(id>=0.)light=hdGIVolumeIrradiance(id,p,normals[i],floorReceiver,meanLight);else if(hdGIExteriorFootprint(points[i])||geometricNormals[i].y>=-.01)light=hdSkyDiffuseIrradiance(normals[i],hdSkyDisplayRadianceBase,hdSkyDisplaySunIrradiance);gl_FragColor=vec4(light,id+1.);}`})
 scene.add(new Mesh(geometry,material));const target=new WebGLRenderTarget(points.length,1,{type:FloatType,depthBuffer:false}),before=s.gl.getRenderTarget(),auto=s.gl.autoClear
 try{const data=new Float32Array(points.length*4);s.gl.setRenderTarget(target);s.gl.autoClear=true;s.gl.render(scene,camera);await s.gl.readRenderTargetPixelsAsync(target,0,0,points.length,1,data);return points.map((p,i)=>({...p,rgb:Array.from(data.subarray(i*4,i*4+3)),floorIndex:data[i*4+3]-1,exterior:data[i*4+3]<.5}))}
 finally{s.gl.setRenderTarget(before);s.gl.autoClear=auto;target.dispose();geometry.dispose();material.dispose()}
}
