import assert from 'node:assert/strict'
import test from 'node:test'
import { createIndirectBakePolicy } from '../src/indirectBakePolicy.ts'

test('load, edits and undo never request a manual bake; explicit requests bind to current input', () => {
  const policy = createIndirectBakePolicy()
  assert.equal(policy.update('house', 0, false), false)
  assert.equal(policy.update('window moved', 0, false), false)
  assert.equal(policy.update('window moved', 1, false), true)
  assert.equal(policy.update('window moved', 1, false), true)
  assert.equal(policy.update('window moved again', 1, false), false)
  assert.equal(policy.update('window moved', 1, false), false, 'undo cannot restart cancelled work')
  assert.equal(policy.update('window moved', 2, false), true)
  policy.cancel()
  assert.equal(policy.update('window moved', 2, false), false, 'live geometry cancels a bake before React commits its new input')
  assert.equal(policy.update('window moved', 3, false), true)
})

test('automatic regressions and published caches preserve their existing behavior', () => {
  const policy = createIndirectBakePolicy()
  assert.equal(policy.update('house', 0, true), true)
  assert.equal(policy.update('edited', 0, true), true)
  assert.equal(policy.update('edited', 0, false), false)
})
