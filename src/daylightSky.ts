import { Color, CubeTexture, DataTexture, FloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat, Vector3, type DirectionalLight } from 'three'

export type DaylightSkyMode = 'clear'|'overcast'
export const DAYLIGHT_TRANSPORT_VERSION = 4
export type DaylightSkyPurpose = 'exterior' | 'transport'
/** Preserve the pre-shadow-styling sky budget for indoor bounce lighting. */
export function daylightTransportSkyBase(target = new Vector3()) {
  return target.set(.65, .72, .82)
}
function daylightBlend(elevation:number,high=.55) {
  const t=Math.max(0,Math.min(1,(elevation-.08)/(high-.08)))
  return t*t*(3-2*t)
}
/** An art-directed linear sky palette: cool daylight, muted violet twilight,
 * and neutral cloud. Exterior display only; indoor transport has its own budget. */
export function daylightSkyBase(mode:DaylightSkyMode='clear',elevation=Math.PI/2,target=new Vector3()) {
  const t=daylightBlend(elevation)
  return mode==='overcast'?target.setScalar(.32+.40*t):target.set(.24+.41*t,.225+.495*t,.28+.54*t)
}
export function daylightSunElevation(sun?:DirectionalLight|null) {
  if(!sun)return Math.PI/2
  return sun.userData.daylightElevation??Math.asin(Math.max(-1,Math.min(1,
    (sun.position.y-sun.target.position.y)/Math.max(.001,sun.position.distanceTo(sun.target.position)))))
}
export function daylightSunAppearance(elevation:number,mode:DaylightSkyMode='clear') {
  return {
    color:mode==='overcast'?new Color('white'):new Color('#ff5a2f').lerp(new Color('#fff8ee'),daylightBlend(elevation)),
    // Dense cloud leaves only a small directional component; sky supplies the fill.
    intensity:(.55+daylightBlend(elevation,.42)*.75)*(mode==='overcast'?.06:1),
  }
}
/** The offline PMREM bases were generated with this original linear RGB. */
export function daylightSkyBasisScale(mode:DaylightSkyMode,elevation=Math.PI/2) {
  return daylightSkyBase(mode,elevation).divide(new Vector3(.65,.72,.82))
}
/** Scene-relative linear radiance, not photometric lux. Upper-hemisphere mean
 * equals the original sky budget; directionality changes without a brightness multiplier. */
export function daylightSkyRadiance(direction:Vector3,mode:DaylightSkyMode='clear',strength=1,sunIrradiance=new Vector3(),elevation=Math.PI/2,purpose:DaylightSkyPurpose='exterior') {
  const base=(purpose==='transport'?daylightTransportSkyBase():daylightSkyBase(mode,elevation)).multiplyScalar(strength)
  if(direction.y>=0)return base.multiplyScalar(mode==='overcast'?.5+direction.y:.6+.8*direction.y)
  // Lambertian ground, reflectance .2. This is visible only on escaped rays,
  // never a uniform receiver fill. Explicit captured exterior geometry wins.
  return base.multiplyScalar(mode==='overcast'?7/6:17/15).addScaledVector(sunIrradiance,1/Math.PI).multiplyScalar(.2)
}
export const daylightSkyGLSL=/* glsl */`
uniform float hdSkyMode;
uniform vec3 hdSkySunIrradiance;
vec3 hdSkyRadiance(vec3 direction,vec3 base) {
  if(hdSkyMode<.5)return base; // Legacy analytic regression fixtures.
  if(direction.y<0.0)return (base*(hdSkyMode>1.5?7.0/6.0:17.0/15.0)+hdSkySunIrradiance/3.14159265)*.2;
  return base*(hdSkyMode>1.5?.5+direction.y:.6+.8*direction.y);
}
`
export const daylightSkyIrradianceGLSL=/* glsl */`
vec3 hdSkyDiffuseIrradiance(vec3 normal,vec3 base,vec3 sunIrradiance){
  float y=clamp(normal.y,-1.0,1.0),a=hdSkyMode>1.5?.5:.6,b=hdSkyMode>1.5?1.0:.8;
  float product=(2.0/3.0)*(sqrt(max(0.0,1.0-y*y))+(3.14159265-acos(y))*y);
  vec3 ground=hdSkyMode<.5?base:(base*(hdSkyMode>1.5?7.0/6.0:17.0/15.0)+sunIrradiance/3.14159265)*.2;
  return base*(a*3.14159265*(1.0+y)*.5+b*product)+ground*(3.14159265*(1.0-y)*.5);
}
vec3 hdSkyDiffuseIrradiance(vec3 normal,vec3 base){return hdSkyDiffuseIrradiance(normal,base,hdSkySunIrradiance);}
`
/** Small linear HDR cube shared by probe backgrounds and capture transport. */
export function createDaylightSky(size=16,purpose:DaylightSkyPurpose='exterior') {
  const faces=Array.from({length:6},()=>new DataTexture(new Float32Array(size*size*4),size,size,RGBAFormat,FloatType))
  const texture=new CubeTexture(faces);texture.type=FloatType;texture.format=RGBAFormat;texture.colorSpace=LinearSRGBColorSpace
  texture.minFilter=texture.magFilter=LinearFilter;texture.generateMipmaps=false
  const direction=new Vector3(),sun=new Vector3()
  let previous=''
  return {texture,update(mode:DaylightSkyMode,strength:number,sunIrradiance?:Vector3,elevation=Math.PI/2){
    sun.copy(sunIrradiance??new Vector3());const key=JSON.stringify([mode,strength,...sun,elevation]);if(key===previous)return;previous=key
    faces.forEach((face,index)=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const col=(x+.5)/size*2-1,row=1-(y+.5)/size*2
      if(index===0)direction.set(1,row,-col);else if(index===1)direction.set(-1,row,col);else if(index===2)direction.set(col,1,-row)
      else if(index===3)direction.set(col,-1,row);else if(index===4)direction.set(col,row,1);else direction.set(-col,row,-1)
      const value=daylightSkyRadiance(direction.normalize(),mode,strength,sun,elevation,purpose),data=face.image.data as Float32Array
      value.toArray(data,(x+y*size)*4);data[(x+y*size)*4+3]=1
    }})
    texture.needsUpdate=true
  },dispose(){texture.dispose();faces.forEach(face=>face.dispose())}}
}
