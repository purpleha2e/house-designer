import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, FloatType, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, NearestFilter, Ray, RGBAFormat, Vector3, type Object3D, type TypedArray } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { IndirectField } from './indirectLighting.ts'

export type IndirectGeometrySnapshot = {
  position: TypedArray; stride: number; offset: number; normalized: boolean; index: Uint32Array | Uint16Array | null
  ranges: { start: number; count: number }[]; matrices: number[][]; structural: boolean
}[]

/** Copy only descriptors on the UI thread. postMessage clones the source buffers;
 * world transforms, triangle expansion and BVH construction happen in the worker. */
export function snapshotIndirectGeometry(scene: Object3D, include?: (mesh: Mesh) => boolean): IndirectGeometrySnapshot {
  const parts: IndirectGeometrySnapshot = []
  scene.updateMatrixWorld(true)
  scene.traverse(object => {
    if (!(object instanceof Mesh) || (include && !include(object)) || object.userData.selectionDecoration ||
      /model-batch|ground-image/.test(String(object.userData.houseDesignerRole))) return
    const geometry = object.geometry, materials = Array.isArray(object.material) ? object.material : [object.material]
    const attribute = geometry.attributes.position
    if (!attribute) return
    const interleaved = !(attribute instanceof BufferAttribute)
    const position = interleaved ? attribute.data.array : attribute.array
    const stride = interleaved ? attribute.data.stride : attribute.itemSize
    const attributeOffset = interleaved ? attribute.offset : 0
    const groups: { start: number; count: number; materialIndex?: number }[] = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index?.count ?? attribute.count, materialIndex: 0 }]
    const ranges = groups.filter(group => {
      const material = materials[Array.isArray(object.material) ? group.materialIndex ?? 0 : 0]
      return material instanceof MeshStandardMaterial && !/glass|glazing/i.test(material.name) && (material.opacity > 0 || material.transparent)
    }).map(group => ({ start: group.start, count: Math.min(group.count, (geometry.index?.count ?? attribute.count) - group.start) }))
    if (!ranges.length) return
    const matrices: number[][] = []
    for (let instance = 0; instance < (object instanceof InstancedMesh ? object.count : 1); instance++) {
      const matrix = object.matrixWorld.clone()
      if (object instanceof InstancedMesh) { const local = new Matrix4(); object.getMatrixAt(instance, local); matrix.multiply(local) }
      matrices.push(matrix.toArray())
    }
    parts.push({ position, stride, offset: attributeOffset, normalized: attribute.normalized,
      index: geometry.index ? geometry.index.array as Uint32Array | Uint16Array : null, ranges, matrices,
      structural: /roof|ceiling|slab/.test(String(object.userData.houseDesignerRole)) })
  })
  return parts
}

export function createIndirectVisibility(scene: Object3D, include?: (mesh: Mesh) => boolean) {
  return createIndirectVisibilityFromSnapshot(snapshotIndirectGeometry(scene, include))
}

export function createIndirectVisibilityFromSnapshot(parts: IndirectGeometrySnapshot) {
  const count = parts.reduce((sum, part) => sum + part.ranges.reduce((n, range) => n + Math.floor(range.count / 3) * 9, 0) * part.matrices.length, 0)
  const data = new Float32Array(count), point = new Vector3(), matrix = new Matrix4()
  let offset = 0
  for (const part of parts) {
    const attribute = new BufferAttribute(part.position, part.stride, part.normalized)
    for (const transform of part.matrices) {
      matrix.fromArray(transform)
      for (const range of part.ranges) for (let triangle = range.start; triangle + 2 < range.start + range.count; triangle += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const vertex = part.index?.[triangle + corner] ?? triangle + corner
          point.set(attribute.getComponent(vertex, part.offset), attribute.getComponent(vertex, part.offset + 1), attribute.getComponent(vertex, part.offset + 2))
            .applyMatrix4(matrix).toArray(data, offset)
          offset += 3
        }
      }
    }
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(data, 3))
  const tree = count ? new MeshBVH(geometry, { targetLeafSize: 12 }) : null
  const ray = new Ray()
  let triangles: DataTexture | null = null
  return {
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
    hit(origin: Vector3, direction: Vector3, max = 80) {
      ray.set(origin, direction)
      return tree?.raycastFirst(ray, DoubleSide, .025, max) ?? null
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
  for (let y = firstRow; y < end; y++) {
    field.distances.addUpdateRange((tileY + y) * field.distanceWidth + tileX, size)
  }
  field.distances.needsUpdate = true
}

/** Same moment test as the shader, useful for validating wall/opening visibility. */
export function indirectVisibilityWeight(distance: number, mean: number, secondMoment: number) {
  if (distance <= mean + .06) return 1
  const variance = Math.max(.0025, secondMoment - mean * mean)
  const delta = distance - mean
  return (variance / (variance + delta * delta)) ** 3
}
