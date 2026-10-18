import type { StairDesign, StairPoint, StairRailPoint, StairSurface } from './stairDesign.ts'

/** Internal riser edges, measured around the turn from the incoming flight. */
export function stairLandingAngles(layout: StairDesign['layout'], steps: number) {
  const angle = layout === 'u' ? Math.PI : Math.PI / 2
  const fractions = steps === 1 ? [.5] : steps === 2 ? [.25, .75] : steps === 3 ? [.25, .5, .75] : []
  return fractions.map(f => f * angle)
}

export function createStairLandingProfile(d: StairDesign, start: StairPoint, firstRise: number, rise: number) {
  const w = d.width, maxX = d.layout === 'u' ? 1.5 * w + d.wellWidth : w / 2
  const rectangle = [{ x: -w / 2, z: start.z }, { x: maxX, z: start.z },
    { x: maxX, z: start.z + d.landingDepth }, { x: -w / 2, z: start.z + d.landingDepth }]
  const pivot = { x: d.layout === 'u' ? w / 2 + d.wellWidth / 2 : w / 2,
    z: d.layout === 'u' ? start.z : start.z + d.landingDepth - w }
  const angles = stairLandingAngles(d.layout, d.landingSteps ?? 0)
  const cross = (p: StairPoint, angle: number) => -Math.cos(angle) * (p.z - pivot.z) - Math.sin(angle) * (p.x - pivot.x)
  function clip(polygon: StairPoint[], angle: number, sign: number) {
    const result: StairPoint[] = []
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length]
      const ca = cross(a, angle) * sign, cb = cross(b, angle) * sign
      if (ca >= -1e-9) result.push(a)
      if ((ca < -1e-9 && cb > 1e-9) || (ca > 1e-9 && cb < -1e-9)) {
        const t = ca / (ca - cb)
        result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
      }
    }
    return result.filter((p, i, all) => !i || Math.hypot(p.x - all[i - 1].x, p.z - all[i - 1].z) > 1e-8)
  }
  const rayEnd = (angle: number) => {
    const dx = -Math.cos(angle), dz = Math.sin(angle)
    const tx = Math.abs(dx) < 1e-8 ? Infinity : ((dx < 0 ? -w / 2 : maxX) - pivot.x) / dx
    const tz = dz < 1e-8 ? Infinity : (start.z + d.landingDepth - pivot.z) / dz
    const t = Math.min(tx, tz)
    return { x: pivot.x + dx * t, z: pivot.z + dz * t }
  }
  const cuts = angles.map(rayEnd)
  const surfaces: StairSurface[] = Array.from({ length: angles.length + 1 }, (_, i) => {
    let polygon = rectangle
    if (i) polygon = clip(polygon, angles[i - 1], -1)
    if (i < angles.length) polygon = clip(polygon, angles[i], 1)
    return { polygon, front: i ? [pivot, cuts[i - 1]] : [{ x: -w / 2, z: start.z }, { x: w / 2, z: start.z }],
      top: (firstRise + i) * rise, landing: true, riser: true, progression: polygon.map(() => 0) }
  })
  const exit = d.layout === 'u' ? { x: w + d.wellWidth, z: start.z }
    : { x: w / 2, z: start.z + d.landingDepth - w / 2 }
  const outerEnd = d.layout === 'u' ? rectangle[1] : rectangle[2]
  const boundary = d.layout === 'u' ? [rectangle[0], rectangle[3], rectangle[2], outerEnd]
    : [rectangle[0], rectangle[3], outerEnd]
  const outer: StairRailPoint[] = []
  for (let i = 1; i < boundary.length; i++) {
    const a = boundary[i - 1], b = boundary[i], dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz
    const events = [a, ...cuts.filter(p => {
      const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq
      return t > 1e-8 && t < 1 - 1e-8 && Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) < 1e-8
    }).sort((p, q) => ((p.x - q.x) * dx + (p.z - q.z) * dz)), b]
    for (let j = 1; j < events.length; j++) {
      const from = events[j - 1], to = events[j], mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 }
      const panel = angles.filter(angle => cross(mid, angle) < -1e-8).length
      const y = (firstRise + panel) * rise
      outer.push({ ...from, y }, { ...to, y })
    }
  }
  const inner: StairRailPoint[] = d.layout === 'u' ? [
    { x: w / 2, z: start.z, y: firstRise * rise },
    { x: w / 2 + d.wellWidth, z: start.z, y: (firstRise + angles.length) * rise },
  ] : [{ x: w / 2, z: start.z, y: firstRise * rise },
    { ...pivot, y: firstRise * rise }, { ...pivot, y: (firstRise + angles.length) * rise },
    { x: w / 2, z: pivot.z, y: (firstRise + angles.length) * rise }]
  return { surfaces, footprint: rectangle, outer, inner, exit }
}
