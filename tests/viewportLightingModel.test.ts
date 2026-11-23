import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialViewportLightingModel, normalizeViewportLightingModel } from '../src/viewportLightingModel.ts'

test('the normal editor starts in Design', () => {
  assert.equal(initialViewportLightingModel(false, false, undefined), 'design')
  assert.equal(initialViewportLightingModel(false, false, new URLSearchParams('lightingDiagnostics')), 'design')
  assert.equal(normalizeViewportLightingModel('unrecognised'), 'design')
})

test('the published viewer and explicit developer diagnostics keep their existing paths', () => {
  assert.equal(initialViewportLightingModel(true, false, undefined), 'existing')
  assert.equal(initialViewportLightingModel(false, true, undefined), 'existing')
  assert.equal(initialViewportLightingModel(false, false, new URLSearchParams('giBackend=lumen')), 'existing')
  assert.equal(initialViewportLightingModel(false, false, new URLSearchParams('lightingModel=modelling')), 'modelling')
})
