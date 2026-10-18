import assert from 'node:assert/strict'
import test from 'node:test'
import { fitStairOpeningToWalls, fitStairOpeningFootprints } from '../src/stairOpeningFit.ts'
import { getSlabOpeningRevealHeights, splitSlabOpeningRevealsAtWalls } from '../src/slabOpeningReveals.ts'
import { pointIsInsideRoomPolygon } from '../src/roomLightMask.ts'
import { getStairSlabOpenings } from '../src/stairSlabOpenings.ts'
import type { FloorLevel, Point, Wall } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const wall = (x: number, y: number, x2: number, y2: number, thickness = .2): Wall => ({ id: 'wall', kind: 'internal',
  start: { x, y }, end: { x: x2, y: y2 }, height: 2.4, thickness })
const floor = (id: string, elevation: number, walls: Wall[]): FloorLevel => ({ id, name: id, elevation, walls,
  models: [], rooms: [], slabThickness: .3, roomHeight: 2.4 })
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} versus ${expected}`)

test('nearby walls expand a stair opening without shrinking the stair envelope or moving the model', () => {
  const polygon = rectangle(0, 0, 1, 3), before = structuredClone(polygon)
  const fitted = fitStairOpeningToWalls(polygon, [wall(1.13, -1, 1.13, 4), wall(-.11, -1, -.11, 4)])
  near(Math.min(...fitted.map(p => p.x)), -.01); near(Math.max(...fitted.map(p => p.x)), 1.03)
  assert.deepEqual(polygon, before)
  near(Math.min(...fitted.map(p => p.y)), 0); near(Math.max(...fitted.map(p => p.y)), 3)
})

test('intentional landings and short partitions are preserved', () => {
  const polygon = rectangle(0, 0, 1, 3)
  for (const walls of [[wall(1.18, -1, 1.18, 4)], [wall(1.13, 0, 1.13, 1)]]) {
    assert.deepEqual(fitStairOpeningToWalls(polygon, walls), polygon)
  }
})

test('offset walls retain their occupied support instead of exposing a hole beneath a wall base', () => {
  const polygon = rectangle(0, 0, 1, 3)
  const fitted = fitStairOpeningToWalls(polygon, [wall(1.08, -1, 1.08, 4), wall(1.13, -1, 1.13, 4)])
  near(Math.max(...fitted.map(p => p.x)), .98)
  near(Math.min(...fitted.map(p => p.x)), 0)
  assert.deepEqual(polygon, rectangle(0, 0, 1, 3))
})

test('a partial offset wall makes a closed notch exactly at its end, rather than a hole beneath its base', () => {
  const [opening] = fitStairOpeningFootprints(rectangle(0, 0, 2, 3), [wall(2.12, -1, 2.12, 4), wall(2.09, 1, 2.09, 4)])
  assert.equal(pointIsInsideRoomPolygon({ x: 2, y: .5 }, opening), true)
  assert.equal(pointIsInsideRoomPolygon({ x: 2, y: 2 }, opening), false)
  assert.equal(pointIsInsideRoomPolygon({ x: 1.98, y: 2 }, opening), true)
  const lower = floor('lower', 0, [wall(1.1, 1, 1.1, 4)])
  const upper = floor('upper', 2.7, [wall(1.1, -1, 1.1, 4)])
  const edges = splitSlabOpeningRevealsAtWalls([{ point: { x: 1, y: 0 }, nextPoint: { x: 1, y: 3 } }], [...lower.walls, ...upper.walls])
  assert.equal(edges.length, 2)
  assert.deepEqual(edges.map(edge => getSlabOpeningRevealHeights(edge, lower, upper, 2.38, 2.712)),
    [{ bottom: 2.38, top: 2.7 }, { bottom: 2.4, top: 2.7 }])
  near(edges[0].nextPoint.y, edges[1].point.y)
  near(edges.at(-1)!.nextPoint.y, 3)
})

test('fitting remains correct for reversed winding and rotated stairs and walls', () => {
  const rotate = (p: Point) => ({ x: 10 + (p.x - p.y) / Math.SQRT2, y: 20 + (p.x + p.y) / Math.SQRT2 })
  const polygon = rectangle(0, 0, 1, 3), source = wall(1.13, -1, 1.13, 4)
  const fitted = fitStairOpeningToWalls(polygon.toReversed().map(rotate), [{ ...source, start: rotate(source.start), end: rotate(source.end) }])
  const expected = rectangle(0, 0, 1.03, 3).toReversed().map(rotate)
  fitted.forEach((p, i) => { near(p.x, expected[i].x); near(p.y, expected[i].y) })
})

test('both storeys guide the shared cutout despite offset walls at opposite ends', () => {
  const lower = floor('lower', 0, [wall(0, -.057, 3, -.057, .1)])
  const upper = floor('upper', 2.7, [wall(0, 3.169, 3, 3.169, .3)])
  lower.models = [{ id: 'stairs', modelId: 'stairs', position: { x: 1.5, y: 1.5 }, rotation: 0, scale: 1 }]
  const definition: ModelDefinition = { id: 'stairs', name: 'Stairs', category: 'Stairs', objectType: 'stairs', shape: 'box',
    width: 2, depth: 3, height: 2.7, color: '#fff' }
  const [opening] = getStairSlabOpenings(lower, upper, [lower, upper], new Map([['stairs', definition]]))
  near(Math.min(...opening.map(p => p.y)), -.007); near(Math.max(...opening.map(p => p.y)), 3.019)
  assert.deepEqual(lower.models[0].position, { x: 1.5, y: 1.5 })
})

test('flush linings meet wall ends without overlapping wall faces or projecting above the finished floor', () => {
  const edge = { point: { x: 1, y: 0 }, nextPoint: { x: 1, y: 3 } }
  const lower = floor('lower', 0, [wall(1.1, -1, 1.1, 4)])
  const upper = floor('upper', 2.7, [wall(1.08, -1, 1.08, 4)])
  assert.deepEqual(getSlabOpeningRevealHeights(edge, lower, upper, 2.38, 2.712), { bottom: 2.4, top: 2.7 })
  assert.deepEqual(getSlabOpeningRevealHeights(edge, floor('free', 0, []), null, 2.38, 2.712), { bottom: 2.38, top: 2.712 })
  lower.walls[0].height = 3
  const covered = getSlabOpeningRevealHeights(edge, lower, upper, 2.38, 2.712)
  assert.ok(covered.bottom >= covered.top, 'a wall occupying the entire assembly needs no duplicate lining')
})
