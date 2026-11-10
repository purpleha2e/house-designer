import {
  BufferGeometry,
  BufferAttribute,
} from 'three'
import type { WallBufferGeometryPayload } from './wallBuffer.ts'
import { indexGeometry } from '../indexedGeometry.ts'

export function createWallBufferGeometry(payload: WallBufferGeometryPayload, indexed = false) {
  const geometry = new BufferGeometry()
  const attribute = (data: number[] | Float32Array, size: number) =>
    new BufferAttribute(data instanceof Float32Array ? data : new Float32Array(data), size)

  geometry.setAttribute(
    'position',
    attribute(payload.positions, 3),
  )
  geometry.setAttribute('normal', attribute(payload.normals, 3))
  geometry.setAttribute('uv', attribute(payload.uvs, 2))
  geometry.setAttribute('hdGIReceiverOffset', attribute(payload.lightingReceiverOffsets, 3))
  for (let i = 0; i < 2; i++) geometry.setAttribute(`hdGICorner${i}`,
    attribute(payload.lightingCornerPlanes[i], 3))

  payload.groups.forEach((group) => {
    geometry.addGroup(group.start, group.count, group.materialIndex)
  })

  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  if (!indexed) return geometry
  const result = indexGeometry(geometry)
  geometry.dispose()
  return result
}
