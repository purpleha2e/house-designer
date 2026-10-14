import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { constructRoofLinings, createJoinedRoofAssemblyGeometries, createRoofAssemblyGeometries } from '../src/roofAssembly.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { roofFaceHeight, roofSurfaceHeights, roofToWorld } from '../src/roofJunctions.ts'
import type { RoomRoofCut } from '../src/roofRoomCsg.ts'
import type { RoofGeometries, RoofVertex } from '../src/roofSolidGeometry.ts'
import type { FloorLevel } from '../src/types.ts'
import { footprintPlanes } from '../src/wallEngine/wallRoofClip.ts'
import { getRoomCeilingCutouts } from '../src/roofCeilingClipping.ts'
import { pointIsInsideRoomPolygon } from '../src/roomLightMask.ts'

function insideRoom(point: RoofVertex, cuts: RoomRoofCut[]) {
  return cuts.some(cut => point[1] > cut.bottomY + 1e-5 &&
    point[1] < (roofFaceHeight(cut.face)?.({ x: point[0], y: point[2] }) ?? -Infinity) - 1e-5 &&
    footprintPlanes(cut.face.map(([x, , y]) => ({ x, y }))).every(plane => plane(point) > 1e-5))
}

function countInteriorTrim(parts: RoofGeometries, candidate: ReturnType<typeof resolveBuildingRoofs>[number], cuts: RoomRoofCut[]) {
  let count = 0
  for (const part of ['eaves', 'soffit', 'shell'] as const) {
    const positions = parts[part]?.getAttribute('position')
    if (!positions) continue
    for (let i = 0; i < positions.count; i += 3) {
      const center = [0, 1, 2].map(axis => [0, 1, 2].reduce((sum, offset) =>
        sum + positions.getComponent(i + offset, axis) / 3, 0)) as RoofVertex
      if (insideRoom(roofToWorld(candidate.roof, candidate.floorTopElevation, center), cuts)) count++
    }
  }
  return count
}

test('Colin rear bedroom clips exterior roof fittings while preserving the sloping roof', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/interiorRoofTrimRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors)
  const { cuts, exteriorTrimCuts } = buildBuildingRoomVolumes(floors, roofs)
  const upper = roofs.filter(candidate => candidate.floorId === floors[1].id)
  const inputs = upper.map(candidate => ({ resolved: candidate.resolved, abuttingWalls: candidate.abuttingWalls, roomCuts: cuts }))
  const before = createJoinedRoofAssemblyGeometries(inputs)
  const after = createJoinedRoofAssemblyGeometries(inputs.map(input => ({ ...input, exteriorTrimCuts })))
  const material = new MeshBasicMaterial({ side: DoubleSide })
  try {
    assert.ok(upper.reduce((sum, candidate) => sum + countInteriorTrim(before.get(candidate.roof.id)!, candidate, exteriorTrimCuts), 0) > 0,
      'the fixture reproduces the fascia and soffit protruding into the bedroom')
    for (const candidate of upper) {
      assert.equal(countInteriorTrim(after.get(candidate.roof.id)!, candidate, exteriorTrimCuts), 0,
        `${candidate.roof.id} must have no exterior fittings inside rooms, even with wall clipping off`)
    }
    const meshFor = (candidate: typeof upper[number], part: keyof RoofGeometries) => {
      const mesh = new Mesh(after.get(candidate.roof.id)![part], material)
      mesh.position.set(candidate.roof.position.x, candidate.floorTopElevation + (candidate.roof.heightOffset ?? 0), candidate.roof.position.y)
      mesh.rotation.y = candidate.roof.rotation
      mesh.updateMatrixWorld(true)
      return mesh
    }
    const tops = upper.map(candidate => meshFor(candidate, 'top'))
    for (const x of [3.16, 3.18, 3.2]) for (const z of [15.85, 15.95, 16.05]) {
      const expected = Math.max(...upper.flatMap(candidate => roofSurfaceHeights(candidate.resolved.faces, { x, y: z })))
      const hit = new Raycaster(new Vector3(x, 10, z), new Vector3(0, -1, 0)).intersectObjects(tops)[0]
      assert.ok(hit && Math.abs(hit.point.y - expected) < 1e-5, 'the joined outer roof stays intact')
    }
    const receiver = upper.find(candidate => candidate.roof.fitSupportingWalls)!
    const underside = meshFor(receiver, 'underside')
    const hit = new Raycaster(new Vector3(3.25, 4.5, 16), new Vector3(0, 1, 0)).intersectObject(underside)[0]
    assert.ok(hit && hit.point.y < 5.1, 'the real sloping room ceiling remains')
    assert.ok(upper.some(candidate => after.get(candidate.roof.id)!.eaves!.getAttribute('position').count > 0),
      'exterior fascia is retained')
  } finally {
    for (const geometries of [before, after]) geometries.forEach(parts => Object.values(parts).forEach(part => part?.dispose()))
    material.dispose()
  }
})

test('a room removes a passive roof skin on its own floor with house clipping disabled', () => {
  const polygon = [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
  const floor: FloorLevel = { id: 'room', name: 'Room', elevation: 0, roomHeight: 2.4, slabThickness: .2,
    rooms: [], models: [], walls: polygon.map((start, i) => ({ id: `w${i}`, start,
      end: polygon[(i + 1) % 4], thickness: .2, height: 2.4, kind: 'external' })),
    roofs: [{ id: 'intruder', type: 'flat', position: { x: 0, y: 0 }, rotation: .43,
      width: 8, depth: 8, pitchDegrees: 0, heightOffset: -.5, clipsGeometry: false }] }
  const [candidate] = resolveBuildingRoofs([floor])
  const volumes = buildBuildingRoomVolumes([floor], [candidate])
  const parts = createRoofAssemblyGeometries({ resolved: candidate.resolved,
    roomCuts: volumes.cuts, exteriorTrimCuts: volumes.exteriorTrimCuts })
  const material = new MeshBasicMaterial({ side: DoubleSide })
  try {
    for (const geometry of Object.values(parts)) {
      const mesh = new Mesh(geometry!, material)
      mesh.position.set(0, 1.9, 0); mesh.rotation.y = .43; mesh.updateMatrixWorld(true)
      assert.equal(new Raycaster(new Vector3(0, 0, 0), new Vector3(0, 1, 0)).intersectObject(mesh).length, 0,
        'no roof part survives in the room')
    }
    assert.ok(parts.top.getAttribute('position').count > 0, 'the exterior roof is retained')
  } finally { Object.values(parts).forEach(part => part?.dispose()); material.dispose() }
})

test('the saved upstairs doorway has no lower roof skin or stale ceiling cutout in the bedroom', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofDoorwayCameraRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors), volumes = buildBuildingRoomVolumes(floors, roofs)
  const upper = floors[1], candidates = roofs.filter(candidate => candidate.floorId === upper.id)
  const parts = createJoinedRoofAssemblyGeometries(candidates.map(candidate => ({ resolved: candidate.resolved,
    abuttingWalls: candidate.abuttingWalls, roomCuts: volumes.cuts, exteriorTrimCuts: volumes.exteriorTrimCuts })))
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const undersides = candidates.map(candidate => {
    const mesh = new Mesh(parts.get(candidate.roof.id)!.underside, material)
    mesh.position.set(candidate.roof.position.x, candidate.floorTopElevation, candidate.roof.position.y)
    mesh.rotation.y = candidate.roof.rotation; mesh.updateMatrixWorld(true)
    return mesh
  })
  const ceilingY = upper.elevation + upper.roomHeight - .02
  const cutouts = getRoomCeilingCutouts(volumes.cuts, upper.id, ceilingY)
  try {
    // These are world points on the visible strip identified by raycasts from
    // the user's saved camera, rather than a second doorway in the same house.
    for (const [x, z] of [[4.06116, 9.98132], [3.74949, 9.92107], [3.4656, 9.86619], [3.20595, 9.81599]]) {
      const hit = new Raycaster(new Vector3(x, 4.3, z), new Vector3(0, 1, 0)).intersectObjects(undersides)[0]
      assert.ok(!hit || hit.point.y >= ceilingY, 'no roof underside enters the bedroom below its horizontal ceiling')
      assert.equal(cutouts.some(cutout => pointIsInsideRoomPolygon({ x, y: z }, cutout.outline) &&
        !cutout.holes.some(hole => pointIsInsideRoomPolygon({ x, y: z }, hole))), false,
        'the horizontal ceiling closes the space above the doorway')
    }
  } finally { parts.forEach(part => Object.values(part).forEach(geometry => geometry?.dispose())); material.dispose() }
})

test('inner skin projection is opt-in, bounded, and cannot restore exterior fittings', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/interiorRoofTrimRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors), volumes = buildBuildingRoomVolumes(floors, roofs)
  const candidate = roofs.find(item => item.roof.fitSupportingWalls)!
  const input = { resolved: candidate.resolved, roomCuts: volumes.cuts, exteriorTrimCuts: volumes.exteriorTrimCuts }
  const boundary = constructRoofLinings(input)
  const projected = constructRoofLinings({ ...input, resolved: { ...candidate.resolved,
    roof: { ...candidate.roof, allowInteriorSkin: true, interiorSkinDepth: .03 } } })
  assert.ok(boundary.length && projected.length === boundary.length)
  boundary.forEach((lining, index) => {
    const heights = lining.faces.flatMap(face => face.points.map(point => point[1]))
    const shifted = projected[index].faces.flatMap(face => face.points.map(point => point[1]))
    assert.ok(Math.abs(Math.min(...heights) - Math.min(...shifted) - .03) < 1e-6)
    assert.ok(Math.abs(Math.max(...heights) - Math.max(...shifted) - .03) < 1e-6)
    assert.ok(projected[index].faces.every(face => face.tag === 'underside'), 'only the lining can enter a room')
  })
  const projectedParts = createRoofAssemblyGeometries({ ...input, resolved: { ...candidate.resolved,
    roof: { ...candidate.roof, allowInteriorSkin: true, interiorSkinDepth: .03 } } })
  assert.equal(countInteriorTrim(projectedParts, candidate, volumes.exteriorTrimCuts), 0)
  Object.values(projectedParts).forEach(part => part?.dispose())
})

test('a passive roof cannot leave fittings in a vaulted room above the horizontal ceiling', () => {
  const polygon = [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }]
  const floor: FloorLevel = { id: 'vault', name: 'Vault', elevation: 0, roomHeight: 2.4, slabThickness: 0.2,
    ceilingMode: 'open', rooms: [], models: [], walls: polygon.map((start, i) => ({
      id: `wall-${i}`, start, end: polygon[(i + 1) % polygon.length], thickness: 0.2, height: 2.4, kind: 'external',
    })), roofs: [{ id: 'passive', type: 'up-and-over', position: { x: 0, y: 0 }, rotation: Math.PI / 2,
      width: 4.4, depth: 7, supportWidth: 4, supportDepth: 6.6, pitchDegrees: 35,
      heightOffset: 1, overhangSide: 0.2, overhangEnd: 0.2, clipsGeometry: false }] }
  const [candidate] = resolveBuildingRoofs([floor])
  const volumes = buildBuildingRoomVolumes([floor], [candidate])
  const input = { resolved: candidate.resolved, roomCuts: volumes.cuts }
  const before = createRoofAssemblyGeometries(input)
  const after = createRoofAssemblyGeometries({ ...input, exteriorTrimCuts: volumes.exteriorTrimCuts })
  try {
    assert.ok(countInteriorTrim(before, candidate, volumes.exteriorTrimCuts) > 0)
    assert.equal(countInteriorTrim(after, candidate, volumes.exteriorTrimCuts), 0)
    assert.ok(after.top.getAttribute('position').count > 0)
    assert.ok(after.underside.getAttribute('position').count > 0)
    assert.ok(after.eaves!.getAttribute('position').count > 0, 'eaves outside the room are retained')
  } finally {
    for (const parts of [before, after]) Object.values(parts).forEach(part => part?.dispose())
  }
})
