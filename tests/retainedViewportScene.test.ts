import assert from 'node:assert/strict'
import test from 'node:test'
import { BatchedMesh, BoxGeometry, Color, DirectionalLight, Group, Matrix4, Mesh, MeshStandardMaterial, Scene, Texture, Vector3 } from 'three'
import { retainViewportScene } from '../src/retainedViewportScene.ts'

test('retained display freezes transforms and material features while sharing prepared resources', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), texture = new Texture()
  const material = new MeshStandardMaterial({ map: texture }), mesh = new Mesh(geometry, material), parent = new Group()
  parent.position.set(2, 3, 4); parent.renderOrder=4;parent.add(mesh); scene.add(parent)
  const sun = new DirectionalLight(); sun.position.set(3, 5, 1); sun.castShadow = true; scene.add(sun)
  const snapshot = retainViewportScene(scene)
  let copy: Mesh|undefined
  snapshot.scene.traverse(o=>{if(o instanceof Mesh)copy=o})
  assert.ok(copy)
  assert.equal(copy.parent!.renderOrder,4)
  assert.deepEqual(copy.getWorldPosition(new Vector3()).toArray(), [2,3,4])
  assert.equal(copy.geometry, geometry)
  assert.notEqual(copy.material, material)
  material.transparent = true; parent.position.x = 9
  assert.equal((copy.material as MeshStandardMaterial).transparent, false)
  assert.equal(copy.getWorldPosition(new Vector3()).x, 2)
  const light = snapshot.scene.children.find(o => o instanceof DirectionalLight) as DirectionalLight
  assert.equal(light.shadow, sun.shadow)
  snapshot.dispose(); geometry.dispose(); material.dispose(); texture.dispose()
})
test('source disposal waits until the last retained scene releases its GPU resources', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), texture = new Texture(), material = new MeshStandardMaterial({ map: texture })
  scene.add(new Mesh(geometry, material))
  const disposed = { geometry: 0, material: 0, texture: 0 }
  geometry.addEventListener('dispose', () => disposed.geometry++)
  material.addEventListener('dispose', () => disposed.material++)
  texture.addEventListener('dispose', () => disposed.texture++)
  const a = retainViewportScene(scene), b = retainViewportScene(scene)
  geometry.dispose(); material.dispose(); texture.dispose()
  assert.deepEqual(disposed, { geometry: 0, material: 0, texture: 0 })
  a.dispose(); a.dispose()
  assert.deepEqual(disposed, { geometry: 0, material: 0, texture: 0 })
  b.dispose()
  assert.deepEqual(disposed, { geometry: 1, material: 1, texture: 1 })
})

test('retained model batches reuse prepared vertices, freeze transforms and release only their own resources', () => {
  const scene=new Scene(),geometry=new BoxGeometry(),material=new MeshStandardMaterial()
  const batch=new BatchedMesh(2,48,72,material),id=batch.addGeometry(geometry),instance=batch.addInstance(id)
  batch.setMatrixAt(instance,new Matrix4().makeTranslation(2,0,0));batch.setColorAt(instance,new Color(0xff0000));scene.add(batch)
  let sourceDisposals=0;batch.geometry.addEventListener('dispose',()=>sourceDisposals++)
  const snapshot=retainViewportScene(scene)
  const copy=snapshot.scene.children.find(object=>object instanceof BatchedMesh) as BatchedMesh
  assert.equal(copy.geometry,batch.geometry,'the copied batch must not upload another vertex store')
  batch.setMatrixAt(instance,new Matrix4().makeTranslation(9,0,0))
  const matrix=new Matrix4();copy.getMatrixAt(instance,matrix)
  assert.equal(matrix.elements[12],2)
  const colour=new Color();copy.getColorAt(instance,colour);assert.equal(colour.getHex(),0xff0000)
  snapshot.dispose();assert.equal(sourceDisposals,0,'disposing the retained batch leaves its live source intact')
  batch.dispose();assert.equal(sourceDisposals,1)
  geometry.dispose();material.dispose()
})
