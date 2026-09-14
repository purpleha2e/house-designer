import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { getRoofSupportBoundsInRoofSpace, getRoofWorldPointFromLocal, getWallSideAwayFromRoof, resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { roofSurfaceHeights, roofInfillFacesForFloor, resolvedRoofWallSegments, roofToLocal } from '../src/roofJunctions.ts'
import type { FloorLevel } from '../src/types.ts'
import { getRoofCeilingCutouts } from '../src/roofCeilingClipping.ts'
import { createUpAndOverEavesGeometry } from '../src/roofEavesGeometry.ts'
import { createWallRoofClipOptions } from '../src/roofWallClipping.ts'
import { clipWallFacesToRoofUndersides } from '../src/wallEngine/wallRoofClip.ts'
import { buildFloorWallSurfaceFaces } from '../src/wallEngine/floorWallSurfaceMesh.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import { buildWallTopology } from '../src/wallTopology.ts'

test('red house gable junction closes its wall, retains its slab and terminates the low eave at the facade', () => {
  const floors = fixture('red_house_3_gable')
  const roofs = resolveBuildingRoofs(floors)
  const upper = floors[1]
  const rooms = buildWallTopology(upper.walls).rooms
  function contains(polygon: { x: number; y: number }[], x: number, y: number) {
    let inside = false
    polygon.forEach((a, i) => { const b = polygon[(i + 1) % polygon.length]
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
    })
    return inside
  }
  const options = createWallRoofClipOptions({ floorElevation: upper.elevation, floorId: upper.id, walls: upper.walls,
    isInsideRoom: ({ x, y }) => rooms.some((room) => contains(room.polygon, x, y)),
    roofs: roofs.map(({ roof, resolved, floorId }) => {
      const bounds = getRoofSupportBoundsInRoofSpace(roof)
      return { floorId,
        supportPolygon: [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }].map((p) => getRoofWorldPointFromLocal(roof, p)),
        undersideFaces: resolved.coverageFaces.map((face) => face.map(([x, y, z]): [number, number, number] => [x, y - 0.035, z])),
      }
    }),
  })
  const faces = clipWallFacesToRoofUndersides(buildFloorWallSurfaceFaces({
    renderedWalls: getRenderedWalls(upper.walls), rooms,
    useWallBodyPerimeterMesh: true, roomSurfaceRendererEnabled: true,
  }), options)
  const caps = faces.filter((face) => face.faceId.includes(':roof-boundary-cap:') &&
    face.vertices.every((v) => Math.abs(v.position[0] - 1.35) < 1e-7))
  assert.ok(caps.some((face) => {
    const [a, b, c] = face.vertices.map((v) => v.position)
    const cross = (u: number[], v: number[]) => (v[2] - u[2]) * (4.5 - upper.elevation - u[1]) - (v[1] - u[1]) * (6.8 - u[2])
    const signs = [cross(a, b), cross(b, c), cross(c, a)]
    return signs.every((s) => s >= -1e-8) || signs.every((s) => s <= 1e-8)
  }), 'A: the exposed step in the wall join is closed')
  const cutouts = getRoofCeilingCutouts(roofs.map((roof) => roof.resolved), upper.elevation)
  for (const x of [0, 0.5, 1.1]) assert.ok(!cutouts.some((p) => contains(p.outline, x, 7.8) && !p.holes.some((hole) => contains(hole, x, 7.8))), 'B: slab below the gable stays solid')
  const lower = roofs[0].resolved
  assert.ok(lower.faces.flat().filter(([, y]) => y < 2.7).every(([x]) => x >= 1.35 - 1e-7), 'C: low tiles stop at the facade')
  const eaves = createUpAndOverEavesGeometry(lower.roof, lower.support, lower.resolvedExtents,
    lower.faces.map((face) => face.map((p) => roofToLocal(lower.roof, lower.elevation, p))), 0.04)!
  const positions = eaves.getAttribute('position')
  assert.ok(positions.count > 0)
  for (let i = 0; i < positions.count; i++) {
    const point = getRoofWorldPointFromLocal(lower.roof, { x: positions.getX(i), y: positions.getZ(i) })
    assert.ok(point.x >= 1.35 - 1e-6, 'C: soffits terminate with the tiles')
  }
  eaves.dispose()
})

function fixture(name: string): FloorLevel[] {
  return JSON.parse(readFileSync(new URL(`./fixtures/roof-junctions/${name}.json`, import.meta.url), 'utf8')).floors
}

test('gable wall face is selected from the roof interior even when adjoining rooms make exterior detection ambiguous', () => {
  const roof = {
    id: 'roof', type: 'up-and-over' as const, position: { x: 4, y: 4 },
    supportPosition: { x: 4, y: 4 }, width: 5, depth: 5,
    pitchDegrees: 35, rotation: -Math.PI / 2,
  }
  const rightGable = {
    id: 'right', kind: 'external' as const, thickness: 0.3,
    start: { x: 6.5, y: 1.5 }, end: { x: 6.5, y: 6.5 }, openings: [],
  }
  const leftGable = {
    ...rightGable, id: 'left', start: { x: 1.5, y: 1.5 }, end: { x: 1.5, y: 6.5 },
  }

  assert.equal(getWallSideAwayFromRoof(roof, rightGable), -1)
  assert.equal(getWallSideAwayFromRoof(roof, leftGable), 1)
})

test('red house keeps the lower roof continuous across the wall shared by rooms on both sides', () => {
  const floors = fixture('red_house_3')
  const [{ resolved, abuttingWalls }] = resolveBuildingRoofs(floors)
  assert.ok(resolved.faces.length > 0)
  assert.equal(abuttingWalls.length, 0)
  assert.ok(Math.min(...resolved.faces.flat().map(([x]) => x)) < 1.2)
  assert.ok(roofSurfaceHeights(resolved.coverageFaces, { x: 1.2, y: 4 }).length > 0)
  assert.ok(roofSurfaceHeights(resolved.coverageFaces, { x: 4, y: 4 }).length > 0)
})

test('Springfield keeps its upper gable and removes the unsupported eave strip', () => {
  const roofs = resolveBuildingRoofs(fixture('springfield_13'))
  const front = roofs.find((roof) => roof.roof.id === '03233f9a-f497-49c7-ac08-cc12e288c142')!.resolved
  assert.ok(Math.min(...front.faces.flat().map(([x]) => x)) < 5.36)
  const main = roofs.find((roof) => roof.roof.id === '10d097b4-4f64-43f5-9f5c-0baa64b63909')!.resolved
  assert.equal(roofSurfaceHeights(main.faces, { x: 15, y: 7.3 }).length, 0)
  assert.ok(roofs.every((roof) => roof.resolved.faces.flat(2).every(Number.isFinite)))
})

test('Springfield lean-to reaches the facade and its end infill stays below the upper gables', () => {
  const floors = fixture('springfield_13')
  const roofs = resolveBuildingRoofs(floors).map((roof) => roof.resolved)
  const leanTo = roofs.find((roof) => roof.roof.id === '50d9f27a-ff90-4121-88dc-08d2bbb09e32')!
  const wallX = 5.359627581803311
  assert.ok(Math.abs(Math.max(...leanTo.faces.flat().map(([x]) => x)) - wallX) < 1e-8)
  const faces = roofInfillFacesForFloor(roofs, floors[0].id)
  for (const y of [1.7369930114026033, 8.436993011402603]) {
    const segments = resolvedRoofWallSegments(faces, { x: 2.6, y }, { x: wallX, y }, 2.4, 0.04)
    const points = segments.flat()
    assert.ok(points.length > 0)
    assert.ok(points.every((point) => point.topY < 3.5), 'lower infill must not grow to the upper roof at 5–7 m')
    assert.ok(Math.abs(Math.max(...points.map((p) => p.planPoint.x)) - wallX) < 1e-8, 'infill reaches the wall without a gap')
  }
  const upperInfill = roofInfillFacesForFloor(roofs, floors[1].id)
  assert.ok(roofSurfaceHeights(upperInfill, { x: 14.8, y: 7.3 }).some((height) => height > 5.8), 'the real upper gable remains filled')
})

test('splitting and reversing facade walls preserves the red-house roof envelope', () => {
  const floors = fixture('red_house_3')
  const original = resolveBuildingRoofs(floors)[0].resolved
  const edited = floors.map((floor) => ({ ...floor, walls: floor.walls.flatMap((wall) => {
    const middle = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }
    return [{ ...wall, end: wall.start, start: middle, id: `${wall.id}:a` },
      { ...wall, start: wall.end, end: middle, id: `${wall.id}:b` }]
  }) }))
  const changed = resolveBuildingRoofs(edited)[0].resolved
  for (let x = 0.5; x < 6; x += 0.25) for (let y = 1; y < 8.5; y += 0.25) {
    const before = Math.max(...roofSurfaceHeights(original.faces, { x, y }))
    const after = Math.max(...roofSurfaceHeights(changed.faces, { x, y }))
    assert.ok(before === after || Math.abs(before - after) < 1e-7, `roof changed at ${x},${y}: ${before} to ${after}`)
  }
})
