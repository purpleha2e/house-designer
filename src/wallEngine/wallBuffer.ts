import type { SelectableSurface } from '../types.ts'
import type { WallMeshFace, WallMeshSource } from './wallMesh.ts'

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
}

export type WallBufferGeometryPayload = {
  groups: WallBufferGroup[]
  materialSlots: WallBufferMaterialSlot[]
  normals: number[]
  pickTargets: Map<number, SelectableSurface>
  positions: number[]
  uvs: number[]
}

const QUAD_TRIANGLE_INDICES = [0, 1, 2, 0, 2, 3] as const
const REVERSED_QUAD_TRIANGLE_INDICES = [0, 2, 1, 0, 3, 2] as const

function sourceKey(source: WallMeshSource) {
  return `${source.wallId}:${source.side ?? 'body'}`
}

function getOrCreateMaterialIndex(
  materialSlots: WallBufferMaterialSlot[],
  source: WallMeshSource,
) {
  const key = sourceKey(source)
  const existingSlot = materialSlots.find(
    (slot) => sourceKey(slot.source) === key,
  )

  if (existingSlot) {
    return existingSlot.index
  }

  const slot = {
    index: materialSlots.length,
    source,
  }

  materialSlots.push(slot)
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
  normals,
  positions,
  uvs,
}: {
  face: WallMeshFace
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
  { floorId }: WallBufferBuildOptions,
): WallBufferGeometryPayload {
  const groups: WallBufferGroup[] = []
  const materialSlots: WallBufferMaterialSlot[] = []
  const normals: number[] = []
  const pickTargets = new Map<number, SelectableSurface>()
  const positions: number[] = []
  const uvs: number[] = []
  const faceEntries = faces.map((face, order) => ({
    face,
    materialIndex: getOrCreateMaterialIndex(materialSlots, face.materialSource),
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
        normals,
        positions,
        uvs,
      })
      const pickTarget = pickTargetFromSource(face.pickSource, floorId)
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

      if (pickTarget && !pickTargets.has(materialIndex)) {
        pickTargets.set(materialIndex, pickTarget)
      }
    })

  return {
    groups,
    materialSlots,
    normals,
    pickTargets,
    positions,
    uvs,
  }
}
