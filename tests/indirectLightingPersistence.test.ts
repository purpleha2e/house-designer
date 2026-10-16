import assert from 'node:assert/strict'
import test from 'node:test'
import { CubeUVReflectionMapping, DataUtils, Group, SphericalHarmonics3 } from 'three'
import { createIndirectField, writeIndirectProbe } from '../src/indirectLighting.ts'
import { INDIRECT_CACHE_VERSION, indirectAssetIdentity, indirectContentKey, indirectProjectKey, loadIndirectLighting, loadIndirectReflections, saveIndirectLighting,
  savedIndirectLightingMatches, type IndirectLightingSettings } from '../src/indirectLightingPersistence.ts'
import { createIndirectVolumeLookup, writeIndirectVolumeRow } from '../src/indirectVolume.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'
import type { FloorLevel } from '../src/types.ts'

const floors = [{ id: 'ground', elevation: 0, height: 3, rooms: [{ signature: 'room',
  polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }] }]
const settings: IndirectLightingSettings = { daylight: true, lights: true, shadows: true, lightShadows: false,
  hideRoofs: false, floorSlabs: true, ambientTerm: .32, softAmbientShading: true, softAmbientStrength: 1, nightFill: true, groundPlane: true }

test('saved floor layers round-trip without changing the original probe or volume data', async () => {
  const field = createIndirectField(floors, 0)
  field.floorLayer.data.fill(DataUtils.toHalfFloat(.25)); field.floorLayer.ready = true
  const saved = await saveIndirectLighting(field, 'project', 'assets', 'geometry', settings, [])
  assert.equal(saved.floorLayer?.version, 2)
  const restored = await loadIndirectLighting(saved)
  assert.equal(restored.field.floorLayer.ready, true); assert.deepEqual(restored.field.floorLayer.data, field.floorLayer.data)
  assert.deepEqual(restored.field.coefficients, field.coefficients); assert.deepEqual(restored.field.volume.data, field.volume.data)
  await assert.rejects(loadIndirectLighting({ ...saved, floorLayer: { ...saved.floorLayer!, n: 1 } }), /floor layer/)
  const legacy = await loadIndirectLighting({ ...saved, floorLayer: { ...saved.floorLayer!, version: 1 } })
  assert.equal(legacy.field.floorLayer.ready, false, 'old floor layers are regenerated from the saved probes')
  assert.deepEqual(legacy.field.coefficients, field.coefficients); assert.deepEqual(legacy.field.volume.data, field.volume.data)
  legacy.field.dispose()
  restored.field.dispose(); field.dispose()
})

test('compressed project lighting restores the exact HDR volume, relocated probes and reflection pixels', async () => {
  const field = createIndirectField(floors, 0), sh = new SphericalHarmonics3()
  sh.coefficients[0].set(2.5, .25, .125); sh.coefficients[1].set(.2, -.05, .02)
  field.probes.forEach(probe => writeIndirectProbe(field, probe.index, sh))
  for (let i = 0; i < field.volume.data.length; i++) field.volume.data[i] = DataUtils.toHalfFloat(i % 4 === 3 ? 1 : (i % 37) / 17)
  const reflection = { room: 1, width: 336, height: 256, data: new Uint16Array(336 * 256 * 4).fill(DataUtils.toHalfFloat(1.75)) }
  const saved = await saveIndirectLighting(field, 'project', 'assets', 'geometry', settings, [reflection])
  assert.ok(JSON.stringify(saved).length < field.volume.data.byteLength / 3, 'gzip avoids embedding raw number arrays')
  const restored = await loadIndirectLighting(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(restored.field.volume.data, field.volume.data)
  assert.equal(restored.field.floorLayer.ready, false, 'legacy volume-only caches remain readable')
  assert.deepEqual(restored.field.positionData, field.positionData)
  assert.deepEqual(restored.field.mask.image.data, field.mask.image.data)
  assert.deepEqual(restored.field.coefficients, field.coefficients)
  assert.equal(restored.directCoefficients, undefined, 'older lighting still loads without first-pass data')
  const direct = field.coefficients.map(data => data.map(value => value ? DataUtils.toHalfFloat(.125) : 0))
  const zoned = await saveIndirectLighting(field, 'project', 'assets', 'geometry', settings, [], direct)
  const zonedRestored = await loadIndirectLighting(JSON.parse(JSON.stringify(zoned)))
  assert.deepEqual(zonedRestored.directCoefficients, direct, 'first-pass light survives saving independently of the final bounce')
  assert.deepEqual(zonedRestored.field.coefficients, field.coefficients)
  await assert.rejects(loadIndirectLighting({ ...zoned, directCoefficients: [] }), /Invalid saved GI/)
  zonedRestored.field.dispose()
  assert.equal(restored.field.distanceData.length, 1, 'client loading does not rebuild lamp visibility')
  assert.equal(restored.reflections[0].texture.mapping, CubeUVReflectionMapping)
  assert.equal(restored.reflections[0].texture.flipY, false)
  assert.deepEqual(restored.reflections[0].texture.image.data, reflection.data)
  const diffuse = await loadIndirectLighting(saved, { reflections: false })
  assert.equal(diffuse.reflections.length, 0)
  assert.deepEqual(diffuse.field.volume.data, restored.field.volume.data)
  const deferredReflections = await loadIndirectReflections(saved)
  assert.deepEqual(deferredReflections[0].texture.image.data, reflection.data)
  const badReflection = { ...saved, reflections: [{ ...saved.reflections[0], width: -1 }] }
  const stillDiffuse = await loadIndirectLighting(badReflection, { reflections: false })
  assert.deepEqual(stillDiffuse.field.volume.data, restored.field.volume.data, 'reflection decoding cannot block diffuse restoration')
  await assert.rejects(loadIndirectReflections(badReflection), /reflection/)
  diffuse.field.dispose(); stillDiffuse.field.dispose(); deferredReflections.forEach(value => value.dispose())
  await assert.rejects(loadIndirectLighting({ ...saved, version: 99 }), /Invalid saved GI/)
  await assert.rejects(loadIndirectLighting({ ...saved, volume: { encoding: 'base64', data: btoa('bad') } }), /length/)
  field.dispose(); restored.field.dispose(); restored.reflections.forEach(r => r.dispose())
})

test('saved GI rejects design, asset and lighting changes while remaining portable across publishing', () => {
  const project = { floors: [{ id: 'ground', name: 'Ground', elevation: 0, roomHeight: 3, walls: [], roofs: [], models: [], rooms: [], slabThickness: .2 } as FloorLevel], sunPosition: { azimuth: 1, elevation: .8 } }
  const key = indirectProjectKey(project)
  assert.equal(key, indirectProjectKey({ ...project, floors: project.floors.map(f => ({ ...f, name: 'Renamed' })) }))
  assert.notEqual(key, indirectProjectKey({ ...project, sunPosition: { azimuth: 2, elevation: .8 } }))
  assert.notEqual(key, indirectProjectKey({ ...project, floors: project.floors.map(f => ({ ...f, elevation: 1 })) }))
  const cache = { version: INDIRECT_CACHE_VERSION, projectKey: key, assetKey: 'assets', settings } as Parameters<typeof savedIndirectLightingMatches>[0]
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', settings), true)
  assert.equal(savedIndirectLightingMatches({ ...cache!, version: 1 }, key, 'assets', settings), false,
    'lighting baked before the passive-roof enclosure correction must be rebuilt')
  assert.equal(savedIndirectLightingMatches({ ...cache!, version: 2 }, key, 'assets', settings), false,
    'lighting baked with exterior-lit interior frames must be rebuilt')
  assert.equal(savedIndirectLightingMatches(cache, key, 'edited-assets', settings), false)
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, lights: false }), false)
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, lightShadows: true }), true,
    'display shadow maps do not invalidate independent captured lighting')
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, diffuseProbeResolution: 16 }), true, 'legacy bakes use 16 samples per axis')
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, diffuseProbeResolution: 4 }), false)
  const lowResolution = { ...cache!, settings: { ...settings, diffuseProbeResolution: 4 as const } }
  assert.equal(savedIndirectLightingMatches(lowResolution, key, 'assets', lowResolution.settings), true)
  assert.equal(savedIndirectLightingMatches(lowResolution, key, 'assets', settings), false)
  assert.equal(savedIndirectLightingMatches({ ...cache!, settings: { ...settings, diffuseProbeResolution: 7 } } as never, key), false)
  assert.equal(indirectContentKey({ b: 1, a: 2 }), indirectContentKey({ a: 2, b: 1 }))
  assert.deepEqual(indirectAssetIdentity({ sourceUrl: '/manufacturer-assets/a/model.glb', previewUrl: '/preview.png' }),
    indirectAssetIdentity({ sourceUrl: './published-assets/manufacturer-assets/a/model.glb' }))
  assert.equal(indirectAssetIdentity('/src/models/assets/toilet.glb'), indirectAssetIdentity('/assets/toilet-C5mqruFV.glb'))
})

test('volume previews and bounce updates reuse geometry visibility without changing lighting', () => {
  const field = createIndirectField(floors, 0), visibility = createIndirectVisibility(new Group())
  let rays = 0
  const original = visibility.occluded
  visibility.occluded = (...args) => { rays++; return original(...args) }
  const lookup = createIndirectVolumeLookup(field, visibility), result = new Float64Array(12)
  const update = (preview: boolean, strength: number) => {
    field.probes.forEach((probe, i) => {
      const sh = new SphericalHarmonics3(); sh.coefficients[0].set(strength * (i % 3), .1, .05)
      writeIndirectProbe(field, probe.index, sh); field.positionData[probe.index * 4 + 3] = preview && i > 7 ? 0 : 1
    })
    lookup.refreshCoefficients()
    for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, result, visibility, lookup)
    const cached = field.volume.data.slice(), cachedRays = rays
    for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, result, visibility)
    for (let i = 0; i < cached.length; i++) assert.ok(Math.abs(DataUtils.fromHalfFloat(cached[i]) - DataUtils.fromHalfFloat(field.volume.data[i])) < .002)
    return cachedRays
  }
  update(true, .25)
  const before = rays
  assert.ok(update(false, .5) > before, 'the first preview defers rays to uncaptured probes')
  const fullPassRays = rays
  assert.equal(update(false, .75), fullPassRays, 'second bounce performs no new visibility rays')
  field.dispose(); visibility.dispose()
})
