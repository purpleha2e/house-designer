import { Matrix4, type Object3D, type Scene } from 'three'

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
