import {
  DataTexture,
  FloatType,
  RGBAFormat,
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
import { applySunCascadeShader } from './sunCascades.ts'
import { rendererShadowMode, rendererShadowSize } from './rendererRecovery.ts'
import { MAX_LIGHT_PORTAL_PLANES } from './roomLightPortals.ts'
import { INDIRECT_MAX_LOCAL_LIGHTS } from './indirectLighting.ts'
import { captureMaterialShaderKey, composedMaterialShaderKey } from './shaderKeyTransform.ts'
import { roomLightOcclusionGLSL } from './roomLightOcclusion.ts'
import { createLocalShadowAtlasUniforms, localShadowAtlasGLSL, type LocalShadowAtlasUniforms } from './localShadowAtlas.ts'

const ROOM_LIGHT_SHADER_INITIAL_CAPACITY = 11
// Offscreen GI captures provide nearby world-space lights with cached shadows.
export const roomLightCaptureUniform = { value: 0 }

export type RoomLightShaderUniforms = {
  atlasOnly?: boolean
  localShadowAtlas: LocalShadowAtlasUniforms
  pointAtlasIds: { value: Float32Array }
  spotAtlasIds: { value: Float32Array }
  enabled: { value: number }
  floorRange: { value: Vector2 }
  mask: { value: Texture }
  maskBounds: { value: Vector4 }
  boundaries: { value: Texture }
  boundariesReady: { value: number }
  pointRoomIds: { value: Float32Array }
  spotRoomIds: { value: Float32Array }
  unshadowedPointRoomIds: { value: Float32Array }
  unshadowedSpotRoomIds: { value: Float32Array }
  portals: { value: Texture }
  portalEdgeRanges: { value: Vector2[] }
  portalBounds: { value: Vector4 }
  portalHeights: { value: Float32Array }
  portalCount: { value: number }
  floorCount: { value: number }
  floorHeights: { value: Float32Array }
  occlusion: { value: Vector4 }
  occlusionRequired: { value: number }
  pointOcclusionIds: { value: Float32Array }
  spotOcclusionIds: { value: Float32Array }
}
const materialUniforms = new WeakMap<Material, RoomLightShaderUniforms>()
export const getRoomLightUniforms = (material: Material) => materialUniforms.get(material)

const roomLightShaderPars = /* glsl */ `
varying vec3 hdRoomLightWorldPosition;
varying vec3 hdRoomLightReceiverWorldOffset;
uniform float hdPointLightRoomIds[HD_ROOM_LIGHT_CAPACITY];
uniform float hdSpotLightRoomIds[HD_ROOM_LIGHT_CAPACITY];
uniform float hdPointOcclusionIds[HD_ROOM_LIGHT_CAPACITY];
uniform float hdSpotOcclusionIds[HD_ROOM_LIGHT_CAPACITY];
uniform int hdRoomLightVisibilityCount;
#ifdef HD_GI_CAPTURE_VISIBILITY
// Capture already uses the GI visibility atlas. The display room/portal mask
// is disabled for every capture, so do not retain its texture samplers.
float hdRoomLightFactor(float lightRoomId, float receiverRoomId, vec3 lightPosition, vec3 receiver, float occlusionIndex) { return 1.0; }
#else
uniform float hdRoomLightEnabled;
uniform float hdRoomLightCapture;
uniform sampler2D hdRoomLightMask;
uniform sampler2D hdRoomLightBoundaries;
uniform float hdRoomLightBoundariesReady;
uniform vec4 hdRoomLightMaskBounds;
uniform vec2 hdRoomLightFloorRange;
uniform int hdRoomLightFloorCount;
uniform float hdRoomLightFloorHeights[${MAX_ROOM_LIGHT_FLOORS}];
uniform sampler2D hdLightPortals;
uniform vec2 hdLightPortalEdgeRanges[${MAX_LIGHT_PORTAL_PLANES}];
uniform vec4 hdLightPortalBounds;
uniform float hdLightPortalHeights[${MAX_LIGHT_PORTAL_PLANES}];
uniform int hdLightPortalCount;
vec4 hdLightPortalRecord(int index) {
  int width = textureSize(hdRoomLightBoundaries, 0).x;
  return texelFetch(hdRoomLightBoundaries, ivec2(index % width, index / width), 0);
}
${roomLightOcclusionGLSL}
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
float hdGIPointIndex(int index);
float hdGISpotIndex(int index);
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
  return worldPosition;
}

// The room lookup needs an interior point, but visibility must end at the
// actual receiver. Sharing this offset detached wall shadows from ceilings.
vec3 hdRoomLightClassificationPosition(vec3 worldPosition, vec3 viewNormal) {
  vec3 worldNormal = transformNormalByInverseViewMatrix(viewNormal, viewMatrix);
  vec2 planPosition = worldPosition.xz;
  float horizontalLength = length(worldNormal.xz);
  if (horizontalLength > 0.35) {
    planPosition += worldNormal.xz / horizontalLength * 0.08;
  }
  return vec3(planPosition.x, worldPosition.y, planPosition.y);
}

vec4 hdRoomLightBoundaryRecord(int index) {
  int width = textureSize(hdRoomLightBoundaries, 0).x;
  return texelFetch(hdRoomLightBoundaries, ivec2(index % width, index / width), 0);
}
float hdRoomLightCross(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

// Exact edges of the room union replace a walk through enlarged mask cells.
// Endpoints on a wall are receivers, not blockers; only crossings before the
// receiver obstruct light. The tolerance is 0.1 mm in world space.
bool hdRoomLightClearPath(vec3 source, vec2 destination, float roomId) {
  if (hdRoomLightBoundariesReady < .5) return true;
  vec2 delta = destination - source.xz;
  float distance = length(delta);
  if (distance < .0001) return true;
  vec2 range = hdRoomLightBoundaryRecord(int(roomId + .5)).xy;
  for (int i = int(range.x); i < int(range.y); i++) {
    vec4 segment = hdRoomLightBoundaryRecord(i);
    vec2 edge = segment.zw - segment.xy;
    float denominator = hdRoomLightCross(delta, edge);
    if (abs(denominator) < 1e-10) continue;
    vec2 relative = segment.xy - source.xz;
    float t = hdRoomLightCross(relative, edge) / denominator;
    float u = hdRoomLightCross(relative, delta) / denominator;
    if (t > .0001 / distance && t < 1.0 - .0001 / distance && u >= 0.0 && u <= 1.0) return false;
  }
  return true;
}

vec3 hdRoomLightWorldSource(vec3 viewPosition) {
  return cameraPosition + vec3(dot(viewMatrix[0].xyz, viewPosition), dot(viewMatrix[1].xyz, viewPosition), dot(viewMatrix[2].xyz, viewPosition));
}
float hdRoomLightFactor(float lightRoomId, float receiverRoomId, vec3 lightPosition, vec3 receiver, float occlusionIndex) {
  if (hdRoomLightCapture > 0.5 || hdRoomLightEnabled < 0.5 || lightRoomId < 0.5) return 1.0;
  vec3 source = hdRoomLightWorldSource(lightPosition);
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
  if (crossesStorey) {
    if (hdRoomLightFloorCount > 0 && !hdRoomLightClearPath(source, entry, lightRoomId)) return 0.0;
    return hdRoomStoreyVisibility(occlusionIndex, source, receiver);
  }
  return abs(receiverRoomId - lightRoomId) < 0.5 &&
    hdRoomLightClearPath(source, receiver.xz, lightRoomId) ? 1.0 : 0.0;
}
#endif
`

const maskedLightsChunk = ShaderChunk.lights_fragment_begin
  // Receiver derivatives require uniform control flow across a fragment quad,
  // including the edge of a spot cone or a light's distance limit. Zero light
  // colour already rejects those fragments after the shadow comparison.
  .replaceAll('directLight.visible && receiveShadow', 'receiveShadow')
  .replace(
    'vec3 geometryNormal = normal;',
    `vec3 geometryNormal = normal;
#ifdef HD_GI_CAPTURE_VISIBILITY
vec3 hdRoomLightReceiverPoint = hdRoomLightWorldPosition;
float hdRoomLightReceiver = 0.0;
#else
vec3 hdRoomLightReceiverPoint = hdRoomLightReceiverPosition(hdRoomLightWorldPosition + hdRoomLightReceiverWorldOffset, nonPerturbedNormal);
float hdRoomLightReceiver =
  hdRoomLightFloorCount == 0 && (hdRoomLightWorldPosition.y < hdRoomLightFloorRange.x ||
  hdRoomLightWorldPosition.y > hdRoomLightFloorRange.y)
    ? 0.0
    : hdRoomLightRoomAt(hdRoomLightClassificationPosition(hdRoomLightReceiverPoint, nonPerturbedNormal));
#endif
// Evaluate geometric derivatives before any light-dependent branches. Smooth
// shading normals on furniture do not describe the triangle in the depth map.
vec3 hdLocalShadowPlane = cross(dFdx(hdRoomLightWorldPosition), dFdy(hdRoomLightWorldPosition));
vec3 hdLocalShadowShadingNormal = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
float hdLocalShadowPlaneLength = length(hdLocalShadowPlane);
vec3 hdLocalShadowNormal = hdLocalShadowPlaneLength > 1e-12 ? hdLocalShadowPlane / hdLocalShadowPlaneLength : hdLocalShadowShadingNormal;
if (dot(hdLocalShadowNormal, hdLocalShadowShadingNormal) < 0.0) hdLocalShadowNormal = -hdLocalShadowNormal;
// Three unrolls its PBR light loops, including the injected room/portal test.
// Evaluate visibility in a uniform-bounded loop first so the driver compiles
// one copy of that geometry test instead of one copy for every light slot.
#if NUM_POINT_LIGHTS > 0
float hdPointVisibilities[NUM_POINT_LIGHTS];
for (int hdIndex = 0; hdIndex < hdRoomLightVisibilityCount; hdIndex++) {
  if (hdIndex >= NUM_POINT_LIGHTS) break;
  /* HD_ZERO_LIGHT_BEGIN */
  // Match Three's exact zero contribution test before tracing room geometry.
  // Receiver derivatives are already evaluated outside this loop. Shadow
  // receiver derivatives in the later PBR loop remain unconditional.
  IncidentLight hdCandidate;
  getPointLightInfo(pointLights[hdIndex], geometryPosition, hdCandidate);
  hdPointVisibilities[hdIndex] = 1.0;
  if (hdCandidate.visible) {
  /* HD_ZERO_LIGHT_END */
  #ifdef HD_GI_CAPTURE_VISIBILITY
    // Capture uses GI visibility; display-only uniforms and atlas samplers are
    // deliberately omitted from this variant.
    float visibility = -1.0;
  #else
    float visibility = hdRoomLightCapture > .5 ? -1.0 : hdLocalAtlasVisibility(hdPointAtlasIds[hdIndex], hdRoomLightWorldPosition, hdLocalShadowNormal);
  #endif
  #ifdef HD_INDIRECT_VISIBILITY
    if (visibility < 0.0) visibility = hdGIDirectVisibility(hdRoomLightWorldPosition, nonPerturbedNormal, hdGIPointIndex(hdIndex));
  #endif
  hdPointVisibilities[hdIndex] = visibility >= 0.0 ? visibility :
    hdRoomLightFactor(hdIndex < HD_ROOM_LIGHT_CAPACITY ? hdPointLightRoomIds[hdIndex] : 0.0,
      hdRoomLightReceiver, pointLights[hdIndex].position, hdRoomLightReceiverPoint,
      hdIndex < HD_ROOM_LIGHT_CAPACITY ? hdPointOcclusionIds[hdIndex] : -1.0);
  /* HD_ZERO_LIGHT_BEGIN */
  }
  /* HD_ZERO_LIGHT_END */
}
#endif
#if NUM_SPOT_LIGHTS > 0
float hdSpotVisibilities[NUM_SPOT_LIGHTS];
for (int hdIndex = 0; hdIndex < hdRoomLightVisibilityCount; hdIndex++) {
  if (hdIndex >= NUM_SPOT_LIGHTS) break;
  /* HD_ZERO_LIGHT_BEGIN */
  IncidentLight hdCandidate;
  getSpotLightInfo(spotLights[hdIndex], geometryPosition, hdCandidate);
  hdSpotVisibilities[hdIndex] = 1.0;
  if (hdCandidate.visible) {
  /* HD_ZERO_LIGHT_END */
  #ifdef HD_GI_CAPTURE_VISIBILITY
    float visibility = -1.0;
  #else
    float visibility = hdRoomLightCapture > .5 ? -1.0 : hdLocalAtlasVisibility(hdSpotAtlasIds[hdIndex], hdRoomLightWorldPosition, hdLocalShadowNormal);
  #endif
  #ifdef HD_INDIRECT_VISIBILITY
    if (visibility < 0.0) visibility = hdGIDirectVisibility(hdRoomLightWorldPosition, nonPerturbedNormal, hdGISpotIndex(hdIndex));
  #endif
  hdSpotVisibilities[hdIndex] = visibility >= 0.0 ? visibility :
    hdRoomLightFactor(hdIndex < HD_ROOM_LIGHT_CAPACITY ? hdSpotLightRoomIds[hdIndex] : 0.0,
      hdRoomLightReceiver, spotLights[hdIndex].position, hdRoomLightReceiverPoint,
      hdIndex < HD_ROOM_LIGHT_CAPACITY ? hdSpotOcclusionIds[hdIndex] : -1.0);
  /* HD_ZERO_LIGHT_BEGIN */
  }
  /* HD_ZERO_LIGHT_END */
}
#endif`,
  )
  .replace(
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
    `getPointLightInfo( pointLight, geometryPosition, directLight );
    directLight.color *= hdPointVisibilities[i];`,
  )
  .replace(
    'getSpotLightInfo( spotLight, geometryPosition, directLight );',
    `getSpotLightInfo( spotLight, geometryPosition, directLight );
    directLight.color *= hdSpotVisibilities[i];`,
  )

// The editor has persistent geometry shadow tiles for every local lamp. Its
// display path needs neither the old room/portal ray fallback nor its receiver
// classification. Capture shaders still use their own GI visibility data.
const atlasLightPars = /* glsl */ `
varying vec3 hdRoomLightWorldPosition;
varying vec3 hdRoomLightReceiverWorldOffset;
uniform int hdRoomLightVisibilityCount;
uniform float hdRoomLightCapture;
uniform float hdLocalShadowAtlasRequested;
#ifdef HD_INDIRECT_VISIBILITY
float hdGIDirectVisibility(vec3 p, vec3 viewNormal, float index);
float hdGIPointIndex(int index);
float hdGISpotIndex(int index);
#endif
float hdAtlasMissingVisibility() {
  #ifdef HD_GI_CAPTURE_VISIBILITY
    return 1.0;
  #else
    // A new/moved light must wait for its own tiles, not leak through walls or
    // borrow another lamp's shadow. Explicitly disabled shadows remain lit.
    return hdLocalShadowAtlasRequested > .5 ? 0.0 : 1.0;
  #endif
}
`
const atlasLightsChunk = maskedLightsChunk
  .replace(/#ifdef HD_GI_CAPTURE_VISIBILITY\nvec3 hdRoomLightReceiverPoint[\s\S]*?#endif\n/, '')
  .replace(/hdRoomLightFactor\(hdIndex < HD_ROOM_LIGHT_CAPACITY[\s\S]*?: -1\.0\);/g, 'hdAtlasMissingVisibility();')

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

export function createRoomLightBoundaryTexture(mask: RoomLightMask) {
  const count = mask.boundaries.length / 4, width = Math.min(1024, Math.max(1, count));
  const height = Math.max(1, Math.ceil(count / width));
  const data = new Float32Array(width * height * 4); data.set(mask.boundaries)
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType)
  texture.minFilter = texture.magFilter = NearestFilter
  texture.generateMipmaps = false; texture.needsUpdate = true
  return texture
}

export function createRoomLightShaderUniforms(maskTexture: Texture, boundaries?: Texture, atlasOnly = false): RoomLightShaderUniforms {
  return {
    atlasOnly,
    enabled: { value: 0 },
    floorRange: { value: new Vector2() },
    mask: { value: maskTexture },
    boundaries: { value: boundaries ?? maskTexture }, boundariesReady: { value: boundaries ? 1 : 0 },
    maskBounds: { value: new Vector4() },
    localShadowAtlas: createLocalShadowAtlasUniforms(),
    pointAtlasIds: { value: new Float32Array(ROOM_LIGHT_SHADER_INITIAL_CAPACITY).fill(-1) },
    spotAtlasIds: { value: new Float32Array(ROOM_LIGHT_SHADER_INITIAL_CAPACITY).fill(-1) },
    pointRoomIds: { value: new Float32Array(ROOM_LIGHT_SHADER_INITIAL_CAPACITY) },
    spotRoomIds: { value: new Float32Array(ROOM_LIGHT_SHADER_INITIAL_CAPACITY) },
    unshadowedPointRoomIds: { value: new Float32Array(ROOM_LIGHT_SHADER_INITIAL_CAPACITY) },
    unshadowedSpotRoomIds: { value: new Float32Array(ROOM_LIGHT_SHADER_INITIAL_CAPACITY) },
    portals: { value: maskTexture }, portalBounds: { value: new Vector4(0, 0, 1, 1) },
    portalEdgeRanges: { value: Array.from({ length: MAX_LIGHT_PORTAL_PLANES }, () => new Vector2()) },
    portalHeights: { value: new Float32Array(MAX_LIGHT_PORTAL_PLANES) }, portalCount: { value: 0 },
    floorCount: { value: 0 }, floorHeights: { value: new Float32Array(MAX_ROOM_LIGHT_FLOORS) },
    occlusion: { value: new Vector4() }, occlusionRequired: { value: 0 },
    pointOcclusionIds: { value: new Float32Array(ROOM_LIGHT_SHADER_INITIAL_CAPACITY).fill(-1) },
    spotOcclusionIds: { value: new Float32Array(ROOM_LIGHT_SHADER_INITIAL_CAPACITY).fill(-1) },
  }
}

/** Match allocated light pools, rather than reserving 128 uniform entries for
 * every material on smaller GPUs. Mutate values, preserving shared bindings. */
export function resizeRoomLightShaderUniforms(uniforms: RoomLightShaderUniforms, requestedCapacity: number) {
  const capacity = Math.max(ROOM_LIGHT_SHADER_INITIAL_CAPACITY, requestedCapacity)
  if (uniforms.pointRoomIds.value.length === capacity) return false
  for (const key of ['pointRoomIds', 'spotRoomIds', 'unshadowedPointRoomIds', 'unshadowedSpotRoomIds',
    'pointOcclusionIds', 'spotOcclusionIds', 'pointAtlasIds', 'spotAtlasIds'] as const) {
    const previous = uniforms[key].value
    const value = new Float32Array(capacity).fill(key.includes('Occlusion') || key.includes('Atlas') ? -1 : 0)
    value.set(previous.subarray(0, capacity))
    uniforms[key].value = value
  }
  return true
}

export function applyRoomLightShader(material: Material, uniforms: RoomLightShaderUniforms) {
  materialUniforms.set(material, uniforms)
  const attributes = material as Material & { defaultAttributeValues?: Record<string, number[]> }
  attributes.defaultAttributeValues = { ...attributes.defaultAttributeValues, hdGIReceiverOffset: [0, 0, 0] }
  const originalOnBeforeCompile = material.onBeforeCompile
  const originalProgramCacheKey = material.customProgramCacheKey
  const upstreamKey = captureMaterialShaderKey(material)
  const patchedOnBeforeCompile: Material['onBeforeCompile'] = (shader, renderer) => {
    originalOnBeforeCompile.call(material, shader, renderer)
    if (shader.fragmentShader.includes('hdRoomLightFactor') || shader.fragmentShader.includes('hdAtlasMissingVisibility')) return
    applyLocalShadowReceiver(shader, renderer)
    Object.assign(shader.uniforms, {
      hdRoomLightEnabled: uniforms.enabled,
      hdRoomLightCapture: roomLightCaptureUniform,
      ...uniforms.localShadowAtlas,
      hdPointAtlasIds: uniforms.pointAtlasIds,
      hdSpotAtlasIds: uniforms.spotAtlasIds,
      hdRoomLightFloorRange: uniforms.floorRange,
      hdRoomLightFloorCount: uniforms.floorCount, hdRoomLightFloorHeights: uniforms.floorHeights,
      hdRoomLightMask: uniforms.mask,
      hdRoomLightBoundaries: uniforms.boundaries, hdRoomLightBoundariesReady: uniforms.boundariesReady,
      hdRoomLightMaskBounds: uniforms.maskBounds,
      hdPointLightRoomIds: uniforms.pointRoomIds,
      hdSpotLightRoomIds: uniforms.spotRoomIds,
      hdRoomLightVisibilityCount: { value: INDIRECT_MAX_LOCAL_LIGHTS },
      hdLightPortals: uniforms.portals, hdLightPortalBounds: uniforms.portalBounds,
      hdLightPortalEdgeRanges: uniforms.portalEdgeRanges,
      hdLightPortalHeights: uniforms.portalHeights, hdLightPortalCount: uniforms.portalCount,
      hdRoomOcclusion: uniforms.occlusion, hdRoomOcclusionRequired: uniforms.occlusionRequired,
      hdPointOcclusionIds: uniforms.pointOcclusionIds, hdSpotOcclusionIds: uniforms.spotOcclusionIds,
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
      .replace('#include <common>', `#include <common>\n#define HD_ROOM_LIGHT_CAPACITY ${uniforms.pointRoomIds.value.length}\n${localShadowAtlasGLSL}\n${uniforms.atlasOnly ? atlasLightPars : roomLightShaderPars}`)
      .replace('#include <lights_fragment_begin>', `#ifdef HD_GI_NATIVE_CAPTURE\n${ShaderChunk.lights_fragment_begin}\n#else\n${uniforms.atlasOnly ? atlasLightsChunk : maskedLightsChunk}\n#endif`)
    if (rendererShadowMode === 'cascaded') applySunCascadeShader(shader, renderer)
  }
  const roomKeySuffix = `:house-designer-room-light-v${uniforms.atlasOnly ? 30 : 29}-${rendererShadowMode}-${rendererShadowSize}`
  const transformKey = composedMaterialShaderKey()
  const patchedProgramCacheKey = () => transformKey(upstreamKey(), `${roomKeySuffix}-capacity${uniforms.pointRoomIds.value.length}`)

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
