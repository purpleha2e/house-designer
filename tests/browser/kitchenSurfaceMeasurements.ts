import {BufferAttribute,BufferGeometry,DataUtils,DirectionalLight,HalfFloatType,InstancedMesh,Light,Matrix3,Matrix4,Mesh,MeshStandardMaterial,NoToneMapping,PerspectiveCamera,Raycaster,Scene,ShaderChunk,SpotLight,Vector3,WebGLRenderTarget,type Intersection} from 'three'
import type {RootState} from '@react-three/fiber'
import {serializeIndirectField} from '../../src/indirectLighting'
import {snapshotIndirectGeometry} from '../../src/indirectVisibility'
import {updateIndirectUniforms} from '../../src/indirectLightingShader'

const snapshotMaterial=(hit:Intersection)=>{const o=hit.object as Mesh;return(Array.isArray(o.material)?o.material[hit.face?.materialIndex??0]:o.material)as MeshStandardMaterial}
function acesDisplay(rgb:number[],exposure:number){
  const mul=(m:number[],v:number[])=>[0,1,2].map(i=>m[i*3]*v[0]+m[i*3+1]*v[1]+m[i*3+2]*v[2])
  const x=mul([.59719,.35458,.04823,.076,.90834,.01566,.0284,.13383,.83777],rgb.map(v=>v*exposure/.6)).map(v=>(v*(v+.0245786)-.000090537)/(v*(.983729*v+.432951)+.238081))
  return mul([1.60475,-.53108,-.07367,-.10208,1.10813,-.00605,-.00327,-.07276,1.07602],x).map(v=>{v=Math.max(0,Math.min(1,v));return Math.round((v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055)*255)})
}
export async function collectKitchenMeasurements(s:RootState,view:'kitchen'|'stairwell'='kitchen'){
  const snapshot=s.scene.userData.lightingDiagnostics.snapshot(),field=snapshot.field,gl=s.gl,frameloop=s.frameloop,tone=gl.toneMapping,auto=gl.shadowMap.autoUpdate,need=gl.shadowMap.needsUpdate,autoClear=gl.autoClear,targetBefore=gl.getRenderTarget()
  const components=s.scene.userData.lightingDiagnostics.components(),uniforms=s.scene.userData.getIndirectUniforms(),volume=uniforms.hdGIVolume.value,floorVolume=uniforms.hdGIFloorLayer.value
  const meshes:Mesh[]=[];s.scene.traverseVisible(o=>{if(o instanceof Mesh&&!o.userData.selectionDecoration&&o.userData.houseDesignerRole!=='ground-image')meshes.push(o)})
  const ray=new Raycaster(),cast=(name:string,origin:number[],direction:number[],walls=false)=>{
    ray.set(new Vector3().fromArray(origin),new Vector3().fromArray(direction).normalize())
    const hit=ray.intersectObjects(walls?meshes.filter(m=>m.userData.houseDesignerRole==='wall-engine-render'):meshes,false).find(hit=>{const m=snapshotMaterial(hit);return m instanceof MeshStandardMaterial&&m.visible&&m.opacity>.1&&!/glass|glazing/i.test(m.name)&&!('transmission'in m&&Number(m.transmission)>.5)})
    if(!hit?.face)throw Error('No opaque receiver at '+name);return{name,hit}
  }
  const points=view==='stairwell'?[
    cast('wall below stairwell window',[5.95,2.2,15.31785],[1,0,0],true),
    cast('left stairwell wall',[5.8,3.3,14.7],[0,0,-1],true),
    cast('right stairwell wall',[5.8,3.3,16.0],[0,0,1],true),
    cast('left window reveal',[6.26,3.25,15.31785],[0,0,-1],true),
    cast('right window reveal',[6.26,3.25,15.31785],[0,0,1],true),
    cast('window sill',[6.26,2.8,15.31785],[0,-1,0]),
    cast('ceiling above stairwell window',[5.95,4.2,15.31785],[0,1,0]),
    cast('stair landing below window',[5.9,2.0,15.31785],[0,-1,0]),
  ]:[cast('ceiling near glazing',[1.7,1.8,5.7],[0,1,0]),cast('ceiling deep in room',[2.8,1.8,9.1],[0,1,0]),cast('dark window wall',[.73,2.25,5.6],[0,0,-1],true),cast('adjacent light wall',[.5,1.3,6.5],[-1,0,0],true),cast('kitchen island front',[3.926,.5,9.5],[0,0,-1]),cast('floor near glazing',[2.7,.04,5.5],[0,-1,0]),cast('floor beneath dining table',[1.607,.04,7.517],[0,-1,0]),cast('shaded corner',[-.3,.04,9.9],[0,-1,0])]
  s.setFrameloop('never')
  const patchScene=new Scene();patchScene.environment=s.scene.environment
  const lights:Light[]=[];s.scene.traverseVisible(o=>{if(!(o instanceof Light))return;const l=o.clone(false);l.position.copy(o.getWorldPosition(new Vector3()));if((l instanceof DirectionalLight||l instanceof SpotLight)&&(o instanceof DirectionalLight||o instanceof SpotLight)){l.target=o.target.clone(false);l.target.position.copy(o.target.getWorldPosition(new Vector3()));patchScene.add(l.target)}if('shadow'in o&&'shadow'in l)l.shadow=o.shadow;patchScene.add(l);lights.push(l)})
  const target=new WebGLRenderTarget(1,1,{type:HalfFloatType,depthBuffer:true}),camera=new PerspectiveCamera(),measure={value:1},reports=[]
  camera.position.copy(s.camera.position);camera.fov=2*Math.atan(Math.tan((s.camera as PerspectiveCamera).fov*Math.PI/360)/gl.domElement.height)*180/Math.PI;camera.near=.001;camera.far=1000;camera.updateProjectionMatrix()
  gl.toneMapping=NoToneMapping;gl.autoClear=true;gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=false
  try{
    for(const {name,hit}of points){
      s.scene.userData.referenceMeasurementProgress={stage:'GPU receiver',name}
      const source=hit.object as Mesh,original=snapshotMaterial(hit),material=original.clone(),geometry=new BufferGeometry(),face=hit.face!,world=source.matrixWorld.clone()
      if('defaultAttributeValues'in original)Object.assign(material,{defaultAttributeValues:original.defaultAttributeValues})
      if(source instanceof InstancedMesh&&hit.instanceId!==undefined){const instance=new Matrix4();source.getMatrixAt(hit.instanceId,instance);world.multiply(instance)}
      for(const [name,attribute]of Object.entries(source.geometry.attributes)){
        if(attribute.itemSize>4)continue
        const values=new Float32Array(attribute.itemSize*3);[face.a,face.b,face.c].forEach((index,i)=>{for(let c=0;c<attribute.itemSize;c++)values[i*attribute.itemSize+c]=attribute.getComponent(index,c)})
        geometry.setAttribute(name,new BufferAttribute(values,attribute.itemSize))
      }
      const before=original.onBeforeCompile,key=original.customProgramCacheKey()
      material.onBeforeCompile=(shader,renderer)=>{
        before.call(material,shader,renderer);shader.uniforms.hdKitchenMeasure=measure
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float hdKitchenMeasure;vec3 hdKitchenDirect=vec3(0.0),hdKitchenIndirect=vec3(0.0);')
          .replace('#include <lights_physical_pars_fragment>',ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;','vec3 irradiance = dotNL * directLight.color;hdKitchenDirect+=irradiance;'))
          .replace('#include <lights_fragment_end>','hdKitchenIndirect=irradiance;\n#include <lights_fragment_end>')
          .replace('#include <opaque_fragment>',`vec3 hdN=normalize(transformNormalByInverseViewMatrix(geometryNormal,viewMatrix)),hdGeomN=normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal,viewMatrix));vec3 hdP;float hdF;float hdId=hdGIReceiver(hdGIWorldPosition,hdGIReceiverWorldOffset,hdGeomN,hdGIFloorLayerReady,hdP,hdF);vec3 hdMean,hdFull=hdId>=0.0?hdGIVolumeIrradiance(hdId,hdP,hdN,hdF,hdMean):vec3(0.0),hdSky=hdKitchenMeasure>1.5&&hdKitchenMeasure<3.5?hdDiagnosticSky(hdId,hdP,hdN,hdF):vec3(0.0);if(hdKitchenMeasure<1.5)outgoingLight=hdKitchenDirect;else if(hdKitchenMeasure<2.5)outgoingLight=hdSky;else if(hdKitchenMeasure<3.5)outgoingLight=max(hdFull-hdSky,vec3(0.0));else if(hdKitchenMeasure<4.5)outgoingLight=hdKitchenDirect+hdKitchenIndirect;else if(hdKitchenMeasure<5.5)outgoingLight=diffuseColor.rgb;else if(hdKitchenMeasure<6.5)outgoingLight=hdN;else if(hdKitchenMeasure<7.5){}else if(hdKitchenMeasure<8.5)outgoingLight=hdKitchenIndirect-hdFull;else if(hdKitchenMeasure<9.5)outgoingLight=hdP;else outgoingLight=vec3(hdId,hdF,0.0);\n#include <opaque_fragment>`)
      };material.customProgramCacheKey=()=>key+':kitchen-receiver-measurement-v1';material.needsUpdate=true
      const mesh=new Mesh(geometry,material);mesh.matrixAutoUpdate=false;mesh.matrix.copy(world);mesh.receiveShadow=source.receiveShadow;mesh.frustumCulled=false;patchScene.add(mesh)
      camera.lookAt(hit.point);camera.updateMatrixWorld(true)
      gl.setRenderTarget(target);await gl.compileAsync(patchScene,camera)
      const values:number[][]=[]
      for(let mode=1;mode<=10;mode++){measure.value=mode;const selected=mode===2||mode===3?components.packed:field;updateIndirectUniforms(uniforms,selected);uniforms.hdGIUseVolume.value=1;gl.setRenderTarget(target);gl.render(patchScene,camera);const p=new Uint16Array(4);await gl.readRenderTargetPixelsAsync(target,0,0,1,1,p);values.push([...p.slice(0,3)].map(DataUtils.fromHalfFloat))}
      if(new Vector3().fromArray(values[5]).lengthSq()<.9)throw Error('Receiver patch did not render: '+name)
      const projected=hit.point.clone().project(s.camera)
      reports.push({name,position:hit.point.toArray(),geometricNormal:(()=>{const n=face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(world)).normalize();if(n.dot(new Vector3().fromArray(values[5]))<0)n.negate();return n.toArray()})(),material:original.name,materialType:original.type,roughness:original.roughness,metalness:original.metalness,textures:{map:original.map?.name,normal:!!original.normalMap,ao:!!original.aoMap},directIrradiance:values[0],skyIrradiance:values[1],reflectedIrradiance:values[2],totalDiffuseIrradiance:values[3],albedo:values[4],normal:values[5],linearHDR:values[6],ACESDisplayRGB:acesDisplay(values[6],gl.toneMappingExposure),artistFillAndOtherIrradiance:values[7],samplePosition:values[8],floor:Math.round(values[9][0]),floorReceiver:values[9][1]>.5,withinCameraFrustum:Math.abs(projected.x)<=1&&Math.abs(projected.y)<=1&&projected.z>=-1&&projected.z<=1})
      patchScene.remove(mesh);geometry.dispose();material.dispose()
    }
    const sun=lights.find(l=>l instanceof DirectionalLight&&l.userData.houseDesignerRole==='sun-light')as DirectionalLight
    s.scene.userData.referenceMeasurementProgress={stage:'independent sky and interpolation'}
    const independent=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./kitchenSurfaceMeasurements.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{worker.terminate();if(e.data.ok)resolve(e.data);else reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))}
      worker.postMessage({field:serializeIndirectField(field),skyCoefficients:snapshot.sky,geometry:snapshotIndirectGeometry(s.scene),points:reports,skyMode:uniforms.hdSkyMode.value>1.5?'overcast':'clear',skyBase:uniforms.hdSkyRadianceBase.value.toArray(),skySun:uniforms.hdSkyDisplaySunIrradiance.value.clone().multiplyScalar(uniforms.hdSkyRadianceBase.value.x/.65).toArray(),sun:{direction:sun?new Vector3().subVectors(sun.position,sun.target.position).normalize().toArray():[0,1,0],color:sun?[sun.color.r,sun.color.g,sun.color.b]:[0,0,0],intensity:sun?.intensity??0}})
    })
    let fullReference
    if(view==='stairwell'||new URLSearchParams(location.search).has('fullReference')){
      s.scene.userData.referenceMeasurementProgress={stage:'reference material snapshot'}
      const {snapshotReferenceScene}=await import('./sceneReferenceSnapshot')
      const prepared=await snapshotReferenceScene(s)
      const {data,...metadata}=prepared
      fullReference={...metadata,...await new Promise<object>((resolve,reject)=>{
        const worker=new Worker(new URL('./sceneLightingReference.worker.ts',import.meta.url),{type:'module'})
        worker.onmessage=e=>{if(e.data.progress){s.scene.userData.referenceMeasurementProgress=e.data.progress;return}worker.terminate();if(e.data.ok)resolve(e.data);else reject(Error(e.data.error))}
        worker.onerror=e=>{worker.terminate();reject(Error(e.message))}
        worker.postMessage({scene:data,points:reports,samples:16384},[data.positions.buffer,data.uvs.buffer,data.materialIndices.buffer,...data.textures.map(texture=>texture.pixels.buffer)])
      })}
    }
    return{points:reports,independent,fullReference,glError:gl.getContext().getError(),exposure:gl.toneMappingExposure,notes:['GPU receiver patches preserve the original triangle attributes, textures, PBR hooks, shadow maps and camera position. Patches isolate individual surfaces even when hidden in the full view.','Linear HDR includes material AO/specular response but excludes screen-space AO; ACESDisplayRGB applies the renderer ACES/sRGB transform to that HDR. Full screenshots include the existing AO/compositor.','Sky/reflected irradiance uses the same SH volumes as the diagnostic views; independent escaped-ray integration and exact interpolation links are evaluated in a separate worker.']}
  }finally{updateIndirectUniforms(uniforms,field);uniforms.hdGIUseVolume.value=1;uniforms.hdGIVolume.value=volume;uniforms.hdGIFloorLayer.value=floorVolume;gl.setRenderTarget(targetBefore);gl.toneMapping=tone;gl.autoClear=autoClear;gl.shadowMap.autoUpdate=auto;gl.shadowMap.needsUpdate=need;target.dispose();s.setFrameloop(frameloop);s.invalidate()}
}
