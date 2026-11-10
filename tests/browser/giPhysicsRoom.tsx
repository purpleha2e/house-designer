import {useLayoutEffect,useState} from 'react'
import {createRoot,extend,useFrame} from '@react-three/fiber'
import {Color,DataUtils,Group,Mesh,MeshStandardMaterial,NoToneMapping,PerspectiveCamera,PlaneGeometry,Scene,Vector3,WebGLRenderer,DirectionalLight} from 'three'
import {IndirectLighting} from '../../src/components/IndirectLighting'
import {sampleDisplayedIndirect} from '../../src/indirectLightingDiagnostic'
import type {RoomCase,V} from '../giPhysicsReference'
import {runPhysicsUnits} from './giPhysicsUnits'

const renderer=new WebGLRenderer({antialias:false});renderer.setSize(360,270);renderer.toneMapping=NoToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;document.body.append(renderer.domElement)
const detailed=new URLSearchParams(location.search).has('physicsTrace')
let replayRadiance:any
const render=renderer.render.bind(renderer)
if(detailed)renderer.render=(renderScene,renderCamera)=>{render(renderScene,renderCamera);if(renderScene.children.some((o:any)=>o.material?.uniforms?.hdSurfaceResponses))replayRadiance=renderer.getRenderTarget()}
const scene=new Scene(),camera=new PerspectiveCamera(65,4/3,.01,30);camera.position.set(2,1.5,2);camera.lookAt(2,1.5,0)
const materials:MeshStandardMaterial[]=[],meshes:Mesh[]=[]
// Infinitesimally thin inward-facing rectangles exactly match the reference
// box: no unmodelled window reveals or exterior wall thickness.
const panel=(p:V,size:[number,number],face:number,n:V)=>{const material=new MeshStandardMaterial({color:new Color(.5,.5,.5),roughness:1,metalness:0});material.userData.face=face;const mesh=new Mesh(new PlaneGeometry(...size),material);mesh.position.fromArray(p);mesh.quaternion.setFromUnitVectors(new Vector3(0,0,1),new Vector3(...n));mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);materials.push(material);meshes.push(mesh);return mesh}
panel([0,1.5,2],[4,3],0,[1,0,0]);panel([4,1.5,2],[4,3],1,[-1,0,0]);panel([2,0,2],[4,4],2,[0,1,0]);panel([2,3,2],[4,4],3,[0,-1,0]);panel([2,1.5,4],[4,3],5,[0,0,-1])
panel([2,.35,0],[4,.7],4,[0,0,1]);panel([2,2.75,0],[4,.5],4,[0,0,1]);panel([.5,1.6,0],[1,1.8],4,[0,0,1]);panel([3.5,1.6,0],[1,1.8],4,[0,0,1])
const shutter=panel([2,1.6,0],[2,1.8],4,[0,0,1])
const sun=new DirectionalLight('white',0);sun.userData.houseDesignerRole='sun-light';sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.001;Object.assign(sun.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.1,far:30});sun.shadow.camera.updateProjectionMatrix();sun.target.position.set(2,1.5,2);scene.add(sun,sun.target)
const floors=[{id:'physics-room',elevation:0,height:3,rooms:[{signature:'room',polygon:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}]}]}]
const receivers=[{name:'floor',p:[2,.025,2] as V,n:[0,1,0] as V},{name:'rear wall',p:[2,1.5,3.97] as V,n:[0,0,-1] as V},{name:'ceiling',p:[2,2.97,2] as V,n:[0,-1,0] as V},{name:'left wall',p:[.03,1.5,2] as V,n:[1,0,0] as V}]
let change:((c:RoomCase)=>void)|undefined,recording=false,passes:any[]=[],activeConfig:RoomCase|undefined,passAt=0
// Observe the exact publication boundary, including fast batched passes.
let status:any={}
const capturePass=(pass:number)=>{
 if(!recording||!scene.userData.getLightingField)return
 const field=scene.userData.getLightingField()
 const samples=receivers.map(r=>({...r,rgb:sampleDisplayedIndirect(field,0,new Vector3(...r.p),new Vector3(...r.n)).rgb}))
 // Approximate area quadrature for a power-balance diagnostic, not an exact
 // conservation proof: positions are offset into the room by up to 3 cm.
 const faces=[]
 for(let face=0;face<6;face++){
  const mean=[0,0,0];let count=0
  for(let a=0;a<8;a++)for(let b=0;b<8;b++){
   const u=(a+.5)/8,v=(b+.5)/8,p:V=face<2?[face===0?.03:3.97,u*3,v*4]:face<4?[u*4,face===2?.025:2.97,v*4]:[u*4,v*3,face===4?.03:3.97],n:V=face===0?[1,0,0]:face===1?[-1,0,0]:face===2?[0,1,0]:face===3?[0,-1,0]:face===4?[0,0,1]:[0,0,-1]
   const value=sampleDisplayedIndirect(field,0,new Vector3(...p),new Vector3(...n)).rgb;for(let c=0;c<3;c++)mean[c]+=value[c];count++
  }
  faces.push({face,area:face===2||face===3?16:12,mean:mean.map(v=>v/count)})
 }
 const at=performance.now(),coefficients=field.probes.map((p:any)=>({index:p.index,position:p.position.toArray(),rgb:field.coefficients.map((channel:Uint16Array)=>Array.from(channel.subarray(p.index*field.coefficientCount,(p.index+1)*field.coefficientCount),DataUtils.fromHalfFloat))}))
 const capturedRadiance:any[]=[]
 if(detailed){const cache=scene.userData.getIndirectSurfaceCache?.(),target=pass===1?cache?.currentRadiance:replayRadiance
  if(cache&&target&&field.probes[0])for(let face=0;face<6;face++){const [x,y]=cache.layout.tile(field.probes[0].index,face),pixels=new Uint16Array(16*16*4);renderer.readRenderTargetPixels(target,x,y,16,16,pixels);capturedRadiance.push({probe:field.probes[0].index,face,rgb:Array.from(pixels,DataUtils.fromHalfFloat).filter((_,i)=>i%4!==3)})}
 }
 passes.push({pass,samples,faces,volumeN:field.volume.n,probes:field.probes.length,order:field.shOrder,coefficientCount:field.coefficientCount,coefficients,capturedRadiance,passWallMs:at-passAt,
  reflectedAtReceivers:samples.map(s=>({name:s.name,rgb:s.rgb.map((v:number,c:number)=>v*(activeConfig?.rho[c]??0)/Math.PI)})),
  memory:{volumeBytes:field.volume.data.byteLength,floorBytes:field.floorLayer.data.byteLength,coefficientBytes:field.coefficients.reduce((sum:number,a:Uint16Array)=>sum+a.byteLength,0)},
 });passAt=at
}
Object.defineProperty(scene.userData,'indirectLighting',{configurable:true,get:()=>status,set:next=>{status=new Proxy(next,{set(target,key,value){Reflect.set(target,key,value);if(key==='fullPassPublications'&&Number(value)>0)capturePass(Number(value));return true}})}})
function Display(){useFrame(()=>{renderer.setRenderTarget(null);renderer.render(scene,camera)},1);return null}
extend({Group})
function App(){
 const [input,setInput]=useState({revision:0,daylight:false,config:''})
 useLayoutEffect(()=>{change=config=>{
  recording=false;activeConfig=config;passAt=performance.now()
  if(config.window)shutter.removeFromParent();else scene.add(shutter)
  for(const material of materials){material.color.setRGB(...config.rho);const emits=config.emission==='all'||config.emission==='ceiling'&&material.userData.face===3;material.emissive.setRGB(...(emits?[1,.5,.25]:[0,0,0]) as V);material.emissiveIntensity=1}
  sun.position.copy(sun.target.position).add(new Vector3(...config.direction).normalize().multiplyScalar(10));sun.intensity=config.sun;sun.updateMatrixWorld(true);sun.target.updateMatrixWorld(true);sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true
  scene.updateMatrixWorld(true);passes=[];recording=true;setInput(previous=>({revision:previous.revision+1,daylight:config.window,config:JSON.stringify(config)}))
 }},[])
 return <><Display/><IndirectLighting floors={floors} revision={JSON.stringify({floors,case:input.config,revision:input.revision})} enabled blocked={false} indoorFill={0} daylight={input.daylight} daylightBounceStrength={1} fastEnabled={false} diffuseBounces={6} diffuseProbeResolution={16} captureReflections={false}
 cacheSettings={{daylight:input.daylight,lights:false,shadows:true,lightShadows:false,hideRoofs:false,floorSlabs:true,ambientTerm:0,softAmbientShading:false,softAmbientStrength:0,groundPlane:false,skyMode:'clear',diffuseBounces:6,daylightBounceStrength:1,diffuseProbeResolution:16}}/></>
}
await createRoot(renderer.domElement).configure({gl:renderer,scene,camera,shadows:true,size:{width:360,height:270,top:0,left:0}}).then(root=>root.render(<App/>))
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
Object.assign(window,{giPhysics:{units:runPhysicsUnits,scene,renderer,async room(config:RoomCase){
 while(!change)await wait(10)
 const started=performance.now(),old=status.generation;change(config)
 while(status.generation===old||status.state!=='ready'||status.pendingUpdate||status.volumePending||passes.length<6){
  if(performance.now()-started>150000)throw Error('Physics room timeout '+JSON.stringify(status))
  if(status.state==='fallback')throw Error('Physics room failed '+JSON.stringify(status))
  await wait(20)
 }
 recording=false;await wait(30);return{config,elapsedMs:performance.now()-started,passes:passes.slice(),status:{...status},selection:scene.userData.indirectSHExperiment,profile:scene.userData.getLightingPerformance?.(),glError:renderer.getContext().getError()}
}}})
