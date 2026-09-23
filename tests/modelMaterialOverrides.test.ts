import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getModelMaterialOverrideId,
  getModelMaterialRegion,
} from '../src/modelMaterialOverrides.ts'

const regions = [
  {
    id: 'stairs_steps',
    label: 'Steps',
    sourceMaterialNames: ['stairs_steps'],
  },
  {
    id: 'stairs_woodwork',
    label: 'Wood',
    sourceMaterialNames: [
      'stairs_woodwork',
      'stairs_banister',
      'stairs_spindles',
    ],
  },
]

test('maps exported stair materials to their semantic region', () => {
  assert.equal(getModelMaterialRegion(regions, 'stairs_steps')?.id, 'stairs_steps')
  assert.equal(
    getModelMaterialRegion(regions, 'stairs_banister')?.id,
    'stairs_woodwork',
  )
  assert.equal(getModelMaterialRegion(regions, 'unassigned'), undefined)
})

test('uses one wood override for woodwork, banister, and spindles', () => {
  const overrides = {
    stairs_steps: 'carpet',
    stairs_woodwork: 'oak',
  }

  assert.equal(
    getModelMaterialOverrideId(overrides, regions, 'stairs_steps'),
    'carpet',
  )
  assert.equal(
    getModelMaterialOverrideId(overrides, regions, 'stairs_spindles'),
    'oak',
  )
  assert.equal(
    getModelMaterialOverrideId(overrides, regions, 'steps_spindles'),
    undefined,
  )
})
