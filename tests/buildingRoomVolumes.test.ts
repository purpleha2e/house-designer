import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { resolveBuildingRoofs, type BuildingRoof } from '../src/roofBuildingGeometry.ts'
import { roofBoundsPolygon, roofSurfaceHeights, roofToLocal, roofToWorld } from '../src/roofJunctions.ts'
import { carveRoofSurfaceByRooms, type RoomRoofCut } from '../src/roofRoomCsg.ts'
import { createSolidRoofGeometryFromFaces, splitRoofUndersideFaces, type RoofVertex } from '../src/roofSolidGeometry.ts'
import { getRoofThickness } from '../src/roofThickness.ts'
import type { FloorLevel } from '../src/types.ts'

function fixture(name: string): FloorLevel[] {
  return (JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as {
    floors: FloorLevel[]
  }).floors
}

test('enclosed rooms on both Red House storeys generate cutters', () => {
  const floors = fixture('red_house_3.json')
  const { cuts, roomPolygonsByFloor } = buildBuildingRoomVolumes(floors, resolveBuildingRoofs(floors))
  for (const [index, floor] of floors.entries()) {
    assert.ok(roomPolygonsByFloor.get(floor.id)?.length, `${floor.name} has enclosed rooms`)
    const slabThickness = floors[index - 1]?.slabThickness ?? 0
    assert.ok(cuts.some(cut => Math.abs(cut.bottomY - (floor.elevation - slabThickness - 0.01)) < 1e-6),
      `${floor.name} contributes a room volume`)
  }
})

test('a roofless room has a closed horizontal volume', () => {
  const [floor] = fixture('red_house_3.json')
  const { cuts, ceilingFaces } = buildBuildingRoomVolumes([floor], [])
  assert.ok(cuts.length)
  assert.equal(ceilingFaces.length, 0)
  assert.ok(cuts.every(cut => cut.face.every(([, y]) =>
    Math.abs(y - floor.elevation - floor.roomHeight) < 1e-6)))
})

test('Red House upper room uses an encroaching ground floor roof as its local ceiling', () => {
  const floors = fixture('red_house_3.json')
  const roofs = resolveBuildingRoofs(floors)
  const { cuts } = buildBuildingRoomVolumes(floors, roofs)
  const groundRoofIds = new Set(roofs.filter(roof => roof.floorId === floors[0].id).map(roof => roof.roof.id))
  const upperFloor = floors[1]
  const upperCuts = cuts.filter(cut => Math.abs(cut.bottomY -
    (upperFloor.elevation - floors[0].slabThickness - 0.01)) < 1e-6)
  const invadingRoofCeilings = upperCuts.filter(cut => groundRoofIds.has(cut.roofId ?? '') &&
    cut.face.some(([, y]) => y > upperFloor.elevation + 0.01))
  assert.ok(upperCuts.length)
  assert.ok(invadingRoofCeilings.length, 'ground floor roof bounds part of the first floor room')
  for (const cut of invadingRoofCeilings) {
    const x = cut.face.reduce((sum, vertex) => sum + vertex[0], 0) / cut.face.length
    const z = cut.face.reduce((sum, vertex) => sum + vertex[2], 0) / cut.face.length
    const atPoint = roofSurfaceHeights([cut.face], { x, y: z })
    assert.ok(atPoint.length, 'the room volume reaches the invading roof inner skin')
  }
})

test('an open top floor follows its own roof rather than the horizontal ceiling', () => {
  const floors = fixture('roof_tests_1.json')
  floors[0].ceilingMode = 'open'
  const roofs = resolveBuildingRoofs(floors)
  const { ceilingFaces, cuts } = buildBuildingRoomVolumes(floors, roofs)
  assert.ok(ceilingFaces.some(piece => roofs.some(roof => roof.roof.id === piece.roofId)))
  assert.ok(cuts.some(cut => cut.face.some(([, y]) => y > floors[0].elevation + floors[0].roomHeight + 0.05)))
})

test('Red House roof tops are carved against rooms on both floors', () => {
  const floors = fixture('red_house_3.json')
  const roofs = resolveBuildingRoofs(floors)
  const { cuts } = buildBuildingRoomVolumes(floors, roofs)
  let changedRoofTops = 0
  for (const { roof, resolved, floorTopElevation } of roofs) {
    const faces = resolved.exteriorFaces.map(face => face.map(point =>
      roofToLocal(roof, floorTopElevation, point)))
    const solid = createSolidRoofGeometryFromFaces(faces, undefined, getRoofThickness(roof))
    const originalCount = solid.top.getAttribute('position').count
    const carved = carveRoofSurfaceByRooms(solid.top, cuts,
      point => roofToLocal(roof, floorTopElevation, point))
    if (originalCount !== carved.getAttribute('position').count) changedRoofTops++
    const positions = carved.getAttribute('position')
    for (let index = 0; index < positions.count; index += 3) {
      const center = [0, 0, 0] as RoofVertex
      for (let corner = 0; corner < 3; corner++) {
        center[0] += positions.getX(index + corner) / 3
        center[1] += positions.getY(index + corner) / 3
        center[2] += positions.getZ(index + corner) / 3
      }
      const [x, y, z] = roofToWorld(roof, floorTopElevation, center)
      for (const cut of cuts) {
        if (y < cut.bottomY + 0.001) continue
        const heights = roofSurfaceHeights([cut.face], { x, y: z })
        assert.ok(!heights.some(height => y < height - 0.005),
          `${roof.id} roof top remains inside a room at ${x}, ${y}, ${z}`)
      }
    }
    if (carved !== solid.top) carved.dispose()
    Object.values(solid).forEach(geometry => geometry.dispose())
  }
  assert.ok(changedRoofTops > 0, 'room subtraction changes the tiled roof surfaces')
})

test('Red House keeps the lower roof skin where it bounds the first floor room', () => {
  const floors = fixture('red_house_3.json')
  const roofs = resolveBuildingRoofs(floors)
  const { cuts } = buildBuildingRoomVolumes(floors, roofs)
  const cap = cuts.find(piece => piece.floorId === floors[1].id && roofs.some(candidate =>
    candidate.roof.id === piece.roofId && candidate.floorId === floors[0].id) &&
    piece.face.every(([, y]) => y > floors[1].elevation + 0.01))
  assert.ok(cap)
  const candidate = roofs.find(roof => roof.roof.id === cap.roofId)!
  const point = {
    x: cap.face.reduce((sum, vertex) => sum + vertex[0], 0) / cap.face.length,
    y: cap.face.reduce((sum, vertex) => sum + vertex[2], 0) / cap.face.length,
  }
  const expected = roofSurfaceHeights(candidate.resolved.exteriorFaces, point)
  assert.ok(expected.length)
  const faces = candidate.resolved.exteriorFaces.map(face => face.map(vertex =>
    roofToLocal(candidate.roof, candidate.floorTopElevation, vertex)))
  const solid = createSolidRoofGeometryFromFaces(faces, undefined, getRoofThickness(candidate.roof))
  const carved = carveRoofSurfaceByRooms(solid.top, cuts,
    vertex => roofToLocal(candidate.roof, candidate.floorTopElevation, vertex))
  const positions = carved.getAttribute('position')
  const worldFaces: RoofVertex[][] = []
  for (let index = 0; index < positions.count; index += 3) {
    worldFaces.push([0, 1, 2].map(offset => roofToWorld(candidate.roof,
      candidate.floorTopElevation, [
        positions.getX(index + offset), positions.getY(index + offset), positions.getZ(index + offset),
      ])))
  }
  const actual = roofSurfaceHeights(worldFaces, point)
  assert.ok(actual.some(height => Math.abs(height - expected[0]) < 1e-4),
    'the invading roof surface remains above its inner skin')
  if (carved !== solid.top) carved.dispose()
  Object.values(solid).forEach(geometry => geometry.dispose())
})

function renderedRoofFaces(candidate: BuildingRoof, cuts: RoomRoofCut[], part: 'top' | 'underside') {
  const { roof, resolved, floorTopElevation } = candidate
  const support = roofBoundsPolygon(resolved, resolved.support)
  const { undersideFaces, soffitFaces } = splitRoofUndersideFaces(resolved.exteriorFaces, support)
  const local = (faces: RoofVertex[][]) => faces.map(face => face.map(point =>
    roofToLocal(roof, floorTopElevation, point)))
  const faces = local(resolved.exteriorFaces)
  const solid = createSolidRoofGeometryFromFaces(faces, undefined,
    getRoofThickness(roof), faces, local(undersideFaces), local(soffitFaces))
  const selectedCuts = part === 'underside'
    ? cuts.map(cut => ({ ...cut, thickness: cut.thickness + 0.004 })) : cuts
  const carved = carveRoofSurfaceByRooms(solid[part], selectedCuts,
    point => roofToLocal(roof, floorTopElevation, point))
  const positions = carved.getAttribute('position')
  const worldFaces: RoofVertex[][] = []
  for (let index = 0; index < positions.count; index += 3) {
    worldFaces.push([0, 1, 2].map(offset => roofToWorld(roof,
      floorTopElevation, [
        positions.getX(index + offset), positions.getY(index + offset), positions.getZ(index + offset),
      ])))
  }
  if (carved !== solid[part]) carved.dispose()
  Object.values(solid).forEach(geometry => geometry.dispose())
  return worldFaces
}

test('Red House lower rear roof stays intact beside the upper-storey facade', () => {
  const floors = fixture('red_house_3.json')
  const roofs = resolveBuildingRoofs(floors)
  const cuts = buildBuildingRoomVolumes(floors, roofs).cuts
  const lowerRoof = roofs.find(candidate =>
    candidate.roof.id === 'ded6c505-6aac-4048-b57f-100b57f99cf5')!
  const point = { x: -1.94, y: 7.78 }
  const original = roofSurfaceHeights(lowerRoof.resolved.exteriorFaces, point)
  const visible = roofSurfaceHeights(renderedRoofFaces(lowerRoof, cuts, 'top'), point)
  assert.ok(original.length)
  assert.ok(visible.some(height => Math.abs(height - original[0]) < 0.002),
    'the lower tiled panel remains where it meets the upper-storey wall')
})

test('Red House upper room removes lower roof tiles from its floor slab', () => {
  const floors = fixture('red_house_3.json')
  const roofs = resolveBuildingRoofs(floors)
  const cuts = buildBuildingRoomVolumes(floors, roofs).cuts
  const upperFloor = floors[1]
  const slabBottom = upperFloor.elevation - floors[0].slabThickness
  const withoutSlab = cuts.map(cut => cut.floorId === upperFloor.id
    ? { ...cut, bottomY: upperFloor.elevation - 0.01 } : cut)
  let removedSamples = 0
  for (const candidate of roofs.filter(roof => roof.floorId === floors[0].id)) {
    const oldTop = renderedRoofFaces(candidate, withoutSlab, 'top')
    const newTop = renderedRoofFaces(candidate, cuts, 'top')
    for (let x = -9; x < 7; x += 0.2) for (let z = -4; z < 11; z += 0.2) {
      const point = { x, y: z }
      const oldHeights = roofSurfaceHeights(oldTop, point)
        .filter(y => y > slabBottom + 0.005 && y < upperFloor.elevation - 0.005)
      if (!oldHeights.length) continue
      const newHeights = roofSurfaceHeights(newTop, point)
      if (oldHeights.some(y => !newHeights.some(next => Math.abs(next - y) < 0.005))) removedSamples++
    }
  }
  assert.ok(removedSamples > 0, 'the upper room void removes a lower roof fragment from the slab')
})

test('roof_tests_1 removes each roof top inside the other roof cavity', () => {
  const floors = fixture('roof_tests_1.json')
  const roofs = resolveBuildingRoofs(floors)
  const { cuts } = buildBuildingRoomVolumes(floors, roofs)
  const mainTop = renderedRoofFaces(roofs[0], cuts, 'top')
  const branchTop = renderedRoofFaces(roofs[1], cuts, 'top')
  const branchWins = { x: 3, y: 6.5 }
  const mainWins = { x: 4, y: 6.78 }
  assert.equal(roofSurfaceHeights(mainTop, branchWins).length, 0)
  assert.ok(roofSurfaceHeights(branchTop, branchWins).length)
  assert.equal(roofSurfaceHeights(branchTop, mainWins).length, 0)
  assert.ok(roofSurfaceHeights(mainTop, mainWins).length)
})

test('roof_tests_1 exposed overhang cannot clip the adjoining roof through its room volume', () => {
  const floors = fixture('roof_tests_1.json')
  const roofs = resolveBuildingRoofs(floors)
  const { cuts } = buildBuildingRoomVolumes(floors, roofs)
  const point = { x: 3.641, y: 6.974 }
  const mainRoof = roofs[0]
  const branchRoof = roofs[1]
  const mainCuts = cuts.filter(cut => cut.roofId === mainRoof.roof.id)
  assert.equal(roofSurfaceHeights(mainCuts.map(cut => cut.face), point).length, 0,
    'the main roof overhang is outside its supported room ceiling')
  const original = roofSurfaceHeights(branchRoof.resolved.exteriorFaces, point)
  const visible = roofSurfaceHeights(renderedRoofFaces(branchRoof, cuts, 'top'), point)
  assert.ok(original.length)
  assert.ok(visible.some(height => Math.abs(height - original[0]) < 0.002),
    'the adjoining outer roof skin remains under the exposed overhang')
})

test('roof_tests_1 retains an inner roof skin beneath visible panels across the attic', () => {
  const floors = fixture('roof_tests_1.json')
  const roofs = resolveBuildingRoofs(floors)
  const { cuts } = buildBuildingRoomVolumes(floors, roofs)
  let samples = 0
  for (const candidate of roofs) {
    const { roof, resolved } = candidate
    const support = roofBoundsPolygon(resolved, resolved.support)
    const insideSupport = ({ x, y }: { x: number; y: number }) => {
      let inside = false
      for (let index = 0; index < support.length; index++) {
        const a = support[index], b = support[(index + 1) % support.length]
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
      }
      return inside
    }
    const topFaces = renderedRoofFaces(candidate, cuts, 'top')
    const worldFaces = renderedRoofFaces(candidate, cuts, 'underside')
    for (let x = 0.37; x < 7; x += 0.37) for (let z = 0.41; z < 9; z += 0.41) {
      const point = { x, y: z }
      if (!insideSupport(point)) continue
      const top = roofSurfaceHeights(topFaces, point)
      if (!top.length || Math.max(...top) < floors[0].elevation + floors[0].roomHeight + 0.2) continue
      const expected = Math.max(...top) - getRoofThickness(roof)
      const otherInner = roofs.filter(item => item !== candidate).flatMap(item =>
        roofSurfaceHeights(item.resolved.exteriorFaces, point).map(height =>
          height - getRoofThickness(item.roof)))
      if (otherInner.some(height => expected < height + 0.005)) continue
      const actual = roofSurfaceHeights(worldFaces, point)
      assert.ok(actual.some(height => Math.abs(height - expected) < 0.002),
        `${roof.id} roof underside missing at ${x}, ${z}`)
      samples++
    }
  }
  assert.ok(samples > 50)
})

test('roof_tests_1 preserves every sampled outer panel above the inner roof skins', () => {
  const floors = fixture('roof_tests_1.json')
  const roofs = resolveBuildingRoofs(floors)
  const { cuts } = buildBuildingRoomVolumes(floors, roofs)
  let preserved = 0
  for (const candidate of roofs) {
    const visible = renderedRoofFaces(candidate, cuts, 'top')
    for (let x = -0.3; x < 7; x += 0.31) for (let z = 1.5; z < 9.3; z += 0.33) {
      const point = { x, y: z }
      const original = roofSurfaceHeights(candidate.resolved.exteriorFaces, point)
      if (!original.length) continue
      const cutHeights = roofSurfaceHeights(cuts.map(cut => cut.face), point)
      const highestCut = cutHeights.length ? Math.max(...cutHeights) : -Infinity
      for (const height of original) {
        if (height < highestCut + 0.01) continue
        assert.ok(roofSurfaceHeights(visible, point).some(after => Math.abs(after - height) < 0.002),
          `${candidate.roof.id} outer panel lost above the cavity at ${x}, ${z}`)
        preserved++
      }
    }
  }
  assert.ok(preserved > 100)
})
