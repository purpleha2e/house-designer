import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import type { RoofStructure } from './types.ts'
import { getPitchedRoofHeightAtX, type RoofBounds, type RoofProfileVertex } from './roofProfile.ts'

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
    const edges = new Map<string, { a: RoofProfileVertex; b: RoofProfileVertex; count: number }>()
    const rearIntervals: Array<{ maxZ: number; minZ: number }> = []
    for (const face of faces) {
      const outline = face.map(([x, , z]) => new Vector2(x, z))
      for (const indices of ShapeUtils.triangulateShape(outline, [])) {
        const vertices = indices.map((i) => {
          const vertex = revealRear(face[i])
          return [vertex[0], bottom, vertex[2]] as RoofProfileVertex
        })
        triangle(vertices[0], vertices[1], vertices[2])
      }
      face.forEach((a, i) => {
        const b = face[(i + 1) % face.length]
        const key = [a, b].map((v) => `${v[0].toFixed(6)}:${v[2].toFixed(6)}`).sort().join('|')
        edges.set(key, { a, b, count: (edges.get(key)?.count ?? 0) + 1 })
      })
      const rearVertices = face.filter(([x]) => Math.abs(x - wallX) < 0.000001)

      if (rearVertices.length >= 2) {
        rearIntervals.push({
          maxZ: Math.max(...rearVertices.map((vertex) => vertex[2])),
          minZ: Math.min(...rearVertices.map((vertex) => vertex[2])),
        })
      }
    }
    for (const { a, b, count } of edges.values()) {
      const isRear =
        Math.abs(a[0] - wallX) < 0.000001 &&
        Math.abs(b[0] - wallX) < 0.000001

      // The rear is built explicitly below. Other exposed boundaries close the
      // fascia and both ends of the soffit box.
      if (count !== 1 || isRear) continue
      const revealedA = revealRear(a)
      const revealedB = revealRear(b)
      const topA: RoofProfileVertex = [revealedA[0], a[1] - tileThickness, a[2]]
      const topB: RoofProfileVertex = [revealedB[0], b[1] - tileThickness, b[2]]
      const bottomA: RoofProfileVertex = [revealedA[0], bottom, a[2]]
      const bottomB: RoofProfileVertex = [revealedB[0], bottom, b[2]]
      triangle(topA, bottomB, bottomA)
      triangle(topA, topB, bottomB)
    }

    const mergedRearIntervals = rearIntervals
      .sort((first, second) => first.minZ - second.minZ)
      .reduce<Array<{ maxZ: number; minZ: number }>>((merged, interval) => {
        const previous = merged.at(-1)

        if (previous && interval.minZ <= previous.maxZ + 0.000001) {
          previous.maxZ = Math.max(previous.maxZ, interval.maxZ)
        } else {
          merged.push({ ...interval })
        }

        return merged
      }, [])
    const rearTop = getPitchedRoofHeightAtX(roof, support, wallX) - tileThickness

    mergedRearIntervals.forEach(({ maxZ, minZ }) => {
      const topMin: RoofProfileVertex = [rearX, rearTop, minZ]
      const topMax: RoofProfileVertex = [rearX, rearTop, maxZ]
      const bottomMin: RoofProfileVertex = [rearX, bottom, minZ]
      const bottomMax: RoofProfileVertex = [rearX, bottom, maxZ]

      if (side === -1) {
        triangle(topMin, bottomMax, bottomMin)
        triangle(topMin, topMax, bottomMax)
      } else {
        triangle(topMin, bottomMin, bottomMax)
        triangle(topMin, bottomMax, topMax)
      }
    })
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
