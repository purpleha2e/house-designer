import {snapshotIndirectGeometry} from '../../src/indirectVisibility.ts'
import {snapshotReferenceScene} from './sceneReferenceSnapshot.ts'
import {serializeIndirectField} from '../../src/indirectLighting.ts'
import {giL2HousePoints} from './giL2HouseView.ts'

export async function localLightSnapshot(s:any) {
 if(!new URLSearchParams(location.search).has('diagnostic-local-light'))throw Error('Diagnostic flag required')
 const field=s.scene.userData.getLightingField(),snapshot=await snapshotReferenceScene(s)
 const input={field:serializeIndirectField(field),coefficients:field.coefficients,geometry:snapshotIndirectGeometry(s.scene),reference:snapshot.data,points:giL2HousePoints(s).points}
 const buffers:ArrayBuffer[]=[]
 const header=new TextEncoder().encode(JSON.stringify(input,(_,v)=>{
  if(ArrayBuffer.isView(v)){const index=buffers.length;buffers.push(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength) as ArrayBuffer);return{typed:v.constructor.name,index,length:(v as any).length}}return v
 }))
 const blob=new Blob([new Uint32Array([header.length]),header,...buffers])
 const body=await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob()
 const response=await fetch('http://127.0.0.1:9186/bedroom-input.bin.gz',{method:'POST',body})
 if(!response.ok)throw Error('Snapshot save failed')
 return {bytes:body.size,points:input.points,geometry:snapshot.triangles,gi:s.scene.userData.indirectLighting}
}
