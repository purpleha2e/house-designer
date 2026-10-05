import assert from 'node:assert/strict'
import test from 'node:test'
import {
  prepareRenderedFloorData,
  refreshRenderedFloorOpenings,
} from '../src/threeDLevelPreparation.ts'
import type { FloorLevel, Wall } from '../src/types.ts'
import { buildWallBodyPerimeters } from '../src/wallEngine/wallBodyPerimeter.ts'

function rectangleWalls(): Wall[] {
  const points = [[0, 0], [6, 0], [6, 4], [0, 4]] as const
  return points.map(([x, y], index) => ({
    id: `wall-${index}`,
    kind: 'external',
    start: { x, y },
    end: {
      x: points[(index + 1) % points.length][0],
      y: points[(index + 1) % points.length][1],
    },
    thickness: 0.3,
    height: 2.4,
    openings: index === 0 ? [{
      id: 'door', modelId: 'door-model', center: 2, width: 0.9, bottom: 0, height: 2.1,
    }] : [],
  }))
}

test('moving an opening refreshes wall data without rebuilding floor topology', () => {
  const floor: FloorLevel = {
    id: 'ground', name: 'Ground', elevation: 0, models: [], rooms: [],
    roomHeight: 2.4, slabThickness: 0.25, walls: rectangleWalls(),
  }
  const prepared = prepareRenderedFloorData(floor)
  const movedFloor = structuredClone(floor)
  movedFloor.walls[0].openings![0].center = 3.25

  const refreshed = refreshRenderedFloorOpenings(prepared, movedFloor)

  assert.equal(refreshed.rooms, prepared.rooms)
  assert.equal(refreshed.externalWallFootprintGroups, prepared.externalWallFootprintGroups)
  assert.equal(refreshed.roomSurfacePolygonsBySignature, prepared.roomSurfacePolygonsBySignature)
  assert.equal(refreshed.renderedWalls[0].wall.openings![0].center, 3.25)
  assert.equal(refreshed.geometryContextWalls[0].openings![0].center, 3.25)
  assert.equal(refreshed.wallBodyOccluders[0].renderedWall, refreshed.renderedWalls[0])
  assert.equal(prepared.renderedWalls[0].wall.openings![0].center, 2)
})

test('prepares a rectangular wall loop with floating-point join residue', () => {
  const floor: FloorLevel = {
    id: 'ground', name: 'Ground', elevation: 0, models: [], rooms: [],
    roomHeight: 2.4, slabThickness: 0.3,
    walls: [
      {
        id: 'top', kind: 'external', thickness: 0.3, height: 2.4,
        start: { x: 1.5, y: 1.5 },
        end: { x: 6.816666666666666, y: 1.5 },
      },
      {
        id: 'right', kind: 'external', thickness: 0.3, height: 2.4,
        start: { x: 6.816666666666666, y: 1.5 },
        end: { x: 6.816666666666666, y: 7.217274020214724 },
      },
      {
        id: 'bottom', kind: 'external', thickness: 0.3, height: 2.4,
        start: { x: 6.816666666666666, y: 7.217274020214724 },
        end: { x: 1.4999999999999991, y: 7.217274020214723 },
      },
      {
        id: 'left', kind: 'external', thickness: 0.3, height: 2.4,
        start: { x: 1.4999999999999991, y: 7.217274020214723 },
        end: { x: 1.4999999999999996, y: 1.5 },
      },
    ],
  }

  const prepared = prepareRenderedFloorData(floor)

  assert.equal(prepared.rooms.length, 1)
  assert.equal(prepared.externalWallUnionFootprints.length, 1)
  assert.equal(prepared.roomSurfacePolygonsBySignature.size, 1)
})

test('floor follows the joined wall skin at the concave floor_test corner', () => {
  // The lower room from floor_test.json. Its shallow diagonal used to leave a
  // tapered gap beside the wall and a notch where it meets the vertical return.
  const points = [
    [4, 9.666764705034279], [8.969217750357334, 10.540236746410669],
    [8.969217750357334, 11.533333333333333], [3.666666666666667, 11.533333333333333],
    [6.971774222554075, 15.32254575321442], [11.749348622554072, 12.441071193214421],
    [9.84535332795938, 9.283333333333333], [6.5, 9.283333333333333],
    [6.5, 7.166764705034278],
  ]
  const walls: Wall[] = points.map(([x, y], index) => ({
    id: `corner-${index}`, kind: 'external', thickness: 0.3, height: 2.4,
    start: { x, y },
    end: { x: points[(index + 1) % points.length][0], y: points[(index + 1) % points.length][1] },
  }))
  // Keep an adjacent room in the same wall component to guard against assigning
  // the larger floor polygon to both rooms.
  walls.push(...rectangleWalls().map((wall) => ({
    ...wall, id: `neighbour-${wall.id}`, openings: [],
    start: { x: wall.start.x + 6.5, y: wall.start.y + 3.166764705034278 },
    end: { x: wall.end.x + 6.5, y: wall.end.y + 3.166764705034278 },
  })))
  const prepared = prepareRenderedFloorData({
    id: 'ground', name: 'Ground', elevation: 0, models: [], rooms: [],
    roomHeight: 2.4, slabThickness: 0.3, walls,
  })
  assert.equal(prepared.rooms.length, 2)
  const holes = buildWallBodyPerimeters(prepared.geometryContextWalls).perimeters.flatMap(p => p.holes)
  const floors = [...prepared.roomSurfacePolygonsBySignature.values()]
  assert.equal(floors.length, 2)
  for (const hole of holes) {
    assert.equal(floors.filter(polygon => polygon.length === hole.length && hole.every(point =>
      polygon.some(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 1e-7),
    )).length, 1, 'each room floor must cover its own wall boundary exactly')
  }
  assert.ok(floors.some(polygon => polygon.some(point =>
    Math.abs(point.x - 9.11921775) < 1e-7 && Math.abs(point.y - 10.414303555) < 1e-7,
  )), 'floor must reach the diagonal/vertical miter without a notch')
})
