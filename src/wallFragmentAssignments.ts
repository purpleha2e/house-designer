import type { SurfaceMaterialAssignment } from './types.ts'
import type { WallMeshFace } from './wallEngine/wallMesh.ts'
import { isRoofRegionSubdivision } from './wallEngine/wallRoofSurfacePartitions.ts'

export function findWallFragmentAssignmentForFace(
  surfaceAssignments: SurfaceMaterialAssignment[],
  face: Pick<WallMeshFace, 'faceId' | 'pickSource'>,
  currentFaceIds?: ReadonlySet<string>,
) {
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
