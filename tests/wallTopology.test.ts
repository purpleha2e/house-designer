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
