import {Mesh,MeshStandardMaterial,type Material} from 'three'
import type {RootState} from '@react-three/fiber'
import {getIndirectLightingUniforms} from '../../src/indirectLightingShader'
import {serializeIndirectField} from '../../src/indirectLighting'
import {snapshotIndirectGeometry} from '../../src/indirectVisibility'
import {barrierTexture,injectBarrierShader} from '../giBarrierShader'
import type {BarrierData,BarrierChange} from '../giBarrierGeometry'

export function barrierWorker(s:RootState){
 const worker=new Worker(new URL('./giBarrier.worker.ts',import.meta.url),{type:'module'}),pending=new Map<number,{resolve:(v:BarrierBuild)=>void;reject:(e:Error)=>void}>();let id=0
 worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);if(e.data.id!==id){p.reject(Error('Obsolete barrier generation'));return}if(e.data.ok)p.resolve(e.data);else p.reject(Error(e.data.error))}
 worker.onerror=e=>{for(const p of pending.values())p.reject(Error(e.message));pending.clear()}
 return{request(changes?:BarrierChange[],baselineWarm=false){const next=++id;for(const [old,p]of pending){p.reject(Error('Obsolete barrier generation'));pending.delete(old)}const field=s.scene.userData.getLightingField();return new Promise<BarrierBuild>((resolve,reject)=>{pending.set(next,{resolve,reject});worker.postMessage({id:next,field:serializeIndirectField(field),geometry:snapshotIndirectGeometry(s.scene),changes,baselineWarm})})},dispose(){worker.terminate();for(const p of pending.values())p.reject(Error('Barrier worker disposed'));pending.clear()}}
}
export type BarrierBuild={id:number;a:BarrierData;b:BarrierData;statistics:Record<string,number>}
export function installBarrierComparison(s:RootState,build:BarrierBuild){
 const originals=new Map<Material,{hook:Material['onBeforeCompile'];key:Material['customProgramCacheKey']}>();let mode:'legacy'|'A'|'B'='legacy',owned:ReturnType<typeof barrierTexture>|undefined
 const bindings={...barrierTexture(build.a).uniforms};bindings.hdBarrierAtlas.value.dispose()
 s.scene.traverse(o=>{if(!(o instanceof Mesh))return;for(const material of Array.isArray(o.material)?o.material:[o.material]){
  if(!(material instanceof MeshStandardMaterial)||originals.has(material)||!getIndirectLightingUniforms(material))continue
  const hook=material.onBeforeCompile,key=material.customProgramCacheKey;originals.set(material,{hook,key})
  // Three retains one uniform bag per material while switching cached programs.
  // Keep the auxiliary bindings in every bag, including the legacy variant.
  material.onBeforeCompile=(shader,renderer)=>{hook.call(material,shader,renderer);Object.assign(shader.uniforms,bindings);if(mode==='legacy')return;if(!shader.fragmentShader.includes('vec3 hdGIVolumeSample('))return;shader.fragmentShader=injectBarrierShader(shader.fragmentShader,mode)}
  material.customProgramCacheKey=()=>key.call(material)+(mode==='legacy'?'':`:barrier-${mode}`)
 }})
 return{setMode(next:'legacy'|'A'|'B'){
  if(next===mode)return
  owned?.texture.dispose();owned=undefined;mode=next
  if(next!=='legacy'){owned=barrierTexture(next==='A'?build.a:build.b);bindings.hdBarrierAtlas.value=owned.texture;bindings.hdBarrierInfo.value.copy(owned.uniforms.hdBarrierInfo.value);bindings.hdBarrierOffsets.value.copy(owned.uniforms.hdBarrierOffsets.value)}
  for(const m of originals.keys())m.needsUpdate=true
 },mode:()=>mode,bytes:()=>mode==='legacy'?0:mode==='A'?build.a.bytes:build.b.bytes,dispose(){owned?.texture.dispose();for(const [m,{hook,key}]of originals){m.onBeforeCompile=hook;m.customProgramCacheKey=key;m.needsUpdate=true}}}
}
