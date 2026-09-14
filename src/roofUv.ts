import type { RoofStructure } from './types.ts'
import { getPitchedRoofSurfaceDistance, type RoofBounds } from './roofProfile.ts'
import { getBaySupportPolygon } from './bayRoof.ts'

export type RoofUvVertex = [number, number, number]
export type RoofFaceUvProjector = (
  vertices: RoofUvVertex[],
) => Array<[number, number]>

/** Align bay tile courses with each eave, retaining metre scale across pitch breaks. */
export function getBayRoofTopUvs(roof: RoofStructure, vertices: RoofUvVertex[]): Array<[number, number]> {
  const support = getBaySupportPolygon(roof)
  const origin = vertices[0]
  if (!origin) return []
  let normal: RoofUvVertex = [0, 1, 0]
  for (let i = 1; i + 1 < vertices.length; i++) {
    const a = vertices[i].map((v, j) => v - origin[j])
    const b = vertices[i + 1].map((v, j) => v - origin[j])
    const n: RoofUvVertex = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    if (Math.hypot(...n) > 1e-8) { normal = n[1] < 0 ? n.map(v => -v) as RoofUvVertex : n; break }
  }
  const centre = vertices.reduce((sum, p) => ({ x: sum.x + p[0] / vertices.length, y: sum.y + p[2] / vertices.length }), { x: 0, y: 0 })
  const edges = support.slice(1).map((a, i) => {
    const b = support[(i + 2) % support.length], length = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / length, uz = (b.y - a.y) / length
    return { a, ux, uz, dx: uz, dz: -ux }
  })
  const sloped = Math.hypot(normal[0], normal[2]) > 1e-8
  const score = (edge: typeof edges[number]) => sloped
    ? normal[0] * edge.dx + normal[2] * edge.dz
    : (centre.x - edge.a.x) * edge.dx + (centre.y - edge.a.y) * edge.dz
  const edge = edges.reduce((best, next) => score(next) > score(best) ? next : best)
  const slope = (normal[0] * edge.dx + normal[2] * edge.dz) / Math.max(1e-8, normal[1])
  const scale = Math.hypot(1, slope)
  return vertices.map(([x, y, z]) => [x * edge.ux + z * edge.uz,
    ((x - edge.a.x) * edge.dx + (z - edge.a.y) * edge.dz - y * slope) / scale])
}

/**
 * Projects a roof face in metre-based coordinates. Choosing its longest plan
 * edge as U keeps the texture square on pitched and hipped faces instead of
 * restarting a 0..1 UV triangle for every triangulated polygon.
 */
export const getRoofFaceProjectedUvs: RoofFaceUvProjector = (vertices) => {
  if (vertices.length < 3) {
    return vertices.map(() => [0, 0])
  }

  const subtract = (a: RoofUvVertex, b: RoofUvVertex) =>
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as RoofUvVertex
  const cross = (a: RoofUvVertex, b: RoofUvVertex) =>
    [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ] as RoofUvVertex
  const normalize = (value: RoofUvVertex) => {
    const length = Math.hypot(...value)
    return length > 0.000001
      ? value.map(component => component / length) as RoofUvVertex
      : [1, 0, 0] as RoofUvVertex
  }
  const dot = (a: RoofUvVertex, b: RoofUvVertex) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const normal = normalize(cross(
    subtract(vertices[1], vertices[0]),
    subtract(vertices[2], vertices[0]),
  ))
  const longestPlanEdge = vertices.reduce<{
    direction: RoofUvVertex
    lengthSquared: number
  } | null>((current, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]
    const direction: RoofUvVertex = [next[0] - vertex[0], 0, next[2] - vertex[2]]
    const lengthSquared = dot(direction, direction)
    return !current || lengthSquared > current.lengthSquared
      ? { direction, lengthSquared }
      : current
  }, null)
  const uAxis = longestPlanEdge && longestPlanEdge.lengthSquared > 0.000001
    ? normalize(longestPlanEdge.direction)
    : [1, 0, 0] as RoofUvVertex
  const vAxis = normalize(cross(normal, uAxis))

  return vertices.map(vertex => [dot(vertex, uAxis), dot(vertex, vAxis)])
}

export const getFlippedRoofFaceProjectedUvs: RoofFaceUvProjector = (vertices) =>
  getRoofFaceProjectedUvs(vertices).map(([u, v]) => [-u, -v])

/**
 * Keeps tile courses perpendicular to a clipped gable's fall line. Chamfer
 * polygons are often triangular, so choosing their longest edge can rotate the
 * texture onto a hip. Roof-local X always runs across the gable; Z runs down
 * the chamfer and is scaled to its true sloping length.
 */
export const getGableChamferTopUvs: RoofFaceUvProjector = (vertices) => {
  let fall: { dy: number; dz: number } | null = null
  for (let firstIndex = 0; firstIndex < vertices.length; firstIndex++) {
    const first = vertices[firstIndex]
    for (let secondIndex = firstIndex + 1; secondIndex < vertices.length; secondIndex++) {
      const second = vertices[secondIndex]
      const dz = second[2] - first[2]
      if (Math.abs(dz) > Math.abs(fall?.dz ?? 0)) {
        fall = { dy: second[1] - first[1], dz }
      }
    }
  }
  const slope = fall && Math.abs(fall.dz) > 0.000001
    ? fall.dy / fall.dz
    : 0
  const surfaceScale = Math.hypot(1, slope)
  return vertices.map(([x, , z]) => [x, z * surfaceScale])
}

/** Keeps tile courses continuous from an eave to the ridge in roof-local space. */
export function getPitchedRoofTopUvs(
  roof: RoofStructure,
  supportBounds: RoofBounds,
  vertices: RoofUvVertex[],
) {
  return vertices.map(([x, , z]) => [
    z,
    getPitchedRoofSurfaceDistance(roof, supportBounds, x),
  ] as [number, number])
}
