import {DataUtils,Mesh,Vector3,HalfFloatType,type WebGLRenderTarget} from 'three'
import type {RootState} from '@react-three/fiber'
import type {EffectComposer} from 'postprocessing'
import {getEditorFiber} from './rendererTestModules'
import {createViewportSurfaceVisibility} from '../../src/viewportSurfaceVisibility'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
import {serializeIndirectField} from '../../src/indirectLighting'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic'
import {measureKitchenFrames} from './kitchenFrameMeasurements'
import type {ReferenceReceiver} from '../sceneLightingReference'

export function attachSpatialAtlas(s:RootState){
 const render=s.gl.render;let lastAtlas:WebGLRenderTarget|undefined
 s.gl.render=function(...args){const mesh=args[0].children[0];if(mesh instanceof Mesh&&Reflect.get(mesh.material,'uniforms')?.hdSurfacePositions)lastAtlas=s.gl.getRenderTarget()??undefined;return render.apply(this,args)}
 return{atlas:()=>lastAtlas,dispose(){s.gl.render=render}}
}
export function spatialHouseView(s:RootState){
 let composer:EffectComposer|undefined
 const visit=(f:ReturnType<typeof getEditorFiber>)=>{if(!f)return;const v=f.ref?.current;if(v?.passes)composer=v;visit(f.child);visit(f.sibling)};visit(getEditorFiber())
 if(!composer)throw Error('House compositor unavailable')
 const c=composer,active=s.internal.active,loop=s.frameloop,visibility=createViewportSurfaceVisibility(),uniforms=s.scene.userData.getIndirectUniforms(),ao=c.passes.find(p=>'configuration'in p&&'aoRadius'in(p.configuration as object))!
 const originalAO=ao.enabled,white=uniforms.hdWhiteModel.value,field=s.scene.userData.getLightingField(),generation=s.scene.userData.indirectLighting.generation,coefficients=field.coefficients.map((a:Uint16Array)=>a.slice())
 s.scene.traverse(o=>{visibility.bindObject(o,o);if(o instanceof Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])visibility.bindMaterial(m,m)})
 s.setFrameloop('never');s.internal.active=false;ao.enabled=false
 return{
  setCamera(position:number[],lookAt:number[],fov:number){s.camera.position.fromArray(position);s.camera.lookAt(new Vector3().fromArray(lookAt));Reflect.set(s.camera,'fov',fov);Reflect.get(s.camera,'updateProjectionMatrix').call(s.camera);s.camera.updateMatrixWorld(true);visibility.sync(s.camera.position)},
  async capture(neutral:boolean){
   uniforms.hdWhiteModel.value=neutral?1:0
   let pixels:Promise<Uint16Array>|undefined
   const tone=c.passes.at(-1)!,render=tone.render
   tone.render=function(renderer,input,...args){if(input.texture.type!==HalfFloatType)throw Error('Expected linear half-float HDR compositor input');const a=new Uint16Array(input.width*input.height*4);pixels=renderer.readRenderTargetPixelsAsync(input,0,0,input.width,input.height,a).then(()=>a);return render.call(this,renderer,input,...args)}
   try{
    for(let i=0;i<2;i++){await new Promise(requestAnimationFrame);c.render(1/60)}
    if(!pixels)throw Error('HDR readback unavailable')
    const data=await pixels,bytes=new Uint8Array(data.buffer);let base64='';for(let i=0;i<bytes.length;i+=32768)base64+=String.fromCharCode(...bytes.subarray(i,i+32768))
    if(generation!==s.scene.userData.indirectLighting.generation||!field.coefficients.every((a:Uint16Array,c:number)=>a.every((v,i)=>v===coefficients[c][i])))throw Error('Display capture mutated the completed field')
    return{hdr:btoa(base64),width:s.gl.domElement.width,height:s.gl.domElement.height,generationUnchanged:true,coefficientsUnchanged:true}
   }finally{tone.render=render}
  },
  async performance(){uniforms.hdWhiteModel.value=white;ao.enabled=originalAO;return measureKitchenFrames(s,c,{cases:[['unchanged normal renderer',()=>{}]],restore:()=>{}})},
  async inspect(points:ReferenceReceiver[],referenceOverride:unknown[],atlas:WebGLRenderTarget){
   uniforms.hdWhiteModel.value=white
   const snapshot=await snapshotReferenceScene(s),cache=s.scene.userData.getIndirectSurfaceCache(),size=cache.layout.size
   const selected=new Map<number,typeof field.probes[number]>()
   for(const point of points){const p=new Vector3().fromArray(point.position),nearest=[...field.probes].sort((a,b)=>a.position.distanceToSquared(p)-b.position.distanceToSquared(p))[0];if(nearest)selected.set(nearest.index,nearest);if(selected.size>=10)break}
   const captures=[]
   for(const probe of selected.values()){
    const samples=[]
    for(let face=0;face<6;face++){
     const [x,y]=cache.layout.tile(probe.index,face),direct=new Uint16Array(size*size*4),final=new Uint16Array(size*size*4)
     await s.gl.readRenderTargetPixelsAsync(cache.currentRadiance,x,y,size,size,direct);await s.gl.readRenderTargetPixelsAsync(atlas,x,y,size,size,final)
     for(let row=0;row<size;row++)for(let col=0;col<size;col++){
      const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1]),weight=4/d.length()**3,offset=(row*size+col)*4
      samples.push({direction:d.normalize().toArray(),weight,direct:[0,1,2].map(c=>DataUtils.fromHalfFloat(direct[offset+c])),final:[0,1,2].map(c=>DataUtils.fromHalfFloat(final[offset+c]))})
     }
    }captures.push({index:probe.index,position:probe.position.toArray(),samples})
   }
   const receivers=points.map(p=>({...p,auditBaseline:sampleDisplayedIndirect(field,Math.max(0,field.floors.findIndex((_:unknown,i:number)=>p.position[1]>=field.ranges[i].bottom&&p.position[1]<field.ranges[i].top)),new Vector3().fromArray(p.position),new Vector3().fromArray(p.normal)).rgb}))
   return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./giSpatialExperiments.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.progress)return;worker.terminate();if(e.data.ok)resolve(e.data);else reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({kind:'house',variant:field.spatialInterpolation,field:serializeIndirectField(field),coefficients:field.coefficients,volume:field.volume.data,floorLayer:field.floorLayer.data,scene:snapshot.data,points:receivers,captures,referenceOverride})})
  },
  status(){return{gi:{...s.scene.userData.indirectLighting},spatialInterpolation:field.spatialInterpolation,positions:field.probes.map((p:typeof field.probes[number])=>({index:p.index,position:p.position.toArray()})),coefficients:field.coefficients.map((a:Uint16Array)=>Array.from(a)),renderer:s.gl.getContext().getParameter(s.gl.getContext().getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL),width:s.gl.domElement.width,height:s.gl.domElement.height,dpr:s.gl.getPixelRatio(),exposure:s.gl.toneMappingExposure,memory:s.gl.info.memory,volumeBytes:field.volume.data.byteLength,floorBytes:field.floorLayer.data.byteLength,diagnosticsLoaded:!!s.scene.userData.lightingDiagnostics}},
  dispose(){uniforms.hdWhiteModel.value=white;ao.enabled=originalAO;s.internal.active=active;s.setFrameloop(loop);s.invalidate()},
 }
}
