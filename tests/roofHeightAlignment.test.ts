import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { normalizeFloor } from '../src/modelPlacement.ts'
import { resolveBuildingRoofs, resolveLinkedRoofFloors } from '../src/roofBuildingGeometry.ts'
import { resolveRoofRidgeHeights } from '../src/roofRidgeHeight.ts'
import { getPitchedRoofSideSlope, getGableRidgeHeight, getGableChamferLimits } from '../src/roofProfile.ts'
import { roofJunctionInput, roofToWorld } from '../src/roofJunctions.ts'
import type { FloorLevel, RoofStructure } from '../src/types.ts'

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
const roof = (id: string, updates: Partial<RoofStructure> = {}): RoofStructure => ({
  id, type: 'up-and-over', width: 4.4, depth: 6.4, supportWidth: 4, supportDepth: 6,
  position: { x: 0, y: 0 }, supportPosition: { x: 0, y: 0 }, rotation: 0,
  overhangSide: 0.2, overhangEnd: 0.2, pitchDegrees: 33, ...updates,
})
const level = (roofs: RoofStructure[]): FloorLevel => ({ id: 'floor', name: 'Floor',
  elevation: 0, roomHeight: 2.4, slabThickness: 0.3, walls: [], rooms: [], models: [], roofs })

test('adjoining slope alignment calculates the vertical move, follows edits, and preserves authoring data', () => {
  const target = roof('target', { heightOffset: 0.01902 })
  const source = roof('source', { position: { x: 0, y: 6 }, supportPosition: { x: 0, y: 6 },
    heightAlignment: { mode: 'slope', targetRoofId: target.id } })
  const f = level([source, target]), before = JSON.stringify(f)
  let result = resolveBuildingRoofs([f]).find(r => r.roof.id === source.id)!
  assert.equal(result.heightAlignmentStatus?.state, 'linked')
  near(result.roof.heightOffset!, 0.01902)
  near(getPitchedRoofSideSlope(result.roof, result.resolved.support, -2), Math.tan(33 * Math.PI / 180))
  assert.equal(JSON.stringify(f), before)
  target.heightOffset = -0.2
  result = resolveBuildingRoofs([f]).find(r => r.roof.id === source.id)!
  near(result.roof.heightOffset!, -0.2)
  near(resolveLinkedRoofFloors([f])[0].roofs![0].heightOffset!, -0.2)
})

test('eave alignment shifts an asymmetric ridge while keeping its world height and both pitches', () => {
  for (const side of ['side1', 'side2'] as const) {
    const target = roof('target', { pitchDegrees: 29 })
    const source = roof('source', { asymmetricSides: true, mountSide: 'free', ridgeOffset: 0.8,
      ridgeHeightTargetRoofId: 'target', heightAlignment: { mode: 'eave', side, targetRoofId: 'target' } })
    const f = level([source, target]), before = JSON.stringify(f)
    const [a, b] = resolveBuildingRoofs([f])
    assert.equal(a.heightAlignmentStatus?.state, 'linked')
    near(getGableRidgeHeight(a.roof, a.resolved.support), getGableRidgeHeight(b.roof, b.resolved.support))
    const x = side === 'side1' ? a.resolved.extents.minX : a.resolved.extents.maxX
    const faces = a.resolved.exteriorFaces.flat().filter(p => Math.abs(p[0] - x) < 1e-7)
    const targetEave = Math.min(...b.resolved.exteriorFaces.flat().map(p => p[1]))
    faces.forEach(p => near(p[1], targetEave))
    for (const edge of [a.resolved.support.minX, a.resolved.support.maxX])
      near(getPitchedRoofSideSlope(a.roof, a.resolved.support, edge), Math.tan(33 * Math.PI / 180))
    assert.equal(JSON.stringify(f), before)
  }
})

test('the saved house aligns its chamfer and front gable without typing a ridge or vertical offset', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofAssemblyRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = floors[1].roofs!
  const rear = roofs.find(r => r.id.startsWith('8e321'))!, cross = roofs.find(r => r.asymmetricSides)!, front = roofs.find(r => r.id.startsWith('b9c4'))!
  rear.pitchDegrees = 29
  Object.assign(cross, { pitchDegrees: 33, mountSide: 'free',
    ridgeEndChamfer: { angleDegrees: 33, distance: 0.5, matchEave: true },
    heightAlignment: { mode: 'eave', side: 'side1', targetRoofId: rear.id } })
  Object.assign(front, { pitchDegrees: 33, heightOffset: 0,
    heightAlignment: { mode: 'slope', targetRoofId: cross.id } })
  const resolved = resolveBuildingRoofs(floors)
  const a = resolved.find(r => r.roof.id === cross.id)!, b = resolved.find(r => r.roof.id === front.id)!
  assert.equal(a.heightAlignmentStatus?.state, 'linked')
  assert.equal(b.heightAlignmentStatus?.state, 'linked')
  near(a.roof.ridgeOffset!, -0.4287648944190279)
  near(getGableChamferLimits(a.roof, a.resolved.extents, a.resolved.support).ridgeEndChamfer.distance, 3.018032403472948)
  near(b.roof.heightOffset!, 0.01901970834894859)
  rear.pitchDegrees = 30
  const updated = resolveBuildingRoofs(floors)
  assert.equal(updated.find(r => r.roof.id === cross.id)!.heightAlignmentStatus?.state, 'linked')
  assert.equal(updated.find(r => r.roof.id === front.id)!.heightAlignmentStatus?.state, 'linked')
  assert.notEqual(updated.find(r => r.roof.id === front.id)!.roof.heightOffset, b.roof.heightOffset)
})

test('alignment survives save/load and invalid settings are ignored', () => {
  const f = level([roof('a', { heightAlignment: { mode: 'eave', side: 'side2', targetRoofId: 'b' },
    ridgeEndChamfer: { angleDegrees: 33, distance: 0.5, matchEave: true } }), roof('b')])
  assert.deepEqual(normalizeFloor(JSON.parse(JSON.stringify(f)), new Map()).roofs![0].heightAlignment, f.roofs![0].heightAlignment)
  assert.deepEqual(normalizeFloor(JSON.parse(JSON.stringify(f)), new Map()).roofs![0].ridgeEndChamfer, f.roofs![0].ridgeEndChamfer)
  const invalid = JSON.parse(JSON.stringify(f))
  invalid.roofs[0].heightAlignment = { mode: 'eave', side: 'invalid', targetRoofId: 'b' }
  assert.equal(normalizeFloor(invalid, new Map()).roofs![0].heightAlignment, undefined)
})

test('missing targets, incompatible slopes and mixed height-link cycles retain finite manual settings', () => {
  const resolve = (roofs: RoofStructure[]) => resolveRoofRidgeHeights(roofs.map(r => roofJunctionInput(r, 'floor', 2.4)))
  for (const targetRoofId of ['missing', 'a']) {
    const result = resolve([roof('a', { heightOffset: 0.1, heightAlignment: { mode: 'slope', targetRoofId } })])
    assert.equal(result.alignments.get('a')?.state, 'unresolved')
    near(result.inputs[0].roof.heightOffset!, 0.1)
  }
  const incompatible = resolve([roof('a', { heightAlignment: { mode: 'slope', targetRoofId: 'b' } }), roof('b', { pitchDegrees: 29 })])
  assert.equal(incompatible.alignments.get('a')?.state, 'unresolved')
  const cyclic = resolve([roof('a', { asymmetricSides: true, ridgeHeightTargetRoofId: 'b' }),
    roof('b', { heightAlignment: { mode: 'slope', targetRoofId: 'a' } })])
  assert.equal(cyclic.links.get('a')?.state, 'unresolved')
  assert.equal(cyclic.alignments.get('b')?.state, 'unresolved')
  for (const input of cyclic.inputs)
    assert.ok(roofToWorld(input.roof, input.elevation, [0, 0, 0]).every(Number.isFinite))
})
