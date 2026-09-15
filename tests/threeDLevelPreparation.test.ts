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
