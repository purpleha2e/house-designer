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
