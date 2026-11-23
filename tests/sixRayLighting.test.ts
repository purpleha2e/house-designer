import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, DataUtils, Vector3 } from 'three'
import type { ReferenceRGB, ReferenceSceneData } from '../src/diffuseSceneMaterials.ts'
import { createIndirectField } from '../src/indirectLighting.ts'
import { sampleDisplayedIndirect } from '../src/indirectLightingDiagnostic.ts'
import { createIndirectVolumeLookup, writeIndirectVolumeRow } from '../src/indirectVolume.ts'
import { createSixRaySolver, SIX_RAY_VOLUME_RESOLUTION, type SixRayOpening } from '../src/sixRayLighting.ts'
import { projectSixRayRadiance, sixRayDirections, type SixRayMode, type SixRayTarget } from '../src/sixRaySampling.ts'
import { createSceneLightingReference } from './sceneLightingReference.ts'

const modes: SixRayMode[] = ['six-fixed', 'six-rotated', 'six-adaptive']
const target = (direction: number[], kind: SixRayTarget['kind']): SixRayTarget => ({
  id: kind, kind, direction: new Vector3().fromArray(direction).normalize(), score: 1, solidAngle: .2,
})
const targets = [target([1, 1, 1], 'opening'), target([.1, -1, .3], 'sunlit surface')]
const rgb = (r: number): ReferenceRGB => [r, r, r]

test('symmetric quadrature and adaptive regression recover uniform and affine L1 radiance', () => {
  const axes = new Vector3(.22, -.35, .14)
  for (const mode of modes) for (const count of [6, 12, 24]) {
    const samples = sixRayDirections(mode, targets, count)
    assert.equal(samples.length, count)
    if (mode !== 'six-adaptive') {
      for (let i = 0; i < count; i += 6) {
        const [x, nx, y, ny, z, nz] = samples.slice(i, i + 6).map(s => s.direction)
        assert.ok(x.dot(nx) < -.999999 && y.dot(ny) < -.999999 && z.dot(nz) < -.999999)
        assert.ok(Math.abs(x.dot(y)) + Math.abs(y.dot(z)) + Math.abs(z.dot(x)) < 1e-8)
      }
    }
    for (const slope of [0, 1]) {
      const coefficients = projectSixRayRadiance(mode, samples, samples.map(({ direction }) => rgb(.7 + slope * direction.dot(axes))))
      const expected = [.7 * Math.sqrt(4 * Math.PI), axes.y * slope * Math.sqrt(4 * Math.PI / 3),
        axes.z * slope * Math.sqrt(4 * Math.PI / 3), axes.x * slope * Math.sqrt(4 * Math.PI / 3)]
      coefficients.forEach((value, i) => assert.ok(Math.abs(value - expected[Math.floor(i / 3)]) < 1e-6))
    }
  }
})

test('a concentrated source between the fixed axes has bounded adaptive SH leverage', () => {
  const axis = targets[0].direction, radius = .12, size = 2 * Math.PI * (1 - Math.cos(radius))
  const source = { ...targets[0], solidAngle: size }
  const exact = 10 * size / Math.sqrt(4 * Math.PI)
  const project = (mode: SixRayMode) => {
    const sample = sixRayDirections(mode, [source], 6)
    return projectSixRayRadiance(mode, sample, sample.map(({ direction }) => rgb(direction.dot(axis) > Math.cos(radius) ? 10 : 0)))
  }
  assert.equal(project('six-fixed')[0], 0)
  const rotated = project('six-rotated'), adaptive = project('six-adaptive')
  assert.ok(rotated[0] > 20 * exact)
  assert.ok(adaptive[0] > 0 && Math.abs(adaptive[0] - exact) < exact * .3)
  const direction = new Vector3(adaptive[9], adaptive[3], adaptive[6]).normalize()
  assert.ok(direction.dot(axis) > .95)
})

function room(width: number, door?: number, otherWindow = false) {
  const positions: number[] = [], uvs: number[] = [], materialIndices: number[] = []
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material = 0) => {
    if (Math.min(w, h, d) <= 0) return
    const geometry = new BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z)
    positions.push(...geometry.attributes.position.array)
    uvs.push(...geometry.attributes.uv.array)
    materialIndices.push(...Array(geometry.attributes.position.count / 3).fill(material))
    geometry.dispose()
  }
  box(0, -.05, 0, 6.2, .1, 6.2, 1)
  box(0, 3.05, 0, 6.2, .1, 6.2)
  box(-3.05, 1.5, 0, .1, 3, 6.2)
  box(3.05, 1.5, 0, .1, 3, 6.2)
  box(0, 1.5, -3.05, 6.2, 3, .1)
  const start = .9 - width / 2, end = .9 + width / 2
  if (otherWindow) {
    box(-2.6, 1.5, 3.05, 1, 3, .1)
    box((-1.3 + start) / 2, 1.5, 3.05, start + 1.3, 3, .1)
    box(-1.7, .55, 3.05, .8, 1.1, .1)
    box(-1.7, 2.75, 3.05, .8, .5, .1)
  } else box((-3.1 + start) / 2, 1.5, 3.05, start + 3.1, 3, .1)
  box((end + 3.1) / 2, 1.5, 3.05, 3.1 - end, 3, .1)
  box(.9, .55, 3.05, width, 1.1, .1)
  box(.9, 2.75, 3.05, width, .5, .1)
  if (door !== undefined) {
    const left = -.31 - door / 2, right = -.31 + door / 2
    box((left - 3) / 2, 1.5, 1.5, left + 3, 3, .1)
    box((right + 3) / 2, 1.5, 1.5, 3 - right, 3, .1)
    box(-.31, 2.6, 1.5, door, .8, .1)
  }
  const part = { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], map: -1, wrapS: 1001, wrapT: 1001, metalness: 0 }
  const data: ReferenceSceneData = {
    positions: Float32Array.from(positions), uvs: Float32Array.from(uvs), materialIndices: Uint16Array.from(materialIndices),
    materials: [{ ...part, color: [.6, .6, .6] }, { ...part, color: [.6, .22, .12] }], textures: [],
    sunDirection: [.12, .65, .75], sunIrradiance: [3, 2.8, 2.5], daylightGain: 1,
    skyBase: [.65, .72, .82], skySun: [1.3, 1.2, 1.1], skyMode: 'clear', lights: [],
  }
  const openings: SixRayOpening[] = width > 0 ? [{ id: 'window', center: [.9, 1.8, 3.05], u: [1, 0, 0],
    v: [0, 1, 0], normal: [0, 0, 1], width, height: 1.4 }] : []
  if (otherWindow) openings.push({ ...openings[0], id: 'second window', center: [-1.7, 1.8, 3.05], width: .8 })
  return { data, openings }
}

test('enclosed room rejects sky and sun, and fixed intersections survive source updates', () => {
  const { data, openings } = room(0), solver = createSixRaySolver(data, openings)
  const probes = [{ index: 7, position: new Vector3(-2.5, 1.4, 2.5) }]
  const options = { mode: 'six-fixed', primary: 6, secondary: 4 } as const
  const a = solver.solve(probes, options, data)
  assert.ok(a.coefficients.every(v => v === 0))
  assert.equal(a.stats.primaryRays, 6)
  assert.equal(a.stats.secondaryRays, 24)
  const b = solver.solve(probes, options, { ...data, sunDirection: [.1, .5, .9] })
  assert.ok(b.coefficients.every(v => v === 0))
  assert.equal(b.stats.primaryRays + b.stats.secondaryRays, 0)
  assert.equal(b.stats.primaryCacheHits + b.stats.secondaryCacheHits, 30)
  solver.dispose()
})

test('primary intersections sample linear diffuse colour at the hit UV', () => {
  const { data, openings } = room(0)
  data.materials[1].map = 0
  data.textures.push({ width: 2, height: 1,
    pixels: Uint16Array.from([.1, 1, 1, 1, .9, 1, 1, 1], DataUtils.toHalfFloat) })
  const solver = createSixRaySolver(data, openings), normal = new Vector3(0, 1, 0)
  const options = { mode: 'six-fixed', primary: 6, secondary: 0 } as const
  const floorHit = (x: number) => solver.inspect({ index: 1, position: new Vector3(x, 1, 0) }, normal, options, data).traces[3].hit!
  const a = floorHit(-2), b = floorHit(2)
  assert.equal(a.material, 1)
  assert.equal(b.material, 1)
  assert.ok(Math.abs(a.uv[0] - b.uv[0]) > .5)
  assert.ok(Math.abs(a.reflectance[0] - b.reflectance[0]) > .4)
  assert.equal(a.reflectance[1], b.reflectance[1])
  solver.dispose()
})

test('adaptive rays find an off-axis window and its tinted sunlit floor patch', () => {
  const { data, openings } = room(1), solver = createSixRaySolver(data, openings)
  const probe = { index: 5, position: new Vector3(-.7, 1.2, 1) }
  const options = { mode: 'six-adaptive', primary: 6, secondary: 4 } as const
  const normal = new Vector3(0, -1, 0)
  const fixed = solver.inspect(probe, normal, { ...options, mode: 'six-fixed' }, data)
  const adaptive = solver.inspect(probe, normal, options, data)
  assert.ok(fixed.traces.every(ray => ray.hit))
  assert.ok(adaptive.traces.some(ray => ray.target?.kind === 'opening' && !ray.hit))
  assert.ok(adaptive.traces.some(ray => ray.target?.kind === 'sunlit surface' && ray.solarVisible &&
    ray.hit?.material === 1 && ray.first[0] > ray.first[1]))
  assert.equal(adaptive.traces.filter(ray => !ray.target).length, 4)
  assert.ok(adaptive.traces.some(ray => ray.secondary.length === 4 && ray.second.some(x => x > 0)))
  const a = solver.solve([probe], options, data), b = solver.solve([probe], options, { ...data, sunDirection: [-.38, .66, .65] })
  assert.ok(a.stats.primaryCacheHits >= 6)
  assert.ok(b.stats.primaryRays > 0)
  assert.notDeepEqual(a.coefficients, b.coefficients)
  const reference = createSceneLightingReference(data)
  const expected = reference.evaluate({ name: 'downward', position: probe.position.toArray(), normal: normal.toArray(),
    geometricNormal: normal.toArray() }, 8192, 3, 124, 3)
  assert.ok(expected.reflected[0] > expected.reflected[1])
  const small = room(.2), smaller = createSixRaySolver(small.data, small.openings)
  const smallResult = smaller.inspect(probe, normal, options, small.data)
  const apertureScore = (result: typeof adaptive) => result.candidates.find(candidate => candidate.kind === 'opening')?.score ?? 0
  assert.ok(apertureScore(smallResult) < apertureScore(adaptive) * .3)
  smaller.dispose(); reference.dispose(); solver.dispose()
})

test('influence accounts for attenuation, spotlight cones and visibility before ranking a nearby lamp', () => {
  const { data, openings } = room(2), solver = createSixRaySolver(data, openings)
  data.sunIrradiance = rgb(0)
  data.lights = [
    { position: [0, 1.2, 1.2], intensity: .002, color: rgb(1), distance: 1, decay: 2 },
    { position: [0, 1.2, .8], intensity: 1000, color: rgb(1), distance: 10, decay: 2,
      direction: [1, 0, 0], cone: .99, penumbra: .999 },
  ]
  const result = solver.inspect({ index: 1, position: new Vector3(-.7, 1.2, 1) }, new Vector3(0, -1, 0),
    { mode: 'six-rotated', primary: 6, secondary: 0 }, data)
  assert.equal(result.traces[0].target?.kind, 'opening')
  assert.ok(!result.candidates.some(candidate => candidate.id === 'Lamp 2'))
  solver.dispose()
})

test('opening ranking follows an interior doorway and rejects a sealed partition', () => {
  const probe = { index: 12, position: new Vector3(-.7, 1.2, 1) }
  for (const width of [.65, 0]) {
    const { data, openings } = room(1, width, true), solver = createSixRaySolver(data, openings)
    data.sunIrradiance = rgb(0)
    const report = solver.inspect(probe, new Vector3(0, 0, 1), { mode: 'six-adaptive', primary: 6, secondary: 4 }, data)
    assert.equal(report.candidates.filter(source => source.kind === 'opening').length, 2)
    assert.equal(report.candidates.find(source => source.id === 'window')?.visible, width > 0)
    assert.equal(report.candidates.find(source => source.id === 'second window')?.visible, false)
    assert.equal(report.traces.some(ray => ray.target?.id === 'window' && !ray.hit), width > 0)
    if (!width) assert.deepEqual(report.irradiance, rgb(0))
    solver.dispose()
  }
})

test('near a room corner two visible windows retain independent influence scores', () => {
  const { data, openings } = room(1, undefined, true), solver = createSixRaySolver(data, openings)
  data.sunIrradiance = rgb(0)
  const report = solver.inspect({ index: 3, position: new Vector3(-2.8, 1.7, 2) }, new Vector3(0, 0, 1),
    { mode: 'six-rotated', primary: 6, secondary: 8 }, data)
  assert.equal(report.candidates.filter(source => source.kind === 'opening' && source.visible).length, 2)
  assert.equal(report.traces[0].target?.id, 'second window')
  assert.ok(report.traces.some(ray => ray.secondary.length === 8))
  solver.dispose()
})

test('a sealed partition blocks bright probe support one volume cell into the dark room', () => {
  const { data, openings } = room(1, 0), solver = createSixRaySolver(data, openings)
  const rectangle = (back: number, front: number) => [
    { x: -3, y: back }, { x: 3, y: back }, { x: 3, y: front }, { x: -3, y: front },
  ]
  const field = createIndirectField([{ id: 'storey', elevation: 0, height: 3, rooms: [
    { signature: 'dark', polygon: rectangle(-3, 1.45) }, { signature: 'bright', polygon: rectangle(1.55, 3) },
  ] }], 0, 1, 'legacy', false, SIX_RAY_VOLUME_RESOLUTION)
  // Give only the adjoining room unit irradiance to isolate interpolation leakage.
  for (const probe of field.probes) if (probe.position.z > 1.55) {
    for (const channel of field.coefficients) channel[probe.index * 4] = DataUtils.toHalfFloat(1 / .886227)
  }
  const lookup = createIndirectVolumeLookup(field, solver.visibility, undefined, undefined, false, 4)
  lookup.refreshCoefficients()
  const scratch = new Float64Array(12)
  for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, scratch, solver.visibility, lookup)
  const normal = new Vector3(0, 1, 0)
  const sample = (z: number) => sampleDisplayedIndirect(field, 0, new Vector3(0, 1.3, z), normal).rgb[0]
  assert.ok(sample(2.3) > .99)
  assert.equal(sample(.8), 0)
  field.dispose(); solver.dispose()
})
