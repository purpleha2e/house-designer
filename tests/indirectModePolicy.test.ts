import assert from 'node:assert/strict'
import test from 'node:test'
import { createIndirectModePolicy } from '../src/indirectModePolicy.ts'

test('selecting modelling preserves a completed legacy bake and switching back does not rebake it', () => {
  const policy = createIndirectModePolicy()
  assert.deepEqual(policy.update(false, 'house-a', false), { suspend: false, invalidate: false, resume: false })
  assert.deepEqual(policy.update(true, 'house-a', false), { suspend: true, invalidate: false, resume: false })
  for (let frame = 0; frame < 100; frame++) assert.deepEqual(policy.update(true, 'house-a', false), { suspend: false, invalidate: false, resume: false })
  assert.deepEqual(policy.update(false, 'house-a', false), { suspend: false, invalidate: false, resume: false })
})

test('a drag while modelling coalesces legacy invalidation and schedules one update only on return', () => {
  const policy = createIndirectModePolicy()
  policy.update(false, 'house-a', false)
  policy.update(true, 'house-a', false)
  assert.equal(policy.update(true, 'wall-position-1', false).invalidate, true)
  for (let edit = 2; edit < 100; edit++) {
    assert.deepEqual(policy.update(true, `wall-position-${edit}`, false), { suspend: false, invalidate: false, resume: false })
    assert.equal(policy.defer(), false)
  }
  assert.equal(policy.dirty, true)
  assert.equal(policy.update(false, 'wall-position-99', false).resume, true)
  assert.equal(policy.update(false, 'wall-position-99', false).resume, false)
})

test('in-flight legacy work cancels once on entry and resumes once without a fake authored change', () => {
  const policy = createIndirectModePolicy()
  policy.update(false, 'house-a', true)
  assert.deepEqual(policy.update(true, 'house-a', true), { suspend: true, invalidate: false, resume: false })
  assert.equal(policy.dirty, false)
  assert.deepEqual(policy.update(true, 'house-a', true), { suspend: false, invalidate: false, resume: false })
  assert.equal(policy.update(false, 'house-a', false).resume, true)
})

test('imperative lamp edits invalidate once while cold modelling never starts the legacy solver', () => {
  const policy = createIndirectModePolicy()
  assert.deepEqual(policy.update(true, 'new-house', true), { suspend: true, invalidate: false, resume: false })
  assert.equal(policy.defer(), true)
  assert.equal(policy.defer(), false)
  assert.equal(policy.update(true, 'new-house', false).resume, false)
  assert.equal(policy.update(false, 'new-house', false).resume, true)
})

test('cold modelling keeps a loaded cache valid until an actual edit', () => {
  const policy = createIndirectModePolicy()
  assert.equal(policy.update(true, 'saved-house', true).invalidate, false)
  for (let render = 0; render < 10; render++) {
    assert.deepEqual(policy.update(true, 'saved-house', false), { suspend: false, invalidate: false, resume: false })
  }
  assert.equal(policy.dirty, false)
  assert.equal(policy.update(false, 'saved-house', false).resume, true)
  for (let toggle = 0; toggle < 10; toggle++) {
    assert.deepEqual(policy.update(true, 'saved-house', false), { suspend: true, invalidate: false, resume: false })
    assert.deepEqual(policy.update(false, 'saved-house', false), { suspend: false, invalidate: false, resume: false })
  }
})

test('repeated interrupted jobs and later edits do not carry stale invalidation between mode sessions', () => {
  const policy = createIndirectModePolicy()
  policy.update(false, 'house-a', true)
  for (let toggle = 0; toggle < 10; toggle++) {
    assert.deepEqual(policy.update(true, 'house-a', true), { suspend: true, invalidate: false, resume: false })
    assert.equal(policy.update(false, 'house-a', false).resume, true)
    assert.equal(policy.update(false, 'house-a', false).resume, false)
  }
  policy.update(true, 'house-a', false)
  assert.equal(policy.update(true, 'house-b', false).invalidate, true)
  assert.equal(policy.update(false, 'house-b', false).resume, true)
  assert.deepEqual(policy.update(true, 'house-b', false), { suspend: true, invalidate: false, resume: false })
  assert.equal(policy.defer(), true)
  assert.equal(policy.defer(), false)
})
