import { Box3, BufferAttribute, InstancedMesh, Matrix4, Triangle, Vector3, type Mesh, type Object3D } from 'three'
import { snapshotIndirectGeometry, type IndirectGeometrySnapshot } from './indirectVisibility.ts'

/** Skip complete meshes outside the selected room before copying vertex buffers
 * to the occupancy worker. Crossing surfaces remain conservative occluders. */
export function snapshotFastGIGeometry(source: Object3D, room: Box3, include?: (mesh: Mesh) => boolean) {
  const world = new Box3()
  return snapshotIndirectGeometry(source, mesh => {
    if (include && !include(mesh)) return false
    if (mesh instanceof InstancedMesh || 'isSkinnedMesh' in mesh) return true
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    return !mesh.geometry.boundingBox || world.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld).intersectsBox(room)
  })
}

/** Conservative triangle/box overlap, not mesh bounding boxes: doorways and
 * windows remain open. Runs in a worker; bounded to the active room volume. */
export function voxelizeFastGeometry(parts: IndirectGeometrySnapshot, min: number[], size: number[], n: number) {
  const data = new Uint8Array(n ** 3), origin = new Vector3(...min), extent = new Vector3(...size)
  const cell = extent.clone().divideScalar(n), matrix = new Matrix4(), triangle = new Triangle()
  const volumeBounds = new Box3(origin, origin.clone().add(extent))
  const bounds = new Box3(), box = new Box3(), lower = new Vector3(), upper = new Vector3(), normal = new Vector3()
  let triangles = 0
  for (const part of parts) {
    const attribute = new BufferAttribute(part.position, part.stride, part.normalized)
    for (const transform of part.matrices) {
      matrix.fromArray(transform)
      for (const range of part.ranges) for (let i = range.start; i + 2 < range.start + range.count; i += 3) {
        for (let j = 0; j < 3; j++) {
          const index = part.index?.[i + j] ?? i + j
          ;[triangle.a, triangle.b, triangle.c][j].set(attribute.getComponent(index, part.offset),
            attribute.getComponent(index, part.offset + 1), attribute.getComponent(index, part.offset + 2)).applyMatrix4(matrix)
        }
        bounds.setFromPoints([triangle.a, triangle.b, triangle.c])
        if (!bounds.intersectsBox(volumeBounds)) continue
        triangle.getNormal(normal)
        const xWeight = Math.abs(normal.x), yWeight = Math.abs(normal.y), zWeight = Math.abs(normal.z)
        const axis = xWeight >= yWeight && xWeight >= zWeight ? 1 : yWeight >= zWeight ? 2 : 4
        lower.copy(bounds.min).sub(origin).divide(cell).addScalar(-.001).floor().clampScalar(0, n - 1)
        upper.copy(bounds.max).sub(origin).divide(cell).addScalar(.001).floor().clampScalar(0, n - 1)
        for (let y = lower.y; y <= upper.y; y++) for (let z = lower.z; z <= upper.z; z++) for (let x = lower.x; x <= upper.x; x++) {
          const index = x + z * n + y * n * n
          if (data[index] & axis) continue
          box.min.set(x, y, z).multiply(cell).add(origin).addScaledVector(cell, -.001)
          box.max.copy(box.min).addScaledVector(cell, 1.002)
          // Keep the occupied flag and the axes of the surfaces sharing it.
          // Two orthogonal faces in one cell can be on different room sides.
          if (box.intersectsTriangle(triangle)) data[index] |= axis
        }
        triangles++
      }
    }
  }
  return { data, triangles }
}
