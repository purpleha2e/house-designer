import { simplifyLightingDetail, type DetailGeometry, type DetailRange } from './lumenDetail'

// Material groups of one mesh share the same cloned vertex buffers.
// Retain just the current mesh while processing its ranges sequentially.
let geometry:DetailGeometry|undefined
self.onmessage=async({data}:MessageEvent<DetailRange & {geometry?:DetailGeometry}>)=>{
  try{
    if(data.geometry)geometry=data.geometry
    const indices=geometry ? await simplifyLightingDetail({...geometry,...data}) : null
    self.postMessage(indices,{transfer:indices?[indices.buffer]:[]})
  }catch{self.postMessage(null)}
}
