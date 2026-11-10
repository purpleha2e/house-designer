import test from 'node:test'
import assert from 'node:assert/strict'
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { applyCameraLook } from '../src/cameraLook.ts'
import { createGamepadNavigation } from '../src/gamepadNavigation.ts'

test('first look after quaternion restoration preserves heading across every quadrant', () => {
  for (const yaw of [-2.9, -2, -.7, .7, 2, 2.9]) for (const pitch of [-.6, 0, .6]) {
    const camera = new PerspectiveCamera()
    camera.quaternion.setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'))
    assert.equal(camera.rotation.order, 'XYZ')
    applyCameraLook(camera, .003, -.002, Math.PI / 2 - .05)
    const expected = new Quaternion().setFromEuler(new Euler(pitch - .002, yaw + .003, 0, 'YXZ'))
    assert.ok(camera.quaternion.angleTo(expected) < 1e-7)
  }
})

test('gamepad translation after loading never rotates the saved camera', () => {
  const camera = new PerspectiveCamera()
  camera.quaternion.setFromEuler(new Euler(-.3, 2.4, 0, 'YXZ'))
  const before = camera.quaternion.clone(), forward = camera.getWorldDirection(new Vector3())
  createGamepadNavigation()(camera, { moveX: 0, moveY: -1, lookX: 0, lookY: 0 }, .016,
    { walk: false, speed: 2, headHeight: 1.7 })
  assert.ok(camera.quaternion.angleTo(before) < 1e-7)
  assert.ok(camera.position.distanceTo(forward.multiplyScalar(.032)) < 1e-7)
})

test('look retains pitch limits after converting the saved orientation', () => {
  const camera = new PerspectiveCamera()
  camera.quaternion.setFromEuler(new Euler(.5, 2.4, 0, 'YXZ'))
  applyCameraLook(camera, 0, 5, 1.4)
  assert.equal(camera.rotation.x, 1.4)
})
