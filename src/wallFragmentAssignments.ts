import type { SurfaceMaterialAssignment } from './types.ts'
import type { WallMeshFace } from './wallEngine/wallMesh.ts'
import { isRoofRegionSubdivision } from './wallEngine/wallRoofSurfacePartitions.ts'

/** A floor band continues the finish touching its bottom edge. Roof partition
 * labels can differ from the supporting face when the band lies wholly beyond
 * a roof contact, so matching fragment IDs alone is insufficient. */
export function findStoreyBoundaryAssignment(
  assignments: SurfaceMaterialAssignment[],
  face: WallMeshFace,
  faces: readonly WallMeshFace[],
  currentFaceIds: ReadonlySet<string>,
): SurfaceMaterialAssignment | undefined {
  if (!face.storeyBoundary) return undefined
  // A clipped triangle may no longer reach the band base. Use the complete
  // continuation's base so its upper triangles inherit the same finish.
  const baseId = face.faceId.split(':roof-region:')[0]
  const minY = Math.min(...face.vertices.map(v => v.position[1]))
  const maxY = Math.max(...face.vertices.map(v => v.position[1]))
  const bandFaces = faces.filter(candidate => candidate.storeyBoundary &&
    candidate.faceId.split(':roof-region:')[0] === baseId &&
    Math.max(...candidate.vertices.map(v => v.position[1])) >= minY - 1e-5 &&
    Math.min(...candidate.vertices.map(v => v.position[1])) <= maxY + 1e-5)
  const bottom = Math.min(...(bandFaces.length ? bandFaces : [face])
    .flatMap(candidate => candidate.vertices.map(v => v.position[1])))
  const along = (v: WallMeshFace['vertices'][number]) =>
    v.position[0] * -face.normal[2] + v.position[2] * face.normal[0]
  const min = Math.min(...face.vertices.map(along)), max = Math.max(...face.vertices.map(along))
  let best: SurfaceMaterialAssignment | undefined
  let bestOverlap = 0
  for (const source of faces) {
    if (source.storeyBoundary || source.kind !== 'side' || source.wallId !== face.wallId ||
      source.pickSource.side !== face.pickSource.side ||
      source.normal[0] * face.normal[0] + source.normal[2] * face.normal[2] < 0.99) continue
    const touching = source.vertices.filter(v => Math.abs(v.position[1] - bottom) < 1e-5)
    if (touching.length < 2) continue
    const overlap = Math.min(max, Math.max(...touching.map(along))) -
      Math.max(min, Math.min(...touching.map(along)))
    if (overlap <= bestOverlap + 1e-6) continue
    const assignment = findWallFragmentAssignmentForFace(assignments, source, currentFaceIds)
    if (assignment) { best = assignment; bestOverlap = overlap }
  }
  return best
}

export function findWallFragmentAssignmentForFace(
  surfaceAssignments: SurfaceMaterialAssignment[],
  face: Pick<WallMeshFace, 'faceId' | 'pickSource'> & Partial<Pick<WallMeshFace, 'materialSource'>>,
  currentFaceIds?: ReadonlySet<string>,
): SurfaceMaterialAssignment | undefined {
  if (typeof face.pickSource.side !== 'number') {
    return undefined
  }

  const exactAssignment = surfaceAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      assignment.target.wallId === face.pickSource.wallId &&
      (assignment.target.fragmentId === face.faceId ||
        face.faceId.startsWith(`${assignment.target.fragmentId}:uncovered:`) ||
        face.faceId.startsWith(`${assignment.target.fragmentId}:roof-region:`) ||
        isRoofRegionSubdivision(face.faceId, assignment.target.fragmentId)) &&
      (assignment.target.side === 'both' ||
        assignment.target.side === face.pickSource.side),
  )
  if (exactAssignment) return exactAssignment

  // Rebuilt roof caps have IDs derived from triangulation and cutter order.
  // If their own saved finish no longer matches, retain the touching facade's
  // fragment finish instead of falling back to an unrelated whole-wall paint.
  const inheritedSource = face.materialSource
  if (inheritedSource?.fragmentId && inheritedSource.fragmentId !== face.faceId) {
    const inherited = findWallFragmentAssignmentForFace(surfaceAssignments, {
      faceId: inheritedSource.fragmentId,
      pickSource: inheritedSource,
    }, currentFaceIds)
    if (inherited) return inherited
  }

  const faceBounds = parseWallSideFragmentBounds(face.faceId)
  if (!faceBounds) return undefined

  let bestAssignment: SurfaceMaterialAssignment | undefined
  let bestCoverage = 0
  for (const assignment of surfaceAssignments) {
    if (assignment.target.type !== 'wall-surface-fragment' ||
      assignment.target.wallId !== face.pickSource.wallId ||
      currentFaceIds?.has(assignment.target.fragmentId) ||
      (assignment.target.side !== 'both' && assignment.target.side !== face.pickSource.side)) continue
    const assignmentBounds = parseWallSideFragmentBounds(assignment.target.fragmentId)
    if (!assignmentBounds || assignmentBounds.roofRegion !== faceBounds.roofRegion) continue
    const overlapWidth = Math.max(0,
      Math.min(faceBounds.maxAlong, assignmentBounds.maxAlong) -
      Math.max(faceBounds.minAlong, assignmentBounds.minAlong))
    const overlapHeight = Math.max(0,
      Math.min(faceBounds.maxY, assignmentBounds.maxY) -
      Math.max(faceBounds.minY, assignmentBounds.minY))
    const faceArea = (faceBounds.maxAlong - faceBounds.minAlong) *
      (faceBounds.maxY - faceBounds.minY)
    const coverage = faceArea > 0 ? overlapWidth * overlapHeight / faceArea : 0
    if (coverage >= bestCoverage && coverage > 0.001) {
      bestAssignment = assignment
      bestCoverage = coverage
    }
  }
  return bestAssignment
}

function parseWallSideFragmentBounds(fragmentId: string) {
  const match = fragmentId.match(
    /^perimeter-wall:[^:]+:(?:-1|1):side:(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)(?=:|$)/,
  )
  if (!match) return undefined
  const roofRegionMarker = ':roof-region:'
  const roofRegionIndex = fragmentId.indexOf(roofRegionMarker)
  return {
    minAlong: Number(match[1]),
    maxAlong: Number(match[2]),
    minY: Number(match[3]),
    maxY: Number(match[4]),
    roofRegion: roofRegionIndex >= 0
      ? fragmentId.slice(roofRegionIndex + roofRegionMarker.length)
      : '',
  }
}
