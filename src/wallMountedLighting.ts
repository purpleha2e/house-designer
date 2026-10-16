import { BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshStandardMaterial, Object3D, Plane, Vector3 } from 'three'
import type { Wall } from './types.ts'

const receivers = new WeakMap<BufferGeometry, Map<string, { geometry: BufferGeometry; users: number }>>()

export function attachWallMountedLighting(root: Object3D, wall: Wall, exteriorSide?: -1 | 1) {
  const owned: { mesh: Mesh; source: BufferGeometry; receiver: ReturnType<typeof acquireWallMountedReceiverGeometry> }[] = []
  root.updateWorldMatrix(true, true)
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.userData.selectionDecoration ||
      !(Array.isArray(object.material) ? object.material : [object.material]).some(m => m instanceof MeshStandardMaterial)) return
    const source = object.geometry
    const receiver = acquireWallMountedReceiverGeometry(source, object.matrixWorld, wall, exteriorSide)
    object.geometry = receiver.geometry
    owned.push({ mesh: object, source, receiver })
  })
  return () => owned.forEach(({ mesh, source, receiver }) => {
    if (mesh.geometry === receiver.geometry) mesh.geometry = source
    receiver.release()
  })
}

/** Local sampling planes travel with instances/batches without changing the
 * shared source asset. Only vertices inside the wall need a receiver override. */
export function acquireWallMountedReceiverGeometry(source: BufferGeometry, matrixWorld: Matrix4,
  wall: Wall, exteriorSide?: -1 | 1) {
  const normal = new Vector3(wall.start.y - wall.end.y, 0, wall.end.x - wall.start.x).normalize()
  const centre = normal.dot(new Vector3(wall.start.x, 0, wall.start.y))
  const inverse = matrixWorld.clone().invert()
  const boundary = new Plane(normal.clone(), -centre).applyMatrix4(inverse)
  const planes = ([-1, 1] as const).map(side => side === exteriorSide ? null :
    new Plane(normal.clone().multiplyScalar(side), -side * centre - wall.thickness / 2 - .08).applyMatrix4(inverse))
  const key = JSON.stringify([boundary.normal.toArray(), boundary.constant, wall.thickness,
    ...planes.map(plane => plane && [...plane.normal.toArray(), plane.constant])]
    .flat(Infinity).map(value => typeof value === 'number' ? Math.round(value * 1e6) : value))
  let entries = receivers.get(source)
  if (!entries) { entries = new Map(); receivers.set(source, entries) }
  let entry = entries.get(key)
  if (!entry) {
    const geometry = source.clone(), position = source.getAttribute('position')
    const data = planes.map(() => new Float32Array(position.count * 4))
    const p = new Vector3(), world = new Vector3()
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i); world.copy(p).applyMatrix4(matrixWorld)
      if (Math.abs(normal.dot(world) - centre) > wall.thickness / 2 + .025) continue
      planes.forEach((plane, index) => {
        if (plane) data[index].set([...plane.normal.toArray(), -plane.constant], i * 4)
      })
    }
    data.forEach((values, index) => geometry.setAttribute(`hdGIWallMount${index}`, new Float32BufferAttribute(values, 4)))
    entry = { geometry, users: 0 }; entries.set(key, entry)
  }
  entry.users++
  let released = false
  return { geometry: entry.geometry, release() {
    if (released) return
    released = true
    if (--entry.users === 0) { entries!.delete(key); entry.geometry.dispose() }
  } }
}
