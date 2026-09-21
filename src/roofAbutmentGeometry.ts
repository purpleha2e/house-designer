import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Point, Wall } from './types.ts'
import { clipWallFacesToRoofUndersides, type ClipPlane } from './wallEngine/wallRoofClip.ts'
import type { WallMeshFace } from './wallEngine/wallMesh.ts'

export type RoofAbuttingWall = { wall: Wall; elevation: number; floorId?: string }

const ROOF_WALL_EMBED_METERS = 0.006

export function wallOverlapsRoofHeight({ wall, elevation }: RoofAbuttingWall, minY: number, maxY: number) {
  return elevation <= maxY + 0.000001 && elevation + wall.height >= minY - 0.000001
}

// Continue the adjoining facade's boundary across openings and internal-wall
// sections, so the roof's end overhang cannot enter the neighboring rooms.
export function getRoofAbutmentPlanes(
  walls: RoofAbuttingWall[],
  roofCenter: Point,
  boundary: 'near' | 'embedded' | 'far' = 'near',
): ClipPlane[] {
  return walls.map(({ wall }): ClipPlane => {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    const ux = (wall.end.x - wall.start.x) / length
    const uz = (wall.end.y - wall.start.y) / length
    const sign = (roofCenter.x - wall.start.x) * -uz + (roofCenter.y - wall.start.y) * ux > 0 ? 1 : -1
    const across = (x: number, z: number) => sign * ((x - wall.start.x) * -uz + (z - wall.start.y) * ux)
    // The embedded boundary gives the wall a small depth lead, avoiding a
    // coplanar roof edge on the visible facade without changing its outline.
    const offset = boundary === 'far' ? -wall.thickness / 2
      : wall.thickness / 2 - (boundary === 'embedded' ? ROOF_WALL_EMBED_METERS : 0)
    return ([x, , z]) => offset - across(x, z)
  })
}

export function clipRoofGeometryAtAbuttingWalls(
  geometry: BufferGeometry,
  walls: RoofAbuttingWall[],
  toWorld: (point: [number, number, number]) => [number, number, number],
  roofCenter: Point,
) {
  if (!walls.length) return geometry
  return clipRoofGeometryByVolumes(geometry, getRoofAbutmentPlanes(walls, roofCenter).map(plane => [plane]), toWorld)
}

// Keep the facade continuous across openings and collinear wall sections, but
// stop trimming at its actual ends (including the corner's half thickness).
export function getRoofAbutmentSpanPlanes(abutment: RoofAbuttingWall, walls: RoofAbuttingWall[]): ClipPlane[] {
  const { wall, elevation } = abutment
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
  const ux = (wall.end.x - wall.start.x) / length
  const uz = (wall.end.y - wall.start.y) / length
  const along = (point: Point) => (point.x - wall.start.x) * ux + (point.y - wall.start.y) * uz
  const across = (point: Point) => (point.x - wall.start.x) * -uz + (point.y - wall.start.y) * ux
  const spans = walls.filter(candidate => Math.abs(candidate.elevation - elevation) < 1e-6 &&
    Math.abs(across(candidate.wall.start)) < 1e-6 && Math.abs(across(candidate.wall.end)) < 1e-6)
    .map(({ wall: candidate }) => ({
      min: Math.min(along(candidate.start), along(candidate.end)) - candidate.thickness / 2,
      max: Math.max(along(candidate.start), along(candidate.end)) + candidate.thickness / 2,
    }))
  const min = Math.min(-wall.thickness / 2, ...spans.map(span => span.min))
  const max = Math.max(length + wall.thickness / 2, ...spans.map(span => span.max))
  return [([x, , z]) => along({ x, y: z }) - min, ([x, , z]) => max - along({ x, y: z })]
}

export function clipRoofGeometryByVolumes(
  geometry: BufferGeometry,
  worldVolumes: ClipPlane[][],
  toWorld: (point: [number, number, number]) => [number, number, number],
) {
  if (!worldVolumes.length) return geometry
  const volumes = worldVolumes.map(planes => ({
    planes: planes.map(plane => (point: [number, number, number]) => plane(toWorld(point))),
    protectedFootprints: [], excludedWallIds: new Set<string>(), clipSides: true,
  }))
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const normal = geometry.getAttribute('normal')
  const indices = geometry.getIndex()
  const faces: WallMeshFace[] = []
  for (let i = 0; i < (indices?.count ?? position.count); i += 3) {
    const ids = [0, 1, 2].map((offset) => indices ? indices.getX(i + offset) : i + offset)
    const vertices = ids.map((index) => ({
      position: [position.getX(index), position.getY(index), position.getZ(index)] as [number, number, number],
      uv: uv ? [uv.getX(index), uv.getY(index)] as [number, number] : [0, 0] as [number, number],
    }))
    faces.push({
      faceId: `roof:${i}`, kind: 'side', wallId: 'roof',
      materialSource: { wallId: 'roof' }, pickSource: { wallId: 'roof' }, uvSource: { wallId: 'roof' },
      normal: [normal.getX(ids[0]), normal.getY(ids[0]), normal.getZ(ids[0])],
      vertices: [...vertices, vertices[2]] as WallMeshFace['vertices'],
    })
  }
  const clipped = clipWallFacesToRoofUndersides(faces, { floorElevation: 0, volumes })
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(clipped.flatMap((face) => face.vertices.slice(0, 3).flatMap((v) => v.position)), 3))
  result.setAttribute('uv', new Float32BufferAttribute(clipped.flatMap((face) => face.vertices.slice(0, 3).flatMap((v) => v.uv)), 2))
  result.setAttribute('normal', new Float32BufferAttribute(clipped.flatMap((face) => [0, 1, 2].flatMap(() => face.normal)), 3))
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}
