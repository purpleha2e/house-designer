import { BufferAttribute, BufferGeometry, Mesh } from 'three'

/** Reconstruct source surfaces for geometry regressions that inspect roof/wall
 * identity. These CPU-only proxies are never added to the rendered scene. */
export function wallSurfaceMeshes(scene) {
  const meshes = []
  scene.updateMatrixWorld(true)
  scene.traverse(object => {
    if (!object.isMesh || object.userData.houseDesignerRole !== 'roof-infill') return
    if (!object.userData.wallSurfaceSources) { meshes.push(object); return }
    for (const source of object.userData.wallSurfaceSources) {
      const geometry = new BufferGeometry(), original = object.geometry
      for (const [name, attribute] of Object.entries(original.attributes)) {
        const values = new attribute.array.constructor(source.count * attribute.itemSize)
        for (let i = 0; i < source.count; i++) {
          const vertex = original.index?.getX(source.start + i) ?? source.start + i
          for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.array[vertex * attribute.itemSize + c]
        }
        geometry.setAttribute(name, new BufferAttribute(values, attribute.itemSize, attribute.normalized))
      }
      geometry.computeBoundingBox(); geometry.computeBoundingSphere()
      const mesh = new Mesh(geometry, object.material)
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(object.matrixWorld); mesh.updateMatrixWorld(true)
      mesh.userData = { ...object.userData, ...source, wallSurfaceBatch: false }
      meshes.push(mesh)
    }
  })
  return meshes
}
