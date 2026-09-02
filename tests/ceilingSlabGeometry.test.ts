import assert from 'node:assert/strict'
import test from 'node:test'
import { Shape } from 'three'

import {
  createCeilingSlabGeometry,
  offsetEdgeTowardPoint,
} from '../src/ceilingSlabGeometry.ts'

function createSquareShape() {
  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.lineTo(2, 0)
  shape.lineTo(2, 2)
  shape.lineTo(0, 2)
  shape.closePath()
  return shape
}

test('combines slab caps and one facade quad per outer edge', () => {
  const geometry = createCeilingSlabGeometry(createSquareShape(), 0.3, [
    {
      materialIndex: 1,
      nextPoint: { x: 2, y: 0 },
      normalSign: 1,
      point: { x: 0, y: 0 },
      uvBottom: 2.38,
      uvEnd: 2,
      uvStart: 0,
    },
  ])
  const facadeGroup = geometry.groups.find((group) => group.materialIndex === 1)

  assert.equal(facadeGroup?.count, 6)
  assert.equal(
    geometry.groups.filter((group) => group.materialIndex === 1).length,
    1,
  )
  assert.equal(geometry.getAttribute('position').count, 18)
  geometry.dispose()
})

test('keeps metre-based wall UV coordinates on slab facades', () => {
  const geometry = createCeilingSlabGeometry(createSquareShape(), 0.22, [
    {
      materialIndex: 1,
      nextPoint: { x: 2, y: 0 },
      normalSign: 1,
      point: { x: 0, y: 0 },
      uvBottom: 2.38,
      uvEnd: 7,
      uvStart: 5,
    },
  ])
  const facadeGroup = geometry.groups.find((group) => group.materialIndex === 1)!
  const uvs = geometry.getAttribute('uv')
  const facadeUvs = Array.from({ length: facadeGroup.count }, (_, offset) => [
    uvs.getX(facadeGroup.start + offset),
    uvs.getY(facadeGroup.start + offset),
  ])

  assert.ok(Math.abs(facadeUvs[0][0] - 5) < 1e-5)
  assert.ok(Math.abs(facadeUvs[0][1] - 2.38) < 1e-5)
  assert.ok(Math.abs(facadeUvs[2][0] - 7) < 1e-5)
  assert.ok(Math.abs(facadeUvs[2][1] - 2.6) < 1e-5)
  geometry.dispose()
})

test('offsets an aperture edge toward the opening interior', () => {
  const edge = offsetEdgeTowardPoint(
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    0.002,
  )

  assert.deepEqual(edge.point, { x: 0, y: 0.002 })
  assert.deepEqual(edge.nextPoint, { x: 2, y: 0.002 })
})

test('extends the facade above the structural slab cap', () => {
  const geometry = createCeilingSlabGeometry(createSquareShape(), 0.22, [
    {
      materialIndex: 1,
      nextPoint: { x: 2, y: 0 },
      normalSign: 1,
      point: { x: 0, y: 0 },
      topOverlap: 0.02,
      uvBottom: 2.38,
      uvEnd: 2,
      uvStart: 0,
    },
  ])
  const facadeGroup = geometry.groups.find((group) => group.materialIndex === 1)!
  const positions = geometry.getAttribute('position')
  const facadeTop = Math.max(
    ...Array.from({ length: facadeGroup.count }, (_, offset) =>
      positions.getZ(facadeGroup.start + offset),
    ),
  )

  assert.ok(Math.abs(facadeTop - 0.24) < 1e-5)
  geometry.dispose()
})

test('insets horizontal caps without moving the slab facade', () => {
  const geometry = createCeilingSlabGeometry(
    createSquareShape(),
    0.22,
    [
      {
        materialIndex: 1,
        nextPoint: { x: 2, y: 0 },
        normalSign: 1,
        point: { x: 0, y: 0 },
        uvBottom: 2.38,
        uvEnd: 2,
        uvStart: 0,
      },
    ],
    0.001,
  )
  const capGroup = geometry.groups.find((group) => group.materialIndex === 0)!
  const facadeGroup = geometry.groups.find((group) => group.materialIndex === 1)!
  const positions = geometry.getAttribute('position')
  const capHeights = Array.from({ length: capGroup.count }, (_, offset) =>
    positions.getZ(capGroup.start + offset),
  )
  const facadeHeights = Array.from(
    { length: facadeGroup.count },
    (_, offset) => positions.getZ(facadeGroup.start + offset),
  )

  assert.ok(Math.abs(Math.min(...capHeights) - 0.001) < 1e-5)
  assert.ok(Math.abs(Math.max(...capHeights) - 0.219) < 1e-5)
  assert.equal(Math.min(...facadeHeights), 0)
  assert.ok(Math.abs(Math.max(...facadeHeights) - 0.22) < 1e-5)
  geometry.dispose()
})
