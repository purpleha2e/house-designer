import { Quaternion, Euler } from 'three'
const pose=(position,yaw,pitch,fov)=>({position,quaternion:new Quaternion().setFromEuler(new Euler(pitch,yaw,0,'YXZ')).toArray(),fov})
export const roomViews={
  room:pose([2.87638,1.44840,5.99908],.601806,-.085481,40.04864),
  window:pose([2.25,1.5,3.7],1.42,.015,58),
  doors:pose([1.75,1.48,4.65],.015,-.035,58),
  doorway:pose([6.6,1.48,4.35],2.09,-.035,65),
  stairwell:pose([11.09,3.3,8.8],0,.12,65),
  sunlitFloor:pose([10.26,4.2,8.55],0,-.35,58),
  landing:{position:[10.25,4.2,7.1],quaternion:[.0035003484906196204,.9948653768470955,.09413951139722264,-.036991646424873945],fov:60}
}
