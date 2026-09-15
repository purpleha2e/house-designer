import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three'
import { ImportedModelBatching, isBatchedModelSource } from '../src/importedModelBatching.ts'

function fixture(count = 3) {
  const manager = new ImportedModelBatching(), scene = new Group()
  scene.add(manager.group)
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const models = Array.from({ length: count }, (_, i) => {
    const root = new Group(), mesh = new Mesh(geometry, material)
    root.position.set(i * 3, 1, 0)
    root.rotation.y = i * 0.2
    root.add(mesh); scene.add(root)
    return { root, mesh, unregister: manager.register(root, `model-${i}`) }
  })
  return { manager, scene, models, geometry, material }
}

test('repeated models share a draw mesh while retaining independent transforms and ray targets', () => {
  const { manager, models, geometry, material } = fixture()
  manager.update()
  const batch = manager.group.children[0] as import('three').InstancedMesh
  assert.equal(batch.count, 3)
  assert.equal(batch.geometry, geometry)
  assert.equal(batch.material, material)
  const instance = new Matrix4()
  for (let i = 0; i < models.length; i++) {
    batch.getMatrixAt(i, instance)
    instance.premultiply(batch.matrixWorld)
    instance.elements.forEach((v, j) => assert.ok(Math.abs(v - models[i].mesh.matrixWorld.elements[j]) < 1e-6))
    assert.equal(isBatchedModelSource(models[i].mesh), true)
    const hits = new Raycaster(new Vector3(i * 3, 1, 5), new Vector3(0, 0, -1)).intersectObject(models[i].root, true)
    assert.equal(hits[0].object, models[i].mesh)
  }
  const version = batch.instanceMatrix.version
  assert.equal(manager.update(), false, 'an unchanged frame skips GLB traversal and batch reconstruction')
  assert.equal(batch.instanceMatrix.version, version, 'idle/sun frames do not upload instance transforms')
  models[1].root.position.y = 4
  manager.update()
  batch.getMatrixAt(1, instance)
  assert.equal(instance.elements[13], 4)
  assert.ok(batch.instanceMatrix.version > version)
  assert.ok(batch.boundingSphere!.containsPoint(new Vector3(3, 4, 0)))
  manager.reset()
  models.forEach(({ mesh }) => assert.equal(mesh.visible, true))
})

test('mirrored instances keep positive instance determinants and the correct world transform', () => {
  const { manager, models } = fixture(2)
  for (const { root } of models) root.scale.set(-2, 1.4, 0.8)
  manager.update()
  const batch = manager.group.children[0] as import('three').InstancedMesh
  assert.equal(batch.scale.x, -1)
  models.forEach(({ mesh }, i) => {
    const matrix = new Matrix4()
    batch.getMatrixAt(i, matrix)
    assert.ok(matrix.determinant() > 0)
    matrix.premultiply(batch.matrixWorld)
    matrix.elements.forEach((v, j) => assert.ok(Math.abs(v - mesh.matrixWorld.elements[j]) < 1e-6))
  })
  manager.reset()
})

test('glass, shear and different shadow states retain separate rendering', () => {
  const { manager, models } = fixture(2)
  models[0].mesh.castShadow = true
  manager.update()
  assert.equal(manager.group.children.length, 0)
  models[1].mesh.castShadow = true
  const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.5 })
  models.forEach(({ mesh }) => { mesh.material = glass })
  manager.update()
  assert.equal(manager.group.children.length, 0)
  const opaque = new MeshStandardMaterial()
  models.forEach(({ root, mesh }) => { mesh.material = opaque; root.scale.x = 2; mesh.rotation.y = 0.4 })
  manager.update()
  assert.equal(manager.group.children.length, 0, 'sheared normals require ordinary meshes')
})

test('hidden parents, removal and cleanup release batches without disposing shared assets', () => {
  const { manager, models, geometry, material } = fixture(2)
  let disposed = false
  geometry.addEventListener('dispose', () => { disposed = true })
  material.addEventListener('dispose', () => { disposed = true })
  manager.update()
  models[1].root.visible = false
  manager.update()
  assert.equal(manager.group.children.length, 0)
  assert.equal(models[0].mesh.visible, true)
  models[1].root.visible = true
  manager.update()
  assert.equal(manager.group.children.length, 1)
  models[0].unregister()
  manager.update()
  assert.equal(manager.group.children.length, 0)
  models.forEach(({ mesh }) => assert.equal(isBatchedModelSource(mesh), false))
  assert.equal(disposed, false)
})

test('explicit invalidation rebuilds batches after render properties change', () => {
  const { manager, models } = fixture(2)
  manager.update()
  const originalBatch = manager.group.children[0]
  models.forEach(({ mesh }) => { mesh.castShadow = true })
  manager.invalidate()
  assert.equal(manager.update(), true)
  assert.notEqual(manager.group.children[0], originalBatch)
  assert.equal((manager.group.children[0] as import('three').InstancedMesh).castShadow, true)
})
