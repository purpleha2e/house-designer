import assert from 'node:assert/strict'
import test from 'node:test'
import type { SurfaceMaterialAssignment } from '../src/types.ts'
import { findWallFragmentAssignmentForFace } from '../src/wallFragmentAssignments.ts'

function assignment(fragmentId: string): SurfaceMaterialAssignment {
  return {
    id: `assignment-${fragmentId}`,
    materialId: 'paint',
    target: {
      fragmentId,
      side: 1,
      type: 'wall-surface-fragment',
      wallId: 'shared-wall',
    },
  }
}

function face(faceId: string) {
  return {
    faceId,
    pickSource: { side: 1 as const, wallId: 'shared-wall' },
  }
}

test('does not leak a current fragment assignment into another room fragment', () => {
  const roomA = assignment('room-a-fragment')

  assert.equal(
    findWallFragmentAssignmentForFace(
      [roomA],
      face('room-b-fragment'),
    ),
    undefined,
  )
  assert.equal(
    findWallFragmentAssignmentForFace(
      [roomA],
      face('room-a-fragment'),
    ),
    roomA,
  )
})

test('does not let a stale fragment assignment paint rebuilt neighbouring faces', () => {
  const stale = assignment('old-fragment-id')

  assert.equal(
    findWallFragmentAssignmentForFace(
      [stale],
      face('rebuilt-fragment-id'),
    ),
    undefined,
  )
})

test('roof regions inherit the original finish but a new A finish never paints B', () => {
  const original = assignment('facade')
  const left = assignment('facade:roof-region:/roof:0:above')
  const right = 'facade:roof-region:/roof:1:above'
  const hidden = 'facade:roof-region:/roof:0:below'
  assert.equal(findWallFragmentAssignmentForFace([original], face('facade:roof-region:/roof:0:above')), original)
  assert.equal(findWallFragmentAssignmentForFace([original, left], face(right)), original)
  assert.equal(findWallFragmentAssignmentForFace([left], face(right)), undefined)
  assert.equal(findWallFragmentAssignmentForFace([left], face(hidden)), undefined)
  assert.equal(findWallFragmentAssignmentForFace([left], face('facade')), undefined)
  assert.deepEqual(findWallFragmentAssignmentForFace(JSON.parse(JSON.stringify([left])),
    face('facade:roof-region:/roof:0:above')), left)
})

test('a moved roof boundary keeps the finish from the overlapping region only', () => {
  const prefix = 'perimeter-wall:shared-wall:1:side:'
  const brick = assignment(`${prefix}5.5807:6.6158:0:2.124:0:1.0351:roof-region:/roof:3:above`)
  const interior = assignment(`${prefix}5.5807:6.6158:0:2.124:0:1.0351:roof-region:/roof:3:below`)
  const rebuilt = face(`${prefix}5.7307:6.6158:0:2.124:0:0.8851:roof-region:/roof:3:above`)

  assert.equal(findWallFragmentAssignmentForFace([brick, interior], rebuilt), brick)
})

test('a stale fragment finish does not cross into a separate wall area', () => {
  const prefix = 'perimeter-wall:shared-wall:1:side:'
  const stale = assignment(`${prefix}1:2:0:2.4:0:1`)
  const rebuilt = face(`${prefix}3:4:0:2.4:0:1`)

  assert.equal(findWallFragmentAssignmentForFace([stale], rebuilt), undefined)
})

test('legacy wall IDs without UV bounds retain brick on rebuilt exterior panels', () => {
  const prefix = 'perimeter-wall:shared-wall:1:side:'
  const brick = assignment(`${prefix}-10.0652:-8.5674:0:2.4`)
  const opposite = { ...brick, id: 'opposite', materialId: 'interior',
    target: { ...brick.target, side: -1 as const } }
  for (const bounds of ['-10.0652:-9.9152:0:2.4:0:0.15', '-9.9152:-8.5674:0:2.4:0:1.3478']) {
    assert.equal(findWallFragmentAssignmentForFace([brick, opposite], face(`${prefix}${bounds}`)), brick)
  }
  assert.equal(findWallFragmentAssignmentForFace([brick], face(`${prefix}-8:-7:0:2.4:0:1`)), undefined)
})
