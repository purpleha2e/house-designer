import {DataUtils} from 'three'
import type {IndirectField} from '../../src/indirectLighting'
import {useLayoutEffect,useState} from 'react'
import {createRoot,extend,useFrame} from '@react-three/fiber'
import {BoxGeometry,Group,Mesh,MeshStandardMaterial,Vector3} from 'three'
import {renderer,scene,camera,receivers,floors,shutter,sun,white} from './daylightReference.ts'
import {IndirectLighting} from '../../src/components/IndirectLighting'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic'
import type {DaylightSkyMode} from '../../src/daylightSky'
import {createIndirectSurfaceCache} from '../../src/indirectSurfaceCache'
function Display(){useFrame(()=>renderer.render(scene,camera),1);return null}
extend({Group})
let change:(condition:string,bounces:number,sealed:boolean)=>void
export function App(){
  const [input,setInput]=useState({revision:0,mode:'clear' as DaylightSkyMode,bounces:6})
  useLayoutEffect(()=>{change=(condition,bounces,sealed)=>{
    if(sealed)scene.add(shutter);else scene.remove(shutter)
    sun.position.set(2.5,6,condition==='direct'?-6:8);sun.intensity=condition==='overcast'?0:3
    setInput(v=>({revision:v.revision+1,mode:condition==='overcast'?'overcast':'clear',bounces}))
  }},[])
  return <><Display/><IndirectLighting floors={floors} revision={String(input.revision)} enabled blocked={false} indoorFill={0} daylight fastEnabled={false}
    diffuseBounces={input.bounces} cacheSettings={{daylight:true,lights:false,shadows:true,lightShadows:false,hideRoofs:false,floorSlabs:true,ambientTerm:0,softAmbientShading:false,softAmbientStrength:0,groundPlane:false,skyMode:input.mode}}/>
  </>
}
await createRoot(renderer.domElement).configure({gl:renderer,scene,camera,shadows:true,size:{width:1000,height:740,top:0,left:0}}).then(root=>root.render(<App/>))
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const occluder=new Mesh(new BoxGeometry(2.8,2.3,.4),new MeshStandardMaterial({color:0x333333,roughness:1}));occluder.castShadow=occluder.receiveShadow=true
Object.assign(window,{probeDaylight:{scene,renderer,camera,
setWallReflectance(r:number,g=r,b=r){white.color.setRGB(r,g,b)},
setOccluder(x:number|null){if(x===null)scene.remove(occluder);else{occluder.position.set(x,1.15,.6);scene.add(occluder)}},
async retainCheck(){
  const original=scene.userData.getIndirectSurfaceCache(),field=scene.userData.getLightingField(),uniforms=scene.userData.getIndirectUniforms()
  const retained=createIndirectSurfaceCache(renderer,[...original.layout.slots.keys()],original.layout.size,uniforms,true)!
  try{const copied=await retained.retainFrom(original,[...original.ready],()=>false);retained.hydrateRetained();await retained.compile();let maxError=0
    for(const index of [...original.ready].slice(0,8)){
      const probe=field.probes.find((p:{index:number})=>p.index===index)
      const a=await original.relight(index,probe.position.toArray(),[],sun,1),b=await retained.relight(index,probe.position.toArray(),[],sun,1)
      for(let i=0;i<field.coefficientCount;i++)for(const c of ['x','y','z'] as const)maxError=Math.max(maxError,Math.abs(a.coefficients[i][c]-b.coefficients[i][c]))
    }
    return {copied,maxError,glError:renderer.getContext().getError()}
  }finally{retained.dispose()}
},async run(condition='away',bounces=6,sealed=false){
  while(!change)await pause(20)
  const old=scene.userData.indirectLighting?.generation??-1,started=performance.now();change(condition,bounces,sealed)
  while(!scene.userData.getLightingField||scene.userData.indirectLighting?.generation===old||scene.userData.indirectLighting?.state!=='ready'||scene.userData.indirectLighting?.volumePending||scene.userData.indirectLighting?.pendingUpdate||(scene.userData.indirectLighting?.fullPassPublications??0)<bounces){
    if(performance.now()-started>120000)throw Error('Probe reference timed out: '+JSON.stringify(scene.userData.indirectLighting))
    if(scene.userData.indirectLighting?.state==='fallback')throw Error('Probe failure: '+JSON.stringify(scene.userData.indirectLighting));await pause(30)
  }
  await pause(150)
  const field=scene.userData.getLightingField()
  return {shOrder:field.shOrder,probePositions:field.probes.map(p=>p.position.toArray()),condition,bounces,sealed,elapsedMs:performance.now()-started,receivers:receivers.map(r=>({...r,irradiance:sampleDisplayedIndirect(field,0,new Vector3(...r.p as [number,number,number]),new Vector3(...r.n as [number,number,number]))})),
    status:{...scene.userData.indirectLighting},performance:scene.userData.getLightingPerformance(),glError:renderer.getContext().getError()}
}}})

// Simulate the missing receiver samples encountered after loading saved GI.
// Drop four atlas-ready flags immediately after pass one, then compare the
// existing fresh-capture fallback with the lazy static bootstrap path.
const probeAPI=Reflect.get(window,'probeDaylight') as {run:(condition:string,bounces:number,sealed:boolean)=>Promise<{elapsedMs:number;status:Record<string,unknown>}>}
Object.assign(probeAPI,{async bootstrapCheck(){
 const previous=scene.userData.indirectSurfaceBootstrapEnabled
 const execute=async(enabled:boolean)=>{
  let raw=scene.userData.indirectLighting,dropped:number[]=[]
  const wrap=(status:Record<string,unknown>)=>new Proxy(status,{set(target,key,value){Reflect.set(target,key,value);if(key==='fullPassPublications'&&value===1&&!dropped.length){const cache=scene.userData.getIndirectSurfaceCache();dropped=[...cache.ready].sort((a,b)=>Number(a)-Number(b)).slice(0,4);dropped.forEach(index=>cache.ready.delete(index))}return true}})
  let value=wrap(raw)
  Object.defineProperty(scene.userData,'indirectLighting',{configurable:true,get:()=>value,set(next){raw=next;value=wrap(next)}})
  scene.userData.indirectSurfaceBootstrapEnabled=enabled
  try{return{...await probeAPI.run('direct',6,false),dropped}}
  finally{Object.defineProperty(scene.userData,'indirectLighting',{configurable:true,writable:true,enumerable:true,value:raw})}
 }
 const pixels=()=>{renderer.setRenderTarget(null);renderer.render(scene,camera);const values=new Uint8Array(renderer.domElement.width*renderer.domElement.height*4);const gl=renderer.getContext();gl.readPixels(0,0,renderer.domElement.width,renderer.domElement.height,gl.RGBA,gl.UNSIGNED_BYTE,values);return values}
 const copy=()=>{const field=scene.userData.getLightingField()as IndirectField;return[...field.coefficients,field.volume.data,field.floorLayer.data].map(data=>data.slice())}
 try{
  const baseline=await execute(false),expected=copy(),beforePixels=pixels(),candidate=await execute(true),actual=copy(),afterPixels=pixels()
  let different=0,maxError=0,values=0
  expected.forEach((array,c)=>{if(array.length!==actual[c].length)throw Error('Bootstrap field layout changed');array.forEach((v,i)=>{values++;if(v!==actual[c][i])different++;maxError=Math.max(maxError,Math.abs(DataUtils.fromHalfFloat(v)-DataUtils.fromHalfFloat(actual[c][i])))})})
  let changedChannels=0,maxChannelDelta=0;beforePixels.forEach((v,i)=>{const delta=Math.abs(v-afterPixels[i]);if(delta)changedChannels++;maxChannelDelta=Math.max(maxChannelDelta,delta)})
  const oldRead=renderer.readRenderTargetPixelsAsync,generationBefore=scene.userData.indirectLighting.generation
  let delayed=false,interrupted=false
  renderer.readRenderTargetPixelsAsync=function(...args){const result=oldRead.apply(this,args);if(!delayed&&scene.userData.indirectLighting.pass===2){delayed=true;return result.then(async value=>{await pause(80);return value})}return result}as typeof oldRead
  try{
   const pending=execute(true),started=performance.now()
   while(!interrupted&&performance.now()-started<30000){
    if(delayed&&scene.userData.indirectLighting.generation>generationBefore&&scene.userData.indirectLighting.surfaceBootstrappedProbes>0){change('overcast',6,false);await pause(30);change('direct',6,false);await pause(30);change('away',6,false);interrupted=true}
    else await pause(5)
   }
   await pending
  }finally{renderer.readRenderTargetPixelsAsync=oldRead}
  const afterCancellation=copy(),generationAfter=scene.userData.indirectLighting.generation
  await probeAPI.run('away',6,false);const fresh=copy();let cancellationError=0
  afterCancellation.forEach((array,c)=>array.forEach((v,i)=>{cancellationError=Math.max(cancellationError,Math.abs(DataUtils.fromHalfFloat(v)-DataUtils.fromHalfFloat(fresh[c][i])))}))
  return{shOrder:(scene.userData.getLightingField()as IndirectField).shOrder,baseline,candidate,different,values,maxError,changedChannels,maxChannelDelta,cancellation:{delayed,interrupted,generationBefore,generationAfter,maxError:cancellationError},glError:renderer.getContext().getError()}
 }finally{scene.userData.indirectSurfaceBootstrapEnabled=previous}
}})
