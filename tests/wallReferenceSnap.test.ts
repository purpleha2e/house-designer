import assert from 'node:assert/strict'
import test from 'node:test'
import { snapWallTranslationToReferences } from '../src/wallReferenceSnap.ts'
import type { Wall } from '../src/types.ts'
const wall = (x: number, y: number, x2: number, y2: number): Wall => ({ id: 'reference', kind: 'internal', thickness: .1,
  height: 2.4, start: { x, y }, end: { x: x2, y: y2 } })

test('moving a wall aligns exactly across storeys despite different lengths and off-grid coordinates', () => {
  const moving = wall(1, 2.04, 4, 2.04), reference = wall(0, 2.173, 5, 2.173)
  const snap = snapWallTranslationToReferences([moving], { x: .2, y: .1 }, [reference], .1)!
  assert.ok(Math.abs(moving.start.y + snap.delta.y - reference.start.y) < 1e-10)
  assert.equal(snap.delta.x, .2)
  assert.equal(moving.end.x - moving.start.x, 3)
  assert.equal(snap.reference, reference)
})

test('cross-floor alignment works for diagonal walls without translating along the wall', () => {
  const snap = snapWallTranslationToReferences([wall(0, 0, 2, 2)], { x: 0, y: 0 }, [wall(0, 1, 2, 3)], 1)!
  assert.ok(Math.abs(snap.delta.x + .5) < 1e-10)
  assert.ok(Math.abs(snap.delta.y - .5) < 1e-10)
})

test('distant, nonparallel and nonoverlapping walls do not attract an existing wall', () => {
  const moving = wall(0, 0, 2, 0), delta = { x: .1, y: .1 }
  for (const reference of [wall(0, 1, 2, 1), wall(1, -1, 1, 1), wall(5, .12, 7, .12)]) {
    assert.equal(snapWallTranslationToReferences([moving], delta, [reference], .1), null)
  }
})

test('the nearest reference supplies one rigid delta for a wall selection and its connected endpoints', () => {
  const moving = [wall(0, 0, 2, 0), wall(2, 0, 2, 2)], references = [wall(0, .18, 3, .18), wall(2.12, -1, 2.12, 3)]
  const snap = snapWallTranslationToReferences(moving, { x: .1, y: .1 }, references, .1)!
  assert.equal(snap.reference, references[1]); assert.ok(Math.abs(snap.delta.x - .12) < 1e-10)
  assert.equal(snap.delta.y, .1)
})
