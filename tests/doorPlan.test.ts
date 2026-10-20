import assert from 'node:assert/strict'
import test from 'node:test'
import { getDoorLeafCount } from '../src/doorPlan.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

const door: ModelDefinition = {
  id: 'internal-door', name: 'Internal door', wallMount: 'interior-door',
  category: 'Doors', color: '#334155', shape: 'box', width: 0.9, height: 2.1, depth: 0.1,
}

test('explicit leaf metadata takes priority over the model name, type and width', () => {
  assert.equal(getDoorLeafCount({ ...door, doorLeafCount: 2 }), 2)
  assert.equal(getDoorLeafCount({ ...door, name: 'Double French doors', wallMount: 'patio-door', doorLeafCount: 1 }), 1)
  assert.equal(getDoorLeafCount({ ...door, width: 3 }), 1)
})

test('older saved and uploaded double doors retain two leaves without a project migration', () => {
  assert.equal(getDoorLeafCount({ ...door, id: 'portal-model-legacy', name: 'Interior double doors open' }), 2)
  assert.equal(getDoorLeafCount({ ...door, id: 'panel-interior-double-doors-full-open-low-detail' }), 2)
  assert.equal(getDoorLeafCount({ ...door, name: 'French doors' }), 2)
  assert.equal(getDoorLeafCount({ ...door, wallMount: 'patio-door' }), 2)
})
