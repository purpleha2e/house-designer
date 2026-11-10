import {BoxGeometry,DataUtils,Mesh,MeshStandardMaterial,Vector3,type WebGLRenderTarget} from 'three'
import {getEditorState} from './rendererTestModules'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
import {serializeIndirectField} from '../../src/indirectLighting'
import type {ReferenceReceiver} from '../sceneLightingReference'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic'

export async function spatialFixture(kind:string,variant='table',angular=true,inspect?:(s:Parameters<typeof snapshotReferenceScene>[0],points:ReferenceReceiver[])=>Promise<unknown>){
 const api=Reflect.get(window,'probeDaylight'),s=getEditorState()!,{scene,renderer}=api,extras:Mesh[]=[]
 const material=new MeshStandardMaterial({roughness:1});material.color.setRGB(.65,.65,.65)
 const box=(p:number[],size:number[])=>{const m=new Mesh(new BoxGeometry(...size as[number,number,number]),material);m.position.fromArray(p);m.castShadow=m.receiveShadow=true;scene.add(m);extras.push(m)}
 if(kind==='two-rooms'){box([2.5,1.4,.75],[.15,2.8,1.5]);box([2.5,1.4,3.2],[.15,2.8,1.6]);box([2.5,2.45,1.95],[.15,.7,.9]);box([3.25,1.65,-.1],[1.5,1.7,.2])}
 if(kind==='furniture'&&variant!=='removed'){
  const y=variant==='raised'?1.4:variant==='lowered'?.45:.9,x=variant==='sideways'?3.3:2.5
  if(variant==='cabinet')box([2.5,.9,2],[1.6,1.8,1.2])
  else{box([x,y,2],[1.6,.1,1.2]);for(const dx of [-.65,.65])for(const z of [1.55,2.45])box([x+dx,(y-.05)/2,z],[.1,y-.05,.1])}
 }
 const receivers=[{name:'floor by window',position:[1.5,.005,1],normal:[0,1,0]},
  {name:'ceiling',position:[kind==='two-rooms'?1.5:2.5,2.795,2],normal:[0,-1,0]},
  {name:'rear wall',position:[3.8,1.4,3.995],normal:[0,0,-1]},
  {name:kind==='furniture'?'under table':'second room floor',position:[3,.005,2.3],normal:[0,1,0]},
  {name:'exposed floor',position:[4,.005,2.3],normal:[0,1,0]}]
 if(kind==='furniture')for(let i=0;i<=32;i++)receivers.push({name:`profile-${i}`,position:[.5+i*.125,.005,2.1],normal:[0,1,0]})
 if(kind==='two-rooms')for(let i=0;i<=24;i++)receivers.push({name:`doorway-${i}`,position:[.4+i*.175,.005,1.95],normal:[0,1,0]})
 const render=renderer.render
 let lastAtlas:WebGLRenderTarget|undefined
 renderer.render=function(...args:Parameters<typeof render>){const first=args[0].children[0];if(first instanceof Mesh&&(first.material as MeshStandardMaterial&{uniforms?:Record<string,unknown>}).uniforms?.hdSurfacePositions)lastAtlas=renderer.getRenderTarget()??undefined;return render.apply(this,args)}
 try{
  const production=await api.run('overcast',6,kind==='sealed');s.setFrameloop('never');const active=s.internal.active;s.internal.active=false
  try{
   const field=scene.userData.getLightingField(),cache=scene.userData.getIndirectSurfaceCache(),snapshot=await snapshotReferenceScene(s)
   const points=receivers.map(r=>({...r,geometricNormal:r.normal,auditBaseline:sampleDisplayedIndirect(field,0,new Vector3().fromArray(r.position),new Vector3().fromArray(r.normal)).rgb}))
   const captures=[]
   if(angular){
    if(!lastAtlas)throw Error('Final Jacobi radiance atlas was not observed')
    const size=cache.layout.size
    for(const probe of field.probes){
     const samples=[]
     for(let face=0;face<6;face++){
      const [x,y]=cache.layout.tile(probe.index,face),direct=new Uint16Array(size*size*4),final=new Uint16Array(size*size*4)
      await renderer.readRenderTargetPixelsAsync(cache.currentRadiance,x,y,size,size,direct)
      await renderer.readRenderTargetPixelsAsync(lastAtlas,x,y,size,size,final)
      for(let row=0;row<size;row++)for(let col=0;col<size;col++){
       const u=-1+(col+.5)*2/size,v=1-(row+.5)*2/size,d=new Vector3().fromArray(face===0?[1,v,-u]:face===1?[-1,v,u]:face===2?[u,1,-v]:face===3?[u,-1,v]:face===4?[u,v,1]:[-u,v,-1]),len=d.length(),weight=4/(len**3),offset=(row*size+col)*4
       samples.push({direction:d.normalize().toArray(),weight,direct:[0,1,2].map(c=>DataUtils.fromHalfFloat(direct[offset+c])),final:[0,1,2].map(c=>DataUtils.fromHalfFloat(final[offset+c]))})
      }
     }
     captures.push({index:probe.index,position:new Vector3().fromArray(field.positionData,probe.index*4).toArray(),samples})
    }
   }
   const result=await new Promise<Record<string,unknown>>((resolve,reject)=>{const worker=new Worker(new URL('./giSpatialExperiments.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.progress)return;worker.terminate();if(e.data.ok)resolve(e.data);else reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({kind,variant,field:serializeIndirectField(field),coefficients:field.coefficients,volume:field.volume.data,floorLayer:field.floorLayer.data,scene:snapshot.data,points,captures})})
   return{kind,variant,production,...result,barrier:inspect?await inspect(s,points):undefined,memory:{textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,volumeBytes:field.volume.data.byteLength,floorBytes:field.floorLayer.data.byteLength,atlasBytes:scene.userData.indirectLighting.surfaceCacheBytes},glError:renderer.getContext().getError()}
  }finally{s.internal.active=active}
 }finally{renderer.render=render;for(const m of extras){scene.remove(m);m.geometry.dispose()}material.dispose();s.setFrameloop('always')}
}
