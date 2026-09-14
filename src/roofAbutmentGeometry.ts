import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Point, Wall } from './types.ts'
import { clipWallFacesToRoofUndersides, type ClipPlane } from './wallEngine/wallRoofClip.ts'
import type { WallMeshFace } from './wallEngine/wallMesh.ts'

export type RoofAbuttingWall = { wall: Wall; elevation: number }

export function wallOverlapsRoofHeight({ wall, elevation }: RoofAbuttingWall, minY: number, maxY: number) {
  return elevation <= maxY + 0.000001 && elevation + wall.height >= minY - 0.000001
}

// Continue the adjoining facade's boundary across openings and internal-wall
// sections, so the roof's end overhang cannot enter the neighboring rooms.
export function getRoofAbutmentPlanes(walls: RoofAbuttingWall[], roofCenter: Point): ClipPlane[] {
  return walls.map(({ wall }): ClipPlane => {
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    const ux = (wall.end.x - wall.start.x) / length
    const uz = (wall.end.y - wall.start.y) / length
    const sign = (roofCenter.x - wall.start.x) * -uz + (roofCenter.y - wall.start.y) * ux > 0 ? 1 : -1
    const across = (x: number, z: number) => sign * ((x - wall.start.x) * -uz + (z - wall.start.y) * ux)
    const half = wall.thickness / 2
    return ([x, , z]) => half - across(x, z)
  })
}

export function clipRoofGeometryAtAbuttingWalls(
  geometry: BufferGeometry,
  walls: RoofAbuttingWall[],
  toWorld: (point: [number, number, number]) => [number, number, number],
  roofCenter: Point,
) {
  if (!walls.length) return geometry
  const volumes = getRoofAbutmentPlanes(walls, roofCenter).map((plane) => ({
    planes: [(point: [number, number, number]) => plane(toWorld(point))],
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
      uv: [uv.getX(index), uv.getY(index)] as [number, number],
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
