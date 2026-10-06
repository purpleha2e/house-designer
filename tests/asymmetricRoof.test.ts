import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildRoofProfileFaces, getGableRidgeX, getGableRidgeHeight, getPitchedRoofHeightAtX, getPitchedRoofSurfaceDistance, getPitchedRoofSideSlope } from '../src/roofProfile.ts'
import { resolveBuildingRoofs, resolveLinkedRoofFloors } from '../src/roofBuildingGeometry.ts'
import { roofJunctionInput, resolveRoofJunctions, roofSurfaceHeights, roofToLocal, getRoofRenderableOuterFaces } from '../src/roofJunctions.ts'
import { buildBuildingRoofGables } from '../src/roofGableGeometry.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { planeDistance, type SolidPoint } from '../src/convexSolid.ts'
import { resolveRoofRidgeHeights } from '../src/roofRidgeHeight.ts'
import { normalizeFloor } from '../src/modelPlacement.ts'
import { getDormerPlacementOnRoof } from '../src/dormerPlacement.ts'
import { createUpAndOverEavesGeometry } from '../src/roofEavesGeometry.ts'
import type { FloorLevel, RoofStructure } from '../src/types.ts'

const bounds = { minX: -2, maxX: 2, minY: -3, maxY: 3 }
const extents = { minX: -2.2, maxX: 2.2, minY: -3.2, maxY: 3.2 }
function roof(id = 'roof', overrides: Partial<RoofStructure> = {}): RoofStructure {
  return { id, type: 'up-and-over', position: { x: 0, y: 0 }, supportPosition: { x: 0, y: 0 },
    rotation: 0, width: 4.4, depth: 6.4, supportWidth: 4, supportDepth: 6,
    overhangSide: 0.2, overhangEnd: 0.2, pitchDegrees: 45, clipsGeometry: false, ...overrides }
}
function floor(roofs: RoofStructure[], overrides: Partial<FloorLevel> = {}): FloorLevel {
  return { id: 'floor', name: 'Floor', elevation: 0, roomHeight: 2.4, slabThickness: 0.3,
    walls: [], rooms: [], models: [], roofs, ...overrides }
}
function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`) }

test('the mounted asymmetric side meets its supports while the ridge and opposite pitch stay fixed', () => {
  for (const sign of [-1, 1]) {
    const r = roof('roof', { asymmetricSides: true, ridgeOffset: sign * 0.8, ridgeHeight: 1.8, pitchDegrees: 28 })
    const mounted = sign < 0 ? bounds.minX : bounds.maxX
    const opposite = sign < 0 ? bounds.maxX : bounds.minX
    near(getPitchedRoofHeightAtX(r, bounds, mounted), 0)
    near(getPitchedRoofHeightAtX(r, bounds, sign * 0.8), 1.8)
    near(getPitchedRoofSideSlope(r, bounds, mounted), 1.5)
    near(getPitchedRoofSideSlope(r, bounds, opposite), Math.tan(28 * Math.PI / 180))
    near(getPitchedRoofHeightAtX(r, bounds, mounted + sign * 0.2), -0.3)
    near(getPitchedRoofSurfaceDistance(r, bounds, mounted + sign * 0.2), 1.4 * Math.hypot(1, 1.5))
    const explicit = { ...r, mountSide: sign < 0 ? 'side2' as const : 'side1' as const }
    near(getPitchedRoofHeightAtX(explicit, bounds, opposite), 0)
    assert.notEqual(getPitchedRoofHeightAtX({ ...r, mountSide: 'free' }, bounds, mounted), 0)
  }
})

test('the saved roof mounts at its neighbours height without a join extension and tracks ridge edits', () => {
  const floors: FloorLevel[] = JSON.parse(readFileSync(new URL('./fixtures/roofFinishingRegression.json', import.meta.url), 'utf8')).floors
  const authored = floors[1].roofs!.find(r => r.asymmetricSides)!
  delete authored.mountSide // Existing projects use the automatic mounted side.
  const before = JSON.stringify(floors)
  const check = () => {
    const candidates = resolveBuildingRoofs(floors)
    const a = candidates.find(r => r.roof.id === authored.id)!
    const b = candidates.find(r => r.roof.id === authored.ridgeHeightTargetRoofId)!
    near(a.floorTopElevation + getPitchedRoofHeightAtX(a.roof, a.resolved.support, a.resolved.support.minX), b.floorTopElevation)
    near(a.floorTopElevation + getGableRidgeHeight(a.roof, a.resolved.support), b.floorTopElevation + getGableRidgeHeight(b.roof, b.resolved.support))
    near(getPitchedRoofSideSlope(a.roof, a.resolved.support, a.resolved.support.maxX), Math.tan(28 * Math.PI / 180))
    assert.ok(!a.resolved.joinedEaveFaces?.length, 'anchored eaves need no generated joining patch')
    return a
  }
  const a = check()
  near(Math.atan(getPitchedRoofSideSlope(a.roof, a.resolved.support, a.resolved.support.minX)) * 180 / Math.PI, 36.46568638491551)
  assert.equal(JSON.stringify(floors), before)
  floors[1].roofs!.find(r => r.id === authored.ridgeHeightTargetRoofId)!.pitchDegrees = 30
  check()
  for (const mountSide of ['auto', 'side1', 'side2', 'free'] as const) {
    authored.mountSide = mountSide
    assert.equal(normalizeFloor(JSON.parse(JSON.stringify(floors[1])), new Map()).roofs!.find(r => r.id === authored.id)!.mountSide, mountSide)
  }
})

test('ridge height links preserve each side pitch through the overhang unless explicitly overridden', () => {
  const target = roof('target', { pitchDegrees: 28, overhangPitchDegrees: 20 })
  const source = roof('source', { asymmetricSides: true, ridgeOffset: -0.8, ridgeHeightTargetRoofId: 'target' })
  const resolve = (changes: Partial<RoofStructure>) => resolveRoofRidgeHeights([
    roofJunctionInput({ ...source, ...changes }, 'floor', 3), roofJunctionInput(target, 'floor', 3),
  ]).inputs[0].roof
  for (const mountSide of ['auto', 'side1', 'side2', 'free'] as const) {
    const linked = resolve({ mountSide })
    assert.equal(linked.overhangPitchDegrees, undefined)
    for (const sign of [-1, 1]) {
      const wallX = sign < 0 ? bounds.minX : bounds.maxX
      const height = (x: number) => getPitchedRoofHeightAtX(linked, bounds, x)
      const innerSlope = (height(wallX) - height(wallX - sign * 0.1)) / (sign * 0.1)
      const outerSlope = (height(wallX + sign * 0.2) - height(wallX)) / (sign * 0.2)
      near(outerSlope, innerSlope)
    }
  }
  assert.equal(resolve({ overhangPitchDegrees: 0 }).overhangPitchDegrees, 0)
  assert.equal(resolve({ mountSide: 'free' }).overhangPitchDegrees, undefined)
  assert.equal(resolve({ heightOffset: 0.5 }).overhangPitchDegrees, undefined)
  assert.equal(source.overhangPitchDegrees, undefined)
})

test('an offset ridge keeps its height and pitch while one eave drops below the wall tops', () => {
  const r = roof('roof', { asymmetricSides: true, ridgeOffset: 0.5, ridgeHeight: 1.5 })
  near(getGableRidgeHeight(r, bounds), 1.5)
  near(getPitchedRoofHeightAtX(r, bounds, 0.5), 1.5)
  near(getPitchedRoofHeightAtX(r, bounds, -2), -1)
  near(getPitchedRoofHeightAtX(r, bounds, 2), 0)
  near(getPitchedRoofHeightAtX(r, bounds, -1), 0)
  const vertices = buildRoofProfileFaces(r, extents, bounds).flat()
  near(Math.max(...vertices.map(p => p[1])), 1.5)
  assert.ok(vertices.some(p => p[0] === 0.5 && Math.abs(p[1] - 1.5) < 1e-8))
  near(getGableRidgeX({ ...r, ridgeOffset: 100 }, bounds), 1.95)
})

test('overhang pitch and tile distances stay continuous at both unequal eaves', () => {
  const r = roof('roof', { asymmetricSides: true, ridgeOffset: 0.5, ridgeHeight: 1.5, overhangPitchDegrees: 0 })
  near(getPitchedRoofHeightAtX(r, bounds, -2.2), -1)
  near(getPitchedRoofHeightAtX(r, bounds, 2.2), 0)
  near(getPitchedRoofSurfaceDistance(r, bounds, -2.2), 2.5 * Math.SQRT2 + 0.2)
  near(getPitchedRoofSurfaceDistance(r, bounds, 2.2), 1.5 * Math.SQRT2 + 0.2)
  near(getPitchedRoofSurfaceDistance(r, bounds, 0.5), 0)
})

test('symmetric roofs ignore dormant asymmetric settings and chamfers meet the offset ridge', () => {
  const original = roof(), dormant = roof('roof', { asymmetricSides: false, ridgeOffset: 0.5, ridgeHeight: 1 })
  assert.deepEqual(buildRoofProfileFaces(dormant, extents, bounds), buildRoofProfileFaces(original, extents, bounds))
  const r = roof('roof', { asymmetricSides: true, ridgeOffset: 0.5, ridgeHeight: 1.5,
    ridgeStartChamfer: { distance: 1, angleDegrees: 45 } })
  const faces = buildRoofProfileFaces(r, extents, bounds)
  assert.ok(faces.flat().some(p => Math.abs(p[0] - 0.5) < 1e-8 && Math.abs(p[2] + 2.2) < 1e-8 && Math.abs(p[1] - 1.5) < 1e-8))
  near(Math.max(...roofSurfaceHeights(faces, { x: 0.5, y: -3.2 })), 0.5)
})

test('ridge links use world height across floors and offsets, update dynamically and preserve authored data', () => {
  const source = roof('A', { asymmetricSides: true, ridgeOffset: 0.5, ridgeHeight: 0.9, heightOffset: -0.3, ridgeHeightTargetRoofId: 'B' })
  const target = roof('B', { position: { x: 20, y: 20 }, supportPosition: { x: 20, y: 20 }, heightOffset: 0.2 })
  const levels = [floor([source]), floor([target], { id: 'other', elevation: 0.3, roomHeight: 2.2 })]
  const saved = JSON.stringify(levels)
  for (const reversed of [false, true]) {
    const candidates = resolveBuildingRoofs(reversed ? [...levels].reverse() : levels)
    const a = candidates.find(item => item.roof.id === 'A')!, b = candidates.find(item => item.roof.id === 'B')!
    const peak = (item: typeof a) => Math.max(...item.resolved.exteriorFaces.flat().map(p => p[1]))
    near(peak(a), peak(b))
    assert.equal(a.ridgeHeightLink?.state, 'linked')
  }
  assert.equal(JSON.stringify(levels), saved)
  const derived = resolveLinkedRoofFloors(levels)
  const attached = getDormerPlacementOnRoof(derived[0].roofs![0], { x: -0.5, y: 0 }, 0.4, 0.4)!
  near(derived[0].elevation + derived[0].roomHeight + source.heightOffset! + attached.surfaceHeight, 3.7)
  assert.equal(JSON.stringify(levels), saved, 'roof-mounted objects use derived heights without changing the saved fallback')
  levels[1].roofs![0].pitchDegrees = 30
  const [a, b] = resolveBuildingRoofs(levels)
  near(Math.max(...a.resolved.exteriorFaces.flat().map(p => p[1])), Math.max(...b.resolved.exteriorFaces.flat().map(p => p[1])))
})

test('height-link chains resolve independently of order and bad links retain their manual fallback', () => {
  const a = roof('A', { asymmetricSides: true, ridgeHeight: 0.7, ridgeHeightTargetRoofId: 'B' })
  const b = roof('B', { asymmetricSides: true, ridgeHeight: 0.8, ridgeHeightTargetRoofId: 'C' })
  const c = roof('C')
  const resolve = (items: RoofStructure[]) => resolveRoofRidgeHeights(items.map(r => roofJunctionInput(r, 'floor', 2.4)))
  for (const items of [[a, b, c], [c, b, a]]) {
    const result = resolve(items)
    near(result.inputs.find(item => item.roof.id === 'A')!.roof.ridgeHeight!, 2)
  }
  for (const bad of [{ ...b, ridgeHeightTargetRoofId: 'A' }, { ...b, ridgeHeightTargetRoofId: 'missing' }]) {
    const result = resolve([a, bad])
    near(result.inputs[0].roof.ridgeHeight!, 0.7)
    near(result.inputs[1].roof.ridgeHeight!, 0.8)
    assert.equal(result.links.get('A')?.state, 'unresolved')
    assert.equal(result.links.get('B')?.state, 'unresolved')
  }
  assert.equal(resolve([{ ...a, ridgeHeightTargetRoofId: 'A' }]).links.get('A')?.state, 'unresolved')
})

test('explicit roof joins terminate at the receiving off-centre ridge', () => {
  const source = roof('source', { position: { x: 0, y: -3 }, supportPosition: { x: 0, y: -3 },
    asymmetricSides: true, ridgeOffset: 0.3, ridgeHeight: 2,
    ridgeEnd: { mode: 'join', targetRoofId: 'target' } })
  const target = roof('target', { position: { x: 0, y: 2 }, supportPosition: { x: 0, y: 2 },
    rotation: Math.PI / 2, width: 6.4, supportWidth: 6, depth: 10, supportDepth: 10,
    asymmetricSides: true, ridgeOffset: 0.5, ridgeHeight: 2 })
  const [a] = resolveRoofJunctions([roofJunctionInput(source, 'floor', 2.4), roofJunctionInput(target, 'floor', 2.4)])
  assert.equal(a.connections[1].state, 'joined')
  near(a.resolvedExtents.maxY, 4.5)
  assert.ok(roofSurfaceHeights(a.faces, { x: 0.3, y: 1.3 }).length)
  assert.equal(roofSurfaceHeights(a.faces, { x: 0.3, y: 1.6 }).length, 0)
})

test('asymmetric controls and ridge links survive JSON round-tripping with finite defaults', () => {
  const f = floor([roof('A', { asymmetricSides: true, ridgeOffset: -0.6, ridgeHeight: 1.8, ridgeHeightTargetRoofId: 'B' })])
  const restored = normalizeFloor(JSON.parse(JSON.stringify(f)), new Map()).roofs![0]
  assert.equal(restored.asymmetricSides, true); assert.equal(restored.ridgeOffset, -0.6)
  assert.equal(restored.ridgeHeight, 1.8); assert.equal(restored.ridgeHeightTargetRoofId, 'B')
  const invalid = normalizeFloor(floor([roof('A', { ridgeOffset: NaN, ridgeHeight: Infinity })]), new Map()).roofs![0]
  assert.equal(invalid.asymmetricSides, false); assert.equal(invalid.ridgeOffset, undefined); assert.equal(invalid.ridgeHeight, undefined)
})

test('dormer placement selects and samples the actual side of an off-centre ridge', () => {
  const r = roof('roof', { asymmetricSides: true, ridgeOffset: 1, ridgeHeight: 2 })
  const placement = getDormerPlacementOnRoof(r, { x: 0.4, y: 0 }, 0.4, 0.4)
  assert.ok(placement)
  assert.equal(placement.roofAttachment.surface, 'negative-x')
  near(placement.surfaceHeight, 1.4)
})

function junctionFixture(): FloorLevel[] {
  return JSON.parse(readFileSync(new URL('./fixtures/asymmetricRoofJunctionRegression.json', import.meta.url), 'utf8')).floors
}

test('unequal joined eaves continue the receiving pitch to the branch without changing authored roofs', () => {
  const floors: FloorLevel[] = JSON.parse(readFileSync(new URL('./fixtures/roofFinishingRegression.json', import.meta.url), 'utf8')).floors
  const before = JSON.stringify(floors)
  for (const reversed of [false, true]) {
    const roofs = resolveBuildingRoofs(reversed ? floors.map(f => ({ ...f, roofs: [...f.roofs!].reverse() })) : floors)
    const source = roofs.find(r => r.roof.id.startsWith('8e321'))!.resolved
    const target = roofs.find(r => r.roof.id.startsWith('b46c'))!.resolved
    assert.ok(target.joinedEaveFaces!.length > 0)
    assert.ok(roofSurfaceHeights(source.faces, { x: 6.6, y: 11.5 }).length, 'original tiles cover the wall cap beside the gable')
    assert.ok(roofSurfaceHeights(source.faces, { x: 1.4, y: 8.5 }).length, 'the incoming eave remains before the valley')
    assert.equal(roofSurfaceHeights(source.faces, { x: 1.4, y: 9.95 }).length, 0, 'no lower tile remnant is stranded below the raised fascia')
    assert.ok(roofSurfaceHeights(target.faces, { x: 1.4, y: 9.4 }).length, 'the raised pitch continues to the lower roof')
    for (const point of target.joinedEaveFaces!.flat()) {
      const sourceHeights = roofSurfaceHeights(source.exteriorFaces, { x: point[0], y: point[2] })
      assert.ok(sourceHeights.length, 'extensions stay within the incoming authored footprint')
      assert.ok(point[1] >= Math.max(...sourceHeights) - 1e-6, 'extension stops at the incoming roof surface')
    }
  }
  assert.equal(JSON.stringify(floors), before)
  floors[1].roofs!.find(r => r.id.startsWith('8e321'))!.ridgeEnd = { mode: 'exposed' }
  assert.ok(!resolveBuildingRoofs(floors).find(r => r.roof.id.startsWith('b46c'))!.resolved.joinedEaveFaces?.length,
    'unconnected roofs retain their authored eaves')
})

test('a joined asymmetric roof cannot extend unsupported side panels beyond the receiving gable', () => {
  const floors = junctionFixture(), saved = JSON.stringify(floors)
  for (const reversed of [false, true]) {
    const candidates = resolveBuildingRoofs(reversed ? [...floors].reverse().map(f => ({ ...f, roofs: [...f.roofs!].reverse() })) : floors)
    const source = candidates.find(c => c.roof.id === '8e321618-2fa0-4ea5-99ec-8210302fe639')!
    const target = candidates.find(c => c.roof.id === 'b46c5b90-ecdc-4d0f-a6a5-976b793c7270')!
    assert.equal(source.resolved.connections[1].state, 'joined')
    for (const faces of [source.resolved.faces, source.resolved.structuralFaces, getRoofRenderableOuterFaces(source.resolved)]) {
      assert.deepEqual(roofSurfaceHeights(faces, { x: 7.4, y: 12.7 }), [], 'the crossed-out tile extension is absent')
      assert.ok(roofSurfaceHeights(faces, { x: 7.4, y: 11.3 }).length, 'original coverage remains beside the gable')
      for (const vertex of faces.flat()) {
        if (roofToLocal(source.roof, source.floorTopElevation, vertex)[2] <= source.resolved.extents.maxY + 1e-7) continue
        const local = roofToLocal(target.roof, target.floorTopElevation, vertex), bounds = target.resolved.support
        assert.ok(local[0] >= bounds.minX - 1e-7 && local[0] <= bounds.maxX + 1e-7 &&
          local[2] >= bounds.minY - 1e-7 && local[2] <= bounds.maxY + 1e-7, 'new join panels remain inside the receiver')
      }
    }
    assert.ok(roofSurfaceHeights(getRoofRenderableOuterFaces(source.resolved), { x: 6.3, y: 12.5 }).length,
      'the connection still reaches the shifted receiving ridge')
  }
  assert.equal(JSON.stringify(floors), saved)
})

test('a passive explicit join closes flush with the receiving gable instead of extending beneath its eave', () => {
  const floors = junctionFixture(), candidates = resolveBuildingRoofs(floors)
  const gables = buildBuildingRoofGables(floors, candidates, buildBuildingRoomVolumes(floors, candidates))
  const source = gables.find(g => g.id === '8e321618-2fa0-4ea5-99ec-8210302fe639:maxY')!
  const contains = (point: SolidPoint) => source.solids.some(solid => solid.planes.every(plane => planeDistance(plane, point) >= -1e-7))
  assert.equal(contains([6.6, 5.9, 11.5]), true, 'brick closes beneath the surviving lower roof tiles')
  assert.equal(contains([6.6, 6.1, 11.5]), false, 'the receiver overhang remains free of protruding brick')
  assert.equal(contains([6.6, 6.3, 11.5]), false, 'infill stops beneath the receiving roof')
  const incoming = candidates.find(c => c.roof.id === source.roofId)!
  const lowerTop = Math.max(...roofSurfaceHeights(getRoofRenderableOuterFaces(incoming.resolved), { x: 6.6, y: 11.5 }))
  assert.ok(contains([6.6, lowerTop - 0.041, 11.5]), 'the low return reaches its own roof underside')
  assert.ok(!contains([6.6, lowerTop - 0.039, 11.5]), 'the return cannot rise above its own covering roof')
  assert.equal(contains([7, 5.6, 11.5]), true, 'exposed source infill remains under its original panels')
  assert.ok(gables.find(g => g.id === '8e321618-2fa0-4ea5-99ec-8210302fe639:minY')!.solids.length,
    'the unconnected end retains its exterior gable')
  const target = candidates.find(c => c.roof.id === 'b46c5b90-ecdc-4d0f-a6a5-976b793c7270')!
  const receiver = gables.find(g => g.id === `${target.roof.id}:minY`)!
  for (const height of [5.2, 5.6, 6]) {
    assert.ok(receiver.solids.some(solid => solid.planes.every(plane => planeDistance(plane, [6.45, height, 11.5]) >= -1e-7)),
      'the receiving gable closes the lower corner in its own facade plane')
  }
  assert.deepEqual(roofSurfaceHeights(target.resolved.faces, { x: 5, y: 11.5 }), [],
    'the joined branch trims the receiver where its side slope passes above it')
  assert.ok(roofSurfaceHeights(target.resolved.faces, { x: 6.5, y: 12.5 }).length,
    'the receiving slope remains exposed towards its gable')
  const unjoinedFloors = junctionFixture()
  unjoinedFloors[1].roofs!.find(roof => roof.id === source.roofId)!.ridgeEnd = { mode: 'exposed' }
  const unjoinedRoofs = resolveBuildingRoofs(unjoinedFloors)
  const unjoined = buildBuildingRoofGables(unjoinedFloors, unjoinedRoofs,
    buildBuildingRoomVolumes(unjoinedFloors, unjoinedRoofs)).find(g => g.id === source.id)!
  assert.ok(unjoined.solids.some(solid => solid.planes.every(plane => planeDistance(plane, [6.6, 5.9, 11.5]) >= -1e-7)),
    'a passive roof cannot remove an end that was not deliberately joined to it')
  assert.ok(!unjoined.solids.some(solid => solid.planes.every(plane => planeDistance(plane, [6.6, 6.1, 11.5]) >= -1e-7)),
    'an unconnected roof cannot extend this wall infill')
})

test('asymmetric chamfer soffits and fascia follow the lowered panel at both ends', () => {
  for (const end of ['ridgeStartChamfer', 'ridgeEndChamfer'] as const) for (const ridgeOffset of [-0.8, 0.8]) {
    const r = roof('roof', { asymmetricSides: true, ridgeOffset, ridgeHeight: 1.2,
      [end]: { distance: 2.2, angleDegrees: 45 } })
    const faces = buildRoofProfileFaces(r, extents, bounds)
    const geometry = createUpAndOverEavesGeometry(r, bounds, extents, faces, 0.04)!
    assert.ok(geometry)
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i)
      const top = Math.max(...roofSurfaceHeights(faces, { x, y: z }))
      assert.ok(Number.isFinite(top))
      assert.ok(positions.getY(i) <= top - 0.03 + 1e-6, `no fascia or rear closure protrudes above the chamfer: ${x},${positions.getY(i)},${z}, roof=${top}`)
    }
    geometry.dispose()
  }
})

test('the saved joined roofs alternate slope ownership while retaining the receiving gable boundary', () => {
  const floors = junctionFixture(), saved = JSON.stringify(floors)
  for (const reversed of [false, true]) {
    const candidates = resolveBuildingRoofs(reversed ? floors.map(f => ({ ...f, roofs: [...f.roofs!].reverse() })) : floors)
    const branch = candidates.find(c => c.roof.id === '8e321618-2fa0-4ea5-99ec-8210302fe639')!.resolved
    const receiver = candidates.find(c => c.roof.id === 'b46c5b90-ecdc-4d0f-a6a5-976b793c7270')!.resolved
    for (const [point, winner, hidden] of [
      [{ x: 5, y: 11.5 }, branch, receiver],
      [{ x: 5, y: 12.5 }, branch, receiver],
      [{ x: 6.3, y: 12.5 }, receiver, branch],
    ] as const) {
      assert.ok(roofSurfaceHeights(winner.faces, point).length)
      assert.deepEqual(roofSurfaceHeights(hidden.faces, point), [])
    }
    assert.deepEqual(roofSurfaceHeights(branch.faces, { x: 7.4, y: 12.7 }), [],
      'mutual slope trimming cannot restore the patch outside the receiving gable')
  }
  assert.equal(JSON.stringify(floors), saved)
})
