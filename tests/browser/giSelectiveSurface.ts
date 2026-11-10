import type {RootState} from '@react-three/fiber'
import {serializeIndirectField} from '../../src/indirectLighting.ts'
import {snapshotReferenceScene} from './sceneReferenceSnapshot.ts'

export async function selectiveExperiment(s:RootState,input:any){
  const generation=s.scene.userData.indirectLighting.generation,started=performance.now(),snapshot=await snapshotReferenceScene(s),field=s.scene.userData.getLightingField()
  if(field.shOrder!==1)throw Error('This bounded control-variate experiment is L1 only')
  const points=[...input.previous.points.map((p:any)=>({...p,cohort:'detailed'})),...input.previous.coverage.map((p:any)=>({...p,cohort:'face-centre',reference:input.reference.results.find((r:any)=>r.name===p.name).reference}))]
  return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./giSelectiveSurface.worker.ts',import.meta.url),{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(Error('Local experiment exceeded six minutes'))},360000)
    worker.onmessage=e=>{if(e.data.progress){s.scene.userData.selectiveProgress=e.data.progress;return}clearTimeout(timer);worker.terminate();if(s.scene.userData.indirectLighting.generation!==generation){reject(Error('Obsolete geometry generation'));return}e.data.ok?resolve({generation,wallMs:performance.now()-started,snapshotMs:snapshot.snapshotMs,snapshotTriangles:snapshot.triangles,snapshotTextureBytes:snapshot.textureBytes,...e.data}):reject(Error(e.data.error))}
    worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message))}
    worker.postMessage({scene:snapshot.data,field:serializeIndirectField(field),coefficients:field.coefficients,volume:field.volume.data,floorLayer:field.floorLayer.data,points},[snapshot.data.positions.buffer,snapshot.data.uvs.buffer,snapshot.data.materialIndices.buffer,...snapshot.data.textures.map(t=>t.pixels.buffer)] as ArrayBuffer[])
  })
}
