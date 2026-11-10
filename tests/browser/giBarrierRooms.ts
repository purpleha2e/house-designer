import type {RootState} from '@react-three/fiber'
import {createIndirectVisibility} from '../../src/indirectVisibility'
import {buildBarrierMetadata} from '../giBarrierGeometry'
import {spatialFixture} from './giSpatialExperiments.ts'
import {barrierReceivers} from './giBarrierReceivers'
import type {ReferenceReceiver} from '../sceneLightingReference'

export function barrierRoom(kind:string){return spatialFixture(kind,'table',false,async(s:RootState,points:ReferenceReceiver[])=>{
 const field=s.scene.userData.getLightingField(),visibility=createIndirectVisibility(s.scene)
 try{const metadata=await buildBarrierMetadata(field,visibility.snapshot()),readings=await barrierReceivers(s,{id:1,a:metadata.a,b:metadata.b,statistics:metadata.statistics},points);return{statistics:metadata.statistics,readings,controls:{probes:field.probes.length,shOrder:field.shOrder,fill:s.scene.userData.getIndirectUniforms().hdGIIndoorFill.value,passes:6,spatial:field.spatialInterpolation}}}finally{visibility.dispose()}
})}
