#version 300 es
#define varying in
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define gl_FragDepthEXT gl_FragDepth
#define texture2D texture
#define textureCube texture
#define texture2DProj textureProj
#define texture2DLodEXT textureLod
#define texture2DProjLodEXT textureProjLod
#define textureCubeLodEXT textureLod
#define texture2DGradEXT textureGrad
#define texture2DProjGradEXT textureProjGrad
#define textureCubeGradEXT textureGrad
precision highp float;
	precision highp int;
	precision highp sampler2D;
	precision highp samplerCube;
	precision highp sampler3D;
	precision highp sampler2DArray;
	precision highp sampler2DShadow;
	precision highp samplerCubeShadow;
	precision highp sampler2DArrayShadow;
	precision highp isampler2D;
	precision highp isampler3D;
	precision highp isamplerCube;
	precision highp isampler2DArray;
	precision highp usampler2D;
	precision highp usampler3D;
	precision highp usamplerCube;
	precision highp usampler2DArray;
	
#define HIGH_PRECISION
#define SHADER_TYPE ShaderMaterial
#define SHADER_NAME 
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
#define OPAQUE
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 linearToOutputTexel( vec4 value ) {
	return LinearTransferOETF( vec4( value.rgb * mat3( 1.0000,-0.0000,-0.0000,-0.0000,1.0000,0.0000,0.0000,0.0000,1.0000 ), value.a ) );
}
float luminance( const in vec3 rgb ) {
	const vec3 weights = vec3( 0.2126, 0.7152, 0.0722 );
	return dot( weights, rgb );
}


#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated
      

#ifdef HD_GI_CONTACT_RECEIVERS
uniform sampler2D hdGIContactTexture;
vec3 hdGIContactIrradiance(float link,vec3 n,out vec3 meanLight){
 float x=(link-.5)/96.0;
 vec4 basis=vec4(.886227,1.023328*n.y,1.023328*n.z,1.023328*n.x);
 vec4 r=texture2D(hdGIContactTexture,vec2(x,1./6.)),g=texture2D(hdGIContactTexture,vec2(x,.5)),b=texture2D(hdGIContactTexture,vec2(x,5./6.));
 meanLight=.886227*vec3(r.x,g.x,b.x);
 return max(vec3(dot(r,basis),dot(g,basis),dot(b,basis)),vec3(0.));
}
#endif

uniform float hdGIUseVolume;
uniform sampler2D hdGIMask;
uniform vec4 hdGIMaskSize;
uniform int hdGIFloorCount;
uniform sampler3D hdGIVolume;
uniform sampler3D hdGIFloorLayer;
uniform vec2 hdGIFloorLayerSize;
uniform float hdGIFloorLayerReady;
uniform vec2 hdGIVolumeSize;
uniform vec3 hdGIBounds;
uniform vec2 hdGIFloorRanges[8];

#ifdef HD_LOCAL_SUN_PREVIEW
uniform float hdLocalSunVolumeScale;
vec4 hdLocalSunVolumeRead(vec3 uv,float level){uv.z*=hdLocalSunVolumeScale;return textureLod(hdGIVolume,uv,level);}

#ifdef HD_SUN_BOUNCE
uniform float hdSunBouncePacked;
vec4 hdGIPackedVolume(vec3 uv,float level){uv.y*=1.0-.5*hdSunBouncePacked;return hdLocalSunVolumeRead(uv,level);}
vec4 hdGIPackedFloor(vec3 uv,float level){uv.y*=1.0-.5*hdSunBouncePacked;return textureLod(hdGIFloorLayer,uv,level);}

#ifdef HD_GI_L2
#define HD_GI_COEFFICIENT_COUNT 9.0
#else
#define HD_GI_COEFFICIENT_COUNT 4.0
#endif
#ifndef HD_GI_DIRECT_CAPTURE
vec3 hdGIVolumeSample(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight, out float support) {
  meanLight = vec3(0.0);
  support = 0.0;
  if (hdGIUseVolume < .5) return vec3(0.0);
  vec2 range = hdGIFloorRanges[int(floorIndex)];
  vec2 plan = clamp((p.xz - hdGIBounds.xy) / hdGIBounds.z, vec2(0.0), vec2(1.0));
  vec2 volumePlan = (plan * (hdGIVolumeSize.x - 1.0) + .5) / hdGIVolumeSize.x;
  float height = clamp((p.y - range.x) / (range.y - range.x), 0.0, 1.0);
  vec3 uv = vec3(volumePlan.x, (floorIndex * 14.0 + 1.5 + height * 11.0) / hdGIVolumeSize.y, volumePlan.y);
  uv.y /= HD_GI_COEFFICIENT_COUNT;
  vec4 c0; vec3 c1, c2, c3;
  #ifdef HD_GI_L2
    vec3 c4,c5,c6,c7,c8;
  #endif
  if (floorReceiver > .5) {
    vec2 floorPlan = (plan * (hdGIFloorLayerSize.x - 1.0) + .5) / hdGIFloorLayerSize.x;
    vec3 floorUV = vec3(floorPlan.x, (floorIndex + .5) / (hdGIFloorLayerSize.y * HD_GI_COEFFICIENT_COUNT), floorPlan.y);
    c0 = hdGIPackedFloor( floorUV, 0.0);
    c1 = hdGIPackedFloor( floorUV + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = hdGIPackedFloor( floorUV + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = hdGIPackedFloor( floorUV + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      c4=hdGIPackedFloor(floorUV+vec3(0.,4.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c5=hdGIPackedFloor(floorUV+vec3(0.,5.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c6=hdGIPackedFloor(floorUV+vec3(0.,6.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c7=hdGIPackedFloor(floorUV+vec3(0.,7.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c8=hdGIPackedFloor(floorUV+vec3(0.,8.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
    #endif
  } else {
    c0 = hdGIPackedVolume( uv, 0.0);
    c1 = hdGIPackedVolume( uv + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = hdGIPackedVolume( uv + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = hdGIPackedVolume( uv + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      c4=hdGIPackedVolume(uv+vec3(0.,4.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c5=hdGIPackedVolume(uv+vec3(0.,5.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c6=hdGIPackedVolume(uv+vec3(0.,6.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c7=hdGIPackedVolume(uv+vec3(0.,7.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c8=hdGIPackedVolume(uv+vec3(0.,8.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
    #endif
  }
  // Missing support inside a solid is not black illumination. Renormalize the
  // hardware filter, while retaining genuinely dark but valid samples.
  float coverage = max(c0.a, .00001);
  support = c0.a;
  meanLight = c0.rgb * (.886227 / coverage);
  vec4 basis = vec4(.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x);
  vec3 light=c0.rgb * basis.x + c1 * basis.y + c2 * basis.z + c3 * basis.w;
  #ifdef HD_GI_L2
    light=light 
  + .8580855308097834*(c4*n.x*n.y+c5*n.y*n.z+c7*n.x*n.z)
  + c6*(.24770795610037571*(3.0*n.z*n.z-1.0))
  + c8*(.4290427654048917*(n.x*n.x-n.y*n.y));
  #endif
  return max(light / coverage, vec3(0.0));
}

vec3 hdGIVolumeIrradiance(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight) {
  float support;
  vec3 light = hdGIVolumeSample(floorIndex, p, n, floorReceiver, meanLight, support);
  if (floorReceiver > .5 || hdGIFloorCount < 2) return light;
  // Independent storey volumes meet in open air above a stairwell. Blend that
  // join, using the cached ceiling occupancy to exclude solid slabs and walls.
  vec2 plan = (p.xz - hdGIBounds.xy) / hdGIBounds.z;
  for (int lower = 0; lower + 1 < hdGIFloorCount; lower++) {
    if (abs(floorIndex - float(lower)) > .1 && abs(floorIndex - float(lower + 1)) > .1) continue;
    float boundary = hdGIFloorRanges[lower + 1].x + .06;
    float width = min(.3, (hdGIFloorRanges[lower].y - hdGIFloorRanges[lower].x) / 11.0);
    if (abs(p.y - boundary) >= width) continue;
    vec3 below = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower)) / hdGIMaskSize.y), 0.0).rgb;
    vec3 above = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower + 1)) / hdGIMaskSize.y), 0.0).rgb;
    float ceiling = mix(hdGIFloorRanges[lower].x, hdGIFloorRanges[lower].y, dot(below.gb, vec2(65280.0, 255.0)) / 65535.0);
    if (below.r < .5 || above.r < .5 || ceiling < boundary - .025) continue;
    float otherIndex = floorIndex < float(lower) + .5 ? float(lower + 1) : float(lower);
    vec3 otherMean; float otherSupport;
    vec3 other = hdGIVolumeSample(otherIndex, p, n, 0.0, otherMean, otherSupport);
    if (otherSupport < .00001) continue;
    if (support < .00001) { meanLight = otherMean; return other; }
    float weight = smoothstep(boundary - width, boundary + width, p.y);
    if (floorIndex > float(lower) + .5) weight = 1.0 - weight;
    meanLight = mix(meanLight, otherMean, weight);
    return mix(light, other, weight);
  }
  return light;
}
#endif

#else

#ifdef HD_GI_L2
#define HD_GI_COEFFICIENT_COUNT 9.0
#else
#define HD_GI_COEFFICIENT_COUNT 4.0
#endif
#ifndef HD_GI_DIRECT_CAPTURE
vec3 hdGIVolumeSample(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight, out float support) {
  meanLight = vec3(0.0);
  support = 0.0;
  if (hdGIUseVolume < .5) return vec3(0.0);
  vec2 range = hdGIFloorRanges[int(floorIndex)];
  vec2 plan = clamp((p.xz - hdGIBounds.xy) / hdGIBounds.z, vec2(0.0), vec2(1.0));
  vec2 volumePlan = (plan * (hdGIVolumeSize.x - 1.0) + .5) / hdGIVolumeSize.x;
  float height = clamp((p.y - range.x) / (range.y - range.x), 0.0, 1.0);
  vec3 uv = vec3(volumePlan.x, (floorIndex * 14.0 + 1.5 + height * 11.0) / hdGIVolumeSize.y, volumePlan.y);
  uv.y /= HD_GI_COEFFICIENT_COUNT;
  vec4 c0; vec3 c1, c2, c3;
  #ifdef HD_GI_L2
    vec3 c4,c5,c6,c7,c8;
  #endif
  if (floorReceiver > .5) {
    vec2 floorPlan = (plan * (hdGIFloorLayerSize.x - 1.0) + .5) / hdGIFloorLayerSize.x;
    vec3 floorUV = vec3(floorPlan.x, (floorIndex + .5) / (hdGIFloorLayerSize.y * HD_GI_COEFFICIENT_COUNT), floorPlan.y);
    c0 = textureLod(hdGIFloorLayer, floorUV, 0.0);
    c1 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      c4=textureLod(hdGIFloorLayer,floorUV+vec3(0.,4.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c5=textureLod(hdGIFloorLayer,floorUV+vec3(0.,5.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c6=textureLod(hdGIFloorLayer,floorUV+vec3(0.,6.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c7=textureLod(hdGIFloorLayer,floorUV+vec3(0.,7.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c8=textureLod(hdGIFloorLayer,floorUV+vec3(0.,8.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
    #endif
  } else {
    c0 = hdLocalSunVolumeRead( uv, 0.0);
    c1 = hdLocalSunVolumeRead( uv + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = hdLocalSunVolumeRead( uv + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = hdLocalSunVolumeRead( uv + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      c4=hdLocalSunVolumeRead(uv+vec3(0.,4.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c5=hdLocalSunVolumeRead(uv+vec3(0.,5.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c6=hdLocalSunVolumeRead(uv+vec3(0.,6.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c7=hdLocalSunVolumeRead(uv+vec3(0.,7.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c8=hdLocalSunVolumeRead(uv+vec3(0.,8.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
    #endif
  }
  // Missing support inside a solid is not black illumination. Renormalize the
  // hardware filter, while retaining genuinely dark but valid samples.
  float coverage = max(c0.a, .00001);
  support = c0.a;
  meanLight = c0.rgb * (.886227 / coverage);
  vec4 basis = vec4(.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x);
  vec3 light=c0.rgb * basis.x + c1 * basis.y + c2 * basis.z + c3 * basis.w;
  #ifdef HD_GI_L2
    light=light 
  + .8580855308097834*(c4*n.x*n.y+c5*n.y*n.z+c7*n.x*n.z)
  + c6*(.24770795610037571*(3.0*n.z*n.z-1.0))
  + c8*(.4290427654048917*(n.x*n.x-n.y*n.y));
  #endif
  return max(light / coverage, vec3(0.0));
}

vec3 hdGIVolumeIrradiance(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight) {
  float support;
  vec3 light = hdGIVolumeSample(floorIndex, p, n, floorReceiver, meanLight, support);
  if (floorReceiver > .5 || hdGIFloorCount < 2) return light;
  // Independent storey volumes meet in open air above a stairwell. Blend that
  // join, using the cached ceiling occupancy to exclude solid slabs and walls.
  vec2 plan = (p.xz - hdGIBounds.xy) / hdGIBounds.z;
  for (int lower = 0; lower + 1 < hdGIFloorCount; lower++) {
    if (abs(floorIndex - float(lower)) > .1 && abs(floorIndex - float(lower + 1)) > .1) continue;
    float boundary = hdGIFloorRanges[lower + 1].x + .06;
    float width = min(.3, (hdGIFloorRanges[lower].y - hdGIFloorRanges[lower].x) / 11.0);
    if (abs(p.y - boundary) >= width) continue;
    vec3 below = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower)) / hdGIMaskSize.y), 0.0).rgb;
    vec3 above = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower + 1)) / hdGIMaskSize.y), 0.0).rgb;
    float ceiling = mix(hdGIFloorRanges[lower].x, hdGIFloorRanges[lower].y, dot(below.gb, vec2(65280.0, 255.0)) / 65535.0);
    if (below.r < .5 || above.r < .5 || ceiling < boundary - .025) continue;
    float otherIndex = floorIndex < float(lower) + .5 ? float(lower + 1) : float(lower);
    vec3 otherMean; float otherSupport;
    vec3 other = hdGIVolumeSample(otherIndex, p, n, 0.0, otherMean, otherSupport);
    if (otherSupport < .00001) continue;
    if (support < .00001) { meanLight = otherMean; return other; }
    float weight = smoothstep(boundary - width, boundary + width, p.y);
    if (floorIndex > float(lower) + .5) weight = 1.0 - weight;
    meanLight = mix(meanLight, otherMean, weight);
    return mix(light, other, weight);
  }
  return light;
}
#endif

#endif

#else

#ifdef HD_SUN_BOUNCE
uniform float hdSunBouncePacked;
vec4 hdGIPackedVolume(vec3 uv,float level){uv.y*=1.0-.5*hdSunBouncePacked;return textureLod(hdGIVolume,uv,level);}
vec4 hdGIPackedFloor(vec3 uv,float level){uv.y*=1.0-.5*hdSunBouncePacked;return textureLod(hdGIFloorLayer,uv,level);}

#ifdef HD_GI_L2
#define HD_GI_COEFFICIENT_COUNT 9.0
#else
#define HD_GI_COEFFICIENT_COUNT 4.0
#endif
#ifndef HD_GI_DIRECT_CAPTURE
vec3 hdGIVolumeSample(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight, out float support) {
  meanLight = vec3(0.0);
  support = 0.0;
  if (hdGIUseVolume < .5) return vec3(0.0);
  vec2 range = hdGIFloorRanges[int(floorIndex)];
  vec2 plan = clamp((p.xz - hdGIBounds.xy) / hdGIBounds.z, vec2(0.0), vec2(1.0));
  vec2 volumePlan = (plan * (hdGIVolumeSize.x - 1.0) + .5) / hdGIVolumeSize.x;
  float height = clamp((p.y - range.x) / (range.y - range.x), 0.0, 1.0);
  vec3 uv = vec3(volumePlan.x, (floorIndex * 14.0 + 1.5 + height * 11.0) / hdGIVolumeSize.y, volumePlan.y);
  uv.y /= HD_GI_COEFFICIENT_COUNT;
  vec4 c0; vec3 c1, c2, c3;
  #ifdef HD_GI_L2
    vec3 c4,c5,c6,c7,c8;
  #endif
  if (floorReceiver > .5) {
    vec2 floorPlan = (plan * (hdGIFloorLayerSize.x - 1.0) + .5) / hdGIFloorLayerSize.x;
    vec3 floorUV = vec3(floorPlan.x, (floorIndex + .5) / (hdGIFloorLayerSize.y * HD_GI_COEFFICIENT_COUNT), floorPlan.y);
    c0 = hdGIPackedFloor( floorUV, 0.0);
    c1 = hdGIPackedFloor( floorUV + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = hdGIPackedFloor( floorUV + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = hdGIPackedFloor( floorUV + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      c4=hdGIPackedFloor(floorUV+vec3(0.,4.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c5=hdGIPackedFloor(floorUV+vec3(0.,5.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c6=hdGIPackedFloor(floorUV+vec3(0.,6.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c7=hdGIPackedFloor(floorUV+vec3(0.,7.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c8=hdGIPackedFloor(floorUV+vec3(0.,8.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
    #endif
  } else {
    c0 = hdGIPackedVolume( uv, 0.0);
    c1 = hdGIPackedVolume( uv + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = hdGIPackedVolume( uv + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = hdGIPackedVolume( uv + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      c4=hdGIPackedVolume(uv+vec3(0.,4.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c5=hdGIPackedVolume(uv+vec3(0.,5.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c6=hdGIPackedVolume(uv+vec3(0.,6.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c7=hdGIPackedVolume(uv+vec3(0.,7.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c8=hdGIPackedVolume(uv+vec3(0.,8.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
    #endif
  }
  // Missing support inside a solid is not black illumination. Renormalize the
  // hardware filter, while retaining genuinely dark but valid samples.
  float coverage = max(c0.a, .00001);
  support = c0.a;
  meanLight = c0.rgb * (.886227 / coverage);
  vec4 basis = vec4(.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x);
  vec3 light=c0.rgb * basis.x + c1 * basis.y + c2 * basis.z + c3 * basis.w;
  #ifdef HD_GI_L2
    light=light 
  + .8580855308097834*(c4*n.x*n.y+c5*n.y*n.z+c7*n.x*n.z)
  + c6*(.24770795610037571*(3.0*n.z*n.z-1.0))
  + c8*(.4290427654048917*(n.x*n.x-n.y*n.y));
  #endif
  return max(light / coverage, vec3(0.0));
}

vec3 hdGIVolumeIrradiance(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight) {
  float support;
  vec3 light = hdGIVolumeSample(floorIndex, p, n, floorReceiver, meanLight, support);
  if (floorReceiver > .5 || hdGIFloorCount < 2) return light;
  // Independent storey volumes meet in open air above a stairwell. Blend that
  // join, using the cached ceiling occupancy to exclude solid slabs and walls.
  vec2 plan = (p.xz - hdGIBounds.xy) / hdGIBounds.z;
  for (int lower = 0; lower + 1 < hdGIFloorCount; lower++) {
    if (abs(floorIndex - float(lower)) > .1 && abs(floorIndex - float(lower + 1)) > .1) continue;
    float boundary = hdGIFloorRanges[lower + 1].x + .06;
    float width = min(.3, (hdGIFloorRanges[lower].y - hdGIFloorRanges[lower].x) / 11.0);
    if (abs(p.y - boundary) >= width) continue;
    vec3 below = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower)) / hdGIMaskSize.y), 0.0).rgb;
    vec3 above = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower + 1)) / hdGIMaskSize.y), 0.0).rgb;
    float ceiling = mix(hdGIFloorRanges[lower].x, hdGIFloorRanges[lower].y, dot(below.gb, vec2(65280.0, 255.0)) / 65535.0);
    if (below.r < .5 || above.r < .5 || ceiling < boundary - .025) continue;
    float otherIndex = floorIndex < float(lower) + .5 ? float(lower + 1) : float(lower);
    vec3 otherMean; float otherSupport;
    vec3 other = hdGIVolumeSample(otherIndex, p, n, 0.0, otherMean, otherSupport);
    if (otherSupport < .00001) continue;
    if (support < .00001) { meanLight = otherMean; return other; }
    float weight = smoothstep(boundary - width, boundary + width, p.y);
    if (floorIndex > float(lower) + .5) weight = 1.0 - weight;
    meanLight = mix(meanLight, otherMean, weight);
    return mix(light, other, weight);
  }
  return light;
}
#endif

#else

#ifdef HD_GI_L2
#define HD_GI_COEFFICIENT_COUNT 9.0
#else
#define HD_GI_COEFFICIENT_COUNT 4.0
#endif
#ifndef HD_GI_DIRECT_CAPTURE
vec3 hdGIVolumeSample(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight, out float support) {
  meanLight = vec3(0.0);
  support = 0.0;
  if (hdGIUseVolume < .5) return vec3(0.0);
  vec2 range = hdGIFloorRanges[int(floorIndex)];
  vec2 plan = clamp((p.xz - hdGIBounds.xy) / hdGIBounds.z, vec2(0.0), vec2(1.0));
  vec2 volumePlan = (plan * (hdGIVolumeSize.x - 1.0) + .5) / hdGIVolumeSize.x;
  float height = clamp((p.y - range.x) / (range.y - range.x), 0.0, 1.0);
  vec3 uv = vec3(volumePlan.x, (floorIndex * 14.0 + 1.5 + height * 11.0) / hdGIVolumeSize.y, volumePlan.y);
  uv.y /= HD_GI_COEFFICIENT_COUNT;
  vec4 c0; vec3 c1, c2, c3;
  #ifdef HD_GI_L2
    vec3 c4,c5,c6,c7,c8;
  #endif
  if (floorReceiver > .5) {
    vec2 floorPlan = (plan * (hdGIFloorLayerSize.x - 1.0) + .5) / hdGIFloorLayerSize.x;
    vec3 floorUV = vec3(floorPlan.x, (floorIndex + .5) / (hdGIFloorLayerSize.y * HD_GI_COEFFICIENT_COUNT), floorPlan.y);
    c0 = textureLod(hdGIFloorLayer, floorUV, 0.0);
    c1 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = textureLod(hdGIFloorLayer, floorUV + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      c4=textureLod(hdGIFloorLayer,floorUV+vec3(0.,4.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c5=textureLod(hdGIFloorLayer,floorUV+vec3(0.,5.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c6=textureLod(hdGIFloorLayer,floorUV+vec3(0.,6.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c7=textureLod(hdGIFloorLayer,floorUV+vec3(0.,7.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c8=textureLod(hdGIFloorLayer,floorUV+vec3(0.,8.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
    #endif
  } else {
    c0 = textureLod(hdGIVolume, uv, 0.0);
    c1 = textureLod(hdGIVolume, uv + vec3(0.0, 1.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c2 = textureLod(hdGIVolume, uv + vec3(0.0, 2.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    c3 = textureLod(hdGIVolume, uv + vec3(0.0, 3.0/HD_GI_COEFFICIENT_COUNT, 0.0), 0.0).rgb;
    #ifdef HD_GI_L2
      c4=textureLod(hdGIVolume,uv+vec3(0.,4.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c5=textureLod(hdGIVolume,uv+vec3(0.,5.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c6=textureLod(hdGIVolume,uv+vec3(0.,6.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c7=textureLod(hdGIVolume,uv+vec3(0.,7.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
c8=textureLod(hdGIVolume,uv+vec3(0.,8.0/HD_GI_COEFFICIENT_COUNT,0.),0.).rgb;
    #endif
  }
  // Missing support inside a solid is not black illumination. Renormalize the
  // hardware filter, while retaining genuinely dark but valid samples.
  float coverage = max(c0.a, .00001);
  support = c0.a;
  meanLight = c0.rgb * (.886227 / coverage);
  vec4 basis = vec4(.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x);
  vec3 light=c0.rgb * basis.x + c1 * basis.y + c2 * basis.z + c3 * basis.w;
  #ifdef HD_GI_L2
    light=light 
  + .8580855308097834*(c4*n.x*n.y+c5*n.y*n.z+c7*n.x*n.z)
  + c6*(.24770795610037571*(3.0*n.z*n.z-1.0))
  + c8*(.4290427654048917*(n.x*n.x-n.y*n.y));
  #endif
  return max(light / coverage, vec3(0.0));
}

vec3 hdGIVolumeIrradiance(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight) {
  float support;
  vec3 light = hdGIVolumeSample(floorIndex, p, n, floorReceiver, meanLight, support);
  if (floorReceiver > .5 || hdGIFloorCount < 2) return light;
  // Independent storey volumes meet in open air above a stairwell. Blend that
  // join, using the cached ceiling occupancy to exclude solid slabs and walls.
  vec2 plan = (p.xz - hdGIBounds.xy) / hdGIBounds.z;
  for (int lower = 0; lower + 1 < hdGIFloorCount; lower++) {
    if (abs(floorIndex - float(lower)) > .1 && abs(floorIndex - float(lower + 1)) > .1) continue;
    float boundary = hdGIFloorRanges[lower + 1].x + .06;
    float width = min(.3, (hdGIFloorRanges[lower].y - hdGIFloorRanges[lower].x) / 11.0);
    if (abs(p.y - boundary) >= width) continue;
    vec3 below = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower)) / hdGIMaskSize.y), 0.0).rgb;
    vec3 above = textureLod(hdGIMask, vec2(plan.x, (plan.y + float(lower + 1)) / hdGIMaskSize.y), 0.0).rgb;
    float ceiling = mix(hdGIFloorRanges[lower].x, hdGIFloorRanges[lower].y, dot(below.gb, vec2(65280.0, 255.0)) / 65535.0);
    if (below.r < .5 || above.r < .5 || ceiling < boundary - .025) continue;
    float otherIndex = floorIndex < float(lower) + .5 ? float(lower + 1) : float(lower);
    vec3 otherMean; float otherSupport;
    vec3 other = hdGIVolumeSample(otherIndex, p, n, 0.0, otherMean, otherSupport);
    if (otherSupport < .00001) continue;
    if (support < .00001) { meanLight = otherMean; return other; }
    float weight = smoothstep(boundary - width, boundary + width, p.y);
    if (floorIndex > float(lower) + .5) weight = 1.0 - weight;
    meanLight = mix(meanLight, otherMean, weight);
    return mix(light, other, weight);
  }
  return light;
}
#endif

#endif

#endif


      uniform sampler2D hdSurfaceRadiance, hdSurfacePositions, hdSurfaceNormals, hdSurfaceResponses;
      uniform vec2 hdSurfaceAtlas, hdSurfaceOrigin;
      void main() {
        vec2 uv = (hdSurfaceOrigin + gl_FragCoord.xy) / hdSurfaceAtlas;
        vec3 light = texture2D(hdSurfaceRadiance, uv).rgb;
        vec4 position = texture2D(hdSurfacePositions, uv);
        if (position.a > .5) {
          vec4 normal = texture2D(hdSurfaceNormals, uv); vec3 mean;
          vec3 bounce;
          #ifdef HD_GI_CONTACT_RECEIVERS
          if(normal.a<-.5)bounce=hdGIContactIrradiance(-normal.a,normal.xyz,mean);else
          #endif
          bounce=hdGIVolumeIrradiance(position.a - 1.0, position.xyz, normal.xyz, normal.a, mean);
          light += texture2D(hdSurfaceResponses, uv).rgb * bounce;
        }
        gl_FragColor = vec4(light, 1.0);
      }