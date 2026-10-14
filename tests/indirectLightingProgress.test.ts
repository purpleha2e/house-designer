import assert from 'node:assert/strict'
import test from 'node:test'
import { Group, SphericalHarmonics3 } from 'three'
import { createIndirectField, writeIndirectProbe } from '../src/indirectLighting.ts'
import { formatIndirectLightingEngineStatus, formatIndirectLightingProgress } from '../src/indirectLightingProgress.ts'
import { indirectPreviewCoefficients } from '../src/indirectLivePreview.ts'
import { sampleIndirectCoefficients } from '../src/indirectVolume.ts'
import { createIndirectVisibility } from '../src/indirectVisibility.ts'

test('startup previews exclude uncaptured probes without darkening captured illumination', () => {
  const field = createIndirectField([{ id: 'ground', elevation: 0, height: 3, rooms: [{ signature: 'room',
    polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] }] }])
  const originalPositions = field.positionData
  const captured = field.probes[0], sh = new SphericalHarmonics3()
  sh.coefficients[0].set(.5, .25, .125)
  writeIndirectProbe(field, captured.index, sh)
  const preview = indirectPreviewCoefficients(field, new Set([captured.index]), 1).positions
  assert.equal(originalPositions[field.probes[1].index * 4 + 3], 1)
  assert.equal(preview[field.probes[1].index * 4 + 3], 0)
  assert.equal(preview[captured.index * 4 + 3], 1)
  const visibility = createIndirectVisibility(new Group()), result = new Float64Array(12)
  field.positionData = preview
  assert.ok(sampleIndirectCoefficients(field, 0, captured.position.x, captured.position.y, captured.position.z, result, visibility) > 0)
  assert.deepEqual([result[0], result[4], result[8]], [.5, .25, .125])
  // A measured black probe still has support, unlike an uncaptured probe.
  writeIndirectProbe(field, captured.index, new SphericalHarmonics3())
  assert.ok(sampleIndirectCoefficients(field, 0, captured.position.x, captured.position.y, captured.position.z, result, visibility) > 0)
  assert.deepEqual([...result], Array(12).fill(0))
  visibility.dispose(); field.dispose()
})

test('lighting progress distinguishes preparation, paused captures, refinement and completion', () => {
  assert.equal(formatIndirectLightingProgress(), 'GI preparing')
  assert.equal(formatIndirectLightingProgress({ state: 'preparing', total: 565 }), 'GI preparing')
  assert.equal(formatIndirectLightingProgress({ state: 'refining', total: 565, completed: 8 }), 'GI building 1%')
  assert.equal(formatIndirectLightingProgress({ state: 'refining', total: 565, completed: 8, displayed: true, paused: true }), 'GI refining 1% (paused)')
  assert.equal(formatIndirectLightingProgress({ state: 'ready', total: 4, completed: 4, volumePending: true }), 'GI building 99%')
  assert.equal(formatIndirectLightingProgress({ state: 'ready' }), 'GI ready')
  assert.equal(formatIndirectLightingProgress({ enabled: false }), 'GI off')
  assert.equal(formatIndirectLightingProgress({ state: 'fallback' }), 'GI unavailable')
})

test('engine lighting status identifies the current work and retained lighting', () => {
  const status = { state: 'refining', probes: 274, total: 565, completed: 8, capturedProbes: 8, pass: 1, face: 2 }
  assert.equal(formatIndirectLightingEngineStatus(status), 'GI bounce 1 · 8/274 probes · face 3/6 · 1%')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, pass: 2, completed: 280, displayed: true }),
    'GI bounce 2 · 6/274 probes · face 3/6 · 49% · cached light displayed')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, paused: true, displayed: true }),
    'GI paused for navigation / input · 1% · cached light displayed')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, warming: true }), 'GI preparing capture shaders')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, volumePending: true }), 'GI building irradiance volume · 1%')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, preparing: true }), 'GI placing probes and checking visibility')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, preparing: true, prepareStage: 'lamps' }), 'GI checking lamp visibility')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, preparing: true, prepareStage: 'geometry' }), 'GI indexing scene geometry')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, reading: true }), 'GI bounce 1 · 8/274 probes · reading light · 1%')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, reflection: true, rooms: 17, reflections: 4 }), 'GI capturing reflections · 4/17 · 1%')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, blocked: true }), 'GI waiting for scene preparation or editing')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, xr: true }), 'GI paused during VR')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, state: 'ready', reflections: 17 }), 'GI ready · 274 probes · 17 reflections')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, state: 'ready', reflections: 17, blocked: true }), 'GI ready · 274 probes · 17 reflections',
    'selection preparation does not claim the completed bake is waiting to run')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, enabled: false, blocked: true }), 'GI off')
  assert.equal(formatIndirectLightingEngineStatus({ ...status, state: 'fallback' }), 'GI unavailable')
})

test('regional progress counts recaptures separately from retained probes', () => {
  const status = { state: 'refining', probes: 60, firstProbes: 18, secondProbes: 20, partial: true,
    zones: 2, reusedProbes: 40, capturedProbes: 60, total: 40, completed: 20, pass: 2, face: 0 }
  assert.match(formatIndirectLightingEngineStatus(status), /bounce 2 · 2\/20 probes/)
  assert.match(formatIndirectLightingEngineStatus(status), /2 zones · 40 probes reused/)
  assert.match(formatIndirectLightingEngineStatus({ ...status, pass: 1, completed: 3 }), /bounce 1 · 3\/18 probes/)
})
