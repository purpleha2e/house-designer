import {Vector3} from 'three'
import type {RootState} from '@react-three/fiber'
import {serializeIndirectField} from '../../src/indirectLighting'
import {snapshotIndirectGeometry} from '../../src/indirectVisibility'
import {snapshotReferenceScene} from './sceneReferenceSnapshot'
import {createArtefactAudit} from './renderArtefactAudit'
import WorkerURL from './doorConfidence.worker.ts?worker&url'

async function save(name:string,body:BodyInit){
 const response=await fetch(`http://127.0.0.1:9185/${name}`,{method:'POST',body})
 if(!response.ok)throw Error('Artifact save failed: '+name)
}

/** Portable lossless input: uint32 header length, JSON header, typed buffers;
 * gzip only compresses the container, never the numeric data. */
async function saveInput(name:string,input:unknown){
 const buffers:ArrayBuffer[]=[]
 const header=new TextEncoder().encode(JSON.stringify(input,(_,value)=>{
  if(ArrayBuffer.isView(value)){const index=buffers.length;buffers.push(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength) as ArrayBuffer);return{typed:value.constructor.name,index,length:(value as any).length}}
  return value
 }))
 const length=new Uint32Array([header.byteLength])
 const blob=new Blob([length,header,...buffers])
 const compressed=await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()
 await save(name,compressed)
 return{rawBytes:blob.size,compressedBytes:compressed.size}
}

export async function startDoorConfidence(s:RootState,configuration:string,samples=1536){
 const context:any={configuration,state:'capturing'}
 Object.assign(window,{doorConfidence:context})
 const audit=createArtefactAudit(s)
 Object.assign(window,{confidenceAudit:audit})
 s.scene.userData.getIndirectUniforms().hdWhiteModel.value=1
 await audit.capture(configuration+'-baseline','A')
 const field=s.scene.userData.getLightingField(),step=field.bounds.size/(field.floorLayer.n-1)
 const source=JSON.parse((await(await fetch('/docs/door-floor-streak/original-trace.json')).text()).replace(/^\uFEFF/,''))
 const points:any[]=source.points.map((p:any,i:number)=>({name:'trace-'+i,kind:'trace',position:p.position,...(configuration==='original'?{reference:p.reference}:{})}))
 const gridX=Math.round((.7-field.bounds.minX)/step),gridZ=Math.round((14.45-field.bounds.minZ)/step),nx=22,nz=17
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)points.push({name:`grid-${x}-${z}`,kind:'grid',position:[field.bounds.minX+(gridX+2*x)*step,.016,field.bounds.minZ+(gridZ+2*z)*step]})
 for(const x of [.5,1,1.5])for(const z of [16,16.5,17])points.push({name:`control-${x}-${z}`,kind:'control',position:[x,.016,z]})
 context.state='snapshot'
 const reference=await snapshotReferenceScene(s)
 const input={configuration,samples,field:serializeIndirectField(field),coefficients:field.coefficients,geometry:snapshotIndirectGeometry(s.scene),reference:reference.data,points}
 context.input=input
 context.storage=await saveInput(configuration+'-input.bin.gz',input)
 const cache={...s.scene.userData.getBakedIndirectLighting(),reflections:[]}
 await save(configuration+'-field.json',JSON.stringify(cache))
 const door=s.scene.getObjectByName('model-transform-a05cbb5f-52ea-4231-94ef-19667bc1c609')!
 await save(configuration+'-capture.json',JSON.stringify({camera:audit.camera(),door:{position:door.position.toArray(),rotation:door.rotation.toArray(),matrix:door.matrixWorld.toArray()},grid:{nx,nz,step:2*step},state:s.scene.userData.indirectLighting,profile:s.scene.userData.getLightingPerformance(),settings:cache.settings,storage:context.storage},null,2))
 const worker=new Worker(WorkerURL,{type:'module'})
 context.worker=worker;context.state='computing'
 worker.onmessage=async({data})=>{
  if(data.ok===undefined){context.progress=data;return}
  context.result=data;context.state='saving';worker.terminate()
  try{await save(configuration+'-results.json',JSON.stringify(data));context.state='done'}catch(e){context.state='error';context.error=String(e)}
 }
 worker.onerror=e=>{context.state='error';context.error=e.message;worker.terminate()}
 worker.postMessage(input)
 return{points:points.length,storage:context.storage,configuration}
}
