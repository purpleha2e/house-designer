import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeFloor } from '../src/modelPlacement.ts'
import { resolveRoofJunctions, roofJunctionInput, roofSurfaceHeights } from '../src/roofJunctions.ts'
import { getRoofCeilingCutouts } from '../src/roofCeilingClipping.ts'
import { createWallRoofClipOptions } from '../src/roofWallClipping.ts'
import { createWallRoofClipJob, runWallRoofClipJob } from '../src/wallEngine/wallRoofClipJob.ts'
import { buildFloorWallSurfaceFaces } from '../src/wallEngine/floorWallSurfaceMesh.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { buildBuildingRoofGables, getGableWallClipData } from '../src/roofGableGeometry.ts'
import type { FloorLevel, RoofStructure, Wall } from '../src/types.ts'

function roof(clipsGeometry?: boolean): RoofStructure {
  return { id: 'roof', type: 'up-and-over', position: { x: 0, y: 0 },
    width: 4, depth: 4, pitchDegrees: 45, rotation: 0, clipsGeometry }
}
function floor(roofs: RoofStructure[], walls: Wall[] = []): FloorLevel {
  return { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: 0.3,
    models: [], rooms: [], walls, roofs }
}

test('the roof setting defaults on and survives saving and loading when off', () => {
  assert.equal(normalizeFloor(floor([roof()]), new Map()).roofs?.[0].clipsGeometry, true)
  const restored = normalizeFloor(JSON.parse(JSON.stringify(floor([roof(false)]))), new Map())
  assert.equal(restored.roofs?.[0].clipsGeometry, false)
})

test('a roof with clipping off leaves wall height and surface fragments intact', () => {
  const wall: Wall = { id: 'wall', kind: 'internal', start: { x: -1, y: 0 }, end: { x: 1, y: 0 },
    thickness: 0.1, height: 3, allowRoofClipHeight: true, openings: [] }
  const faces = buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls([wall]), rooms: [], useWallBodyPerimeterMesh: true })
  for (const clipsGeometry of [undefined, true, false]) {
    const options = createWallRoofClipOptions({ floorElevation: 0, floorId: 'ground', walls: [wall],
      roofs: [{ clipsGeometry, roofId: 'roof', floorId: 'ground', supportPolygon: [],
        undersideFaces: [[[-2, 1, -2], [2, 1, -2], [2, 1, 2], [-2, 1, 2]]] }] })
    const result = runWallRoofClipJob(createWallRoofClipJob(faces, options))
    const top = Math.max(...result.flatMap(f => f.vertices.map(v => v.position[1])))
    assert.ok(Math.abs(top - (clipsGeometry === false ? 3 : 1)) < 1e-6)
    if (clipsGeometry === false) assert.deepEqual(result, faces)
  }
  const options = createWallRoofClipOptions({ floorElevation: 2.7, floorId: 'upper', walls: [wall],
    roofs: [{ clipsGeometry: false, roofId: 'roof', floorId: 'ground', supportPolygon: [],
      surfaceFaces: [[[-2, 3, -2], [2, 3, -2], [2, 3, 2], [-2, 3, 2]]], undersideFaces: [] }] })
  assert.deepEqual(options.surfaceDividers, [])
})

test('a roof with clipping off does not cut floor slabs or ceilings', () => {
  const enabled = resolveRoofJunctions([roofJunctionInput(roof(), 'ground', 2.4)])
  assert.ok(getRoofCeilingCutouts(enabled, 3.4).length)
  const disabled = resolveRoofJunctions([roofJunctionInput(roof(false), 'ground', 2.4)])
  assert.deepEqual(getRoofCeilingCutouts(disabled, 3.4), [])
  assert.ok(disabled[0].faces.length, 'the roof is still resolved and rendered')
})

test('a roof with clipping off receives cuts from another roof without cutting it', () => {
  const lower = roofJunctionInput({ ...roof(), id: 'lower', type: 'flat' }, 'ground', 2.4)
  const higher = roofJunctionInput({ ...roof(false), id: 'higher', type: 'flat' }, 'upper', 3)
  const [alone] = resolveRoofJunctions([lower])
  const [withPassive] = resolveRoofJunctions([lower, higher])
  assert.deepEqual(withPassive.faces, alone.faces)
  assert.deepEqual(withPassive.coverageFaces, alone.coverageFaces)
  const [withActive] = resolveRoofJunctions([lower, { ...higher, roof: { ...higher.roof, clipsGeometry: true } }])
  assert.equal(roofSurfaceHeights(withActive.faces, { x: 0, y: 0 }).length, 0)
  const incoming = roofJunctionInput({ ...roof(false), id: 'incoming', type: 'flat' }, 'ground', 2.4)
  const main = roofJunctionInput({ ...roof(), id: 'main', type: 'flat' }, 'upper', 3)
  const [trimmed, intact] = resolveRoofJunctions([incoming, main])
  assert.equal(roofSurfaceHeights(trimmed.faces, { x: 0, y: 0 }).length, 0)
  assert.ok(intact.faces.length)
})

test('an explicit join reaches a passive receiving roof without giving it general clipping authority', () => {
  for (const clipsGeometry of [true, false]) {
    const branch = { ...roof(clipsGeometry), id: 'branch', position: { x: 0, y: -3 },
      width: 4.2, depth: 6, ridgeEnd: { mode: 'join' as const, targetRoofId: 'main' } }
    const main = { ...roof(false), id: 'main', position: { x: 0, y: 2 }, depth: 10, rotation: Math.PI / 2 }
    const unrelated = { ...branch, id: 'unrelated', clipsGeometry: false, ridgeEnd: { mode: 'exposed' as const } }
    const inputs = [branch, main, unrelated].map(r => roofJunctionInput(r, 'ground', 2.4))
    const [joined, receiving, untouched] = resolveRoofJunctions(inputs)
    const [unrelatedAlone] = resolveRoofJunctions([inputs[2]])
    assert.equal(joined.connections[1].state, 'joined')
    assert.ok(joined.resolvedExtents.maxY > joined.extents.maxY)
    assert.ok(roofSurfaceHeights(joined.faces, { x: 0, y: 1 }).length,
      'the higher branch covers its former gable end and reaches the junction')
    assert.deepEqual(roofSurfaceHeights(joined.faces, { x: 1, y: 1.5 }), [],
      'the explicitly chosen receiver trims hidden incoming panels')
    if (!clipsGeometry) {
      assert.deepEqual(roofSurfaceHeights(receiving.faces, { x: 0, y: 1 }), [],
        'the higher joined branch also trims the receiver locally')
      assert.ok(roofSurfaceHeights(receiving.faces, { x: 1, y: 1.5 }).length,
        'the receiving slope remains where it is higher')
      assert.deepEqual(untouched.faces, unrelatedAlone.faces,
        'the passive receiver cannot cut an unconnected roof')
    }
    assert.deepEqual(roofSurfaceHeights(joined.coverageFaces, { x: 0, y: 1 }), [],
      'joining does not extend wall clipping beyond the authored roof coverage')
  }
})

test('coincident passive joined slopes retain one owner regardless of input order', () => {
  const first = { ...roof(false), id: 'a', ridgeEnd: { mode: 'join' as const, targetRoofId: 'b' } }
  const second = { ...roof(false), id: 'b', position: { x: 0, y: 1 }, ridgeStart: { mode: 'exposed' as const }, ridgeEnd: { mode: 'exposed' as const } }
  for (const roofs of [[first, second], [second, first]]) {
    const resolved = resolveRoofJunctions(roofs.map(r => roofJunctionInput(r, 'ground', 2.4)))
    assert.deepEqual(roofSurfaceHeights(resolved.find(r => r.roof.id === 'a')!.faces, { x: 0.5, y: 1 }), [])
    assert.equal(roofSurfaceHeights(resolved.find(r => r.roof.id === 'b')!.faces, { x: 0.5, y: 1 }).length, 1)
  }
})

test('a roof with clipping off does not supply room cutters or height-clip drawn gable walls', () => {
  const walls: Wall[] = [
    [-2, -2, 2, -2], [2, -2, 2, 2], [2, 2, -2, 2], [-2, 2, -2, -2],
  ].map(([x, y, ex, ey], i) => ({ id: `wall-${i}`, kind: 'external', start: { x, y },
    end: { x: ex, y: ey }, height: 2.4, thickness: 0.3, openings: [] }))
  for (const clipsGeometry of [true, false]) {
    const floors = [floor([roof(clipsGeometry)], walls)]
    const roofs = resolveBuildingRoofs(floors)
    const rooms = buildBuildingRoomVolumes(floors, roofs)
    const gables = buildBuildingRoofGables(floors, roofs, rooms)
    const clips = getGableWallClipData(gables, roofs, 'ground', 0)
    if (clipsGeometry) {
      assert.ok(rooms.ceilingFaces.length)
      assert.ok(clips.gableWallIds.length)
    } else {
      assert.deepEqual(rooms.ceilingFaces, [])
      assert.ok(rooms.cuts.every(cut => !cut.roofId), 'house room volumes can still trim the passive roof')
      assert.deepEqual(clips.gableWallIds, [])
      assert.deepEqual(clips.gableCeilingFaces, [])
    }
  }
})
