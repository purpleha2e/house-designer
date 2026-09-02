import type { WallSurfaceFragmentReference } from '../types.ts'
import type { WallMeshFace } from './wallMesh.ts'

const NORMAL_TOLERANCE = 0.0001
const PLANE_TOLERANCE_METERS = 0.002
const CONTACT_TOLERANCE_METERS = 0.002

type SurfaceFace = {
  face: WallMeshFace
  maxHeight: number
  maxTangent: number
  minHeight: number
  minTangent: number
  normalX: number
  normalZ: number
  planeOffset: number
}

function getSurfaceFace(face: WallMeshFace): SurfaceFace | null {
  if (face.kind !== 'side' || typeof face.pickSource.side !== 'number') {
    return null
  }

  const normalLength = Math.hypot(face.normal[0], face.normal[2])

  if (normalLength <= NORMAL_TOLERANCE) {
    return null
  }

  const normalX = face.normal[0] / normalLength
  const normalZ = face.normal[2] / normalLength
  const tangentX = -normalZ
  const tangentZ = normalX
  const tangentValues = face.vertices.map(
    (vertex) => vertex.position[0] * tangentX + vertex.position[2] * tangentZ,
  )
  const heightValues = face.vertices.map((vertex) => vertex.position[1])
  const firstPosition = face.vertices[0].position

  return {
    face,
    maxHeight: Math.max(...heightValues),
    maxTangent: Math.max(...tangentValues),
    minHeight: Math.min(...heightValues),
    minTangent: Math.min(...tangentValues),
    normalX,
    normalZ,
    planeOffset: firstPosition[0] * normalX + firstPosition[2] * normalZ,
  }
}

function facesAreConnected(first: SurfaceFace, second: SurfaceFace) {
  const normalDot =
    first.normalX * second.normalX + first.normalZ * second.normalZ

  if (
    normalDot < 1 - NORMAL_TOLERANCE ||
    Math.abs(first.planeOffset - second.planeOffset) > PLANE_TOLERANCE_METERS
  ) {
    return false
  }

  const tangentOverlap =
    Math.min(first.maxTangent, second.maxTangent) -
    Math.max(first.minTangent, second.minTangent)
  const heightOverlap =
    Math.min(first.maxHeight, second.maxHeight) -
    Math.max(first.minHeight, second.minHeight)

  return (
    tangentOverlap >= -CONTACT_TOLERANCE_METERS &&
    heightOverlap >= -CONTACT_TOLERANCE_METERS &&
    (tangentOverlap > CONTACT_TOLERANCE_METERS ||
      heightOverlap > CONTACT_TOLERANCE_METERS)
  )
}

function getFragmentReference(face: WallMeshFace): WallSurfaceFragmentReference {
  return {
    fragmentId: face.faceId,
    side: face.pickSource.side as -1 | 1,
    wallId: face.pickSource.wallId,
  }
}

function compareReferences(
  first: WallSurfaceFragmentReference,
  second: WallSurfaceFragmentReference,
) {
  return (
    first.wallId.localeCompare(second.wallId) ||
    first.side - second.side ||
    first.fragmentId.localeCompare(second.fragmentId)
  )
}

export function buildCoplanarWallSurfaceGroups(faces: WallMeshFace[]) {
  const surfaceFaces = faces
    .map(getSurfaceFace)
    .filter((face): face is SurfaceFace => Boolean(face))
  const groupsByFaceId = new Map<string, WallSurfaceFragmentReference[]>()
  const visited = new Set<number>()

  surfaceFaces.forEach((_, startIndex) => {
    if (visited.has(startIndex)) {
      return
    }

    const componentIndices: number[] = []
    const pendingIndices = [startIndex]
    visited.add(startIndex)

    while (pendingIndices.length > 0) {
      const currentIndex = pendingIndices.pop()!
      const currentFace = surfaceFaces[currentIndex]
      componentIndices.push(currentIndex)

      surfaceFaces.forEach((candidateFace, candidateIndex) => {
        if (
          visited.has(candidateIndex) ||
          !facesAreConnected(currentFace, candidateFace)
        ) {
          return
        }

        visited.add(candidateIndex)
        pendingIndices.push(candidateIndex)
      })
    }

    const references = componentIndices
      .map((index) => getFragmentReference(surfaceFaces[index].face))
      .sort(compareReferences)

    componentIndices.forEach((index) => {
      groupsByFaceId.set(surfaceFaces[index].face.faceId, references)
    })
  })

  return groupsByFaceId
}
