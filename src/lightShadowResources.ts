import type { LightShadow } from 'three'

// Indoor receivers need millimetre-scale clearance. The former 10 cm normal
// offset and large perspective-depth bias detached thin-door contact shadows.
export const LOCAL_LIGHT_SHADOW_BIAS = -.00001
export const LOCAL_LIGHT_SHADOW_NORMAL_BIAS = .004
export const LOCAL_LIGHT_SHADOW_RADIUS = 1

/** Scene-local display state: notify the lights synchronously, without rebuilding React's scene tree. */
export function createLightShadowControl(initial: boolean) {
  let enabled = initial
  const listeners = new Set<() => void>()
  return {
    get: () => enabled,
    set(value: boolean) {
      if (value === enabled) return
      enabled = value
      listeners.forEach(listener => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
export type LightShadowControl = ReturnType<typeof createLightShadowControl>

/** Keep the shader light counts and targets stable across display toggles. */
export function setLightShadowEnabled(shadow: LightShadow, enabled: boolean, active: boolean) {
  shadow.intensity = enabled && active ? 1 : 0
  shadow.autoUpdate = enabled && active
  // Allocate once on first display, even if disabled, so every sampler has a
  // valid target. Subsequent disables submit no shadow passes at all.
  shadow.needsUpdate = !shadow.map || (enabled && active)
}

/** Release GPU render targets when their pooled light is removed. */
export function releaseLightShadowResources(shadow: LightShadow) {
  for (const target of new Set([shadow.map, shadow.mapPass])) target?.dispose()
  shadow.map = null
  shadow.mapPass = null
  shadow.needsUpdate = true
}
