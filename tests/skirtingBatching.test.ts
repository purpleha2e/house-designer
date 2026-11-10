import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from 'three'
import { batchSkirtingByMaterial } from '../src/skirtingBatching.ts'
import { clipRoofGeometryByVolumes } from '../src/roofAbutmentGeometry.ts'
import { roofFacePlanes } from '../src/wallEngine/wallRoofClip.ts'

function triangles(geometry: BufferGeometry, attribute: string) {
  const source = geometry.getAttribute(attribute)
  return Array.from({ length: geometry.index?.count ?? source.count }, (_, i) => {
    const vertex = geometry.index ? geometry.index.getX(i) : i
    return Array.from({ length: source.itemSize }, (_, component) => source.getComponent(vertex, component))
  })
}

test('each floor has one indexed skirting batch per finish, preserving triangles, hard normals and UVs', () => {
  const first = new BoxGeometry(2, 0.09, 0.018)
  const second = first.toNonIndexed().translate(3, 0, 0)
  const otherFinish = first.clone().translate(6, 0, 0)
  const upstairs = first.clone().translate(0, 3, 0)
  const ground = batchSkirtingByMaterial([
    { geometry: first, materialKey: 'white' },
    { geometry: second, materialKey: 'white' },
    { geometry: otherFinish, materialKey: 'oak' },
  ])
  const upper = batchSkirtingByMaterial([{ geometry: upstairs, materialKey: 'white' }])
  assert.deepEqual([...ground.keys()], ['white', 'oak'])
  assert.equal(upper.size, 1)
  const white = ground.get('white')!
  assert.ok(white.index)
  assert.ok(white.getAttribute('position').count < white.index.count)
  assert.deepEqual(white.groups, [], 'no per-board draw groups')
  for (const attribute of ['position', 'normal', 'uv']) {
    assert.deepEqual(triangles(white, attribute), [...triangles(first, attribute), ...triangles(second, attribute)])
    assert.deepEqual(triangles(ground.get('oak')!, attribute), triangles(otherFinish, attribute))
    assert.deepEqual(triangles(upper.get('white')!, attribute), triangles(upstairs, attribute))
  }
  assert.ok(white.boundingBox && white.boundingSphere)
  assert.equal(first.index?.count, 36, 'source geometry remains intact')
  assert.equal(second.index, null)
  for (const geometry of [first, second, otherFinish, upstairs, ...ground.values(), ...upper.values()]) geometry.dispose()
})

test('fully clipped skirting adds no empty draw and batches do not own source geometries', () => {
  const empty = new BufferGeometry()
  empty.setAttribute('position', new Float32BufferAttribute([], 3))
  const source = new BoxGeometry(1, 0.09, 0.018)
  let disposed = false
  source.addEventListener('dispose', () => { disposed = true })
  const batches = batchSkirtingByMaterial([
    { geometry: empty, materialKey: 'empty' },
    { geometry: source, materialKey: 'white' },
  ])
  assert.deepEqual([...batches.keys()], ['white'])
  batches.forEach(geometry => geometry.dispose())
  assert.equal(disposed, false)
  source.dispose()
  empty.dispose()
  assert.equal(batchSkirtingByMaterial([]).size, 0)
})

test('indexing preserves the roof-clipped skirting triangle stream', () => {
  const source = new BoxGeometry(2, 0.09, 0.018).translate(1, 5.275, 0)
  const planes = roofFacePlanes([[0, 5.4, -1], [2, 5.2, -1], [2, 5.2, 1], [0, 5.4, 1]])
  const clipped = clipRoofGeometryByVolumes(source, [planes], point => point)
  const batch = batchSkirtingByMaterial([{ geometry: clipped, materialKey: 'white' }]).get('white')!
  assert.ok(batch.index!.count > 0)
  for (const attribute of ['position', 'normal', 'uv']) {
    assert.deepEqual(triangles(batch, attribute), triangles(clipped, attribute))
  }
  batch.dispose()
  clipped.dispose()
  source.dispose()
})

test('large floor batches use 32-bit indices without wrapping vertices', () => {
  const source = new BoxGeometry(1, 0.09, 0.018)
  const parts = Array.from({ length: 2800 }, () => ({ geometry: source, materialKey: 'white' }))
  const batch = batchSkirtingByMaterial(parts).get('white')!
  assert.ok(batch.index!.array instanceof Uint32Array)
  assert.equal(batch.index!.count, 2800 * 36)
  assert.equal(Math.max(...batch.index!.array.slice(-36)), batch.getAttribute('position').count - 1)
  batch.dispose()
  source.dispose()
})
