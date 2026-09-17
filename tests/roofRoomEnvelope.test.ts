import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildRoomCeilingEnvelope } from '../src/roofRoomEnvelope.ts'
import { roofSurfaceHeights, roofToLocal, roofToWorld } from '../src/roofJunctions.ts'
import { createSolidRoofGeometryFromFaces, partitionRoofFacesByRooms, type RoofVertex } from '../src/roofSolidGeometry.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { getRoofThickness } from '../src/roofThickness.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { buildRoomSurfaceFloorPolygons } from '../src/wallEngine/roomSurfaceMesh.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import type { FloorLevel, Point } from '../src/types.ts'
import { carveRoofSurfaceByRooms } from '../src/roofRoomCsg.ts'

const room = [[
  { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 },
]]
const face = (left: number, right: number): RoofVertex[] => [
  [-2, left, -2], [2, right, -2], [2, right, 2], [-2, left, 2],
]

test('room ceiling follows the higher inner roof across a crossing without roof-specific junction rules', () => {
  const ceiling = buildRoomCeilingEnvelope([
    { roofId: 'a', faces: [face(1, 3)], thickness: 0.1 },
    { roofId: 'b', faces: [face(3, 1)], thickness: 0.2 },
  ], room)
  const at = (x: number, roofId: string) => roofSurfaceHeights(
    ceiling.filter(piece => piece.roofId === roofId).map(piece => piece.face), { x, y: 0 })
  assert.ok(at(-0.5, 'b').length)
  assert.equal(at(-0.5, 'a').length, 0)
  assert.ok(at(0.5, 'a').length)
  assert.equal(at(0.5, 'b').length, 0)
  assert.equal(at(1.5, 'a').length + at(1.5, 'b').length, 0)
})

test('coplanar overlapping roofs produce one interior ceiling skin', () => {
  const ceiling = buildRoomCeilingEnvelope([
    { roofId: 'a', faces: [face(2, 2)], thickness: 0.1 },
    { roofId: 'b', faces: [face(2, 2)], thickness: 0.1 },
  ], room)
  assert.ok(roofSurfaceHeights(ceiling.map(piece => piece.face), { x: 0.2, y: 0.1 }).length === 1)
})

function contains(polygon: Point[], point: Point) {
  let inside = false
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length]
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

for (const fixture of ['roof_tests_1.json', 'red_house_3.json', 'springfield_13.json']) {
  test(`${fixture} room ceiling samples match the highest authored inner roof surface`, () => {
    const saved = JSON.parse(readFileSync(new URL(`../${fixture}`, import.meta.url), 'utf8')) as { floors: FloorLevel[] }
    const roofs = resolveBuildingRoofs(saved.floors)
    let checked = 0
    for (const floor of saved.floors) {
      const floorRoofs = roofs.filter(candidate => candidate.floorId === floor.id)
      const rooms = buildWallTopology(floor.walls).rooms
      const innerPolygons = buildRoomSurfaceFloorPolygons({ renderedWalls: getRenderedWalls(floor.walls), rooms })
      const polygons = rooms.map(room => innerPolygons.get(room.signature) ?? room.polygon)
      const ceiling = buildRoomCeilingEnvelope(floorRoofs.map(candidate => ({
        roofId: candidate.roof.id, faces: candidate.resolved.exteriorFaces,
        thickness: getRoofThickness(candidate.roof),
      })), polygons)
      for (const polygon of polygons) {
        const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y)
        const minX = Math.min(...xs), maxX = Math.max(...xs)
        const minY = Math.min(...ys), maxY = Math.max(...ys)
        for (let ix = 0; ix < 11; ix++) for (let iy = 0; iy < 11; iy++) {
          const point = { x: minX + (ix + 0.37) / 11 * (maxX - minX),
            y: minY + (iy + 0.61) / 11 * (maxY - minY) }
          if (!contains(polygon, point)) continue
          const expected = floorRoofs.flatMap(candidate => roofSurfaceHeights(
            candidate.resolved.exteriorFaces, point).map(height => height - getRoofThickness(candidate.roof)))
          if (!expected.length) continue
          const actual = roofSurfaceHeights(ceiling.map(piece => piece.face), point)
          assert.ok(actual.length, `missing ceiling at ${point.x},${point.y}`)
          assert.ok(Math.abs(Math.max(...actual) - Math.max(...expected)) < 1e-4,
            `wrong ceiling height at ${point.x},${point.y}`)
          checked++
        }
      }
    }
    assert.ok(checked > 20)
  })
}

for (const fixture of ['roof_tests_1.json', 'red_house_3.json', 'springfield_13.json']) {
test(`${fixture} room cavity CSG removes roof edge faces below the ceiling envelope`, () => {
  const saved = JSON.parse(readFileSync(new URL(`../${fixture}`, import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  for (const floor of saved.floors) {
  const roofs = resolveBuildingRoofs(saved.floors).filter(candidate => candidate.floorId === floor.id)
  if (!roofs.length) continue
  const rooms = buildWallTopology(floor.walls).rooms
  const innerPolygons = buildRoomSurfaceFloorPolygons({ renderedWalls: getRenderedWalls(floor.walls), rooms })
  const polygons = rooms.map(room => innerPolygons.get(room.signature) ?? room.polygon)
  const ceiling = buildRoomCeilingEnvelope(roofs.map(candidate => ({
    roofId: candidate.roof.id, faces: candidate.resolved.exteriorFaces,
    thickness: getRoofThickness(candidate.roof),
  })), polygons)
  const cuts = ceiling.map(piece => ({ face: piece.face, thickness: 0, bottomY: floor.elevation - 0.01 }))
  for (const candidate of roofs) {
    const { roof, resolved } = candidate
    const elevation = floor.elevation + floor.roomHeight
    const local = resolved.exteriorFaces.map(face => face.map(point => roofToLocal(roof, elevation, point)))
    const soffitLocal = partitionRoofFacesByRooms(resolved.exteriorFaces, polygons).outside
      .map(face => face.map(point => roofToLocal(roof, elevation, point)))
    const source = createSolidRoofGeometryFromFaces(local, undefined, getRoofThickness(roof), local, [], soffitLocal)
    for (const part of ['shell', 'soffit'] as const) {
    const carved = carveRoofSurfaceByRooms(source[part], cuts, point => roofToLocal(roof, elevation, point))
    const position = carved.getAttribute('position')
    for (let index = 0; index < position.count; index += 3) {
      const centroid: RoofVertex = [0, 0, 0]
      for (let corner = 0; corner < 3; corner++) {
        centroid[0] += position.getX(index + corner) / 3
        centroid[1] += position.getY(index + corner) / 3
        centroid[2] += position.getZ(index + corner) / 3
      }
      const [x, y, z] = roofToWorld(roof, elevation, centroid)
      if (!polygons.some(polygon => contains(polygon, { x, y: z }))) continue
      const ceilingY = roofSurfaceHeights(ceiling.map(piece => piece.face), { x, y: z })
      if (ceilingY.length) assert.ok(y >= Math.max(...ceilingY) - 1e-4,
        `${part} from ${roof.id} remains inside room at ${x},${y},${z}, ceiling ${Math.max(...ceilingY)}`)
    }
    if (carved !== source[part]) carved.dispose()
    }
    source.top.dispose(); source.shell.dispose(); source.underside.dispose(); source.soffit.dispose()
  }
  }
})
}
