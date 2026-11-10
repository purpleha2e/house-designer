/* Test-only instrumentation. No import from the production entry point. */
import {Color,DataUtils,DirectionalLight,FloatType,HalfFloatType,Mesh,MeshStandardMaterial,Raycaster,ShaderChunk,Vector2,Vector3,WebGLRenderTarget,type Material,type Camera} from 'three'
import type {RootState} from '@react-three/fiber'
import type {EffectComposer} from 'postprocessing'
import {getEditorFiber} from './rendererTestModules'
import {updateIndirectUniforms} from '../../src/indirectLightingShader'
import {isLightingGlazing} from '../../src/lightingVisibility'
import {createViewportSurfaceVisibility} from '../../src/viewportSurfaceVisibility'

export async function installLightingCorrectnessAudit(s:RootState){
  let composer:EffectComposer|undefined
  function visit(f:ReturnType<typeof getEditorFiber>){if(!f)return;const v=f.ref?.current;if(v?.passes)composer=v;visit(f.child);visit(f.sibling)}visit(getEditorFiber())
  if(!composer)throw Error('Production composer unavailable')
  const c=composer,gl=s.gl,context=gl.getContext() as WebGL2RenderingContext
  const viewVisibility=createViewportSurfaceVisibility();s.scene.traverse(o=>{viewVisibility.bindObject(o,o);if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])viewVisibility.bindMaterial(m,m)})
  let ao=c.passes.find(p=>'configuration'in p&&'aoRadius'in(p.configuration as object)) as typeof c.passes[number]&{configuration:{aoRadius:number;intensity:number;screenSpaceRadius:boolean};firstFrame:()=>void}
  if(!ao)throw Error('Production N8AO pass unavailable')
  const originalLoop=s.frameloop,originalActive=s.internal.active,uniforms=s.scene.userData.getIndirectUniforms()
  const snapshot=s.scene.userData.lightingDiagnostics.snapshot(),components=s.scene.userData.lightingDiagnostics.components()
  const originalField=snapshot.display??snapshot.field,packed=components.packed
  if(!packed)throw Error('Cached sky decomposition unavailable')
  s.setFrameloop('never')
  // Canvas props can restore frameloop='always' during a React commit. Keep
  // automatic R3F callbacks suspended while this test manually drives frames.
  s.internal.active=false
  const savedTarget=gl.getRenderTarget(),savedAutoClear=gl.autoClear
  const target=new WebGLRenderTarget(gl.domElement.width,gl.domElement.height,{type:HalfFloatType,depthBuffer:true})
  const componentTarget=new WebGLRenderTarget(target.width,target.height,{type:FloatType,depthBuffer:true})
  const read=(t:WebGLRenderTarget)=>{const a=new Uint16Array(t.width*t.height*4);return gl.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,a).then(()=>a)}
  const lights:DirectionalLight[]=[]
  s.scene.traverseVisible(o=>{if('isLight'in o&&'shadow'in o&&o.shadow)lights.push(o as DirectionalLight)})
  const shadows=lights.map(l=>l.shadow.intensity),aoOriginal={radius:ao.configuration.aoRadius,intensity:ao.configuration.intensity,enabled:ao.enabled}
  const oldMaterials=new Map<Material,{hook:Material['onBeforeCompile'];key:Material['customProgramCacheKey']}>()
  const mode={value:0},gi={value:1}
  function bindDiagnosticField(){updateIndirectUniforms(uniforms,packed);uniforms.hdGIUseVolume.value=1;uniforms.hdDiagnosticSkyReady.value=1}
  const rawDraw=async()=>{gl.setRenderTarget(target);gl.autoClear=true;gl.render(s.scene,s.camera);return read(target)}
  // Verify the extra diagnostic field does not change final reconstruction.
  const originalPixels=await rawDraw()
  updateIndirectUniforms(uniforms,packed);uniforms.hdGIUseVolume.value=1
  const packedPixels=await rawDraw()
  const compare=(a:Uint16Array,b:Uint16Array)=>{let count=0,max=0,roundingViolations=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])count++;const x=DataUtils.fromHalfFloat(a[i]),y=DataUtils.fromHalfFloat(b[i]),d=Math.abs(x-y);max=Math.max(max,d);if(d>.002*(1+Math.max(Math.abs(x),Math.abs(y))))roundingViolations++}return{differentComponents:count,maxAbsoluteError:max,roundingViolations}}
  const packedEquivalence=compare(originalPixels,packedPixels)
  s.scene.traverse(o=>{if(!(o instanceof Mesh))return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
    if(!(m instanceof MeshStandardMaterial)||oldMaterials.has(m))continue
    const hook=m.onBeforeCompile,key=m.customProgramCacheKey;oldMaterials.set(m,{hook,key})
    m.onBeforeCompile=(shader,renderer)=>{
      hook.call(m,shader,renderer)
      if(new URLSearchParams(location.search).has('legacyDiagnosticSky'))shader.fragmentShader=shader.fragmentShader.replace('vec3 hdDiagnosticSky(float floorIndex,vec3 p,vec3 normal,float floorReceiver){',`vec3 hdDiagnosticSky(float floorIndex,vec3 p,vec3 normal,float floorReceiver){float support;return hdDiagnosticSkySample(floorIndex,p,normal,floorReceiver,support);}
vec3 hdAuditBlendedSkyUnused(float floorIndex,vec3 p,vec3 normal,float floorReceiver){`)
      shader.uniforms.hdAuditMode=mode;shader.uniforms.hdAuditGI=gi
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float hdAuditMode,hdAuditGI;
vec3 hdAuditSunRaw=vec3(0.),hdAuditSun=vec3(0.),hdAuditLocalRaw=vec3(0.),hdAuditLocal=vec3(0.);
float hdAuditKind=0.,hdAuditSunVisibility=1.,hdAuditSunSource=0.;`)
      if(shader.fragmentShader.includes('#include <lights_fragment_begin>'))shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',ShaderChunk.lights_fragment_begin)
      for(const kind of ['Point','Spot','Directional']){
        const pattern=new RegExp(`get${kind}LightInfo\\([^;]*, directLight \\);`,'g')
        shader.fragmentShader=shader.fragmentShader.replace(pattern,match=>match+`hdAuditKind=${kind==='Directional'?'1.':'0.'};${kind==='Directional'?'hdAuditSunSource=max3(directLight.color);hdAuditSunRaw':'hdAuditLocalRaw'}+=max(dot(geometryNormal,directLight.direction),0.)*directLight.color;`)
      }
      shader.fragmentShader=shader.fragmentShader.replace(/RE_Direct\( directLight,[^;]+;/g,match=>`if(hdAuditKind>.5){hdAuditSun+=max(dot(geometryNormal,directLight.direction),0.)*directLight.color;hdAuditSunVisibility=max3(directLight.color)/max(hdAuditSunSource,.000001);}else hdAuditLocal+=max(dot(geometryNormal,directLight.direction),0.)*directLight.color;\n`+match)
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`
vec3 hdAuditNormal=normalize(transformNormalByInverseViewMatrix(geometryNormal,viewMatrix));
vec3 hdAuditGeometric=normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal,viewMatrix));
vec3 hdAuditPosition;float hdAuditFloor;
float hdAuditId=hdGIReceiver(hdGIWorldPosition,hdGIReceiverWorldOffset,hdAuditGeometric,hdGIFloorLayerReady,hdAuditPosition,hdAuditFloor);
vec3 hdAuditSky=vec3(0.),hdAuditReflected=vec3(0.),hdAuditFill=vec3(0.);
if(hdAuditId>=0.){
  hdAuditSky=hdDiagnosticSky(hdAuditId,hdAuditPosition,hdAuditNormal,hdAuditFloor)*hdGIProbeStrength*hdGIDisplayStrength;
  hdAuditFill=vec3(hdGIIndoorFill);
  hdAuditReflected=irradiance-hdAuditFill-hdAuditSky;
  if(hdAuditGI<.5)irradiance=hdAuditSky+hdAuditFill;
}else hdAuditSky=irradiance;
#include <lights_fragment_end>`)
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
if(hdAuditMode>.5){
  if(hdAuditMode<1.5)outgoingLight=hdGIWorldPosition;
  else if(hdAuditMode<2.5)outgoingLight=hdAuditNormal;
  else if(hdAuditMode<3.5)outgoingLight=hdAuditGeometric;
  else if(hdAuditMode<4.5)outgoingLight=diffuseColor.rgb;
  else if(hdAuditMode<5.5)outgoingLight=hdAuditSunRaw;
  else if(hdAuditMode<6.5)outgoingLight=hdAuditSun;
  else if(hdAuditMode<7.5)outgoingLight=hdAuditLocalRaw;
  else if(hdAuditMode<8.5)outgoingLight=hdAuditLocal;
  else if(hdAuditMode<9.5)outgoingLight=hdAuditSky;
  else if(hdAuditMode<10.5)outgoingLight=hdAuditReflected;
  else if(hdAuditMode<11.5)outgoingLight=hdAuditFill;
  else if(hdAuditMode<12.5)outgoingLight=vec3(hdAuditSunVisibility);
  else if(hdAuditMode<13.5)outgoingLight=vec3(max3(hdAuditLocal)/max(max3(hdAuditLocalRaw),.000001));
  else if(hdAuditMode<14.5){outgoingLight=vec3(1.);
#ifdef USE_AOMAP
outgoingLight=vec3(ambientOcclusion);
#endif
  }
  else if(hdAuditMode<15.5)outgoingLight=reflectedLight.indirectDiffuse;
  else if(hdAuditMode<16.5)outgoingLight=reflectedLight.directDiffuse+reflectedLight.directSpecular;
  else outgoingLight=reflectedLight.indirectSpecular+totalEmissiveRadiance;
}
#include <opaque_fragment>`)
    }
    m.customProgramCacheKey=()=>key.call(m)+':correctness-audit-v1';m.needsUpdate=true
  }})
  await gl.compileAsync(s.scene,s.camera)
  bindDiagnosticField()
  const instrumentedPixels=await rawDraw(),instrumentationEquivalence=compare(packedPixels,instrumentedPixels)
  const baseline={generation:snapshot.generation,faces:s.scene.userData.indirectLighting.capturedFaces,coefficients:snapshot.field.coefficients.map((a:Uint16Array)=>a.slice())}
  function unchanged(){const g=s.scene.userData.indirectLighting;return {generation:g.generation,faces:g.capturedFaces,fieldSame:s.scene.userData.lightingDiagnostics.snapshot().field===snapshot.field,coefficientsUnchanged:snapshot.field.coefficients.every((a:Uint16Array,i:number)=>a.every((v,j)=>v===baseline.coefficients[i][j])),generationUnchanged:g.generation===baseline.generation,facesUnchanged:g.capturedFaces===baseline.faces,packedBound:uniforms.hdGIVolume.value===packed.volume.maps[0],uniformHeight:uniforms.hdGIVolumeSize.value.y,packedHeight:packed.volume.height}}
  function setConfig(shadow:boolean,indirect:boolean,ambientOcclusion:boolean,radius=aoOriginal.radius,intensity=aoOriginal.intensity){ao=c.passes.find(p=>'configuration'in p&&'aoRadius'in(p.configuration as object)) as typeof ao;lights.forEach((l,i)=>l.shadow.intensity=shadow?shadows[i]:0);gi.value=indirect?1:0;mode.value=0;ao.enabled=ambientOcclusion;ao.configuration.aoRadius=radius;ao.configuration.intensity=intensity;ao.firstFrame()}
  function bytes(a:ArrayBufferView){const data=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);let result='';for(let i=0;i<data.length;i+=32768)result+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(result)}
  async function capture(){
    mode.value=0;let pixels:Promise<Uint16Array>|undefined
    const tone=c.passes.at(-1)!
    const render=tone.render
    tone.render=function(renderer,input,...args){pixels=read(input);return render.call(this,renderer,input,...args)}
    try{for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);bindDiagnosticField();c.render(1/60)}if(!pixels)throw Error('Tone pass was replaced during capture: '+JSON.stringify(c.passes.map(p=>({name:p.name,enabled:p.enabled,same:p===tone}))));return{hdr:bytes(await pixels),width:gl.domElement.width,height:gl.domElement.height,type:'rgba16f-little-endian-bottom-up',unchanged:unchanged()}}
    finally{tone.render=render;gl.setRenderTarget(savedTarget)}
  }
  async function component(which:number,points?:{x:number;y:number}[]){bindDiagnosticField();mode.value=which;if(points){gl.setRenderTarget(componentTarget);gl.autoClear=true;gl.render(s.scene,s.camera);const p=new Float32Array(target.width*target.height*4);await gl.readRenderTargetPixelsAsync(componentTarget,0,0,target.width,target.height,p);mode.value=0;gl.setRenderTarget(savedTarget);return points.map(({x,y})=>Array.from(p.subarray(((target.height-1-y)*target.width+x)*4,((target.height-1-y)*target.width+x)*4+3)))}const background=s.scene.background,hidden:Material[]=[];if(which===12){s.scene.background=new Color(0);for(const m of oldMaterials.keys())if(m.visible&&isLightingGlazing(m)){m.visible=false;hidden.push(m)}}try{const p=await rawDraw();return{data:bytes(p),width:target.width,height:target.height}}finally{s.scene.background=background;hidden.forEach(m=>m.visible=true);mode.value=0;gl.setRenderTarget(savedTarget)}}
  const initialCamera=s.camera.position.clone()
  return {setConfig,capture,component,unchanged,
    project(points:number[][]){return points.map(p=>{const v=new Vector3().fromArray(p).project(s.camera);return{x:Math.floor((v.x+1)*.5*target.width),y:Math.floor((1-v.y)*.5*target.height),visible:Math.abs(v.x)<1&&Math.abs(v.y)<1&&v.z>=-1&&v.z<=1}})},
    identify(points:{pixel:{x:number;y:number};position:number[]}[]){const meshes:Mesh[]=[];s.scene.traverseVisible(o=>{if(o instanceof Mesh)meshes.push(o)});const ray=new Raycaster();return points.map(p=>{ray.setFromCamera(new Vector2((p.pixel.x+.5)/target.width*2-1,1-(p.pixel.y+.5)/target.height*2),s.camera);const hits=ray.intersectObjects(meshes,false);const hit=hits.find(h=>{const mesh=h.object as Mesh,m=Array.isArray(mesh.material)?mesh.material[h.face?.materialIndex??0]:mesh.material;return m instanceof MeshStandardMaterial&&m.visible&&m.opacity>.01&&!isLightingGlazing(m)&&h.point.distanceTo(new Vector3().fromArray(p.position))<.06});if(!hit)return{unresolved:true};const mesh=hit.object as Mesh,m=(Array.isArray(mesh.material)?mesh.material[hit.face?.materialIndex??0]:mesh.material) as MeshStandardMaterial;const ancestors=[];for(let o:import('three').Object3D|null=mesh;o;o=o.parent)ancestors.push({name:o.name,role:o.userData.houseDesignerRole,modelId:o.userData.modelId});return{mesh:mesh.name,material:m.name,materialType:m.type,roughness:m.roughness,metalness:m.metalness,aoMap:!!m.aoMap,normalMap:!!m.normalMap,receiveShadow:mesh.receiveShadow,castShadow:mesh.castShadow,ancestors}})},
    setCamera(position:number[],lookAt:number[],fov=60){s.camera.position.fromArray(position);s.camera.lookAt(new Vector3().fromArray(lookAt));if('fov'in s.camera){s.camera.fov=fov;(s.camera as Camera&{updateProjectionMatrix:()=>void}).updateProjectionMatrix()}s.camera.updateMatrixWorld(true);viewVisibility.sync(s.camera.position);ao.firstFrame();return {position:s.camera.position.toArray(),quaternion:s.camera.quaternion.toArray(),fov,lookAt}},
    settings(){return{legacyDiagnosticSky:new URLSearchParams(location.search).has('legacyDiagnosticSky'),width:target.width,height:target.height,dpr:gl.getPixelRatio(),exposure:gl.toneMappingExposure,toneMapping:gl.toneMapping,shOrder:snapshot.field.shOrder,probes:snapshot.field.probes.length,gi:s.scene.userData.indirectLighting,sky:{base:uniforms.hdSkyRadianceBase.value.toArray(),mode:uniforms.hdSkyMode.value,coefficientNonzero:snapshot.sky?.map((a:Uint16Array)=>a.filter(v=>v!==0).length)},diagnosticBindings:unchanged(),fill:uniforms.hdGIIndoorFill.value,ao:aoOriginal,screenSpaceRadius:ao.configuration.screenSpaceRadius,passes:c.passes.map(p=>({name:p.name,type:p.constructor.name,enabled:p.enabled})),packedEquivalence,instrumentationEquivalence,gpuTimer:!!context.getExtension('EXT_disjoint_timer_query_webgl2'),renderer:context.getParameter(context.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL??context.RENDERER),memory:gl.info.memory,diagnosticBytes:packed.volume.data.byteLength+packed.floorLayer.data.byteLength+target.width*target.height*8,lights:lights.map(l=>({type:l.type,position:l.position.toArray(),target:l.target?.position.toArray(),color:l.color.toArray(),intensity:l.intensity,shadow:{intensity:l.shadow.intensity,bias:l.shadow.bias,normalBias:l.shadow.normalBias,radius:l.shadow.radius,mapSize:l.shadow.mapSize.toArray(),camera:{near:l.shadow.camera.near,far:l.shadow.camera.far}}}))}},
    async dispose(){mode.value=0;setConfig(true,true,aoOriginal.enabled);for(const [m,{hook,key}]of oldMaterials){m.onBeforeCompile=hook;m.customProgramCacheKey=key;m.needsUpdate=true}updateIndirectUniforms(uniforms,originalField);target.dispose();componentTarget.dispose();gl.setRenderTarget(savedTarget);gl.autoClear=savedAutoClear;s.camera.position.copy(initialCamera);s.internal.active=originalActive;s.setFrameloop(originalLoop);s.invalidate()},
  }
}
