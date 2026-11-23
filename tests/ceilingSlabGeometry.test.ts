import assert from 'node:assert/strict'
import test from 'node:test'
import { Mesh, MeshBasicMaterial, Path, Raycaster, Shape, ShapeGeometry, Vector3, Vector2 } from 'three'

import {
  createCeilingSlabGeometry,
  offsetEdgeTowardPoint,
} from '../src/ceilingSlabGeometry.ts'
import { subtractPlanCutouts, type PlanFootprint } from '../src/planarCutouts.ts'

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

test('floor finish fills its part of the slab top at the same height and keeps the stair hole open', () => {
  const rectangle = (minX: number, minY: number, maxX: number, maxY: number) => [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
  ]
  const stair = rectangle(2, 1, 3, 3)
  const slab = { outline: rectangle(0, 0, 6, 4), holes: [stair] }
  const finish = { outline: rectangle(1, 0, 4, 4), holes: [stair] }
  const shape = ({ outline, holes }: PlanFootprint) => {
    const vectors = (ring: typeof outline) => ring.map(point => new Vector2(point.x, point.y))
    const result = new Shape(vectors(outline))
    result.holes = holes.map(ring => new Path(vectors(ring)))
    return result
  }
  const barePatches = subtractPlanCutouts(slab, [finish])
  assert.equal(barePatches.length, 2)
  const height = .22
  const geometry = createCeilingSlabGeometry(barePatches.map(shape), height, [], 0, 'top')
  const material = new MeshBasicMaterial()
  const bare = new Mesh(geometry, [material])
  const carpet = new Mesh(new ShapeGeometry(shape(finish)), material)
  carpet.position.z = height
  carpet.updateMatrixWorld()
  try {
    const hit = (x: number, y: number) => new Raycaster(new Vector3(x, y, 1), new Vector3(0, 0, -1))
      .intersectObjects([bare, carpet])
    for (const [x, y, mesh] of [[.5, 1.2, bare], [1.6, 1.2, carpet], [4.5, 1.2, bare]] as const) {
      const hits = hit(x, y)
      assert.deepEqual(hits.map(result => result.object), [mesh])
      assert.ok(Math.abs(hits[0].point.z - height) < 1e-6)
    }
    assert.deepEqual(hit(2.5, 1.5), [])
  } finally {
    geometry.dispose()
    carpet.geometry.dispose()
    material.dispose()
  }
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

test('starts the facade above the structural slab bottom', () => {
  const geometry = createCeilingSlabGeometry(createSquareShape(), 0.22, [
    {
      bottomOffset: 0.02,
      materialIndex: 1,
      nextPoint: { x: 2, y: 0 },
      normalSign: 1,
      point: { x: 0, y: 0 },
      uvBottom: 2.4,
      uvEnd: 2,
      uvStart: 0,
    },
  ])
  const facadeGroup = geometry.groups.find((group) => group.materialIndex === 1)!
  const positions = geometry.getAttribute('position')
  const uvs = geometry.getAttribute('uv')
  const facadeHeights = Array.from(
    { length: facadeGroup.count },
    (_, offset) => positions.getZ(facadeGroup.start + offset),
  )
  const facadeVerticalUvs = Array.from(
    { length: facadeGroup.count },
    (_, offset) => uvs.getY(facadeGroup.start + offset),
  )

  assert.ok(Math.abs(Math.min(...facadeHeights) - 0.02) < 1e-5)
  assert.ok(Math.abs(Math.max(...facadeHeights) - 0.22) < 1e-5)
  assert.ok(Math.abs(Math.min(...facadeVerticalUvs) - 2.4) < 1e-5)
  assert.ok(Math.abs(Math.max(...facadeVerticalUvs) - 2.6) < 1e-5)
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
  assert.ok(Math.abs(Math.min(...facadeHeights)) < 1e-5)
  assert.ok(Math.abs(Math.max(...facadeHeights) - 0.22) < 1e-5)
  geometry.dispose()
})
