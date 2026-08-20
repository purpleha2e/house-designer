import assert from 'node:assert/strict'
import test from 'node:test'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import type { Wall } from '../src/types.ts'

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

test('internal joins do not change external rendered wall length', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const internal = wall({
    id: 'internal',
    kind: 'internal',
    start: { x: 4, y: 0.075 },
    end: { x: 4, y: 2 },
    thickness: 0.15,
  })

  const renderedExternal = getRenderedWalls([external, internal]).find(
    (renderedWall) => renderedWall.wall.id === external.id,
  )

  assert.equal(renderedExternal?.startExtension, 0)
  assert.equal(renderedExternal?.endExtension, 0)
})

test('external joins can still extend external rendered wall length', () => {
  const horizontal = wall({
    id: 'horizontal',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 4, y: 0 },
  })
  const vertical = wall({
    id: 'vertical',
    kind: 'external',
    start: { x: 4, y: 0 },
    end: { x: 4, y: 3 },
  })

  const renderedHorizontal = getRenderedWalls([horizontal, vertical]).find(
    (renderedWall) => renderedWall.wall.id === horizontal.id,
  )

  assert.equal(renderedHorizontal?.startExtension, 0)
  assert.equal(renderedHorizontal?.endExtension, vertical.thickness / 2)
})

test('internal wall endpoint on external end cap is not trimmed back along shallow angles', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 3, y: 0 },
  })
  const internal = wall({
    id: 'internal',
    kind: 'internal',
    start: { x: 3, y: 0.075 },
    end: { x: 6.9, y: 0.8 },
    thickness: 0.15,
  })

  const renderedInternal = getRenderedWalls([external, internal]).find(
    (renderedWall) => renderedWall.wall.id === internal.id,
  )

  assert.equal(renderedInternal?.startExtension, 0)
})

test('internal wall endpoint on external end cap trims at normal join angles', () => {
  const external = wall({
    id: 'external',
    kind: 'external',
    start: { x: 0, y: 0 },
    end: { x: 3, y: 0 },
  })
  const internal = wall({
    id: 'internal',
    kind: 'internal',
    start: { x: 3, y: 0.075 },
    end: { x: 5, y: 2 },
    thickness: 0.15,
  })

  const renderedInternal = getRenderedWalls([external, internal]).find(
    (renderedWall) => renderedWall.wall.id === internal.id,
  )

  assert.ok((renderedInternal?.startExtension ?? 0) < 0)
  assert.ok((renderedInternal?.startExtension ?? 0) >= -external.thickness)
})
