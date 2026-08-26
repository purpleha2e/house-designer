import assert from 'node:assert/strict'
import test from 'node:test'
import type { Wall } from '../src/types.ts'
import {
  endpointSnapRespectsMinimumJoinAngle,
  getEndpointJoinAngleRadians,
  MIN_WALL_JOIN_ANGLE_DEGREES,
  wallDoesNotCrossOtherWalls,
  wallRespectsMinimumJoinAngles,
  wallRespectsMinimumEndpointJoinAngles,
} from '../src/wallJoinConstraints.ts'

function wall(overrides: Partial<Wall> & Pick<Wall, 'id'>): Wall {
  return {
    end: { x: 1, y: 0 },
    height: 2.4,
    id: overrides.id,
    kind: 'internal',
    start: { x: 0, y: 0 },
    thickness: 0.15,
    ...overrides,
  }
}

test('wall join constraint reports endpoint join angles', () => {
  const angle = getEndpointJoinAngleRadians({
    firstEndpoint: 'end',
    firstWall: wall({ id: 'first' }),
    secondEndpoint: 'start',
    secondWall: wall({
      id: 'second',
      end: { x: 1 - Math.SQRT1_2, y: Math.SQRT1_2 },
      start: { x: 1, y: 0 },
    }),
  })

  assert.equal(Math.round((angle * 180) / Math.PI), MIN_WALL_JOIN_ANGLE_DEGREES)
})

test('wall join constraint rejects endpoint snaps below 45 degrees', () => {
  const movingWall = wall({
    id: 'moving',
    end: { x: 0.9, y: 0 },
    start: { x: 0, y: 0 },
  })
  const snapPoint = { x: 1, y: 0 }
  const walls = [
    wall({
      id: 'other',
      end: { x: 0, y: 0.2 },
      start: snapPoint,
    }),
  ]

  assert.equal(
    endpointSnapRespectsMinimumJoinAngle({
      endpoint: 'end',
      movingWall,
      snapPoint,
      tolerance: 0.03,
      walls,
    }),
    false,
  )
})

test('wall join constraint allows endpoint snaps at or above 45 degrees', () => {
  const movingWall = wall({
    id: 'moving',
    end: { x: 0.9, y: 0 },
    start: { x: 0, y: 0 },
  })
  const snapPoint = { x: 1, y: 0 }
  const walls = [
    wall({
      id: 'other',
      end: { x: 1 - Math.SQRT1_2, y: Math.SQRT1_2 },
      start: snapPoint,
    }),
  ]

  assert.equal(
    endpointSnapRespectsMinimumJoinAngle({
      endpoint: 'end',
      movingWall,
      snapPoint,
      tolerance: 0.03,
      walls,
    }),
    true,
  )
})

test('wall join constraint rejects rotating a wall past 45 degrees at an already snapped endpoint', () => {
  const snappedPoint = { x: 0, y: 0 }
  const walls = [
    wall({
      id: 'fixed',
      end: { x: 0, y: -1 },
      start: snappedPoint,
    }),
  ]

  assert.equal(
    wallRespectsMinimumEndpointJoinAngles({
      movingWall: {
        id: 'moving',
        start: snappedPoint,
        end: { x: 0.2, y: -1 },
      },
      tolerance: 0.03,
      walls,
    }),
    false,
  )
})

test('wall join constraint allows rotating a snapped wall at 45 degrees', () => {
  const snappedPoint = { x: 0, y: 0 }
  const walls = [
    wall({
      id: 'fixed',
      end: { x: 0, y: -1 },
      start: snappedPoint,
    }),
  ]

  assert.equal(
    wallRespectsMinimumEndpointJoinAngles({
      movingWall: {
        id: 'moving',
        start: snappedPoint,
        end: { x: 1, y: -1 },
      },
      tolerance: 0.03,
      walls,
    }),
    true,
  )
})

test('wall join constraint allows straight continuation through a snapped endpoint', () => {
  const snappedPoint = { x: 0, y: 0 }
  const walls = [
    wall({
      id: 'fixed',
      end: { x: 0, y: -1 },
      start: snappedPoint,
    }),
  ]

  assert.equal(
    wallRespectsMinimumEndpointJoinAngles({
      movingWall: {
        id: 'moving',
        start: snappedPoint,
        end: { x: 0, y: 1 },
      },
      tolerance: 0.03,
      walls,
    }),
    true,
  )
})

test('wall join constraint allows side-attached wall to rotate toward perpendicular', () => {
  const walls = [
    wall({
      id: 'fixed',
      end: { x: 0, y: 4 },
      kind: 'external',
      start: { x: 0, y: 0 },
      thickness: 0.3,
    }),
  ]

  assert.equal(
    wallRespectsMinimumJoinAngles({
      movingWall: {
        id: 'moving',
        start: { x: 0, y: 2 },
        end: { x: 1, y: 2 },
      },
      tolerance: 0.03,
      walls,
    }),
    true,
  )
})

test('wall join constraint rejects side-attached wall below 45 degrees to adjoining side', () => {
  const walls = [
    wall({
      id: 'fixed',
      end: { x: 0, y: 4 },
      kind: 'external',
      start: { x: 0, y: 0 },
      thickness: 0.3,
    }),
  ]

  assert.equal(
    wallRespectsMinimumJoinAngles({
      movingWall: {
        id: 'moving',
        start: { x: 0, y: 2 },
        end: { x: 0.2, y: 3 },
      },
      tolerance: 0.03,
      walls,
    }),
    false,
  )
})

test('wall join constraint allows wall between two side-attached vertical walls to move parallel', () => {
  const walls = [
    wall({
      id: 'left',
      end: { x: 0, y: 4 },
      kind: 'external',
      start: { x: 0, y: 0 },
      thickness: 0.3,
    }),
    wall({
      id: 'right',
      end: { x: 3, y: 4 },
      kind: 'external',
      start: { x: 3, y: 0 },
      thickness: 0.3,
    }),
  ]

  assert.equal(
    wallRespectsMinimumJoinAngles({
      movingWall: {
        id: 'moving',
        start: { x: 0, y: 2.2 },
        end: { x: 3, y: 2.2 },
      },
      tolerance: 0.03,
      walls,
    }),
    true,
  )
})

test('wall crossing constraint rejects interior wall crossings', () => {
  const walls = [
    wall({
      id: 'fixed',
      end: { x: 2, y: 0 },
      start: { x: -2, y: 0 },
    }),
  ]

  assert.equal(
    wallDoesNotCrossOtherWalls({
      movingWall: {
        id: 'moving',
        start: { x: 0, y: -1 },
        end: { x: 0, y: 1 },
      },
      tolerance: 0.03,
      walls,
    }),
    false,
  )
})

test('wall crossing constraint allows endpoint-to-side attachment', () => {
  const walls = [
    wall({
      id: 'fixed',
      end: { x: 2, y: 0 },
      start: { x: -2, y: 0 },
    }),
  ]

  assert.equal(
    wallDoesNotCrossOtherWalls({
      movingWall: {
        id: 'moving',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
      },
      tolerance: 0.03,
      walls,
    }),
    true,
  )
})
