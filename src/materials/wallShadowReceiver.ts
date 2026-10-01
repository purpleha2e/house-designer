import { ShaderChunk, type Material } from 'three'

type ShaderOverrides = Partial<Pick<Material, 'onBeforeCompile' | 'customProgramCacheKey'>>

// A filtered lookup spans several positions on the receiving plane. Comparing
// every tap against the centre's depth makes a wall shadow itself at grazing
// sun angles. Reconstruct that plane in shadow UV space for each tap instead.
const wallShadowChunk = ShaderChunk.shadowmap_pars_fragment.replace(
  /float getShadow\( sampler2DShadow[\s\S]*?(?=\n\t#elif defined\( SHADOWMAP_TYPE_VSM \))/, /* glsl */ `
float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity,
    float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  shadowCoord.xyz /= shadowCoord.w;
  vec3 dx = dFdx(shadowCoord.xyz);
  vec3 dy = dFdy(shadowCoord.xyz);
  float determinant = dx.x * dy.y - dx.y * dy.x;
  vec2 depthGradient = abs(determinant) > 1e-10
    ? vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / determinant
    : vec2(0.0);
  vec2 texelSize = 1.0 / shadowMapSize;
  // Hardware bilinear PCF also compares neighbouring texels. Cover their
  // depth range; this is a depth correction, not a world-space surface move.
  float filterBias = min(dot(abs(depthGradient), texelSize), 0.01);
  shadowCoord.z += shadowBias - filterBias;
  float shadow = 1.0;
  bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 &&
    shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0 && shadowCoord.z <= 1.0;
  if (inFrustum) {
    float phi = interleavedGradientNoise(gl_FragCoord.xy) * PI2;
    shadow = 0.0;
    for (int i = 0; i < 5; i++) {
      vec2 offset = vogelDiskSample(i, 5, phi) * shadowRadius * texelSize.x;
      shadow += texture(shadowMap, vec3(shadowCoord.xy + offset,
        shadowCoord.z + dot(depthGradient, offset)));
    }
    shadow *= 0.2;
  }
  return mix(1.0, shadow, shadowIntensity);
}
`,
)

/** Compose with finish shaders without changing wall casting or local point shadows. */
export function withWallShadowReceiver(overrides: ShaderOverrides = {}): ShaderOverrides {
  return {
    ...overrides,
    onBeforeCompile(shader, renderer) {
      overrides.onBeforeCompile?.call(this, shader, renderer)
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', wallShadowChunk)
    },
    customProgramCacheKey() {
      return `${overrides.customProgramCacheKey?.call(this) ?? 'standard'}-wall-shadow-receiver-v1`
    },
  }
}
