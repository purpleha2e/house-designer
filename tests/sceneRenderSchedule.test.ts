import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRenderSceneFrame } from '../src/sceneRenderSchedule.ts'

test('static GI work shares the GPU without redrawing the same display each capture frame', () => {
  for (const status of [{ state: 'refining' }, { preparing: true }, { warming: true }, { reading: true }, { volumePending: true }]) {
    assert.equal(shouldRenderSceneFrame(50, 0, false, false, status), false)
    assert.equal(shouldRenderSceneFrame(100, 0, false, false, status), false)
    assert.equal(shouldRenderSceneFrame(1000, 0, false, false, status), true)
    assert.equal(shouldRenderSceneFrame(10, 0, true, false, status), true)
    assert.equal(shouldRenderSceneFrame(10, 0, false, true, status), true)
  }
})

test('navigation, normal rendering, disabled and completed GI retain normal display frames', () => {
  for (const status of [undefined, { state: 'ready' }, { state: 'fallback' },
    { state: 'refining', enabled: false }, { state: 'refining', diffuseEnabled: false }, { state: 'refining', paused: true }]) {
    assert.equal(shouldRenderSceneFrame(10, 0, false, false, status), true)
  }
})

test('pending cutouts retain the previous frame while navigation and dragging remain live', () => {
  assert.equal(shouldRenderSceneFrame(1000, 0, false, false, { state: 'ready' }, true), false)
  assert.equal(shouldRenderSceneFrame(1000, 0, true, false, { state: 'ready' }, true), true)
  assert.equal(shouldRenderSceneFrame(1000, 0, false, true, { state: 'ready' }, true), true)
  assert.equal(shouldRenderSceneFrame(1000, 0, false, false, { preparing: true }, false), true)
})

test('a settled tour rests while idle and immediately draws changes or unfinished lighting', () => {
  for (const status of [{ state: 'ready' }, { state: 'fallback' }, { enabled: false }]) {
    assert.equal(shouldRenderSceneFrame(60000, 0, false, false, status, false, true), false)
    assert.equal(shouldRenderSceneFrame(1, 0, true, false, status, false, true), true)
    assert.equal(shouldRenderSceneFrame(1, 0, false, true, status, false, true), true)
    assert.equal(shouldRenderSceneFrame(1, 0, false, false, status), true, 'editor behavior is unchanged')
  }
  assert.equal(shouldRenderSceneFrame(1000, 0, false, false, { state: 'loading' }, false, true), true)
})
