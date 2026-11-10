// Controlled fixtures use the same six-pass production solver, gain=1/fill=0.
import {BoxGeometry,DataUtils,HalfFloatType,Mesh,MeshStandardMaterial,Vector3,WebGLRenderTarget} from 'three'
import {getEditorState} from './rendererTestModules'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic'

export async function runCorrectnessRoom(kind:string){
  const api=(window as unknown as {probeDaylight:{scene:import('three').Scene;renderer:import('three').WebGLRenderer;camera:import('three').Camera;run:(c:string,b:number,s:boolean)=>Promise<unknown>}}).probeDaylight
  const {scene,renderer,camera}=api,s=getEditorState()!,extras:Mesh[]=[]
  const material=new MeshStandardMaterial({color:0xffffff,roughness:1});material.color.setRGB(.65,.65,.65)
  const box=(p:number[],size:number[])=>{const m=new Mesh(new BoxGeometry(...size as[number,number,number]),material);m.position.fromArray(p);m.castShadow=m.receiveShadow=true;scene.add(m);extras.push(m)}
  if(kind==='two-rooms'){
    box([2.5,1.4,.75],[.15,2.8,1.5]);box([2.5,1.4,3.2],[.15,2.8,1.6]);box([2.5,2.45,1.95],[.15,.7,.9]);box([3.25,1.65,-.1],[1.5,1.7,.2])
  }
  if(kind==='furniture'){
    box([2.5,.9,2],[1.6,.1,1.2]);for(const x of [1.85,3.15])for(const z of [1.55,2.45])box([x,.425,z],[.1,.85,.1])
  }
  const receivers=[{name:'floor by window',position:[1.5,.005,1],normal:[0,1,0]},
    {name:'ceiling',position:[kind==='two-rooms'?1.5:2.5,2.795,2],normal:[0,-1,0]},
    {name:'rear wall',position:[3.8,1.4,3.995],normal:[0,0,-1]},
    {name:kind==='furniture'?'under table':'second room floor',position:[3,.005,2.3],normal:[0,1,0]},
    {name:'exposed floor',position:[4,.005,2.3],normal:[0,1,0]}]
  try{
    const production=await api.run(kind==='sunlight'?'direct':'overcast',6,kind==='sealed')
    s.setFrameloop('never')
    const field=scene.userData.getLightingField(),uniforms=scene.userData.getIndirectUniforms()
    const points=receivers.map(r=>({...r,geometricNormal:r.normal,productionIrradiance:sampleDisplayedIndirect(field,0,new Vector3().fromArray(r.position),new Vector3().fromArray(r.normal),new Vector3().fromArray(r.normal)).rgb}))
    const snapshot=await snapshotReferenceScene(s)
    const result=await new Promise<Record<string,unknown>>((resolve,reject)=>{const worker=new Worker(new URL('./lightingCorrectnessReference.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.progress)return;worker.terminate();if(e.data.ok)resolve(e.data);else reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({scene:snapshot.data,points,samples:16384})})
    const target=new WebGLRenderTarget(renderer.domElement.width,renderer.domElement.height,{type:HalfFloatType}),before=renderer.getRenderTarget()
    const read=async()=>{renderer.setRenderTarget(target);renderer.render(scene,camera);const p=new Uint16Array(target.width*target.height*4);await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,p);renderer.setRenderTarget(before);return p}
    let shadowComparison
    try{if(kind==='sunlight'){
      const sun=scene.children.find(o=>'isDirectionalLight'in o) as import('three').DirectionalLight,generation=scene.userData.indirectLighting.generation,coefficients=field.coefficients.map((a:Uint16Array)=>a.slice()),on=await read(),intensity=sun.shadow.intensity
      sun.shadow.intensity=0;const off=await read();sun.shadow.intensity=intensity
      let changed=0,max=0;for(let i=0;i<on.length;i++){const d=Math.abs(DataUtils.fromHalfFloat(on[i])-DataUtils.fromHalfFloat(off[i]));if(d>.0001)changed++;max=Math.max(max,d)}
      shadowComparison={changedComponents:changed,maxAbsoluteHDRDifference:max,generationUnchanged:generation===scene.userData.indirectLighting.generation,coefficientsUnchanged:field.coefficients.every((a:Uint16Array,c:number)=>a.every((v,i)=>v===coefficients[c][i]))}
    }}finally{target.dispose();renderer.setRenderTarget(before)}
    renderer.render(scene,camera)
    return{kind,production,reference:result,shadowComparison,controls:{fill:uniforms.hdGIIndoorFill.value,gain:uniforms.hdSkyRadianceBase.value.x/.65,passes:6,shOrder:field.shOrder,probes:field.probes.length},snapshot:{triangles:snapshot.triangles,textures:snapshot.textures},glError:renderer.getContext().getError()}
  }finally{for(const m of extras){scene.remove(m);m.geometry.dispose()}material.dispose();s.setFrameloop('always')}
}
