import assert from 'node:assert/strict'
import test from 'node:test'
import { editWindowClearance, getWindowClearances, parseClearanceDistance } from '../src/windowClearances.ts'
import type { Wall } from '../src/types.ts'

const wall: Wall = { id: 'host', kind: 'external', start: { x: 0, y: 0 }, end: { x: 8, y: 0 }, thickness: .3, height: 2.7,
  openings: [{ id: 'selected:0', modelId: 'window', center: 3, width: 1.2, bottom: .8, height: 1.4 }] }
const input = { wall, walls: [wall], modelId: 'selected', center: 3, width: 1.2, bottom: .8, height: 1.4, ceiling: 2.7, side: 1 as const }
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

test('clearances use opening edges, ignore the selected opening, and follow horizontal/vertical motion', () => {
  const original = getWindowClearances(input)
  ;[2.4, 4.4, .8, .5].forEach((value, i) => close(original[i].distance, value))
  const moved = getWindowClearances({ ...input, center: 3.25, bottom: 1 })
  ;[2.65, 4.15, 1, .3].forEach((value, i) => close(moved[i].distance, value))
})

test('nearest neighbouring opening wins, but openings entirely above/below are ignored', () => {
  const host = { ...wall, openings: [...wall.openings!,
    { id: 'neighbour:0', modelId: 'window', center: 5, width: 1, bottom: 1.5, height: 1 },
    { id: 'high:0', modelId: 'window', center: 4, width: .4, bottom: 2.5, height: .2 },
  ] }
  const right = getWindowClearances({ ...input, wall: host })[1]
  close(right.distance, .9); assert.equal(right.target, 'opening')
  assert.ok(right.from[1] >= 1.5, 'line meets both overlapping opening edges')
})

test('internal partition faces bound indoor rulers without affecting the exterior', () => {
  const partition: Wall = { id: 'partition', kind: 'internal', start: { x: 1, y: 0 }, end: { x: 1, y: 4 }, thickness: .2, height: 2.7 }
  const walls = [wall, partition]
  close(getWindowClearances({ ...input, walls, side: 1 })[0].distance, 1.3)
  close(getWindowClearances({ ...input, walls, side: -1 })[0].distance, 2.4)
})

test('diagonal walls and rotated hosts measure wall faces in metres', () => {
  const rotate = (point: { x: number; y: number }) => ({ x: (point.x - point.y) / Math.SQRT2 + 10, y: (point.x + point.y) / Math.SQRT2 - 4 })
  const host = { ...wall, start: rotate(wall.start), end: rotate(wall.end) }
  const partition: Wall = { id: 'partition', kind: 'internal', start: rotate({ x: 1, y: 0 }), end: rotate({ x: 1, y: 4 }), thickness: .2, height: 2.7 }
  close(getWindowClearances({ ...input, wall: host, walls: [host, partition] })[0].distance, 1.3)
})

test('touching boundaries show zero, with no negative or invalid rulers', () => {
  const rulers = getWindowClearances({ ...input, center: .6, bottom: 0, height: 2.7 })
  close(rulers[0].distance, 0); close(rulers[2].distance, 0); close(rulers[3].distance, 0)
  assert.deepEqual(getWindowClearances({ ...input, wall: { ...wall, end: wall.start } }), [])
})

test('manual distances accept metres, centimetres and millimetres, rejecting invalid input', () => {
  for (const text of ['.45', '0.45 m', '45cm', '450 mm']) close(parseClearanceDistance(text), .45)
  assert.equal(parseClearanceDistance('0'), 0)
  for (const text of ['', '-1', 'Infinity', '1foo', '1.2.3']) assert.throws(() => parseClearanceDistance(text))
})

test('editing a clearance moves the opening without resizing it', () => {
  for (const [kind, distance] of [['left', 1.234], ['right', 2.345], ['sill', .95], ['head', .15]] as const) {
    const placement = editWindowClearance(input, kind, distance)
    const after = getWindowClearances({ ...input, ...placement }).find(m => m.kind === kind)!
    close(after.distance, distance)
  }
})

test('manual positioning cannot cross neighbouring openings, walls, floor or ceiling', () => {
  const host = { ...wall, openings: [...wall.openings!, { id: 'other:0', modelId: 'window', center: 5, width: 1, bottom: .5, height: 1.5 }] }
  assert.throws(() => editWindowClearance({ ...input, wall: host }, 'left', 4), /cross/)
  assert.throws(() => editWindowClearance(input, 'right', 8), /cross/)
  assert.throws(() => editWindowClearance(input, 'sill', 2), /fit/)
  assert.throws(() => editWindowClearance(input, 'head', 3), /fit/)
  const stacked = { ...wall, openings: [...wall.openings!, { id: 'other:0', modelId: 'window', center: 3, width: 1, bottom: 2.3, height: .3 }] }
  assert.throws(() => editWindowClearance({ ...input, wall: stacked }, 'head', 0), /overlap/)
})
