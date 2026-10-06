import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleRoofCells, roofPanelSolid } from '../src/roofAssembly.ts'
import { weldJoinedRoofCells } from '../src/roofSeamWelding.ts'

const panel = (id: string, z: number, offset: number) => roofPanelSolid(
  [[0, 1 + offset, z], [2, 2 + offset, z], [2, 2 + offset, z + 2], [0, 1 + offset, z + 2]],
  x => 0.8 + x / 2 + offset, `${id}/top`, `${id}/underside`, `${id}/shell`)!

test('joined slopes within construction tolerance share exact skin and underside planes', () => {
  const cells = [panel('a', 0, 0), panel('b', 2, 0.0004)]
  const original = JSON.stringify(cells)
  const welded = weldJoinedRoofCells(cells, [['a', 'b']])
  for (const part of ['top', 'underside']) {
    const planes = welded.map(cell => cell.faces.find(face => face.tag.endsWith(`/${part}`))!.plane)
    assert.deepEqual(planes[0], planes[1])
  }
  const assembly = assembleRoofCells(welded)
  assert.equal(assembly.edges.filter(edge => edge.faces.length !== 2).length, 0)
  assert.ok(!assembly.faces.some(face => face.points.every(p => Math.abs(p[2] - 2) < 1e-8)), 'no internal strip at the join')
  assert.ok(!assembly.faces.some(face => face.tag === 'assembly-bound'))
  assert.equal(JSON.stringify(cells), original, 'authoring cells are not mutated')
})

test('unjoined roofs, deliberate steps and separated slopes remain unchanged', () => {
  const unjoined = [panel('a', 0, 0), panel('b', 2, 0.0004)]
  assert.deepEqual(weldJoinedRoofCells(unjoined, []), unjoined)
  for (const other of [panel('b', 2, 0.02), panel('b', 4, 0.0004)]) {
    const cells = [panel('a', 0, 0), other]
    assert.deepEqual(weldJoinedRoofCells(cells, [['a', 'b']]), cells)
  }
})
