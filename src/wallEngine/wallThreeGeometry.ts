import {
  BufferGeometry,
  Float32BufferAttribute,
} from 'three'
import type { WallBufferGeometryPayload } from './wallBuffer.ts'

export function createWallBufferGeometry(payload: WallBufferGeometryPayload) {
  const geometry = new BufferGeometry()

  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(payload.positions, 3),
  )
  geometry.setAttribute('normal', new Float32BufferAttribute(payload.normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(payload.uvs, 2))

  payload.groups.forEach((group) => {
    geometry.addGroup(group.start, group.count, group.materialIndex)
  })

  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return geometry
}
