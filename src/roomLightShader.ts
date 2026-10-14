import {
  DataTexture,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  ShaderChunk,
  UnsignedByteType,
  Vector2,
  Vector4,
  type Material,
  type Texture,
} from 'three'
import type { RoomLightMask } from './roomLightMask.ts'
import { applyLocalShadowReceiver } from './materials/localShadowReceiver.ts'

export const ROOM_LIGHT_SHADER_MAX_LIGHTS = 11
// Offscreen GI captures provide nearby world-space lights with cached shadows.
export const roomLightCaptureUniform = { value: 0 }

export type RoomLightShaderUniforms = {
  enabled: { value: number }
  floorRange: { value: Vector2 }
  mask: { value: Texture }
  maskBounds: { value: Vector4 }
  pointRoomIds: { value: Float32Array }
  spotRoomIds: { value: Float32Array }
}

const roomLightShaderPars = /* glsl */ `
varying vec3 hdRoomLightWorldPosition;
varying vec3 hdRoomLightReceiverWorldOffset;
uniform float hdRoomLightEnabled;
uniform float hdRoomLightCapture;
uniform sampler2D hdRoomLightMask;
uniform vec4 hdRoomLightMaskBounds;
uniform vec2 hdRoomLightFloorRange;
uniform float hdPointLightRoomIds[${ROOM_LIGHT_SHADER_MAX_LIGHTS}];
uniform float hdSpotLightRoomIds[${ROOM_LIGHT_SHADER_MAX_LIGHTS}];
#ifdef HD_INDIRECT_VISIBILITY
float hdGIDirectVisibility(vec3 p, vec3 viewNormal, float index);
#endif

float hdRoomLightReceiverId(vec3 worldPosition, vec3 viewNormal) {
  vec3 worldNormal = transformNormalByInverseViewMatrix(viewNormal, viewMatrix);
  vec2 planPosition = worldPosition.xz;
  float horizontalLength = length(worldNormal.xz);
  if (horizontalLength > 0.35) {
    planPosition += worldNormal.xz / horizontalLength * 0.08;
  }
  vec2 uv = (planPosition - hdRoomLightMaskBounds.xy) / hdRoomLightMaskBounds.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return 0.0;
  return floor(texture2D(hdRoomLightMask, uv).r * 255.0 + 0.5);
}

float hdRoomLightFactor(float lightRoomId, float receiverRoomId) {
  if (hdRoomLightCapture > 0.5 || hdRoomLightEnabled < 0.5 || lightRoomId < 0.5) return 1.0;
  return abs(receiverRoomId - lightRoomId) < 0.5 ? 1.0 : 0.0;
}
`

const maskedLightsChunk = ShaderChunk.lights_fragment_begin
  // Receiver derivatives require uniform control flow across a fragment quad,
  // including the edge of a spot cone or a light's distance limit. Zero light
  // colour already rejects those fragments after the shadow comparison.
  .replaceAll('directLight.visible && receiveShadow', 'receiveShadow')
  .replace('PointLight pointLight;', 'PointLight pointLight;\nfloat hdPointVisibility;')
  .replace('SpotLight spotLight;', 'SpotLight spotLight;\nfloat hdSpotVisibility;')
  .replace(
    'vec3 geometryNormal = normal;',
    `vec3 geometryNormal = normal;
float hdRoomLightReceiver =
  hdRoomLightWorldPosition.y < hdRoomLightFloorRange.x ||
  hdRoomLightWorldPosition.y > hdRoomLightFloorRange.y
    ? 0.0
    : hdRoomLightReceiverId(hdRoomLightWorldPosition + hdRoomLightReceiverWorldOffset, nonPerturbedNormal);`,
  )
  .replace(
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
    `getPointLightInfo( pointLight, geometryPosition, directLight );
    #ifdef HD_INDIRECT_VISIBILITY
      hdPointVisibility = hdGIDirectVisibility(hdRoomLightWorldPosition, nonPerturbedNormal, hdGIPointIndices[i]);
      directLight.color *= hdPointVisibility >= 0.0 ? hdPointVisibility : hdRoomLightFactor(hdPointLightRoomIds[i], hdRoomLightReceiver);
    #else
      directLight.color *= hdRoomLightFactor(hdPointLightRoomIds[i], hdRoomLightReceiver);
    #endif`,
  )
  .replace(
    'getSpotLightInfo( spotLight, geometryPosition, directLight );',
    `getSpotLightInfo( spotLight, geometryPosition, directLight );
    #ifdef HD_INDIRECT_VISIBILITY
      hdSpotVisibility = hdGIDirectVisibility(hdRoomLightWorldPosition, nonPerturbedNormal, hdGISpotIndices[i]);
      directLight.color *= hdSpotVisibility >= 0.0 ? hdSpotVisibility : hdRoomLightFactor(hdSpotLightRoomIds[i], hdRoomLightReceiver);
    #else
      directLight.color *= hdRoomLightFactor(hdSpotLightRoomIds[i], hdRoomLightReceiver);
    #endif`,
  )

export function createRoomLightMaskTexture(mask: RoomLightMask) {
  const texture = new DataTexture(
    mask.data,
    mask.width,
    mask.height,
    RedFormat,
    UnsignedByteType,
  )
  texture.colorSpace = NoColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  texture.unpackAlignment = 1
  return texture
}

export function createRoomLightShaderUniforms(maskTexture: Texture): RoomLightShaderUniforms {
  return {
    enabled: { value: 0 },
    floorRange: { value: new Vector2() },
    mask: { value: maskTexture },
    maskBounds: { value: new Vector4() },
    pointRoomIds: { value: new Float32Array(ROOM_LIGHT_SHADER_MAX_LIGHTS) },
    spotRoomIds: { value: new Float32Array(ROOM_LIGHT_SHADER_MAX_LIGHTS) },
  }
}

export function applyRoomLightShader(material: Material, uniforms: RoomLightShaderUniforms) {
  const attributes = material as Material & { defaultAttributeValues?: Record<string, number[]> }
  attributes.defaultAttributeValues = { ...attributes.defaultAttributeValues, hdGIReceiverOffset: [0, 0, 0] }
  const originalOnBeforeCompile = material.onBeforeCompile
  const originalProgramCacheKey = material.customProgramCacheKey
  const patchedOnBeforeCompile: Material['onBeforeCompile'] = (shader, renderer) => {
    originalOnBeforeCompile.call(material, shader, renderer)
    if (shader.fragmentShader.includes('hdRoomLightFactor')) return
    applyLocalShadowReceiver(shader, renderer)
    Object.assign(shader.uniforms, {
      hdRoomLightEnabled: uniforms.enabled,
      hdRoomLightCapture: roomLightCaptureUniform,
      hdRoomLightFloorRange: uniforms.floorRange,
      hdRoomLightMask: uniforms.mask,
      hdRoomLightMaskBounds: uniforms.maskBounds,
      hdPointLightRoomIds: uniforms.pointRoomIds,
      hdSpotLightRoomIds: uniforms.spotRoomIds,
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hdRoomLightWorldPosition;\nvarying vec3 hdRoomLightReceiverWorldOffset;\n#ifndef HD_RECEIVER_ATTRIBUTE\n#define HD_RECEIVER_ATTRIBUTE\nattribute vec3 hdGIReceiverOffset;\n#endif')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 hdRoomLightWorld = vec4(transformed, 1.0);
        vec4 hdRoomLightReceiver = vec4(hdGIReceiverOffset, 0.0);
        #ifdef USE_BATCHING
          hdRoomLightWorld = batchingMatrix * hdRoomLightWorld;
          hdRoomLightReceiver = batchingMatrix * hdRoomLightReceiver;
        #endif
        #ifdef USE_INSTANCING
          hdRoomLightWorld = instanceMatrix * hdRoomLightWorld;
          hdRoomLightReceiver = instanceMatrix * hdRoomLightReceiver;
        #endif
        hdRoomLightWorldPosition = (modelMatrix * hdRoomLightWorld).xyz;
        hdRoomLightReceiverWorldOffset = (modelMatrix * hdRoomLightReceiver).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${roomLightShaderPars}`)
      .replace('#include <lights_fragment_begin>', maskedLightsChunk)
  }
  const patchedProgramCacheKey = () => {
    const key = originalProgramCacheKey.call(material)
    // Fade clones inherit the already-patched hook. Reapplying the controller
    // must not create a second cache key for exactly the same shader.
    const suffix = ':house-designer-room-light-v4'
    // Other lighting hooks can follow this marker in a composed shader key.
    // A fade clone inherits all of them, not just the last hook.
    return /:house-designer-room-light-v\d+/.test(key)
      ? key.replace(/:house-designer-room-light-v\d+/g, suffix) : `${key}${suffix}`
  }

  material.onBeforeCompile = patchedOnBeforeCompile
  material.customProgramCacheKey = patchedProgramCacheKey
  material.needsUpdate = true

  return () => {
    if (material.onBeforeCompile === patchedOnBeforeCompile) {
      material.onBeforeCompile = originalOnBeforeCompile
      material.customProgramCacheKey = originalProgramCacheKey
      material.needsUpdate = true
    }
  }
}
