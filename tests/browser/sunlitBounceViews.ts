import {HalfFloatType,Mesh,MeshStandardMaterial,MeshBasicMaterial,Scene,WebGLRenderTarget} from 'three'
import {softGIView} from './softGIView'
import {getEditorFiber} from './rendererTestModules'
import {getIndirectLightingUniforms} from '../../src/indirectLightingShader'

/** Render detached proxies: editor effects must never patch diagnostic clones. */
export function sunlitViews(s:any,replay:any,source:any,extra:string[]=[]){
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
 return{camera:view.camera(),async capture(){
  const results:any={},width=s.gl.domElement.width,height=s.gl.domElement.height,before=s.gl.getRenderTarget(),shadowAuto=s.gl.shadowMap.autoUpdate,shadowNeed=s.gl.shadowMap.needsUpdate
  try{
   replay.bind('A');results.final=await view.capture(false);await source.save('final-hdr.bin.gz',{camera:results.final.camera,pixels:new Uint16Array(Uint8Array.from(atob(results.final.hdr),(c:string)=>c.charCodeAt(0)).buffer)});results.final.hdr=undefined
   let sun:any;s.scene.traverse((o:any)=>{if(o.userData.houseDesignerRole==='sun-light')sun=o});const intensity=sun.intensity;try{sun.intensity=0;const r=await view.capture(false);await source.save('direct-off-hdr.bin.gz',{camera:r.camera,pixels:new Uint16Array(Uint8Array.from(atob(r.hdr),(c:string)=>c.charCodeAt(0)).buffer)})}finally{sun.intensity=intensity}
   s.gl.shadowMap.autoUpdate=false;s.gl.shadowMap.needsUpdate=false;await s.gl.compileAsync(scene,s.camera)
   for(const [name,variant,m]of [['gi-A','A',0],['gi-B','B',0],['gi-C','C',0],['gi-no-surface-sun','no-surface-sun',0],['direct-sun','A',1],['fill','A',2],...extra.map(n=>['gi-'+n,n,0]as const)]as const){
    replay.bind(variant);mode.value=m;const intensities=lamps.map(l=>l.intensity);if(m===1)lamps.forEach(l=>l.intensity=0)
    const target=new WebGLRenderTarget(width,height,{type:HalfFloatType});try{s.gl.setRenderTarget(target);s.gl.state.buffers.depth.setMask(true);s.gl.clear();s.gl.render(scene,s.camera);const pixels=new Uint16Array(width*height*4);s.gl.setRenderTarget(null);await s.gl.readRenderTargetPixelsAsync(target,0,0,width,height,pixels);await source.save(name+'-hdr.bin.gz',{pixels,camera:view.camera(),width,height})}finally{target.dispose();lamps.forEach((l,i)=>l.intensity=intensities[i])}
   }
   results.memory={...s.gl.info.memory};source.check();return results
  }finally{s.gl.shadowMap.autoUpdate=shadowAuto;s.gl.shadowMap.needsUpdate=shadowNeed;s.gl.setRenderTarget(before);replay.restore()}
 },async frames(){replay.bind('A');try{return await view.frames()}finally{replay.restore()}},dispose(){owned.forEach(m=>m.dispose());view.dispose();replay.restore()}}
}
