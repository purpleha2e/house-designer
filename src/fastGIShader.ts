import { Mesh, MeshStandardMaterial, Vector3, type Scene, type Texture } from 'three'
import { requestShaderWarmup } from './shaderWarmupState.ts'

/** Hold the prepared display before publishing a new shader variant. Its
 * frozen programs stay navigable until the async warmup prepares a replacement. */
export function setFastGIShaderFeature(scene: Scene, feature: { value: number }, enabled: boolean) {
  const next = enabled ? 1 : 0
  if (feature.value === next) return false
  requestShaderWarmup(scene)
  feature.value = next
  scene.userData.liveLightRevision = (scene.userData.liveLightRevision ?? 0) + 1
  scene.traverse(object => {
    if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof MeshStandardMaterial) material.needsUpdate = true
    }
  })
  return true
}

export function createFastGIUniforms(fallback: Texture) {
  return {
    hdFastFeature: { value: 0 }, hdFastReady: { value: 0 }, hdFastWeight: { value: 1 },
    hdFastLight: { value: fallback },
    hdFastMin: { value: new Vector3() }, hdFastSize: { value: new Vector3(1, 1, 1) }, hdFastN: { value: 32 },
  }
}

// All volume atlases flatten x/z into columns and y into rows. Four SH bands
// store convolved incoming radiance; opposite receiver normals remain distinct.
export const fastGIShader = /* glsl */ `
#if defined(HD_FAST_GI) && !defined(HD_GI_DIRECT_CAPTURE)
uniform sampler2D hdFastLight;
uniform vec3 hdFastMin, hdFastSize;
uniform float hdFastN, hdFastReady, hdFastWeight;
vec2 hdFastUV(vec3 c) { return (vec2(c.x + c.z * hdFastN, c.y) + .5) / vec2(hdFastN * hdFastN, hdFastN); }
bool hdFastInside(vec3 c) { return all(greaterThanEqual(c, vec3(0.0))) && all(lessThan(c, vec3(hdFastN))); }
vec3 hdFastIrradiance(vec3 world, vec3 normal, vec3 surfaceNormal, vec3 probe) {
  vec3 q = (world - hdFastMin) / hdFastSize * hdFastN;
  if (hdFastReady < .5 || hdFastWeight < .0001 || !hdFastInside(q)) return probe;
  // Stay on the receiving side of thin walls. Reject interpolation neighbours
  // whose short segment crosses occupied geometry, including unknown surfaces.
  vec3 origin = q + surfaceNormal * 1.15;
  vec2 originUV = hdFastUV(floor(origin)); originUV.y *= .25;
  bool originFree = !hdFastInside(floor(origin)) || texture2D(hdFastLight, originUV).a < .5;
  vec3 base = floor(origin);
  vec3 light = vec3(0.0); float total = 0.0;
  // A quadratic kernel has continuous weights as support changes at cell
  // boundaries. Normalising all visible neighbours avoids snapping a blocked
  // receiver to one unrelated free cell on detailed doors and wall returns.
  for (int i = 0; i < 27; i++) {
    vec3 offset = vec3(float(i % 3), float((i / 3) % 3), float(i / 9)) - 1.0;
    vec3 c = base + offset;
    if (!hdFastInside(c)) continue;
    vec3 d = abs(origin - (c + .5));
    vec3 edge = max(vec3(0.0), 1.5 - d);
    vec3 w = mix(.5 * edge * edge, .75 - d * d, lessThan(d, vec3(.5)));
    float weight = w.x * w.y * w.z;
    if (weight < .000001) continue;
    vec2 uv = hdFastUV(c); uv.y *= .25;
    vec4 mean = texture2D(hdFastLight, uv);
    if (mean.a > .5) continue;
    if (!originFree && texture2D(hdFastLight, uv + vec2(0.0, .5)).a < .5) continue;
    // Conservative voxels can include the receiver itself at wall/ceiling
    // joins. Allow the segment to leave that initial solid run, then reject
    // every subsequent occluder. An occupied destination is never sampled.
    bool blocked = false, enteredFree = originFree;
    for (int stepIndex = 1; stepIndex < 4; stepIndex++) {
      vec3 testCell = floor(mix(origin, c + .5, float(stepIndex) / 4.0));
      vec2 stateUV = hdFastUV(testCell); stateUV.y *= .25;
      bool occupied = hdFastInside(testCell) && texture2D(hdFastLight, stateUV).a > .5;
      if (occupied && enteredFree) blocked = true;
      if (!occupied) enteredFree = true;
    }
    // The destination is already known free; it may be the first point that
    // leaves the receiver's conservative solid run.
    if (blocked) continue;
    vec3 result = mean.rgb * .282095;
    result += texture2D(hdFastLight, uv + vec2(0.0, .25)).rgb * (.488603 * normal.x);
    result += texture2D(hdFastLight, uv + vec2(0.0, .5)).rgb * (.488603 * normal.y);
    result += texture2D(hdFastLight, uv + vec2(0.0, .75)).rgb * (.488603 * normal.z);
    light += max(result, vec3(0.0)) * weight; total += weight;
  }
  // Missing illumination is explicit, never replaced by an invented ambient.
  return mix(probe, total > .0001 ? light / total : vec3(0.0), hdFastWeight);
}
#endif
`
