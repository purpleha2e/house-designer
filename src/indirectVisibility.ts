import { Box3, BufferAttribute, BufferGeometry, DataTexture, DoubleSide, FloatType, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, NearestFilter, Ray, RGBAFormat, Vector3, type Object3D, type TypedArray } from 'three'
import { getBVHExtremes, MeshBVH, SAH, type SerializedBVH } from 'three-mesh-bvh'
import type { IndirectField } from './indirectLighting.ts'
import { createIndirectSegmentQuery } from './indirectSegmentQuery.ts'
import { isSelectionDecoration } from './shaderWarmup.ts'
import { isLightingGlazing } from './lightingVisibility.ts'
import { isBatchedModelSource } from './importedModelBatching.ts'
import { hasViewportSurfaceVisibility } from './viewportSurfaceVisibility.ts'

export type IndirectGeometrySnapshot = {
  position: TypedArray; stride: number; offset: number; normalized: boolean; index: Uint32Array | Uint16Array | null
  ranges: { start: number; count: number }[]; matrices: number[][]; structural: boolean
}[]

/** Shared by cache identity and worker snapshots. Changing a finish to glass
 * changes visibility; changing the order of opaque material groups does not.
 * Registered navigation hiding never removes a physical floor/ceiling. */
export function indirectGeometryRanges(object: Mesh) {
  const geometry = object.geometry, materials = Array.isArray(object.material) ? object.material : [object.material]
  const count = geometry.index?.count ?? geometry.attributes.position?.count ?? 0
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }]
  return groups.filter(group => {
    const material = materials[Array.isArray(object.material) ? group.materialIndex ?? 0 : 0]
    return material instanceof MeshStandardMaterial && (material.visible || hasViewportSurfaceVisibility(material)) && !isLightingGlazing(material) && (material.opacity > 0 || material.transparent)
  }).map(group => ({ start: group.start, count: Math.min(group.count, count - group.start) }))
}

/** Copy only descriptors on the UI thread. postMessage clones the source buffers;
 * world transforms, triangle expansion and BVH construction happen in the worker. */
export function snapshotIndirectGeometry(scene: Object3D, include?: (mesh: Mesh) => boolean): IndirectGeometrySnapshot {
  const steps = snapshotIndirectGeometrySteps(scene, include)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/** Descriptor collection can yield between meshes; triangle expansion and BVH
 * construction remain in the worker. The caller fences the scene revision. */
export function* snapshotIndirectGeometrySteps(scene: Object3D, include?: (mesh: Mesh) => boolean): Generator<void, IndirectGeometrySnapshot> {
  const parts: IndirectGeometrySnapshot = []
  scene.updateMatrixWorld(true)
  const objects: Object3D[] = []
  scene.traverse(object => objects.push(object))
  for (const object of objects) {
    yield
    if (!(object instanceof Mesh) || (include && !include(object)) || isSelectionDecoration(object) ||
      /model-batch|ground-image/.test(String(object.userData.houseDesignerRole))) continue
    // Render batching hides the editable source meshes and draws instances
    // instead. Snapshot each source once, including those hidden only by the
    // batching manager; genuinely hidden models/ancestors still stay excluded.
    let attached = false, visible = true
    for (let parent: Object3D | null = object; parent; parent = parent.parent) {
      if (!parent.visible && !isBatchedModelSource(parent) && !hasViewportSurfaceVisibility(parent)) visible = false
      if (parent === scene) attached = true
    }
    if (!attached || !visible) continue
    const geometry = object.geometry
    const attribute = geometry.attributes.position
    if (!attribute) continue
    const interleaved = !(attribute instanceof BufferAttribute)
    const position = interleaved ? attribute.data.array : attribute.array
    const stride = interleaved ? attribute.data.stride : attribute.itemSize
    const attributeOffset = interleaved ? attribute.offset : 0
    const ranges = indirectGeometryRanges(object)
    if (!ranges.length) continue
    const matrices: number[][] = []
    for (let instance = 0; instance < (object instanceof InstancedMesh ? object.count : 1); instance++) {
      const matrix = object.matrixWorld.clone()
      if (object instanceof InstancedMesh) { const local = new Matrix4(); object.getMatrixAt(instance, local); matrix.multiply(local) }
      matrices.push(matrix.toArray())
    }
    parts.push({ position, stride, offset: attributeOffset, normalized: attribute.normalized,
      index: geometry.index ? geometry.index.array as Uint32Array | Uint16Array : null, ranges, matrices,
      structural: /roof|ceiling|slab/.test(String(object.userData.houseDesignerRole)) })
  }
  return parts
}

export function createIndirectVisibility(scene: Object3D, include?: (mesh: Mesh) => boolean) {
  return createIndirectVisibilityFromSnapshot(snapshotIndirectGeometry(scene, include))
}

export type IndirectVisibilitySnapshot = { positions: Float32Array; tree: SerializedBVH | null }

export function createIndirectVisibilityFromSnapshot(parts: IndirectGeometrySnapshot, previous?: IndirectVisibilitySnapshot) {
  const count = parts.reduce((sum, part) => sum + part.ranges.reduce((n, range) => n + Math.floor(range.count / 3) * 9, 0) * part.matrices.length, 0)
  // A local cutout can add/remove a few triangles without changing the rest of
  // a million-triangle house. Keep a small bounded reserve so an exact refit
  // remains possible; reserved triangles have zero area and cannot occlude.
  const triangles=count/9,reserve=triangles>=1024?Math.min(256,Math.ceil(triangles*.02))*9:0
  const canRefit=previous?.tree&&count<=previous.positions.length&&count>=previous.positions.length*.95
  const capacity=canRefit?previous.positions.length:count+reserve
  const data = new Float32Array(capacity), point = new Vector3(), matrix = new Matrix4()
  let offset = 0
  for (const part of parts) {
    const attribute = new BufferAttribute(part.position, part.stride, part.normalized)
    for (const transform of part.matrices) {
      matrix.fromArray(transform)
      const mirrored = matrix.determinant() < 0
      for (const range of part.ranges) for (let triangle = range.start; triangle + 2 < range.start + range.count; triangle += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const sourceCorner = mirrored && corner ? 3 - corner : corner
          const vertex = part.index?.[triangle + sourceCorner] ?? triangle + sourceCorner
          point.set(attribute.getComponent(vertex, part.offset), attribute.getComponent(vertex, part.offset + 1), attribute.getComponent(vertex, part.offset + 2))
            .applyMatrix4(matrix).toArray(data, offset)
          offset += 3
        }
      }
    }
  }
  if(count)for(let vertex=count;vertex<data.length;vertex+=3)data.set(data.subarray(count-3,count),vertex)
  // Refits still update every node and triangle. A substantial topology change
  // exceeds the reserve and falls back to a fresh SAH tree.
  const reusable = canRefit&&previous?.tree
    ? { ...previous.tree, roots: previous.tree.roots.map(root => root.slice(0)) } : undefined
  return createIndirectVisibilityFromTriangles(data, reusable, !!reusable)
}

/** Helpers reuse the prepared tree, including its reordered triangle index. */
export function restoreIndirectVisibility(snapshot: IndirectVisibilitySnapshot) {
  return createIndirectVisibilityFromTriangles(snapshot.positions, snapshot.tree)
}

function createIndirectVisibilityFromTriangles(data: Float32Array, preparedTree?: SerializedBVH | null, refit = false) {
  const count = data.length
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(data, 3))
  // Millions of visibility segments reuse this tree. A cheap midpoint split
  // leaves large overlapping nodes around detailed furniture and long walls;
  // spend a little more on construction to minimize every subsequent ray.
  let tree = preparedTree ? MeshBVH.deserialize(preparedTree, geometry) :
    count ? new MeshBVH(geometry, { strategy: SAH, targetLeafSize: 4 }) : null
  if (refit && tree) {
    const score=()=>getBVHExtremes(tree!).reduce((sum,root)=>sum+root.surfaceAreaScore,0)
    const before=score();tree.refit()
    // CSG can reorder many triangle IDs even when its triangle count barely
    // changes. A correct refit can then make millions of visibility rays much
    // slower. Rebuild before those queries if the SAH cost has deteriorated.
    if(score()>before*1.5){
      // Deserialization shares the old snapshot's index; do not reorder it.
      geometry.setIndex(null)
      tree=new MeshBVH(geometry,{strategy:SAH,targetLeafSize:4});refit=false
    }
  }
  const ray = new Ray()
  let triangles: DataTexture | null = null
  return {
    refitted: refit,
    snapshot(): IndirectVisibilitySnapshot { return { positions: data, tree: tree ? MeshBVH.serialize(tree, { cloneBuffers: false }) : null } },
    occluded: createIndirectSegmentQuery(tree),
    trianglesInBox(box: Box3, visit: (a: Vector3, b: Vector3, c: Vector3) => void) {
      tree?.shapecast({ intersectsBounds: bounds => bounds.intersectsBox(box), intersectsTriangle: triangle => {
        if (box.intersectsTriangle(triangle)) visit(triangle.a, triangle.b, triangle.c)
        return false
      } })
    },
    triangleTexture() {
      if (!triangles) {
        // Source meshes generally tessellate each quad into consecutive pairs.
        // Keep both triangles so crossing their diagonal cannot lose a shadow.
        const pairs = Math.ceil(count / 18), vertices = Math.max(1, pairs * 7)
        const width = Math.min(1024, vertices), height = Math.ceil(vertices / width)
        const values = new Float32Array(width * height * 4)
        const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3()
        for (let pair = 0; pair < pairs; pair++) {
          const base = pair * 18, target = pair * 28
          a.fromArray(data, base); b.fromArray(data, base + 3); c.fromArray(data, base + 6)
          normal.crossVectors(b.sub(a), c.sub(a)).normalize()
          const constant = normal.dot(a)
          let planar = normal.lengthSq() > .5 && base + 17 < count
          for (let vertex = 0; vertex < 6; vertex++) {
            const source = base + vertex * 3, offset = target + (vertex + 1) * 4
            if (source >= count) continue
            values[offset] = data[source]; values[offset + 1] = data[source + 1]; values[offset + 2] = data[source + 2]
            planar &&= Math.abs(normal.dot(a.fromArray(data, source)) - constant) < .00001
          }
          if (planar) { normal.toArray(values, target); values[target + 3] = constant }
        }
        triangles = new DataTexture(values, width, height, RGBAFormat, FloatType)
        triangles.magFilter = triangles.minFilter = NearestFilter
        triangles.generateMipmaps = false; triangles.needsUpdate = true
      }
      return triangles
    },
    primitiveId(faceIndex: number) {
      return Math.floor((geometry.index?.getX(faceIndex * 3) ?? faceIndex * 3) / 6) + 1
    },
    hit(origin: Vector3, direction: Vector3, max = 80, near = .025) {
      ray.set(origin, direction)
      return tree?.raycastFirst(ray, DoubleSide, near, max) ?? null
    },
    distance(origin: Vector3, direction: Vector3, max = 80) {
      ray.set(origin, direction)
      return tree?.raycastFirst(ray, DoubleSide, .025, max)?.distance ?? max
    },
    dispose() { triangles?.dispose(); geometry.dispose() },
  }
}
export type IndirectVisibility = ReturnType<typeof createIndirectVisibility>

export function indirectOctDirection(u: number, v: number) {
  const n = new Vector3(u * 2 - 1, v * 2 - 1, 1 - Math.abs(u * 2 - 1) - Math.abs(v * 2 - 1))
  if (n.z < 0) {
    const x = n.x
    n.x = (1 - Math.abs(n.y)) * (x >= 0 ? 1 : -1)
    n.y = (1 - Math.abs(x)) * (n.y >= 0 ? 1 : -1)
  }
  return n.normalize()
}

export function indirectOctUV(direction: Vector3) {
  const sum = Math.abs(direction.x) + Math.abs(direction.y) + Math.abs(direction.z)
  let x = direction.x / sum, y = direction.y / sum
  if (direction.z < 0) { const oldX = x; x = (1 - Math.abs(y)) * (oldX >= 0 ? 1 : -1); y = (1 - Math.abs(oldX)) * (y >= 0 ? 1 : -1) }
  return { x: x * .5 + .5, y: y * .5 + .5 }
}

/** Cache candidate triangles; the display tests their actual silhouettes. */
export function writeIndirectVisibility(field: IndirectField, index: number, position: Vector3, visibility: IndirectVisibility,
  firstRow = 0, rowCount = field.distanceSize) {
  const size = field.distanceSize
  const tileX = index % field.distanceColumns * size
  const tileY = Math.floor(index / field.distanceColumns) * size
  const end = Math.min(size, firstRow + rowCount)
  for (let y = firstRow; y < end; y++) for (let x = 0; x < size; x++) {
    const direction = indirectOctDirection((x + .5) / size, (y + .5) / size)
    const hit = visibility.hit(position, direction)
    const offset = (tileY + y) * field.distanceWidth + tileX + x
    field.distanceData[offset] = typeof hit?.faceIndex === 'number' ? visibility.primitiveId(hit.faceIndex) : 0
  }
  // Three's DataTexture update ranges assume four channels. This atlas is
  // single-channel; ranged uploads otherwise silently populate the wrong rows.
  // The editor uploads it in bounded copies through prepareTextureUpload.
  field.distances.needsUpdate = true
}

/** Same moment test as the shader, useful for validating wall/opening visibility. */
export function indirectVisibilityWeight(distance: number, mean: number, secondMoment: number) {
  if (distance <= mean + .06) return 1
  const variance = Math.max(.0025, secondMoment - mean * mean)
  const delta = distance - mean
  return (variance / (variance + delta * delta)) ** 3
}
