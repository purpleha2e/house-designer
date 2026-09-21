import assert from 'node:assert/strict'
import test from 'node:test'
import { pickTargetFromColorBuffer } from '../src/pickNeighborhood.ts'

type Target = { name: string; priority: number }

function buffer(...ids: number[]) {
  return new Uint8Array(ids.flatMap(id => [id >> 16, (id >> 8) & 255, id & 255, 255]))
}

const floor = { name: 'floor', priority: 0 }
const wall = { name: 'wall', priority: 2 }
const secondWall = { name: 'second wall', priority: 2 }
const model = { name: 'model', priority: 4 }
const targets = new Map<number, Target>([[1, floor], [2, wall], [3, model], [4, secondWall]])
const pick = (pixels: Uint8Array, centerX = 1, centerY = 1) => pickTargetFromColorBuffer({
  centerX, centerY, getPriority: target => target.priority, height: 3,
  pixels, targetByColorId: targets, width: 3,
})

test('a thin wall beside the pointer wins over a broad floor background', () => {
  assert.equal(pick(buffer(1, 1, 1, 1, 1, 2, 1, 1, 1))?.target, wall)
})

test('an exact wall hit is retained instead of selecting a nearby model', () => {
  assert.equal(pick(buffer(1, 1, 3, 1, 2, 1, 1, 1, 1))?.target, wall)
})

test('the nearest candidate wins when priorities match', () => {
  assert.equal(pick(buffer(0, 2, 0, 0, 4, 0, 0, 0, 0), 0, 1)?.target, secondWall)
})

test('an empty color neighborhood produces no target', () => {
  assert.equal(pick(buffer(0, 0, 0, 0, 0, 0, 0, 0, 0)), null)
})

test('a nearby floor does not replace an exact miss', () => {
  assert.equal(pick(buffer(0, 1, 0, 0, 0, 0, 0, 0, 0)), null)
})
