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


      uniform samplerCube hdSurfaceCube;
      uniform sampler2D hdSurfaceCaptured;
      uniform sampler2D hdSurfaceNormal;
      uniform vec3 hdSkyRadianceBase;
      
uniform float hdSkyMode;
uniform vec3 hdSkySunIrradiance;
vec3 hdSkyRadiance(vec3 direction,vec3 base) {
  if(hdSkyMode<.5)return base; // Legacy analytic regression fixtures.
  if(direction.y<0.0)return (base*(hdSkyMode>1.5?7.0/6.0:17.0/15.0)+hdSkySunIrradiance/3.14159265)*.2;
  return base*(hdSkyMode>1.5?.5+direction.y:.6+.8*direction.y);
}

      uniform float hdSurfaceCombined;
      uniform vec2 hdSurfaceAtlas;
      uniform vec2 hdSurfaceTile;
      uniform int hdSurfaceFace;
      void main() {
        vec2 pixel = gl_FragCoord.xy - hdSurfaceTile;
        float col = -1.0 + pixel.x * 0.125;
        float row = 1.0 - pixel.y * 0.125;
        vec3 p;
        if (hdSurfaceFace == 0) p = vec3(1.0, row, -col);
        else if (hdSurfaceFace == 1) p = vec3(-1.0, row, col);
        else if (hdSurfaceFace == 2) p = vec3(col, 1.0, -row);
        else if (hdSurfaceFace == 3) p = vec3(col, -1.0, row);
        else if (hdSurfaceFace == 4) p = vec3(col, row, 1.0);
        else p = vec3(-col, row, -1.0);
        vec2 uv=gl_FragCoord.xy/hdSurfaceAtlas;
        if(hdSurfaceCombined>.5){
          vec3 value=texture2D(hdSurfaceCaptured,uv).rgb;
          if(length(texture2D(hdSurfaceNormal,uv).xyz)<.5)value=hdSkyRadiance(normalize(p),hdSkyRadianceBase);
          gl_FragColor=vec4(value,1.0);
        }else gl_FragColor = textureCube(hdSurfaceCube, p);
      }