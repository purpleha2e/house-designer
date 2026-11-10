import {Data3DTexture} from 'three'
/** Display-only artistic control. Transport and persistent bake keys exclude it. */
export function normalizeSunBounceStrength(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(4, Math.round(value * 4) / 4)) : 1
}

/** Keep the difference signed; clamp only the final irradiance at shading. */
export function sunBounceIrradiance(full: readonly number[], sunOff: readonly number[], strength: number) {
  if (strength === 1) return [...full]
  return full.map((value, i) => Math.max(0, sunOff[i] + strength * (value - sunOff[i])))
}

/** Pack along Y inside each Z slice, preserving native trilinear sampling.
 * Both coefficient slabs use the existing samplers, including 16-unit GPUs. */
export function packSunBounceTexture(full:Data3DTexture,sunOff:Data3DTexture){
  const a=full.image,b=sunOff.image
  if(a.width!==b.width||a.height!==b.height||a.depth!==b.depth)throw Error('Sun bounce texture layouts differ')
  const input=a.data as Uint16Array,other=b.data as Uint16Array,data=new Uint16Array(input.length*2),slice=a.width*a.height*4
  for(let z=0;z<a.depth;z++){data.set(input.subarray(z*slice,(z+1)*slice),z*slice*2);data.set(other.subarray(z*slice,(z+1)*slice),z*slice*2+slice)}
  const texture=new Data3DTexture(data,a.width,a.height*2,a.depth)
  texture.type=full.type;texture.format=full.format;texture.colorSpace=full.colorSpace;texture.minFilter=full.minFilter;texture.magFilter=full.magFilter;texture.unpackAlignment=full.unpackAlignment;texture.generateMipmaps=false;texture.needsUpdate=true
  return texture
}
