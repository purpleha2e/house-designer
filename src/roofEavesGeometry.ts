import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import type { RoofStructure } from './types.ts'
import { getPitchedRoofHeightAtX, type RoofBounds, type RoofProfileVertex } from './roofProfile.ts'
import { roofFaceHeight } from './roofJunctions.ts'

const FASCIA_HEIGHT = 0.16
const REAR_FACE_REVEAL = 0.01

// Use the visible roof polygons so intersections trim the eaves as well as the tiles.
export function createUpAndOverEavesGeometry(
  roof: RoofStructure,
  support: RoofBounds,
  extents: RoofBounds,
  roofFaces: RoofProfileVertex[][],
  tileThickness: number,
) {
  const positions: number[] = []
  const uvs: number[] = []
  const triangle = (a: RoofProfileVertex, b: RoofProfileVertex, c: RoofProfileVertex) => {
    for (const vertex of [a, b, c]) {
      positions.push(...vertex)
      uvs.push(vertex[0], vertex[2])
    }
  }

  for (const side of [-1, 1] as const) {
    const wallX = side === -1 ? support.minX : support.maxX
    const edgeX = side === -1 ? extents.minX : extents.maxX
    const rearX = wallX + side * REAR_FACE_REVEAL
    const revealRear = (vertex: RoofProfileVertex): RoofProfileVertex => [
      Math.abs(vertex[0] - wallX) < 0.000001 ? rearX : vertex[0],
      vertex[1],
      vertex[2],
    ]
    if (Math.abs(edgeX - wallX) < 0.000001) continue

    const bottom = getPitchedRoofHeightAtX(roof, support, edgeX) - tileThickness - FASCIA_HEIGHT
    const faces = roofFaces.filter((face) =>
      face.every(([x]) => side * (x - wallX) >= -0.000001) &&
      face.some(([x]) => side * (x - wallX) > 0.000001),
    )
    const edges = new Map<string, { a: RoofProfileVertex; b: RoofProfileVertex; bottomA: number; bottomB: number; count: number }>()
    for (const face of faces) {
      const height = roofFaceHeight(face)
      if (!height) continue
      // A chamfer can lower the eave along the ridge direction. Its box must
      // follow that panel instead of rising back to the unchamfered eave.
      const bottomAt = (x: number, z: number) => Math.min(bottom,
        height({ x: side * (x - edgeX) > 0 ? x : edgeX, y: z }) - tileThickness - FASCIA_HEIGHT)
      const outline = face.map(([x, , z]) => new Vector2(x, z))
      for (const indices of ShapeUtils.triangulateShape(outline, [])) {
        const vertices = indices.map((i) => {
          const vertex = revealRear(face[i])
          return [vertex[0], bottomAt(vertex[0], vertex[2]), vertex[2]] as RoofProfileVertex
        })
        triangle(vertices[0], vertices[1], vertices[2])
      }
      face.forEach((a, i) => {
        const b = face[(i + 1) % face.length]
        const key = [a, b].map((v) => `${v[0].toFixed(6)}:${v[2].toFixed(6)}`).sort().join('|')
        edges.set(key, { a, b, bottomA: bottomAt(a[0], a[2]), bottomB: bottomAt(b[0], b[2]), count: (edges.get(key)?.count ?? 0) + 1 })
      })
    }
    for (const { a, b, bottomA: baseA, bottomB: baseB, count } of edges.values()) {
      // Include the rear using its actual panel edge, so pitch/chamfer breaks
      // remain continuous across both skins of the soffit box.
      if (count !== 1) continue
      const revealedA = revealRear(a)
      const revealedB = revealRear(b)
      const topA: RoofProfileVertex = [revealedA[0], a[1] - tileThickness, a[2]]
      const topB: RoofProfileVertex = [revealedB[0], b[1] - tileThickness, b[2]]
      const bottomA: RoofProfileVertex = [revealedA[0], baseA, a[2]]
      const bottomB: RoofProfileVertex = [revealedB[0], baseB, b[2]]
      triangle(topA, bottomB, bottomA)
      triangle(topA, topB, bottomB)
    }

  }

  if (positions.length === 0) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
