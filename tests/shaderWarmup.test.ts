import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DoubleSide, FrontSide, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene } from 'three'
import { createShaderWarmupSnapshot } from '../src/shaderWarmup.ts'

test('warm-up includes hidden surfaces and fade variants without altering the live scene', () => {
  const scene = new Scene()
  const geometry = new BoxGeometry()
  const material = new MeshStandardMaterial({ side: DoubleSide })
  let hooks = 0
  material.onBeforeCompile = () => { hooks++ }
  material.customProgramCacheKey = () => 'wall-custom-shader'
  const wall = new Mesh(geometry, material)
  wall.visible = false
  wall.userData.houseDesignerRole = 'wall-engine-render'
  scene.add(wall)
  let geometryDisposed = false
  geometry.addEventListener('dispose', () => { geometryDisposed = true })
  const snapshot = createShaderWarmupSnapshot(scene, { fadeWalls: true, fadeRoofs: false })
  assert.equal(snapshot.root.children.length, 2)
  const opaque = snapshot.root.children[0] as Mesh<BoxGeometry, MeshStandardMaterial>
  const fade = snapshot.root.children[1] as Mesh<BoxGeometry, MeshStandardMaterial>
  assert.equal(opaque.geometry, geometry)
  assert.notEqual(opaque.material, material)
  assert.equal(opaque.material.customProgramCacheKey(), 'wall-custom-shader')
  opaque.material.onBeforeCompile({} as never, {} as never)
  assert.equal(hooks, 1)
  assert.equal(fade.material.side, FrontSide)
  assert.equal(fade.material.transparent, true)
  assert.equal(fade.material.forceSinglePass, true)
  assert.equal(material.transparent, false)
  assert.equal(material.side, DoubleSide)
  assert.equal(wall.visible, false)
  // Edits may dispose the live material during asynchronous compilation.
  material.dispose()
  assert.equal(opaque.material.customProgramCacheKey(), 'wall-custom-shader')
  let releases = 0
  opaque.material.addEventListener('dispose', () => { releases++ })
  fade.material.addEventListener('dispose', () => { releases++ })
  snapshot.dispose()
  snapshot.dispose()
  assert.equal(releases, 2)
  assert.equal(geometryDisposed, false)
})

test('warm-up preserves instancing, mirrored transforms and shared materials', () => {
  const scene = new Scene()
  const material = new MeshStandardMaterial()
  const mesh = new InstancedMesh(new BoxGeometry(), material, 2)
  scene.scale.x = -1
  scene.add(mesh, new Mesh(mesh.geometry, material))
  const snapshot = createShaderWarmupSnapshot(scene, { fadeWalls: false, fadeRoofs: false })
  const copy = snapshot.root.children[0] as InstancedMesh
  assert.equal(copy.isInstancedMesh, true)
  assert.equal(copy.count, 2)
  assert.ok(copy.matrixWorld.determinant() < 0)
  assert.equal(copy.material, (snapshot.root.children[1] as Mesh).material)
  snapshot.dispose()
})

test('selection variants are prepared and retained with each material slot until scene cleanup', () => {
  const scene = new Scene()
  const originals = [new MeshStandardMaterial(), new MeshStandardMaterial({ side: DoubleSide })]
  const mesh = new Mesh(new BoxGeometry(), originals)
  mesh.visible = false
  scene.add(mesh)
  let releases = 0
  const snapshot = createShaderWarmupSnapshot(scene, {
    fadeWalls: false, fadeRoofs: false,
    createExtraMaterials(source) {
      const material = new MeshBasicMaterial({ side: source.side, transparent: true, opacity: 0.28 })
      material.addEventListener('dispose', () => releases++)
      return [material]
    },
  })
  const selection = snapshot.root.children[1] as Mesh<BoxGeometry, MeshBasicMaterial[]>
  assert.equal(selection.visible, true)
  assert.equal(selection.geometry, mesh.geometry)
  assert.equal(selection.material.length, 2)
  assert.equal(selection.material[1].side, DoubleSide)
  assert.equal(mesh.visible, false)
  assert.equal(mesh.material, originals)
  assert.equal(releases, 0)
  snapshot.dispose()
  snapshot.dispose()
  assert.equal(releases, 2)
})
