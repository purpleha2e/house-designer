import type { LightShadow } from 'three'

// Indoor receivers need millimetre-scale clearance. The former 10 cm normal
// offset and large perspective-depth bias detached thin-door contact shadows.
export const LOCAL_LIGHT_SHADOW_BIAS = -.00001
export const LOCAL_LIGHT_SHADOW_NORMAL_BIAS = .004
export const LOCAL_LIGHT_SHADOW_RADIUS = 1

/** Release GPU render targets owned by an inactive pooled light. */
export function releaseLightShadowResources(shadow: LightShadow) {
  for (const target of new Set([shadow.map, shadow.mapPass])) target?.dispose()
  shadow.map = null
  shadow.mapPass = null
  shadow.needsUpdate = true
}
