import assert from 'node:assert/strict'
import test from 'node:test'
import { constrainModelDrag, planAabbsOverlap, translatePlanBounds } from '../src/modelDragCollision.ts'

const cabinet = { minX: 0, maxX: .6, minY: 0, maxY: .65 }
const neighbour = { minX: 1, maxX: 1.6, minY: 0, maxY: .65 }

test('a single large drag stops at the first object even when the pointer goes beyond it', () => {
  for (const x of [.9, 2.2]) {
    const delta = constrainModelDrag(cabinet, { x, y: 0 }, [neighbour], true)
    const moved = translatePlanBounds(cabinet, delta)
    assert.equal(moved.maxX, neighbour.minX)
    assert.equal(planAabbsOverlap(moved, neighbour), false)
  }
  const delta = constrainModelDrag(neighbour, { x: -2.2, y: 0 }, [cabinet], true)
  assert.equal(translatePlanBounds(neighbour, delta).minX, cabinet.maxX)
})

test('during a diagonal drag an object can slide along the contact face or keep its constrained direction', () => {
  const delta = { x: 1, y: .25 }
  assert.deepEqual(constrainModelDrag(cabinet, delta, [neighbour], true), { x: .4, y: .25 })
  assert.deepEqual(constrainModelDrag(cabinet, delta, [neighbour], false), { x: .4, y: .1 })
  const touching = translatePlanBounds(cabinet, { x: .4, y: 0 })
  assert.deepEqual(constrainModelDrag(touching, delta, [neighbour], true), { x: 0, y: .25 })
  assert.deepEqual(constrainModelDrag(touching, { x: -.15, y: 0 }, [neighbour], true), { x: -.15, y: 0 })
})

test('sliding also stops when it reaches a second object', () => {
  const alongEdge = { minX: 0, maxX: 1, minY: .95, maxY: 1.55 }
  const delta = constrainModelDrag(cabinet, { x: 2, y: 1.2 }, [alongEdge, neighbour], true)
  const moved = translatePlanBounds(cabinet, delta)
  assert.equal(moved.maxX, neighbour.minX)
  assert.equal(moved.maxY, alongEdge.minY)
})
