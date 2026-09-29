import assert from 'node:assert/strict'
import test from 'node:test'
import {
  prepareRenderedFloorData,
  refreshRenderedFloorOpenings,
} from '../src/threeDLevelPreparation.ts'
import type { FloorLevel, Wall } from '../src/types.ts'

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
