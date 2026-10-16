import { Group, Mesh, type Scene } from 'three'
import { isSelectionDecoration } from './shaderWarmup.ts'

/** Selection stays live while the expensive building display is retained.
 * These proxies borrow geometry/materials; their mounted source owns disposal. */
export function createViewportSelection() {
  const root = new Group()
  const copies = new Map<Mesh, Mesh>()
  const groups = new Map<number, Group>()
  const clear = () => {
    root.removeFromParent(); root.clear(); copies.clear(); groups.clear()
  }
  return { clear, sync(source: Scene, display: Scene) {
    root.removeFromParent()
    source.updateMatrixWorld(true)
    const active = new Set<Mesh>()
    source.traverseVisible(object => {
      if (!(object instanceof Mesh) || !isSelectionDecoration(object)) return
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
    })
    copies.forEach((copy, object) => {
      if (!active.has(object)) { copy.removeFromParent(); copies.delete(object) }
    })
    display.add(root)
  } }
}
