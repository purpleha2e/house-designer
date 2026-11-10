import test from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  Object3D, PlaneGeometry, Raycaster, Scene, Vector3 } from 'three'
import { createStairLabelOccluder, createStairOcclusionQuery } from '../src/viewer/viewerStairOcclusion.ts'

const reference = (root: Object3D, ray: Raycaster, distance: number) => {
  const hits = ray.intersectObject(root, true)
  return hits.length > 0 && !(distance < hits[0].distance)
}

test('early query matches Three for changing rays, transforms, instances and invisible occluders', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshBasicMaterial({ side: DoubleSide })
  for (let i = 0; i < 12; i++) {
    const mesh = new Mesh(geometry, material); mesh.position.set((i % 4 - 1.5) * 1.3, (i % 3 - 1) * 1.1, -2 - i)
    mesh.rotation.set(i * .07, i * .11, i * .03); mesh.visible = i % 2 === 0; scene.add(mesh)
  }
  const instances = new InstancedMesh(geometry, material, 2)
  instances.setMatrixAt(0, new Matrix4().makeTranslation(.2, 0, -4))
  instances.setMatrixAt(1, new Matrix4().makeTranslation(-.2, .4, -6)); scene.add(instances)
  scene.updateMatrixWorld(true)
  const query = createStairOcclusionQuery(scene), ray = new Raycaster()
  let seed = 217
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32)
  for (let i = 0; i < 400; i++) {
    ray.set(new Vector3(random() - .5, random() - .5, 0), new Vector3(random() - .5, random() - .5, -1).normalize())
    ray.near = random() * 2; ray.far = 2 + random() * 14
    const before = { origin: ray.ray.origin.toArray(), direction: ray.ray.direction.toArray(), near: ray.near, far: ray.far, params: ray.params }
    const distance = random() * 16
    assert.equal(query(ray, distance), reference(scene, ray, distance), `ray ${i}`)
    assert.deepEqual(ray.ray.origin.toArray(), before.origin); assert.deepEqual(ray.ray.direction.toArray(), before.direction)
    assert.equal(ray.near, before.near); assert.equal(ray.far, before.far); assert.equal(ray.params, before.params)
  }
  geometry.dispose(); material.dispose()
})

test('distance equality, near/far clipping and layer recursion preserve Three visibility', () => {
  const scene = new Scene(), geometry = new PlaneGeometry(2, 2), material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material); mesh.position.z = -5; scene.add(mesh); scene.updateMatrixWorld(true)
  const query = createStairOcclusionQuery(scene), ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1))
  for (const distance of [0, 4.999999, 5, 5.000001, Infinity]) assert.equal(query(ray, distance), reference(scene, ray, distance))
  ray.near = 6; assert.equal(query(ray, 10), false)
  ray.near = 0; ray.far = 4; assert.equal(query(ray, 10), false)
  ray.far = Infinity; mesh.layers.set(1); assert.equal(query(ray, 10), false)
  ray.layers.set(1); assert.equal(query(ray, 10), true, 'a nonmatching parent layer does not suppress descendants')
  geometry.dispose(); material.dispose()
})

test('custom raycast recursion barriers are respected', () => {
  const scene = new Scene(), group = new Group(), child = new Object3D()
  child.raycast = (_ray, hits) => { hits.push({ distance: 1, point: new Vector3(), object: child }) }
  group.add(child); scene.add(group)
  Object.assign(group, { raycast: () => false })
  const ray = new Raycaster(), query = createStairOcclusionQuery(scene)
  assert.equal(query(ray, 2), reference(scene, ray, 2)); assert.equal(query(ray, 2), false)
  group.layers.set(1)
  assert.equal(query(ray, 2), true)
})

test('proxy follows a transformed label and responds immediately to real scene edits', () => {
  const scene = new Scene(), parent = new Group(), anchor = new Group()
  parent.position.z = -2; anchor.position.z = -3; parent.add(anchor); scene.add(parent)
  const geometry = new PlaneGeometry(2, 2), material = new MeshBasicMaterial({ side: DoubleSide }), blocker = new Mesh(geometry, material)
  blocker.position.z = -4; scene.add(blocker); scene.updateMatrixWorld(true)
  const proxy = createStairLabelOccluder(scene, () => anchor), ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1))
  assert.equal(proxy.current.parent, null, 'occlusion proxy must never intercept scene picking')
  assert.equal(ray.intersectObject(proxy.current).length, 1)
  blocker.position.x = 4; blocker.updateMatrixWorld(); assert.equal(ray.intersectObject(proxy.current).length, 0)
  blocker.position.x = 0; blocker.updateMatrixWorld(); anchor.position.z = -1; parent.updateMatrixWorld(true)
  assert.equal(ray.intersectObject(proxy.current).length, 0, 'a blocker beyond the label is irrelevant')
  scene.remove(blocker); assert.equal(ray.intersectObject(proxy.current).length, 0)
  geometry.dispose(); material.dispose()
})
