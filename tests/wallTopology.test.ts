import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import { buildWallTopology } from '../src/wallTopology.ts'

function wall(overrides: Partial<Wall> & Pick<Wall, 'id' | 'kind'>): Wall {
  return {
    height: 2.4,
    openings: undefined,
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
    thickness: overrides.kind === 'external' ? 0.3 : 0.15,
    ...overrides,
  }
}

test('room detection uses topology-snapped endpoints', () => {
  const topology = buildWallTopology([
    wall({
      id: 'bottom',
      kind: 'external',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
    }),
    wall({
      id: 'right',
      kind: 'external',
      start: { x: 4.04, y: 0.03 },
      end: { x: 4, y: 3 },
    }),
    wall({
      id: 'top',
      kind: 'external',
      start: { x: 4, y: 3.02 },
      end: { x: 0, y: 3 },
    }),
    wall({
      id: 'left',
      kind: 'external',
      start: { x: 0.02, y: 3 },
      end: { x: 0, y: 0.04 },
    }),
  ])

  assert.equal(topology.rooms.length, 1)
  assert.ok(topology.rooms[0].area > 9.5)
})

test('internal side snap near external endpoint preserves snapped point', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 3, y: 0 },
    thickness: 0.3,
  })
  const internal = wall({
    id: 'internal',
    kind: 'internal',
    start: { x: 2.925, y: 0.15 },
    end: { x: 2.925, y: 2 },
    thickness: 0.15,
  })
  const topology = buildWallTopology([external, internal])
  const renderedInternal = topology.renderedWallsById.get(internal.id)

  assert.equal(renderedInternal?.wall.start.x, internal.start.x)
  assert.equal(renderedInternal?.wall.start.y, internal.start.y)
})

test('topology keeps separate internal endpoints on external end quarter points', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 3 },
    thickness: 0.3,
  })
  const leftInternal = wall({
    id: 'left-internal',
    kind: 'internal',
    start: { x: -0.075, y: 3 },
    end: { x: -1, y: 2.2 },
    thickness: 0.15,
  })
  const rightInternal = wall({
    id: 'right-internal',
    kind: 'internal',
    start: { x: 0.075, y: 3 },
    end: { x: 0.075, y: 4 },
    thickness: 0.15,
  })
  const topology = buildWallTopology([external, leftInternal, rightInternal])
  const renderedLeft = topology.renderedWallsById.get(leftInternal.id)
  const renderedRight = topology.renderedWallsById.get(rightInternal.id)

  assert.deepEqual(renderedLeft?.wall.start, leftInternal.start)
  assert.deepEqual(renderedRight?.wall.start, rightInternal.start)
})

test('room detection ignores side-attached two-wall loops', () => {
  const topology = buildWallTopology([
    wall({
      id: 'horizontal',
      kind: 'external',
      start: { x: 1.5, y: 1.5 },
      end: { x: 6.5, y: 1.5 },
      thickness: 0.3,
    }),
    wall({
      id: 'angled',
      kind: 'external',
      start: { x: 4.819, y: 4.95 },
      end: { x: 4.516, y: 1.5 },
      thickness: 0.3,
    }),
  ])

  assert.equal(topology.rooms.length, 0)
})

test('room detection ignores side-attached internal wall wrapping both wall faces', () => {
  const topology = buildWallTopology([
    wall({
      id: 'horizontal-external',
      kind: 'external',
      start: { x: 3.05, y: 4.411 },
      end: { x: 6.231, y: 4.411 },
      thickness: 0.3,
    }),
    wall({
      id: 'side-attached-internal',
      kind: 'internal',
      start: { x: 4.34, y: 9.117 },
      end: { x: 4.34, y: 4.411 },
      thickness: 0.15,
    }),
    wall({
      id: 'vertical-external',
      kind: 'external',
      start: { x: 6.231, y: 1.894 },
      end: { x: 6.231, y: 4.411 },
      thickness: 0.3,
    }),
  ])

  assert.equal(topology.rooms.length, 0)
})

test('room detection keeps adjacent rooms after rejected exploratory loops', () => {
  const topology = buildWallTopology([
    wall({
      id: 'bottom-external',
      kind: 'external',
      start: { x: 4.55, y: 2.333 },
      end: { x: 13.317, y: 2.333 },
      thickness: 0.3,
    }),
    wall({
      id: 'left-external',
      kind: 'external',
      start: { x: 4.55, y: 2.333 },
      end: { x: 4.55, y: 13.783 },
      thickness: 0.3,
    }),
    wall({
      id: 'top-external',
      kind: 'external',
      start: { x: 4.55, y: 13.783 },
      end: { x: 13.317, y: 13.783 },
      thickness: 0.3,
    }),
    wall({
      id: 'right-external',
      kind: 'external',
      start: { x: 13.317, y: 13.783 },
      end: { x: 13.317, y: 2.333 },
      thickness: 0.3,
    }),
    wall({
      id: 'horizontal-internal',
      kind: 'internal',
      start: { x: 4.55, y: 4.95 },
      end: { x: 13.317, y: 4.95 },
      thickness: 0.15,
    }),
    wall({
      id: 'left-divider',
      kind: 'internal',
      start: { x: 7.3, y: 4.95 },
      end: { x: 7.3, y: 13.783 },
      thickness: 0.15,
    }),
    wall({
      id: 'right-divider',
      kind: 'internal',
      start: { x: 10.617, y: 4.95 },
      end: { x: 10.617, y: 13.783 },
      thickness: 0.15,
    }),
  ])

  assert.equal(topology.rooms.length, 4)
})
