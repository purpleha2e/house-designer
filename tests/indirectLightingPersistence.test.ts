import assert from 'node:assert/strict'
import test from 'node:test'
import { CubeUVReflectionMapping, DataUtils, Group, SphericalHarmonics3 } from 'three'
import { createIndirectField, writeIndirectProbe } from '../src/indirectLighting.ts'
import { INDIRECT_CACHE_VERSION, INDIRECT_CAPTURE_VISIBILITY_VERSION, indirectAssetIdentity, indirectContentKey, indirectProjectKey, loadIndirectLighting, loadIndirectReflections, saveIndirectLighting,
  savedIndirectLightingMatches, legacyIndirectLightingMatches, type IndirectLightingSettings } from '../src/indirectLightingPersistence.ts'
import { createIndirectVolumeLookup, writeIndirectVolumeRow } from '../src/indirectVolume.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'
import type { FloorLevel } from '../src/types.ts'

const floors = [{ id: 'ground', elevation: 0, height: 3, rooms: [{ signature: 'room',
  polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }] }]
const settings: IndirectLightingSettings = { daylight: true, lights: true, shadows: true, lightShadows: false,
  hideRoofs: false, floorSlabs: true, ambientTerm: .32, softAmbientShading: true, softAmbientStrength: 1, nightFill: true, groundPlane: true }

test('camera-dependent captures stay display-compatible but require a fresh direct baseline',async()=>{
  const field=createIndirectField(floors),saved=await saveIndirectLighting(field,'project','assets','geometry',settings,[])
  const previous={...saved,captureVisibilityVersion:undefined}
  assert.equal(saved.captureVisibilityVersion,INDIRECT_CAPTURE_VISIBILITY_VERSION)
  assert.equal(savedIndirectLightingMatches(previous,'project','assets',settings),false)
  assert.equal(legacyIndirectLightingMatches(previous,'project','assets',settings),true)
  const restored=await loadIndirectLighting(previous,{allowLegacy:true})
  try{assert.deepEqual(restored.field.coefficients,field.coefficients);assert.deepEqual(restored.field.volume.data,field.volume.data)}finally{field.dispose();restored.field.dispose()}
})

test('bakes missing exterior roof sky require recapture while their display remains loadable',async()=>{
  const field=createIndirectField(floors),saved=await saveIndirectLighting(field,'project','assets','geometry',settings,[])
  const previous={...saved,captureVisibilityVersion:1}
  try{
    assert.equal(savedIndirectLightingMatches(saved,'project','assets',settings),true)
    assert.equal(savedIndirectLightingMatches(previous,'project','assets',settings),false)
    assert.equal(legacyIndirectLightingMatches(previous,'project','assets',settings),true)
    await assert.rejects(loadIndirectLighting(previous),/Invalid saved GI/)
    const display=await loadIndirectLighting(previous,{allowLegacy:true})
    try{assert.deepEqual(display.field.coefficients,field.coefficients)}finally{display.field.dispose()}
  }finally{field.dispose()}
})

test('L2 cache preserves every signed band and cannot be interpreted as L1', async () => {
  const field = createIndirectField(floors, 0, 2), sh = new SphericalHarmonics3()
  sh.coefficients.forEach((c, i) => c.set(.1 * i, -.03 * i, .2 - i * .02))
  field.probes.forEach(p => writeIndirectProbe(field, p.index, sh))
  field.volume.data.fill(DataUtils.toHalfFloat(.3))
  field.floorLayer.data.fill(DataUtils.toHalfFloat(.7)); field.floorLayer.ready = true
  const saved = await saveIndirectLighting(field, 'project', 'assets', 'geometry', settings, [], field.coefficients, field.coefficients)
  const restored = await loadIndirectLighting(saved)
  try {
    assert.equal(saved.version, 10); assert.equal(restored.field.shOrder, 2)
    assert.deepEqual(restored.field.coefficients, field.coefficients)
    assert.deepEqual(restored.directCoefficients, field.coefficients)
    assert.deepEqual(restored.skyCoefficients, field.coefficients)
    assert.deepEqual(restored.field.volume.data, field.volume.data)
    assert.deepEqual(restored.field.floorLayer.data, field.floorLayer.data)
    assert.equal(savedIndirectLightingMatches(saved, 'project', 'assets', settings), false)
    assert.equal(savedIndirectLightingMatches(saved, 'project', 'assets', {...settings, shOrder: 2}), true)
    const previous = await loadIndirectLighting({ ...saved, version: 8 }, { allowLegacy: true })
    assert.deepEqual(previous.field.coefficients, field.coefficients); previous.field.dispose()
    assert.equal(savedIndirectLightingMatches({ ...saved, version: 8 }, 'project', 'assets', {...settings, shOrder: 2}), false)
    await assert.rejects(loadIndirectLighting({...saved, version: 5}), /Invalid saved GI/)
    await assert.rejects(loadIndirectLighting({...saved, layout: {...saved.layout, shOrder: 1}}), /Invalid saved GI/)
  } finally { field.dispose(); restored.field.dispose() }
})

test('separated sky irradiance survives saving and old transport can be retained explicitly',async()=>{
  const field=createIndirectField(floors),sky=field.coefficients.map(data=>data.slice());sky[0][4]=DataUtils.toHalfFloat(.37)
  const saved=await saveIndirectLighting(field,'project','assets','geometry',settings,[],undefined,sky),loaded=await loadIndirectLighting(saved)
  assert.deepEqual(loaded.skyCoefficients,sky)
  await assert.rejects(loadIndirectLighting({...saved,skyCoefficients:[]}),/Invalid saved GI/)
  await assert.rejects(loadIndirectLighting({...saved,version:4}),/Invalid saved GI/)
  const old=await loadIndirectLighting({...saved,version:4},{allowLegacy:true});assert.deepEqual(old.field.volume.data,field.volume.data)
  const previous=await loadIndirectLighting({...saved,version:5},{allowLegacy:true})
  assert.deepEqual(previous.field.volume.data,field.volume.data);previous.field.dispose()
  assert.equal(savedIndirectLightingMatches({...saved,version:5},'project','assets',settings),false)
  assert.equal(savedIndirectLightingMatches({...saved,version:4},'project','assets',settings),false)
  const batched = await loadIndirectLighting({...saved,version:7},{allowLegacy:true})
  assert.deepEqual(batched.field.volume.data,field.volume.data);batched.field.dispose()
  assert.equal(savedIndirectLightingMatches({...saved,version:7},'project','assets',settings),false)
  field.dispose();loaded.field.dispose();old.field.dispose()
})

test('saved floor layers round-trip without changing the original probe or volume data', async () => {
  const field = createIndirectField(floors, 0)
  field.floorLayer.data.fill(DataUtils.toHalfFloat(.25)); field.floorLayer.ready = true
  const saved = await saveIndirectLighting(field, 'project', 'assets', 'geometry', settings, [])
  assert.equal(saved.floorLayer?.version, 2)
  const restored = await loadIndirectLighting(saved)
  assert.equal(restored.field.volumeSamplingVersion, 1)
  assert.equal(restored.field.floorLayer.ready, true); assert.deepEqual(restored.field.floorLayer.data, field.floorLayer.data)
  assert.deepEqual(restored.field.coefficients, field.coefficients); assert.deepEqual(restored.field.volume.data, field.volume.data)
  await assert.rejects(loadIndirectLighting({ ...saved, floorLayer: { ...saved.floorLayer!, n: 1 } }), /floor layer/)
  const legacy = await loadIndirectLighting({ ...saved, floorLayer: { ...saved.floorLayer!, version: 1 } })
  assert.equal(legacy.field.floorLayer.ready, false, 'old floor layers are regenerated from the saved probes')
  assert.deepEqual(legacy.field.coefficients, field.coefficients); assert.deepEqual(legacy.field.volume.data, field.volume.data)
  legacy.field.dispose()
  const oldLayout = { ...saved.layout }; delete oldLayout.volumeSamplingVersion
  const oldVolume = await loadIndirectLighting({ ...saved, layout: oldLayout })
  assert.equal(oldVolume.field.volumeSamplingVersion, 0, 'legacy volumes can be refined from their saved probes without recapture')
  assert.deepEqual(oldVolume.field.coefficients, field.coefficients)
  oldVolume.field.dispose()
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
  const cache = { version: INDIRECT_CACHE_VERSION, captureVisibilityVersion: INDIRECT_CAPTURE_VISIBILITY_VERSION, projectKey: key, assetKey: 'assets', settings } as Parameters<typeof savedIndirectLightingMatches>[0]
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', settings), true)
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, daylightBounceStrength: 1 }), true,
    'legacy daylight bakes use the default strength')
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, daylightBounceStrength: 2 }), false,
    'changing daylight strength invalidates captured lighting')
  const boosted = { ...cache!, settings: { ...settings, daylightBounceStrength: 2 } }
  assert.equal(savedIndirectLightingMatches(boosted, key, 'assets', boosted.settings), true)
  for (const daylightBounceStrength of [-1, 5, NaN, Infinity]) {
    assert.equal(savedIndirectLightingMatches({ ...cache!, settings: { ...settings, daylightBounceStrength } }, key), false)
  }
  assert.equal(savedIndirectLightingMatches({ ...cache!, version: 1 }, key, 'assets', settings), false,
    'lighting baked before the passive-roof enclosure correction must be rebuilt')
  assert.equal(savedIndirectLightingMatches({ ...cache!, version: 2 }, key, 'assets', settings), false,
    'lighting baked with exterior-lit interior frames must be rebuilt')
  assert.equal(savedIndirectLightingMatches({ ...cache!, version: 3 }, key, 'assets', settings), false,
    'lighting baked with probes pushed out of stair air must be rebuilt')
  assert.equal(savedIndirectLightingMatches(cache, key, 'edited-assets', settings), false)
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, lights: false }), false)
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, lightShadows: true }), true,
    'display shadow maps do not invalidate independent captured lighting')
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, nightAmbientTerm: settings.ambientTerm }), true,
    'legacy enabled Night fill uses the saved ambient level')
  assert.equal(savedIndirectLightingMatches(cache, key, 'assets', { ...settings, nightAmbientTerm: .03 }), false,
    'a changed night level prepares the corresponding lighting')
  const current = { ...settings, nightFill: undefined, nightAmbientTerm: .07 }
  const currentCache = { ...cache!, settings: current }
  assert.equal(savedIndirectLightingMatches(currentCache, key, 'assets', current), true,
    'current saved models do not require the removed Night fill flag')
  for (const nightFill of [false, true]) {
    assert.equal(savedIndirectLightingMatches(currentCache, key, 'assets', { ...current, nightFill }), true,
      'an explicit night ambient level is independent of a legacy toggle')
  }
  for (const nightAmbientTerm of [-1, .86, NaN, Infinity]) {
    assert.equal(savedIndirectLightingMatches({ ...cache!, settings: { ...settings, nightAmbientTerm } }, key), false)
  }
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


test('sky intensity has an independent persistent cache identity with legacy default one', async () => {
 const field=createIndirectField(floors)
 try {
  const original=await saveIndirectLighting(field,'sky-project','assets','geometry',{...settings,skyStrength:1},[])
  assert.equal(savedIndirectLightingMatches(original,'sky-project','assets',settings),true)
  for(const skyStrength of [0,.5,1.5,2,3]) {
   assert.equal(savedIndirectLightingMatches(original,'sky-project','assets',{...settings,skyStrength}),false)
   const saved=await saveIndirectLighting(field,'sky-project','assets','geometry',{...settings,skyStrength},[])
   assert.equal(savedIndirectLightingMatches(saved,'sky-project','assets',{...settings,skyStrength}),true)
   const loaded=await loadIndirectLighting(saved);assert.deepEqual(loaded.field.coefficients,field.coefficients);loaded.field.dispose()
  }
 } finally {field.dispose()}
})
