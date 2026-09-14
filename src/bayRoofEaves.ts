import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three'
import type { RoofStructure } from './types.ts'
import { getBaySupportPolygon } from './bayRoof.ts'
import type { RoofProfileVertex as Vertex } from './roofProfile.ts'

export function createBayRoofEavesGeometry(roof: RoofStructure, faces: Vertex[][], thickness: number) {
  const support = getBaySupportPolygon(roof)
  const isOutside = ([x, , z]: Vertex) => support.some((a, i) => {
    const b = support[(i + 1) % support.length]
    return (b.x - a.x) * (z - a.y) - (b.y - a.y) * (x - a.x) < -1e-7
  })
  const overhangs = faces.filter((face) => face.some(isOutside) && face.every(([, y]) => y <= 1e-7))
  if (!overhangs.length) return null
  const bottom = Math.min(...overhangs.flat().map((p) => p[1])) - thickness - 0.16
  const positions: number[] = [], uvs: number[] = []
  const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
    for (const p of [a, b, c]) { positions.push(...p); uvs.push(p[0], p[2]) }
  }
  const edges = new Map<string, { a: Vertex; b: Vertex; count: number }>()
  for (const face of overhangs) {
    for (const ids of ShapeUtils.triangulateShape(face.map(([x, , z]) => new Vector2(x, z)), [])) {
      const vertices = ids.map((i): Vertex => [face[i][0], bottom, face[i][2]])
      triangle(vertices[0], vertices[1], vertices[2])
    }
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length]
      const key = [a, b].map((p) => `${p[0].toFixed(6)}:${p[2].toFixed(6)}`).sort().join('|')
      edges.set(key, { a, b, count: (edges.get(key)?.count ?? 0) + 1 })
    })
  }
  for (const { a, b, count } of edges.values()) {
    if (count !== 1) continue
    const topA: Vertex = [a[0], a[1] - thickness, a[2]], topB: Vertex = [b[0], b[1] - thickness, b[2]]
    const bottomA: Vertex = [a[0], bottom, a[2]], bottomB: Vertex = [b[0], bottom, b[2]]
    triangle(topA, topB, bottomB); triangle(topA, bottomB, bottomA)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  return geometry
}
