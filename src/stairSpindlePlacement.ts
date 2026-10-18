import type { StairDesign, StairRailPoint } from './stairDesign.ts'

/** Equal clear gaps between post faces and spindles, across a complete flight
 * even where its rail changes pitch. Distances are measured in plan. */
export function getStairSpindlePositions(path: StairRailPoint[], posts: StairRailPoint[], design: StairDesign) {
  if (path.length < 2) return []
  const distances = [0]
  for (let i = 1; i < path.length; i++) distances.push(distances[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z))
  const at = (distance: number) => {
    const i = Math.max(1, distances.findIndex((d, i) => i > 0 && d > distance + 1e-8))
    const end = distance >= distances.at(-1)! - 1e-8 ? path.length - 1 : i
    const a = path[end - 1], b = path[end], length = distances[end] - distances[end - 1]
    const t = length > 1e-8 ? (distance - distances[end - 1]) / length : 1
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
  }
  const stops = posts.map(post => {
    const i = path.findIndex(p => Math.hypot(p.x - post.x, p.z - post.z) < 1e-7)
    return distances[i]
  }).filter(Number.isFinite).sort((a, b) => a - b).filter((d, i, all) => !i || d - all[i - 1] > 1e-7)
  const result: StairRailPoint[] = []
  for (let i = 1; i < stops.length; i++) {
    const start = stops[i - 1], end = stops[i], length = end - start
    if (length < 1e-7) continue
    const a = at(start), b = at(end)
    const postExtent = (p: StairRailPoint, near: StairRailPoint) => {
      const dx = near.x - p.x, dz = near.z - p.z
      return design.postWidth / 2 * Math.hypot(dx, dz) / Math.max(Math.abs(dx), Math.abs(dz), 1e-8)
    }
    const firstFace = start + postExtent(a, at(Math.min(end, start + .0001)))
    const lastFace = end - postExtent(b, at(Math.max(start, end - .0001)))
    const free = lastFace - firstFace, width = design.spindleWidth
    if (free <= width) continue
    const count = Math.min(Math.floor(free / width), Math.max(1, Math.ceil((free + width) / design.spindleSpacing - 1e-8) - 1))
    const gap = (free - count * width) / (count + 1)
    for (let j = 0; j < count; j++) result.push(at(firstFace + gap + width / 2 + j * (width + gap)))
  }
  return result
}
