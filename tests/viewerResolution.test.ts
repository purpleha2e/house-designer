import assert from 'node:assert/strict'
import test from 'node:test'
import { ViewerResolution } from '../src/viewer/viewerResolution.ts'

const run = (controller: ViewerResolution, fps: number, seconds: number, moving = true, ready = true) => {
  for (let i = 0; i < fps * seconds; i++) controller.sample(1 / fps, moving, ready)
  return controller.scale
}
test('sustained slow movement lowers resolution, with a bounded minimum', () => {
  const c = new ViewerResolution()
  assert.equal(run(c, 9, 1), .85)
  assert.equal(run(c, 9, 1), .85)
  assert.equal(run(c, 9, 10), .6)
  assert.equal(run(c, 9, 20), .6)
})
test('loading, idle frames, invalid samples and isolated stalls do not reduce resolution', () => {
  const c = new ViewerResolution()
  run(c, 10, 20, true, false)
  run(c, 10, 20, false)
  for (const delta of [0, -1, NaN, Infinity, 2]) c.sample(delta, true, true)
  run(c, 60, 1)
  assert.equal(c.scale, 1)
})
test('recovery needs sustained moving headroom and does not oscillate at 30–50 FPS', () => {
  const c = new ViewerResolution()
  run(c, 10, 15)
  assert.equal(run(c, 48, 20), .6)
  assert.equal(run(c, 60, 5), .6)
  assert.equal(run(c, 60, 2), .7)
  assert.equal(run(c, 60, 4), .7)
  assert.equal(run(c, 60, 30), 1)
})
