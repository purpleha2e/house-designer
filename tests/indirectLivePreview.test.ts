import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DataUtils, Group, Mesh, MeshStandardMaterial, SphericalHarmonics3 } from 'three'
import { snapshotIndirectGeometry } from '../src/indirectVisibility.ts'
import { createIndirectField, writeIndirectProbe } from '../src/indirectLighting.ts'
import { prepareIndirectCache } from '../src/indirectLightingCache.ts'
import { createIndirectBounceField, createIndirectPreviewField, indirectPreviewCoefficients, liveIndirectFaceBudget, liveIndirectTimeBudget, shouldPublishLivePreview } from '../src/indirectLivePreview.ts'

const floors = [{ id: 'ground', elevation: 0, height: 3, rooms: [{ signature: 'room',
  polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }] }]

test('background weights preserve exact volume/floor results and do not publish unfinished lighting', () => {
  const scene = new Group(), geometry = new BoxGeometry(.08, 3, 4), material = new MeshStandardMaterial()
  const wall = new Mesh(geometry, material); wall.position.set(2, 1.5, 2); scene.add(wall)
  const snapshot = snapshotIndirectGeometry(scene)
  const cold = prepareIndirectCache(floors, [], snapshot, []), warm = prepareIndirectCache(floors, [], snapshot, [])
  try {
    let rays = 0
    const occluded = warm.visibility.occluded
    warm.visibility.occluded = (...args) => { rays++; return occluded(...args) }
    const positions = warm.field.positionData.slice(), coefficients = warm.field.coefficients.map(a => a.slice())
    const volume = warm.field.volume.data.slice(), floor = warm.field.floorLayer.data.slice()
    const rows = warm.warmVisibility()
    // Previews can interleave with a partially warmed final lookup.
    for (let i = 0; i < 10; i++) rows.next()
    const previewPositions = positions.slice()
    for (const probe of warm.field.probes.slice(1)) previewPositions[probe.index * 4 + 3] = 0
    warm.preview(coefficients, previewPositions)
    while (!rows.next().done) { /* complete the geometry-only work */ }
    assert.ok(rays > 0, 'the background job actually evaluates exact occlusion')
    assert.deepEqual(warm.field.coefficients, coefficients)
    assert.deepEqual(warm.field.positionData, positions)
    assert.deepEqual(warm.field.volume.data, volume)
    assert.deepEqual(warm.field.floorLayer.data, floor)
    assert.equal(warm.field.floorLayer.ready, false)
    const before = rays
    const light = coefficients.map((a, colour) => a.map((_, i) => DataUtils.toHalfFloat((i % 4 === 0 ? .5 : .1) * (colour + 1))))
    assert.deepEqual(warm.volume(light, positions), cold.volume(light, positions))
    assert.deepEqual(warm.field.floorLayer.data, cold.field.floorLayer.data)
    assert.equal(rays, before, 'final evaluation reuses every warmed visibility segment')
  } finally { cold.dispose(); warm.dispose(); geometry.dispose(); material.dispose() }
})

test('live previews preserve old indirect light while replacing measured direct light', () => {
  const field = createIndirectField(floors, 0), old = createIndirectField(floors, 0)
  const direct = field.coefficients.map(a => a.map(() => DataUtils.toHalfFloat(.25)))
  const final = field.coefficients.map(a => a.map(() => DataUtils.toHalfFloat(.5)))
  const updated = field.probes[0], other = field.probes[1], sh = new SphericalHarmonics3()
  sh.coefficients[0].set(.125, .125, .125); writeIndirectProbe(field, updated.index, sh)
  const before = field.coefficients.map(a => a.slice())
  const preview = indirectPreviewCoefficients(field, new Set([updated.index]), 1, { field: old, direct, final })
  assert.equal(DataUtils.fromHalfFloat(preview.coefficients[0][updated.index * 4]), .375)
  assert.equal(DataUtils.fromHalfFloat(preview.coefficients[0][other.index * 4]), .5)
  const bounce = indirectPreviewCoefficients(field, new Set([updated.index]), 2, { field: old, direct, final })
  assert.equal(DataUtils.fromHalfFloat(bounce.coefficients[0][updated.index * 4]), .125)
  assert.equal(DataUtils.fromHalfFloat(bounce.coefficients[0][other.index * 4]), .5)
  assert.deepEqual(field.coefficients, before, 'display previews never feed their approximations back into capture coefficients')
  old.probes[1].position.x += .1
  const moved = indirectPreviewCoefficients(field, new Set([updated.index]), 1, { field: old, direct, final })
  assert.equal(moved.positions[other.index * 4 + 3], 0, 'relocated support cannot inherit unrelated lighting')
  field.dispose(); old.dispose()
})

test('startup previews omit missing samples, retaining measured black samples', () => {
  const field = createIndirectField(floors, 0), captured = field.probes[0], missing = field.probes[1]
  const preview = indirectPreviewCoefficients(field, new Set([captured.index]), 1)
  assert.equal(preview.positions[captured.index * 4 + 3], 1)
  assert.equal(preview.positions[missing.index * 4 + 3], 0)
  assert.equal(field.positionData[missing.index * 4 + 3], 1)
  field.dispose()
})

test('small preview textures and worker updates leave the final bake intact', () => {
  const cache = prepareIndirectCache(floors, [], [], [])
  const field = cache.field, preview = createIndirectPreviewField(field)
  assert.ok(preview.volume.n < field.volume.n && preview.floorLayer.n < field.floorLayer.n)
  field.coefficients.forEach(a => a.fill(DataUtils.toHalfFloat(.25)))
  const full = cache.volume(field.coefficients, field.positionData), fullFloor = field.floorLayer.data.slice()
  const data = cache.preview(field.coefficients.map(a => a.map(() => DataUtils.toHalfFloat(.5))), field.positionData)
  assert.equal(data.volume.length, preview.volume.data.length)
  assert.equal(data.floor.length, preview.floorLayer.data.length)
  assert.ok(data.volume.some(value => value !== 0))
  assert.deepEqual(field.volume.data, full)
  assert.deepEqual(field.floorLayer.data, fullFloor)
  assert.equal(DataUtils.fromHalfFloat(field.coefficients[0][0]), .25)
  assert.deepEqual(cache.volume(field.coefficients, field.positionData), full, 'interleaved previews cannot contaminate a bounce')
  let sharedDisposed = false
  field.mask.addEventListener('dispose', () => { sharedDisposed = true })
  preview.dispose(); assert.equal(sharedDisposed, false)
  cache.dispose()
})

test('live updates are bounded, and navigation retains a small capture budget', () => {
  assert.equal(shouldPublishLivePreview(4, 0, 300, 0), true)
  assert.equal(shouldPublishLivePreview(7, 4, 1000, 300), false)
  assert.equal(shouldPublishLivePreview(8, 4, 500, 300), false)
  assert.equal(shouldPublishLivePreview(8, 4, 600, 300), true)
  assert.equal(liveIndirectFaceBudget(1 / 60, false, 100, 90), 6)
  assert.equal(liveIndirectFaceBudget(1 / 60, true, 100, 90), 0)
  assert.equal(liveIndirectFaceBudget(1 / 60, true, 150, 90), 1)
  assert.equal(liveIndirectFaceBudget(1 / 20, true, 150, 90), 0)
  assert.equal(liveIndirectFaceBudget(1 / 20, false, 150, 90), 6, 'an expensive previous idle batch must not reduce throughput to one face per frame')
  assert.equal(liveIndirectFaceBudget(1 / 20, false, 150, 90, true), 1, 'the diagnostic control retains the old scheduler')
  assert.equal(liveIndirectTimeBudget(1 / 60, false), 8)
  assert.equal(liveIndirectTimeBudget(1 / 20, false), 4)
  assert.equal(liveIndirectTimeBudget(1 / 60, true), 3)
  assert.equal(liveIndirectTimeBudget(1 / 60, false, true), 2)
  assert.equal(liveIndirectTimeBudget(1 / 60, true, true), 1)
})

test('camera-priority bounce input owns full-resolution light textures independently of display light', () => {
  const field = createIndirectField(floors, 0), input = createIndirectBounceField(field)
  try {
    assert.equal(input.mask, field.mask); assert.equal(input.positions, field.positions)
    assert.equal(input.volume.n, field.volume.n); assert.equal(input.floorLayer.n, field.floorLayer.n)
    assert.notEqual(input.volume.maps[0], field.volume.maps[0])
    input.volume.data.fill(123); input.floorLayer.data.fill(456)
    assert.equal(field.volume.data[0], 0); assert.equal(field.floorLayer.data[0], 0)
    let disposed = false; field.volume.maps[0].addEventListener('dispose', () => { disposed = true })
    input.dispose(); assert.equal(disposed, false)
  } finally { field.dispose() }
})

test('moving a lamp reuses prepared geometry and only refreshes its visibility tile', () => {
  const cache = prepareIndirectCache(floors, [[1, 2, 1], [3, 2, 3]], [], [])
  const probes = cache.field.probes
  let rays = 0
  const hit = cache.visibility.hit
  cache.visibility.hit = (...args) => { rays++; return hit(...args) }
  cache.updateLights([[1, 2, 1], [3, 2, 3]])
  assert.equal(rays, 0)
  cache.updateLights([[1.5, 2, 1], [3, 2, 3]])
  assert.equal(rays, cache.field.distanceSize ** 2, 'only the moved light is retraced')
  assert.equal(cache.field.probes, probes)
  cache.updateLights([[1.5, 2, 1], [3, 2, 3]])
  assert.equal(rays, cache.field.distanceSize ** 2)
  assert.throws(() => cache.updateLights([]), /light count changed/)
  cache.dispose()
})


test('GPU interpolation graph exports exact visible links independently of captured validity', () => {
  const scene = new Group(), geometry = new BoxGeometry(.08, 3, 4), material = new MeshStandardMaterial()
  const wall = new Mesh(geometry, material); wall.position.set(2, 1.5, 2); scene.add(wall)
  const cache = prepareIndirectCache(floors, [], snapshotIndirectGeometry(scene), [])
  const preview = createIndirectPreviewField(cache.field)
  try {
    const graph = cache.gpuPreview()
    const positions = cache.field.positionData.slice()
    const coefficients = cache.field.coefficients.map((a,c)=>a.map((_,i)=>DataUtils.toHalfFloat((c+1)*(.2+(i%17)/20))))
    for (const probe of cache.field.probes.filter((_,i)=>i%3)) positions[probe.index*4+3]=0
    const expected = cache.preview(coefficients, positions)
    const evaluate = (table: typeof graph.volume, voxel: number, coefficient: number, floor: boolean) => {
      const sum = [0,0,0]; let support = 0
      for (let i=table.offsets[voxel];i<table.offsets[voxel]+table.counts[voxel];i++) {
        const index=table.indices[i],weight=table.weights[i]
        if (positions[index*4+3]<.5) continue
        support+=weight
        for(let c=0;c<3;c++)sum[c]+=DataUtils.fromHalfFloat(coefficients[c][index*4+coefficient])*weight
      }
      return [...sum.map(v=>support>0?v/support*(floor?Math.min(1,support/.1):1):0),support>0?1:0]
    }
    for (const floor of [false,true]) {
      const layer=floor?preview.floorLayer:preview.volume, table=floor?graph.floor:graph.volume, data=floor?expected.floor:expected.volume
      for(let z=0;z<layer.n;z++)for(let row=0;row<layer.height;row++)for(let x=0;x<layer.n;x++)for(let coefficient=0;coefficient<4;coefficient++) {
        const f=floor?row:Math.floor(row/14),iy=Math.max(0,Math.min(11,row%14-1))
        const voxelRow=floor?f*layer.n+z:(f*layer.n+z)*12+iy
        const result=evaluate(table,voxelRow*layer.n+x,coefficient,floor)
        const offset=((z*layer.height*4+coefficient*layer.height+row)*layer.n+x)*4
        result.forEach((v,c)=>assert.ok(Math.abs(v-DataUtils.fromHalfFloat(data[offset+c]))<.002))
      }
    }
    assert.deepEqual(cache.gpuPreview(),graph,'exported graph does not depend on current lighting or missing captures')
  } finally { preview.dispose();cache.dispose();geometry.dispose();material.dispose() }
})
