import { BufferAttribute, Matrix4, Vector3 } from 'three'
import type { IndirectGeometrySnapshot } from '../src/indirectVisibility.ts'

/** Test-only exact multiset comparison of the Float32 world triangles consumed
 * by the existing whole-scene BVH. Triangle ordering and winding are ignored. */
export function profileIndirectGeometryChanges(before: IndirectGeometrySnapshot, after: IndirectGeometrySnapshot) {
  const summarize = (parts: IndirectGeometrySnapshot) => {
    const triangles = new Map<string, number>(), objects = new Map<string, number>()
    const point = new Vector3(), matrix = new Matrix4(), values = new Float32Array(9), bits = new Uint32Array(values.buffer)
    let count = 0, instances = 0
    for (const part of parts) {
      const attribute = new BufferAttribute(part.position, part.stride, part.normalized)
      for (const transform of part.matrices) {
        instances++; matrix.fromArray(transform)
        const object: string[] = []
        for (const range of part.ranges) for (let triangle = range.start; triangle + 2 < range.start + range.count; triangle += 3) {
          for (let corner = 0; corner < 3; corner++) {
            const index = part.index?.[triangle + corner] ?? triangle + corner
            point.set(attribute.getComponent(index, part.offset), attribute.getComponent(index, part.offset + 1), attribute.getComponent(index, part.offset + 2))
              .applyMatrix4(matrix).toArray(values, corner * 3)
          }
          const vertices = [0, 1, 2].map(corner => Array.from(bits.subarray(corner * 3, corner * 3 + 3), value => value.toString(16).padStart(8, '0')).join(''))
          const key = vertices.sort().join('/')
          triangles.set(key, (triangles.get(key) ?? 0) + 1); object.push(key); count++
        }
        const key = object.sort().join('|')
        objects.set(key, (objects.get(key) ?? 0) + 1)
      }
    }
    return { triangles, objects, counts: { meshes: parts.length, instances, triangles: count,
      sourcePositionBytes: parts.reduce((sum, part) => sum + part.position.byteLength, 0), worldPositionBytes: count * 9 * 4 } }
  }
  const started = performance.now(), a = summarize(before), b = summarize(after)
  const common = (x: Map<string, number>, y: Map<string, number>) => [...x].reduce((sum, [key, count]) => sum + Math.min(count, y.get(key) ?? 0), 0)
  const unchangedTriangles = common(a.triangles, b.triangles), unchangedObjects = common(a.objects, b.objects)
  return { before: a.counts, after: b.counts, unchangedObjects,
    changedOrRemovedObjects: a.counts.instances - unchangedObjects, changedOrAddedObjects: b.counts.instances - unchangedObjects,
    unchangedTriangles, removedOrChangedTriangles: a.counts.triangles - unchangedTriangles, addedOrChangedTriangles: b.counts.triangles - unchangedTriangles,
    unchangedTriangleFraction: unchangedTriangles / Math.max(1, b.counts.triangles), comparisonMs: performance.now() - started,
    method: 'exact canonical Float32 world-triangle multisets; full objects must match every triangle; profiling work is outside the edit timing' }
}
