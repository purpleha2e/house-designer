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
    hdFastLinearReceiver: { value: 0 },
  }
}

// All volume atlases flatten x/z into columns and y into rows. Four SH bands
// store convolved incoming radiance; opposite receiver normals remain distinct.
export const fastGIShader = /* glsl */ `
#if defined(HD_FAST_GI) && !defined(HD_GI_DIRECT_CAPTURE)
uniform sampler2D hdFastLight;
uniform vec3 hdFastMin, hdFastSize;
uniform float hdFastN, hdFastReady, hdFastWeight, hdFastLinearReceiver;
vec2 hdFastUV(vec3 c) { return (vec2(c.x + c.z * hdFastN, c.y) + .5) / vec2(hdFastN * hdFastN, hdFastN); }
bool hdFastInside(vec3 c) { return all(greaterThanEqual(c, vec3(0.0))) && all(lessThan(c, vec3(hdFastN))); }
vec4 hdFastSample(vec3 cell, float band) {
  vec2 uv = hdFastUV(cell);
  return texture2D(hdFastLight, vec2(uv.x, (uv.y + band) * .25));
}
vec3 hdFastEvaluate(vec4 mean, vec3 cell, vec3 normal) {
  return mean.rgb * .282095 + .488603 * (
    hdFastSample(cell, 1.0).rgb * normal.x +
    hdFastSample(cell, 2.0).rgb * normal.y +
    hdFastSample(cell, 3.0).rgb * normal.z);
}
bool hdFastBlocked(vec3 origin, vec3 cell, bool originFree) {
  bool enteredFree = originFree;
  for (int stepIndex = 1; stepIndex < 4; stepIndex++) {
    vec3 testCell = floor(mix(origin, cell + .5, float(stepIndex) / 4.0));
    bool occupied = hdFastInside(testCell) && hdFastSample(testCell, 0.0).a > .5;
    if (occupied && enteredFree) return true;
    if (!occupied) enteredFree = true;
  }
  return false;
}

// Trilinear reconstruction needs eight taps total in unobstructed air:
// hardware bilinear in each x/y slice, then interpolate the two z slices.
// At shell boundaries the same weights are used with blocked taps removed.
bool hdFastLinearIrradiance(vec3 origin, vec3 normal, out vec3 irradiance) {
  vec3 base = floor(origin - .5);
  vec3 fraction = origin - .5 - base;
  if (hdFastInside(base) && hdFastInside(base + 1.0) && hdFastSample(base, 3.0).a > .5) {
    vec3 xy = vec3(base.xy + fraction.xy, base.z);
    vec3 next = xy + vec3(0.0, 0.0, 1.0);
    irradiance = max(mix(hdFastEvaluate(hdFastSample(xy, 0.0), xy, normal),
      hdFastEvaluate(hdFastSample(next, 0.0), next, normal), fraction.z), vec3(0.0));
    return true;
  }
  // A conservative solid can cover the receiver's offset point at an inside
  // corner. Use the wider, known-air recovery kernel for that case.
  vec3 originCell = floor(origin);
  if (!hdFastInside(originCell) || hdFastSample(originCell, 0.0).a > .5) return false;
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 offset = vec3(float(i % 2), float((i / 2) % 2), float(i / 4));
    vec3 cell = base + offset;
    vec3 w = mix(1.0 - fraction, fraction, offset);
    float weight = w.x * w.y * w.z;
    if (weight <= 0.0 || !hdFastInside(cell)) continue;
    vec4 mean = hdFastSample(cell, 0.0);
    if (mean.a > .5 || hdFastBlocked(origin, cell, true)) continue;
    sum += hdFastEvaluate(mean, cell, normal) * weight;
    total += weight;
  }
  irradiance = max(sum / max(total, .0001), vec3(0.0));
  return total > .0001;
}

vec3 hdFastIrradiance(vec3 world, vec3 normal, vec3 surfaceNormal, vec3 probe) {
  vec3 q = (world - hdFastMin) / hdFastSize * hdFastN;
  if (hdFastReady < .5 || hdFastWeight < .0001 || !hdFastInside(q)) return probe;
  // Stay on the receiving side of thin walls. Reject interpolation neighbours
  // whose short segment crosses occupied geometry, including unknown surfaces.
  vec3 origin = q + surfaceNormal * 1.15;
  // A storey's outermost rows contain its conservative floor/ceiling
  // boundary. Keep grazing wall receivers on the inward side of those rows.
  if (hdFastLinearReceiver > .5) origin.y = clamp(origin.y, 1.5, hdFastN - 1.5);
  vec3 linearLight;
  if (hdFastLinearReceiver > .5 && hdFastLinearIrradiance(origin, normal, linearLight)) {
    return mix(probe, linearLight, hdFastWeight);
  }
  bool originFree = !hdFastInside(floor(origin)) || hdFastSample(floor(origin), 0.0).a < .5;
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
    vec4 mean = hdFastSample(c, 0.0);
    if (mean.a > .5) continue;
    if (!originFree && hdFastSample(c, 2.0).a < .5) continue;
    // Conservative voxels can include the receiver itself at wall/ceiling
    // joins. Allow the segment to leave that initial solid run, then reject
    // every subsequent occluder. An occupied destination is never sampled.
    // The destination is already known free; it may be the first point that
    // leaves the receiver's conservative solid run.
    if (hdFastBlocked(origin, c, originFree)) continue;
    vec3 result = hdFastEvaluate(mean, c, normal);
    light += max(result, vec3(0.0)) * weight; total += weight;
  }
  // Missing illumination is explicit, never replaced by an invented ambient.
  return mix(probe, total > .0001 ? light / total : vec3(0.0), hdFastWeight);
}
#endif
`
