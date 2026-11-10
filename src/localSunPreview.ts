import type {SunMaterial} from './localSunTransport.ts'
import {Data3DTexture,DataUtils,HalfFloatType,Vector4} from 'three'
import type {Vector3} from 'three'
import type {IndirectVisibility} from './indirectVisibility.ts'

export type LocalSunPreviewData={positions:Float32Array;normals:Float32Array;uvs:Float32Array;materialIndices:Uint16Array;owners:Uint32Array;materials:(SunMaterial&{shadowSide?:0|1|2;flatShading?:boolean})[];textures:{width:number;height:number;pixels:Uint16Array}[];sunDirection:number[];sunIrradiance:number[];daylightGain:number}
export type LocalSunPreviewCamera={world:number[];projectionInverse:number[];width:number;height:number;rays:number;visibleTriangles?:Uint8Array}
export const LOCAL_SUN_PREVIEW_BUDGET={maxDimension:96,rays:64,maxTextureSide:256,maxTextureBytes:16*1024*1024} as const
export function localSunCameraKey(world:readonly number[],projection:readonly number[],width:number,height:number){return JSON.stringify([world,projection,width,height])}
/** Navigation-hidden roofs/walls still block bounce rays. Only the camera ray
 * skips them, using the current viewport's visibility at each new view. */
export function traceLocalSunPrimary(query:Pick<IndirectVisibility,'hit'>,origin:Vector3,direction:Vector3,visible?:Uint8Array){
 let near=.0001
 for(let i=0;i<128;i++){
  const hit=query.hit(origin,direction,80,near);if(!hit)return null
  if(!visible||visible[Math.floor(hit.face!.a/3)]===1)return hit
  near=hit.distance+.000001
 }
 throw Error('Too many camera-hidden surface layers')
}

/** Append screen samples behind a duplicate edge slice. The original volume's
 * coordinates remain exact after Z scaling; no extra GPU sampler is needed. */
export function packLocalSunPreview(source:Data3DTexture,image:Float32Array,normals:Float32Array){
  if(source.type!==HalfFloatType||image.length!==normals.length||image.length%4)throw Error('Unsupported local sunlight texture layout')
  const {width,height,depth}=source.image,slice=width*height*4,extra=Math.ceil(image.length*2/slice),newDepth=depth+1+extra,start=(depth+1)*slice
  const original=source.image.data as Uint16Array,data=new Uint16Array(slice*newDepth)
  data.set(original);data.set(original.subarray((depth-1)*slice,depth*slice),depth*slice)
  for(let i=0;i<image.length;i++){data[start+i]=DataUtils.toHalfFloat(image[i]);data[start+image.length+i]=DataUtils.toHalfFloat(normals[i])}
  const texture=new Data3DTexture(data,width,height,newDepth);texture.type=source.type;texture.format=source.format;texture.colorSpace=source.colorSpace;texture.minFilter=source.minFilter;texture.magFilter=source.magFilter;texture.unpackAlignment=source.unpackAlignment;texture.generateMipmaps=false;texture.needsUpdate=true
  return{texture,scale:depth/newDepth,layout:new Vector4(width,height,start/4,newDepth)}
}

/** A screen sample may only shade the same visible surface. Depth and normal
 * rejection prevent a bright duvet sample from bleeding onto a wall edge. */
export const localSunPreviewGLSL=/* glsl */`
#ifdef HD_LOCAL_SUN_PREVIEW
uniform float hdLocalSunReady,hdLocalSunDisplay,hdLocalSunCombined;
uniform vec2 hdLocalSunSize;
uniform mat4 hdLocalSunViewProjection;
uniform vec4 hdLocalSunPackedSize;
vec4 hdLocalSunTexel(float index){
  float plane=hdLocalSunPackedSize.x*hdLocalSunPackedSize.y;
  float z=floor(index/plane),within=mod(index,plane);
  return texelFetch(hdGIVolume,ivec3(int(mod(within,hdLocalSunPackedSize.x)),int(floor(within/hdLocalSunPackedSize.x)),int(z)),0);
}
vec4 hdLocalSunIrradiance(vec3 normal,vec3 position){
  // Projection is independent of DPR and the compositor's render-target size.
  vec4 clip=hdLocalSunViewProjection*vec4(position,1.);
  vec2 pixel=(clip.xy/clip.w*.5+.5)*hdLocalSunSize-.5;
  vec3 total=vec3(0.);float weights=0.;
  float depth=-vViewPosition.z;
  // vViewPosition is camera minus surface in Three's standard shader.
  depth=abs(depth);
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    vec2 cell=floor(pixel)+vec2(float(x),float(y));
    cell=clamp(cell,vec2(0.),hdLocalSunSize-1.);
    float index=hdLocalSunPackedSize.z+cell.y*hdLocalSunSize.x+cell.x;
    vec4 sampleValue=hdLocalSunTexel(index);
    vec4 sampleNormal=hdLocalSunTexel(index+hdLocalSunSize.x*hdLocalSunSize.y);
    float tolerance=max(.015,depth*3./min(hdLocalSunSize.x,hdLocalSunSize.y));
    if(sampleNormal.a>.5&&abs(sampleValue.a-depth)<tolerance&&dot(sampleNormal.xyz,normal)>.95){
      vec2 w=mix(1.-fract(pixel),fract(pixel),vec2(float(x),float(y)));
      float weight=w.x*w.y;total+=sampleValue.rgb*weight;weights+=weight;
    }
  }
  return weights>0.?vec4(total/weights,1.):vec4(0.);
}
#endif
`
