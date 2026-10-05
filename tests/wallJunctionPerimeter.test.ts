import assert from 'node:assert/strict'
import test from 'node:test'
import type { Point, Wall } from '../src/types.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { buildWallBodyPerimeters } from '../src/wallEngine/wallBodyPerimeter.ts'
import { buildWallBodyPerimeterMeshFaces } from '../src/wallEngine/wallMesh.ts'

// The four arms of the floor_test junction, translated to the origin. The
// fourth endpoint is slightly offset in the saved data and snapped in views.
function junctionWalls(): Wall[] {
  return [
    { id: 'left', start: { x: -2.5, y: -2.5 }, end: { x: 0, y: 0 } },
    { id: 'right', start: { x: 0, y: 0 }, end: { x: 2.5, y: -2.5 } },
    { id: 'shallow', start: { x: 4.969217750357333, y: 0.873472041376390 }, end: { x: 0, y: 0 } },
    { id: 'continuation', start: { x: 0.033333333333333, y: -0.0625 }, end: { x: 2.445353327959379, y: 1.866568628299054 } },
  ].map((wall) => ({ ...wall, kind: 'external', thickness: 0.3, height: 2.4 }))
}

function isWallSide(start: Point, end: Point, wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  const offset = (point: Point) =>
    ((point.x - wall.start.x) * -dy + (point.y - wall.start.y) * dx) / length
  return Math.abs(offset(start) - offset(end)) < 1e-6 &&
    Math.abs(Math.abs(offset(start)) - wall.thickness / 2) < 1e-6
}

function sortedPoints(points: Point[]) {
  return points.map(({ x, y }) => [Number(x.toFixed(6)), Number(y.toFixed(6))])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

for (const snapped of [false, true]) {
  test(`four-way external junction has continuous wall faces (${snapped ? 'snapped' : 'saved'} endpoints)`, () => {
    const source = junctionWalls()
    const walls = snapped
      ? [...buildWallTopology(source, { detectRooms: false }).renderedWallsById.values()].map(({ wall }) => wall)
      : source
    const plan = buildWallBodyPerimeters(walls)
    assert.deepEqual(plan.diagnostics, [])
    assert.equal(plan.perimeters.length, 1)
    assert.equal(plan.perimeters[0].holes.length, 0)
    const outline = plan.perimeters[0].outline
    // Four miters and two corners at each of the four free ends.
    assert.equal(outline.length, 12)
    for (const [index, start] of outline.entries()) {
      const end = outline[(index + 1) % outline.length]
      if (Math.min(Math.hypot(start.x, start.y), Math.hypot(end.x, end.y)) > 1.2) continue
      assert.ok(walls.some((wall) => isWallSide(start, end, wall)),
        `Unexpected bevel or step at ${JSON.stringify({ start, end })}`)
    }

    // Each arm must choose the same neighbouring faces whichever way it was drawn.
    for (let mask = 0; mask < 16; mask++) {
      const reversed = walls.map((wall, index) => mask & (1 << index)
        ? { ...wall, start: wall.end, end: wall.start }
        : wall).reverse()
      const other = buildWallBodyPerimeters(reversed)
      assert.equal(other.perimeters.length, 1)
      assert.deepEqual(sortedPoints(other.perimeters[0].outline), sortedPoints(outline))
    }

    const faces = buildWallBodyPerimeterMeshFaces(walls)
    for (const face of faces.filter((face) => face.kind === 'side')) {
      const start = { x: face.vertices[0].position[0], y: face.vertices[0].position[2] }
      const endVertex = face.vertices.find(({ position }) =>
        Math.hypot(position[0] - start.x, position[2] - start.y) > 1e-6)
      if (!endVertex) continue
      const end = { x: endVertex.position[0], y: endVertex.position[2] }
      if (Math.min(Math.hypot(start.x, start.y), Math.hypot(end.x, end.y)) > 1.2) continue
      assert.ok(walls.some((wall) => isWallSide(start, end, wall)),
        `3D junction has an extra facet: ${face.faceId}`)
    }
  })
}

for (const kind of ['external', 'internal'] as const) {
  for (const pointed of [true, false]) {
    test(`${kind} two-wall corners ${pointed ? 'meet at a point from 45 degrees' : 'have one chamfer below 45 degrees'}`, () => {
      for (const degrees of pointed ? [45, 45.01, 60, 75, 90, 120, 175] : [44.99, 30, 15, 5]) {
        for (const thickness of [0.15, 0.3, 1.2]) {
          const angle = degrees * Math.PI / 180
          const half = thickness / 2
          const inner = { x: half / Math.tan(angle / 2), y: half }
          const outer = { x: -inner.x, y: -half }
          const walls: Wall[] = [
            { id: 'first', start: { x: 40, y: 0 }, end: { x: 0, y: 0 }, kind, thickness, height: 2.4 },
            { id: 'second', start: { x: 0, y: 0 }, end: { x: 40 * Math.cos(angle), y: 40 * Math.sin(angle) }, kind, thickness, height: 2.4 },
          ]
          const result = buildWallBodyPerimeters(walls)
          assert.deepEqual(result.diagnostics, [])
          assert.equal(result.perimeters.length, 1)
          const outline = result.perimeters[0].outline
          assert.equal(outline.length, pointed ? 6 : 7, `${degrees} degrees, thickness ${thickness}`)
          const contains = (point: Point) => outline.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 1e-7)
          assert.ok(contains(inner), 'inner edges must meet without a cap or notch')
          if (pointed) {
            assert.ok(contains(outer), 'outer edges must converge at their true intersection')
          } else {
            assert.ok(!contains(outer), 'acute tip must be cut off')
            const bisector = { x: -Math.cos(angle / 2), y: -Math.sin(angle / 2) }
            const limit = half / Math.sin(Math.PI / 8)
            const projection = (point: Point) => point.x * bisector.x + point.y * bisector.y
            assert.ok(outline.every(p => projection(p) <= limit + 1e-7))
            assert.equal(outline.filter(p => Math.abs(projection(p) - limit) < 1e-7).length, 2,
              'one straight chamfer must connect both outer edges')
          }
          // Changing drawing direction must never change which faces meet.
          for (let mask = 1; mask < 4; mask++) {
            const reversed = walls.map((wall, index) => mask & (1 << index)
              ? { ...wall, start: wall.end, end: wall.start } : wall).reverse()
            assert.deepEqual(sortedPoints(buildWallBodyPerimeters(reversed).perimeters[0].outline), sortedPoints(outline))
          }
          // Every rendered vertical face follows a segment of the same 2D outline.
          for (const face of buildWallBodyPerimeterMeshFaces(walls).filter(f => f.kind === 'side')) {
            assert.ok(face.vertices.every(({ position }) => outline.some((start, index) => {
              const end = outline[(index + 1) % outline.length]
              const dx = end.x - start.x, dy = end.y - start.y
              return Math.abs((position[0] - start.x) * dy - (position[2] - start.y) * dx) < 1e-6
            })))
          }
        }
      }
    })
  }
}

test('unequal mixed wall corners share the same miter or chamfer plane', () => {
  for (const degrees of [45, 30]) {
    const angle = degrees * Math.PI / 180
    const walls: Wall[] = [
      { id: 'thick', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, kind: 'external', thickness: 0.4, height: 2.4 },
      { id: 'thin', start: { x: 0, y: 0 }, end: { x: 4 * Math.cos(angle), y: 4 * Math.sin(angle) }, kind: 'internal', thickness: 0.15, height: 2.4 },
    ]
    const plan = buildWallBodyPerimeters(walls)
    assert.equal(plan.perimeters.length, 1)
    const outline = plan.perimeters[0].outline
    assert.equal(outline.length, degrees === 45 ? 6 : 7)
    const outward = { x: -Math.cos(angle / 2), y: -Math.sin(angle / 2) }
    const limit = 0.2 / Math.sin(Math.PI / 8)
    if (degrees === 30) {
      assert.equal(outline.filter(p => Math.abs(p.x * outward.x + p.y * outward.y - limit) < 1e-7).length, 2)
    } else {
      const outer = { x: -(0.075 + 0.2 * Math.cos(angle)) / Math.sin(angle), y: -0.2 }
      assert.ok(outline.some(p => Math.hypot(p.x - outer.x, p.y - outer.y) < 1e-7))
    }
    const reversed = walls.map(w => ({ ...w, start: w.end, end: w.start })).reverse()
    assert.deepEqual(sortedPoints(buildWallBodyPerimeters(reversed).perimeters[0].outline), sortedPoints(outline))
  }
})
