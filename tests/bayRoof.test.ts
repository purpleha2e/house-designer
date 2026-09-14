import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildBayRoofFaces, createBayRoofLayout, getBayRoofPolygon, getBaySupportPolygon, normalizeBayOutline } from '../src/bayRoof.ts'
import { createBayRoofEavesGeometry } from '../src/bayRoofEaves.ts'
import { getBayRoofTopUvs } from '../src/roofUv.ts'
import { getRoofWithExternalWallSupportExtents, resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { roofSurfaceHeights, roofToWorld } from '../src/roofJunctions.ts'
import { normalizeFloor } from '../src/modelPlacement.ts'
import type { FloorLevel, Point, RoofStructure, Wall } from '../src/types.ts'

const square = [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: -2, y: 3 }]
const angled = [square[0], square[1], { x: 2, y: 1 }, { x: 1, y: 3 }, { x: -1, y: 3 }, { x: -2, y: 1 }]
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
const roofFor = (points = square): RoofStructure => {
  const layout = createBayRoofLayout(points)
  assert.ok(layout)
  return { ...layout, id: 'bay', type: 'bay', pitchDegrees: 40, overhangSide: 0.25, soffitColor: '#ffeecc' }
}
const floorFor = (roof: RoofStructure): FloorLevel => ({
  id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: 0.2,
  walls: [], rooms: [], models: [], roofs: [roof],
})
const area = (points: Point[]) => Math.abs(points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y
}, 0)) / 2

test('red house bay meets the outer brick faces while keeping its mounting point fixed', () => {
  const { roof, walls } = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/red_house_3_bay.json', import.meta.url), 'utf8')) as { roof: RoofStructure; walls: Wall[] }
  const adjusted = getRoofWithExternalWallSupportExtents(roof, walls)
  const world = getBaySupportPolygon(adjusted).map(p => roofToWorld(adjusted, 2.4, [p.x, 0, p.y]))
  close(world[1][0], 1.35); close(world[2][0], 1.35)
  close(world[2][2], 10.584318178330289); close(world[3][2], 10.584318178330289)
  close(world[0][0], -1.8701323633941548); close(world[3][0], -1.8701323633941548)
  const originalApex = buildBayRoofFaces(roof)[0][0], apex = buildBayRoofFaces(adjusted)[0][0]
  close(apex[0], originalApex[0]); close(apex[2], originalApex[2])
  const faceHeights = roofSurfaceHeights(resolveBuildingRoofs([{ ...floorFor(roof), walls }])[0].resolved.faces, { x: 0, y: 10.584318178330289 })
  assert.ok(faceHeights.length > 0)
  faceHeights.forEach(height => close(height, 2.4))
  // Check the resolved support, including when wall endpoints run in reverse.
  const reversed = getRoofWithExternalWallSupportExtents(roof, walls.map(w => ({ ...w, start: w.end, end: w.start })))
  getBaySupportPolygon(reversed).forEach((p, i) => {
    close(p.x, getBaySupportPolygon(adjusted)[i].x); close(p.y, getBaySupportPolygon(adjusted)[i].y)
  })
  assert.deepEqual(roof.baySupportOffsets, undefined, 'the saved mounting outline is not mutated')
})

test('first two mounting points locate the apex even when reversed, rotated or translated', () => {
  for (const angle of [0, 0.61, Math.PI, -Math.PI / 2]) for (const reversed of [false, true]) {
    const transform = (p: Point) => ({ x: 7 + p.x * Math.cos(angle) - p.y * Math.sin(angle), y: -4 + p.x * Math.sin(angle) + p.y * Math.cos(angle) })
    const points = angled.map(transform)
    if (reversed) [points[0], points[1]] = [points[1], points[0]]
    const roof = roofFor(points)
    const faces = buildBayRoofFaces(roof).filter(face => face.length === 3)
    assert.equal(faces.length, 5)
    for (const face of faces) {
      const apex = roofToWorld(roof, 0, face[0])
      close(apex[0], 7); close(apex[2], -4)
      assert.ok(apex[1] > 0)
    }
    const world = getBaySupportPolygon(roof).map(p => roofToWorld(roof, 0, [p.x, 0, p.y]))
    assert.ok(points.every(p => world.some(q => Math.hypot(p.x - q[0], p.y - q[2]) < 1e-6)))
  }
})

test('mounting edge cannot be a diagonal, degenerate, or surrounded on both sides', () => {
  assert.equal(createBayRoofLayout([square[0], square[2], square[1], square[3]]), null)
  assert.equal(createBayRoofLayout([square[0], square[0], square[2]]), null)
  assert.equal(createBayRoofLayout([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), null)
  assert.equal(createBayRoofLayout([...square, { x: 0, y: -1 }]), null)
  assert.equal(normalizeBayOutline([{ x: 0, y: 0 }, { x: 0.5, y: NaN }, { x: 0, y: 0.5 }]), undefined)
  assert.equal(normalizeBayOutline([{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]), undefined)
})

test('square and angled panels cover their footprint once with shared seams and a flush rear', () => {
  for (const points of [square, angled]) for (const overhangPitchDegrees of [0, 22, 40]) {
    const roof = { ...roofFor(points), overhangPitchDegrees }
    const faces = buildBayRoofFaces(roof)
    const outline = getBayRoofPolygon(roof)
    close(faces.reduce((sum, face) => sum + area(face.map(([x, , y]) => ({ x, y }))), 0), area(outline))
    const support = getBaySupportPolygon(roof)
    close(Math.min(...outline.map(p => p.y)), support[0].y)
    const edges = new Map<string, number>()
    for (const face of faces) face.forEach((p, i) => {
      const q = face[(i + 1) % face.length]
      const key = [p, q].map(v => v.map(c => c.toFixed(6)).join(',')).sort().join('|')
      edges.set(key, (edges.get(key) ?? 0) + 1)
    })
    assert.ok([...edges.values()].every(count => count === 1 || count === 2))
    // Only the outer boundary and the two rear slopes remain unshared.
    assert.equal([...edges.values()].filter(count => count === 1).length, points.length + 3)
    const eaves = createBayRoofEavesGeometry(roof, faces, 0.035)!
    assert.ok(eaves.getAttribute('position').count > 0)
    assert.ok(Array.from(eaves.getAttribute('position').array).every(Number.isFinite))
    close(eaves.boundingBox!.min.z, support[0].y)
    eaves.dispose()
  }
})

test('tile rows follow each eave with metre scale and continuous UVs at the pitch break', () => {
  for (const points of [square, angled]) for (const overhangPitchDegrees of [0, 22, 40]) {
    const roof = { ...roofFor(points), overhangPitchDegrees }
    const faces = buildBayRoofFaces(roof)
    for (let i = 0; i < faces.length; i += 2) {
      const panel = faces[i], eave = faces[i + 1]
      const uv = getBayRoofTopUvs(roof, panel), eaveUv = getBayRoofTopUvs(roof, eave)
      close(uv[1][1], uv[2][1])
      close(Math.abs(uv[1][0] - uv[2][0]), Math.hypot(panel[1][0] - panel[2][0], panel[1][2] - panel[2][2]))
      close(uv[1][0], eaveUv[0][0]); close(uv[1][1], eaveUv[0][1])
      close(uv[2][0], eaveUv[3][0]); close(uv[2][1], eaveUv[3][1])
      for (let a = 0; a < panel.length; a++) for (let b = a + 1; b < panel.length; b++) {
        close(Math.hypot(uv[a][0] - uv[b][0], uv[a][1] - uv[b][1]), Math.hypot(...panel[a].map((v, j) => v - panel[b][j])))
      }
    }
  }
})

test('save/load retains bay direction and outline, and resolved coverage excludes cut-off corners', () => {
  const roof = roofFor(angled)
  const floor = normalizeFloor(JSON.parse(JSON.stringify(floorFor(roof))), new Map())
  assert.equal(floor.roofs![0].type, 'bay')
  assert.deepEqual(floor.roofs![0].bayOutline, roof.bayOutline)
  assert.equal(floor.roofs![0].soffitColor, '#ffeecc')
  const [{ resolved }] = resolveBuildingRoofs([floor])
  assert.ok(roofSurfaceHeights(resolved.coverageFaces, { x: 0, y: 1 }).length > 0)
  assert.equal(roofSurfaceHeights(resolved.coverageFaces, { x: 2, y: 3 }).length, 0)
  const scaled = { ...roof, width: roof.width * 2, supportWidth: roof.supportWidth! * 2 }
  close(area(getBaySupportPolygon(scaled)), area(getBaySupportPolygon(roof)) * 2)
})
