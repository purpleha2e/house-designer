import {DataUtils,Vector3} from 'three'

/** PMREM filtering is linear in incoming radiance. The offline base contains
 * sky plus sky-lit ground; the unit ground basis contains only sun-lit ground.
 * Combine in linear HDR before half-float quantization, preserving sky energy. */
export function daylightEnvironmentPixels(base:Uint16Array,ground:Uint16Array,sun:Vector3,skyStrength=1){
  if(base.length!==ground.length)throw Error('Mismatched daylight environment basis')
  const pixels=new Uint16Array(base.length)
  for(let i=0;i<base.length;i+=4){
    const g=DataUtils.fromHalfFloat(ground[i])
    pixels[i]=DataUtils.toHalfFloat(DataUtils.fromHalfFloat(base[i])*skyStrength+g*sun.x)
    pixels[i+1]=DataUtils.toHalfFloat(DataUtils.fromHalfFloat(base[i+1])*skyStrength+g*sun.y)
    pixels[i+2]=DataUtils.toHalfFloat(DataUtils.fromHalfFloat(base[i+2])*skyStrength+g*sun.z)
    pixels[i+3]=base[i+3]
  }
  return pixels
}
