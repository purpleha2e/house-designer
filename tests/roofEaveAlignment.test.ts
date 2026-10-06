import test from 'node:test'
import assert from 'node:assert/strict'
import { alignRoofEaveBases, ROOF_EAVE_HEIGHT_TOLERANCE, ROOF_EAVE_PLAN_TOLERANCE } from '../src/roofEaveAlignment.ts'
import { prismSolid, type ConvexSolid } from '../src/convexSolid.ts'
import { assembleRoofCells } from '../src/roofAssembly.ts'

function box(owner: string, x: number, bottom: number, z = 0): ConvexSolid {
  const cell = prismSolid([{ x, y: z }, { x: x + 1, y: z }, { x: x + 1, y: z + 1 }, { x, y: z + 1 }], bottom, 1, `${owner}/eaves`)!
  cell.faces.filter(f => f.plane[1] === 1).forEach(f => { f.tag = `${owner}/eave-base` })
  return cell
}
const bottom = (cell: ConvexSolid) => Math.min(...cell.faces.flatMap(f => f.points.map(p => p[1])))
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)

test('touching eaves use the lowest base through the tolerance boundary without altering their tops', () => {
  for (const difference of [0.042, ROOF_EAVE_HEIGHT_TOLERANCE, ROOF_EAVE_HEIGHT_TOLERANCE + 0.00001]) {
    const cells = [box('a', 0, 0), box('b', 1, difference)], saved = JSON.stringify(cells)
    const result = alignRoofEaveBases(cells, [['a', 'b']])
    near(bottom(result[0]), 0)
    near(bottom(result[1]), difference <= ROOF_EAVE_HEIGHT_TOLERANCE ? 0 : difference)
    for (let i = 0; i < cells.length; i++) {
      assert.deepEqual(result[i].faces.find(f => f.plane[1] === -1)?.points,
        cells[i].faces.find(f => f.plane[1] === -1)?.points)
    }
    assert.equal(JSON.stringify(cells), saved)
    assert.deepEqual(alignRoofEaveBases([...cells].reverse(), [['b', 'a']]).reverse(), result)
    const assembly = assembleRoofCells(result)
    assert.ok(assembly.edges.every(e => e.faces.length === 2), 'aligned boxes remain closed')
  }
})

test('nearby eaves align while separated roofs and roofs on other floors retain their heights', () => {
  near(bottom(alignRoofEaveBases([box('a', 0, 0), box('a', 1, 0.04)])[1]), 0)
  near(bottom(alignRoofEaveBases([box('a', 0, 0), box('b', 1, 0.04)])[1]), 0.04)
  for (const gap of [0.1, ROOF_EAVE_PLAN_TOLERANCE, ROOF_EAVE_PLAN_TOLERANCE + 0.00001]) {
    near(bottom(alignRoofEaveBases([box('a', 0, 0), box('b', 1 + gap, 0.04)], [['a', 'b']])[1]),
      gap <= ROOF_EAVE_PLAN_TOLERANCE ? 0 : 0.04)
  }
  near(bottom(alignRoofEaveBases([box('a', 0, 0), box('b', 1.25, 0.04, 1.25)], [['a', 'b']])[1]), 0.04)
})

test('a contact chain cannot pull a base beyond the height tolerance', () => {
  const cells = [box('a', 0, 0), box('a', 1, 0.2), box('a', 2, 0.4)]
  const result = alignRoofEaveBases(cells)
  result.forEach((cell, i) => assert.ok(bottom(cells[i]) - bottom(cell) <= ROOF_EAVE_HEIGHT_TOLERANCE))
  near(bottom(result[1]), 0); near(bottom(result[2]), 0.4)
  assert.deepEqual(alignRoofEaveBases([...cells].reverse()).reverse(), result)
})
