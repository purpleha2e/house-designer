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

export const ROOM_LIGHT_SHADER_MAX_LIGHTS = 11

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
uniform float hdRoomLightEnabled;
uniform sampler2D hdRoomLightMask;
uniform vec4 hdRoomLightMaskBounds;
uniform vec2 hdRoomLightFloorRange;
uniform float hdPointLightRoomIds[${ROOM_LIGHT_SHADER_MAX_LIGHTS}];
uniform float hdSpotLightRoomIds[${ROOM_LIGHT_SHADER_MAX_LIGHTS}];

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
  if (hdRoomLightEnabled < 0.5 || lightRoomId < 0.5) return 1.0;
  return abs(receiverRoomId - lightRoomId) < 0.5 ? 1.0 : 0.0;
}
`

const maskedLightsChunk = ShaderChunk.lights_fragment_begin
  .replace(
    'vec3 geometryNormal = normal;',
    `vec3 geometryNormal = normal;
float hdRoomLightReceiver =
  hdRoomLightWorldPosition.y < hdRoomLightFloorRange.x ||
  hdRoomLightWorldPosition.y > hdRoomLightFloorRange.y
    ? 0.0
    : hdRoomLightReceiverId(hdRoomLightWorldPosition, geometryNormal);`,
  )
  .replace(
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
    `getPointLightInfo( pointLight, geometryPosition, directLight );
    directLight.color *= hdRoomLightFactor(hdPointLightRoomIds[i], hdRoomLightReceiver);`,
  )
  .replace(
    'getSpotLightInfo( spotLight, geometryPosition, directLight );',
    `getSpotLightInfo( spotLight, geometryPosition, directLight );
    directLight.color *= hdRoomLightFactor(hdSpotLightRoomIds[i], hdRoomLightReceiver);`,
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
  const originalOnBeforeCompile = material.onBeforeCompile
  const originalProgramCacheKey = material.customProgramCacheKey
  const patchedOnBeforeCompile: Material['onBeforeCompile'] = (shader, renderer) => {
    originalOnBeforeCompile.call(material, shader, renderer)
    if (shader.fragmentShader.includes('hdRoomLightFactor')) return
    Object.assign(shader.uniforms, {
      hdRoomLightEnabled: uniforms.enabled,
      hdRoomLightFloorRange: uniforms.floorRange,
      hdRoomLightMask: uniforms.mask,
      hdRoomLightMaskBounds: uniforms.maskBounds,
      hdPointLightRoomIds: uniforms.pointRoomIds,
      hdSpotLightRoomIds: uniforms.spotRoomIds,
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hdRoomLightWorldPosition;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 hdRoomLightWorld = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          hdRoomLightWorld = batchingMatrix * hdRoomLightWorld;
        #endif
        #ifdef USE_INSTANCING
          hdRoomLightWorld = instanceMatrix * hdRoomLightWorld;
        #endif
        hdRoomLightWorldPosition = (modelMatrix * hdRoomLightWorld).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${roomLightShaderPars}`)
      .replace('#include <lights_fragment_begin>', maskedLightsChunk)
  }
  const patchedProgramCacheKey = () =>
    `${originalProgramCacheKey.call(material)}:house-designer-room-light-v1`

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
