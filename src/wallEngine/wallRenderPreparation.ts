import type { SurfaceMaterialAssignment, SurfaceWallSide, Wall } from '../types.ts'
import type { WallSide } from './wallGraph.ts'
import type { WallMeshFace as WallEngineFace } from './wallMesh.ts'
import type { FloorAssembly } from '../storeyGeometry.ts'
import { findStoreyBoundaryAssignment, findUpperFacadeSourceForRoofCut, findWallFragmentAssignmentForFace } from '../wallFragmentAssignments.ts'
import { buildWallBufferGeometryPayload } from './wallBuffer.ts'
import { wallMaterialBatchKey } from './wallMaterialBatchKey.ts'
export function resolveWallEngineFinish({
  source,
  surfaceAssignments,
  wallsById,
}: {
  source: {
    fragmentId?: string
    role?: 'cap' | 'room-surface'
    side?: WallSide
    wallId: string
  }
  surfaceAssignments: SurfaceMaterialAssignment[]
  wallsById: Map<string, Wall>
}) {
  const wall = wallsById.get(source.wallId)
  const wallMaterialAssignments = wall
    ? getWallSurfaceMaterialAssignments(surfaceAssignments, wall.id)
    : []
  const ownSideAssignment =
    wall
      ? getWallMaterialAssignmentForSource(
          wallMaterialAssignments,
          source,
          wall.height,
        )
      // A roof-cut reveal can continue the facade of the storey above.
      // Its saved fragment finish is valid even though that wall is not in
      // this floor's wall map.
      : source.fragmentId ? surfaceAssignments.findLast(assignment =>
          assignment.target.type === 'wall-surface-fragment' &&
          assignment.target.wallId === source.wallId && assignment.target.fragmentId === source.fragmentId &&
          (assignment.target.side === 'both' || assignment.target.side === source.side)) : undefined
  const capSideAssignment =
    wall && (source.side === 1 || source.side === -1)
      ? getExternalWallSlabEdgeMaterialAssignment(
          surfaceAssignments,
          wall,
          source.side,
        )
      : undefined
  const capSideOneAssignment =
    wall && source.role === 'cap'
      ? getExternalWallSlabEdgeMaterialAssignment(surfaceAssignments, wall, 1)
      : undefined
  const capSideTwoAssignment =
    wall && source.role === 'cap'
      ? getExternalWallSlabEdgeMaterialAssignment(surfaceAssignments, wall, -1)
      : undefined
  const capSharedAssignment =
    capSideOneAssignment && capSideTwoAssignment
      ? wallMaterialAssignmentsMatch(capSideOneAssignment, capSideTwoAssignment)
        ? capSideOneAssignment
        : undefined
      : capSideOneAssignment ?? capSideTwoAssignment
  const assignment =
    ownSideAssignment ?? (source.role === 'cap'
      ? capSideAssignment ?? capSharedAssignment
      : undefined)
  return { assignment, fallback: wall?.kind === 'external' ? 'external' as const : 'internal' as const }
}
export function getWallSurfaceMaterialAssignments(
  surfaceAssignments: SurfaceMaterialAssignment[],
  wallId: string,
) {
  return surfaceAssignments.filter(
    (assignment) =>
      (assignment.target.type === 'wall-face' ||
        assignment.target.type === 'wall-surface-fragment') &&
      assignment.target.wallId === wallId,
  )
}

export function getWallFaceMaterialAssignmentForSide(
  wallMaterialAssignments: SurfaceMaterialAssignment[],
  side: Exclude<SurfaceWallSide, 'both'>,
  height: number,
) {
  return wallMaterialAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-face' &&
      (assignment.coverageHeight ?? Number.POSITIVE_INFINITY) >= height - 0.001 &&
      (assignment.target.side === 'both' || assignment.target.side === side),
  )
}

export function getWallMaterialAssignmentForSide(
  wallMaterialAssignments: SurfaceMaterialAssignment[],
  height: number,
  side: Exclude<SurfaceWallSide, 'both'>,
) {
  const fragmentAssignment = wallMaterialAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      (assignment.coverageHeight ?? Number.POSITIVE_INFINITY) >= height - 0.001 &&
      (assignment.target.side === 'both' || assignment.target.side === side),
  )

  return (
    fragmentAssignment ??
    getWallFaceMaterialAssignmentForSide(wallMaterialAssignments, side, height)
  )
}

export function getExternalWallSlabEdgeMaterialAssignment(
  surfaceAssignments: SurfaceMaterialAssignment[],
  wall: Wall,
  side: Exclude<SurfaceWallSide, 'both'>,
) {
  const wallAssignments = getWallSurfaceMaterialAssignments(
    surfaceAssignments,
    wall.id,
  )
  return getWallMaterialAssignmentForSide(wallAssignments, wall.height, side)
}

export function getWallFragmentMaterialAssignmentForSide(
  wallMaterialAssignments: SurfaceMaterialAssignment[],
  fragmentId: string,
  side: Exclude<SurfaceWallSide, 'both'>,
  height: number,
) {
  return wallMaterialAssignments.findLast(
    (assignment) =>
      assignment.target.type === 'wall-surface-fragment' &&
      assignment.target.fragmentId === fragmentId &&
      (assignment.coverageHeight ?? Number.POSITIVE_INFINITY) >= height - 0.001 &&
      (assignment.target.side === 'both' || assignment.target.side === side),
  )
}

export function getWallMaterialAssignmentForSource(
  wallMaterialAssignments: SurfaceMaterialAssignment[],
  source: {
    fragmentId?: string
    side?: WallSide
  },
  height: number,
) {
  if (typeof source.side !== 'number') {
    return undefined
  }

  return (
    (source.fragmentId
      ? getWallFragmentMaterialAssignmentForSide(
          wallMaterialAssignments,
          source.fragmentId,
          source.side,
          height,
        )
      : undefined) ??
    getWallFaceMaterialAssignmentForSide(
      wallMaterialAssignments,
      source.side,
      height,
    )
  )
}

export function applyFragmentMaterialSources(
  faces: WallEngineFace[],
  surfaceAssignments: SurfaceMaterialAssignment[],
  floorId: string,
  elevation: number,
  assembly?: FloorAssembly,
) {
  const currentFaceIds = new Set(faces.map((face) => face.faceId))
  // Roof contact partitioning can split a reveal below its connection to the
  // upper facade. All pieces retain the finish of that connected reveal.
  const revealTops = new Map<string, number>()
  for (const face of faces) {
    if (!face.faceId.includes(':roof-boundary-cap:')) continue
    const key = face.faceId.split(':roof-region:')[0]
    const top = Math.max(...face.vertices.map(v => v.position[1])) + elevation
    revealTops.set(key, Math.max(revealTops.get(key) ?? -Infinity, top))
  }

  return faces.map((face) => {
    const upperSource = findUpperFacadeSourceForRoofCut(surfaceAssignments, face, floorId, elevation, assembly,
      revealTops.get(face.faceId.split(':roof-region:')[0]))
    const ownFinish = upperSource && surfaceAssignments.some(assignment => assignment.target.type === 'wall-surface-fragment' &&
      assignment.target.wallId === face.pickSource.wallId &&
      (assignment.target.fragmentId === face.faceId ||
        ((face.faceId.includes(':roof-boundary-cap:') || assignment.target.fragmentId.includes(':roof-region:')) &&
          face.faceId.startsWith(`${assignment.target.fragmentId}:`))))
    if (upperSource && !ownFinish) return { ...face, materialSource: upperSource }
    const fragmentAssignment = findWallFragmentAssignmentForFace(
      surfaceAssignments,
      face,
      currentFaceIds,
    ) ?? findStoreyBoundaryAssignment(surfaceAssignments, face, faces, currentFaceIds)
    const fragmentId =
      fragmentAssignment?.target.type === 'wall-surface-fragment'
        ? fragmentAssignment.target.fragmentId
        : undefined

    return fragmentId
      ? {
          ...face,
          materialSource: {
            ...face.materialSource,
            fragmentId,
          },
        }
      : face
  })
}

export function wallMaterialAssignmentsMatch(
  firstAssignment: SurfaceMaterialAssignment,
  secondAssignment: SurfaceMaterialAssignment,
) {
  return (
    firstAssignment.materialId === secondAssignment.materialId &&
    (firstAssignment.customColor ?? '') === (secondAssignment.customColor ?? '') &&
    (firstAssignment.textureRotation ?? 0) ===
      (secondAssignment.textureRotation ?? 0) &&
    (firstAssignment.textureScale ?? 1) === (secondAssignment.textureScale ?? 1)
  )
}

export type WallRenderJob = {kind:'render';faces:WallEngineFace[];walls:Wall[];surfaceAssignments:SurfaceMaterialAssignment[];floorId:string;elevation:number;assembly?:FloorAssembly}
export function prepareWallRendering({faces,walls,surfaceAssignments,floorId,elevation,assembly}:WallRenderJob) {
  const renderFaces=applyFragmentMaterialSources(faces,surfaceAssignments,floorId,elevation,assembly)
  const wallsById=new Map(walls.map(wall=>[wall.id,wall])),keys=new Map<string,string>()
  const payload=buildWallBufferGeometryPayload(renderFaces,{floorId,materialBatchKey:source=>{
    const sourceKey=JSON.stringify([source.wallId,source.side,source.role,source.fragmentId])
    const existing=keys.get(sourceKey);if(existing!==undefined)return existing
    const finish=resolveWallEngineFinish({source,surfaceAssignments,wallsById}),key=wallMaterialBatchKey(finish.assignment,finish.fallback)
    keys.set(sourceKey,key);return key
  }})
  return {renderFaces,payload}
}
