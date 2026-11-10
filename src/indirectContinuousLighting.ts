/** Sky intensity is also embedded in the authored scene revision. Remove only
 * that value when deciding whether a sky edit can retain prepared geometry. */
export function indirectSkyIndependentRevision(revision: string) {
  try {
    const state = JSON.parse(revision)
    if (!state || typeof state !== 'object' || !state.lightingSettings) return revision
    return JSON.stringify({ ...state, lightingSettings: { ...state.lightingSettings, skyStrength: 1 } })
  } catch { return revision }
}

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
    // Asynchronous cache restoration only satisfies the input it started with.
    // A sun/lamp change during decoding or texture upload still needs a sweep.
    restore(revision: number) { completed = active = revision; return completed === requested },
    // Failed input stays settled until an actual lighting/scene change requests work.
    fail() { completed = active = requested },
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
  first: T[], second: T[], reflections: T[], hasBaseline: boolean, passes=2,
) {
  // Full Jacobi passes must finish before the next pass starts. The legacy
  // two-pass near-room revisit would otherwise duplicate second-pass probes
  // and leave progress permanently short of its reported total.
  if(passes>2){
    const queue=[...first]
    for(let pass=2;pass<=passes;pass++)queue.push(...second.map(sample=>({...sample,pass})))
    queue.push(...reflections.map(sample=>({...sample,pass:passes})))
    return queue
  }
  if (!hasBaseline || first.length <= 16) return [...first, ...second, ...reflections]
  const near = new Set(first.slice(0, 8).map(sample => sample.probe))
  const support = new Set(first.slice(0, 16).map(sample => sample.probe))
  const regions = new Set(first.slice(0, 8).map(sample => sample.region.id))
  return [...first.filter(sample => support.has(sample.probe)),
    ...second.filter(sample => near.has(sample.probe)),
    ...reflections.filter(sample => regions.has(sample.region.id)).slice(0, 1),
    ...first.filter(sample => !support.has(sample.probe)), ...second, ...reflections]
}
