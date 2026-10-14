import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, BufferAttribute, DirectionalLight, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  PointLight, Scene, Texture, Vector3 } from 'three'
import { createIndirectCaptureScene } from '../src/indirectCaptureScene.ts'

test('capture scene preserves render groups, nested transforms, instances and hidden ancestors without changing live materials', () => {
  const source = new Scene(), group = new Group(), material = new MeshStandardMaterial({ transparent: true, opacity: .2, depthWrite: false })
  const map = new Texture(); material.map = map
  material.customProgramCacheKey = () => 'custom-finish'
  material.onBeforeCompile = shader => { shader.uniforms.authored = { value: 37 } }
  group.position.set(3, 2, -1); group.rotation.y = .4
  group.renderOrder = 4
  const geometry = new BoxGeometry(), ordinary = new Mesh(geometry, [material])
  ordinary.name = 'grouped-surface'
  ordinary.position.set(2, 1, 4); group.add(ordinary); source.add(group)
  const instances = new InstancedMesh(geometry, material, 2)
  instances.setMatrixAt(0, ordinary.matrix); source.add(instances)
  const decoration = new Group(); decoration.userData.selectionDecoration = true
  decoration.add(new Mesh(geometry, material)); source.add(decoration)
  const invisible = new Group(); invisible.visible = false; invisible.add(new Mesh(geometry, material)); source.add(invisible)
  const glass = new MeshStandardMaterial({ transparent: true }); glass.name = 'Glass'
  source.add(new Mesh(geometry, glass))
  const capture = createIndirectCaptureScene(source, false)
  try {
    const proxy = capture.scene.getObjectByName('grouped-surface') as Mesh
    assert.ok(proxy.matrixWorld.equals(ordinary.matrixWorld))
    assert.equal(proxy.parent?.renderOrder, 4)
    assert.equal(capture.sourceMeshes, 3, 'no decoration or hidden descendant enters capture')
    assert.equal(proxy.geometry, geometry)
    const retained = (proxy.material as MeshStandardMaterial[])[0]
    assert.equal(retained.map, map)
    assert.equal(retained.opacity, 1); assert.equal(retained.depthWrite, true)
    assert.equal(retained.customProgramCacheKey(), 'custom-finish')
    const shader = { uniforms: {} } as Parameters<typeof material.onBeforeCompile>[0]
    retained.onBeforeCompile(shader, {} as never)
    assert.equal(shader.uniforms.authored.value, 37)
    const clone = capture.scene.children.find(object => object instanceof InstancedMesh) as InstancedMesh
    assert.notEqual(clone.instanceMatrix, instances.instanceMatrix)
    assert.deepEqual(clone.instanceMatrix.array, instances.instanceMatrix.array)
    assert.equal(material.opacity, .2); assert.equal(material.transparent, true); assert.equal(material.depthWrite, false)
    assert.equal(glass.visible, true)
    let liveDisposed = false, mapDisposed = false
    geometry.addEventListener('dispose', () => { liveDisposed = true }); map.addEventListener('dispose', () => { mapDisposed = true })
    capture.dispose(); capture.dispose()
    assert.equal(liveDisposed, false); assert.equal(mapDisposed, false)
  } finally { capture.dispose(); material.dispose(); glass.dispose(); map.dispose(); geometry.dispose(); instances.dispose() }
})

test('static batching preserves world positions, normals and receiver displacement while retaining mirrored meshes', () => {
  const scene = new Scene(), geometry = new BoxGeometry(1, 2, 1), material = new MeshStandardMaterial()
  geometry.setAttribute('hdGIReceiverOffset', new BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).map((_, i) => i % 3 === 0 ? .1 : 0), 3))
  const secondGeometry = geometry.clone().translate(.25, 0, 0)
  const meshes = [new Mesh(geometry, material), new Mesh(secondGeometry, material)]
  meshes[0].position.set(1, 1, 1); meshes[0].scale.set(2, 1, 1)
  meshes[1].position.copy(meshes[0].position); meshes[1].scale.copy(meshes[0].scale)
  const mirrored = new Mesh(geometry, material); mirrored.scale.x = -1
  const distinct = new Mesh(geometry, material); distinct.position.x = 2
  const instances = [new InstancedMesh(geometry, material, 2), new InstancedMesh(geometry, material, 2)]
  instances.forEach(mesh => mesh.setMatrixAt(1, new Matrix4().makeTranslation(3, 1, -2)))
  scene.add(...meshes, mirrored, distinct, ...instances)
  const capture = createIndirectCaptureScene(scene, false)
  try {
    assert.equal(capture.mergedMeshes, 1)
    const merged = capture.scene.children.find(object => ![geometry, secondGeometry].includes((object as Mesh).geometry)) as Mesh
    const point = new Vector3(), normal = new Vector3(), offset = new Vector3()
    for (const [index, original] of meshes.entries()) {
      const count = geometry.attributes.position.count
      point.fromBufferAttribute(original.geometry.attributes.position, 0).applyMatrix4(original.matrixWorld)
      assert.ok(point.distanceTo(new Vector3().fromBufferAttribute(merged.geometry.attributes.position, index * count).applyMatrix4(merged.matrixWorld)) < 1e-6)
      normal.fromBufferAttribute(geometry.attributes.normal, 0).transformDirection(original.matrixWorld)
      assert.ok(normal.distanceTo(new Vector3().fromBufferAttribute(merged.geometry.attributes.normal, index * count).transformDirection(merged.matrixWorld)) < 1e-6)
      offset.set(.1, 0, 0).applyMatrix4(original.matrixWorld).sub(new Vector3().setFromMatrixPosition(original.matrixWorld))
      assert.ok(offset.distanceTo(new Vector3().fromBufferAttribute(merged.geometry.attributes.hdGIReceiverOffset, index * count)
        .applyMatrix4(merged.matrixWorld).sub(new Vector3().setFromMatrixPosition(merged.matrixWorld))) < 1e-6)
    }
    const mirror = capture.scene.children.find(object => object.matrix.determinant() < 0) as Mesh
    assert.equal(mirror.geometry, geometry)
    const retainedInstances = capture.scene.children.filter(object => object instanceof InstancedMesh)
    assert.equal(retainedInstances.length, 2,
      'Three instanced meshes retain type Mesh, so type alone cannot exclude them from merging')
    assert.deepEqual(retainedInstances[0].instanceMatrix.array, instances[0].instanceMatrix.array)
    assert.equal(retainedInstances[0].count, 2)
    assert.ok(capture.scene.children.some(object => object.matrixWorld.equals(distinct.matrixWorld)))
  } finally { capture.dispose(); geometry.dispose(); secondGeometry.dispose(); material.dispose(); instances.forEach(mesh => mesh.dispose()) }
})

test('sun captures share existing shadow maps and omit editor lamps when capture lamps are supplied', () => {
  const scene = new Scene(), group = new Group(), sun = new DirectionalLight(0xffcc88, 2), lamp = new PointLight()
  sun.position.set(1, 4, 3); sun.target.position.set(-1, 0, 2)
  group.position.set(10, 0, 0); group.add(sun, sun.target); scene.add(group, lamp)
  const capture = createIndirectCaptureScene(scene, true)
  const clone = capture.scene.children.find(object => object instanceof DirectionalLight) as DirectionalLight
  try {
    assert.deepEqual(clone.position.toArray(), sun.getWorldPosition(new Vector3()).toArray())
    assert.deepEqual(clone.target.position.toArray(), sun.target.getWorldPosition(new Vector3()).toArray())
    assert.equal(clone.shadow, sun.shadow)
    assert.equal(clone.intensity, 2)
    assert.ok(!capture.scene.children.some(object => object instanceof PointLight))
    let shadowDisposed = false
    const disposeShadow = sun.shadow.dispose.bind(sun.shadow)
    sun.shadow.dispose = () => { shadowDisposed = true; disposeShadow() }
    capture.dispose(); assert.equal(shadowDisposed, false)
  } finally { capture.dispose(); sun.dispose(); lamp.dispose() }
})
