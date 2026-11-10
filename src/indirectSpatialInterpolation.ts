import {Vector3} from 'three'
import type {IndirectField} from './indirectLighting.ts'
import type {IndirectVisibility} from './indirectVisibility.ts'
import {INDIRECT_MASK_SIZE} from './indirectLighting.ts'

export type IndirectSpatialInterpolation='legacy'|'occluder-local'
/** Experimental only: retain the current transport unless explicitly requested. */
export function requestedIndirectSpatialInterpolation():IndirectSpatialInterpolation{
 return typeof location!=='undefined'&&new URLSearchParams(location.search).get('giSpatial')==='occluder-local'?'occluder-local':'legacy'
}
const origin=new Vector3(),up=new Vector3(0,1,0)
/** Floors under a nearby opaque underside need local radiance. A structural
 * ceiling, wall, open doorway or unoccluded floor does not enable this rule. */
export function indirectLocalFloorReceiver(field:IndirectField,visibility:Pick<IndirectVisibility,'hit'>,floor:number,x:number,y:number,z:number){
 const mx=Math.max(0,Math.min(INDIRECT_MASK_SIZE-1,Math.floor((x-field.bounds.minX)/field.bounds.size*INDIRECT_MASK_SIZE))),mz=Math.max(0,Math.min(INDIRECT_MASK_SIZE-1,Math.floor((z-field.bounds.minZ)/field.bounds.size*INDIRECT_MASK_SIZE)))
 const mask=field.mask.image.data as Uint8Array,m=((floor*INDIRECT_MASK_SIZE+mz)*INDIRECT_MASK_SIZE+mx)*4,range=field.ranges[floor]
 if(!mask[m])return false
 const ceiling=range.bottom+(mask[m+1]*256+mask[m+2])/65535*(range.top-range.bottom)
 const distance=Math.min(1.6,ceiling-y-.1)
 if(distance<=.025)return false
 origin.set(x,y,z)
 const hit=visibility.hit(origin,up,distance)
 return !!hit?.face&&hit.face.normal.y<-.5
}
/** Inverse squared distance regularised over 15 cm. This reweights valid
 * measurements; it adds no ambient light and never substitutes for visibility. */
export function indirectLocalWeight(distanceSquared:number){return 1/(distanceSquared+.15**2)}
