import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera } from 'three'
import { createGamepadNavigation, getGamepadNavigationInput, type NavigationGamepad } from '../src/gamepadNavigation.ts'

const pad = (axes: number[], overrides: Partial<NavigationGamepad> = {}): NavigationGamepad =>
  ({ connected: true, mapping: 'standard', axes, ...overrides })
const options = { walk: true, headHeight: 1.8, speed: 2.4 }

test('standard sticks ignore drift, sparse slots, disconnected pads and XR mappings', () => {
  assert.equal(getGamepadNavigationInput([null, pad([.1, -.1, .05, 0])]), null)
  assert.equal(getGamepadNavigationInput([pad([1, 0, 0, 0], { connected: false })]), null)
  assert.equal(getGamepadNavigationInput([pad([1, 0, 0, 0], { mapping: 'xr-standard' as GamepadMappingType })]), null)
  assert.equal(getGamepadNavigationInput([pad([1, 0, 0, 0], { mapping: '' })]), null)
  assert.equal(getGamepadNavigationInput([pad([NaN, Infinity, 0, 0])]), null)
  assert.deepEqual(getGamepadNavigationInput([null, pad([0, 0, 0, 0]), pad([0, -1, 1, 0])]),
    { moveX: 0, moveY: -1, lookX: 1, lookY: 0 })
})

test('analogue speed survives the dead zone and diagonal movement is capped', () => {
  const gentle = getGamepadNavigationInput([pad([0, -.59, 0, 0])])!
  assert.ok(Math.abs(gentle.moveY + .5) < 1e-10)
  const diagonal = getGamepadNavigationInput([pad([1, -1, 0, 0])])!
  assert.ok(Math.abs(Math.hypot(diagonal.moveX, diagonal.moveY) - 1) < 1e-10)
  const camera = new PerspectiveCamera(), navigate = createGamepadNavigation()
  navigate(camera, gentle, .05, options)
  assert.ok(Math.abs(camera.position.z + .06) < 1e-10)
})

test('left stick moves relative to yaw, walking stays level, and flying follows pitch', () => {
  const camera = new PerspectiveCamera(), navigate = createGamepadNavigation()
  const input = getGamepadNavigationInput([pad([0, -1, 0, 0])])!
  camera.rotation.set(.6, Math.PI / 2, 0, 'YXZ')
  navigate(camera, input, .05, options)
  assert.ok(Math.abs(camera.position.x + .12) < 1e-10)
  assert.equal(camera.position.y, 1.8)
  navigate(camera, input, .05, { ...options, walk: false })
  assert.ok(camera.position.y > 1.8)
  camera.rotation.set(0, 0, 0)
  const x = camera.position.x
  navigate(camera, getGamepadNavigationInput([pad([1, 0, 0, 0])])!, .05, options)
  assert.ok(Math.abs(camera.position.x - x - .12) < 1e-10)
})

test('right stick looks right/up with clamped pitch and no movement after a stalled frame', () => {
  const camera = new PerspectiveCamera(), navigate = createGamepadNavigation()
  const input = getGamepadNavigationInput([pad([0, 0, 1, -1])])!
  navigate(camera, input, .05, options)
  assert.ok(camera.rotation.y < 0 && camera.rotation.x > 0)
  for (let i = 0; i < 100; i++) navigate(camera, input, .05, options)
  assert.ok(camera.rotation.x < Math.PI / 2)
  const before = camera.position.toArray(), rotation = camera.quaternion.toArray()
  navigate(camera, { ...input, moveY: -1 }, 2, options)
  assert.deepEqual(camera.position.toArray(), before)
  assert.deepEqual(camera.quaternion.toArray(), rotation)
})

test('travel and turn rates are independent of normal frame rate', () => {
  const input = getGamepadNavigationInput([pad([.5, -.7, .3, -.2])])!
  const a = new PerspectiveCamera(), b = new PerspectiveCamera()
  const navigate = createGamepadNavigation()
  // Test translation and rotation separately; a turning path is integrated per frame.
  for (let i = 0; i < 30; i++) navigate(a, { ...input, lookX: 0, lookY: 0 }, 1 / 30, options)
  for (let i = 0; i < 120; i++) navigate(b, { ...input, lookX: 0, lookY: 0 }, 1 / 120, options)
  assert.ok(a.position.distanceTo(b.position) < 1e-10)
  for (let i = 0; i < 30; i++) navigate(a, { ...input, moveX: 0, moveY: 0 }, 1 / 30, options)
  for (let i = 0; i < 120; i++) navigate(b, { ...input, moveX: 0, moveY: 0 }, 1 / 120, options)
  assert.ok(a.quaternion.angleTo(b.quaternion) < 1e-7)
})
