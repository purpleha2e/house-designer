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
  if (first.face.roofSurfaceRegion !== second.face.roofSurfaceRegion) return false
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
      .filter((reference, index, all) => all.findIndex(other =>
        other.fragmentId === reference.fragmentId && other.wallId === reference.wallId && other.side === reference.side) === index)
      .sort(compareReferences)

    componentIndices.forEach((index) => {
      groupsByFaceId.set(surfaceFaces[index].face.faceId, references)
    })
  })

  const reveals = faces.filter(face => face.kind === 'cap' && /:opening(?:-boundary)?:/.test(face.faceId))
  const extendedGroups = new Map<WallSurfaceFragmentReference[], WallSurfaceFragmentReference[]>()
  for (const [id, group] of groupsByFaceId) {
    let extended = extendedGroups.get(group)
    if (!extended) {
      const members = surfaceFaces.filter(f => group.some(ref => ref.fragmentId === f.face.faceId))
      const attached = reveals.filter(reveal => members.some(member => {
        if (reveal.pickSource.wallId !== member.face.pickSource.wallId || reveal.pickSource.side !== member.face.pickSource.side) return false
        const edge = reveal.vertices.filter(v => Math.abs(v.position[0] * member.normalX +
          v.position[2] * member.normalZ - member.planeOffset) < PLANE_TOLERANCE_METERS)
        if (edge.length < 2) return false
        const tangents = edge.map(v => -member.normalZ * v.position[0] + member.normalX * v.position[2])
        const heights = edge.map(v => v.position[1])
        const t = Math.min(member.maxTangent, Math.max(...tangents)) - Math.max(member.minTangent, Math.min(...tangents))
        const y = Math.min(member.maxHeight, Math.max(...heights)) - Math.max(member.minHeight, Math.min(...heights))
        return t >= -CONTACT_TOLERANCE_METERS && y >= -CONTACT_TOLERANCE_METERS &&
          (t > CONTACT_TOLERANCE_METERS || y > CONTACT_TOLERANCE_METERS)
      })).map(getFragmentReference)
      extended = [...group, ...attached].filter((ref, i, all) => all.findIndex(other =>
        other.fragmentId === ref.fragmentId && other.wallId === ref.wallId && other.side === ref.side) === i).sort(compareReferences)
      extendedGroups.set(group, extended)
    }
    groupsByFaceId.set(id, extended)
  }
  return groupsByFaceId
}
