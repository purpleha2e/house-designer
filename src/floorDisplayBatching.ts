import { BufferGeometry, FloatType, Mesh, MeshStandardMaterial, Object3D, Scene } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

type Entry = { source: Mesh; geometry: BufferGeometry; attributes: string; indexVersion: number; matrix: number[] }
type Batch = { mesh: Mesh; entries: Entry[] }
const attributeVersions = (geometry: BufferGeometry) => Object.entries(geometry.attributes)
  .map(([name, attribute]) => `${name}:${'data' in attribute ? attribute.data.version : attribute.version}`).join('|')
const attributeLayout = (geometry: BufferGeometry) => Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
  .map(([name, a]) => [name, a.array.constructor.name, a.itemSize, a.normalized, Reflect.get(a, 'gpuType') ?? FloatType, !!Reflect.get(a, 'isFloat16BufferAttribute')])

function opaqueFloor(mesh: Mesh): mesh is Mesh<BufferGeometry, MeshStandardMaterial> {
  const m = mesh.material
  return m instanceof MeshStandardMaterial && m.visible && !m.transparent && m.opacity === 1 &&
    !m.alphaTest && !m.alphaHash && !m.alphaMap && !m.displacementMap && !m.wireframe && m.depthWrite &&
    !('transmission' in m && Number(m.transmission) > 0) && !mesh.castShadow &&
    !('isInstancedMesh' in mesh) && !('isSkinnedMesh' in mesh) && !mesh.morphTargetInfluences?.length &&
    mesh.geometry.drawRange.start === 0 && mesh.geometry.drawRange.count >= (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) &&
    mesh.onBeforeRender === Object3D.prototype.onBeforeRender && mesh.onAfterRender === Object3D.prototype.onAfterRender
}

/** Display-only merging. Authoritative room geometry remains unchanged for
 * picking, GI, exterior occlusion, saved lighting identity and retained views.
 * Hide sources only during the synchronous display draw; restore even on error. */
export class FloorDisplayBatching {
  private scene?: Scene
  private batches = new Map<string, Batch>()

  dispose() {
    for (const { mesh } of this.batches.values()) mesh.geometry.dispose()
    this.batches.clear()
    this.scene = undefined
  }

  draw<T>(scene: Scene, render: () => T): T {
    if (scene !== this.scene) { this.dispose(); this.scene = scene }
    const sources: Mesh<BufferGeometry, MeshStandardMaterial>[] = []
    scene.traverseVisible(object => {
      if (object instanceof Mesh && typeof object.userData.floorSurfaceBatchKey === 'string' && opaqueFloor(object)) sources.push(object)
    })
    const hidden: Mesh[] = [], added: Mesh[] = [], groups = new Map<string, typeof sources>()
    for (const source of sources) {
      // Only parts with equivalent authored finishes share a batch. Keep
      // render state and storey separate, including inherited render order.
      let ancestor = source.parent
      while (ancestor && !('isGroup' in ancestor)) ancestor = ancestor.parent
      if (ancestor?.renderOrder) continue
      const m = source.material
      const key = JSON.stringify([source.userData.floorSurfaceBatchKey, source.renderOrder, source.receiveShadow,
        source.layers.mask, m.side, m.depthTest, m.depthWrite, m.blending, m.polygonOffset,
        m.polygonOffsetFactor, m.polygonOffsetUnits, m.customProgramCacheKey(), attributeLayout(source.geometry)])
      const group = groups.get(key) ?? []
      group.push(source); groups.set(key, group)
    }
    const used = new Set<string>()
    try {
      for (const [key, parts] of groups) {
        if (parts.length < 2) continue
        used.add(key)
        parts.forEach(part => part.updateWorldMatrix(true, false))
        let batch = this.batches.get(key)
        const matches = batch?.entries.length === parts.length && batch.entries.every((entry, index) => {
          const part = parts[index]
          return entry.source === part && entry.geometry === part.geometry &&
            entry.attributes === attributeVersions(part.geometry) && entry.indexVersion === (part.geometry.index?.version ?? 0) &&
            entry.matrix.every((value, i) => value === part.matrixWorld.elements[i])
        })
        if (!matches) {
          const geometries = parts.map(part => {
            const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone()
            // Interleaved/worker attributes may omit the default GPU type.
            // Three's merger compares it strictly, otherwise retrying a failed
            // floor merge on every camera draw. Normalize only our owned copy.
            for (const [name, attribute] of Object.entries(geometry.attributes)) {
              Reflect.set(attribute, 'gpuType', Reflect.get(part.geometry.attributes[name], 'gpuType') ?? FloatType)
            }
            return geometry.applyMatrix4(part.matrixWorld)
          })
          let geometry: BufferGeometry | null
          try { geometry = mergeGeometries(geometries, false) } finally { geometries.forEach(part => part.dispose()) }
          if (!geometry) continue
          geometry.computeBoundingBox(); geometry.computeBoundingSphere()
          batch?.mesh.geometry.dispose()
          const mesh = new Mesh(geometry, parts[0].material)
          mesh.name = 'Batched floor display'
          mesh.userData.houseDesignerRole = parts[0].userData.houseDesignerRole
          mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false
          batch = { mesh, entries: parts.map(source => ({ source, geometry: source.geometry,
            attributes: attributeVersions(source.geometry), indexVersion: source.geometry.index?.version ?? 0,
            matrix: [...source.matrixWorld.elements] })) }
          this.batches.set(key, batch)
        }
        const mesh = batch!.mesh, first = parts[0]
        mesh.material = first.material
        mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder; mesh.layers.mask = first.layers.mask
        hidden.push(...parts); added.push(mesh)
      }
      for (const [key, batch] of this.batches) if (!used.has(key)) { batch.mesh.geometry.dispose(); this.batches.delete(key) }
      hidden.forEach(source => { source.visible = false })
      added.forEach(mesh => scene.add(mesh))
      return render()
    } finally {
      added.forEach(mesh => mesh.removeFromParent())
      hidden.forEach(source => { source.visible = true })
    }
  }
}
