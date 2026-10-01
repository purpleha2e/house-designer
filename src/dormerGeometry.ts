import { BufferGeometry, Float32BufferAttribute } from 'three'
import { clipSolidPolygon, intersectSolid, prismSolid, solidBoundaryFaces, subtractSolid, subtractSolidPolygon, type ConvexSolid, type SolidFace, type SolidPlane } from './convexSolid.ts'
import type { DormerStructuralAssembly } from './dormerPlacement.ts'
import { getRoofThickness } from './roofThickness.ts'

function geometry(faces: SolidFace[], materialIndex?: (face: SolidFace) => number,
  roofUv?: (x: number, y: number, z: number) => number[]) {
  const positions: number[] = [], uvs: number[] = []
  const result = new BufferGeometry()
  // Keep each material contiguous so the closed wall solid uses two draw calls.
  const orderedFaces = materialIndex ? [...faces].sort((a, b) => materialIndex(a) - materialIndex(b)) : faces
  for (const face of orderedFaces) {
    const start = positions.length / 3
    const normal = face.plane.slice(0, 3).map(Math.abs)
    for (let i = 1; i + 1 < face.points.length; i++) {
      for (const [x, y, z] of [face.points[0], face.points[i], face.points[i + 1]]) {
        positions.push(x, y, z)
        // Project onto each face's dominant plane, so cheek textures have area.
        uvs.push(...(roofUv ? roofUv(x, y, z) : normal[1] >= Math.max(normal[0], normal[2]) ? [x, z]
          : normal[0] > normal[2] ? [z, y] : [x, y]))
      }
    }
    if (materialIndex) {
      const index = materialIndex(face), count = positions.length / 3 - start
      const previous = result.groups.at(-1)
      if (previous?.materialIndex === index) previous.count += count
      else result.addGroup(start, count, index)
    }
  }
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  result.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  result.computeVertexNormals()
  result.computeBoundingSphere()
  return result
}

function box(x0: number, x1: number, z0: number, z1: number, bottom: number, top: number, tag: string) {
  return prismSolid([{ x: x0, y: z0 }, { x: x1, y: z0 }, { x: x1, y: z1 }, { x: x0, y: z1 }], bottom, top, tag)
}

function clip(solid: ConvexSolid, planes: SolidPlane[], tag: string) {
  let result: ConvexSolid | null = solid
  for (const plane of planes) {
    if (!result) break
    result = intersectSolid(result, plane, tag)
  }
  return result ? [result] : []
}

/** Closed dormer walls and a roof terminating at the host slope, in model space. */
export function createDormerGeometries(
  assembly: DormerStructuralAssembly,
  depthScale = 1,
  roomPlanes: SolidPlane[] = [],
  wallJunctionSolids: SolidPlane[][] = [],
) {
  const { wallBaseY, wallHeight, roofHalfWidth, roofRise, depth, windowBottom, windowHeight, windowWidth } = assembly
  const halfWidth = Math.abs(assembly.walls[0].start.x)
  const halfWall = assembly.walls[0].thickness / 2
  const frontRoofEdge = halfWall + 0.04
  const thickness = getRoofThickness(assembly.roof)
  const slope = roofRise / roofHalfWidth
  const hostSlope = slope * depthScale
  const ridge = wallHeight + roofRise
  const ceiling: SolidPlane[] = [[-slope, -1, 0, ridge - thickness], [slope, -1, 0, ridge - thickness]]
  const front = clip(box(-halfWidth - halfWall, halfWidth + halfWall, -halfWall, halfWall, wallBaseY, ridge, 'wall'), ceiling, 'wall')
  const window = box(-windowWidth / 2, windowWidth / 2, -halfWall - 1, halfWall + 1, windowBottom, windowBottom + windowHeight, 'window')
  // Without a knee wall this is a roof opening, not a floor-height bay. The
  // front apron must stop at the lining just like the cheeks.
  const belowRoof: SolidPlane = [0, -1, -hostSlope, -thickness + 0.003]
  const frontWalls = roomPlanes.length ? front
    : front.flatMap(solid => subtractSolid(solid, [belowRoof], 'wall'))
  const walls = frontWalls.flatMap(solid => subtractSolid(solid, window.planes, 'reveal'))
  for (const side of [-1, 1]) {
    // The roof lining clips the upper cheeks at the valley. Lower returns can
    // continue behind that valley to meet a knee wall in a wide, low dormer.
    let cheeks = clip(box(side * halfWidth - halfWall, side * halfWidth + halfWall, -depth, -halfWall, wallBaseY, ridge, 'wall'), ceiling, 'wall')
    // The roof cavity is already the loft interior, not part of the dormer
    // enclosure. Retain full-height returns only outside an intersecting knee
    // wall; inside the room the cheeks start at the sloping roof underside.
    for (const plane of roomPlanes.length ? roomPlanes : [null]) {
      cheeks = cheeks.flatMap(solid => subtractSolid(solid, plane ? [plane, belowRoof] : [belowRoof], 'wall'))
    }
    walls.push(...cheeks)
  }
  const roofSolids: ConvexSolid[] = []
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -roofHalfWidth : 0
    const x1 = side < 0 ? 0 : roofHalfWidth
    let panels = clip(box(x0, x1, -depth - thickness / hostSlope, frontRoofEdge, wallHeight - thickness, ridge, 'shell'), [
      [-side * slope, -1, 0, ridge],
    ], 'top')
    panels = panels.flatMap(solid => clip(solid, [[side * slope, 1, 0, thickness - ridge]], 'underside'))
    // Meet the host underside exactly. Insetting this cap leaves a slit between
    // the two linings. The buried joint must not render a tiled cap coplanar
    // with the host lining, which would cause z-fighting along the valley.
    panels = panels.flatMap(solid => clip(solid, [[0, 1, hostSlope, thickness]], 'junction'))
    roofSolids.push(...panels)
  }
  const faces = solidBoundaryFaces(roofSolids)
  // Match the main roof's 160 mm boxed eaves, tucked beneath the tile skin.
  const fasciaHeight = 0.16
  const fascias: ConvexSolid[] = []
  for (const side of [-1, 1]) {
    const innerX = side * (halfWidth + halfWall - 0.01), edgeX = side * roofHalfWidth
    fascias.push(...clip(box(Math.min(innerX, edgeX), Math.max(innerX, edgeX),
      -depth, frontRoofEdge, wallHeight - thickness - fasciaHeight, ridge, 'fascia'),
    [[-side * slope, -1, 0, ridge - thickness], [0, 1, hostSlope, 0]], 'fascia'))
    // Continuous barge soffit underneath the front overhang, meeting the eaves.
    fascias.push(...clip(box(side < 0 ? -roofHalfWidth : 0, side < 0 ? 0 : roofHalfWidth,
      halfWall, frontRoofEdge, wallHeight - thickness - fasciaHeight, ridge, 'fascia'),
    [[-side * slope, -1, 0, ridge - thickness],
      [side * slope, 1, 0, thickness + fasciaHeight - ridge], [0, 1, hostSlope, 0]], 'fascia'))
  }
  const interiorUnderside = faces.filter(face => face.tag === 'underside').flatMap(face => {
    let points = face.points
    for (const plane of [[1, 0, 0, halfWidth + halfWall], [-1, 0, 0, halfWidth + halfWall],
      [0, 0, -1, halfWall]] as SolidPlane[]) points = clipSolidPolygon(points, plane)
    return points.length ? [{ ...face, points }] : []
  })
  // Same convention as the main pitched roof: u along the ridge, v down the pitch.
  const roofUv = (x: number, _y: number, z: number) => [z, Math.abs(x) * Math.hypot(1, slope)]
  return {
    walls: geometry(solidBoundaryFaces(walls).flatMap(face => {
      // Only the room-facing cut caps share the existing wall's visible plane.
      // Other cheek faces may extend above its roof-clipped top and must remain.
      if (!roomPlanes.some(plane => face.points.every(([x, y, z]) =>
        Math.abs(plane[0] * x + plane[1] * y + plane[2] * z + plane[3]) < 1e-7))) return [face]
      let pieces = [face.points]
      for (const planes of wallJunctionSolids) pieces = pieces.flatMap(points => subtractSolidPolygon(points, planes))
      return pieces.map(points => ({ ...face, points }))
    }), face => {
      const exterior = face.points.every(p => Math.abs(p[2] - halfWall) < 1e-6) ||
        [-1, 1].some(side => face.points.every(p => Math.abs(p[0] - side * (halfWidth + halfWall)) < 1e-6))
      return exterior ? 0 : 1
    }),
    top: geometry(faces.filter(face => face.tag === 'top'), undefined, roofUv),
    underside: geometry(interiorUnderside, undefined, roofUv),
    shell: geometry(faces.filter(face => face.tag === 'shell')),
    fascia: geometry(solidBoundaryFaces(fascias)),
  }
}
