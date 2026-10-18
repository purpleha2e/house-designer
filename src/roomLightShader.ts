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
import { MAX_ROOM_LIGHT_FLOORS, type RoomLightMask } from './roomLightMask.ts'
import { applyLocalShadowReceiver } from './materials/localShadowReceiver.ts'
import { MAX_LIGHT_PORTAL_PLANES } from './roomLightPortals.ts'

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
  unshadowedPointRoomIds: { value: Float32Array }
  unshadowedSpotRoomIds: { value: Float32Array }
  portals: { value: Texture }
  portalEdges: { value: Texture }
  portalEdgeRanges: { value: Vector2[] }
  portalBounds: { value: Vector4 }
  portalHeights: { value: Float32Array }
  portalCount: { value: number }
  floorCount: { value: number }
  floorHeights: { value: Float32Array }
}
const materialUniforms = new WeakMap<Material, RoomLightShaderUniforms>()
export const getRoomLightUniforms = (material: Material) => materialUniforms.get(material)

const roomLightShaderPars = /* glsl */ `
varying vec3 hdRoomLightWorldPosition;
varying vec3 hdRoomLightReceiverWorldOffset;
uniform float hdRoomLightEnabled;
uniform float hdRoomLightCapture;
uniform sampler2D hdRoomLightMask;
uniform vec4 hdRoomLightMaskBounds;
uniform vec2 hdRoomLightFloorRange;
uniform int hdRoomLightFloorCount;
uniform float hdRoomLightFloorHeights[${MAX_ROOM_LIGHT_FLOORS}];
uniform sampler2D hdLightPortals;
uniform sampler2D hdLightPortalEdges;
uniform vec2 hdLightPortalEdgeRanges[${MAX_LIGHT_PORTAL_PLANES}];
uniform vec4 hdLightPortalBounds;
uniform float hdLightPortalHeights[${MAX_LIGHT_PORTAL_PLANES}];
uniform int hdLightPortalCount;
uniform float hdPointLightRoomIds[${ROOM_LIGHT_SHADER_MAX_LIGHTS}];
uniform float hdSpotLightRoomIds[${ROOM_LIGHT_SHADER_MAX_LIGHTS}];
vec4 hdLightPortalRecord(int index) {
  int width = textureSize(hdLightPortalEdges, 0).x;
  return texelFetch(hdLightPortalEdges, ivec2(index % width, index / width), 0);
}
bool hdLightPortalContains(int layer, vec2 point, vec2 uv) {
  float cell = textureLod(hdLightPortals, vec2(uv.x, (uv.y + float(layer)) / hdLightPortalBounds.w), 0.0).r;
  if (cell < .25) return false;
  if (cell > .75) return true;
  int cursor = int(hdLightPortalEdgeRanges[layer].x), end = int(hdLightPortalEdgeRanges[layer].y);
  while (cursor < end) {
    int count = int(hdLightPortalRecord(cursor).x);
    bool inside = false;
    for (int edge = 0; edge < count; edge++) {
      vec4 segment = hdLightPortalRecord(cursor + 1 + edge);
      vec2 a = segment.xy, b = segment.zw;
      if ((a.y > point.y) != (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return true;
    cursor += count + 1;
  }
  return false;
}
#ifdef HD_INDIRECT_VISIBILITY
float hdGIDirectVisibility(vec3 p, vec3 viewNormal, float index);
vec3 hdGIWallMountOffset(vec3 p, vec3 surfaceNormal);
#endif

float hdRoomLightRoomAt(vec3 worldPosition) {
  vec2 uv = (worldPosition.xz - hdRoomLightMaskBounds.xy) / hdRoomLightMaskBounds.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return 0.0;
  int layer = 0;
  for (int i = 1; i < ${MAX_ROOM_LIGHT_FLOORS}; i++) {
    if (i >= hdRoomLightFloorCount || worldPosition.y < hdRoomLightFloorHeights[i]) break;
    layer = i;
  }
  uv.y = (uv.y + float(layer)) / float(max(1, hdRoomLightFloorCount));
  return floor(textureLod(hdRoomLightMask, uv, 0.0).r * 255.0 + 0.5);
}

vec3 hdRoomLightReceiverPosition(vec3 worldPosition, vec3 viewNormal) {
  vec3 worldNormal = transformNormalByInverseViewMatrix(viewNormal, viewMatrix);
  #ifdef HD_INDIRECT_VISIBILITY
    worldPosition += hdGIWallMountOffset(worldPosition, worldNormal);
  #endif
  vec2 planPosition = worldPosition.xz;
  float horizontalLength = length(worldNormal.xz);
  if (horizontalLength > 0.35) {
    planPosition += worldNormal.xz / horizontalLength * 0.08;
  }
  return vec3(planPosition.x, worldPosition.y, planPosition.y);
}

// Room membership alone is insufficient for concave rooms: two points in a
// hallway can have a bedroom between them. Walk every crossed mask cell so
// even a thin partition stops direct light, without adding furniture shadows.
bool hdRoomLightClearPath(vec3 source, vec2 destination, float roomId) {
  ivec2 atlasSize = textureSize(hdRoomLightMask, 0);
  ivec2 size = ivec2(atlasSize.x, atlasSize.y / max(1, hdRoomLightFloorCount));
  int layer = 0;
  for (int i = 1; i < ${MAX_ROOM_LIGHT_FLOORS}; i++) {
    if (i >= hdRoomLightFloorCount || source.y < hdRoomLightFloorHeights[i]) break;
    layer = i;
  }
  vec2 a = (source.xz - hdRoomLightMaskBounds.xy) / hdRoomLightMaskBounds.zw * vec2(size);
  vec2 b = (destination - hdRoomLightMaskBounds.xy) / hdRoomLightMaskBounds.zw * vec2(size);
  ivec2 cell = ivec2(floor(a)), last = ivec2(floor(b));
  vec2 delta = b - a, direction = sign(delta);
  vec2 stride = 1.0 / max(abs(delta), vec2(1e-10));
  vec2 next = (mix(a - floor(a), floor(a) + 1.0 - a, step(vec2(0.0), delta))) * stride;
  if (delta.x == 0.0) next.x = 1e20;
  if (delta.y == 0.0) next.y = 1e20;
  for (int i = 0; i <= size.x + size.y; i++) {
    if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, size))) return false;
    float id = floor(texelFetch(hdRoomLightMask, ivec2(cell.x, cell.y + layer * size.y), 0).r * 255.0 + .5);
    if (abs(id - roomId) > .5) return false;
    if (all(equal(cell, last))) return true;
    float crossing = min(next.x, next.y);
    if (next.x <= crossing) { cell.x += int(direction.x); next.x += stride.x; }
    if (next.y <= crossing) { cell.y += int(direction.y); next.y += stride.y; }
  }
  return false;
}

vec3 hdRoomLightWorldSource(vec3 viewPosition) {
  return cameraPosition + vec3(dot(viewMatrix[0].xyz, viewPosition), dot(viewMatrix[1].xyz, viewPosition), dot(viewMatrix[2].xyz, viewPosition));
}
float hdRoomLightFactor(float lightRoomId, float receiverRoomId, vec3 lightPosition, vec2 receiverPlanPosition) {
  if (hdRoomLightCapture > 0.5 || hdRoomLightEnabled < 0.5 || lightRoomId < 0.5) return 1.0;
  vec3 source = hdRoomLightWorldSource(lightPosition);
  vec3 receiver = hdRoomLightWorldPosition + hdRoomLightReceiverWorldOffset;
  bool crossesStorey = false;
  vec2 entry = receiver.xz;
  float entryDistance = 1e20;
  for (int layer = 0; layer < ${MAX_LIGHT_PORTAL_PLANES}; layer++) {
    if (layer >= hdLightPortalCount) break;
    float y = hdLightPortalHeights[layer];
    if (y <= min(source.y, receiver.y) || y >= max(source.y, receiver.y)) continue;
    crossesStorey = true;
    vec2 p = mix(source.xz, receiver.xz, (y - source.y) / (receiver.y - source.y));
    if (abs(y - source.y) < entryDistance) { entry = p; entryDistance = abs(y - source.y); }
    vec2 uv = (p - hdLightPortalBounds.xy) / hdLightPortalBounds.z;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return 0.0;
    if (!hdLightPortalContains(layer, p, uv)) return 0.0;
  }
  // An opening does not remove the source storey's room partitions. Without
  // this check, a lamp in a sealed bedroom projects a bright portal-shaped
  // patch downstairs even though it cannot reach the stairwell entrance.
  if (crossesStorey) return hdRoomLightFloorCount == 0 ||
    hdRoomLightClearPath(source, entry, lightRoomId) ? 1.0 : 0.0;
  return abs(receiverRoomId - lightRoomId) < 0.5 &&
    hdRoomLightClearPath(source, receiverPlanPosition, lightRoomId) ? 1.0 : 0.0;
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
vec3 hdRoomLightReceiverPoint = hdRoomLightReceiverPosition(hdRoomLightWorldPosition + hdRoomLightReceiverWorldOffset, nonPerturbedNormal);
float hdRoomLightReceiver =
  hdRoomLightFloorCount == 0 && (hdRoomLightWorldPosition.y < hdRoomLightFloorRange.x ||
  hdRoomLightWorldPosition.y > hdRoomLightFloorRange.y)
    ? 0.0
    : hdRoomLightRoomAt(hdRoomLightReceiverPoint);`,
  )
  .replace(
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
    `getPointLightInfo( pointLight, geometryPosition, directLight );
    #ifdef HD_INDIRECT_VISIBILITY
      hdPointVisibility = hdGIDirectVisibility(hdRoomLightWorldPosition, nonPerturbedNormal, hdGIPointIndices[i]);
      directLight.color *= hdPointVisibility >= 0.0 ? hdPointVisibility : hdRoomLightFactor(hdPointLightRoomIds[i], hdRoomLightReceiver, pointLight.position, hdRoomLightReceiverPoint.xz);
    #else
      directLight.color *= hdRoomLightFactor(hdPointLightRoomIds[i], hdRoomLightReceiver, pointLight.position, hdRoomLightReceiverPoint.xz);
    #endif`,
  )
  .replace(
    'getSpotLightInfo( spotLight, geometryPosition, directLight );',
    `getSpotLightInfo( spotLight, geometryPosition, directLight );
    #ifdef HD_INDIRECT_VISIBILITY
      hdSpotVisibility = hdGIDirectVisibility(hdRoomLightWorldPosition, nonPerturbedNormal, hdGISpotIndices[i]);
      directLight.color *= hdSpotVisibility >= 0.0 ? hdSpotVisibility : hdRoomLightFactor(hdSpotLightRoomIds[i], hdRoomLightReceiver, spotLight.position, hdRoomLightReceiverPoint.xz);
    #else
      directLight.color *= hdRoomLightFactor(hdSpotLightRoomIds[i], hdRoomLightReceiver, spotLight.position, hdRoomLightReceiverPoint.xz);
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
    unshadowedPointRoomIds: { value: new Float32Array(ROOM_LIGHT_SHADER_MAX_LIGHTS) },
    unshadowedSpotRoomIds: { value: new Float32Array(ROOM_LIGHT_SHADER_MAX_LIGHTS) },
    portals: { value: maskTexture }, portalBounds: { value: new Vector4(0, 0, 1, 1) },
    portalEdges: { value: maskTexture }, portalEdgeRanges: { value: Array.from({ length: MAX_LIGHT_PORTAL_PLANES }, () => new Vector2()) },
    portalHeights: { value: new Float32Array(MAX_LIGHT_PORTAL_PLANES) }, portalCount: { value: 0 },
    floorCount: { value: 0 }, floorHeights: { value: new Float32Array(MAX_ROOM_LIGHT_FLOORS) },
  }
}

export function applyRoomLightShader(material: Material, uniforms: RoomLightShaderUniforms) {
  materialUniforms.set(material, uniforms)
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
      hdRoomLightFloorCount: uniforms.floorCount, hdRoomLightFloorHeights: uniforms.floorHeights,
      hdRoomLightMask: uniforms.mask,
      hdRoomLightMaskBounds: uniforms.maskBounds,
      hdPointLightRoomIds: uniforms.pointRoomIds,
      hdSpotLightRoomIds: uniforms.spotRoomIds,
      hdLightPortals: uniforms.portals, hdLightPortalBounds: uniforms.portalBounds,
      hdLightPortalEdges: uniforms.portalEdges, hdLightPortalEdgeRanges: uniforms.portalEdgeRanges,
      hdLightPortalHeights: uniforms.portalHeights, hdLightPortalCount: uniforms.portalCount,
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
    const suffix = ':house-designer-room-light-v9'
    // Other lighting hooks can follow this marker in a composed shader key.
    // A fade clone inherits all of them, not just the last hook.
    return /:house-designer-room-light-v\d+/.test(key)
      ? key.replace(/:house-designer-room-light-v\d+/g, suffix) : `${key}${suffix}`
  }

  material.onBeforeCompile = patchedOnBeforeCompile
  material.customProgramCacheKey = patchedProgramCacheKey
  material.needsUpdate = true

  return () => {
    if (materialUniforms.get(material) === uniforms) materialUniforms.delete(material)
    if (material.onBeforeCompile === patchedOnBeforeCompile) {
      material.onBeforeCompile = originalOnBeforeCompile
      material.customProgramCacheKey = originalProgramCacheKey
      material.needsUpdate = true
    }
  }
}
