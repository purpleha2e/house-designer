import assert from 'node:assert/strict'
import test from 'node:test'
import { housePrototypeDaylight } from '../src/lightingLab/housePreferences.ts'

test('new house lab opens with prototype daylight and reuses an explicit saved choice', () => {
  assert.equal(housePrototypeDaylight(new URLSearchParams('house=1'), null), true)
  assert.equal(housePrototypeDaylight(new URLSearchParams('house=1'), '1'), true)
  assert.equal(housePrototypeDaylight(new URLSearchParams('house=1'), '0'), false)
  assert.equal(housePrototypeDaylight(new URLSearchParams('house=1'), 'invalid'), true)
})
test('comparison links override the remembered daylight choice', () => {
  assert.equal(housePrototypeDaylight(new URLSearchParams('prototypeDaylight=0'), '1'), false)
  assert.equal(housePrototypeDaylight(new URLSearchParams('prototypeDaylight=1'), '0'), true)
})
