import assert from 'node:assert/strict'
import test from 'node:test'
import { subtractPlanCutouts } from '../src/planarCutouts.ts'
import { getSlabOpeningRevealEdges, trimSlabRevealsAtStairs } from '../src/slabOpeningReveals.ts'
import { readFileSync } from 'node:fs'
import type { FloorLevel } from '../src/types.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'

const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const floor = rectangle(0, 0, 6, 6)
const length = (edges: ReturnType<typeof getSlabOpeningRevealEdges>) => edges.reduce((sum, { point: a, nextPoint: b }) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)

test('a stair hole gets one continuous set of reveals with shared offset corners', () => {
  const opening = rectangle(1, 1, 2, 3), footprints = subtractPlanCutouts(floor, [opening])
  const edges = getSlabOpeningRevealEdges(footprints, [opening])
  assert.equal(edges.length, 4)
  for (const e of edges) assert.ok(edges.some(other => Math.hypot(e.nextPoint.x - other.point.x, e.nextPoint.y - other.point.y) < 1e-8))
  for (const p of edges.flatMap(e => [e.point, e.nextPoint])) assert.ok(p.x > 1 && p.x < 3 && p.y > 1 && p.y < 4)
})

test('a stair cut which meets the slab boundary still gets all three exposed edge faces', () => {
  const opening = rectangle(-1, 2, 3, 2), footprints = subtractPlanCutouts(floor, [opening])
  assert.equal(footprints[0].holes.length, 0, 'the opening is a notch, rather than a hole')
  const edges = getSlabOpeningRevealEdges(footprints, [opening], 0)
  assert.equal(edges.length, 3)
  assert.ok(Math.abs(length(edges) - 6) < 1e-6)
})

test('adjoining cuts have no duplicate reveal edges or faces across the opening', () => {
  const cuts = [rectangle(-1, 2, 3, 2), rectangle(2, 3, 2, 2)]
  const edges = getSlabOpeningRevealEdges(subtractPlanCutouts(floor, cuts), cuts, 0)
  const keys = edges.map(e => [e.point, e.nextPoint].map(p => `${p.x},${p.y}`).sort().join('|'))
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(!edges.some(e => e.point.x === 2 && e.nextPoint.x === 2 && Math.min(e.point.y, e.nextPoint.y) < 4 && Math.max(e.point.y, e.nextPoint.y) > 3))
})

test('saved Colin stair final riser owns its face without removing the rest of the slab lining', () => {
  const project = JSON.parse(readFileSync(new URL('../colin_house_v2.json', import.meta.url), 'utf8'))
  const floors = project.floors as FloorLevel[]
  const definitions = new Map((project.modelDefinitions as ModelDefinition[]).map(d => [d.id, d]))
  const stair = floors[0].models.find(m => definitions.get(m.modelId)?.stairDesign)!
  const panel = { point: { x: stair.position.x - 1, y: stair.position.y - .9 },
    nextPoint: { x: stair.position.x - 1, y: stair.position.y + .9 }, bottom: 2.38, top: 2.712 }
  const panels = trimSlabRevealsAtStairs([panel], floors, definitions)
  const covers = (z: number, y: number) => panels.some(p =>
    z > Math.min(p.point.y, p.nextPoint.y) && z < Math.max(p.point.y, p.nextPoint.y) && y > p.bottom && y < p.top)
  assert.equal(covers(stair.position.y - .4, 2.6), false, 'no lining through the carpeted riser')
  assert.equal(covers(stair.position.y - .4, 2.69), true, 'lining above the riser remains')
  assert.equal(covers(stair.position.y - .4, 2.45), true, 'lining below the riser remains')
  assert.equal(covers(stair.position.y + .4, 2.6), true, 'the adjacent open half remains closed')
  assert.equal(trimSlabRevealsAtStairs([{ ...panel, point: { ...panel.point, x: panel.point.x - .01 },
    nextPoint: { ...panel.nextPoint, x: panel.nextPoint.x - .01 } }], floors, definitions).length, 1,
    'a separate parallel slab edge is untouched')
  definitions.get(stair.modelId)!.stairDesign!.closedRisers = false
  assert.deepEqual(trimSlabRevealsAtStairs([panel], floors, definitions), [panel])
})
