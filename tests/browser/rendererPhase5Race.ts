/* eslint-disable @typescript-eslint/no-explicit-any -- Native audit fields are installed by the external CDP test. */
import {BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget} from 'three'
const params=new URLSearchParams(location.search)
const {prepareShaderWarmupResources,prepareShaderWarmupPipelines}=await import(/* @vite-ignore */ params.has('reference')
  ? '/tmp/renderer-phase5/reference-shaderWarmup.ts' : '../../src/shaderWarmup')
const renderer=new WebGLRenderer(),camera=new PerspectiveCamera(55,1,.1,100)
renderer.setSize(32,32);document.body.append(renderer.domElement);camera.position.z=5
const scene=new Scene(),material=new MeshBasicMaterial(),first=new Mesh(new BoxGeometry(),material)
scene.add(first)
const counts:object[]=[],disposed:number[]=[],owners:object[]=[],arrays=new WeakMap()
Object.assign(window,{phase5AttributeArrays:arrays})
const describe=(mesh:Mesh)=>{
  const owner={id:mesh.id,geometry:mesh.geometry.id,material:material.uuid,type:mesh.type,createdAt:performance.now(),removedAt:0,disposedAt:0}
  for(const [name,a]of Object.entries(mesh.geometry.attributes))arrays.set(a.array,[{geometry:mesh.geometry.id,name,owner:mesh.id}])
  if(mesh.geometry.index)arrays.set(mesh.geometry.index.array,[{geometry:mesh.geometry.id,name:'index',owner:mesh.id}])
  mesh.geometry.addEventListener('dispose',()=>owner.disposedAt=performance.now());owners.push(owner);return owner
}
describe(first)
const target=new WebGLRenderTarget(1,1)
for(let i=0;i<3;i++){
  first.geometry.attributes.position.needsUpdate=true
  let obsolete:Mesh|null=new Mesh(new BoxGeometry(),material);scene.add(obsolete)
  const owner=describe(obsolete)
  let removed=false
  const render=(batch:Scene)=>{
    // A source owner completes an edit after the scan and before a later upload.
    // The callback places this interleaving deterministically, without stress.
    if(!removed&&obsolete){removed=true;owner.removedAt=performance.now();obsolete.removeFromParent();obsolete.geometry.dispose();disposed.push(obsolete.geometry.id)}
    renderer.render(batch,camera)
  }
  if(params.has('pipeline'))await prepareShaderWarmupPipelines(renderer,scene,camera,scene,target,()=>false,render)
  else await prepareShaderWarmupResources(renderer,scene,camera,scene,false,()=>false,render)
  obsolete=null
  renderer.render(scene,camera)
  if(params.has('gc'))await new Promise<void>(resolve=>Object.assign(window,{phase5RaceWaitingGC:i,phase5RaceResume:resolve}))
  const gl=renderer.getContext(),n=(gl as any).__rendererAudit
  counts.push({cycle:i+1,geometries:renderer.info.memory.geometries,buffers:n.live.buffers.size,disposed:[...disposed],native:(window as any).phase5NativeSnapshot(),trace:(window as any).phase5NativeTrace(),error:gl.getError()})
}
first.geometry.dispose();material.dispose();target.dispose();scene.clear()
if(params.has('gc'))await new Promise<void>(resolve=>Object.assign(window,{phase5RaceWaitingGC:3,phase5RaceResume:resolve}))
const afterOwnerDisposal={...renderer.info.memory,native:(window as any).phase5NativeSnapshot()}
renderer.dispose();renderer.forceContextLoss()
Object.assign(window,{phase5Race:{counts,owners,afterOwnerDisposal,afterRendererDisposal:(window as any).phase5NativeSnapshot(),finished:true}})
