import { intersectSolid, prismSolid, type ConvexSolid, type SolidFace, type SolidPlane, type SolidPoint } from './convexSolid.ts'

// Construction tolerance for explicitly joined finishing surfaces, in metres.
// Keep this separate from numerical tolerances and from the design parameters.
export const ROOF_SEAM_TOLERANCE = 0.001
const NORMAL_EPS = 1e-7
const pairKey = (a: string, b: string) => [a, b].sort().join('/')
const roofId = (face: SolidFace) => face.tag.slice(0, face.tag.indexOf('/'))
const canonical = (plane: SolidPlane) => {
  const sign = plane.slice(0, 3).find(v => Math.abs(v) > NORMAL_EPS)! < 0 ? -1 : 1
  return { sign, plane: plane.map(v => v * sign) as SolidPlane }
}
const bounds = (points: SolidPoint[]) => [0, 1, 2].map(axis => [
  Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis])),
])

/** Rebuild the affected closed cells from common planes. Snapping only render
 * vertices leaves their neighbouring caps/undersides open or non-planar. */
export function weldJoinedRoofCells(cells: ConvexSolid[], joinedPairs: [string, string][]): ConvexSolid[] {
  if (!joinedPairs.length) return cells
  const joined = new Set(joinedPairs.map(([a, b]) => pairKey(a, b)))
  const groups: { plane: SolidPlane; faces: SolidFace[] }[] = []
  for (const cell of cells) for (const face of cell.faces) {
    const { plane } = canonical(face.plane)
    // Limit sloping-plane displacement to 1 mm vertically as well.
    const tolerance = ROOF_SEAM_TOLERANCE * (Math.abs(plane[1]) > NORMAL_EPS ? Math.abs(plane[1]) : 1)
    let group = groups.find(g => g.plane.slice(0, 3).every((v, axis) => Math.abs(v - plane[axis]) < NORMAL_EPS) &&
      Math.abs(g.plane[3] - plane[3]) <= tolerance)
    if (!group) { group = { plane, faces: [] }; groups.push(group) }
    group.faces.push(face)
  }
  // Only repair pairs with a near-coplanar top-skin discrepancy. A normal
  // valley, or the deliberate clearance around a room cutter, is not a seam.
  const compatible = new Set<string>()
  for (const group of groups) {
    const tops = group.faces.filter(face => face.tag.endsWith('/top'))
    for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
      const a = roofId(tops[i]), b = roofId(tops[j]), key = pairKey(a, b)
      if (a === b || !joined.has(key)) continue
      if (Math.abs(canonical(tops[i].plane).plane[3] - canonical(tops[j].plane).plane[3]) < 1e-8) continue
      const ab = bounds(tops[i].points), bb = bounds(tops[j].points)
      if (ab.every(([min, max], axis) => max >= bb[axis][0] - ROOF_SEAM_TOLERANCE && min <= bb[axis][1] + ROOF_SEAM_TOLERANCE)) compatible.add(key)
    }
  }
  const replacements = new Map<SolidFace, SolidPlane>()
  for (const group of groups) {
    const faceBounds = group.faces.map(face => bounds(face.points))
    const touching = new Set<string>()
    for (let i = 0; i < group.faces.length; i++) for (let j = i + 1; j < group.faces.length; j++) {
      const a = roofId(group.faces[i]), b = roofId(group.faces[j])
      if (a === b || !compatible.has(pairKey(a, b))) continue
      if (faceBounds[i].some(([min, max], axis) => max < faceBounds[j][axis][0] - ROOF_SEAM_TOLERANCE ||
        min > faceBounds[j][axis][1] + ROOF_SEAM_TOLERANCE)) continue
      touching.add(a); touching.add(b)
    }
    if (!touching.size) continue
    // The reference must belong to a roof participating in this actual contact.
    const reference = canonical(group.faces.find(face => touching.has(roofId(face)))!.plane).plane
    for (const face of group.faces) {
      if (!touching.has(roofId(face))) continue
      const { sign } = canonical(face.plane)
      const plane = reference.map(v => v * sign) as SolidPlane
      const tolerance = ROOF_SEAM_TOLERANCE * (Math.abs(plane[1]) > NORMAL_EPS ? Math.abs(plane[1]) : 1)
      if (Math.abs(plane[3] - face.plane[3]) > tolerance) continue
      if (plane.some((v, axis) => Math.abs(v - face.plane[axis]) > 1e-10)) replacements.set(face, plane)
    }
  }
  return cells.flatMap(cell => {
    if (!cell.faces.some(face => replacements.has(face))) return [cell]
    const [[minX, maxX], [minY, maxY], [minZ, maxZ]] = bounds(cell.faces.flatMap(face => face.points))
    const margin = 0.01
    let rebuilt: ConvexSolid | null = prismSolid([
      { x: minX - margin, y: minZ - margin }, { x: maxX + margin, y: minZ - margin },
      { x: maxX + margin, y: maxZ + margin }, { x: minX - margin, y: maxZ + margin },
    ], minY - margin, maxY + margin, 'assembly-bound')
    for (const face of cell.faces) {
      rebuilt = intersectSolid(rebuilt, replacements.get(face) ?? face.plane, face.tag)
      if (!rebuilt) return [] // A sub-tolerance seam cell can collapse entirely.
    }
    return [rebuilt]
  })
}
