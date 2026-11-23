import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, PlaneGeometry, Ray, TorusGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH } from 'three-mesh-bvh'
import { prepareCoarseHouseParts } from '../src/lightingLab/houseCoarseModels.ts'
import { prepareHouseGeometry, type HousePart } from '../src/lightingLab/houseGeometry.ts'

function part(geometry: BufferGeometry): HousePart {
  return { position: Float32Array.from(geometry.attributes.position.array), normal: Float32Array.from(geometry.attributes.normal.array),
    uv: Float32Array.from(geometry.attributes.uv.array), index: geometry.index ? Uint32Array.from(geometry.index.array) : undefined,
    ranges: (geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index?.count ?? geometry.attributes.position.count, materialIndex: 0 }])
      .map(g => ({ start: g.start, count: g.count, material: g.materialIndex ?? 0 })),
    matrices: [new Matrix4().toArray()], structural: false, lightingProxy: 'coarse-model' }
}
function treeFor(data: ReturnType<typeof prepareHouseGeometry>) {
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(data.position, 3))
  return { tree: MeshBVH.deserialize(data.tree, geometry), geometry }
}

test('a detailed table becomes a coarse top and legs without filling the space underneath', async () => {
  const boxes = [new BoxGeometry(2, .1, 1, 20, 2, 10).translate(0, 1, 0),
    ...[-.85, .85].flatMap(x => [-.35, .35].map(z => new BoxGeometry(.1, 1, .1, 2, 12, 2).translate(x, .5, z)))]
  const geometry = mergeGeometries(boxes, true)!, source = part(geometry)
  const prepared = await prepareCoarseHouseParts([source], () => {}), data = prepareHouseGeometry(prepared, () => {})
  assert.ok(data.position.length < source.ranges.reduce((n, r) => n + r.count, 0) * 3 * .25,
    `${source.ranges.map(r => r.count)} -> ${data.groups.map(r => r.count)}`)
  assert.equal(data.display!.position.length, source.ranges.reduce((n, r) => n + r.count, 0) * 3)
  assert.deepEqual(data.groups.map(g => g.material), source.ranges.map(r => r.material))
  const { tree, geometry: rayGeometry } = treeFor(data)
  assert.equal(tree.raycastFirst(new Ray(new Vector3(0, .5, 2), new Vector3(0, 0, -1)), DoubleSide), null)
  assert.ok(tree.raycastFirst(new Ray(new Vector3(.85, .5, 2), new Vector3(0, 0, -1)), DoubleSide))
  assert.ok(tree.raycastFirst(new Ray(new Vector3(0, 2, 0), new Vector3(0, -1, 0)), DoubleSide))
  for (const g of [...boxes, geometry, rayGeometry]) g.dispose()
})

test('coarse model reduction preserves a real hole in curved geometry', async () => {
  const geometry = new TorusGeometry(1, .15, 20, 80), source = part(geometry)
  const data = prepareHouseGeometry(await prepareCoarseHouseParts([source], () => {}), () => {})
  assert.ok(data.position.length / 9 < source.ranges[0].count / 3 * .5)
  const { tree, geometry: rayGeometry } = treeFor(data)
  assert.equal(tree.raycastFirst(new Ray(new Vector3(0, 0, 2), new Vector3(0, 0, -1)), DoubleSide), null)
  assert.ok(tree.raycastFirst(new Ray(new Vector3(1, 0, 2), new Vector3(0, 0, -1)), DoubleSide))
  assert.ok(data.display!.vertexLighting.every(v => v === 1))
  assert.ok(data.display!.vertexLightChart.every(Number.isFinite))
  geometry.dispose(); rayGeometry.dispose()
})

test('architectural geometry is untouched and repeated furnishings reuse their transport mesh', async () => {
  const geometry = new TorusGeometry(1, .2, 12, 40), source = part(geometry); source.geometryKey = 'shared-ring'
  const architecture = { ...source, lightingProxy: undefined, structural: true }
  const second = { ...source, matrices: [new Matrix4().makeTranslation(4, 0, 0).toArray()] }
  const prepared = await prepareCoarseHouseParts([architecture, source, second], () => {})
  assert.equal(prepared[0], architecture); assert.equal(prepared[1].transport!.position, prepared[2].transport!.position)
  const data = prepareHouseGeometry(prepared, () => {})
  assert.equal(data.proxyInstances, 2); assert.equal(data.proxyGeometries, 1)
  geometry.dispose()
})

test('small visible fittings share a nearby wall receiver without allocating bounce cards', async () => {
  const wall = new PlaneGeometry(3, 3), knob = new BoxGeometry(.06, .06, .06).translate(0, 0, .04)
  const architecture = { ...part(wall), structural: true, lightingProxy: undefined }
  const fitting = part(knob)
  const data = prepareHouseGeometry(await prepareCoarseHouseParts([architecture, fitting], () => {}), () => {})
  assert.equal(data.position.length / 9, 2); assert.equal(data.cards.length, 1)
  assert.equal(data.display!.position.length / 9, 14); assert.equal(data.sharedDetailInstances, 1)
  assert.ok(data.display!.vertexLighting.slice(6).every(value => value === 1))
  for (let i = 12; i < data.display!.vertexLightChart.length; i += 2) {
    assert.equal(Math.floor(data.display!.vertexLightChart[i] / 16), 0)
    assert.equal(Math.floor(data.display!.vertexLightChart[i + 1] / 16), 0)
  }
  wall.dispose(); knob.dispose()
})

test('a standalone tiny model keeps its own lighting and scaled-up models are not discarded', async () => {
  const box = new BoxGeometry(.05, .05, .05), source = part(box)
  const prepared = await prepareCoarseHouseParts([source], () => {})
  const data = prepareHouseGeometry(prepared, () => {})
  assert.equal(data.position.length / 9, 12); assert.equal(data.display, undefined)
  const large = { ...source, matrices: [new Matrix4().makeScale(20, 20, 20).toArray()] }
  const enlarged = await prepareCoarseHouseParts([large], () => {})
  assert.equal(enlarged[0].transport, undefined)
  box.dispose()
})

test('long skirting renders from shared lighting without entering the ray geometry', async () => {
  const wall = new PlaneGeometry(5, 3), skirting = new BoxGeometry(4, .15, .03).translate(0, -1.4, .02)
  const architecture = { ...part(wall), structural: true, lightingProxy: undefined }
  const trim: HousePart = { ...part(skirting), structural: true, lightingProxy: 'shared-detail' }
  const data = prepareHouseGeometry(await prepareCoarseHouseParts([architecture, trim], () => {}), () => {})
  assert.equal(data.position.length / 9, 2)
  assert.equal(data.cards.length, 1)
  assert.equal(data.display!.position.length / 9, 14)
  assert.equal(data.sharedDetailInstances, 1)
  const { tree, geometry } = treeFor(data)
  // A horizontal ray through the visible skirting misses the lighting scene.
  assert.equal(tree.raycastFirst(new Ray(new Vector3(-3, -1.4, .02), new Vector3(1, 0, 0)), DoubleSide), null)
  wall.dispose(); skirting.dispose(); geometry.dispose()
})

test('skirting fronts inherit wall lighting at floor junctions, not upward-facing floor lighting', async () => {
  const wall = new PlaneGeometry(5, 3).translate(0, 1.5, 0)
  const floor = new PlaneGeometry(5, 5).rotateX(-Math.PI / 2)
  const skirting = new BoxGeometry(4, .15, .03).translate(0, .075, .02)
  const architecture = [wall, floor].map(g => ({ ...part(g), structural: true, lightingProxy: undefined }))
  const trim: HousePart = { ...part(skirting), structural: true, lightingProxy: 'shared-detail' }
  const data = prepareHouseGeometry(await prepareCoarseHouseParts([...architecture, trim], () => {}), () => {})
  const display = data.display!
  let checked = 0
  for (let i = 12; i < display.position.length / 3; i++) {
    if (display.normal[i * 3 + 2] < .99) continue
    const chart = Math.floor(display.vertexLightChart[i * 2] / 16) + Math.floor(display.vertexLightChart[i * 2 + 1] / 16) * 32
    const owner = data.cards[chart]
    assert.ok(data.normal[owner.start * 3 + 2] > .99, 'the front must sample the wall, including at its bottom edge')
    checked++
  }
  assert.equal(checked, 6)
  assert.equal(data.position.length / 9, 4, 'skirting must remain absent from ray geometry')
  wall.dispose(); floor.dispose(); skirting.dispose()
})
