import { Triangle, Vector3 } from 'three'
import type { HitPointInfo, MeshBVH } from 'three-mesh-bvh'

export type LumenDistanceField = { values: Float32Array; buildMs: number }

/** Sample the locally oriented distance to the model's triangles. Open meshes
 * such as reveals have no global interior, so the nearest face supplies the
 * sign. Tracing uses the magnitude and treats both sides as occluders. */
export function buildLumenDistanceField(
  tree: MeshBVH | null, origin: number[], dimensions: number[], spacing: number,
): LumenDistanceField {
  const start = performance.now()
  const [width, height, depth] = dimensions
  const values = new Float32Array(width * height * depth)
  const cutoff = 12 * spacing
  if (!tree) {
    values.fill(cutoff)
    return { values, buildMs: performance.now() - start }
  }
  const point = new Vector3(), normal = new Vector3(), delta = new Vector3(), triangle = new Triangle()
  const nearest: HitPointInfo = { point: new Vector3(), distance: 0, faceIndex: 0 }
  const vertices = tree.geometry.getAttribute('position'), indices = tree.geometry.getIndex()!
  let index = 0
  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++, index++) {
        point.set(origin[0] + (x + .5) * spacing, origin[1] + (y + .5) * spacing, origin[2] + (z + .5) * spacing)
        const hit = tree.closestPointToPoint(point, nearest, 0, cutoff)
        if (!hit || hit.distance >= cutoff) {
          values[index] = cutoff
          continue
        }
        const face = hit.faceIndex * 3
        triangle.a.fromBufferAttribute(vertices, indices.getX(face))
        triangle.b.fromBufferAttribute(vertices, indices.getX(face + 1))
        triangle.c.fromBufferAttribute(vertices, indices.getX(face + 2))
        triangle.getNormal(normal)
        values[index] = delta.subVectors(point, hit.point).dot(normal) < 0 ? -hit.distance : hit.distance
      }
    }
  }
  return { values, buildMs: performance.now() - start }
}
