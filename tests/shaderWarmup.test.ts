import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DoubleSide, FrontSide, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, Texture } from 'three'
import { createShaderWarmupSnapshot, getShaderWarmupSceneRevision, registerShaderFadeSource, shaderWarmupRevisionIsCovered } from '../src/shaderWarmup.ts'

test('selection decorations are ignored through ancestors, including transform handles', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  scene.add(new Mesh(geometry, material))
  const initial = getShaderWarmupSceneRevision(scene)
  const bounds = new Group(), handles = new Group(), nested = new Group()
  bounds.userData.selectionDecoration = true
  Object.assign(handles, { isTransformControls: true })
  const helperMaterial = new MeshBasicMaterial({ transparent: true })
  bounds.add(new Mesh(geometry, helperMaterial))
  nested.add(new Mesh(geometry, helperMaterial)); handles.add(nested)
  scene.add(bounds, handles)
  assert.equal(getShaderWarmupSceneRevision(scene), initial)
  helperMaterial.opacity = .5
  assert.equal(getShaderWarmupSceneRevision(scene), initial, 'hover/drag handle opacity does not restart compilation')
  scene.remove(bounds, handles)
  assert.equal(getShaderWarmupSceneRevision(scene), initial)
  material.dispose(); helperMaterial.dispose(); geometry.dispose()
})

test('warmup retains explicit helper prototypes without depending on the current selection', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshBasicMaterial()
  const selected = new Group(); selected.userData.selectionDecoration = true
  selected.add(new Mesh(geometry, material)); scene.add(selected)
  const prototype = new Group(); Object.assign(prototype, { isTransformControls: true })
  prototype.add(new Mesh(geometry, material))
  const snapshot = createShaderWarmupSnapshot(scene, { fadeWalls: false, fadeRoofs: false, helpers: [prototype] })
  assert.equal(snapshot.root.children.length, 1, 'only the stable helper prototype is compiled')
  const retained = (snapshot.root.children[0] as Mesh).material as MeshBasicMaterial
  let disposed = false; retained.addEventListener('dispose', () => { disposed = true })
  assert.notEqual(retained, material)
  assert.equal(disposed, false)
  snapshot.dispose(); assert.equal(disposed, true)
  material.dispose(); geometry.dispose()
})

test('late meshes and composed shader hooks invalidate warmup while camera fades reuse it', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), original = new MeshStandardMaterial()
  original.customProgramCacheKey = () => 'wall'
  const wall = new Mesh(geometry, original)
  scene.add(wall)
  const initial = getShaderWarmupSceneRevision(scene)
  const fade = original.clone()
  fade.customProgramCacheKey = original.customProgramCacheKey.bind(original)
  fade.transparent = true
  registerShaderFadeSource(fade, original)
  wall.material = [original, fade] as never
  wall.visible = false; wall.position.x = 4
  assert.equal(getShaderWarmupSceneRevision(scene), initial)
  original.customProgramCacheKey = () => 'wall:room:gi'
  const patched = getShaderWarmupSceneRevision(scene)
  assert.notEqual(patched, initial)
  const late = new Mesh(geometry, new MeshStandardMaterial())
  scene.add(late)
  assert.notEqual(getShaderWarmupSceneRevision(scene), patched)
  original.dispose(); fade.dispose(); late.material.dispose(); geometry.dispose()
})

test('rebuilt walls reuse warmup while shader feature changes still invalidate it', () => {
  const scene = new Scene(), material = new MeshStandardMaterial({ side: DoubleSide })
  material.customProgramCacheKey = () => 'wall:gi'
  const wall = new Mesh(new BoxGeometry(), material)
  scene.add(wall)
  const original = getShaderWarmupSceneRevision(scene)
  const copy = material.clone(); copy.customProgramCacheKey = material.customProgramCacheKey
  copy.needsUpdate = true
  wall.material = copy
  const oldGeometry = wall.geometry; wall.geometry = new BoxGeometry(2, 3, 1); oldGeometry.dispose()
  assert.equal(getShaderWarmupSceneRevision(scene), original, 'material identity and vertex positions do not require new shaders')
  copy.side = FrontSide
  assert.notEqual(getShaderWarmupSceneRevision(scene), original)
  copy.side = DoubleSide; copy.map = new Texture()
  const textured = getShaderWarmupSceneRevision(scene)
  assert.notEqual(textured, original)
  copy.map.channel = 1
  assert.notEqual(getShaderWarmupSceneRevision(scene), textured, 'UV-channel changes need a different program')
  copy.map.dispose(); copy.dispose(); material.dispose(); wall.geometry.dispose()
})

test('selection removing an instanced batch reuses retained shaders while new features still require warmup', () => {
  const scene = new Scene(), material = new MeshStandardMaterial(), geometry = new BoxGeometry()
  const ordinary = new Mesh(geometry, material), batch = new InstancedMesh(geometry, material, 2)
  material.customProgramCacheKey = () => 'finish|with|separators'
  scene.add(ordinary, batch)
  const prepared = getShaderWarmupSceneRevision(scene)
  scene.remove(batch)
  assert.ok(shaderWarmupRevisionIsCovered(prepared, getShaderWarmupSceneRevision(scene)))
  material.normalMap = new Texture()
  assert.equal(shaderWarmupRevisionIsCovered(prepared, getShaderWarmupSceneRevision(scene)), false)
  assert.equal(shaderWarmupRevisionIsCovered('obsolete HMR revision', prepared), false)
  material.normalMap.dispose(); material.dispose(); geometry.dispose(); batch.dispose()
})

test('uniform changes reuse shaders while physical branch and clipping changes need preparation', () => {
  const scene = new Scene(), material = new MeshStandardMaterial(), geometry = new BoxGeometry()
  scene.add(new Mesh(geometry, material))
  const original = getShaderWarmupSceneRevision(scene)
  material.opacity = .5; material.roughness = .3; material.metalness = .8; material.envMapIntensity = .2
  assert.equal(getShaderWarmupSceneRevision(scene), original)
  material.alphaTest = .1
  const cutout = getShaderWarmupSceneRevision(scene)
  assert.notEqual(cutout, original)
  material.alphaTest = .5; assert.equal(getShaderWarmupSceneRevision(scene), cutout)
  material.transparent = true; assert.notEqual(getShaderWarmupSceneRevision(scene), cutout)
  material.dispose(); geometry.dispose()
})

test('feature checks notice in-place texture, define and geometry changes without version increments', () => {
  const scene = new Scene(), material = new MeshStandardMaterial(), geometry = new BoxGeometry()
  scene.add(new Mesh(geometry, material))
  material.envMap = new Texture({ height: 8 })
  material.defines.TEST_BRANCH = 1
  const initial = getShaderWarmupSceneRevision(scene)
  assert.equal(getShaderWarmupSceneRevision(scene), initial, 'unchanged scans retain their revision')
  material.defines.TEST_BRANCH = 2
  const define = getShaderWarmupSceneRevision(scene)
  assert.notEqual(define, initial)
  material.envMap.image.height = 16
  const texture = getShaderWarmupSceneRevision(scene)
  assert.notEqual(texture, define)
  geometry.attributes.uv.itemSize = 3
  const attributes = getShaderWarmupSceneRevision(scene)
  assert.notEqual(attributes, texture)
  geometry.morphTargetsRelative = true
  assert.notEqual(getShaderWarmupSceneRevision(scene), attributes)
  material.envMap.dispose(); material.dispose(); geometry.dispose()
})

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

test('warm-up waits for separate instancing variants while equivalent ordinary meshes share a retained material', () => {
  const scene = new Scene()
  const material = new MeshStandardMaterial()
  const mesh = new InstancedMesh(new BoxGeometry(), material, 2)
  scene.scale.x = -1
  scene.add(mesh, new Mesh(mesh.geometry, material), new Mesh(mesh.geometry, material))
  const snapshot = createShaderWarmupSnapshot(scene, { fadeWalls: false, fadeRoofs: false })
  const copy = snapshot.root.children[0] as InstancedMesh
  assert.equal(copy.isInstancedMesh, true)
  assert.equal(copy.count, 2)
  assert.ok(copy.matrixWorld.determinant() < 0)
  assert.notEqual(copy.material, (snapshot.root.children[1] as Mesh).material,
    'each different program variant gets its own currentProgram readiness check')
  assert.equal((snapshot.root.children[1] as Mesh).material, (snapshot.root.children[2] as Mesh).material)
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
