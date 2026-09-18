import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { RoofVertex } from './roofSolidGeometry.ts'
import { roofFaceHeight } from './roofJunctions.ts'
import { footprintPlanes, type ClipPlane } from './wallEngine/wallRoofClip.ts'

export type RoomRoofCut = {
  face: RoofVertex[]
  thickness: number
  bottomY: number
  floorId?: string
  roofId?: string
  roomVolume?: boolean
}

type SurfaceVertex = { position: RoofVertex; normal: RoofVertex; uv: [number, number] }

const EPSILON = 1e-8
const CUT_VERTICAL_OVERLAP = 0.003
const CUT_FOOTPRINT_OVERLAP = 0.0001

function interpolate(a: SurfaceVertex, b: SurfaceVertex, t: number): SurfaceVertex {
  return {
    position: a.position.map((value, axis) => value + (b.position[axis] - value) * t) as RoofVertex,
    normal: a.normal.map((value, axis) => value + (b.normal[axis] - value) * t) as RoofVertex,
    uv: a.uv.map((value, axis) => value + (b.uv[axis] - value) * t) as [number, number],
  }
}

function hasArea(polygon: SurfaceVertex[]): boolean {
  if (polygon.length < 3) return false
  const a = polygon[0].position
  return polygon.slice(1, -1).some((vertex, index) => {
    const b = vertex.position, c = polygon[index + 2].position
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > EPSILON
  })
}

function split(polygon: SurfaceVertex[], plane: ClipPlane) {
  const inside: SurfaceVertex[] = [], outside: SurfaceVertex[] = []
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    const a = plane(previous.position), b = plane(current.position)
    if ((a > EPSILON && b < -EPSILON) || (a < -EPSILON && b > EPSILON)) {
      const intersection = interpolate(previous, current, a / (a - b))
      inside.push(intersection)
      outside.push(intersection)
    }
    if (b >= -EPSILON) inside.push(current)
    if (b <= EPSILON) outside.push(current)
  })
  return { inside, outside }
}

function subtractVolume(polygon: SurfaceVertex[], planes: ClipPlane[]): SurfaceVertex[][] {
  // Reject the complete volume before any plane can split a panel that will be retained.
  if (planes.some(plane => polygon.every(vertex => plane(vertex.position) < -EPSILON))) return [polygon]
  let inside = polygon
  const outside: SurfaceVertex[][] = []
  for (const plane of planes) {
    if (inside.every(vertex => plane(vertex.position) >= -EPSILON)) continue
    const parts = split(inside, plane)
    if (hasArea(parts.outside)) outside.push(parts.outside)
    inside = parts.inside
    if (!hasArea(inside)) return [polygon]
  }
  return outside
}

/** Clip open roof surfaces against room prisms while retaining the original
 * triangles and UVs anywhere no cutter actually crosses the surface. */
export function carveRoofSurfaceByRooms(
  geometry: BufferGeometry,
  cuts: RoomRoofCut[],
  toLocal: (point: RoofVertex) => RoofVertex = point => point,
): BufferGeometry {
  const position = geometry.getAttribute('position')
  if (!cuts.length || !position?.count) return geometry
  const uv = geometry.getAttribute('uv'), normal = geometry.getAttribute('normal')
  const index = geometry.getIndex()
  const planesByCut = cuts.flatMap(({ face, thickness, bottomY }) => {
    if (face.length < 3) return []
    const localFace = face.map(toLocal)
    const height = roofFaceHeight(localFace)
    if (!height) return []
    const bottom = toLocal([face[0][0], bottomY, face[0][2]])[1]
    return [[
      // A tiny footprint overlap absorbs float error without opening a visible
      // slit beside the retained ceiling face at roof junctions.
      ...footprintPlanes(localFace.map(([x, , z]) => ({ x, y: z })))
        .map(plane => ((point: RoofVertex) => plane(point) + CUT_FOOTPRINT_OVERLAP) as ClipPlane),
      (([x, y, z]: RoofVertex) => height({ x, y: z }) - thickness + CUT_VERTICAL_OVERLAP - y) as ClipPlane,
      (([, y]: RoofVertex) => y - bottom) as ClipPlane,
    ]]
  })
  if (!planesByCut.length) return geometry

  const triangles: SurfaceVertex[][] = []
  let changed = false
  for (let offset = 0; offset < (index?.count ?? position.count); offset += 3) {
    const source = [0, 1, 2].map(corner => {
      const id = index ? index.getX(offset + corner) : offset + corner
      return {
        position: [position.getX(id), position.getY(id), position.getZ(id)] as RoofVertex,
        normal: normal ? [normal.getX(id), normal.getY(id), normal.getZ(id)] as RoofVertex : [0, 1, 0] as RoofVertex,
        uv: uv ? [uv.getX(id), uv.getY(id)] as [number, number] : [0, 0] as [number, number],
      }
    })
    let visible = [source]
    for (const planes of planesByCut) {
      visible = visible.flatMap(polygon => subtractVolume(polygon, planes))
      if (!visible.length) break
    }
    if (visible.length !== 1 || visible[0] !== source) changed = true
    triangles.push(...visible)
  }
  if (!changed) return geometry

  const positions: number[] = [], normals: number[] = [], uvs: number[] = []
  for (const polygon of triangles) {
    for (let corner = 1; corner + 1 < polygon.length; corner++) {
      const triangle = [polygon[0], polygon[corner], polygon[corner + 1]]
      if (!hasArea(triangle)) continue
      for (const vertex of triangle) {
        positions.push(...vertex.position)
        normals.push(...vertex.normal)
        uvs.push(...vertex.uv)
      }
    }
  }
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  result.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  result.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}
