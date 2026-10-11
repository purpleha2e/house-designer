import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DataUtils, Group, Mesh, MeshStandardMaterial, SphericalHarmonics3, Vector3 } from 'three'
import { createIndirectField, writeIndirectPosition, writeIndirectProbe } from '../src/indirectLighting.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'
import { writeIndirectVolumeRow } from '../src/indirectVolume.ts'
import { inspectIndirectPoint, sampleDisplayedIndirect } from '../src/indirectLightingDiagnostic.ts'

const fixture = () => createIndirectField([{ id: 'ground', elevation: 0, height: 2.4,
  rooms: [{ signature: 'room', polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }] }])
const fill = (field: ReturnType<typeof fixture>, visibility: ReturnType<typeof createIndirectVisibility>) => {
  const result = new Float64Array(12)
  for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, result, visibility)
}

test('inspection preserves constant irradiance and matches exact blends without changing the cache', () => {
  const field = fixture(), visibility = createIndirectVisibility(new Group()), sh = new SphericalHarmonics3()
  sh.coefficients[0].set(1, .5, .125)
  field.probes.forEach(probe => writeIndirectProbe(field, probe.index, sh)); fill(field, visibility)
  const before = field.coefficients.map(data => data.slice()), volume = field.volume.data.slice()
  const report = inspectIndirectPoint(field, visibility, new Vector3(2, .018, 2), new Vector3(0, 1, 0), [])
  report.displayed.rgb.forEach((value, i) => assert.ok(Math.abs(value - report.exactAtSurface.rgb[i]) < .001))
  assert.ok(report.bias > .1 && report.bias < .15)
  field.coefficients.forEach((data, i) => assert.deepEqual(data, before[i])); assert.deepEqual(field.volume.data, volume)
  visibility.dispose(); field.dispose()
})

test('probe colours are evaluated in the selected surface direction, rather than the visible sphere side', () => {
  const field = fixture(), visibility = createIndirectVisibility(new Group()), sh = new SphericalHarmonics3()
  sh.coefficients[0].set(.5, .5, .5); sh.coefficients[1].set(.7, .1, 0)
  field.probes.forEach(probe => writeIndirectProbe(field, probe.index, sh)); fill(field, visibility)
  const top = inspectIndirectPoint(field, visibility, new Vector3(2, .018, 2), new Vector3(0, 1, 0), [])
  const side = inspectIndirectPoint(field, visibility, new Vector3(2, .3, 2), new Vector3(1, 0, 0), [])
  assert.ok(top.probes[0].finalRGB[0] > top.probes[0].finalRGB[2] * 2)
  assert.equal(side.probes[0].finalRGB[0], side.probes[0].finalRGB[2])
  visibility.dispose(); field.dispose()
})

test('inspection identifies volume filtering that imports light across a thin solid boundary', () => {
  const field = fixture(), scene = new Group(), material = new MeshStandardMaterial(), geometry = new BoxGeometry(.02, 3, 6)
  const wall = new Mesh(geometry, material); wall.position.set(2.04, 1.4, 2); scene.add(wall)
  const visibility = createIndirectVisibility(scene), warm = new SphericalHarmonics3(), black = new SphericalHarmonics3()
  warm.coefficients[0].set(1, .5, .1)
  field.probes.forEach((probe, i) => {
    writeIndirectPosition(field.positionData, probe.index, new Vector3(i % 2 ? 3 : 1, .4, 2))
    writeIndirectProbe(field, probe.index, i % 2 ? warm : black)
  })
  fill(field, visibility)
  const report = inspectIndirectPoint(field, visibility, new Vector3(2.01, .018, 2), new Vector3(0, 1, 0), [{ position: [3, 1, 2], color: '#ffaa55' }])
  assert.deepEqual(report.exactAtSurface.rgb, [0, 0, 0]); assert.deepEqual(report.exactAtShiftedSample.rgb, [0, 0, 0])
  assert.ok(report.displayed.rgb[0] > .02, `filtered red ${report.displayed.rgb[0]}`)
  assert.equal(report.lamps[0].visibleAtSurface, false)
  assert.ok(report.probes.some(probe => !probe.visibleAtSurface && probe.finalRGB[0] > .5))
  visibility.dispose(); geometry.dispose(); material.dispose(); field.dispose()
})

test('packed texture sampling normalizes partial support and excludes other storeys at borders', () => {
  const field = fixture(), { volume } = field
  for (let iz = 0; iz < volume.n; iz++) for (let iy = 0; iy < volume.height; iy++) for (let ix = 0; ix < volume.n; ix++) {
    const offset = ((iz * volume.height * 4 + iy) * volume.n + ix) * 4
    volume.data[offset] = DataUtils.toHalfFloat(.25)
    volume.data[offset + 3] = DataUtils.toHalfFloat(.25)
  }
  for (const y of [field.ranges[0].bottom, field.ranges[0].top]) {
    const sample = sampleDisplayedIndirect(field, 0, new Vector3(2, y, 2), new Vector3(0, 1, 0))
    assert.ok(Math.abs(sample.rgb[0] - .886227) < .001); assert.equal(sample.coverage, .25)
  }
  field.dispose()
})
