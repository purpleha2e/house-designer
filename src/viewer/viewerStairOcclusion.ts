import { Object3D, Raycaster, Vector3, type Intersection } from 'three'

/** Html only needs existence of a hit at or before the label, not a sorted
 * list of every hit through the house. Keep this query private to the overlay;
 * the shared picking/navigation raycaster and the scene stay untouched. */
export function createStairOcclusionQuery(root: Object3D) {
  const query = new Raycaster(), hits: Intersection[] = []
  const visit = (object: Object3D, distance: number): boolean => {
    let propagate = true
    if (object.layers.test(query.layers)) {
      hits.length = 0
      // Three permits a custom raycast to stop recursion by returning false.
      propagate = (object.raycast as (ray: Raycaster, out: Intersection[]) => unknown)(query, hits) !== false
      if (hits.some(hit => hit.distance <= distance)) return true
    }
    if (propagate) for (const child of object.children) if (visit(child, distance)) return true
    return false
  }
  return (source: Raycaster, distance: number) => {
    query.ray.copy(source.ray)
    query.camera = source.camera
    query.layers.mask = source.layers.mask
    query.near = source.near
    query.far = Math.min(source.far, distance)
    query.params = source.params
    try { return visit(root, distance) }
    finally { hits.length = 0 }
  }
}

export function createStairLabelOccluder(scene: Object3D, getAnchor: () => Object3D | null) {
  const proxy = new Object3D(), point = new Vector3(), blocked = createStairOcclusionQuery(scene)
  // This object lives only in Html's explicit occluder list, never in the scene.
  proxy.layers.enableAll()
  proxy.raycast = (source, intersections) => {
    const anchor = getAnchor()
    if (!anchor) return
    anchor.getWorldPosition(point)
    if (blocked(source, point.distanceTo(source.ray.origin))) {
      // A private zero-distance sentinel preserves Html's <= visibility test.
      intersections.push({ distance: 0, point: point.clone(), object: proxy })
    }
  }
  return { current: proxy }
}
