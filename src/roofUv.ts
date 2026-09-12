import type { RoofStructure } from './types.ts'
import { getPitchedRoofSurfaceDistance, type RoofBounds } from './roofProfile.ts'

export type RoofUvVertex = [number, number, number]
export type RoofFaceUvProjector = (
  vertices: RoofUvVertex[],
) => Array<[number, number]>

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
