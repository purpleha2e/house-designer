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


      uniform samplerCube radiance;
      uniform int hdGISampleSize;
      
      float hdSHRadianceBasis(int coefficient,vec3 direction) {
    if(coefficient==0)return .2820947918;
    if(coefficient==1)return .4886025119*direction.y;
    if(coefficient==2)return .4886025119*direction.z;
    if(coefficient==3)return .4886025119*direction.x;
    return 0.0;
  }
      void main() {
        int coefficient = int(gl_FragCoord.x) % 4;
        bool skyOnly=gl_FragCoord.x>4.0;
        vec3 sum = vec3(0.0); float totalWeight = 0.0;
        for (int face = 0; face < 6; face++) {
          // Runtime bounds avoid expanding 1536 samples into one huge program.
          for (int y = 0; y < hdGISampleSize; y++) for (int x = 0; x < hdGISampleSize; x++) {
            float col = -1.0 + (float(x) + .5) * 0.125;
            float row = 1.0 - (float(y) + .5) * 0.125;
            vec3 p;
            if (face == 0) p = vec3(1.0, row, -col);
            else if (face == 1) p = vec3(-1.0, row, col);
            else if (face == 2) p = vec3(col, 1.0, -row);
            else if (face == 3) p = vec3(col, -1.0, row);
            else if (face == 4) p = vec3(col, row, 1.0);
            else p = vec3(-col, row, -1.0);
            float lengthSquared = dot(p, p);
            float weight = 4.0 / (sqrt(lengthSquared) * lengthSquared);
            vec3 direction = normalize(p);
            float basis = hdSHRadianceBasis(coefficient,direction);
            vec4 value=textureCube(radiance, direction);
            sum += (skyOnly&&value.a>.5?vec3(0.0):value.rgb) * basis * weight;
            totalWeight += weight;
          }
        }
        gl_FragColor = vec4(sum * (12.5663706144 / totalWeight), 1.0);
      }