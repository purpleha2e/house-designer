import type { LightShadow } from 'three'

/** Release GPU render targets owned by an inactive pooled light. */
export function releaseLightShadowResources(shadow: LightShadow) {
  for (const target of new Set([shadow.map, shadow.mapPass])) target?.dispose()
  shadow.map = null
  shadow.mapPass = null
  shadow.needsUpdate = true
}
