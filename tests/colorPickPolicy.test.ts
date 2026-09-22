import assert from 'node:assert/strict'
import test from 'node:test'
import { participatesInColorPick } from '../src/colorPickPolicy.ts'

test('broad room-area fallbacks cannot cover lower-storey objects in the colour pass', () => {
  assert.equal(participatesInColorPick('room-surface-area'), false)
  assert.equal(participatesInColorPick('surface'), true)
  assert.equal(participatesInColorPick('material-groups'), true)
  assert.equal(participatesInColorPick('model'), true)
  assert.equal(participatesInColorPick('roof'), true)
})
