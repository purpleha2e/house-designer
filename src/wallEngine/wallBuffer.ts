import type { SelectableSurface } from '../types.ts'
import type { WallMeshFace, WallMeshSource } from './wallMesh.ts'
import { wallLightingCornerPlanes } from './wallLightingCorners.ts'

export type WallBufferGroup = {
  count: number
  faceIds: string[]
  materialIndex: number
  start: number
}

export type WallBufferMaterialSlot = {
  index: number
  source: WallMeshSource
}

export type WallBufferBuildOptions = {
  floorId: string
  groupBy?: 'face' | 'material' | 'pick'
  /** Render-only batching; use a separate face/pick payload for selection. */
  materialBatchKey?: (source: WallMeshSource) => string
}

export type WallBufferGeometryPayload = {
  groups: WallBufferGroup[]
  materialSlots: WallBufferMaterialSlot[]
  normals: number[]
  pickTargets: Map<number, SelectableSurface>
  lightingReceiverOffsets: number[]
  lightingCornerPlanes: [number[], number[]]
  positions: number[]
  uvs: number[]
}

const QUAD_TRIANGLE_INDICES = [0, 1, 2, 0, 2, 3] as const
const REVERSED_QUAD_TRIANGLE_INDICES = [0, 2, 1, 0, 3, 2] as const

function sourceKey(source: WallMeshSource) {
  return `${source.wallId}:${source.side ?? 'body'}:${source.role ?? 'surface'}:${source.fragmentId ?? 'whole'}`
}

function getOrCreateMaterialIndex(
  materialSlots: WallBufferMaterialSlot[],
  indicesBySource: Map<string, number>,
  source: WallMeshSource,
  key = sourceKey(source),
) {
  const existingIndex = indicesBySource.get(key)
  if (existingIndex !== undefined) return existingIndex

  const slot = {
    index: materialSlots.length,
    source,
  }

  materialSlots.push(slot)
  const storedKey = sourceKey(source)
  if (!indicesBySource.has(storedKey)) indicesBySource.set(storedKey, slot.index)
  return slot.index
}

function pickTargetFromSource(
  source: WallMeshSource,
  floorId: string,
): SelectableSurface | null {
  if (typeof source.side !== 'number') {
    return null
  }

  return {
    floorId,
    side: source.side,
    type: 'wall-face',
    wallId: source.wallId,
  }
}

function pickTargetFromFace(
  face: WallMeshFace,
  floorId: string,
  groupBy: NonNullable<WallBufferBuildOptions['groupBy']>,
): SelectableSurface | null {
  if (typeof face.pickSource.side !== 'number') {
    return null
  }

  if (groupBy !== 'face') {
    return pickTargetFromSource(face.pickSource, floorId)
  }

  return {
    floorId,
    fragmentId: face.faceId,
    side: face.pickSource.side,
    type: 'wall-surface-fragment',
    wallId: face.pickSource.wallId,
  }
}

function triangleWindingMatchesFaceNormal(face: WallMeshFace) {
  const [first, second, third] = face.vertices.map((vertex) => vertex.position)
  const firstEdge = [
    second[0] - first[0],
    second[1] - first[1],
    second[2] - first[2],
  ]
  const secondEdge = [
    third[0] - first[0],
    third[1] - first[1],
    third[2] - first[2],
  ]
  const triangleNormal = [
    firstEdge[1] * secondEdge[2] - firstEdge[2] * secondEdge[1],
    firstEdge[2] * secondEdge[0] - firstEdge[0] * secondEdge[2],
    firstEdge[0] * secondEdge[1] - firstEdge[1] * secondEdge[0],
  ]
  const normalDot =
    triangleNormal[0] * face.normal[0] +
    triangleNormal[1] * face.normal[1] +
    triangleNormal[2] * face.normal[2]

  return normalDot >= 0
}

function pushFaceBuffers({
  face,
  lightingReceiverOffsets,
  lightingCornerPlanes,
  cornerPlanes,
  normals,
  positions,
  uvs,
}: {
  face: WallMeshFace
  lightingReceiverOffsets: number[]
  lightingCornerPlanes: [number[], number[]]
  cornerPlanes: [number, number, number][]
  normals: number[]
  positions: number[]
  uvs: number[]
}) {
  const start = positions.length / 3
  const triangleIndices = triangleWindingMatchesFaceNormal(face)
    ? QUAD_TRIANGLE_INDICES
    : REVERSED_QUAD_TRIANGLE_INDICES

  triangleIndices.forEach((vertexIndex) => {
    const vertex = face.vertices[vertexIndex]
    const plane = face.lightingReceiverPlane
    const distance = plane ? plane[2] - plane[0] * vertex.position[0] - plane[1] * vertex.position[2] : 0
    lightingReceiverOffsets.push(plane ? plane[0] * distance : 0, 0, plane ? plane[1] * distance : 0)
    for (let i = 0; i < 2; i++) lightingCornerPlanes[i].push(...(cornerPlanes[i] ?? [0, 0, 0]))

    positions.push(...vertex.position)
    normals.push(...face.normal)
    uvs.push(...vertex.uv)
  })

  return {
    count: QUAD_TRIANGLE_INDICES.length,
    start,
  }
}

export function buildWallBufferGeometryPayload(
  faces: WallMeshFace[],
  { floorId, groupBy = 'material', materialBatchKey }: WallBufferBuildOptions,
): WallBufferGeometryPayload {
  const groups: WallBufferGroup[] = []
  const materialSlots: WallBufferMaterialSlot[] = []
  const normals: number[] = []
  const lightingReceiverOffsets: number[] = []
  const lightingCornerPlanes: [number[], number[]] = [[], []]
  const corners = wallLightingCornerPlanes(faces)
  const pickTargets = new Map<number, SelectableSurface>()
  const positions: number[] = []
  const uvs: number[] = []
  const batchIndices = new Map<string, number>()
  const indicesBySource = new Map<string, number>()
  const batching = groupBy === 'material' && materialBatchKey
  const materialIndexForFace = (face: WallMeshFace) => {
    if (batching) {
      const key = batching(face.materialSource)
      const existing = batchIndices.get(key)
      if (existing !== undefined) return existing
      const index = materialSlots.length
      batchIndices.set(key, index)
      materialSlots.push({ index, source: face.materialSource })
      return index
    }
    return getOrCreateMaterialIndex(materialSlots, indicesBySource,
      groupBy === 'pick' ? face.pickSource : face.materialSource,
      groupBy === 'face' ? face.faceId : undefined)
  }
  const faceEntries = faces.map((face, order) => ({
    face,
    materialIndex: materialIndexForFace(face),
    order,
  }))

  faceEntries
    .sort(
      (first, second) =>
        first.materialIndex - second.materialIndex || first.order - second.order,
    )
    .forEach(({ face, materialIndex }) => {
      const group = pushFaceBuffers({
        face,
        lightingReceiverOffsets,
        lightingCornerPlanes,
        cornerPlanes: corners.get(face) ?? [],
        normals,
        positions,
        uvs,
      })
      const pickTarget = pickTargetFromFace(face, floorId, groupBy)
      const previousGroup = groups[groups.length - 1]

      if (
        previousGroup &&
        previousGroup.materialIndex === materialIndex &&
        previousGroup.start + previousGroup.count === group.start
      ) {
        previousGroup.count += group.count
        previousGroup.faceIds.push(face.faceId)
      } else {
        groups.push({
          ...group,
          faceIds: [face.faceId],
          materialIndex,
        })
      }

      if (!batching && pickTarget && !pickTargets.has(materialIndex)) {
        pickTargets.set(materialIndex, pickTarget)
      }
    })

  return {
    groups,
    lightingReceiverOffsets,
    lightingCornerPlanes,
    materialSlots,
    normals,
    pickTargets,
    positions,
    uvs,
  }
}
