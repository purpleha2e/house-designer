import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildCeilingSlabFootprints, getSlabRenderedWalls } from '../src/ceilingSlabFootprint.ts'
import { buildWallBodyPerimeters } from '../src/wallEngine/wallBodyPerimeter.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { buildWallBodyPerimeterMeshFaces } from '../src/wallEngine/wallMesh.ts'
import { findFloorSlabSupportingWall } from '../src/floorSlabEdgeMaterial.ts'
import { getFloorEnvelopeWalls } from '../src/floorEnvelope.ts'
import type { Wall } from '../src/types.ts'

function wallLoop(points: Array<[number, number]>): Wall[] {
  return points.map(([x, y], index) => ({
    id: `wall-${index}`, kind: 'external', thickness: 0.3, height: 2.4,
    start: { x, y }, end: { x: points[(index + 1) % points.length][0], y: points[(index + 1) % points.length][1] },
  }))
}
const canonical = (points: Array<{x: number, y: number}>) =>
  points.map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort()

test('slab shares the rendered wall perimeter at convex and recessed corners', () => {
  const walls = wallLoop([[0,0], [6,0], [6,4], [4,4], [4,6], [0,6]])
  const slab = buildCeilingSlabFootprints(walls)
  const wallBody = buildWallBodyPerimeters(walls).perimeters[0]
  assert.equal(slab.length, 1)
  assert.deepEqual(canonical(slab[0]), canonical(wallBody.outline))
})

test('an interior branch cannot create a slab wedge or another exterior edge', () => {
  const walls = wallLoop([[0,0], [6,0], [6,4], [0,4]])
  const withoutBranch = buildCeilingSlabFootprints(walls)
  const withBranch = buildCeilingSlabFootprints([...walls, {
    id: 'branch', kind: 'external', thickness: 0.3, height: 2.4,
    start: { x: 0, y: 2 }, end: { x: 3, y: 2 },
  }])
  assert.deepEqual(canonical(withBranch[0]), canonical(withoutBranch[0]))
})

test('a saved endpoint gap cannot leave a slab notch under a snapped wall', () => {
  const walls = wallLoop([[0,0], [6,0], [6,6], [0,6], [0,2]])
  walls[4].start.y = 1.85
  const original = structuredClone(walls)
  // Independently obtain the centre lines used by prepareRenderedFloorData.
  const renderedWalls = [...buildWallTopology(walls).renderedWallsById.values()].map(r => r.wall)
  assert.notDeepEqual(renderedWalls, walls, 'fixture must exercise endpoint snapping')
  const expected = buildWallBodyPerimeters(renderedWalls).perimeters[0].outline
  const outline = buildCeilingSlabFootprints(walls)[0]
  assert.deepEqual(canonical(outline), canonical(expected))
  assert.equal(outline.length, 4, 'no notch or exposed return at the saved gap')
  assert.deepEqual(walls, original, 'never change the saved model')

  const point = { x: -0.15, y: 6.15 }
  const nextPoint = { x: -0.15, y: -0.15 }
  const support = findFloorSlabSupportingWall(point, nextPoint, getSlabRenderedWalls(walls))
  const face = buildWallBodyPerimeterMeshFaces(renderedWalls).find(f =>
    f.kind === 'side' && f.vertices.every(v => Math.abs(v.position[0] + 0.15) < 1e-6))
  assert.ok(face)
  assert.equal(support?.wall.id, face.materialSource.wallId, 'slab inherits from the rendered face owner')
  assert.equal(support?.side, face.materialSource.side)
})

test('copied red-house envelope produces no diagonal wedges or half-wall offset', () => {
  const project = JSON.parse(readFileSync(new URL('../red_house_2.json', import.meta.url), 'utf8'))
  const lowerWalls = project.floors[0].walls as Wall[]
  const upperWalls = getFloorEnvelopeWalls(lowerWalls).map(w => ({ ...w, openings: undefined }))
  // This is the case missed by the old tests: the wall union is open, but the
  // topology detector has a room polygon (already on the interior wall faces).
  assert.equal(buildWallBodyPerimeters(upperWalls).perimeters[0].holes.length, 0)
  const footprints = buildCeilingSlabFootprints(upperWalls, lowerWalls)
  assert.equal(footprints.length, 1)
  const outline = footprints[0]
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 1e-6, 'no repeated vertices')
    assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, 'orthogonal walls must not generate diagonal slab faces')
  }
  assert.ok(outline.some(p => Math.abs(p.x - 5.92) < 1e-6 && Math.abs(p.y - 1.35) < 1e-6))
  assert.ok(outline.some(p => Math.abs(p.x + 8.567388558) < 1e-6 && Math.abs(p.y + 3.369636025) < 1e-6))
})

test('single-floor shadow footprints match visible wall corners on both storeys', () => {
  const project = JSON.parse(readFileSync(new URL('../red_house_2.json', import.meta.url), 'utf8'))
  const groundWalls = project.floors[0].walls as Wall[]
  const upperWalls = getFloorEnvelopeWalls(groundWalls).map(w => ({ ...w, openings: undefined }))
  for (const walls of [groundWalls, upperWalls]) {
    // No supporting-floor fallback: this is the active-floor shadow-blocker path.
    const outline = buildCeilingSlabFootprints(walls)
    const topology = buildWallTopology(walls)
    const renderedWalls = [...topology.renderedWallsById.values()].map(r => r.wall)
    const visiblePerimeters = buildWallBodyPerimeters(renderedWalls).perimeters
    assert.equal(outline.length, 1)
    assert.deepEqual(canonical(outline[0]), canonical(visiblePerimeters[0].outline),
      'the invisible ceiling must neither overhang nor miss a visible wall corner')
  }
})

test('an empty upper floor does not create a slab and disconnected enclosures remain separate', () => {
  assert.deepEqual(buildCeilingSlabFootprints([]), [])
  const a = wallLoop([[0,0], [2,0], [2,2], [0,2]])
  const b = wallLoop([[5,0], [7,0], [7,2], [5,2]]).map(w => ({...w, id: `b-${w.id}`}))
  assert.equal(buildCeilingSlabFootprints([...a, ...b]).length, 2)
})
