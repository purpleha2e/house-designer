import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
} from 'three'

const UV_EPSILON = 1e-6

export function hasUsableTextureUvs(geometry: BufferGeometry) {
  const uv = geometry.getAttribute('uv')

  if (!uv || uv.itemSize < 2 || uv.count < 3) {
    return false
  }

  let minU = Number.POSITIVE_INFINITY
  let maxU = Number.NEGATIVE_INFINITY
  let minV = Number.POSITIVE_INFINITY
  let maxV = Number.NEGATIVE_INFINITY

  for (let index = 0; index < uv.count; index += 1) {
    const u = uv.getX(index)
    const v = uv.getY(index)

    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      return false
    }

    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }

  return maxU - minU > UV_EPSILON && maxV - minV > UV_EPSILON
}

/**
 * Produces a separate, non-indexed geometry so a face can have its own UV
 * projection without changing the cached GLTF geometry or neighbouring faces.
 * Coordinates stay in model units, which gives uploaded real-world materials a
 * useful default scale instead of stretching one image over the entire object.
 */
export function createBoxProjectedUvGeometry(source: BufferGeometry) {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  const position = geometry.getAttribute('position')

  if (!position || position.itemSize < 3 || position.count < 3) {
    return geometry
  }

  geometry.computeBoundingBox()
  const minimum = geometry.boundingBox?.min ?? new Vector3()
  const uvs = new Float32Array(position.count * 2)
  const first = new Vector3()
  const second = new Vector3()
  const third = new Vector3()
  const edgeA = new Vector3()
  const edgeB = new Vector3()
  const normal = new Vector3()

  for (let start = 0; start + 2 < position.count; start += 3) {
    first.fromBufferAttribute(position, start)
    second.fromBufferAttribute(position, start + 1)
    third.fromBufferAttribute(position, start + 2)
    edgeA.subVectors(second, first)
    edgeB.subVectors(third, first)
    normal.crossVectors(edgeA, edgeB)

    const absoluteX = Math.abs(normal.x)
    const absoluteY = Math.abs(normal.y)
    const absoluteZ = Math.abs(normal.z)

    for (let offset = 0; offset < 3; offset += 1) {
      const vertexIndex = start + offset
      const x = position.getX(vertexIndex)
      const y = position.getY(vertexIndex)
      const z = position.getZ(vertexIndex)
      let u: number
      let v: number

      if (absoluteY >= absoluteX && absoluteY >= absoluteZ) {
        u = x - minimum.x
        v = z - minimum.z
      } else if (absoluteX >= absoluteZ) {
        u = z - minimum.z
        v = y - minimum.y
      } else {
        u = x - minimum.x
        v = y - minimum.y
      }

      uvs[vertexIndex * 2] = u
      uvs[vertexIndex * 2 + 1] = v
    }
  }

  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.userData.houseDesignerGeneratedUvs = true
  return geometry
}
