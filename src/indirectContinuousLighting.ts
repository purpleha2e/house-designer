/** Inputs that require replacing the prepared scene. Lamp uniforms and the sun
 * can instead flow through the existing capture queue without cancelling it. */
export function indirectLightingStructureKey(revision: string) {
  try {
    const state = JSON.parse(revision)
    if (!Array.isArray(state.floors)) return revision
    const lampUniforms = new Set(['lightEnabled', 'lightPower', 'lightColor', 'lightDistance', 'lightFalloff', 'lightSpread'])
    return JSON.stringify({ ...state, lightDirection: undefined,
      floors: state.floors.map((floor: { models?: Record<string, unknown>[] }) => ({ ...floor,
        models: floor.models?.map(model => Object.fromEntries(Object.entries(model).filter(([key]) => !lampUniforms.has(key)))) })) })
  } catch { return revision }
}

/** One active sweep and one latest request, regardless of input frequency.
 * New requests never reset a sweep's probe cursor, so distant probes cannot
 * starve during a long drag. A quiet final sweep produces an exportable result. */
export function createIndirectLightingUpdates() {
  let requested = 0, completed = 0, active = 0
  return {
    request() { return ++requested },
    begin() { active = requested; return active },
    finish() { completed = active; return completed === requested },
    reset() { requested = completed = active = 0 },
    get pending() { return requested !== completed },
    get changedDuringSweep() { return requested !== active },
    get revision() { return requested },
  }
}

/** Finish a bounded patch around the camera before traversing the building.
 * Support probes get bounce one first. Revisit that patch after the remaining
 * first bounces, so the final result uses current support everywhere. */
export function prioritizeIndirectLighting<T extends { probe?: number; pass: number; reflection?: boolean; region: { id: number } }>(
  first: T[], second: T[], reflections: T[], hasBaseline: boolean,
) {
  if (!hasBaseline || first.length <= 16) return [...first, ...second, ...reflections]
  const near = new Set(first.slice(0, 8).map(sample => sample.probe))
  const support = new Set(first.slice(0, 16).map(sample => sample.probe))
  const regions = new Set(first.slice(0, 8).map(sample => sample.region.id))
  return [...first.filter(sample => support.has(sample.probe)),
    ...second.filter(sample => near.has(sample.probe)),
    ...reflections.filter(sample => regions.has(sample.region.id)).slice(0, 1),
    ...first.filter(sample => !support.has(sample.probe)), ...second, ...reflections]
}
