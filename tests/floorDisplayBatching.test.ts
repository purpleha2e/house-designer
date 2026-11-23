import assert from 'node:assert/strict'
import test from 'node:test'
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, Shape, ShapeGeometry, Vector3 } from 'three'
import { FloorDisplayBatching } from '../src/floorDisplayBatching.ts'

function floor(scene: Scene, x: number, key = 'wood:floor0', base = false) {
  const mesh = new Mesh(new PlaneGeometry(2, 2), new MeshStandardMaterial())
  mesh.position.set(x, 0, 0); mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true; mesh.renderOrder = base ? 1 : 2
  mesh.userData = { houseDesignerRole: base ? 'room-floor-base' : 'room-floor-finish', floorSurfaceBatchKey: key }
  scene.add(mesh)
  return mesh
}
const visible = (scene: Scene) => { const meshes: Mesh[] = []; scene.traverseVisible(o => { if (o instanceof Mesh) meshes.push(o) }); return meshes }
function worldVertices(mesh: Mesh) {
  mesh.updateWorldMatrix(true, false)
  const g = mesh.geometry, result: number[][] = []
  for (let i = 0; i < (g.index?.count ?? g.attributes.position.count); i++) {
    const index = g.index?.getX(i) ?? i
    result.push(new Vector3().fromBufferAttribute(g.attributes.position, index).applyMatrix4(mesh.matrixWorld).toArray()
      .concat(g.attributes.uv.getX(index), g.attributes.uv.getY(index)).map(n => Math.round(n * 1e6) / 1e6))
  }
  return result
}

test('same-finish floors merge into one draw geometry with unchanged world vertices and UVs', () => {
  const scene = new Scene(), batching = new FloorDisplayBatching()
  const a = floor(scene, 0), b = floor(scene, 3), expected = [...worldVertices(a), ...worldVertices(b)]
  let geometry: unknown
  batching.draw(scene, () => { const meshes = visible(scene); assert.equal(meshes.length, 1); assert.deepEqual(worldVertices(meshes[0]), expected); geometry = meshes[0].geometry })
  assert.deepEqual(visible(scene), [a, b])
  batching.draw(scene, () => assert.equal(visible(scene)[0].geometry, geometry, 'Camera-only frames reuse the merged buffer'))
  batching.dispose()
  assert.equal(a.geometry.attributes.position.count, 4)
})

test('storeys, finish transforms, render state and independently hidden rooms remain distinct', () => {
  const scene = new Scene(), batching = new FloorDisplayBatching()
  const a = floor(scene, 0), b = floor(scene, 3), upstairs = floor(scene, 0, 'wood:floor1'), rotated = floor(scene, 6, 'wood:rotation90')
  upstairs.position.y = 3; b.visible = false
  batching.draw(scene, () => assert.deepEqual(visible(scene), [a, upstairs, rotated]))
  b.visible = true; b.receiveShadow = false
  batching.draw(scene, () => assert.equal(visible(scene).length, 4))
  assert.equal(b.visible, true)
  batching.dispose()
})

test('worker attributes with omitted GPU defaults batch once without modifying their sources', () => {
  const scene = new Scene(), batching = new FloorDisplayBatching()
  const a = floor(scene, 0), b = floor(scene, 3)
  a.geometry = a.geometry.toNonIndexed()
  for (const attribute of Object.values(a.geometry.attributes)) Reflect.deleteProperty(attribute, 'gpuType')
  const expected = [...worldVertices(a), ...worldVertices(b)]
  let geometry: unknown
  batching.draw(scene, () => {
    assert.equal(visible(scene).length, 1)
    assert.deepEqual(worldVertices(visible(scene)[0]), expected)
    geometry = visible(scene)[0].geometry
  })
  batching.draw(scene, () => assert.equal(visible(scene)[0].geometry, geometry))
  assert.equal(Reflect.get(a.geometry.attributes.position, 'gpuType'), undefined)
  batching.dispose()
})

test('incompatible attribute layouts remain separate without retrying failed merges', () => {
  const scene = new Scene(), batching = new FloorDisplayBatching()
  const a = floor(scene, 0), b = floor(scene, 3)
  b.geometry.deleteAttribute('uv')
  for (let i = 0; i < 3; i++) batching.draw(scene, () => assert.deepEqual(visible(scene), [a, b]))
  batching.dispose()
})

test('adjacent bare and finished areas keep their materials and survive display errors', () => {
  const scene = new Scene(), batching = new FloorDisplayBatching()
  const base = floor(scene, 0, 'base', true), finish = floor(scene, 2, 'wood')
  const secondBase = floor(scene, 4, 'base', true)
  batching.draw(scene, () => {
    const bases = visible(scene).filter(mesh => mesh.userData.houseDesignerRole === 'room-floor-base')
    assert.equal(finish.visible, true); assert.equal(bases.length, 1)
    assert.deepEqual(worldVertices(bases[0]), [...worldVertices(base), ...worldVertices(secondBase)])
  })
  assert.throws(() => batching.draw(scene, () => { assert.equal(base.visible, false); throw Error('display failed') }), /display failed/)
  assert.deepEqual(visible(scene), [base, finish, secondBase])
  batching.dispose()
})

test('merged geometry preserves holes and updates after geometry, UV and transform edits', () => {
  const scene = new Scene(), batching = new FloorDisplayBatching(), a = floor(scene, 0), b = floor(scene, 4)
  const shape = new Shape().moveTo(-2,-2).lineTo(2,-2).lineTo(2,2).lineTo(-2,2).closePath()
  shape.holes.push(new Shape().moveTo(-.5,-.5).lineTo(-.5,.5).lineTo(.5,.5).lineTo(.5,-.5).closePath())
  a.geometry = new ShapeGeometry(shape)
  let previous: unknown
  batching.draw(scene, () => { const mesh = visible(scene)[0]; assert.deepEqual(worldVertices(mesh), [...worldVertices(a), ...worldVertices(b)]); previous = mesh.geometry })
  b.position.x = 5; b.geometry.attributes.uv.setX(0, .25); b.geometry.attributes.uv.needsUpdate = true
  batching.draw(scene, () => { const mesh = visible(scene)[0]; assert.notEqual(mesh.geometry, previous); assert.deepEqual(worldVertices(mesh), [...worldVertices(a), ...worldVertices(b)]) })
  batching.dispose()
})

test('picking remains on original meshes outside the draw and removed sources release cached buffers', () => {
  const scene = new Scene(), batching = new FloorDisplayBatching(), a = floor(scene, 0), b = floor(scene, 3)
  let disposed = 0
  batching.draw(scene, () => visible(scene)[0].geometry.addEventListener('dispose', () => disposed++))
  assert.equal(scene.getObjectById(a.id), a); assert.equal(a.visible, true)
  scene.remove(b)
  batching.draw(scene, () => assert.deepEqual(visible(scene), [a]))
  assert.equal(disposed, 1)
  // A room inside a hidden group must not reappear through batching.
  const hidden = new Group(); hidden.visible = false; scene.add(hidden); hidden.add(b)
  batching.draw(scene, () => assert.deepEqual(visible(scene), [a]))
  batching.dispose()
})
