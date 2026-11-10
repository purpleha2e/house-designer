import {HalfFloatType,Mesh,MeshStandardMaterial,MeshBasicMaterial,Scene,WebGLRenderTarget} from 'three'
import {softGIView} from './softGIView'
import {getEditorFiber} from './rendererTestModules'
import {getIndirectLightingUniforms} from '../../src/indirectLightingShader'

/** Render detached proxies: editor effects must never patch diagnostic clones. */
export function sunBounceView(s:any){
 let compositor:any;const visit=(f:any)=>{if(!f)return;if(f.ref?.current?.passes)compositor=f.ref.current;visit(f.child);visit(f.sibling)};visit(getEditorFiber())
 const w=s.gl.domElement.width,h=s.gl.domElement.height;compositor.setSize(w+1,h+1);compositor.setSize(w,h)
 const view=softGIView(s),mode={value:0},scene=new Scene(),owned:any[]=[],lamps:any[]=[]
 view.setCamera(view.camera());s.scene.updateMatrixWorld(true)
 const visible=(o:any)=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true}
 s.scene.traverse((o:any)=>{
  if(!visible(o))return
  if(o.isLight){const light=o.clone(false);light.matrixAutoUpdate=false;light.matrix.copy(o.matrixWorld);light.matrixWorld.copy(o.matrixWorld);if(o.shadow)light.shadow=o.shadow;if(o.target)light.target=o.target;scene.add(light);if(light.isPointLight||light.isSpotLight)lamps.push(light);return}
  if(!(o instanceof Mesh))return
  const proxy=o.clone(false),materials=(Array.isArray(o.material)?o.material:[o.material]).map((m:any)=>{
   if(!(m instanceof MeshStandardMaterial)||!getIndirectLightingUniforms(m)){const black=new MeshBasicMaterial({color:0,side:m.side,transparent:m.transparent,opacity:m.opacity,depthWrite:m.depthWrite,colorWrite:m.colorWrite});black.visible=m.visible;owned.push(black);return black}
   const clone=m.clone(),hook=m.onBeforeCompile,key=m.customProgramCacheKey()+':sunlit-detached-view-v1'
   clone.onBeforeCompile=(shader,renderer)=>{hook.call(m,shader,renderer);shader.uniforms.sunlitViewMode=mode;shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float sunlitViewMode;vec3 sunlitGI=vec3(0.);').replace('#include <lights_fragment_end>','sunlitGI=irradiance-vec3(hdGIIndoorFill);\n#include <lights_fragment_end>').replace('#include <opaque_fragment>','outgoingLight=sunlitViewMode<.5?sunlitGI*diffuseColor.rgb*(1.0-metalnessFactor)/PI:sunlitViewMode<1.5?reflectedLight.directDiffuse:vec3(hdGIIndoorFill)*diffuseColor.rgb*(1.0-metalnessFactor)/PI;\n#include <opaque_fragment>').replace('#include <tonemapping_fragment>','').replace('#include <colorspace_fragment>','')}
   clone.customProgramCacheKey=()=>key;clone.toneMapped=false;owned.push(clone);return clone
  })
  proxy.material=Array.isArray(o.material)?materials:materials[0];proxy.matrixAutoUpdate=false;proxy.matrix.copy(o.matrixWorld);proxy.matrixWorld.copy(o.matrixWorld);proxy.frustumCulled=false;scene.add(proxy)
 })
 return {view,async gi(){const width=s.gl.domElement.width,height=s.gl.domElement.height,target=new WebGLRenderTarget(width,height,{type:HalfFloatType}),before=s.gl.getRenderTarget(),auto=s.gl.autoClear,shadowAuto=s.gl.shadowMap.autoUpdate,shadowNeed=s.gl.shadowMap.needsUpdate;try{mode.value=0;s.gl.shadowMap.autoUpdate=false;s.gl.shadowMap.needsUpdate=false;await s.gl.compileAsync(scene,s.camera);s.gl.setRenderTarget(target);s.gl.autoClear=true;s.gl.state.buffers.depth.setMask(true);s.gl.clear();s.gl.render(scene,s.camera);const pixels=new Uint16Array(width*height*4);s.gl.setRenderTarget(null);await s.gl.readRenderTargetPixelsAsync(target,0,0,width,height,pixels);const bytes=new Uint8Array(pixels.buffer);let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return {hdr:btoa(text),width,height}}finally{s.gl.setRenderTarget(before);s.gl.autoClear=auto;s.gl.shadowMap.autoUpdate=shadowAuto;s.gl.shadowMap.needsUpdate=shadowNeed;target.dispose()}},dispose(){owned.forEach(m=>m.dispose());view.dispose()}}
}
