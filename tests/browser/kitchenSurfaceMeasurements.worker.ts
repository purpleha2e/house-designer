import {indirectSHIrradianceBasis} from '../../src/indirectSH'
import {DataUtils,Vector3} from 'three'
import {restoreIndirectField,INDIRECT_MASK_SIZE} from '../../src/indirectLighting'
import {INDIRECT_VOLUME_HEIGHT,INDIRECT_VOLUME_STRIDE} from '../../src/indirectVolume'
import {createIndirectVisibilityFromSnapshot} from '../../src/indirectVisibility'

// Inspection worker only: no renderer, mutations of the live field, or captures.
self.onmessage=({data:r})=>{
  const field=restoreIndirectField(r.field),visibility=createIndirectVisibilityFromSnapshot(r.geometry),start=performance.now()
  try{
    const p=new Vector3(),d=new Vector3(),origin=new Vector3()
    const links=(point:Vector3,radiusFactor=1.75,power=2)=>{
      const radius2=(field.spacing*radiusFactor)**2
      const candidates=field.probes.flatMap(probe=>{p.fromArray(field.positionData,probe.index*4);d.subVectors(point,p);const distance2=d.lengthSq();if(distance2>=radius2||field.positionData[probe.index*4+3]<.5)return[];const distance=Math.sqrt(distance2),visible=distance<.026||!visibility.occluded(p,d.multiplyScalar(1/distance),distance-.001);return[{index:probe.index,distance,kernel:(1-distance2/radius2)**power,visibility:visible?1:0}]})
      const support=candidates.reduce((v,p)=>v+p.kernel*p.visibility,0)
      return{support,probes:candidates.map(p=>({...p,weight:support?p.kernel*p.visibility/support:0}))}
    }
    const results=r.points.map((point:{name:string;position:number[];normal:number[];samplePosition:number[];floor:number;floorReceiver:boolean})=>{
      const s=new Vector3().fromArray(point.samplePosition),n=new Vector3().fromArray(point.normal).normalize()
      const floor=point.floor>=0?point.floor:Math.max(0,field.floors.findLastIndex(f=>point.position[1]>=f.elevation)),range=field.ranges[floor]
      const layer=point.floorReceiver,count=layer?field.floorLayer.n:field.volume.n
      const x=Math.max(0,Math.min(1,(s.x-field.bounds.minX)/field.bounds.size))*(count-1),z=Math.max(0,Math.min(1,(s.z-field.bounds.minZ)/field.bounds.size))*(count-1)
      const y=layer?0:Math.max(0,Math.min(1,(s.y-range.bottom)/(range.top-range.bottom)))*(INDIRECT_VOLUME_HEIGHT-1)
      const corners=[];const effective=new Map<number,number>();let coverage=0
      for(let dz=0;dz<2;dz++)for(let dy=0;dy<(layer?1:2);dy++)for(let dx=0;dx<2;dx++){
        const weight=(dx?x%1:1-x%1)*(dz?z%1:1-z%1)*(layer?1:dy?y%1:1-y%1)
        if(weight<=0)continue
        const ix=Math.min(count-1,Math.floor(x)+dx),iz=Math.min(count-1,Math.floor(z)+dz),iy=Math.floor(y)+dy
        const wx=field.bounds.minX+ix/(count-1)*field.bounds.size,wz=field.bounds.minZ+iz/(count-1)*field.bounds.size
        const mx=Math.min(INDIRECT_MASK_SIZE-1,Math.floor(ix/(count-1)*INDIRECT_MASK_SIZE)),mz=Math.min(INDIRECT_MASK_SIZE-1,Math.floor(iz/(count-1)*INDIRECT_MASK_SIZE)),offset=((floor*INDIRECT_MASK_SIZE+mz)*INDIRECT_MASK_SIZE+mx)*4
        const mask=field.mask.image.data as Uint8Array,ceiling=range.bottom+(mask[offset+1]*256+mask[offset+2])/65535*(range.top-range.bottom)
        const wy=layer?field.floors[floor].elevation+.016:Math.max(field.floors[floor].elevation+.06,mask[offset]?Math.min(range.bottom+iy/(INDIRECT_VOLUME_HEIGHT-1)*(range.top-range.bottom),ceiling-.06):range.bottom+iy/(INDIRECT_VOLUME_HEIGHT-1)*(range.top-range.bottom))
        const l=links(new Vector3(wx,wy,wz)),confidence=layer?Math.min(1,l.support/.1):1,valid=point.floor>=0&&(!layer||!!mask[offset])
        if(valid&&l.support>0){coverage+=weight;for(const probe of l.probes)effective.set(probe.index,(effective.get(probe.index)??0)+weight*probe.weight*confidence)}
        corners.push({position:[wx,wy,wz],trilinearWeight:weight,valid,support:l.support,confidence,probes:l.probes})
      }
      const weights=[...effective].map(([index,weight])=>({index,weight:weight/Math.max(coverage,1e-5)})).filter(p=>p.weight>0).sort((a,b)=>b.weight-a.weight)
      // Independent cosine-weighted direct sky integral over the actual scene
      // triangles. No SH, probe interpolation or production sky function used.
      const sky=[0,0,0],samples=8192,position=new Vector3().fromArray(point.position).addScaledVector(n,.004),tangent=new Vector3().crossVectors(Math.abs(n.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0),n).normalize(),bitangent=new Vector3().crossVectors(n,tangent)
      let escaped=0
      for(let i=0;i<samples;i++){
        const u=(i+.5)/samples,v=(i*.6180339887498949)%1,rad=Math.sqrt(u),angle=2*Math.PI*v
        d.copy(n).multiplyScalar(Math.sqrt(1-u)).addScaledVector(tangent,rad*Math.cos(angle)).addScaledVector(bitangent,rad*Math.sin(angle))
        if(visibility.hit(position,d,80,.002))continue
        escaped++;for(let c=0;c<3;c++)sky[c]+=Math.PI*(d.y>=0?r.skyBase[c]*(r.skyMode==='overcast'?.5+d.y:.6+.8*d.y):.2*(r.skyBase[c]*(r.skyMode==='overcast'?7/6:17/15)+r.skySun[c]/Math.PI))/samples
      }
      origin.fromArray(point.position).addScaledVector(n,.004);d.fromArray(r.sun.direction)
      const sunVisible=!visibility.hit(origin,d,80,.002),sunCosine=Math.max(0,n.dot(d))
      const variants=r.skyCoefficients?[[1.75,2],[1.75,4],[1.5,2],[1.25,2],[1,2]].map(([radiusFactor,power])=>{
        const began=performance.now(),coefficients=new Float64Array(3*field.coefficientCount),indices=new Set<number>();let supportCoverage=0,candidateLinks=0
        for(const corner of corners){
          if(!corner.valid)continue
          const l=links(new Vector3(...corner.position as [number,number,number]),radiusFactor,power);candidateLinks+=l.probes.length
          if(l.support<=0)continue
          supportCoverage+=corner.trilinearWeight
          const confidence=layer?Math.min(1,l.support/.1):1
          for(const probe of l.probes){if(!probe.weight)continue;indices.add(probe.index)
            for(let c=0;c<3;c++)for(let k=0;k<field.coefficientCount;k++)coefficients[c*field.coefficientCount+k]+=DataUtils.fromHalfFloat(r.skyCoefficients[c][probe.index*field.coefficientCount+k])*probe.weight*corner.trilinearWeight*confidence
          }
        }
        const basis=indirectSHIrradianceBasis(n,field.shOrder),rgb=[0,1,2].map(c=>Math.max(0,basis.reduce((v,b,k)=>v+b*coefficients[c*field.coefficientCount+k],0)/Math.max(1e-5,supportCoverage)))
        return{radiusFactor,power,rgb,coverage:supportCoverage,effectiveProbes:indices.size,candidateLinks,inspectionMs:performance.now()-began,absoluteError:rgb.map((v,c)=>Math.abs(v-sky[c]))}
      }):undefined
      const basis=indirectSHIrradianceBasis(n,field.shOrder)
      const skyBrightness=r.skyCoefficients?weights.map(probe=>({weight:probe.weight,value:[0,1,2].reduce((sum,c)=>sum+[.2126,.7152,.0722][c]*Math.max(0,basis.reduce((v,b,k)=>v+b*DataUtils.fromHalfFloat(r.skyCoefficients[c][probe.index*field.coefficientCount+k]),0)),0)})):[]
      const meanSky=skyBrightness.reduce((sum,p)=>sum+p.value*p.weight,0),varianceSky=skyBrightness.reduce((sum,p)=>sum+(p.value-meanSky)**2*p.weight,0)
      return{probeSkyCoefficientOfVariation:Math.sqrt(varianceSky)/Math.max(.00001,meanSky),name:point.name,receiverHasGI:point.floor>=0,corners,coverage,effectiveProbeWeights:weights,weightSum:weights.reduce((v,p)=>v+p.weight,0),referenceSky:{rgb:sky,samples,escaped,method:'independent cosine integration of escaped scene rays'},spatialVariants:variants,referenceDirectSun:{visible:sunVisible,rgb:r.sun.color.map((v:number)=>v*r.sun.intensity*sunCosine*(sunVisible?1:0))}}
    })
    self.postMessage({ok:true,results,inspectionMs:performance.now()-start,dimensions:{volumeN:field.volume.n,volumeRows:field.volume.rows,volumeCells:field.volume.rows*field.volume.n,volumeSlabs:INDIRECT_VOLUME_STRIDE,floorN:field.floorLayer.n,floorCells:field.floors.length*field.floorLayer.n**2,probes:field.probes.length}})
  }catch(error){self.postMessage({ok:false,error:String(error)})}finally{visibility.dispose();field.dispose()}
}
