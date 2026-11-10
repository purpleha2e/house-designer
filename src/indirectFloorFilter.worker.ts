import {filterSoftGI,prepareSoftGIGraph,type SoftGIField,type SoftGIGraph,type SoftGIBounds} from './indirectFloorFilter.ts'
import {createIndirectVisibilityFromSnapshot,type IndirectGeometrySnapshot} from './indirectVisibility.ts'
import {softGIGeometryParts,softGIChangedBounds} from './indirectFloorFilterGeometry.ts'

let graph:SoftGIGraph|undefined,original:Uint16Array|undefined,layout='',geometry:Awaited<ReturnType<typeof softGIGeometryParts>>|undefined
let previousOutput:Uint16Array|undefined,previousRadius=0
let queue=Promise.resolve()
// Serialize asynchronous hashing and synchronous filtering. Main-thread request
// IDs reject obsolete results; only immutable source data ever enters a filter.
self.onmessage=({data}:{data:{id:number;radius:number;field?:SoftGIField;geometry?:IndirectGeometrySnapshot}})=>{
  queue=queue.then(async()=>{
    const started=performance.now()
    let patch:SoftGIBounds|undefined
    if(data.field){
      const field=data.field,key=JSON.stringify([field.shOrder,field.bounds,field.floors,field.floorLayer.n])
      const next=data.geometry?await softGIGeometryParts(data.geometry):geometry
      if(!next)throw Error('Missing floor geometry')
      const changed=geometry&&layout===key?softGIChangedBounds(geometry,next):undefined
      const n=field.floorLayer.n,floors=field.floors.length,step=field.bounds.size/(n-1)
      if(original&&previousOutput&&previousRadius===data.radius&&layout===key&&original.length===field.floorLayer.data.length){
        patch={floor:-1,minX:n,maxX:-1,minZ:n,maxZ:-1}
        for(let i=0;i<original.length;i++)if(original[i]!==field.floorLayer.data[i]){
          const cell=Math.floor(i/4),x=cell%n,z=Math.floor(cell/(n*floors*4))
          patch.minX=Math.min(patch.minX,x);patch.maxX=Math.max(patch.maxX,x);patch.minZ=Math.min(patch.minZ,z);patch.maxZ=Math.max(patch.maxZ,z)
        }
        if(changed&&!changed.isEmpty()){
          patch.minX=Math.min(patch.minX,Math.floor((changed.min.x-field.bounds.minX-.21)/step));patch.maxX=Math.max(patch.maxX,Math.ceil((changed.max.x-field.bounds.minX+.21)/step))
          patch.minZ=Math.min(patch.minZ,Math.floor((changed.min.z-field.bounds.minZ-.21)/step));patch.maxZ=Math.max(patch.maxZ,Math.ceil((changed.max.z-field.bounds.minZ+.21)/step))
        }
        // Degree changes at either end of a changed edge can affect the next
        // ring of neighbours. Two maximum radii conservatively include both.
        const reach=Math.ceil(.4/step)
        if(patch.maxX>=patch.minX){patch.minX=Math.max(0,patch.minX-reach);patch.maxX=Math.min(n-1,patch.maxX+reach);patch.minZ=Math.max(0,patch.minZ-reach);patch.maxZ=Math.min(n-1,patch.maxZ+reach)}
      }
      let maskChanged=false
      if(original&&original.length===field.floorLayer.data.length)for(let i=3;i<original.length;i+=4)if(original[i]!==field.floorLayer.data[i]){maskChanged=true;break}
      if(!graph||!changed||!changed.isEmpty()||maskChanged){
        const visibility=createIndirectVisibilityFromSnapshot(data.geometry??Array.from(next.values(),entry=>entry.part))
        try{
          const box=changed&&!maskChanged&&!changed.isEmpty()?changed.clone().expandByScalar(.21):undefined
          const bounds=box?{floor:-1,minX:Math.floor((box.min.x-field.bounds.minX)/step),maxX:Math.ceil((box.max.x-field.bounds.minX)/step),minZ:Math.floor((box.min.z-field.bounds.minZ)/step),maxZ:Math.ceil((box.max.z-field.bounds.minZ)/step)}:undefined
          // Grid changes require a fresh graph. A local geometry edit rechecks
          // its expanded footprint and retains connections everywhere else.
          try{graph=prepareSoftGIGraph(field,visibility,.2,undefined,graph&&bounds&&layout===key?{previous:graph,bounds}:undefined)}
          catch(error){if(!bounds)throw error;graph=prepareSoftGIGraph(field,visibility)}
        }finally{visibility.dispose()}
      }
      geometry=next;layout=key;original=field.floorLayer.data
    }
    if(!graph||!original)throw Error('Floor filter is not prepared')
    const result=filterSoftGI(original,graph,data.radius,'sh',patch)
    if(patch&&previousOutput){
      const merged=previousOutput.slice(),n=graph.n,floors=graph.floors
      for(let z=patch.minZ;z<=patch.maxZ;z++)for(let band=0;band<floors*4;band++){
        const start=((z*floors*4+band)*n+patch.minX)*4,end=((z*floors*4+band)*n+patch.maxX+1)*4
        merged.set(result.output.subarray(start,end),start)
      }
      result.output=merged
    }
    previousOutput=result.output.slice();previousRadius=data.radius
    self.postMessage({id:data.id,output:result.output,statistics:{...result.statistics,incremental:!!patch,patch,wallMs:performance.now()-started,graph:graph.statistics}},{transfer:[result.output.buffer]})
  }).catch(error=>{self.postMessage({id:data.id,error:String(error)})})
}
