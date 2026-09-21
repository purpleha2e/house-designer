import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import {
  getNearbyVisibleBoundsOpacity,
  getNearbyVisibleWallIds,
  getNearbyVisibleWallOpacities,
} from '../src/wallViewOcclusion.ts'
import type { Wall } from '../src/types.ts'

const front: Wall = { id: 'front', start: { x: 0, y: 0 }, end: { x: 4, y: 0 },
  height: 2.4, thickness: 0.2, kind: 'external' }
const back: Wall = { ...front, id: 'back', start: { x: 0, y: 4 }, end: { x: 4, y: 4 } }

function view(position: [number, number, number], target: [number, number, number], fov = 60, aspect = 1) {
  const camera = new PerspectiveCamera(fov, aspect, 0.01, 100)
  camera.position.set(...position)
  camera.lookAt(...target)
  camera.updateWorldMatrix(true, false)
  return { camera: camera.position, frustum: new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  ) }
}
const nearby = (position: [number, number, number], target: [number, number, number],
  walls = [front, back], elevation = 0) =>
  getNearbyVisibleWallIds({ ...view(position, target), elevation, walls })

test('a visible wall fades only within 1.5 m of its face', () => {
  assert.deepEqual(nearby([2, 1.6, -1], [2, 1.6, 2]), new Set(['front']))
  assert.deepEqual(nearby([2, 1.6, -1.6], [2, 1.6, 2]), new Set(['front']))
  assert.equal(nearby([2, 1.6, -1.601], [2, 1.6, 2]).size, 0)
  assert.equal(nearby([2, 1.6, -4], [2, 1.6, 2]).size, 0)
})

test('nearby wall opacity follows a smooth distance curve', () => {
  const opacityAt = (z: number, targetZ = 0) => getNearbyVisibleWallOpacities({
    ...view([2, 1.6, z], [2, 1.6, targetZ]), elevation: 0, walls: [front],
  }).get('front')
  assert.equal(opacityAt(-0.1), 0)
  assert.equal(opacityAt(-0.85), 0.5)
  assert.equal(opacityAt(-1.6), 1)
  assert.equal(opacityAt(0.1), 0)
  assert.equal(opacityAt(0.85), 0.5)
  assert.equal(opacityAt(1.6), 1)
})

test('nearby visible roof and gable bounds use the same proximity curve', () => {
  const bounds = new Box3(new Vector3(-1, 2, -0.1), new Vector3(1, 4, 0.1))
  const opacityAt = (z: number, targetZ = 0) => {
    const query = view([0, 3, z], [0, 3, targetZ])
    return getNearbyVisibleBoundsOpacity({
      bounds,
      camera: query.camera,
      frustum: query.frustum,
    })
  }
  assert.equal(opacityAt(-0.1), 0)
  assert.equal(opacityAt(-0.85), 0.5)
  assert.equal(opacityAt(-1.6), 1)
  assert.equal(opacityAt(-1.601), null)
  assert.equal(opacityAt(-1, -2), null)
})

test('turning away restores a nearby wall behind the camera', () => {
  assert.equal(nearby([2, 1.6, -1], [2, 1.6, -2]).size, 0)
})

test('nearby walls also fade from inside a room and without room detection', () => {
  assert.deepEqual(nearby([2, 1.6, 1], [2, 1.6, 0]), new Set(['front']))
  assert.deepEqual(nearby([2, 1.6, 3], [2, 1.6, 4]), new Set(['back']))
})

test('nearby off-screen walls stay solid', () => {
  const side = { ...front, id: 'side', start: { x: 0.7, y: -0.1 }, end: { x: 1, y: 0.1 } }
  assert.equal(nearby([0, 1, 0], [0, 1, 2], [side]).size, 0)
})

test('long walls fade when a visible portion is near even if their midpoint is off-screen', () => {
  const long = { ...front, start: { x: -100, y: 0 }, end: { x: 1, y: 0 } }
  assert.deepEqual(nearby([0, 1, -1], [0, 1, 0], [long]), new Set(['front']))
})

test('camera height does not prevent a nearby visible wall from fading', () => {
  assert.deepEqual(nearby([2, 20, -1], [2, 1, 0]), new Set(['front']))
  assert.deepEqual(nearby([2, 1, -1], [2, 5, 0], [front], 4), new Set(['front']))
  const highOpacity = getNearbyVisibleWallOpacities({
    ...view([2, 20, -1], [2, 1, 0]), elevation: 0, walls: [front],
  }).get('front')
  assert.equal(highOpacity, 0.648)
})

test('distance to a wall endpoint is not distance to its infinitely extended line', () => {
  assert.equal(nearby([6, 1, -0.2], [0, 1, 0], [front]).size, 0)
  assert.deepEqual(nearby([5, 1, -0.2], [0, 1, 0], [front]), new Set(['front']))
})

test('diagonal walls use their actual orientation for distance', () => {
  const diagonal = { ...front, start: { x: 0, y: 0 }, end: { x: 4, y: 4 } }
  assert.deepEqual(nearby([1, 1, 2], [2, 1, 2], [diagonal]), new Set(['front']))
  assert.equal(nearby([0, 1, 4], [2, 1, 2], [diagonal]).size, 0)
})

test('visibility follows field of view, aspect ratio, and vertical viewing angle', () => {
  const side = { ...front, start: { x: 0.9, y: 1 }, end: { x: 1.1, y: 1 } }
  const check = (fov: number, aspect = 1) => getNearbyVisibleWallIds({
    ...view([0, 1, 0], [0, 1, 2], fov, aspect), walls: [side], elevation: 0,
  })
  assert.equal(check(40).size, 0)
  assert.deepEqual(check(110), new Set(['front']))
  assert.deepEqual(check(40, 3), new Set(['front']))
  assert.equal(nearby([2, 3, -1], [2, 10, -1], [front]).size, 0)
})

test('degenerate walls are ignored', () => {
  assert.equal(nearby([0, 1, -1], [0, 1, 0], [
    { ...front, end: front.start }, { ...front, height: 0 },
  ]).size, 0)
})
