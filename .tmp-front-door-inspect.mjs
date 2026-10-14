import { NodeIO } from '@gltf-transform/core'
import { Matrix4, Vector3, Box3 } from 'three'

const document = await new NodeIO().read('src/models/assets/front_door.glb')
const seen = new Map(), overlaps = new Map(), summary = []
let triangles = 0
for (const node of document.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const transform = new Matrix4().fromArray(node.getWorldMatrix())
  for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
    const label = `${node.getName()}/${primitiveIndex}`
    const positions = primitive.getAttribute('POSITION'), normals = primitive.getAttribute('NORMAL')
    const indices = primitive.getIndices(), bounds = new Box3(), world = []
    for (let i = 0; i < positions.getCount(); i++) {
      const p = positions.getElement(i, [])
      const v = new Vector3(...p).applyMatrix4(transform)
      world.push(v); bounds.expandByPoint(v)
    }
    const material = primitive.getMaterial()
    summary.push({ label, vertices: world.length, triangles: (indices?.getCount() ?? world.length) / 3,
      min: bounds.min.toArray(), max: bounds.max.toArray(), material: material?.getName(),
      color: material?.getBaseColorFactor(), doubleSided: material?.getDoubleSided(), normals: !!normals })
    for (let i = 0; i < (indices?.getCount() ?? world.length); i += 3) {
      const vertices = [0, 1, 2].map(j => world[indices ? indices.getScalar(i + j) : i + j])
      const key = vertices.map(v => v.toArray().map(x => Math.round(x * 1e6)).join(',')).sort().join('|')
      const previous = seen.get(key)
      if (previous) {
        const pair = `${previous} <> ${label}`
        overlaps.set(pair, (overlaps.get(pair) ?? 0) + 1)
      } else seen.set(key, label)
      triangles++
    }
  }
}
console.log(JSON.stringify({ summary, triangles, identicalTriangles: [...overlaps.entries()] }, null, 2))
