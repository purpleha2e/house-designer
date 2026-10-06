import { buildRoofProfileFaces, getGableChamferLimits } from './roofProfile.ts'
import { roofFaceHeight, roofToWorld, type RoofJunctionInput } from './roofJunctions.ts'
import { ROOF_EAVE_HEIGHT_TOLERANCE, ROOF_EAVE_PLAN_TOLERANCE } from './roofEaveAlignment.ts'

type Vertex = [number, number, number]
type Edge = 'minX' | 'maxX' | 'minY' | 'maxY'
type Eave = { input: RoofJunctionInput; edge: Edge; height: number; slope: number; segments: [Vertex, Vertex][] }
const EPS = 1e-7

function segmentDistance([a, b]: [Vertex, Vertex], [c, d]: [Vertex, Vertex]) {
  const cross = (x: number, z: number, u: number, v: number) => x * v - z * u
  const dx = b[0] - a[0], dz = b[2] - a[2], ex = d[0] - c[0], ez = d[2] - c[2]
  const determinant = cross(dx, dz, ex, ez)
  if (Math.abs(determinant) > EPS) {
    const t = cross(c[0] - a[0], c[2] - a[2], ex, ez) / determinant
    const u = cross(c[0] - a[0], c[2] - a[2], dx, dz) / determinant
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0
  }
  const distance = (p: Vertex, q: Vertex, r: Vertex) => {
    const x = r[0] - q[0], z = r[2] - q[2]
    const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * x + (p[2] - q[2]) * z) / (x * x + z * z)))
    return Math.hypot(p[0] - q[0] - t * x, p[2] - q[2] - t * z)
  }
  return Math.min(distance(a, c, d), distance(b, c, d), distance(c, a, b), distance(d, a, b))
}

/** Extend higher gable eaves along their existing planes to a nearby lower
 * eave. Supports, ridge and pitches remain fixed; derived extents are used by
 * junctions, wall clipping and finishes together. Never bend an overhang. */
export function alignRoofEaveExtents(inputs: RoofJunctionInput[]): RoofJunctionInput[] {
  const eaves: Eave[] = []
  for (const input of inputs) {
    if (input.roof.type !== 'up-and-over') continue
    const faces = buildRoofProfileFaces(input.roof, input.extents, input.support)
    for (const edge of ['minX', 'maxX', 'minY', 'maxY'] as const) {
      const end = edge.endsWith('Y'), axis = end ? 2 : 0, sign = edge.startsWith('min') ? -1 : 1
      if (Math.abs(input.extents[edge] - input.support[edge]) < EPS) continue
      if (end && !(sign < 0 ? input.roof.ridgeStartChamfer : input.roof.ridgeEndChamfer)) continue
      for (const face of faces) {
        const height = roofFaceHeight(face)
        if (!height) continue
        const slope = -sign * (height({ x: end ? 0 : 1, y: end ? 1 : 0 }) - height({ x: 0, y: 0 }))
        if (slope < EPS) continue
        for (let i = 0; i < face.length; i++) {
          const a = face[i], b = face[(i + 1) % face.length]
          if (Math.abs(a[axis] - input.extents[edge]) > EPS || Math.abs(b[axis] - input.extents[edge]) > EPS ||
            Math.abs(a[1] - b[1]) > EPS || Math.hypot(a[0] - b[0], a[2] - b[2]) < EPS) continue
          const segment: [Vertex, Vertex] = [roofToWorld(input.roof, input.elevation, a), roofToWorld(input.roof, input.elevation, b)]
          let eave = eaves.find(e => e.input === input && e.edge === edge && Math.abs(e.height - segment[0][1]) < EPS)
          if (!eave) { eave = { input, edge, height: segment[0][1], slope, segments: [] }; eaves.push(eave) }
          eave.segments.push(segment)
        }
      }
    }
  }
  eaves.sort((a, b) => a.height - b.height || a.input.roof.id.localeCompare(b.input.roof.id) || a.edge.localeCompare(b.edge))
  const groups = eaves.map((e, i) => ({ indices: [i], min: e.height, max: e.height }))
  const membership = eaves.map((_, i) => i)
  for (let i = 0; i < eaves.length; i++) for (let j = i + 1; j < eaves.length; j++) {
    if (eaves[j].height - eaves[i].height > ROOF_EAVE_HEIGHT_TOLERANCE + EPS) break
    const a = groups[membership[i]], b = groups[membership[j]], target = Math.min(a.min, b.min)
    if (a === b || eaves[i].input.floorId !== eaves[j].input.floorId ||
      Math.max(a.max, b.max) - target > ROOF_EAVE_HEIGHT_TOLERANCE + EPS) continue
    if ([...a.indices, ...b.indices].some(k => (eaves[k].height - target) / eaves[k].slope > ROOF_EAVE_PLAN_TOLERANCE + EPS)) continue
    if (!eaves[i].segments.some(s => eaves[j].segments.some(t => segmentDistance(s, t) <= ROOF_EAVE_PLAN_TOLERANCE + EPS))) continue
    for (const k of b.indices) membership[k] = membership[i]
    a.indices.push(...b.indices); a.min = target; a.max = Math.max(a.max, b.max)
  }
  return inputs.map(input => {
    const moves = eaves.flatMap((e, i) => {
      const distance = (e.height - groups[membership[i]].min) / e.slope
      return e.input === input && distance > EPS ? [{ edge: e.edge, distance }] : []
    })
    if (!moves.length) return input
    const extents = { ...input.extents }, roof = { ...input.roof }
    const limits = getGableChamferLimits(roof, input.extents, input.support)
    for (const field of ['ridgeStartChamfer', 'ridgeEndChamfer'] as const) {
      if (roof[field]) roof[field] = { ...roof[field], distance: limits[field].distance, matchEave: false }
    }
    for (const { edge, distance } of moves) {
      extents[edge] += (edge.startsWith('min') ? -1 : 1) * distance
      // Moving the outer end also increases the setback, leaving the chamfer
      // plane and its intersection with the ridge exactly where they were.
      const field = edge === 'minY' ? 'ridgeStartChamfer' : edge === 'maxY' ? 'ridgeEndChamfer' : undefined
      if (field && roof[field]) roof[field] = { ...roof[field], distance: roof[field].distance + distance }
    }
    return { ...input, roof, extents }
  })
}
