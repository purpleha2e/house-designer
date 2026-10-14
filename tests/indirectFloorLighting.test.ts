import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphericalHarmonics3, Vector3 } from 'three'
import { createIndirectField, writeIndirectPosition, writeIndirectProbe } from '../src/indirectLighting.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'
import { writeIndirectVolumeRow } from '../src/indirectVolume.ts'
import { createIndirectFloorLookup, sampleBakedIndirectFloor, writeIndirectFloorLayer } from '../src/indirectFloorLighting.ts'
import { inspectIndirectPoint } from '../src/indirectLightingDiagnostic.ts'

const floor = { id: 'ground', elevation: 0, height: 2.4, rooms: [{ signature: 'room',
  polygon: [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 6 }, { x: 0, y: 6 }] }] }
test('near-floor lighting preserves neutral probes beneath a raised bed instead of importing a distant warm sample', () => {
  const field = createIndirectField([floor], 0), scene = new Group(), geometry = new BoxGeometry(3, .25, 2), material = new MeshStandardMaterial()
  const bed = new Mesh(geometry, material); bed.position.set(2.5, .375, 2); scene.add(bed)
  const visibility = createIndirectVisibility(scene), neutral = new SphericalHarmonics3(), warm = new SphericalHarmonics3()
  neutral.coefficients[0].set(.12, .12, .12); warm.coefficients[0].set(.7, .6, .3)
  field.probes.forEach((probe, i) => {
    writeIndirectPosition(field.positionData, probe.index, new Vector3(i % 2 ? 6.9 : 3.7, .6, i % 2 ? 2 : 4.7))
    writeIndirectProbe(field, probe.index, i % 2 ? warm : neutral)
  })
  const point = new Vector3(3.85, .012, 2), normal = new Vector3(0, 1, 0), result = new Float64Array(12)
  for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, result, visibility)
  const before = inspectIndirectPoint(field, visibility, point, normal, [])
  assert.ok(before.displayed.rgb[0] > before.exactAtSurface.rgb[0] * 2, 'fixture reproduces the biased warm patch')
  const coefficients = field.coefficients.map(data => data.slice()), lookup = createIndirectFloorLookup(field, visibility)
  lookup.refreshCoefficients(); writeIndirectFloorLayer(field, visibility, lookup)
  const after = inspectIndirectPoint(field, visibility, point, normal, [])
  assert.equal(after.bias, .004); assert.equal(after.floorLayer, true)
  after.displayed.rgb.forEach((value, i) => assert.ok(Math.abs(value - after.exactAtSurface.rgb[i]) < .006))
  assert.ok(after.displayed.rgb[0] < before.displayed.rgb[0] / 2)
  field.coefficients.forEach((data, i) => assert.deepEqual(data, coefficients[i]))
  visibility.dispose(); geometry.dispose(); material.dispose(); field.dispose()
})

test('floor planes keep separate storeys and reuse geometry visibility across bounce updates', () => {
  const field = createIndirectField([floor, { ...floor, id: 'upper', elevation: 2.7 }], 0), visibility = createIndirectVisibility(new Group())
  let rays = 0
  const original = visibility.occluded
  visibility.occluded = (...args) => { rays++; return original(...args) }
  const lookup = createIndirectFloorLookup(field, visibility)
  const update = (strength: number) => {
    field.probes.forEach(probe => {
      const sh = new SphericalHarmonics3(); sh.coefficients[0].set(probe.region.floorId === 'ground' ? strength : strength * 10, .1, .05)
      writeIndirectProbe(field, probe.index, sh)
    })
    lookup.refreshCoefficients(); writeIndirectFloorLayer(field, visibility, lookup)
  }
  update(.5)
  const first = rays
  assert.ok(first > 0, 'the first pass evaluates geometry segments')
  update(.75); assert.equal(rays, first, 'later bounces reuse all visibility segments')
  const lower = sampleBakedIndirectFloor(field, 0, new Vector3(3, .012, 3), new Vector3(0, 1, 0))
  const upper = sampleBakedIndirectFloor(field, 1, new Vector3(3, 2.712, 3), new Vector3(0, 1, 0))
  assert.ok(Math.abs(upper.rgb[0] / lower.rgb[0] - 10) < .01)
  visibility.dispose(); field.dispose()
})

test('a distant warm probe retains its tiny weight when furniture blocks every nearby probe', () => {
  const field = createIndirectField([floor], 0), scene = new Group(), geometry = new BoxGeometry(1.5, .25, 2), material = new MeshStandardMaterial()
  const bed = new Mesh(geometry, material); bed.position.set(3.2, .375, 3); scene.add(bed)
  const visibility = createIndirectVisibility(scene), warm = new SphericalHarmonics3(), neutral = new SphericalHarmonics3()
  warm.coefficients[0].set(.685, .599, .341); neutral.coefficients[0].set(.04, .04, .025)
  field.probes.forEach((probe, i) => {
    writeIndirectPosition(field.positionData, probe.index, new Vector3(i ? 3.44531 : 6.632084, i ? .7 : .59875, i ? 3 : 3.919277))
    writeIndirectProbe(field, probe.index, i ? neutral : warm)
  })
  const point = new Vector3(3.44531, .012, 3), normal = new Vector3(0, 1, 0)
  const before = inspectIndirectPoint(field, visibility, point, normal, [])
  assert.ok(before.exactAtSurface.support > .005 && before.exactAtSurface.support < .006, 'matches the reported low support')
  assert.equal(before.probes.filter(probe => probe.visibleAtSurface).length, 1)
  assert.ok(before.exactAtSurface.rgb[0] > .6, 'normalization used to amplify the lone distant probe')
  const lookup = createIndirectFloorLookup(field, visibility); lookup.refreshCoefficients(); writeIndirectFloorLayer(field, visibility, lookup)
  const after = inspectIndirectPoint(field, visibility, point, normal, [])
  assert.ok(after.displayed.rgb[0] < .04, 'weak warm support remains faint')
  after.displayed.rgb.forEach((value, i) => assert.ok(Math.abs(value - after.exactAtSurface.rgb[i]) < .001))
  assert.ok(after.exactAtSurface.confidence > .05 && after.exactAtSurface.confidence < .06)
  assert.deepEqual(after.exactAtSurface.unboundedRGB, before.exactAtSurface.rgb)
  const blocked = new Vector3(3.44531, .012, 2.2)
  assert.ok(sampleBakedIndirectFloor(field, 0, blocked, normal).rgb[0] < .05, 'filtering cannot restore full brightness near the support boundary')
  visibility.dispose(); geometry.dispose(); material.dispose(); field.dispose()
})
