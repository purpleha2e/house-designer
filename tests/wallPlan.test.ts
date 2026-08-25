import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { buildWallGeometryPlans } from '../src/wallEngine/wallPlan.ts'

function wall(overrides: Partial<Wall> & Pick<Wall, 'id'>): Wall {
  return {
    height: 2.4,
    id: overrides.id,
    kind: 'internal',
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    thickness: 0.2,
    ...overrides,
  }
}

test('wall geometry plan converges endpoint sides for ordinary snapped joins', () => {
  const plans = buildWallGeometryPlans([
    wall({
      id: 'horizontal',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
    wall({
      id: 'vertical',
      start: { x: 2, y: 0 },
      end: { x: 2, y: 2 },
    }),
  ])
  const horizontal = plans.find((plan) => plan.wallId === 'horizontal')

  assert.equal(horizontal?.end.type, 'endpoint-join')

  if (horizontal?.end.type !== 'endpoint-join') {
    throw new Error('Expected endpoint join')
  }

  assert.deepEqual(
    horizontal.end.sidePlans.map((sidePlan) => sidePlan.type),
    ['converge', 'converge'],
  )
  assert.ok(
    horizontal.end.sidePlans.every(
      (sidePlan) => sidePlan.distanceFromEndpoint < 1,
    ),
  )
})

test('wall geometry plan chamfers endpoint joins when convergence is too long', () => {
  const plans = buildWallGeometryPlans(
    [
      wall({
        id: 'shallow-a',
        start: { x: 0, y: 0 },
        end: { x: 2, y: 0 },
      }),
      wall({
        id: 'shallow-b',
        start: { x: 2, y: 0 },
        end: { x: 12, y: 0.2 },
      }),
    ],
    {
      chamferThreshold: 1,
    },
  )
  const shallow = plans.find((plan) => plan.wallId === 'shallow-a')

  assert.equal(shallow?.end.type, 'endpoint-join')

  if (shallow?.end.type !== 'endpoint-join') {
    throw new Error('Expected endpoint join')
  }

  assert.ok(shallow.end.sidePlans.some((sidePlan) => sidePlan.type === 'chamfer'))
  assert.ok(
    shallow.end.sidePlans
      .filter((sidePlan) => sidePlan.type === 'chamfer')
      .every((sidePlan) => sidePlan.distanceFromEndpoint === 1),
  )
})

test('wall geometry plan records side attachment caps with adjoining wall material source', () => {
  const plans = buildWallGeometryPlans([
    wall({
      id: 'target',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 4 },
    }),
    wall({
      id: 'branch',
      start: { x: 0.1, y: 2 },
      end: { x: 2, y: 2 },
    }),
  ])
  const branch = plans.find((plan) => plan.wallId === 'branch')

  assert.equal(branch?.start.type, 'side-attachment')

  if (branch?.start.type !== 'side-attachment') {
    throw new Error('Expected side attachment')
  }

  assert.deepEqual(branch.start.capMaterialSource, {
    side: -1,
    wallId: 'target',
  })
  assert.deepEqual(branch.start.capUvSource, {
    side: -1,
    wallId: 'target',
  })
  assert.equal(Number(branch.start.targetDistance.toFixed(3)), 2)
})

test('wall geometry plan supports up to four snapped endpoints at one node', () => {
  const plans = buildWallGeometryPlans([
    wall({
      id: 'north',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 2 },
    }),
    wall({
      id: 'east',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
    wall({
      id: 'south',
      start: { x: 0, y: 0 },
      end: { x: 0, y: -2 },
    }),
    wall({
      id: 'west',
      start: { x: 0, y: 0 },
      end: { x: -2, y: 0 },
    }),
  ])

  assert.equal(
    plans.filter((plan) => plan.start.type === 'endpoint-join').length,
    4,
  )
})

test('wall geometry plan marks crossing leader and subordinate cut intervals', () => {
  const plans = buildWallGeometryPlans([
    wall({
      id: 'leader',
      kind: 'external',
      start: { x: -1, y: 0 },
      end: { x: 1, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'subordinate',
      start: { x: 0, y: -1 },
      end: { x: 0, y: 1 },
    }),
  ])
  const leader = plans.find((plan) => plan.wallId === 'leader')
  const subordinate = plans.find((plan) => plan.wallId === 'subordinate')

  assert.equal(leader?.crossings[0].role, 'leader')
  assert.equal(subordinate?.crossings[0].role, 'cut-around-leader')
  assert.deepEqual(subordinate?.faces[0].intervals, [
    { end: 0.999, start: 0 },
    { end: 2, start: 1.001 },
  ])
})
