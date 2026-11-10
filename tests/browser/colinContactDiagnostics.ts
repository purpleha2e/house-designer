import {Box3,DataUtils,Mesh,MeshStandardMaterial,Raycaster,Vector2,Vector3,type Material} from 'three'
import type {RootState} from '@react-three/fiber'
import type {EffectComposer} from 'postprocessing'
import {getEditorFiber} from './rendererTestModules'
import {spatialHouseView} from './giSpatialHouse.ts'
import {createIndirectVisibility} from '../../src/indirectVisibility'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
import {sampleSpatialReceiversGPU} from './giSpatialReceiverGPU.ts'

export function contactDiagnostics(s:RootState){
 let composer:EffectComposer|undefined
 const visit=(f:ReturnType<typeof getEditorFiber>)=>{if(!f)return;const v=f.ref?.current;if(v?.passes)composer=v;visit(f.child);visit(f.sibling)};visit(getEditorFiber())
 if(!composer)throw Error('Missing compositor')
 const c=composer,ao=c.passes.find(p=>'configuration'in p&&'aoRadius'in(p.configuration as object))!,view=spatialHouseView(s),uniforms=s.scene.userData.getIndirectUniforms(),mode={value:0},smallBias={value:0}
 const original=new Map<Material,{hook:Material['onBeforeCompile'];key:Material['customProgramCacheKey']}>(),lights:{object:RootState['scene'];intensity:number;shadow?:{intensity:number}}[]=[],fake:{object:RootState['scene'];visible:boolean}[]=[]
 const originalAO=ao.enabled,enabled=uniforms.hdGIEnabled.value,white=uniforms.hdWhiteModel.value
 s.scene.traverse(o=>{if('isLight'in o&&'intensity'in o)lights.push({object:o as RootState['scene'],intensity:o.intensity as number,shadow:'shadow'in o?o.shadow as {intensity:number}:undefined});if(String(o.userData.houseDesignerRole).startsWith('fake-ambient'))fake.push({object:o as RootState['scene'],visible:o.visible})
  if(!(o instanceof Mesh))return
  for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!(m instanceof MeshStandardMaterial)||original.has(m))continue
   const hook=m.onBeforeCompile,key=m.customProgramCacheKey;original.set(m,{hook,key})
   m.onBeforeCompile=(shader,renderer)=>{hook.call(m,shader,renderer);shader.uniforms.hdContactMode=mode;shader.uniforms.hdContactSmallBias=smallBias
    if(!shader.fragmentShader.includes('vec3 hdGIVolumeSample('))return
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float hdContactMode,hdContactSmallBias;')
     .replace('float bias = floorReceiver > .5 ? .004 : .02 + dot(abs(surfaceNormal), stepSize);','float bias = floorReceiver > .5 ? .004 : mix(.02 + dot(abs(surfaceNormal), stepSize),.002,hdContactSmallBias);')
     .replace('#include <lights_fragment_end>','if(hdContactMode>.5&&hdContactMode<1.5){irradiance=vec3(.5);iblIrradiance=vec3(0.);radiance=vec3(0.);clearcoatRadiance=vec3(0.);}\n#include <lights_fragment_end>')
     .replace('#include <opaque_fragment>',`if(hdContactMode>1.5){
vec3 gn=normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal,viewMatrix)),sn=normalize(transformNormalByInverseViewMatrix(geometryNormal,viewMatrix)),p;float floorReceiver;
float id=hdGIReceiver(hdGIWorldPosition,hdGIReceiverWorldOffset,gn,hdGIFloorLayerReady,p,floorReceiver);
if(hdContactMode<2.5)outgoingLight=gn*.5+.5;
else if(hdContactMode<3.5)outgoingLight=id<0.?vec3(1.,0.,0.):vec3(0.,.35,1.);
else if(hdContactMode<4.5)outgoingLight=p;
else if(hdContactMode<5.5){float support=0.;vec3 mean;if(id>=0.)hdGIVolumeSample(id,p,sn,floorReceiver,mean,support);outgoingLight=vec3(support);}
else if(hdContactMode<6.5)outgoingLight=sn*.5+.5;
else outgoingLight=hdGIWorldPosition;
}\n#include <opaque_fragment>`)
   };m.customProgramCacheKey=()=>key.call(m)+':contact-diagnostic-v1';m.needsUpdate=true
  }
 })
 const lightShadowValues=lights.map(x=>x.shadow?.intensity)
 const probes=s.scene.getObjectByName('indirect-lighting-probes'),probesVisible=probes?.visible
 function state(options:{ao?:boolean;shadows?:boolean;gi?:boolean;flat?:boolean;diagnostic?:number;fake?:boolean;probes?:boolean;smallBias?:boolean}={}){
  ao.enabled=options.ao??true;Reflect.get(ao,'firstFrame')?.call(ao);mode.value=options.diagnostic??(options.flat?1:0);uniforms.hdGIEnabled.value=options.gi===false?0:enabled
  lights.forEach((l,i)=>{Reflect.set(l.object,'intensity',options.flat?0:l.intensity);if(l.shadow)l.shadow.intensity=options.shadows===false?0:lightShadowValues[i]!});fake.forEach(f=>f.object.visible=options.fake===false?false:f.visible)
  if(probes)probes.visible=options.probes??probesVisible!
  smallBias.value=options.smallBias?1:0
 }
 state()
 async function measure(points:{name:string;x:number;y:number}[]){
  const images:Record<string,Uint16Array>={}
  for(const [name,diagnostic]of [['normal',2],['classification',3],['samplePosition',4],['support',5],['worldPosition',7]] as const){state({ao:false,probes:false,diagnostic});const frame=await view.capture(true),bytes=Uint8Array.from(atob(frame.hdr),c=>c.charCodeAt(0));images[name]=new Uint16Array(bytes.buffer)}
  state({ao:false,probes:false});const frame=await view.capture(true),bytes=Uint8Array.from(atob(frame.hdr),c=>c.charCodeAt(0));images.light=new Uint16Array(bytes.buffer)
  const glError=s.gl.getContext().getError();if(glError)throw Error(`Measurement GL error ${glError}`)
  const width=s.gl.domElement.width,height=s.gl.domElement.height,read=(name:string,x:number,y:number)=>[0,1,2].map(c=>DataUtils.fromHalfFloat(images[name][((height-y-1)*width+x)*4+c])),ray=new Raycaster(),visibility=createIndirectVisibility(s.scene)
  try{return points.map(p=>{ray.setFromCamera(new Vector2((p.x+.5)/width*2-1,1-(p.y+.5)/height*2),s.camera)
   const worldPositionBuffer=read('worldPosition',p.x,p.y),gpuPosition=new Vector3().fromArray(worldPositionBuffer),along=gpuPosition.clone().sub(ray.ray.origin).dot(ray.ray.direction)
   // Editor meshes can override raycast for selection. Verify the displayed
   // position against the independent physical triangle BVH instead.
   const hit=visibility.hit(ray.ray.origin,ray.ray.direction,along+.015,Math.max(.0001,along-.015))
   if(!hit||hit.point.distanceTo(gpuPosition)>.015)return{...p,validPhysicalReceiver:false,worldPositionBuffer,reason:'GPU/physical surface mismatch',nearestPhysicalHit:hit?.point.toArray(),camera:ray.ray.origin.toArray(),along}
   const geometric=hit.face!.normal.clone();if(geometric.dot(ray.ray.direction)>0)geometric.negate()
   const surface=hit.point.clone()
   const samplePosition=read('samplePosition',p.x,p.y),delta=new Vector3().fromArray(samplePosition).sub(surface),distance=delta.length(),normal=read('normal',p.x,p.y).map(v=>v*2-1),occluder=visibility.hit(surface.clone().addScaledVector(geometric,.0002),delta.normalize(),Math.max(.0001,distance-.001),.0001)
   return{...p,validPhysicalReceiver:true as const,position:surface.toArray(),normal,geometricNormal:geometric.toArray(),samplePosition,worldPositionBuffer,classification:read('classification',p.x,p.y),support:read('support',p.x,p.y)[0],actualHDR:read('light',p.x,p.y),receiverOffsetDistance:distance,firstCrossedSurface:occluder?{distance:occluder.distance,point:occluder.point.toArray()}:null}
  })}finally{visibility.dispose()}
 }
 async function reference(points:Awaited<ReturnType<typeof measure>>){state({ao:false,probes:false});const snapshot=await snapshotReferenceScene(s);return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./lightingCorrectnessReference.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.progress)return;worker.terminate();if(e.data.ok)resolve({metadata:{snapshotMs:snapshot.snapshotMs,triangles:snapshot.triangles},...e.data});else reject(Error(e.data.error))};worker.onerror=e=>{worker.terminate();reject(Error(e.message))};worker.postMessage({scene:snapshot.data,points:points.filter(p=>p.validPhysicalReceiver),samples:8192})})}
 return{setCamera:view.setCamera,performance:view.performance,state,measure,reference,async capture(){uniforms.hdWhiteModel.value=1;for(let i=0;i<16;i++){await new Promise(requestAnimationFrame);c.render(1/60)}const result=await view.capture(true);const error=s.gl.getContext().getError();if(error)throw Error(`GL error ${error}`);return result},async status(){const reference=await(await fetch("/docs/lighting-correctness/verified/reference.json")).json(),house=await sampleSpatialReceiversGPU(s,reference.results);const models:unknown[]=[];s.scene.traverse(o=>{if(o.name.startsWith('model-transform-')){const b=new Box3().setFromObject(o);models.push({name:o.name,contact:!!o.userData.indirectContactModel,min:b.min.toArray(),max:b.max.toArray()})}});return{...view.status(),house,models,receiverContacts:s.scene.userData.indirectContactReceivers,contactMode:uniforms.hdGIContactMode.value,contactLayout:uniforms.hdGIContactLayout.value,ao:Object.fromEntries(Object.entries(Reflect.get(ao,'configuration'))),keys:Object.keys(s.scene.userData)}},async warm(){await view.capture(true)},dispose(){lights.forEach((l,i)=>{Reflect.set(l.object,'intensity',l.intensity);if(l.shadow)l.shadow.intensity=lightShadowValues[i]!});for(const [m,{hook,key}]of original){m.onBeforeCompile=hook;m.customProgramCacheKey=key;m.needsUpdate=true}uniforms.hdGIEnabled.value=enabled;uniforms.hdWhiteModel.value=white;ao.enabled=originalAO;view.dispose()},camera:()=>({position:s.camera.position.toArray(),lookAt:s.camera.getWorldDirection(new Vector3()).toArray()})}
}
