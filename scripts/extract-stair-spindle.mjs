// Rebuild the shared spindle from the original stair asset; no runtime GLB load.
import { NodeIO } from '@gltf-transform/core'
import { Matrix3, Matrix4, Vector3 } from 'three'
import { writeFileSync } from 'node:fs'

const document = await new NodeIO().read('src/models/assets/simple_floating_stairs_simple_banister.glb')
const node = document.getRoot().listNodes().find(node => node.getName() === 'Cylinder')
if (!node?.getMesh()) throw new Error('Missing Cylinder spindle')
const primitive = node.getMesh().listPrimitives()[0]
const matrix = new Matrix4().fromArray(node.getWorldMatrix())
const normalMatrix = new Matrix3().getNormalMatrix(matrix)
const source = primitive.getAttribute('POSITION').getArray()
const points = []
for (let i = 0; i < source.length; i += 3) points.push(new Vector3().fromArray(source, i).applyMatrix4(matrix))
const min = [0, 1, 2].map(axis => Math.min(...points.map(p => p.getComponent(axis))))
const max = [0, 1, 2].map(axis => Math.max(...points.map(p => p.getComponent(axis))))
const normal = primitive.getAttribute('NORMAL').getArray(), normals = []
for (let i = 0; i < normal.length; i += 3) normals.push(...new Vector3().fromArray(normal, i).applyNormalMatrix(normalMatrix).toArray())
const data = {
  source: 'simple_floating_stairs_simple_banister.glb / Cylinder',
  size: min.map((v, axis) => max[axis] - v),
  position: points.flatMap(p => [p.x - (min[0] + max[0]) / 2, p.y - min[1], p.z - (min[2] + max[2]) / 2]),
  normal: normals,
  uv: Array.from(primitive.getAttribute('TEXCOORD_0').getArray()),
  index: Array.from(primitive.getIndices().getArray()),
}
writeFileSync('src/stairSpindle.json', JSON.stringify(data))
console.log(`Extracted ${data.position.length / 3} vertices, ${data.index.length / 3} triangles`)
