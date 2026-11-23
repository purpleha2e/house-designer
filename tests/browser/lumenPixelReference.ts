import type { RootState } from '@react-three/fiber'
import { Vector3, WebGLRenderer } from 'three'
import { snapshotReferenceScene } from '../../src/diffuseSceneSnapshot'
import { createSceneLightingReference } from '../sceneLightingReference'
import type { LumenOpening } from '../../src/lumenSkyVisibility'
import { createReferenceGlazing } from './lumenReferenceGlazing'

/** Test-only oracle. Trace the unsimplified meshes in diffuse scene-linear
 * space at the very same receivers reported by the GPU. */
export async function checkLumenPixels(s:RootState,pixels:Record<string,Record<string,number[]>>,authoredGlazing=false){
  const gl=new WebGLRenderer()
  const snapshot=await snapshotReferenceScene({scene:s.scene,gl},m=>m.userData.houseDesignerRole==='ground-plane'?3:0,{diffusePbr:true}).finally(()=>{gl.dispose();gl.forceContextLoss()})
  const glass=authoredGlazing?createReferenceGlazing(s.scene,s.camera):undefined
  const model=createSceneLightingReference(snapshot.data,glass?.transmit)
  try{
    return Object.fromEntries(Object.entries(pixels).map(([name,sample])=>{
      const estimate=sample.receiverPositionMaterial.slice(0,3)
      if(sample.receiverPositionMaterial[3]<0)return [name,{missing:true}]
      // Reconstruct the same camera ray against triangles. A submillimetre
      // depth-buffer error can put the sampled point inside a sill or reveal.
      const hit=model.visibleReceiver(s.camera.position.toArray(),estimate)
      if(!hit || hit.distanceToEstimate>.02)return [name,{unmatched:true,hit}]
      const {position,normal}=hit
      const r=model.evaluate({name,position,normal,geometricNormal:normal},16384,8,1234,9,false,true)
      const radiance=(values:number[])=>values.map((v,c)=>v*hit.rho[c]/Math.PI)
      const byOrder=r.byOrder!.map(row=>({sky:radiance(row.sky),solar:radiance(row.solar),exteriorGround:radiance(row.exteriorGround)}))
      const apertures=(s.scene.userData.lumenOptions?.openings as LumenOpening[]|undefined)?.map(opening=>{
        const origin=new Vector3().fromArray(position).addScaledVector(new Vector3().fromArray(normal),.0002)
        const axis=new Vector3().fromArray(opening.u),offset=opening.exteriorOffset??0
        const center=new Vector3().fromArray(opening.center).addScaledVector(new Vector3(-axis.z,0,axis.x),offset)
        const rays=[]
        for(const v of [-.3,0,.3])for(const u of [-.3,0,.3]){
          const delta=center.clone().addScaledVector(axis,u*opening.width).sub(origin)
          delta.y+=v*opening.height
          rays.push({distance:delta.length(),direction:delta.normalize().toArray()})
        }
        const hits=model.incoming(origin.toArray(),rays.map(ray=>ray.direction),1,0,1234,true)
        return {center:center.toArray(),width:opening.width,height:opening.height,
          clear:hits.filter((trace,i)=>!trace.firstHit || trace.firstHit.distance>rays[i].distance+.002).length,
          samples:rays.length}
      })
      return [name,{hit,byOrder,apertures,directSky:radiance(r.sky),indirect:radiance(r.reflected),solar:radiance(r.direct),skyError:radiance(r.skyStandardError),
        indirectError:radiance(r.reflectedStandardError),samples:r.samples,triangles:snapshot.triangles,glazingPanes:glass?.count}]
    }))
  }finally{model.dispose();glass?.dispose()}
}
