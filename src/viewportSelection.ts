import { Group, Mesh, type Object3D, type Scene } from 'three'
import { isSelectionDecorationRoot } from './shaderWarmup.ts'

/** Selection stays live while the expensive building display is retained.
 * These proxies borrow geometry/materials; their mounted source owns disposal. */
export function createViewportSelection() {
  const root = new Group()
  const copies = new Map<Mesh, Mesh>()
  const groups = new Map<number, Group>()
  const watched = new Set<Object3D>(), candidates = new Set<Mesh>()
  let current: Scene | undefined, dirty = true, lastRevision: string | undefined
  const changed = () => { dirty = true }
  const unwatch = (object: Object3D) => {
    object.removeEventListener('childadded', changed); object.removeEventListener('childremoved', changed)
    watched.delete(object)
  }
  const clear = () => {
    root.removeFromParent(); root.clear(); copies.clear(); groups.clear()
    watched.forEach(unwatch); candidates.clear(); current = undefined; dirty = true
  }
  return { clear, sync(source: Scene, display: Scene, revision?: string) {
    // Scene membership and selection changes rebuild this small index. Camera
    // frames only update selection meshes, never the entire furnished house.
    if (source !== current) { clear(); current = source }
    if (dirty || revision !== lastRevision) {
      const present = new Set<Object3D>()
      candidates.clear()
      const visit = (object: Object3D, selected: boolean) => {
        present.add(object)
        if (!watched.has(object)) {
          watched.add(object)
          object.addEventListener('childadded', changed); object.addEventListener('childremoved', changed)
        }
        selected ||= isSelectionDecorationRoot(object)
        if (selected && object instanceof Mesh) candidates.add(object)
        for (const child of object.children) visit(child, selected)
      }
      visit(source, false)
      watched.forEach(object => { if (!present.has(object)) unwatch(object) })
      dirty = false; lastRevision = revision
    }
    const active = new Set<Mesh>()
    for (const object of candidates) {
      let visible = true
      for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) visible &&= ancestor.visible
      if (!visible) continue
      object.updateWorldMatrix(true, false)
      active.add(object)
      let copy = copies.get(object)
      if (!copy) {
        copy = new Mesh(); copy.name = object.name; copy.userData = { ...object.userData, selectionDecoration: true }
        copy.matrixAutoUpdate = false; copy.matrixWorldAutoUpdate = false
        copies.set(object, copy)
      }
      copy.geometry = object.geometry; copy.material = object.material
      copy.matrix.copy(object.matrixWorld); copy.matrixWorld.copy(object.matrixWorld)
      copy.layers.mask = object.layers.mask; copy.frustumCulled = object.frustumCulled
      copy.renderOrder = object.renderOrder
      let ancestor = object.parent
      while (ancestor && !(ancestor instanceof Group)) ancestor = ancestor.parent
      const order = ancestor?.renderOrder ?? 0
      let group = groups.get(order)
      if (!group) { group = new Group(); group.renderOrder = order; groups.set(order, group); root.add(group) }
      if (copy.parent !== group) group.add(copy)
    }
    copies.forEach((copy, object) => {
      if (!active.has(object)) { copy.removeFromParent(); copies.delete(object) }
    })
    if (root.parent !== display) display.add(root)
  } }
}
