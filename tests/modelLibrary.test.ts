import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getModelLibrarySection,
  isOpeningModel,
} from '../src/models/modelLibrarySections.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

const definition = (
  overrides: Partial<ModelDefinition> = {},
): ModelDefinition => ({
  category: 'Test',
  color: '#000000',
  depth: 1,
  height: 1,
  id: 'test-model',
  name: 'Test model',
  shape: 'box',
  width: 1,
  ...overrides,
})

test('wall-mounted windows and doors are collected into the openings section', () => {
  for (const wallMount of [
    'window',
    'exterior-door',
    'interior-door',
    'patio-door',
  ] as const) {
    const model = definition({ wallMount })
    assert.equal(isOpeningModel(model), true)
    assert.equal(getModelLibrarySection(model), 'openings')
  }
})

test('roof-mounted dormer windows are collected into the openings section', () => {
  const model = definition({
    objectType: 'dormer-window',
    roofMount: 'dormer',
  })
  assert.equal(isOpeningModel(model), true)
  assert.equal(getModelLibrarySection(model), 'openings')
})

test('uploaded opening metadata is classified even before mount behavior is set', () => {
  assert.equal(
    getModelLibrarySection(definition({ objectType: 'window' })),
    'openings',
  )
  assert.equal(
    getModelLibrarySection(definition({ objectType: 'exterior-door' })),
    'openings',
  )
})

test('ordinary models remain in the objects section', () => {
  assert.equal(
    getModelLibrarySection(definition({ objectType: 'furniture' })),
    'objects',
  )
})
