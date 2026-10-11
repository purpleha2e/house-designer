import { Vector2, Vector3, Vector4, type Material, type Texture } from 'three'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MAX_FLOORS, INDIRECT_MAX_LOCAL_LIGHTS, type IndirectField } from './indirectLighting.ts'
import { INDIRECT_VOLUME_HEIGHT, INDIRECT_VOLUME_STRIDE } from './indirectVolume.ts'

export function createIndirectUniforms(field: IndirectField) {
  return {
    hdGIEnabled: { value: 1 }, hdGICapture: { value: 0 }, hdGIIndoorFill: { value: .025 },
    hdGIProbeStrength: { value: 1 },
    hdGIMask: { value: field.mask as Texture }, hdGIPositions: { value: field.positions as Texture },
    hdGIDistances: { value: field.distances as Texture },
    hdGIDistanceLayout: { value: new Vector3(field.distanceColumns, field.distanceRows, field.distanceSize) },
    hdGITriangles: { value: field.positions as Texture },
    hdGITriangleSize: { value: new Vector2(INDIRECT_ATLAS_SIZE, INDIRECT_ATLAS_SIZE) },
    hdGIPointIndices: { value: new Float32Array(11).fill(-1) }, hdGISpotIndices: { value: new Float32Array(11).fill(-1) },
    hdGIUseVolume: { value: 0 }, hdGIVolume: { value: field.volume.maps[0] as Texture },
    hdGIVolumeSize: { value: new Vector2(field.volume.n, field.volume.height) },
    hdGIFloorLayer: { value: field.floorLayer.texture as Texture },
    hdGIFloorLayerSize: { value: new Vector2(field.floorLayer.n, field.floorLayer.height) },
    hdGIFloorLayerReady: { value: field.floorLayer.ready ? 1 : 0 },
    hdGIRed: { value: field.maps[0] as Texture }, hdGIGreen: { value: field.maps[1] as Texture }, hdGIBlue: { value: field.maps[2] as Texture },
    hdGIBounds: { value: new Vector3(field.bounds.minX, field.bounds.minZ, field.bounds.size) },
    hdGIFloorCount: { value: field.floors.length },
    hdGIFloorRanges: { value: field.ranges.map(range => new Vector2(range.bottom, range.top)) },
    hdGIGrids: { value: field.grids.map(grid => new Vector4(grid.lower, grid.upper, grid.start, 0)) },
    hdGIGrid: { value: new Vector4(field.bounds.minX, field.bounds.minZ, field.spacing, field.n) },
    hdGIMaskSize: { value: new Vector4(1, Math.max(1, field.floors.length), 0, 0) },
  }
}
export type IndirectUniforms = ReturnType<typeof createIndirectUniforms>
const localReflectionUniforms = new WeakMap<Material, { value: number }>()
export function setIndirectLocalReflection(material: Material, enabled: boolean) {
  const uniform = localReflectionUniforms.get(material)
  if (uniform) uniform.value = enabled ? 1 : 0
}

export function updateIndirectUniforms(uniforms: IndirectUniforms, field: IndirectField) {
  // Preserve uniform object identity while upgrading a running editor on HMR.
  uniforms.hdGIProbeStrength ??= { value: 1 }
  uniforms.hdGIFloorLayer ??= { value: field.floorLayer.texture }
  uniforms.hdGIFloorLayerSize ??= { value: new Vector2() }
  uniforms.hdGIFloorLayerReady ??= { value: 0 }
  uniforms.hdGITriangles ??= { value: field.positions }
  uniforms.hdGITriangleSize ??= { value: new Vector2(INDIRECT_ATLAS_SIZE, INDIRECT_ATLAS_SIZE) }
  if (!(uniforms.hdGIDistanceLayout.value instanceof Vector3)) uniforms.hdGIDistanceLayout.value = new Vector3()
  uniforms.hdGIMask.value = field.mask; uniforms.hdGIPositions.value = field.positions; uniforms.hdGIDistances.value = field.distances
  uniforms.hdGIDistanceLayout.value.set(field.distanceColumns, field.distanceRows, field.distanceSize)
  if (uniforms.hdGIVolume.value !== field.volume.maps[0]) uniforms.hdGIUseVolume.value = 0
  uniforms.hdGIVolume.value = field.volume.maps[0]
  uniforms.hdGIVolumeSize.value.set(field.volume.n, field.volume.height)
  uniforms.hdGIFloorLayer.value = field.floorLayer.texture
  uniforms.hdGIFloorLayerSize.value.set(field.floorLayer.n, field.floorLayer.height)
  uniforms.hdGIFloorLayerReady.value = field.floorLayer.ready ? 1 : 0
  uniforms.hdGIRed.value = field.maps[0]; uniforms.hdGIGreen.value = field.maps[1]; uniforms.hdGIBlue.value = field.maps[2]
  uniforms.hdGIBounds.value.set(field.bounds.minX, field.bounds.minZ, field.bounds.size)
  uniforms.hdGIFloorCount.value = field.floors.length
  field.ranges.forEach((range, i) => uniforms.hdGIFloorRanges.value[i].set(range.bottom, range.top))
  field.grids.forEach((grid, i) => uniforms.hdGIGrids.value[i].set(grid.lower, grid.upper, grid.start, 0))
  uniforms.hdGIGrid.value.set(field.bounds.minX, field.bounds.minZ, field.spacing, field.n)
  uniforms.hdGIMaskSize.value.y = Math.max(1, field.floors.length)
}

const declarations = /* glsl */ `
varying vec3 hdGIWorldPosition;
uniform float hdGIEnabled;
uniform float hdGICapture;
uniform float hdGIIndoorFill;
uniform float hdGIProbeStrength;
uniform float hdGILocalReflection;
uniform sampler2D hdGIMask;
uniform sampler2D hdGIPositions;
uniform sampler2D hdGIDistances;
uniform vec3 hdGIDistanceLayout;
uniform sampler2D hdGITriangles;
uniform vec2 hdGITriangleSize;
uniform float hdGIPointIndices[11];
uniform float hdGISpotIndices[11];
uniform float hdGIUseVolume;
uniform sampler3D hdGIVolume;
uniform vec2 hdGIVolumeSize;
uniform sampler3D hdGIFloorLayer;
uniform vec2 hdGIFloorLayerSize;
uniform float hdGIFloorLayerReady;
uniform sampler2D hdGIRed;
uniform sampler2D hdGIGreen;
uniform sampler2D hdGIBlue;
uniform vec3 hdGIBounds;
uniform int hdGIFloorCount;
uniform vec2 hdGIFloorRanges[${INDIRECT_MAX_FLOORS}];
uniform vec4 hdGIGrids[${INDIRECT_MAX_FLOORS}];
uniform vec4 hdGIGrid;
uniform vec4 hdGIMaskSize;

float hdGIFloor(vec3 p) {
  vec2 uv = (p.xz - hdGIBounds.xy) / hdGIBounds.z;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return -1.0;
  for (int floorIndex = 0; floorIndex < ${INDIRECT_MAX_FLOORS}; floorIndex++) {
    if (floorIndex >= hdGIFloorCount) break;
    vec2 range = hdGIFloorRanges[floorIndex];
    if (p.y >= range.x && p.y < range.y) {
      // Occupancy distinguishes inside from outside, never one room from another.
      vec3 mask = texture2D(hdGIMask, vec2(uv.x, (uv.y + float(floorIndex)) / hdGIMaskSize.y)).rgb;
      float ceiling = mix(range.x, range.y, dot(mask.gb, vec2(65280.0, 255.0)) / 65535.0);
      return mask.r > .5 && p.y <= ceiling ? float(floorIndex) : -1.0;
    }
  }
  return -1.0;
}

vec2 hdGIOctUV(vec3 direction) {
  vec3 n = direction / max(abs(direction.x) + abs(direction.y) + abs(direction.z), .0001);
  vec2 uv = n.xy;
  if (n.z < 0.0) uv = (1.0 - abs(uv.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), uv));
  return uv * .5 + .5;
}

vec3 hdGIOctDirection(vec2 uv) {
  vec2 xy = uv * 2.0 - 1.0;
  vec3 n = vec3(xy, 1.0 - abs(xy.x) - abs(xy.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), n.xy));
  return normalize(n);
}

vec4 hdGITriangleVertex(float index) {
  return texture2D(hdGITriangles, (vec2(mod(index, hdGITriangleSize.x), floor(index / hdGITriangleSize.x)) + .5) / hdGITriangleSize);
}

float hdGITriangleBlocks(float offset, vec3 origin, vec3 direction, float distanceToReceiver) {
  vec3 a = hdGITriangleVertex(offset).xyz;
  vec3 e1 = hdGITriangleVertex(offset + 1.0).xyz - a;
  vec3 e2 = hdGITriangleVertex(offset + 2.0).xyz - a;
  vec3 h = cross(direction, e2);
  float determinant = dot(e1, h);
  if (abs(determinant) < .00000001) return 0.0;
  vec3 s = origin - a;
  float u = dot(s, h) / determinant;
  vec3 q = cross(s, e1);
  float v = dot(direction, q) / determinant;
  float t = dot(e2, q) / determinant;
  if (t <= .00001 || t >= 1.0 - .002 / distanceToReceiver) return 0.0;
  if (u >= -.00001 && v >= -.00001 && u + v <= 1.00001) return 1.0;
  // Close millimetre seams without extending a thin triangle's infinite plane.
  vec3 point = origin + direction * t - a;
  vec3 e3 = e2 - e1, pointB = point - e1;
  float edgeA = length(point - e1 * clamp(dot(point, e1) / max(dot(e1, e1), .00000001), 0.0, 1.0));
  float edgeB = length(point - e2 * clamp(dot(point, e2) / max(dot(e2, e2), .00000001), 0.0, 1.0));
  float edgeC = length(pointB - e3 * clamp(dot(pointB, e3) / max(dot(e3, e3), .00000001), 0.0, 1.0));
  return min(edgeA, min(edgeB, edgeC)) <= .003 ? 1.0 : 0.0;
}

float hdGIPrimitiveBlocks(float id, vec3 origin, vec3 direction, float distanceToReceiver) {
  float offset = (id - 1.0) * 7.0;
  vec4 plane = hdGITriangleVertex(offset);
  if (dot(plane.xyz, plane.xyz) > .5) {
    float denominator = dot(plane.xyz, direction);
    if (abs(denominator) < .00000001) return 0.0;
    float t = (plane.w - dot(plane.xyz, origin)) / denominator;
    if (t <= .00001 || t >= 1.0 - .002 / distanceToReceiver) return 0.0;
  }
  if (hdGITriangleBlocks(offset + 1.0, origin, direction, distanceToReceiver) > .5) return 1.0;
  return hdGITriangleBlocks(offset + 4.0, origin, direction, distanceToReceiver);
}

float hdGIVisibility(float index, vec3 p, out vec3 probePosition) {
  vec2 tile = vec2(mod(index, ${INDIRECT_ATLAS_SIZE}.0), floor(index / ${INDIRECT_ATLAS_SIZE}.0));
  vec4 probe = texture2D(hdGIPositions, (tile + .5) / ${INDIRECT_ATLAS_SIZE}.0);
  probePosition = probe.xyz;
  if (probe.w < .5) return -1.0;
  float lightIndex = index - ${INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS}.0;
  if (lightIndex < 0.0 || lightIndex >= hdGIDistanceLayout.x * hdGIDistanceLayout.y) return -1.0;
  vec2 lightTile = vec2(mod(lightIndex, hdGIDistanceLayout.x), floor(lightIndex / hdGIDistanceLayout.x));
  vec3 direction = p - probe.xyz;
  float distanceToProbe = length(direction);
  if (distanceToProbe < .001) return 1.0;
  float size = hdGIDistanceLayout.z;
  vec2 pixel = clamp(hdGIOctUV(direction) * size - .5, vec2(0.0), vec2(size - 1.0));
  vec2 base = floor(pixel);
  vec4 candidates = vec4(0.0);
  for (int corner = 0; corner < 4; corner++) {
    vec2 c = vec2(float(corner - (corner / 2) * 2), float(corner / 2));
    vec2 sampleUV = (min(base + c, vec2(size - 1.0)) + .5) / size;
    candidates[corner] = texture2D(hdGIDistances, (lightTile + sampleUV) / hdGIDistanceLayout.xy).r;
  }
  for (int corner = 0; corner < 4; corner++) {
    float id = candidates[corner];
    if (id < .5 || (corner > 0 && id == candidates.x) || (corner > 1 && id == candidates.y) ||
      (corner > 2 && id == candidates.z)) continue;
    if (hdGIPrimitiveBlocks(id, probe.xyz, direction, distanceToProbe) > .5) return 0.0;
  }
  return 1.0;
}

float hdGIDirectVisibility(vec3 p, vec3 viewNormal, float index) {
  // Cached lamp occlusion only supplies direct radiance to the GI bake.
  // Displayed direct shadows remain controlled by Light shadows.
  if (hdGICapture < .5 || hdGIEnabled < .5 || index < 0.0) return -1.0;
  vec3 n = normalize(transformNormalByInverseViewMatrix(viewNormal, viewMatrix));
  vec3 probePosition;
  return hdGIVisibility(index, p + n * .004, probePosition);
}

vec3 hdGIVolumeIrradiance(float floorIndex, vec3 p, vec3 n, float floorReceiver, out vec3 meanLight) {
  meanLight = vec3(0.0);
  if (hdGIUseVolume < .5) return vec3(0.0);
  vec2 range = hdGIFloorRanges[int(floorIndex)];
  vec2 plan = clamp((p.xz - hdGIBounds.xy) / hdGIBounds.z, vec2(0.0), vec2(1.0));
  vec2 volumePlan = (plan * (hdGIVolumeSize.x - 1.0) + .5) / hdGIVolumeSize.x;
  float height = clamp((p.y - range.x) / (range.y - range.x), 0.0, 1.0);
  vec3 uv = vec3(volumePlan.x, (floorIndex * ${INDIRECT_VOLUME_STRIDE}.0 + 1.5 + height * ${INDIRECT_VOLUME_HEIGHT - 1}.0) / hdGIVolumeSize.y, volumePlan.y);
  uv.y *= .25;
  vec4 c0; vec3 c1, c2, c3;
  if (floorReceiver > .5) {
    vec2 floorPlan = (plan * (hdGIFloorLayerSize.x - 1.0) + .5) / hdGIFloorLayerSize.x;
    vec3 floorUV = vec3(floorPlan.x, (floorIndex + .5) / (hdGIFloorLayerSize.y * 4.0), floorPlan.y);
    c0 = texture(hdGIFloorLayer, floorUV);
    c1 = texture(hdGIFloorLayer, floorUV + vec3(0.0, .25, 0.0)).rgb;
    c2 = texture(hdGIFloorLayer, floorUV + vec3(0.0, .5, 0.0)).rgb;
    c3 = texture(hdGIFloorLayer, floorUV + vec3(0.0, .75, 0.0)).rgb;
  } else {
    c0 = texture(hdGIVolume, uv);
    c1 = texture(hdGIVolume, uv + vec3(0.0, .25, 0.0)).rgb;
    c2 = texture(hdGIVolume, uv + vec3(0.0, .5, 0.0)).rgb;
    c3 = texture(hdGIVolume, uv + vec3(0.0, .75, 0.0)).rgb;
  }
  // Missing support inside a solid is not black illumination. Renormalize the
  // hardware filter, while retaining genuinely dark but valid samples.
  float coverage = max(c0.a, .00001);
  meanLight = c0.rgb * (.886227 / coverage);
  vec4 basis = vec4(.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x);
  return max((c0.rgb * basis.x + c1 * basis.y + c2 * basis.z + c3 * basis.w) / coverage, vec3(0.0));
}
`

/** All PBR surfaces share position-dependent diffuse lighting, including instances. */
export function applyIndirectLightingShader(material: Material, uniforms: IndirectUniforms) {
  const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey
  const localReflection = { value: 0 }
  localReflectionUniforms.set(material, localReflection)
  const hook: Material['onBeforeCompile'] = (shader, renderer) => {
    compile.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.uniforms.hdGILocalReflection = localReflection
    if (shader.fragmentShader.includes('float hdGIFloor(')) return
    shader.fragmentShader = '#define HD_INDIRECT_VISIBILITY\n' + shader.fragmentShader
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hdGIWorldPosition;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 hdGIWorld = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          hdGIWorld = batchingMatrix * hdGIWorld;
        #endif
        #ifdef USE_INSTANCING
          hdGIWorld = instanceMatrix * hdGIWorld;
        #endif
        hdGIWorldPosition = (modelMatrix * hdGIWorld).xyz;`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${declarations}`)
      .replace('#include <lights_fragment_end>', `
        #if defined(RE_IndirectDiffuse) && defined(RE_IndirectSpecular)
        if (hdGIEnabled > .5) {
          vec3 hdGINormal = normalize(transformNormalByInverseViewMatrix(geometryNormal, viewMatrix));
          vec3 hdGISurfaceNormal = normalize(transformNormalByInverseViewMatrix(nonPerturbedNormal, viewMatrix));
          float hdGIId = hdGIFloor(hdGIWorldPosition + hdGISurfaceNormal * .08);
          // Environment lighting supplies reflections; scene probes supply indoor diffuse.
          iblIrradiance = vec3(0.0);
          if (hdGIId >= 0.0) {
            vec3 hdGIMean;
            vec2 hdGIRange = hdGIFloorRanges[int(hdGIId)];
            vec3 hdGIStep = vec3(hdGIBounds.z / (hdGIVolumeSize.x - 1.0),
              (hdGIRange.y - hdGIRange.x) / ${INDIRECT_VOLUME_HEIGHT - 1}.0, hdGIBounds.z / (hdGIVolumeSize.x - 1.0));
            // Offset toward the receiving side by half a voxel footprint.
            float hdGIFloorHeight = hdGIRange.x + .06;
            float hdGIFloorReceiver = hdGIFloorLayerReady > .5 && hdGISurfaceNormal.y > .9 &&
              hdGIWorldPosition.y >= hdGIFloorHeight - .02 && hdGIWorldPosition.y <= hdGIFloorHeight + .08 ? 1.0 : 0.0;
            float hdGIBias = hdGIFloorReceiver > .5 ? .004 : .02 + .5 * dot(abs(hdGISurfaceNormal), hdGIStep);
            vec3 hdGIPosition = hdGIWorldPosition + hdGISurfaceNormal * hdGIBias;
            vec3 hdGILight = hdGIVolumeIrradiance(hdGIId, hdGIPosition, hdGINormal, hdGIFloorReceiver, hdGIMean);
            irradiance = hdGICapture > .5 && hdGICapture < 1.5 ? vec3(0.0)
              : hdGILight * (hdGICapture > .5 ? 1.0 : hdGIProbeStrength) + vec3(hdGICapture > .5 ? 0.0 : hdGIIndoorFill);
            // The studio reflection fallback must not illuminate enclosed interiors.
            float hdGIReflectionVisibility = hdGILocalReflection > .5 ? 1.0
              : clamp(dot(hdGIMean + vec3(hdGICapture > .5 ? 0.0 : hdGIIndoorFill), vec3(.2126, .7152, .0722)) / PI, .025, 1.0);
            radiance *= hdGIReflectionVisibility;
            clearcoatRadiance *= hdGIReflectionVisibility;
          }
          // Diffuse capture should not bake a view-dependent specular highlight.
          if (hdGICapture > .5) { radiance = vec3(0.0); clearcoatRadiance = vec3(0.0); }
        }
        #endif
        #include <lights_fragment_end>`)
  }
  const key = () => {
    const original = cacheKey.call(material)
    const marker = /:house-designer-indirect-grid-l1-v\d+-(capture|display)/g
    // Clones inherit this hook even when another controller follows it.
    // Preserve its position in the key so both materials reuse one program.
    const suffix = ':house-designer-indirect-grid-l1-v14-display'
    return original.match(marker) ? original.replace(marker, suffix) : original + suffix
  }
  material.onBeforeCompile = hook; material.customProgramCacheKey = key; material.needsUpdate = true
  return () => {
    localReflectionUniforms.delete(material)
    if (material.onBeforeCompile === hook) material.onBeforeCompile = compile
    if (material.customProgramCacheKey === key) material.customProgramCacheKey = cacheKey
    material.needsUpdate = true
  }
}
