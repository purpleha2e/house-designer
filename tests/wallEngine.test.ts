import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import {
  buildWallGraph,
  buildWallJoinPlans,
} from '../src/wallEngine/wallGraph.ts'

function wall(overrides: Partial<Wall> & Pick<Wall, 'id'>): Wall {
  return {
    height: 2.4,
    id: overrides.id,
    kind: 'internal',
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    thickness: 0.15,
    ...overrides,
  }
}

test('wall graph groups snapped wall endpoints into explicit endpoint nodes', () => {
  const graph = buildWallGraph([
    wall({
      id: 'a',
      start: { x: 0, y: 0 },
      end: { x: 2, y: 0 },
    }),
    wall({
      id: 'b',
      start: { x: 2.01, y: 0.005 },
      end: { x: 2, y: 2 },
    }),
  ])

  assert.equal(graph.endpointNodes.length, 1)
  assert.deepEqual(graph.endpointNodes[0].endpoints, [
    { endpoint: 'end', wallId: 'a' },
    { endpoint: 'start', wallId: 'b' },
  ])
  assert.equal(graph.sideAttachments.length, 0)
})

test('wall graph supports four endpoints snapped to the same join', () => {
  const graph = buildWallGraph([
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

  assert.equal(graph.endpointNodes.length, 1)
  assert.equal(graph.endpointNodes[0].endpoints.length, 4)
})

test('wall graph records wall endpoint to wall side attachments', () => {
  const graph = buildWallGraph([
    wall({
      id: 'target',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 4 },
    }),
    wall({
      id: 'branch',
      start: { x: 0.075, y: 2 },
      end: { x: 2, y: 2 },
    }),
  ])

  assert.equal(graph.endpointNodes.length, 0)
  assert.equal(graph.sideAttachments.length, 1)
  assert.deepEqual(graph.sideAttachments[0].attachedEndpoint, {
    endpoint: 'start',
    wallId: 'branch',
  })
  assert.equal(graph.sideAttachments[0].targetWallId, 'target')
  assert.equal(graph.sideAttachments[0].side, -1)
  assert.equal(Number(graph.sideAttachments[0].targetDistance.toFixed(3)), 2)
})

test('wall graph records internal endpoint snapped to external quarter line as side attachment', () => {
  const graph = buildWallGraph([
    wall({
      id: 'external',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 4 },
      thickness: 0.3,
    }),
    wall({
      id: 'branch',
      kind: 'internal',
      start: { x: -0.075, y: 2 },
      end: { x: -2, y: 2 },
    }),
  ])

  assert.equal(graph.endpointNodes.length, 0)
  assert.equal(graph.sideAttachments.length, 1)
  assert.deepEqual(graph.sideAttachments[0].attachedEndpoint, {
    endpoint: 'start',
    wallId: 'branch',
  })
  assert.equal(graph.sideAttachments[0].targetWallId, 'external')
  assert.equal(graph.sideAttachments[0].side, 1)
  assert.equal(Number(graph.sideAttachments[0].targetDistance.toFixed(3)), 2)
})

test('wall graph records internal endpoint snapped to external end-face quarter point', () => {
  const graph = buildWallGraph([
    wall({
      id: 'external',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'branch',
      kind: 'internal',
      start: { x: 3, y: 0.075 },
      end: { x: 2, y: 1 },
    }),
  ])

  assert.equal(graph.endpointNodes.length, 0)
  assert.equal(graph.sideAttachments.length, 1)
  assert.deepEqual(graph.sideAttachments[0].attachedEndpoint, {
    endpoint: 'start',
    wallId: 'branch',
  })
  assert.equal(graph.sideAttachments[0].targetWallId, 'external')
  assert.equal(graph.sideAttachments[0].side, 1)
  assert.equal(Number(graph.sideAttachments[0].targetDistance.toFixed(3)), 3)
})

test('wall graph retains an external quarter attachment shared by two branch endpoints', () => {
  const graph = buildWallGraph([
    wall({
      id: 'external',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'left-branch',
      kind: 'internal',
      start: { x: 3, y: 0.075 },
      end: { x: 2, y: 1 },
    }),
    wall({
      id: 'right-branch',
      kind: 'internal',
      start: { x: 3, y: 0.075 },
      end: { x: 4, y: 1 },
    }),
  ])

  assert.equal(graph.endpointNodes.length, 1)
  assert.deepEqual(
    graph.sideAttachments.map((attachment) => ({
      endpoint: attachment.attachedEndpoint.endpoint,
      targetWallId: attachment.targetWallId,
      wallId: attachment.attachedEndpoint.wallId,
    })),
    [
      { endpoint: 'start', targetWallId: 'external', wallId: 'left-branch' },
      { endpoint: 'start', targetWallId: 'external', wallId: 'right-branch' },
    ],
  )
})

test('wall graph retains separate external quarter attachments at one wall end', () => {
  const graph = buildWallGraph([
    wall({
      id: 'external',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 3, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'outer-branch',
      kind: 'internal',
      start: { x: 3, y: 0.15 },
      end: { x: 3, y: 1 },
    }),
    wall({
      id: 'quarter-branch',
      kind: 'internal',
      start: { x: 3, y: 0.075 },
      end: { x: 4, y: 0.075 },
    }),
  ])

  assert.equal(graph.endpointNodes.length, 0)
  assert.deepEqual(
    graph.sideAttachments.map((attachment) => ({
      side: attachment.side,
      targetDistance: Number(attachment.targetDistance.toFixed(3)),
      targetWallId: attachment.targetWallId,
      wallId: attachment.attachedEndpoint.wallId,
    })),
    [
      {
        side: 1,
        targetDistance: 3,
        targetWallId: 'external',
        wallId: 'outer-branch',
      },
      {
        side: 1,
        targetDistance: 3,
        targetWallId: 'external',
        wallId: 'quarter-branch',
      },
    ],
  )
})

test('wall graph ignores endpoints merely inside another wall thickness band', () => {
  const graph = buildWallGraph([
    wall({
      id: 'target',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 4 },
    }),
    wall({
      id: 'branch',
      start: { x: 0.05, y: 2 },
      end: { x: 2, y: 2 },
    }),
  ])

  assert.equal(graph.sideAttachments.length, 0)
})

test('wall graph records crossing walls and chooses a deterministic leader', () => {
  const graph = buildWallGraph([
    wall({
      id: 'internal',
      kind: 'internal',
      start: { x: -1, y: 0 },
      end: { x: 1, y: 0 },
    }),
    wall({
      id: 'external',
      kind: 'external',
      start: { x: 0, y: -1 },
      end: { x: 0, y: 1 },
      thickness: 0.3,
    }),
  ])

  assert.equal(graph.crossings.length, 1)
  assert.deepEqual(graph.crossings[0].wallIds, ['external', 'internal'])
  assert.equal(graph.crossings[0].leaderWallId, 'external')
  assert.deepEqual(graph.crossings[0].point, { x: 0, y: 0 })
})

test('wall graph allows explicit crossing leader override', () => {
  const graph = buildWallGraph(
    [
      wall({
        id: 'a',
        start: { x: -1, y: 0 },
        end: { x: 1, y: 0 },
      }),
      wall({
        id: 'b',
        start: { x: 0, y: -1 },
        end: { x: 0, y: 1 },
      }),
    ],
    {
      crossingLeader: () => 'b',
    },
  )

  assert.equal(graph.crossings[0].leaderWallId, 'b')
})

test('wall join plans expose per-wall endpoint, side and crossing relationships', () => {
  const walls = [
    wall({
      id: 'joined',
      start: { x: -2, y: 0 },
      end: { x: 0, y: 0 },
    }),
    wall({
      id: 'side-target',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 4 },
    }),
    wall({
      id: 'branch',
      start: { x: 0.075, y: 2 },
      end: { x: 2, y: 2 },
    }),
    wall({
      id: 'crossing',
      kind: 'external',
      start: { x: -1, y: 1 },
      end: { x: 1, y: 1 },
      thickness: 0.3,
    }),
  ]
  const graph = buildWallGraph(walls)
  const plans = buildWallJoinPlans(graph, walls)
  const joinedPlan = plans.find((plan) => plan.wallId === 'joined')
  const branchPlan = plans.find((plan) => plan.wallId === 'branch')
  const targetPlan = plans.find((plan) => plan.wallId === 'side-target')

  assert.equal(joinedPlan?.endpointJoins.length, 1)
  assert.deepEqual(branchPlan?.sideAttachments, [
    {
      endpoint: 'start',
      side: -1,
      targetDistance: 2,
      targetWallId: 'side-target',
      wallId: 'branch',
    },
  ])
  assert.deepEqual(
    targetPlan?.crossings.map((crossing) => ({
      isLeader: crossing.isLeader,
      leaderWallId: crossing.leaderWallId,
    })),
    [
      {
        isLeader: false,
        leaderWallId: 'crossing',
      },
    ],
  )
})
