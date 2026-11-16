import assert from 'node:assert/strict'
import test from 'node:test'
import { NavigationResolution } from '../src/navigationResolution.ts'

test('slow movement reduces pixel work, stopping restores full resolution, and restarting remembers the budget', () => {
  const resolution = new NavigationResolution()
  let scale = 1
  for (let i = 0; i < 36; i++) scale = resolution.sample(1 / 9, true, true)
  assert.equal(scale, .5)
  assert.equal(resolution.sample(.1, false, true), .5, 'brief input gaps do not resize the buffers')
  assert.equal(resolution.sample(.11, false, true), 1, 'stationary views regain full detail')
  assert.equal(resolution.sample(1 / 60, true, true), .5, 'the next walk starts with the known budget')
})

test('idle, preparation, and long stalls never train a lower resolution', () => {
  const resolution = new NavigationResolution()
  for (let i = 0; i < 60; i++) {
    assert.equal(resolution.sample(.2, false, true), 1)
    assert.equal(resolution.sample(.2, true, false), 1)
    assert.equal(resolution.sample(1, true, true), 1)
  }
  assert.equal(resolution.sample(1 / 60, true, true), 1)
})

test('normal navigation stays sharp and sustained headroom recovers movement detail gradually', () => {
  const resolution = new NavigationResolution()
  for (let i = 0; i < 120; i++) assert.equal(resolution.sample(1 / 60, true, true), 1)
  for (let i = 0; i < 36; i++) resolution.sample(1 / 9, true, true)
  let scale = .5
  for (let i = 0; i < 120; i++) scale = resolution.sample(1 / 60, true, true)
  assert.equal(scale, .5, 'short fast bursts do not oscillate the render size')
  for (let i = 0; i < 400; i++) scale = resolution.sample(1 / 60, true, true)
  assert.equal(scale, .6)
})
