import { InstancedMesh, Matrix4, Mesh, type Material, type Object3D, type Scene } from 'three'
import { includeViewportObject } from './viewportSurfaceVisibility.ts'

/** Keep copied instance buffers in step with editable render batches. */
export function createViewportInstanceTransforms(scene: Object3D) {
  const bindings: { source: InstancedMesh; copy: InstancedMesh; version: number; colors: number }[] = []
  const matrix = new Matrix4(), inverse = new Matrix4()
  const sameMaterials = (a: Material | Material[], b: Material | Material[]) => {
    const left = Array.isArray(a) ? a : [a], right = Array.isArray(b) ? b : [b]
    return left.length === right.length && left.every((material, i) => material === right[i])
  }
  return {
    bind(source: Object3D, copy: Object3D) {
      if (source instanceof InstancedMesh && copy instanceof InstancedMesh) bindings.push({ source, copy, version: source.instanceMatrix.version, colors: source.instanceColor?.version ?? -1 })
    },
    sync() {
      let changed = false
      for (const binding of bindings) {
        let { source } = binding; const { copy } = binding
        if (!source.parent) {
          let replacement: InstancedMesh | undefined
          const singles: Mesh[] = []
          scene.traverse(object => {
            if (!(object instanceof Mesh) || object.geometry !== source.geometry || !sameMaterials(object.material, source.material)) return
            if (object instanceof InstancedMesh) replacement = object
            else if (object.visible && object.type === 'Mesh' && includeViewportObject(object)) singles.push(object)
          })
          if (replacement) { source = binding.source = replacement; binding.version = -1; binding.colors = -1 }
          else {
            inverse.copy(copy.matrixWorld).invert()
            const count = Math.min(singles.length, copy.instanceMatrix.count)
            for (let i = 0; i < count; i++) { singles[i].updateWorldMatrix(true, false); matrix.multiplyMatrices(inverse, singles[i].matrixWorld); copy.setMatrixAt(i, matrix) }
            copy.count = count; copy.instanceMatrix.needsUpdate = true; copy.computeBoundingSphere(); changed = true
            continue
          }
        }
        if (binding.version !== source.instanceMatrix.version || copy.count !== source.count) {
          if (copy.instanceMatrix.count < source.count) { copy.dispose(); copy.instanceMatrix = source.instanceMatrix.clone() as typeof copy.instanceMatrix }
          else copy.instanceMatrix.array.set(source.instanceMatrix.array.subarray(0, source.count * 16))
          copy.count = source.count; copy.instanceMatrix.needsUpdate = true; copy.boundingSphere = source.boundingSphere?.clone() ?? null
          binding.version = source.instanceMatrix.version; changed = true
        }
        if (copy.instanceColor && source.instanceColor && (binding.colors !== source.instanceColor.version || copy.instanceColor.count < source.count)) {
          copy.instanceColor = source.instanceColor.clone() as typeof copy.instanceColor; binding.colors = source.instanceColor.version; changed = true
        }
      }
      return changed
    },
  }
}

/** Prepared display meshes keep their geometry/materials but follow live model
 * placement, including its nested flip/mirror group. Building geometry stays
 * frozen until its replacement is ready. */
export function createViewportModelTransforms(scene: Scene) {
  const anchors = new Map<string, { object: Object3D; copies: { object: Object3D; local: Matrix4 }[] }>()
  const inverse = new Matrix4(), world = new Matrix4()
  return {
    bind(source: Object3D, copy: Object3D, matrix = source.matrixWorld) {
      let anchor: Object3D | null = source
      while (anchor && !anchor.name.startsWith('model-local-transform-') && !anchor.name.startsWith('model-transform-')) anchor = anchor.parent
      if (!anchor) return
      let entry = anchors.get(anchor.name)
      if (!entry) { entry = { object: anchor, copies: [] }; anchors.set(anchor.name, entry) }
      const local = new Matrix4().multiplyMatrices(inverse.copy(anchor.matrixWorld).invert(), matrix)
      entry.copies.push({ object: copy, local })
    },
    sync() {
      let changed = false
      for (const [name, entry] of anchors) {
        let root: Object3D = entry.object, visible = root.visible
        while (root.parent) { root = root.parent; visible &&= root.visible }
        if (root !== scene) {
          const replacement = scene.getObjectByName(name)
          if (replacement) {
            entry.object = replacement; visible = replacement.visible
            for (let p = replacement.parent; p; p = p.parent) visible &&= p.visible
          } else visible = false
        }
        entry.object.updateWorldMatrix(true, false)
        for (const { object, local } of entry.copies) {
          world.multiplyMatrices(entry.object.matrixWorld, local)
          if (!object.matrixWorld.equals(world) || object.visible !== visible) changed = true
          object.matrix.copy(world); object.matrixWorld.copy(world)
          object.matrixWorldNeedsUpdate = false; object.visible = visible
        }
      }
      return changed
    },
  }
}
