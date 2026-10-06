import { intersectSolid, prismSolid, type ConvexSolid, type SolidFace } from './convexSolid.ts'

// Finishing tolerance, separate from the 1 mm tile-plane welding tolerance.
export const ROOF_EAVE_HEIGHT_TOLERANCE = 0.3048
export const ROOF_EAVE_PLAN_TOLERANCE = 0.3048
const EPS = 1e-7
const pairKey = (a: string, b: string) => [a, b].sort().join('/')
const owner = (face: SolidFace) => face.tag.split('/').slice(0, -1).join('/')
const isBase = (face: SolidFace) => face.tag.split('/').at(-1) === 'eave-base'

function nearby(a: SolidFace, b: SolidFace) {
  // Horizontal base polygons are convex. SAT rejects diagonal near-misses
  // as well as gaps, including when both roofs have been rotated.
  let separated = false
  for (const polygon of [a.points, b.points]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length]
    const dx = q[0] - p[0], dz = q[2] - p[2], length = Math.hypot(dx, dz)
    if (length < EPS) continue
    const project = (face: SolidFace) => face.points.map(v => (v[0] * dz - v[2] * dx) / length)
    const pa = project(a), pb = project(b)
    const gap = Math.max(Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb))
    if (gap > ROOF_EAVE_PLAN_TOLERANCE + EPS) return false
    if (gap > EPS) separated = true
  }
  if (!separated) return true
  // Euclidean distance excludes diagonally separated corners that only have
  // close bounding boxes. Projection is in plan, independent of roof pitch.
  for (const [vertices, edges] of [[a.points, b.points], [b.points, a.points]]) {
    for (const p of vertices) for (let i = 0; i < edges.length; i++) {
      const q = edges[i], r = edges[(i + 1) % edges.length]
      const dx = r[0] - q[0], dz = r[2] - q[2], lengthSquared = dx * dx + dz * dz
      if (lengthSquared < EPS * EPS) continue
      const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[2] - q[2]) * dz) / lengthSquared))
      if (Math.hypot(p[0] - q[0] - t * dx, p[2] - q[2] - t * dz) <= ROOF_EAVE_PLAN_TOLERANCE + EPS) return true
    }
  }
  return false
}

/** Give nearby eave boxes one level underside without modifying tile planes.
 * Only original flat soffit bases participate; cut faces and sloping soffits
 * cannot become accidental height references. Lowering preserves fascia depth. */
export function alignRoofEaveBases(cells: ConvexSolid[], sameFloorPairs: [string, string][] = []): ConvexSolid[] {
  const eligible = new Set(sameFloorPairs.map(([a, b]) => pairKey(a, b)))
  const bases = cells.flatMap(cell => cell.faces.filter(isBase).map(face => ({ face, height: -face.plane[3] })))
    .sort((a, b) => a.height - b.height || owner(a.face).localeCompare(owner(b.face)) ||
      JSON.stringify(a.face.points).localeCompare(JSON.stringify(b.face.points)))
  const groups = bases.map((base, i) => ({ indices: [i], min: base.height, max: base.height }))
  const membership = bases.map((_, i) => i)
  for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) {
    if (bases[j].height - bases[i].height > ROOF_EAVE_HEIGHT_TOLERANCE + EPS) break
    const a = groups[membership[i]], b = groups[membership[j]]
    if (a === b || Math.max(a.max, b.max) - Math.min(a.min, b.min) > ROOF_EAVE_HEIGHT_TOLERANCE + EPS) continue
    const oa = owner(bases[i].face), ob = owner(bases[j].face)
    if (oa !== ob && !eligible.has(pairKey(oa, ob))) continue
    if (!nearby(bases[i].face, bases[j].face)) continue
    for (const index of b.indices) membership[index] = membership[i]
    a.indices.push(...b.indices); a.min = Math.min(a.min, b.min); a.max = Math.max(a.max, b.max)
  }
  const heights = new Map(bases.map((base, i) => [base.face, groups[membership[i]].min]))
  return cells.map(cell => {
    const changed = cell.faces.some(face => isBase(face) && -face.plane[3] - heights.get(face)! > EPS)
    const finish = (face: SolidFace) => ({ ...face, tag: isBase(face) ? face.tag.replace(/eave-base$/, 'eaves') : face.tag })
    if (!changed) return { ...cell, faces: cell.faces.map(finish) }
    const bounds = [0, 1, 2].map(axis => {
      const values = cell.faces.flatMap(face => face.points.map(p => p[axis]))
      return [Math.min(...values) - ROOF_EAVE_HEIGHT_TOLERANCE - 0.01, Math.max(...values) + 0.01]
    })
    const [[x0, x1], [y0, y1], [z0, z1]] = bounds
    let rebuilt = prismSolid([{ x: x0, y: z0 }, { x: x1, y: z0 }, { x: x1, y: z1 }, { x: x0, y: z1 }], y0, y1, 'eaves')!
    for (const face of cell.faces) {
      const plane = isBase(face) ? [0, 1, 0, -heights.get(face)!] as [number, number, number, number] : face.plane
      rebuilt = intersectSolid(rebuilt, plane, finish(face).tag)!
    }
    return rebuilt
  })
}
