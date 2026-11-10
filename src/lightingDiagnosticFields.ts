import type {IndirectField} from './indirectLighting.ts'
import {createIndirectVolume} from './indirectVolume.ts'
import {createIndirectFloorLayer} from './indirectFloorLighting.ts'
import {runViewportTask} from './viewportScheduling.ts'

/** Pack final and sky SH into each coefficient slab of the normal two volume
 * samplers. Keep both components so per-direction SH clamping precedes their
 * subtraction; subtracting coefficients first is not equivalent near lobes. */
export async function createPackedDiagnosticField(final:IndirectField,sky:IndirectField,cancelled:()=>boolean){
  if(final.volume.data.length!==sky.volume.data.length||final.floorLayer.data.length!==sky.floorLayer.data.length)throw Error('Diagnostic field layouts differ')
  if(final.shOrder!==sky.shOrder)throw Error('Diagnostic SH orders differ')
  const volume=createIndirectVolume(final.bounds.size,final.floors.length*2,.16,final.volume.n,final.coefficientCount),floorLayer=createIndirectFloorLayer(final.bounds.size,final.floors.length*2,.04,final.floorLayer.n,final.coefficientCount)
  const output={...final,volume,floorLayer,dispose(){volume.dispose();floorLayer.dispose()}}
  const result=await runViewportTask((function*(){
    for(const [a,b,to,n,height]of [[final.volume.data,sky.volume.data,volume.data,final.volume.n,final.volume.height],[final.floorLayer.data,sky.floorLayer.data,floorLayer.data,final.floorLayer.n,final.floorLayer.height]]as const){
      const slab=n*height*4
      for(let z=0;z<n;z++){
        for(let c=0;c<final.coefficientCount;c++){const start=(z*final.coefficientCount+c)*slab,target=(z*final.coefficientCount+c)*slab*2;to.set(a.subarray(start,start+slab),target);to.set(b.subarray(start,start+slab),target+slab)}
        yield
      }
    }
    output.floorLayer.ready=final.floorLayer.ready
    return output
  })(),cancelled)
  if(!result){output.dispose();return}
  return{field:output,dispose:()=>output.dispose()}
}
