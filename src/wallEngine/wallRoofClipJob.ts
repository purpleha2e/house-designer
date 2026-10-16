import { clipWallFacesToRoofUndersides, type ClipPlane, type WallRoofClipVolume } from './wallRoofClip.ts'
import type { WallMeshFace } from './wallMesh.ts'
import type { WallRoofSurfaceDivider } from './wallRoofSurfacePartitions.ts'
import { createWallRoofClipOptions } from '../roofWallClipping.ts'
import type { Point } from '../types.ts'
import { pointIsInsideRoomPolygon } from '../roomLightMask.ts'

export type WallRoofClipOptions = {
  floorElevation: number; volumes: WallRoofClipVolume[]; surfaceDividers?: WallRoofSurfaceDivider[]
}
type Plane = [number, number, number, number]
type ClipInput = Parameters<typeof createWallRoofClipOptions>[0]
export type WallRoofClipInput = Omit<ClipInput, 'isInsideRoom'> & { roomPolygons: Point[][] }
export type WallRoofClipInputJob = {
  faces: WallMeshFace[]
  input: Omit<WallRoofClipInput, 'roofs'> & { roofs: (Omit<ClipInput['roofs'][number], 'abutmentPlanes'> & { abutmentPlanes?: Plane[] })[] }
}
export function createWallRoofClipInputJob(faces: WallMeshFace[], input: WallRoofClipInput): WallRoofClipInputJob {
  return { faces, input: { ...input, roofs: input.roofs.map(roof => ({ ...roof,
    abutmentPlanes: roof.abutmentPlanes?.map(plane => {
      const d = plane([0,0,0])
      return [plane([1,0,0])-d,plane([0,1,0])-d,plane([0,0,1])-d,d]
    }),
  })) } }
}
export function runWallRoofClipInputJob(job: WallRoofClipInputJob) {
  const { roomPolygons, ...input } = job.input
  const options = createWallRoofClipOptions({ ...input,
    isInsideRoom: point => roomPolygons.some(polygon => pointIsInsideRoomPolygon(point, polygon)),
    roofs: input.roofs.map(roof => ({ ...roof,
      abutmentPlanes: roof.abutmentPlanes?.map(([a,b,c,d]): ClipPlane => ([x,y,z]) => a*x+b*y+c*z+d),
    })),
  })
  return clipWallFacesToRoofUndersides(job.faces, options)
}
export type WallRoofClipJob = {
  faces: WallMeshFace[]
  floorElevation: number
  surfaceDividers?: WallRoofSurfaceDivider[]
  planes: Plane[]
  volumes: {
    planes: number[]; surfacePlane?: number; protectedFootprints: number[][]
    boundaryProtections: { boundary: number; planes: number[] }[]
    excludedWallIds: string[]; clipSides: boolean; clipHeightWallIds?: string[]
    onlySelectedWalls?: boolean
    onlyTopFaces?: boolean
    skipWallIds?: string[]
  }[]
}

// All clipping boundaries are affine planes. Encode their coefficients once,
// preserving shared plane identities (especially each volume's surface plane).
export function createWallRoofClipJob(faces: WallMeshFace[], options: WallRoofClipOptions): WallRoofClipJob {
  const planes: Plane[] = [], indices = new Map<ClipPlane, number>()
  const encode = (plane: ClipPlane) => {
    const existing = indices.get(plane)
    if (existing !== undefined) return existing
    const d = plane([0, 0, 0]), index = planes.length
    planes.push([plane([1, 0, 0]) - d, plane([0, 1, 0]) - d, plane([0, 0, 1]) - d, d])
    indices.set(plane, index)
    return index
  }
  const volumes = options.volumes.map(v => ({
    planes: v.planes.map(encode), surfacePlane: v.surfacePlane ? encode(v.surfacePlane) : undefined,
    protectedFootprints: v.protectedFootprints.map(p => p.map(encode)),
    boundaryProtections: (v.boundaryProtections ?? []).map(p => ({ boundary: encode(p.boundary), planes: p.planes.map(encode) })),
    excludedWallIds: [...v.excludedWallIds], clipSides: v.clipSides,
    clipHeightWallIds: [...(v.clipHeightWallIds ?? [])],
    onlySelectedWalls: v.onlySelectedWalls,
    onlyTopFaces: v.onlyTopFaces,
    skipWallIds: [...(v.skipWallIds ?? [])],
  }))
  return { faces, floorElevation: options.floorElevation, planes, volumes, surfaceDividers: options.surfaceDividers }
}

export function runWallRoofClipJob(job: WallRoofClipJob) {
  const planes = job.planes.map(([a, b, c, d]): ClipPlane => ([x, y, z]) => a * x + b * y + c * z + d)
  return clipWallFacesToRoofUndersides(job.faces, { floorElevation: job.floorElevation,
    surfaceDividers: job.surfaceDividers,
    volumes: job.volumes.map(v => ({
      ...v, planes: v.planes.map(i => planes[i]), surfacePlane: v.surfacePlane === undefined ? undefined : planes[v.surfacePlane],
      protectedFootprints: v.protectedFootprints.map(p => p.map(i => planes[i])),
      boundaryProtections: v.boundaryProtections.map(p => ({ boundary: planes[p.boundary], planes: p.planes.map(i => planes[i]) })),
      excludedWallIds: new Set(v.excludedWallIds),
      clipHeightWallIds: new Set(v.clipHeightWallIds ?? []),
      skipWallIds: new Set(v.skipWallIds ?? []),
    })),
  })
}
