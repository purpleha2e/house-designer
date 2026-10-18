import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalLightControl } from '../src/localLightControl.ts'

test('direct lamp controls notify installed views synchronously and remain isolated between editors', () => {
  const first = createLocalLightControl(), second = createLocalLightControl(), updates: boolean[] = []
  const remove = first.subscribe('lamp', enabled => updates.push(enabled))
  let other = 0
  first.subscribe('other-lamp', () => other++)
  second.subscribe('lamp', () => other++)
  first.setEnabled('lamp', false); assert.deepEqual(updates, [false]); assert.equal(other, 0)
  first.setEnabled('lamp', true); assert.deepEqual(updates, [false, true])
  remove(); first.setEnabled('lamp', false); assert.deepEqual(updates, [false, true])
  first.subscribe('lamp', enabled => updates.push(enabled))
  remove(); first.setEnabled('lamp', false)
  assert.deepEqual(updates, [false, true, false], 'old cleanup cannot disconnect a replacement lamp binding')
})
