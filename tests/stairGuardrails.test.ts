import assert from 'node:assert/strict'
import test from 'node:test'
import type { Mesh } from 'three'
import { createStairDesign, getStairLayout, validateStairDesign, type StairDesign } from '../src/stairDesign.ts'
import { createStairGeometry, disposeStairGeometry } from '../src/stairGeometry.ts'
import { getStairGuardrailOpening, getStairGuardrailPaths } from '../src/stairGuardrails.ts'
import { getStairRailPath } from '../src/stairRailings.ts'
import { stairDefinition } from '../src/stairDefinition.ts'
import { getStairLandingPosition } from '../src/stairLandings.ts'
import { getStairSlabOpenings } from '../src/stairSlabOpenings.ts'
import { getOpenStairwellGuardrails, usesAutomaticStairwellGuardrails } from '../src/stairwellGuardrails.ts'
import { bounds, pointInPolygon } from '../src/assistant/planGeometry.ts'
import type { FloorLevel, PlacedModel, Wall } from '../src/types.ts'

test('the return joins the top newel and stays level on the floor above a short flight', () => {
  const original: StairDesign = { ...createStairDesign(2.4), width: .8,
    banisters: { left: false, right: true }, handrails: { left: false, right: true } }
  const design: StairDesign = { ...original, upperGuardrail: { side: 'right', oppositeEnd: true, setback: .1 } }
  const height = 2.6
  assert.ok(height > design.totalRise)
  const layout = getStairLayout(design)
  assert.deepEqual(layout, getStairLayout(original), 'the stair footprint and landings stay the same')
  const { side, oppositeEnd } = getStairGuardrailPaths(design, layout, height)
  const newel = getStairRailPath(design, layout, 'right').at(-1)!
  assert.deepEqual(side[0], { ...newel, y: height })
  assert.deepEqual(side.at(-1), oppositeEnd.at(-1), 'both rails share the same outside corner')
  assert.equal(oppositeEnd[0].x, layout.bounds.minX, 'the free end lines up with the opposite tread edge')
  const opening = getStairGuardrailOpening(design, layout)!
  assert.deepEqual(opening.polygon, [
    { x: layout.bounds.minX, z: oppositeEnd[0].z + design.postWidth / 2 },
    { x: side[1].x - design.postWidth / 2, z: oppositeEnd[0].z + design.postWidth / 2 },
    { x: side[1].x - design.postWidth / 2, z: layout.bounds.maxZ },
    { x: layout.bounds.minX, z: layout.bounds.maxZ },
  ])

  const full = createStairGeometry(design, { upperFloorHeight: height })
  const upperOnly = createStairGeometry(design, { upperFloorHeight: height, guardrailOnly: true })
  try {
    assert.deepEqual(upperOnly.children.map(child => child.name), ['stair-spindles', 'stair-posts', 'stair-handrails'])
    const posts = (upperOnly.getObjectByName('stair-posts') as Mesh).geometry
    assert.equal(posts.getAttribute('position').count / 36, 4, 'one shared newel at each rail junction')
    assert.equal((full.getObjectByName('stair-posts') as Mesh).geometry.getAttribute('position').count / 36, 5)
    const spindles = (upperOnly.getObjectByName('stair-spindles') as Mesh).geometry.boundingBox!
    const rail = (upperOnly.getObjectByName('stair-handrails') as Mesh).geometry.boundingBox!
    assert.ok(Math.abs(spindles.min.y - height) < 1e-6)
    assert.ok(Math.abs(rail.min.y - (height + design.railHeight - design.handrailWidth / 2)) < 1e-6)
    assert.ok(Math.abs(rail.max.y - (height + design.railHeight + design.handrailWidth / 2)) < 1e-6)
  } finally {
    disposeStairGeometry(full)
    disposeStairGeometry(upperOnly)
  }
})

test('the side and far-end guardrails are independent', () => {
  const design = createStairDesign()
  const endOnly: StairDesign = { ...design, banisters: { left: false, right: false }, handrails: { left: false, right: false },
    upperGuardrail: { oppositeEnd: true, setback: .1 } }
  const endLayout = getStairLayout(endOnly)
  const endPaths = getStairGuardrailPaths(endOnly, endLayout)
  assert.deepEqual(endPaths.side, [])
  assert.deepEqual(endPaths.oppositeEnd.map(point => point.x), [endLayout.bounds.minX, endLayout.bounds.maxX])
  assert.ok(endPaths.oppositeEnd.every(point => point.z < endLayout.bounds.minZ))
  const endOpening = getStairGuardrailOpening(endOnly, endLayout)!.polygon
  assert.equal(Math.max(...endOpening.map(point => point.x)), endLayout.bounds.maxX)
  assert.equal(Math.min(...endOpening.map(point => point.z)), endPaths.oppositeEnd[0].z + design.postWidth / 2)

  const leftOnly: StairDesign = { ...design, upperGuardrail: { side: 'left', length: 1.2, setback: .1 } }
  const leftLayout = getStairLayout(leftOnly)
  const leftPaths = getStairGuardrailPaths(leftOnly, leftLayout)
  assert.deepEqual(leftPaths.oppositeEnd, [])
  assert.equal(leftPaths.side[1].x, leftLayout.bounds.minX - .1)
  assert.equal(leftPaths.side[2].z, leftLayout.upper.z - 1.2)
  const notch = getStairGuardrailOpening(leftOnly, leftLayout)!.polygon
  assert.equal(notch.length, 6)
  assert.equal(notch[1].x, leftLayout.bounds.minX, 'the opening stays the stair width below the shortened side rail')
  assert.equal(notch[3].x, leftPaths.side[2].x + design.postWidth / 2)
  assert.equal(notch[3].z, leftPaths.side[2].z + design.postWidth / 2)
  const leftWithEnd: StairDesign = { ...design, upperGuardrail: { side: 'left', oppositeEnd: true, setback: .1 } }
  const leftWithEndPaths = getStairGuardrailPaths(leftWithEnd, getStairLayout(leftWithEnd))
  assert.deepEqual(leftWithEndPaths.oppositeEnd[0], leftWithEndPaths.side.at(-1))
  assert.equal(leftWithEndPaths.oppositeEnd[1].x, leftLayout.bounds.maxX)
  assert.equal(getStairGuardrailPaths(design, getStairLayout(design)).side.length, 0)
  assert.match(validateStairDesign({ ...endOnly, upperGuardrail: { side: 'left', setback: .1 } })!, /chosen side/)
  assert.match(validateStairDesign({ ...leftOnly, upperGuardrail: { side: 'left', setback: .01 } })!, /setback/)
})

function openWell(layout: StairDesign['layout'], transform: Partial<PlacedModel> = {}) {
  const design = { ...createStairDesign(), layout }
  const definition = stairDefinition('agent-123-2-stair-variety', 'Assistant staircase', design)
  const stair: PlacedModel = { id: 'stair', modelId: definition.id, position: { x: 0, y: 0 }, rotation: 0, scale: 1, ...transform }
  const lower: FloorLevel = { id: 'down', name: 'Down', elevation: 0, roomHeight: 2.45, slabThickness: .25, models: [stair], walls: [], rooms: [] }
  const upper = { ...lower, id: 'up', elevation: 2.7, models: [] }
  const footprints = [[{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }]]
  const openings = getStairSlabOpenings(lower, upper, [lower], new Map([[definition.id, definition]]))
  const rails = (walls: Wall[] = []) => getOpenStairwellGuardrails(stair, definition, openings, footprints, walls)
  return { design, definition, stair, openings, rails }
}

test('an open U stair has a level upper guard around the aperture with a gap only at its arriving flight', () => {
  const { design, definition, stair, openings, rails } = openWell('u')
  assert.equal(usesAutomaticStairwellGuardrails(definition), true)
  assert.equal(usesAutomaticStairwellGuardrails({ ...definition, id: 'my-manual-stair' }), false)
  const [path, ...rest] = rails()
  assert.equal(rest.length, 0, 'returns should form one connected guard')
  const limits = bounds(openings[0])
  const exit = getStairLandingPosition(stair, definition, 'upper')
  assert.ok(path.every(point => point.y === 0 && !pointInPolygon({ x: point.x, y: point.z }, openings[0])))
  assert.ok(path.some(point => point.z < limits.minY && point.x < exit.x - design.width / 2),
    'guard the opening above the lower flight')
  assert.ok(path.slice(1).every((end, i) => {
    const start = path[i]
    return !(start.z < exit.y && end.z < exit.y && Math.min(start.x, end.x) < exit.x && Math.max(start.x, end.x) > exit.x)
  }), 'leave the top of the upper flight open')
  const mesh = createStairGeometry(design, { guardrailOnly: true, openingGuardrails: [path] })
  try {
    assert.equal(mesh.getObjectByName('stair-treads'), undefined)
    assert.ok(Math.abs((mesh.getObjectByName('stair-posts') as Mesh).geometry.boundingBox!.min.y) < 1e-6)
  } finally { disposeStairGeometry(mesh) }
})

test('open-edge guarding skips the part protected by a wall and follows all parts of a flipped L-shaped cutout', () => {
  const { openings, rails } = openWell('straight')
  const { minX, minY } = bounds(openings[0])
  const wall: Wall = { id: 'guard-wall', kind: 'internal', height: 2.4, thickness: .15,
    start: { x: minX - .075, y: minY }, end: { x: minX - .075, y: 0 } }
  const leftRuns = rails([wall]).flatMap(path => path.slice(1).flatMap((end, i) => {
    const start = path[i]
    return start.x < minX && end.x < minX ? [(start.z + end.z) / 2] : []
  }))
  assert.ok(leftRuns.some(y => y > 0.2), 'keep the exposed portion')
  assert.ok(leftRuns.every(y => y < minY || y > 0), 'guardrail stops where the wall takes over')

  const mirrored = openWell('l', { position: { x: 3, y: 2 }, rotation: Math.PI / 2, mirrored: true, flipped: true })
  assert.equal(mirrored.openings.length, 3)
  const paths = mirrored.rails()
  assert.equal(paths.length, 1, 'internal seams between the cutout fragments are joined')
  assert.ok(paths[0].length >= 6)
  assert.ok(paths[0].every(({ x, z }) => !mirrored.openings.some(opening => pointInPolygon({ x, y: z }, opening))))
})
