import type { Material, WebGLRenderer } from 'three'
import { withWallShadowReceiver } from './wallShadowReceiver.ts'

const pointShadowPattern = /float getPointShadow\( samplerCubeShadow[\s\S]*?(?=\n\t#elif defined\( SHADOWMAP_TYPE_BASIC \))/
const projectedShadowPattern = /float getShadow\( sampler2DShadow[\s\S]*?(?=\n\t#elif defined\( SHADOWMAP_TYPE_VSM \))/
const projectedShadowReceiver = /* glsl */ `
uniform float hdShadowRasterSteps;
float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity,
    float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  shadowCoord.xyz /= shadowCoord.w;
  vec3 dx = dFdx(shadowCoord.xyz), dy = dFdy(shadowCoord.xyz);
  if (any(lessThan(shadowCoord.xy, vec2(0.0))) || any(greaterThan(shadowCoord.xy, vec2(1.0))) || shadowCoord.z < 0.0 || shadowCoord.z > 1.0) return 1.0;
  float determinant = dx.x * dy.y - dx.y * dy.x;
  vec2 depthGradient = abs(determinant) > 1e-16
    ? vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / determinant : vec2(0.0);
  // Shadow rasterization rounds projected vertices to subpixel coordinates.
  // Cover that depth uncertainty, rather than moving the receiver through
  // centimetres of world space or covering an entire filtered texel.
  float rasterBias = .000001 + dot(abs(depthGradient), 1.0 / shadowMapSize) / hdShadowRasterSteps;
  float phi = interleavedGradientNoise(gl_FragCoord.xy) * PI2;
  float shadow = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 offset = vogelDiskSample(i, 5, phi) * shadowRadius / shadowMapSize;
    vec2 tap = (floor((shadowCoord.xy + offset) * shadowMapSize) + .5) / shadowMapSize;
    float reference = shadowCoord.z + dot(depthGradient, tap - shadowCoord.xy);
    #ifdef USE_REVERSED_DEPTH_BUFFER
      reference -= shadowBias - rasterBias;
    #else
      reference += shadowBias - rasterBias;
    #endif
    // A grazing footprint can cross the light's horizon or clip planes.
    // There is no receiver there; comparing an out-of-range reference against
    // cleared depth incorrectly turns that tap into a solid shadow.
    shadow += reference < 0.0 || reference > 1.0 ? 1.0 : texture(shadowMap, vec3(tap, reference));
  }
  return mix(1.0, shadow * .2, shadowIntensity);
}
`
const rasterStepsByRenderer = new WeakMap<WebGLRenderer, number>()

const pointShadowReceiver = /* glsl */ `
// Each tap compares its own texel centre and receiver-plane depth. Bilinear
// PCF's single reference for four depths makes grazing surfaces self-shadow.
vec3 hdPointShadowTexel(vec3 direction, float size) {
  vec3 a = abs(direction);
  float major = max(max(a.x, a.y), a.z);
  vec3 d = direction / major;
  vec3 centre = (floor(clamp(d * .5 + .5, vec3(0.0), vec3(.999999)) * size) + .5) * (2.0 / size) - 1.0;
  if (a.x >= a.y && a.x >= a.z) centre.x = sign(d.x);
  else if (a.y >= a.z) centre.y = sign(d.y);
  else centre.z = sign(d.z);
  return centre;
}

float getPointShadow(samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity,
    float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar) {
  vec3 p = shadowCoord.xyz;
  vec3 planeNormal = cross(dFdx(p), dFdy(p));
  float centreDepth = max(max(abs(p.x), abs(p.y)), abs(p.z));
  if (centreDepth < shadowCameraNear || centreDepth > shadowCameraFar) return 1.0;
  vec3 direction = normalize(p);
  float planeDistance = dot(planeNormal, p);
  vec3 tangent = abs(direction.x) > abs(direction.z) ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  tangent = normalize(cross(direction, tangent));
  vec3 bitangent = cross(direction, tangent);
  float phi = interleavedGradientNoise(gl_FragCoord.xy) * PI2;
  float shadow = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 offset = vogelDiskSample(i, 5, phi) * (2.0 * shadowRadius / shadowMapSize.x);
    vec3 tap = hdPointShadowTexel(direction + tangent * offset.x + bitangent * offset.y, shadowMapSize.x);
    float denominator = dot(planeNormal, tap);
    float depth = centreDepth;
    if (abs(denominator) > 1e-16) {
      float distance = planeDistance / denominator;
      if (distance > 0.0) depth = distance * max(max(abs(tap.x), abs(tap.y)), abs(tap.z));
    }
    #ifdef USE_REVERSED_DEPTH_BUFFER
      float reference = shadowCameraNear * (shadowCameraFar - depth) / (depth * (shadowCameraFar - shadowCameraNear)) - shadowBias;
    #else
      float reference = shadowCameraFar * (depth - shadowCameraNear) / (depth * (shadowCameraFar - shadowCameraNear)) + shadowBias;
    #endif
    shadow += depth < shadowCameraNear || depth > shadowCameraFar ? 1.0 : texture(shadowMap, vec4(tap, reference));
  }
  return mix(1.0, shadow * .2, shadowIntensity);
}
`

/** Plane-correct filtering for walls and ordinary PBR furniture alike. */
export function applyLocalShadowReceiver(shader: Parameters<Material['onBeforeCompile']>[0], renderer: Parameters<Material['onBeforeCompile']>[1]) {
  let rasterSteps = rasterStepsByRenderer.get(renderer)
  if (!rasterSteps) {
    const gl = renderer.getContext?.()
    rasterSteps = 2 ** (gl ? gl.getParameter(gl.SUBPIXEL_BITS) as number : 8)
    rasterStepsByRenderer.set(renderer, rasterSteps)
  }
  shader.uniforms ??= {}
  shader.uniforms.hdShadowRasterSteps = { value: Math.max(16, rasterSteps) }
  // Preserve an earlier wall finish correction if its hook expanded the chunk.
  withWallShadowReceiver().onBeforeCompile!.call({} as Material, shader, renderer)
  shader.fragmentShader = shader.fragmentShader.replace(projectedShadowPattern, projectedShadowReceiver)
  shader.fragmentShader = shader.fragmentShader.replace(pointShadowPattern, pointShadowReceiver)
}
