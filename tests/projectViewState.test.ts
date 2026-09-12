import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_FLOORS_VIEW_ID,
  DEFAULT_FLOORPLAN_VIEWPORT,
  DEFAULT_THREE_D_CAMERA_STATE,
  normalizeSavedThreeDViewState,
  normalizeSavedTwoDViewState,
} from '../src/projectViewState.ts'

test('older projects default to the active floor and original camera', () => {
  assert.deepEqual(
    normalizeSavedThreeDViewState(undefined, ['ground'], 'ground'),
    { camera: DEFAULT_THREE_D_CAMERA_STATE, floorViewId: 'ground' },
  )
})

test('restores all-floors view and normalizes the saved camera orientation', () => {
  const state = normalizeSavedThreeDViewState({
    floorViewId: ALL_FLOORS_VIEW_ID,
    camera: {
      position: { x: 12, y: 7, z: -4 },
      quaternion: { w: 2, x: 0, y: 2, z: 0 },
    },
  }, ['ground', 'first'], 'first')
  assert.deepEqual(state.camera.position, { x: 12, y: 7, z: -4 })
  assert.ok(Math.abs(state.camera.quaternion.w - Math.SQRT1_2) < 1e-12)
  assert.ok(Math.abs(state.camera.quaternion.y - Math.SQRT1_2) < 1e-12)
  assert.equal(state.floorViewId, ALL_FLOORS_VIEW_ID)
})

test('rejects stale floor ids and non-finite camera values', () => {
  const state = normalizeSavedThreeDViewState({
    floorViewId: 'deleted',
    camera: {
      position: { x: Number.NaN, y: 1, z: 2 },
      quaternion: { w: 1, x: 0, y: 0, z: 0 },
    },
  }, ['ground'], 'ground')
  assert.deepEqual(state, {
    camera: DEFAULT_THREE_D_CAMERA_STATE,
    floorViewId: 'ground',
  })
})

test('restores independent 2D pan and zoom values for each current floor', () => {
  assert.deepEqual(normalizeSavedTwoDViewState({
    viewportsByFloorId: {
      ground: { scale: 1.8, x: -320, y: 45 },
      first: { scale: 0.7, x: 120, y: -80 },
      deleted: { scale: 2, x: 1, y: 2 },
    },
  }, ['ground', 'first']), {
    viewportsByFloorId: {
      ground: { scale: 1.8, x: -320, y: 45 },
      first: { scale: 0.7, x: 120, y: -80 },
    },
  })
})

test('older projects and invalid 2D viewports use the default view', () => {
  assert.deepEqual(normalizeSavedTwoDViewState({
    viewportsByFloorId: {
      ground: { scale: 0, x: Number.NaN, y: 4 },
    },
  }, ['ground', 'first']), {
    viewportsByFloorId: {
      ground: DEFAULT_FLOORPLAN_VIEWPORT,
      first: DEFAULT_FLOORPLAN_VIEWPORT,
    },
  })
})
