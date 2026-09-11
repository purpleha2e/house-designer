import type { SurfaceMaterialAssignment } from './types.ts'
import type { WallMeshFace } from './wallEngine/wallMesh.ts'

export function findWallFragmentAssignmentForFace(
  surfaceAssignments: SurfaceMaterialAssignment[],
  face: Pick<WallMeshFace, 'faceId' | 'pickSource'>,
) {
  if (typeof face.pickSource.side !== 'number') {
    return undefined
  }

  return surfaceAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      assignment.target.wallId === face.pickSource.wallId &&
      (assignment.target.fragmentId === face.faceId ||
        face.faceId.startsWith(`${assignment.target.fragmentId}:uncovered:`)) &&
      (assignment.target.side === 'both' ||
        assignment.target.side === face.pickSource.side),
  )
}
