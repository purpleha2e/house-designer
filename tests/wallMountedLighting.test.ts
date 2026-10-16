import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Plane, Vector3 } from 'three'
import { acquireWallMountedReceiverGeometry, attachWallMountedLighting } from '../src/wallMountedLighting.ts'
import type { Wall } from '../src/types.ts'

const wall: Wall = { id: 'wall', kind: 'external', thickness: .3, height: 3,
  start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }

test('mounted frame receiver planes clear a thick wall on its indoor side only', () => {
  const source = new BoxGeometry(1, 1, .08)
  const transform = new Matrix4().makeTranslation(2, 1, -.09)
  const receiver = acquireWallMountedReceiverGeometry(source, transform, wall, -1)
  assert.equal(source.getAttribute('hdGIWallMount1'), undefined, 'shared source stays unchanged')
  const outside = receiver.geometry.getAttribute('hdGIWallMount0')
  const inside = receiver.geometry.getAttribute('hdGIWallMount1')
  for (let i = 0; i < inside.count; i++) {
    assert.equal(outside.getW(i), 0, 'exterior side retains ordinary outdoor lighting')
    const plane = new Plane(new Vector3(inside.getX(i), inside.getY(i), inside.getZ(i)), -inside.getW(i)).applyMatrix4(transform)
    assert.ok(Math.abs(plane.distanceToPoint(new Vector3(2, 1, .23))) < 1e-6,
      'room sampling plane sits 8 cm beyond the inner wall face')
  }
  receiver.release(); source.dispose()
})

test('rotated, mirrored and resized frames retain world-space receiver planes', () => {
  const angle = .73, rotation = new Matrix4().makeRotationY(angle)
  const rotated: Wall = { ...wall, start: { x: 5, y: 6 },
    end: { x: 5 + Math.cos(angle) * 4, y: 6 - Math.sin(angle) * 4 } }
  const normal = new Vector3(Math.sin(angle), 0, Math.cos(angle))
  const transform = new Matrix4().makeTranslation(5 + Math.cos(angle) * 2, 1, 6 - Math.sin(angle) * 2)
    .multiply(rotation).multiply(new Matrix4().makeScale(-1.5, .8, 1.2))
  const source = new BoxGeometry(1, 1, .08)
  const receiver = acquireWallMountedReceiverGeometry(source, transform, rotated)
  for (const [index, side] of [[0, -1], [1, 1]]) {
    const a = receiver.geometry.getAttribute(`hdGIWallMount${index}`)
    const plane = new Plane(new Vector3(a.getX(0), a.getY(0), a.getZ(0)), -a.getW(0)).applyMatrix4(transform)
    assert.ok(Math.abs(plane.normal.length() - 1) < 1e-6, 'rotated receiver has a real unit normal')
    const point = new Vector3(rotated.start.x, 1, rotated.start.y).addScaledVector(normal, side * .23)
    assert.ok(Math.abs(plane.distanceToPoint(point)) < 1e-6)
  }
  receiver.release(); source.dispose()
})

test('matching frame instances share receiver buffers and release them after the last owner', () => {
  const source = new BoxGeometry(1, 1, .08)
  const first = acquireWallMountedReceiverGeometry(source, new Matrix4().makeTranslation(1, 1, 0), wall, -1)
  const second = acquireWallMountedReceiverGeometry(source, new Matrix4().makeTranslation(2, 1, 0), wall, -1)
  assert.equal(first.geometry, second.geometry, 'translations along a wall preserve batching')
  let disposed = 0
  first.geometry.addEventListener('dispose', () => disposed++)
  first.release(); first.release(); assert.equal(disposed, 0)
  second.release(); assert.equal(disposed, 1)
  source.dispose()
})

test('mount/unmount restores the imported hierarchy and leaves geometry away from the wall unmodified', () => {
  const root = new Group(), source = new BoxGeometry(1, 1, .08), material = new MeshStandardMaterial()
  const frame = new Mesh(source, material), leaf = new Mesh(source, material)
  frame.position.set(2, 1, 0); leaf.position.set(2, 1, 1)
  root.add(frame, leaf)
  const restore = attachWallMountedLighting(root, wall, -1)
  assert.notEqual(frame.geometry, source)
  assert.ok(Array.from(leaf.geometry.getAttribute('hdGIWallMount1').array).every(value => value === 0),
    'a swung leaf already inside the room uses its actual position')
  restore()
  assert.equal(frame.geometry, source); assert.equal(leaf.geometry, source)
  source.dispose(); material.dispose()
})
