import { daylightSkyGLSL } from './daylightSky.ts'
export const fastGIRayCount = 96

export const fastVolumeGLSL = /* glsl */ `
uniform float n;
uniform vec3 volumeMin, volumeSize;
vec2 voxelUV(vec3 c) { return (vec2(c.x + c.z * n, c.y) + .5) / vec2(n*n, n); }
#ifndef HD_FAST_VERTEX
vec3 voxelCell() { float x = floor(gl_FragCoord.x); return vec3(mod(x,n), mod(floor(gl_FragCoord.y),n), floor(x/n)); }
#endif
bool inside(vec3 c) { return all(greaterThanEqual(c,vec3(0.0))) && all(lessThan(c,vec3(n))); }
`
export const fastSplatVertex = /* glsl */ `
#define HD_FAST_VERTEX
uniform sampler2D captureDepth, captureNormal, captureRadiance, captureResponse;
uniform mat4 inverseVP[HD_FAST_MAX_VIEWS];
uniform float captureSize;
${fastVolumeGLSL}
out vec3 sampleRadiance, sampleNormal, sampleResponse;
void main() {
  int size = int(captureSize), viewIndex = gl_VertexID / (size*size), pixel = gl_VertexID % (size*size);
  vec2 uv = (vec2(float(pixel % size),float(pixel / size))+.5)/captureSize;
  vec2 atlasUV = (uv + vec2(float(viewIndex % 4),float(viewIndex / 4))) / vec2(4.0, float(HD_FAST_CAPTURE_ROWS));
  float depth = texture(captureDepth,atlasUV).r;
  sampleNormal = texture(captureNormal,atlasUV).xyz;
  sampleRadiance = texture(captureRadiance,atlasUV).rgb;
  sampleResponse = texture(captureResponse,atlasUV).rgb;
  vec4 world = inverseVP[viewIndex] * vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
  vec3 c = floor((world.xyz/world.w-volumeMin)/volumeSize*n);
  gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 1.0;
  if (depth >= 1.0 || length(sampleNormal)<.5 || !inside(c)) return;
  vec3 a = abs(sampleNormal);
  float axis = a.x >= a.y && a.x >= a.z ? 0.0 : a.y >= a.z ? 1.0 : 2.0;
  float signValue = axis < .5 ? sampleNormal.x : axis < 1.5 ? sampleNormal.y : sampleNormal.z;
  float band = axis*2.0 + (signValue < 0.0 ? 1.0 : 0.0);
  vec2 outputUV = voxelUV(c); outputUV.y = (outputUV.y+band)/6.0;
  gl_Position = vec4(outputUV*2.0-1.0,0.0,1.0);
}
`
export const fastSplatFragment = /* glsl */ `
in vec3 sampleRadiance, sampleNormal, sampleResponse;
layout(location=0) out vec4 radianceSum;
layout(location=1) out vec4 normalSum;
layout(location=2) out vec4 responseSum;
void main() { radianceSum=vec4(sampleRadiance,1.0); normalSum=vec4(sampleNormal,1.0); responseSum=vec4(sampleResponse,1.0); }
`
export const fastStateFragment = /* glsl */ `
${fastVolumeGLSL}
uniform sampler2D surfaceRadiance, geometryOccupancy, captureDepth;
uniform mat4 vp[HD_FAST_MAX_VIEWS];
#ifndef HD_FAST_STOREY
uniform mat4 inverseVP[HD_FAST_MAX_VIEWS];
#endif
uniform vec3 eyes[HD_FAST_MAX_VIEWS];
uniform int captureViews;
uniform float hybrid;
void main() {
  vec3 c = voxelCell(); vec2 uv = voxelUV(c);
  float count = 0.0;
  for(int band=0;band<6;band++) count += texture2D(surfaceRadiance,vec2(uv.x,(uv.y+float(band))/6.0)).a;
  float occupied = count > .0 ? 1.0 : 0.0;
  int axes = hybrid > .5 ? int(round(texture2D(geometryOccupancy,uv).r * 255.0)) : 0;
  if (axes != 0) occupied = 1.0;
  vec3 world = volumeMin + (c+.5)/n*volumeSize;
  float empty = 0.0;
  if(occupied < .5) for(int viewIndex=0;viewIndex<HD_FAST_MAX_VIEWS;viewIndex++) {
    if(viewIndex>=captureViews) break;
    vec4 clip = vp[viewIndex]*vec4(world,1.0);
    vec2 viewUV = clip.xy/clip.w*.5+.5;
    if(clip.w <= 0.0 || any(lessThan(viewUV,vec2(0.0))) || any(greaterThan(viewUV,vec2(1.0)))) continue;
    vec2 captureUV = (viewUV+vec2(float(viewIndex%4),float(viewIndex/4)))/vec2(4.0,float(HD_FAST_CAPTURE_ROWS));
    float depth = texture2D(captureDepth,captureUV).r;
    #ifdef HD_FAST_STOREY
      // Project a point a cell farther back along this ray. Comparing depth
      // there makes the conservative air test without a second matrix array.
      vec3 direction = world - eyes[viewIndex];
      vec3 farther = world + direction * (length(volumeSize/n) / max(length(direction), .0001));
      vec4 beyond = vp[viewIndex] * vec4(farther, 1.0);
      if (depth > beyond.z / beyond.w * .5 + .5) { empty=1.0; break; }
    #else
      vec4 hit = inverseVP[viewIndex]*vec4(viewUV*2.0-1.0,depth*2.0-1.0,1.0);
      if(distance(world,eyes[viewIndex])+length(volumeSize/n) < distance(hit.xyz/hit.w,eyes[viewIndex])) { empty=1.0; break; }
    #endif
  }
  // Occupied, observed, known empty, mixed-axis join. All-zero is unknown; zero RGB radiance
  // with observed=1 is a measured dark surface, not absent information.
  gl_FragColor = vec4(occupied,count>0.0?1.0:0.0,empty,(axes & (axes - 1)) != 0 ? 1.0 : 0.0);
}
`
export const fastGatherFragment = /* glsl */ `
${fastVolumeGLSL}
uniform sampler2D surfaceRadiance, surfaceNormal, occupancy;
uniform vec3 rays[${fastGIRayCount}], skyRadiance;
${daylightSkyGLSL}
layout(location=0) out highp vec4 coefficient0;
layout(location=1) out highp vec4 coefficientX;
layout(location=2) out highp vec4 coefficientY;
layout(location=3) out highp vec4 coefficientZ;
void main() {
  vec3 c=voxelCell(); vec2 uv=voxelUV(c);
  vec3 c0=vec3(0.0), cx=vec3(0.0), cy=vec3(0.0), cz=vec3(0.0);
  if(texture(occupancy,uv).r < .5) for(int ray=0;ray<${fastGIRayCount};ray++) {
    vec3 direction=rays[ray], stepDirection=sign(direction), cellDirection=direction/volumeSize*n;
    vec3 delta=1.0/max(abs(cellDirection),vec3(.000001));
    vec3 crossing=delta*.5, current=c;
    vec3 incoming=vec3(0.0);
    for(int stepIndex=0;stepIndex<96;stepIndex++) {
      if(crossing.x<=crossing.y && crossing.x<=crossing.z) { current.x+=stepDirection.x; crossing.x+=delta.x; }
      else if(crossing.y<=crossing.z) { current.y+=stepDirection.y; crossing.y+=delta.y; }
      else { current.z+=stepDirection.z; crossing.z+=delta.z; }
      // Sky contributes only when the entire visibility ray escapes the room.
      // An unobserved wall still blocks it, just like an observed dark wall.
      if(!inside(current)) { incoming=hdSkyRadiance(direction,skyRadiance); break; }
      vec2 hitUV=voxelUV(current);
      vec4 hit = texture(occupancy,hitUV);
      if(hit.r < .5) continue;
      #ifdef HD_FAST_STOREY
      // A ceiling and a partition can share a cell. Even observations with
      // matching normals can then lie on opposite room sides. Keep the cell
      // solid, but use the surrounding, unambiguous cells for its bounce.
      if (hit.a > .5) break;
      #endif
      float weight=0.0;
      for(int band=0;band<6;band++) {
        vec2 sourceUV=vec2(hitUV.x,(hitUV.y+float(band))/6.0);
        vec4 source=texture(surfaceRadiance,sourceUV), normalData=texture(surfaceNormal,sourceUV);
        if(source.a<.5 || length(normalData.xyz)<.0001) continue;
        float cosine=max(dot(normalize(normalData.xyz),-direction),0.0);
        incoming+=source.rgb/source.a*cosine; weight+=cosine;
      }
      if(weight>0.0) incoming/=weight;
      // Uniform solid-angle rays account for projected area and distance by
      // angular coverage. Only the outward emitter hemisphere contributes.
      break; // Unknown occupied geometry occludes without inventing radiance.
    }
    c0+=incoming*(12.5663706/${fastGIRayCount}.0*.282095*3.14159265);
    vec3 first=incoming*(12.5663706/${fastGIRayCount}.0*.488603*2.0943951);
    cx+=first*direction.x; cy+=first*direction.y; cz+=first*direction.z;
  }
  coefficient0=vec4(c0,1.0); coefficientX=vec4(cx,1.0); coefficientY=vec4(cy,1.0); coefficientZ=vec4(cz,1.0);
}
`
export const fastPackFragment = /* glsl */ `
${fastVolumeGLSL}
uniform sampler2D c0, cx, cy, cz;
uniform sampler2D occupancy;
uniform vec2 outputSize;
vec3 coefficient(vec2 uv,int band) {return band==0?texture2D(c0,uv).rgb:band==1?texture2D(cx,uv).rgb:band==2?texture2D(cy,uv).rgb:texture2D(cz,uv).rgb;}
#ifdef HD_FAST_LINEAR_RECEIVER
// Certify the entire interpolation block, including diagonal corners. A
// solid anywhere in the block forces the display to test visibility per tap.
float clearReceiverBlock(vec3 base) {
  if (!inside(base + 1.0)) return 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 offset = vec3(float(i % 2), float((i / 2) % 2), float(i / 4));
    if (texture2D(occupancy, voxelUV(base + offset)).r > .5) return 0.0;
  }
  return 1.0;
}
#endif
void main() {
  vec2 uv=gl_FragCoord.xy/outputSize; int band=int(floor(uv.y*4.0)); uv.y=fract(uv.y*4.0);
  vec3 cell=voxelCell(),sum=coefficient(uv,band)*2.0;float weight=2.0;
  for(int axis=0;axis<6;axis++) {
    vec3 offset=axis<2?vec3(axis==0?1.0:-1.0,0.0,0.0):axis<4?vec3(0.0,axis==2?1.0:-1.0,0.0):vec3(0.0,0.0,axis==4?1.0:-1.0);
    vec3 next=cell+offset;if(!inside(next))continue;vec2 sampleUV=voxelUV(next);
    if(texture2D(occupancy,sampleUV).r>.5)continue;
    sum+=coefficient(sampleUV,band);weight+=1.0;
  }
  vec3 status=texture2D(occupancy,uv).rgb;
  float metadata = band==0?status.r:band==1?status.g:status.b;
  #ifdef HD_FAST_LINEAR_RECEIVER
  if (band == 3) metadata = clearReceiverBlock(cell);
  #endif
  gl_FragColor=vec4(sum/weight,metadata);
}
`

// One Jacobi surface relighting step. The first field contains direct-source
// bounce and visible sky; reflected radiance uses the captured albedo / PI.
export const fastBounceFragment = /* glsl */ `
${fastVolumeGLSL}
uniform sampler2D surfaceRadiance, surfaceNormal, surfaceResponse, light;
void main() {
  vec3 c=voxelCell(); float band=floor(gl_FragCoord.y/n);
  vec2 uv=voxelUV(c), sourceUV=vec2(uv.x,(uv.y+band)/6.0);
  vec4 source=texture2D(surfaceRadiance,sourceUV), normalData=texture2D(surfaceNormal,sourceUV);
  vec3 reflected=vec3(0.0);
  if(source.a>0.0 && length(normalData.xyz)>.0001) {
    vec3 normal=normalize(normalData.xyz);
    // Seek free space on this lobe's side of the surface, never the other side.
    for(int distance=1;distance<=2;distance++) {
      vec3 next=floor(c+.5+normal*float(distance));if(!inside(next))break;
      vec2 sampleUV=voxelUV(next);sampleUV.y*=.25;
      if(texture2D(light,sampleUV).a>.5)continue;
      vec3 irradiance=texture2D(light,sampleUV).rgb*.282095;
      irradiance+=texture2D(light,sampleUV+vec2(0.0,.25)).rgb*(.488603*normal.x);
      irradiance+=texture2D(light,sampleUV+vec2(0.0,.5)).rgb*(.488603*normal.y);
      irradiance+=texture2D(light,sampleUV+vec2(0.0,.75)).rgb*(.488603*normal.z);
      // Response and radiance both store sums with the same sample count.
      reflected=max(irradiance,vec3(0.0))*texture2D(surfaceResponse,sourceUV).rgb;
      break;
    }
  }
  gl_FragColor=vec4(source.rgb+reflected,source.a);
}
`
