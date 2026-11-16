import { Box3, Vector3 } from 'three'
import { createIndirectVisibilityFromSnapshot, type IndirectGeometrySnapshot } from './indirectVisibility.ts'

export type ExteriorSkyField = {
  min: number[]; size: number[]; dimensions: number[]; cell: number
  positive: Uint8Array; negative: Uint8Array; rays: number; ms: number
}

/** Directional visibility of the environment, cached in world space. The
 * worker traces architecture only; camera motion never retraces the field. */
export function bakeExteriorSkyOcclusion(parts: IndirectGeometrySnapshot, samples = 48,
  progress?: (percent: number) => void): ExteriorSkyField {
  const started = performance.now(), visibility = createIndirectVisibilityFromSnapshot(parts)
  try {
    const positions = visibility.snapshot().positions, bounds = new Box3(), point = new Vector3()
    for (let i = 0; i < positions.length; i += 3) bounds.expandByPoint(point.fromArray(positions, i))
    if (bounds.isEmpty()) throw new Error('No building surfaces are available.')
    bounds.expandByScalar(.6)
    const extent = bounds.getSize(new Vector3())
    let cell = .35, dimensions = extent.toArray().map(value => Math.ceil(value / cell) + 1)
    while (dimensions.reduce((a, b) => a * b, 1) > 80000 || Math.max(...dimensions) > 96) {
      cell *= 1.1; dimensions = extent.toArray().map(value => Math.ceil(value / cell) + 1)
    }
    const size = dimensions.map(n => (n - 1) * cell), count = dimensions.reduce((a, b) => a * b, 1)
    const positive = new Uint8Array(count * 4), negative = new Uint8Array(count * 4)
    const directions = Array.from({ length: samples }, (_, i) => {
      const y = 1 - 2 * (i + .5) / samples, angle = i * Math.PI * (3 - Math.sqrt(5)), radius = Math.sqrt(1 - y * y)
      return new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
    })
    const weights = directions.map(direction => direction.toArray().flatMap(value => [Math.max(0, value), Math.max(0, -value)])
      .map(weight => weight * (direction.y >= 0 ? .6 + .8 * direction.y : .15)))
    const totals = new Float64Array(6), visible = new Float64Array(6)
    weights.forEach(row => row.forEach((value, axis) => { totals[axis] += value }))
    const distance = extent.length() + 2
    let rays = 0
    for (let z = 0; z < dimensions[2]; z++) {
      for (let y = 0; y < dimensions[1]; y++) for (let x = 0; x < dimensions[0]; x++) {
        point.set(bounds.min.x + x * cell, bounds.min.y + y * cell, bounds.min.z + z * cell)
        visible.fill(0)
        for (let ray = 0; ray < samples; ray++) {
          rays++
          if (visibility.occluded(point, directions[ray], distance, .015)) continue
          for (let axis = 0; axis < 6; axis++) visible[axis] += weights[ray][axis]
        }
        const index = (x + dimensions[0] * (y + dimensions[1] * z)) * 4
        for (let axis = 0; axis < 3; axis++) {
          positive[index + axis] = Math.round(255 * visible[axis * 2] / totals[axis * 2])
          negative[index + axis] = Math.round(255 * visible[axis * 2 + 1] / totals[axis * 2 + 1])
        }
        positive[index + 3] = negative[index + 3] = 255
      }
      progress?.(Math.round(100 * (z + 1) / dimensions[2]))
    }
    return { min: bounds.min.toArray(), size, dimensions, cell, positive, negative, rays, ms: performance.now() - started }
  } finally { visibility.dispose() }
}

export const exteriorSkyOcclusionGLSL = /* glsl */`
#ifdef HD_EXTERIOR_SKY_OCCLUSION
uniform sampler3D hdExteriorSkyField;
uniform vec3 hdExteriorSkyMin, hdExteriorSkySize, hdExteriorSkyDimensions;
uniform float hdExteriorSkyStrength, hdExteriorSkyCell;
uniform vec2 hdExteriorEaveMin, hdExteriorEaveSize, hdExteriorEaveDimensions, hdExteriorEaveHeight;
uniform float hdExteriorEaveLayers;
vec2 hdExteriorEaveHeightAt(ivec2 cell, int layer) {
  ivec2 dimensions = ivec2(hdExteriorEaveDimensions);
  cell = clamp(cell, ivec2(0), dimensions - 1);
  ivec3 atlas = textureSize(hdExteriorSkyField, 0);
  int index = cell.x + dimensions.x * (cell.y + dimensions.y * layer);
  ivec3 texel = ivec3(index % atlas.x, (index / atlas.x) % atlas.y,
    index / (atlas.x * atlas.y) + int(hdExteriorSkyDimensions.z) * 2);
  vec3 sampleValue = texelFetch(hdExteriorSkyField, texel, 0).rgb;
  float height = hdExteriorEaveHeight.x + dot(sampleValue.rg, vec2(65280.0, 255.0)) /
    65535.0 * hdExteriorEaveHeight.y;
  return vec2(height, sampleValue.b);
}
float hdExteriorEaveCover(vec2 sampleValue, float y) {
  float gap = sampleValue.x - y;
  return sampleValue.y * smoothstep(.005, .04, gap) * (1.0 - smoothstep(.08, .65, gap));
}
float hdExteriorEaveWeight(float distance) {
  float x = abs(distance) / 1.5;
  return x < 1.0 ? (4.0 - 6.0*x*x + 3.0*x*x*x) / 6.0 : pow(max(0.0, 2.0-x), 3.0) / 6.0;
}
uniform int hdExteriorEaveFilterWidth;
float hdExteriorEaveVisibility(vec3 position, vec3 normal) {
  if (hdExteriorEaveLayers < .5) return 1.0;
  vec3 p = position + normal * .015;
  // Most facade pixels are too far below the lowest eave to receive contact
  // shading. Keep the wider lookup out of those pixels entirely.
  if (p.y < hdExteriorEaveHeight.x - .65 || p.y > hdExteriorEaveHeight.x + hdExteriorEaveHeight.y) return 1.0;
  vec2 unit = (p.xz - hdExteriorEaveMin) / hdExteriorEaveSize;
  if (any(lessThan(unit, vec2(0.0))) || any(greaterThan(unit, vec2(1.0)))) return 1.0;
  vec2 grid = unit * (hdExteriorEaveDimensions - 1.0), blend = fract(grid);
  ivec2 cell = ivec2(floor(grid));
  // A cubic footprint smooths coverage in both horizontal directions. A
  // facade-only blur leaves long grid bands on almost axis-aligned walls.
  // Heights stay separate from coverage so the vertical contact remains crisp.
  float wx[6], wz[6];
  float weightX = 0.0, weightZ = 0.0;
  // A uniform bound keeps drivers from expanding the 36-tap filter into a
  // large straight-line program for every surface/texture shader variant.
  for (int tap = 0; tap < hdExteriorEaveFilterWidth; tap++) {
    wx[tap] = hdExteriorEaveWeight(float(tap-2) - blend.x);
    wz[tap] = hdExteriorEaveWeight(float(tap-2) - blend.y);
    weightX += wx[tap]; weightZ += wz[tap];
  }
  float cover = 0.0;
  for (int layer = 0; layer < int(hdExteriorEaveLayers); layer++) {
    float coverage = 0.0, weightedHeight = 0.0, shaded = 0.0, low = 1e6, high = -1e6;
    for (int z = 0; z < hdExteriorEaveFilterWidth; z++) for (int x = 0; x < hdExteriorEaveFilterWidth; x++) {
      vec2 value = hdExteriorEaveHeightAt(cell + ivec2(x-2,z-2), layer);
      float weight = wx[x] * wz[z] / (weightX * weightZ);
      coverage += weight * value.y;
      weightedHeight += weight * value.y * value.x;
      shaded += weight * hdExteriorEaveCover(value, p.y);
      if (value.y > .001) { low = min(low, value.x); high = max(high, value.x); }
    }
    if (coverage < .001) continue;
    if (high - low < .25) {
      // Interpolate continuous roof slopes before shading to avoid grid steps.
      float height = weightedHeight / coverage;
      cover = max(cover, hdExteriorEaveCover(vec2(height, coverage), p.y));
    } else {
      // At separate roof levels, filter coverage instead of inventing a roof
      // halfway between a lower porch and the main roof.
      cover = max(cover, shaded);
    }
  }
  return 1.0 - .75 * cover;
}
void hdExteriorSkyRead(vec3 p, out vec3 positive, out vec3 negative) {
  positive = vec3(1.0); negative = vec3(1.0);
  vec3 unit = (p - hdExteriorSkyMin) / hdExteriorSkySize;
  if (any(lessThan(unit, vec3(0.0))) || any(greaterThan(unit, vec3(1.0)))) return;
  vec3 atlas = vec3(textureSize(hdExteriorSkyField, 0));
  vec3 uv = (unit * (hdExteriorSkyDimensions - 1.0) + .5) / atlas;
  positive = texture(hdExteriorSkyField, uv).rgb;
  negative = texture(hdExteriorSkyField, uv + vec3(0.0, 0.0, hdExteriorSkyDimensions.z / atlas.z)).rgb;
}
void hdExteriorSkySample(vec3 position, vec3 normal, out vec3 positive, out vec3 negative) {
  positive = vec3(1.0); negative = vec3(1.0);
  if (hdExteriorSkyStrength <= 0.0) return;
  // Keep every corner of the trilinear footprint outside the receiver plane.
  // A fixed fraction of one cell crosses diagonal walls, blending indoor and
  // outdoor visibility into stripes. The footprint's projected width is the
  // cell size times the L1 norm of the surface normal.
  float receiverOffset = hdExteriorSkyCell * dot(abs(normal), vec3(1.0)) + .015;
  vec3 p = position + normal * receiverOffset;
  hdExteriorSkyRead(p, positive, negative);
  // Blur illumination along the receiving surface, keeping every sample on
  // its exterior side. Geometry, materials and the fine roof-contact band
  // remain sharp; a world-space kernel also stays stable as the camera moves.
  vec3 tangent = normalize(cross(normal, abs(normal.y) < .9 ? vec3(0.,1.,0.) : vec3(1.,0.,0.)));
  vec3 bitangent = cross(normal, tangent);
  float radius = hdExteriorSkyCell * .75;
  positive *= .5; negative *= .5;
  for (int tap = 0; tap < 4; tap++) {
    vec3 offset = (tap < 2 ? tangent : bitangent) * (tap % 2 == 0 ? radius : -radius);
    vec3 a, b;
    hdExteriorSkyRead(p + offset, a, b);
    positive += a * .125; negative += b * .125;
  }
  float eaveVisibility = hdExteriorEaveVisibility(position, normal);
  // Half-strength roof contact shading, relative to the broad sky field.
  positive = mix(positive, min(positive, vec3(eaveVisibility)), .5);
  negative.xz = mix(negative.xz, min(negative.xz, vec2(eaveVisibility)), .5);
}
float hdExteriorSkyVisibility(vec3 positive, vec3 negative, vec3 direction) {
  vec3 weights = direction * direction;
  float visibility = dot(mix(negative, positive, step(vec3(0.0), direction)), weights);
  return mix(1.0, max(.12, visibility), hdExteriorSkyStrength);
}
#endif
`
