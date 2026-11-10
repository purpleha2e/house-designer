export const MAX_REALTIME_LOCAL_LIGHTS = 11

/** Shadow slots occupy the front of each fixed light pool. Dormant lamps keep
 * their slots, but must not consume the shadow budget ahead of emitting lamps. */
export function prioritizeEmittingLights<T extends { power: number }>(slots: readonly T[]): T[] {
  return [...slots.filter(slot => slot.power > 0), ...slots.filter(slot => slot.power <= 0)]
}

/** Reuse fixed GPU slots for lamps relevant to the camera. A small retention
 * margin prevents equally distant lamps swapping shadow maps on every step. */
export function prioritizeVisibleLights<T extends { id: string; power: number; priority: number; distanceSquared: number }>(
  lights: readonly T[], previous: readonly string[], shadowLimit: number,
) {
  const retained = new Set(previous.slice(0, shadowLimit))
  const score = (light: T) => light.distanceSquared * (retained.has(light.id) ? .8 : 1)
  return [...lights].sort((a, b) => Number(b.power > 0) - Number(a.power > 0) ||
    a.priority - b.priority || score(a) - score(b) || a.id.localeCompare(b.id))
}

/** Keep spare uniforms so adding a lamp does not recompile every house material. */
export function localLightPoolCapacities(point: number, spot: number, limit: number, shadowLimit: number) {
  const capacity = (count: number, reserve: number) => Math.min(limit, Math.max(reserve, Math.ceil(count / 4) * 4))
  const shadowPoint = Math.min(point, shadowLimit), shadowSpot = Math.min(spot, shadowLimit - shadowPoint)
  return { point: capacity(point, point || !spot ? 8 : 0), spot: spot ? capacity(spot, 4) : 0, shadowPoint, shadowSpot }
}

/** Uniforms limit direct lights; only shadow maps consume a texture per lamp. */
export function getLocalLightLimits(maxFragmentUniforms: number, maxTextures: number) {
  const lights = maxFragmentUniforms >= 1024 ? MAX_REALTIME_LOCAL_LIGHTS : maxFragmentUniforms >= 512 ? 8 : 4
  // Reserve material maps, room masks/probes, environment and sun shadow.
  return { lights, shadows: Math.min(lights, Math.max(1, maxTextures - 14)) }
}
