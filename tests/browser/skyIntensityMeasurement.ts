import {DirectionalLight,FloatType,Mesh,MeshStandardMaterial,OrthographicCamera,Raycaster,Scene,Vector3,WebGLRenderTarget} from 'three'
import {includeViewportObject} from '../../src/viewportSurfaceVisibility'
export async function measureSkyMaterials(s:any,points:any[]){
 const scene=new Scene();scene.environment=s.scene.environment;const camera=new OrthographicCamera(-.00002,.00002,.00002,-.00002,.00001,.04),target=new WebGLRenderTarget(1,1,{type:FloatType,depthBuffer:true}),before=s.gl.getRenderTarget(),auto=s.gl.autoClear,shadowAuto=s.gl.shadowMap.autoUpdate,shadowNeed=s.gl.shadowMap.needsUpdate,results=[]
 let sun:any;s.scene.traverse((o:any)=>{if(o instanceof DirectionalLight&&o.userData.houseDesignerRole==='sun-light')sun=o});const light=sun.clone(false);light.shadow=sun.shadow;light.target=sun.target;scene.add(light);s.gl.shadowMap.autoUpdate=false;s.gl.shadowMap.needsUpdate=false
 try{for(const point of points){const source=s.scene.getObjectByProperty('uuid',point.mesh)as Mesh,group=source.geometry.groups.find(g=>point.triangle*3>=g.start&&point.triangle*3<g.start+g.count),original=(Array.isArray(source.material)?source.material[group?.materialIndex??0]:source.material)as MeshStandardMaterial,material=original.clone(),mode={value:0},hook=original.onBeforeCompile
  material.onBeforeCompile=(shader,renderer)=>{hook.call(original,shader,renderer);shader.uniforms.sunlitAuditMode=mode;shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float sunlitAuditMode;vec3 sunlitGI=vec3(0.);').replace('#include <lights_fragment_end>','sunlitGI=irradiance-vec3(hdGIIndoorFill);\n#include <lights_fragment_end>').replace('#include <opaque_fragment>','vec3 rho=diffuseColor.rgb*(1.0-metalnessFactor);outgoingLight=sunlitAuditMode<.5?sunlitGI:sunlitAuditMode<1.5?rho:sunlitAuditMode<2.5?reflectedLight.directDiffuse*PI/max(rho,vec3(1.e-8)):sunlitAuditMode<3.5?reflectedLight.directDiffuse:outgoingLight;\n#include <opaque_fragment>').replace('#include <tonemapping_fragment>','').replace('#include <colorspace_fragment>','')}
  material.customProgramCacheKey=()=>original.customProgramCacheKey()+':sky-material-measurement';material.toneMapped=false
  const mesh=source.clone(false);mesh.material=Array.isArray(source.material)?source.material.map(()=>material):material;mesh.matrixAutoUpdate=false;mesh.matrix.copy(source.matrixWorld);mesh.matrixWorld.copy(source.matrixWorld);mesh.visible=true;mesh.frustumCulled=false;scene.add(mesh)
  const p=new Vector3().fromArray(point.position),n=new Vector3().fromArray(point.normal);camera.position.copy(p).addScaledVector(n,.005);camera.up.set(Math.abs(n.y)>.9?1:0,Math.abs(n.y)>.9?0:1,0);camera.lookAt(p);camera.updateMatrixWorld(true)
  const values=[];try{for(let i=0;i<5;i++){mode.value=i;s.gl.setRenderTarget(target);s.gl.autoClear=true;s.gl.clear();s.gl.render(scene,camera);const rgba=new Float32Array(4);await s.gl.readRenderTargetPixelsAsync(target,0,0,1,1,rgba);if(rgba[3]<.5)throw Error('Empty sample '+point.name);values.push(Array.from(rgba.slice(0,3)))}results.push({...point,gi:values[0],rho:values[1],directSunIrradiance:values[2],directSunDiffuse:values[3],finalHDR:values[4],material:{name:original.name,color:original.color.toArray(),metalness:original.metalness,roughness:original.roughness,map:original.map?.name??null,normalMap:!!original.normalMap}})}finally{scene.remove(mesh);material.dispose()}
 }}finally{s.gl.setRenderTarget(before);s.gl.autoClear=auto;s.gl.shadowMap.autoUpdate=shadowAuto;s.gl.shadowMap.needsUpdate=shadowNeed;target.dispose()}
 return results
}

export function skyReceivers(s:any) {
 const meshes:Mesh[]=[];s.scene.updateMatrixWorld(true);s.scene.traverse((o:any)=>{if(o instanceof Mesh&&includeViewportObject(o))meshes.push(o)})
 const ray=new Raycaster();return [
 ['ceiling',[.8,3.8,12.4],[0,1,0],2],
 ['shaded wall',[1.3,3.3,13.5],[0,0,1],1.2],
 ['sunlit wall',[.2,3.3,13.5],[0,0,1],1.2],
 ['bed',[.3,3.9,12],[0,-1,0],1.2],
 ['floor',[2.3,3.2,12.5],[0,-1,0],.7],
 ['dark corner',[2.6,3.3,14.1],[0,0,1],.7]
 ].map(([name,origin,direction,far]:any)=>{
  ray.set(new Vector3().fromArray(origin),new Vector3().fromArray(direction));ray.far=far
  const hit=ray.intersectObjects(meshes,false).find(h=>{const m=(Array.isArray((h.object as Mesh).material)?((h.object as Mesh).material as MeshStandardMaterial[])[h.face?.materialIndex??0]:(h.object as Mesh).material) as MeshStandardMaterial;return m instanceof MeshStandardMaterial&&m.visible&&m.opacity>.5&&!/glass|glazing/i.test(m.name)})
  if(!hit)throw Error('Receiver missed '+name);const normal=hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);if(normal.dot(ray.ray.direction)>0)normal.negate()
  return {name,position:hit.point.toArray(),normal:normal.toArray(),mesh:hit.object.uuid,triangle:hit.faceIndex}
 })
}
