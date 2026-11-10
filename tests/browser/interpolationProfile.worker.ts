import {restoreIndirectField,type IndirectFieldData} from '../../src/indirectLighting'
import {createIndirectVisibilityFromSnapshot,type IndirectGeometrySnapshot} from '../../src/indirectVisibility'
import {createIndirectVolumeLookup,writeIndirectVolumeRow} from '../../src/indirectVolume'
import {writeIndirectFloorLayer,writeIndirectFloorRow} from '../../src/indirectFloorLighting'
import type {IndirectZoneChange} from '../../src/indirectLightingZones'

type Lookup=ReturnType<typeof createIndirectVolumeLookup>&{reuseData?:()=>unknown}
let previous:{field:ReturnType<typeof restoreIndirectField>;visibility:ReturnType<typeof createIndirectVisibilityFromSnapshot>;volume:Lookup;floor:Lookup}|undefined
self.onmessage=({data:r}:MessageEvent<{field:IndirectFieldData;coefficients:Uint16Array[];geometry:IndirectGeometrySnapshot;changes?:IndirectZoneChange[];reuse:boolean;verify:boolean}>)=>{
  const began=performance.now(),field=restoreIndirectField(r.field);r.coefficients.forEach((a,i)=>field.coefficients[i].set(a))
  let at=performance.now();const visibility=createIndirectVisibilityFromSnapshot(r.geometry),geometryMs=performance.now()-at
  try{
    const reusable=(lookup?:Lookup)=>r.reuse&&lookup?.reuseData?{previous:lookup.reuseData(),changes:r.changes}:undefined
    const create=(count:number,old?:Lookup)=>Reflect.apply(createIndirectVolumeLookup,undefined,[field,visibility,count,reusable(old)]) as Lookup
    const volume=create(field.volume.rows*field.volume.n,previous?.volume),floor=create(field.floors.length*field.floorLayer.n**2,previous?.floor),result=new Float64Array(field.coefficientCount*3)
    previous?.field.dispose();previous?.visibility.dispose();previous=undefined
    at=performance.now();for(let row=0;row<field.volume.rows;row++)writeIndirectVolumeRow(field,row,result,visibility,volume,true);const volumeVisibilityMs=performance.now()-at
    at=performance.now();for(let row=0;row<field.floors.length*field.floorLayer.n;row++)writeIndirectFloorRow(field,row,visibility,floor,true);const floorVisibilityMs=performance.now()-at
    const evaluations=[]
    for(let pass=0;pass<6;pass++){
      at=performance.now();volume.refreshCoefficients();floor.refreshCoefficients();const decodeMs=performance.now()-at
      at=performance.now();for(let row=0;row<field.volume.rows;row++)writeIndirectVolumeRow(field,row,result,visibility,volume);const volumeMs=performance.now()-at
      at=performance.now();writeIndirectFloorLayer(field,visibility,floor);const floorMs=performance.now()-at
      evaluations.push({decodeMs,volumeMs,floorMs})
    }
    const measuredMs=performance.now()-began
    let verification
    if(r.verify){
      const oldVolume=field.volume.data.slice(),oldFloor=field.floorLayer.data.slice(),freshVolume=createIndirectVolumeLookup(field,visibility),freshFloor=createIndirectVolumeLookup(field,visibility,field.floors.length*field.floorLayer.n**2),started=performance.now()
      freshVolume.refreshCoefficients();freshFloor.refreshCoefficients();for(let row=0;row<field.volume.rows;row++)writeIndirectVolumeRow(field,row,result,visibility,freshVolume);writeIndirectFloorLayer(field,visibility,freshFloor)
      let different=0;for(let i=0;i<oldVolume.length;i++)if(oldVolume[i]!==field.volume.data[i])different++;for(let i=0;i<oldFloor.length;i++)if(oldFloor[i]!==field.floorLayer.data[i])different++
      verification={differentHalfFloatValues:different,values:oldVolume.length+oldFloor.length,ms:performance.now()-started}
    }
    previous={field,visibility,volume,floor}
    self.postMessage({ok:true,geometryMs,volumeVisibilityMs,floorVisibilityMs,evaluations,measuredMs,volume:volume.statistics(),floor:floor.statistics(),verification,dimensions:{volumeN:field.volume.n,volumeCells:field.volume.rows*field.volume.n,floorN:field.floorLayer.n,floorCells:field.floors.length*field.floorLayer.n**2,probes:field.probes.length}})
  }catch(error){field.dispose();visibility.dispose();self.postMessage({ok:false,error:String(error)})}
}
