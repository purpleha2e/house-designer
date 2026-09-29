import { BufferGeometry, Float32BufferAttribute } from 'three'
import { intersectSolid, prismSolid, solidBoundaryFaces, subtractSolid, type ConvexSolid, type SolidFace, type SolidPlane } from './convexSolid.ts'
import type { DormerStructuralAssembly } from './dormerPlacement.ts'
import { getRoofThickness } from './roofThickness.ts'

function geometry(faces: SolidFace[]) {
  const positions = faces.flatMap(face => face.points.slice(1, -1).flatMap((point, i) =>
    [face.points[0], point, face.points[i + 2]].flat()))
  const result = new BufferGeometry()
  result.setAttribute('position', new Float32BufferAttribute(positions, 3))
  // Continuous world-sized mapping on the pitched roof and wall surfaces.
  result.setAttribute('uv', new Float32BufferAttribute(positions.flatMap((_, i) =>
    i % 3 === 0 ? [positions[i], positions[i + 2] + positions[i + 1]] : []), 2))
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
) {
  const { wallBaseY, wallHeight, roofHalfWidth, roofRise, depth, windowBottom, windowHeight, windowWidth } = assembly
  const halfWidth = Math.abs(assembly.walls[0].start.x)
  const halfWall = assembly.walls[0].thickness / 2
  const thickness = getRoofThickness(assembly.roof)
  const slope = roofRise / roofHalfWidth
  const hostSlope = slope * depthScale
  const ridge = wallHeight + roofRise
  const ceiling: SolidPlane[] = [[-slope, -1, 0, ridge - thickness], [slope, -1, 0, ridge - thickness]]
  const front = clip(box(-halfWidth - halfWall, halfWidth + halfWall, -halfWall, halfWall, wallBaseY, ridge, 'wall'), ceiling, 'wall')
  const window = box(-windowWidth / 2, windowWidth / 2, -halfWall - 1, halfWall + 1, windowBottom, windowBottom + windowHeight, 'window')
  const walls = front.flatMap(solid => subtractSolid(solid, window.planes, 'reveal'))
  for (const side of [-1, 1]) {
    // End the cheeks along the valley, including their thickness, instead of
    // leaving rectangular tails exposed inside the main sloping ceiling.
    let cheeks = clip(box(side * halfWidth - halfWall, side * halfWidth + halfWall, -depth, -halfWall, wallBaseY, ridge, 'wall'), [
      ...ceiling, [-side * slope, 0, hostSlope, ridge],
    ], 'wall')
    // The roof cavity is already the loft interior, not part of the dormer
    // enclosure. Retain full-height returns only outside an intersecting knee
    // wall; inside the room the cheeks start at the sloping roof underside.
    const belowRoof: SolidPlane = [0, -1, -hostSlope, -thickness + 0.003]
    for (const plane of roomPlanes.length ? roomPlanes : [null]) {
      cheeks = cheeks.flatMap(solid => subtractSolid(solid, plane ? [plane, belowRoof] : [belowRoof], 'wall'))
    }
    walls.push(...cheeks)
  }
  const roofSolids: ConvexSolid[] = []
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -roofHalfWidth : 0
    const x1 = side < 0 ? 0 : roofHalfWidth
    let panels = clip(box(x0, x1, -depth - thickness / hostSlope, 0.08, wallHeight - thickness, ridge, 'shell'), [
      [-side * slope, -1, 0, ridge],
    ], 'top')
    panels = panels.flatMap(solid => clip(solid, [[side * slope, 1, 0, thickness - ridge]], 'underside'))
    // Embed the junction through the host skin so its underside is also sealed.
    panels = panels.flatMap(solid => clip(solid, [[0, 1, hostSlope, thickness - 0.003]], 'shell'))
    roofSolids.push(...panels)
  }
  const faces = solidBoundaryFaces(roofSolids)
  const fascias = [-1, 1].flatMap(side => clip(box(
    side * roofHalfWidth - 0.035, side * roofHalfWidth + 0.035,
    -depth, 0.08, wallHeight - 0.055, wallHeight + 0.015, 'fascia',
  ), [[0, 1, hostSlope, 0]], 'fascia'))
  return {
    walls: geometry(solidBoundaryFaces(walls)),
    top: geometry(faces.filter(face => face.tag === 'top')),
    underside: geometry(faces.filter(face => face.tag === 'underside')),
    shell: geometry(faces.filter(face => face.tag === 'shell')),
    fascia: geometry(solidBoundaryFaces(fascias)),
  }
}
