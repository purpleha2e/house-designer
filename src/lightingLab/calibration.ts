/** Shared linear radiance and reconstruction settings for both lab scenes.
 * The original room's sky cards emit this radiance through its windows. The
 * house samples the same source when a ray escapes through actual geometry. */
export const LAB_SKY_COLOUR = [.78, .88, 1] as const
export const LAB_SKY_RADIANCE = 3
export const LAB_BOUNCE_RAYS = 8
// Longer paths reduce repeated projection errors between rooms. Keep enough
// independent paths to resolve rare daylight arrivals; the adaptive tile
// budget bounds GPU work rather than reducing the path quality.
export const HOUSE_BOUNCE_RAYS = 8
export const LAB_FILTER_RADIUS = 3
export const LAB_FILTER_SIGMA = 1.4

// Count updates of this surface, not display frames: a large house may take
// hundreds of display frames to revisit a surface even once.
export function labHistoryBlend(updatesSinceChange: number) {
  return updatesSinceChange < 12 ? .35 : .06
}

/** House surfaces update at different rates. Keep rapid response after an
 * edit, then accumulate a longer history instead of injecting 6% fresh noise
 * indefinitely. Reset by source changes, never by camera movement. */
export function houseHistoryBlend(updatesSinceChange: number, previousSamples?: number) {
  // A new cache has no stale lighting to replace. Average all its estimates
  // equally instead of retaining only a handful during the first updates.
  if (previousSamples === updatesSinceChange) return 1 / (updatesSinceChange + 1)
  // Actual source edits still replace the old state promptly. There is no
  // permanent noise floor: a static scene should continue to settle.
  return updatesSinceChange < 12 ? .35 : Math.min(.06, 1 / (updatesSinceChange - 11))
}
