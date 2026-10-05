import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createCeilingLoftFloor, getAddLoftFloorDisabledReason } from '../src/loftFloor.ts'
import { getFloorSlabFootprints } from '../src/ceilingSlabFootprint.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { prepareRenderedFloorData, serializeWallGeometryInput } from '../src/threeDLevelPreparation.ts'
import { buildStoreyGeometry } from '../src/storeyGeometry.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { resolveBuildingRoofs, serializeRoofGeometryInput } from '../src/roofBuildingGeometry.ts'
import { normalizeFloor } from '../src/modelPlacement.ts'
import type { FloorLevel, Wall } from '../src/types.ts'

function lowerFloor(): FloorLevel {
  const points = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]
  return {
    id: 'ground', name: 'Ground floor', elevation: 0, roomHeight: 2.4, slabThickness: 0.3,
    rooms: [], models: [],
    walls: points.map((start, i): Wall => ({
      id: `wall-${i}`, kind: 'external', height: 2.4, thickness: 0.3,
      start, end: points[(i + 1) % points.length],
    })),
    roofs: [{ id: 'roof', type: 'up-and-over', position: { x: 3, y: 2 },
      width: 6.6, depth: 4.6, rotation: 0, pitchDegrees: 45, heightOffset: 0 }],
  }
}

test('one action creates a wall-less loft at the ceiling assembly top without changing the roof', () => {
  const lower = lowerFloor()
  lower.elevation = 3.1
  const before = structuredClone(lower)
  const loft = createCeilingLoftFloor([lower], lower.id, 'loft')!
  assert.ok(loft)
  assert.ok(Math.abs(loft.elevation - 5.8) < 1e-9)
  assert.equal(loft.ceilingMode, 'open')
  assert.deepEqual(loft.walls, [])
  assert.deepEqual(loft.roofs, [])
  assert.deepEqual(loft.models, [])
  assert.deepEqual(lower, before)
  assert.deepEqual(getFloorSlabFootprints(loft), getFloorSlabFootprints(lower))
  const prepared = prepareRenderedFloorData(loft)
  assert.equal(prepared.rooms.length, 1)
  assert.ok(Math.abs(prepared.rooms[0].area - 6.3 * 4.3) < 1e-6)
  assert.equal(prepared.renderedWalls.length, 0)
  assert.equal(prepared.wallBodyOccluders.length, 0)
  assert.equal(prepared.roomSurfacePolygonsBySignature.get(prepared.rooms[0].signature)?.length, 4)
  const geometry = buildStoreyGeometry([lower, loft].map(floor => ({
    floor, faces: [], footprints: getFloorSlabFootprints(floor),
  })))
  assert.deepEqual(geometry.get(lower.id)?.assembly?.footprints, loft.floorFootprints)
  assert.equal(geometry.get(lower.id)?.assembly?.top, loft.elevation)
})

test('uses the selected level and refuses empty levels or duplicate floors above it', () => {
  const lower = lowerFloor()
  const upper = { ...lowerFloor(), id: 'upper', elevation: 3 }
  assert.equal(createCeilingLoftFloor([upper, lower], lower.id, 'loft'), null)
  assert.match(getAddLoftFloorDisabledReason([upper, lower], lower.id)!, /already/)
  assert.equal(createCeilingLoftFloor([{ ...lower, walls: [] }], lower.id, 'loft'), null)
  assert.equal(createCeilingLoftFloor([lower], 'missing', 'loft'), null)
  const loft = createCeilingLoftFloor([upper, lower], upper.id, 'loft')!
  assert.equal(loft.elevation, 5.7)
})

test('an internal partition can divide the independent footprint without perimeter walls', () => {
  const lower = lowerFloor()
  const loft = createCeilingLoftFloor([lower], lower.id, 'loft')!
  loft.walls = [{ id: 'partition', kind: 'internal', thickness: 0.1, height: 2.4,
    start: { x: 3, y: -0.15 }, end: { x: 3, y: 4.15 } }]
  const prepared = prepareRenderedFloorData(loft)
  const plan = buildWallTopology(loft.walls, { floorFootprints: loft.floorFootprints })
  assert.equal(prepared.rooms.length, 2)
  assert.deepEqual(prepared.rooms, plan.rooms, '2D and 3D use the same room outlines')
  assert.ok(Math.abs(prepared.rooms.reduce((area, room) => area + room.area, 0) - 6.2 * 4.3) < 1e-6)
  assert.equal(prepared.renderedWalls.length, 1)
  assert.ok(prepared.rooms.every(room =>
    (prepared.roomSurfacePolygonsBySignature.get(room.signature)?.length ?? 0) >= 4))
})

test('loft boundary survives project normalization and both geometry worker payloads', () => {
  const lower = lowerFloor()
  const loft = createCeilingLoftFloor([lower], lower.id, 'loft')!
  const loaded = normalizeFloor(JSON.parse(JSON.stringify(loft)), new Map())
  assert.deepEqual(loaded.floorFootprints, loft.floorFootprints)
  assert.equal(loaded.ceilingMode, 'open')
  for (const serialize of [serializeWallGeometryInput, serializeRoofGeometryInput]) {
    const restored = JSON.parse(serialize([loft]))[0] as FloorLevel
    assert.deepEqual(restored.floorFootprints, loft.floorFootprints)
    assert.equal(prepareRenderedFloorData(restored).rooms.length, 1)
    assert.notEqual(serialize([loft]), serialize([{ ...loft, floorFootprints: undefined }]))
  }
})

test('the loft uses the existing roof as its sloping ceiling and clips the floor assembly', () => {
  const lower = lowerFloor()
  const loft = createCeilingLoftFloor([lower], lower.id, 'loft')!
  const floors = [lower, loft]
  const roofs = resolveBuildingRoofs(floors)
  assert.equal(roofs.length, 1)
  assert.equal(roofs[0].floorId, lower.id)
  assert.deepEqual(roofs[0].resolved.faces, resolveBuildingRoofs([lower])[0].resolved.faces)
  const volumes = buildBuildingRoomVolumes(floors, roofs)
  assert.ok(volumes.cuts.some(cut => cut.floorAssembly && cut.floorId === loft.id))
  assert.ok(volumes.cuts.some(cut => cut.floorId === loft.id && cut.roofId === 'roof'))
  assert.ok(volumes.roomPolygonsByFloor.get(loft.id)?.length)
})

test('saved floor_test layout produces a continuous loft surface with no copied walls', () => {
  const floors = JSON.parse(readFileSync(new URL('../floor_test.json', import.meta.url), 'utf8')).floors as FloorLevel[]
  const source = [...floors].sort((a, b) => b.elevation - a.elevation)[0]
  const before = structuredClone(floors)
  const loft = createCeilingLoftFloor(floors, source.id, 'loft')!
  assert.ok(loft?.floorFootprints?.length)
  const prepared = prepareRenderedFloorData(loft)
  assert.ok(prepared.rooms.length)
  assert.equal(prepared.renderedWalls.length, 0)
  assert.ok(prepared.rooms.every(room => prepared.roomSurfacePolygonsBySignature.has(room.signature)))
  const volumes = buildBuildingRoomVolumes([...floors, loft], resolveBuildingRoofs([...floors, loft]))
  assert.ok(volumes.cuts.some(cut => cut.floorAssembly && cut.floorId === loft.id))
  assert.deepEqual(floors, before)
})
