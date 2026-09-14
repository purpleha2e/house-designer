import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveRoofJunctions, roofJunctionInput, roofSurfaceHeights, roofToLocal, roofToWorld, normalizeRoofEndConnection, resolvedRoofWallSegments } from '../src/roofJunctions.ts'
import type { RoofStructure } from '../src/types.ts'

function roof(id: string, x: number, z: number, overrides: Partial<RoofStructure> = {}): RoofStructure {
  return { id, type: 'up-and-over', position: { x, y: z }, supportPosition: { x, y: z },
    width: 4, depth: 6, supportWidth: 4, supportDepth: 6, pitchDegrees: 45, rotation: 0, ...overrides }
}
function input(r: RoofStructure, elevation = 2.4, floor = 'ground') { return roofJunctionInput(r, floor, elevation) }
function height(faces: number[][][], x: number, y: number) { return Math.max(...roofSurfaceHeights(faces as [number, number, number][][], { x, y })) }
const branch = () => roof('branch', 0, -3)
const main = () => roof('main', 0, 2, { rotation: Math.PI / 2, depth: 10, supportDepth: 10 })

test('a higher overhang does not cut a lower lean-to away from its supporting facade', () => {
  const leanTo = input(roof('lean', 0, 0, { type: 'lean-to', pitchDegrees: 20 }))
  const upper = input(roof('upper', 4, 0, { width: 5, overhangSide: 0.5 }), 5, 'upper')
  const [alone] = resolveRoofJunctions([leanTo])
  const [belowOverhang, upperResolved] = resolveRoofJunctions([leanTo, upper])
  const [upperAlone] = resolveRoofJunctions([upper])
  for (const x of [1.6, 1.8, 1.99]) {
    assert.ok(Math.abs(height(belowOverhang.faces, x, 0) - height(alone.faces, x, 0)) < 1e-8)
    const lowerHeights = roofSurfaceHeights(belowOverhang.coverageFaces, { x, y: 0 })
    assert.ok(lowerHeights.length)
    for (const y of lowerHeights) {
      assert.ok(Math.abs(y - height(alone.faces, x, 0)) < 1e-8, 'upper overhang cannot take over lower wall coverage')
    }
    const upperHeights = roofSurfaceHeights(upperResolved.coverageFaces, { x, y: 0 })
    assert.ok(upperHeights.length)
    assert.ok(upperHeights.every((y) => Math.abs(y - height(upperAlone.faces, x, 0)) < 1e-8), 'lower lean-to cannot cut upper wall tops')
  }
  assert.ok(Math.abs(Math.max(...belowOverhang.faces.flat().map(([x]) => x)) - 2) < 1e-8)
})

test('an overhang still clips a panel that intersects its shell, while preserving a panel beneath the air gap', () => {
  const upper = input(roof('upper', 4, 0, { type: 'flat', width: 5, overhangSide: 0.5 }), 5, 'upper')
  for (const gap of [0.02, 0.1]) {
    const lower = input(roof('lower', 0, 0, { type: 'flat' }), 5 - gap)
    const [resolved] = resolveRoofJunctions([lower, upper])
    assert.equal(height(resolved.faces, 1.4, 0), 5 - gap, 'exposed panel remains')
    assert.equal(height(resolved.faces, 1.8, 0), gap < 0.04 ? -Infinity : 5 - gap)
    const coverage = roofSurfaceHeights(resolved.coverageFaces, { x: 1.8, y: 0 })
    assert.ok(coverage.length)
    assert.ok(coverage.every((y) => Math.abs(y - (gap < 0.04 ? 5 : 5 - gap)) < 1e-8))
  }
})

test('automatic T junction extends only the incoming end and stops at the receiving ridge', () => {
  const [a, b] = resolveRoofJunctions([input(branch()), input(main())])
  assert.equal(a.connections[0].state, 'exposed')
  assert.equal(a.connections[1].targetRoofId, 'main')
  assert.equal(a.resolvedExtents.minY, -3)
  assert.ok(Math.abs(a.resolvedExtents.maxY - 5) < 1e-8)
  assert.ok(Number.isFinite(height(a.faces, 0, 1)))
  assert.equal(height(a.faces, 1, 1.5), -Infinity)
  assert.ok(Number.isFinite(height(b.faces, 1, 1.5)))
  assert.equal(height(a.coverageFaces, 0, 1), -Infinity, 'extension does not acquire wall coverage')
})

test('world elevation makes the higher receiving roof consume the lower branch across floors', () => {
  const [a, b] = resolveRoofJunctions([input(branch()), input(main(), 3.4, 'upper')])
  assert.equal(height(a.faces, 0, 1.5), -Infinity)
  assert.ok(Number.isFinite(height(b.faces, 0, 1.5)))
  assert.ok(Number.isFinite(height(a.faces, 0, -1)))
})

test('higher incoming ridge clips the lower crossbar in their actual overlap', () => {
  const a = branch(); a.depth = a.supportDepth = 8
  const [incoming, receiver] = resolveRoofJunctions([input(a, 3.4), input(main())])
  assert.ok(Number.isFinite(height(incoming.faces, 0, 0.5)))
  assert.equal(height(receiver.faces, 0, 0.5), -Infinity)
  assert.ok(Number.isFinite(height(receiver.faces, 4, 0.5)), 'unrelated crossbar remains')
})

test('each end can be exposed or explicitly connected, without mutating authored dimensions', () => {
  const a = branch(); a.ridgeStart = { mode: 'join', targetRoofId: 'back' }; a.ridgeEnd = { mode: 'exposed' }
  const back = roof('back', 0, -10, { rotation: Math.PI / 2, depth: 10, supportDepth: 10 })
  const before = JSON.stringify(a)
  const [resolved] = resolveRoofJunctions([input(a), input(main()), input(back)])
  assert.equal(resolved.connections[0].state, 'joined')
  assert.equal(resolved.connections[1].state, 'exposed')
  assert.ok(resolved.resolvedExtents.minY < -3)
  assert.equal(resolved.resolvedExtents.maxY, 3)
  assert.equal(JSON.stringify(a), before)
  a.ridgeEnd = { mode: 'join', targetRoofId: 'main' }
  const [both] = resolveRoofJunctions([input(a), input(main()), input(back)])
  assert.ok(both.connections.every((c) => c.state === 'joined'))
})

test('ambiguous auto connections and missing or moved targets are reported without extension', () => {
  const a = branch(), b = main(), c = { ...main(), id: 'duplicate' }
  assert.equal(resolveRoofJunctions([input(a), input(b), input(c)])[0].connections[1].state, 'unresolved')
  a.ridgeEnd = { mode: 'join', targetRoofId: b.id }
  const [missing] = resolveRoofJunctions([input(a)])
  assert.equal(missing.connections[1].state, 'unresolved')
  assert.deepEqual(missing.resolvedExtents, missing.extents)
  b.position = b.supportPosition = { x: 20, y: 2 }
  assert.equal(resolveRoofJunctions([input(a), input(b)])[0].connections[1].state, 'unresolved')
})

test('a connected roof abuts the receiving facade below its wall top and reaches its roof above', () => {
  const a = input(branch())
  a.abutments = [{ plane: ([, , z]) => z + 0.15, top: 3.4 }]
  const [resolved] = resolveRoofJunctions([a, input(main(), 3.4, 'upper')])
  assert.equal(height(resolved.faces, 1.8, 0.5), -Infinity)
  assert.ok(Number.isFinite(height(resolved.faces, 0, 0.25)))
  assert.equal(height(resolved.coverageFaces, 0, 0.25), -Infinity)
})

test('overlap wall coverage uses the resolved upper envelope rather than the hidden lower roof', () => {
  const a = roof('a', 0, 0, { ridgeStart: { mode: 'exposed' }, ridgeEnd: { mode: 'exposed' } })
  const b = roof('b', 0, 0, { rotation: Math.PI / 2, ridgeStart: { mode: 'exposed' }, ridgeEnd: { mode: 'exposed' } })
  const result = resolveRoofJunctions([input(a), input(b, 3.4)])
  assert.ok(Math.abs(height(result[0].coverageFaces, 0, 0) - 5.4) < 1e-8)
  assert.ok(Math.abs(height(result[1].coverageFaces, 0, 0) - 5.4) < 1e-8)
})

test('resolution is independent of input order and rigid transforms', () => {
  const inputs = [input(branch()), input(main(), 3.4)]
  const resolved = resolveRoofJunctions(inputs)
  assert.deepEqual(resolveRoofJunctions([...inputs].reverse()).reverse(), resolved)
  for (const angle of [0.37, Math.PI / 2, Math.PI]) {
    const transformRoof = roof('transform', 1234, -5678, { rotation: angle })
    const transformed = inputs.map((candidate) => {
      const p = roofToWorld(transformRoof, 0, [candidate.roof.position.x, 0, candidate.roof.position.y])
      return input({ ...candidate.roof, rotation: candidate.roof.rotation + angle, position: { x: p[0], y: p[2] }, supportPosition: { x: p[0], y: p[2] } }, candidate.elevation)
    })
    const result = resolveRoofJunctions(transformed)
    for (const [index, original] of resolved.entries()) {
      const faces = result[index].faces.map((face) => face.map((p) => roofToLocal(transformRoof, 0, p)))
      for (let x = -1.75; x < 1.8; x += 0.5) for (let z = -5.75; z < 3; z += 0.5) {
        const expected = height(original.faces, x, z), actual = height(faces, x, z)
        assert.ok(expected === actual || Math.abs(expected - actual) < 1e-7, `${angle}: ${index} at ${x},${z}: ${expected} vs ${actual}`)
      }
    }
  }
})

test('saved end settings validate safely and preserve stable target IDs', () => {
  for (const value of [undefined, null, 4, {}, { mode: 'other' }, { mode: 'join', targetRoofId: 4 }]) assert.equal(normalizeRoofEndConnection(value), undefined)
  assert.deepEqual(normalizeRoofEndConnection({ mode: 'join', targetRoofId: 'main', stale: true }), { mode: 'join', targetRoofId: 'main' })
})

test('an incoming ridge cannot reappear beyond the receiving ridge', () => {
  const a = branch(); a.depth = a.supportDepth = 12
  const [resolved] = resolveRoofJunctions([input(a), input(main())])
  assert.equal(resolved.connections[1].state, 'joined')
  assert.equal(height(resolved.faces, 0, 2.5), -Infinity)
})

test('wall infill captures a narrow roof panel exactly and does not bridge gaps', () => {
  const segments = resolvedRoofWallSegments([
    [[0.013, 4, -1], [0.019, 5, -1], [0.019, 5, 1], [0.013, 4, 1]],
    [[0.5, 4, -1], [1, 4, -1], [1, 4, 1], [0.5, 4, 1]],
  ], { x: 0, y: 0 }, { x: 1, y: 0 }, 2.4, 0.04)
  assert.equal(segments.length, 2)
  assert.ok(Math.abs(segments[0][0].planPoint.x - 0.013) < 1e-8)
  assert.ok(Math.abs(segments[0][1].planPoint.x - 0.019) < 1e-8)
  assert.ok(Math.abs(segments[0][1].topY - 4.965) < 1e-8)
  assert.equal(segments[1][0].planPoint.x, 0.5)
})

test('a hidden main panel cannot leave an isolated eave in front of the winning gable', () => {
  const a = roof('lower', 0, 0, { width: 4.8, overhangSide: 0.4 })
  const b = roof('higher', 0, 0, { width: 4, depth: 4.3, supportWidth: 4, supportDepth: 4, rotation: Math.PI / 2, overhangEnd: 0.15 })
  const [lower] = resolveRoofJunctions([input(a), input(b, 3.4)])
  assert.equal(height(lower.faces, 2.3, 0), -Infinity)
  assert.ok(Number.isFinite(height(lower.faces, 2.3, 2.8)), 'exposed eave remains beyond the crossing gable')
})
