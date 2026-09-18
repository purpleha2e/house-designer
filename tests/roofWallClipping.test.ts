import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildRoofClippedWallSamples, createWallRoofClipOptions, isRoofAbuttingWall } from '../src/roofWallClipping.ts'
import type { FloorLevel, Point, Wall } from '../src/types.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { buildFloorWallSurfaceFaces } from '../src/wallEngine/floorWallSurfaceMesh.ts'
import { clipWallFacesToRoofUndersides } from '../src/wallEngine/wallRoofClip.ts'
import { createWallRoofClipJob, runWallRoofClipJob } from '../src/wallEngine/wallRoofClipJob.ts'
import { buildRoofProfileFaces } from '../src/roofProfile.ts'
import { getRoofRenderPosition, getRoofSupportBoundsInRoofSpace, getRoofWorldPointFromLocal, resolveBuildingRoofs, serializeRoofGeometryInput } from '../src/roofBuildingGeometry.ts'
import { getRoofAbutmentPlanes } from '../src/roofAbutmentGeometry.ts'
import { prepareRenderedFloorData, serializeWallGeometryInput } from '../src/threeDLevelPreparation.ts'
import { getRoofThickness } from '../src/roofThickness.ts'
import { getRoofCoverageUndersideFaces, getRoofRenderableOuterFaces } from '../src/roofJunctions.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'

function boundaryFace(z: number, top = 2.4): WallMeshFace {
  return {
    faceId: 'gable-side', wallId: 'gable', kind: 'side', normal: [0, 0, 1],
    materialSource: { wallId: 'gable', side: -1 },
    pickSource: { wallId: 'gable', side: -1 },
    uvSource: { wallId: 'gable', side: -1 },
    vertices: [[0, 0, z], [1, 0, z], [1, top, z], [0, top, z]].map((position) => ({
      position: position as [number, number, number], uv: [position[0], position[1]],
    })) as WallMeshFace['vertices'],
  }
}

test('a shared roof coverage edge preserves the wall beneath the higher adjoining panel', () => {
  const lower: [number, number, number][] = [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]
  const higher: [number, number, number][] = [[0, 3, -1], [1, 3.5, -1], [1, 3.5, 0], [0, 3, 0]]
  const face = boundaryFace(0, 4)
  for (const undersideFaces of [[lower, higher], [higher, lower]]) {
    const options = createWallRoofClipOptions({ floorElevation: 0, floorId: 'upper', walls: [],
      roofs: [{ floorId: 'lower', supportPolygon: [], undersideFaces }],
    })
    const result = clipWallFacesToRoofUndersides([face], options)
    const area = result.reduce((sum, f) => {
      const [a, b, c] = f.vertices.map((v) => v.position)
      return sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
    }, 0)
    assert.ok(Math.abs(area - 3.25) < 1e-8, 'boundary follows the higher slope, without duplicate faces')
    assert.ok(result.every((f) => f.vertices.every(({ position: [x, y], uv }) => y <= 3 + x * 0.5 + 1e-8 && uv[1] === y)))
    assert.ok(clipWallFacesToRoofUndersides([boundaryFace(0.01)], options)
      .every((f) => f.vertices.every((v) => v.position[1] <= 1)), 'wall inside the lower region is still cut')
  }
  const separateRoofs = createWallRoofClipOptions({ floorElevation: 0, floorId: 'upper', walls: [],
    roofs: [lower, higher].map((face, index) => ({ floorId: `lower-${index}`, supportPolygon: [], undersideFaces: [face] })),
  })
  assert.ok(clipWallFacesToRoofUndersides([face], separateRoofs)
    .every((f) => f.vertices.every((v) => v.position[1] <= 1)), 'independent overhang coverage remains separate')
})

test('red house rear gable retains its exterior corner at the lower roof coverage boundary', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/red_house_3.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const upper = floors[1]
  // Add the upstairs gable from the reported project to the immutable house fixture.
  upper.roofs = [{ id: 'upper-gable', type: 'up-and-over', rotation: 0, pitchDegrees: 45,
    position: { x: -0.29756618169707727, y: 4.413724374873001 },
    supportPosition: { x: -0.29756618169707727, y: 4.413724374873001 },
    supportWidth: 2.9951323633941556, supportDepth: 6.841187606914573,
    width: 3.2951323633941554, depth: 7.141187606914574,
    overhangSide: 0.15, overhangEnd: 0.15,
  }]
  const roofs = resolveBuildingRoofs(floors).map(({ roof, resolved, floorId }) => {
    const bounds = getRoofSupportBoundsInRoofSpace(roof)
    return { floorId,
      supportPolygon: [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }]
        .map((point) => getRoofWorldPointFromLocal(roof, point)),
      undersideFaces: resolved.coverageFaces.map((face) => face.map(([x, y, z]): [number, number, number] => [x, y - 0.035, z])),
    }
  })
  const facade = boundaryFace(7.984318178)
  facade.vertices = facade.vertices.map((v) => ({ ...v, position: [0.95 + v.position[0] * 0.35, v.position[1], v.position[2]] })) as WallMeshFace['vertices']
  const options = createWallRoofClipOptions({ floorElevation: upper.elevation, floorId: upper.id, walls: [], roofs })
  assert.deepEqual(clipWallFacesToRoofUndersides([facade], options), [facade], 'outside brick face must not disappear and reveal the inside face')
})

test('wall infill follows the covering roof underside through an overlap', () => {
  const samples = buildRoofClippedWallSamples({
    bottomY: 2.4,
    end: { x: 2, y: 0 },
    getRoofSurfaceHeights: ({ x }) => x < 1.5 ? [3] : [3, 2.7],
    maxStep: 1,
    roofThickness: 0.04,
    start: { x: 0, y: 0 },
  })

  assert.deepEqual(samples, [
    { planPoint: { x: 0, y: 0 }, topY: 2.965 },
    { planPoint: { x: 1, y: 0 }, topY: 2.965 },
    { planPoint: { x: 2, y: 0 }, topY: 2.965 },
  ])
})

test('wall infill is removed where a roof underside is below its base', () => {
  const samples = buildRoofClippedWallSamples({
    bottomY: 2.4,
    end: { x: 1, y: 0 },
    getRoofSurfaceHeights: () => [2.3],
    maxStep: 1,
    roofThickness: 0.04,
    start: { x: 0, y: 0 },
  })

  assert.ok(samples.every((sample) => sample.topY === 2.4))
})

test('a higher crossing roof fills the gable above a lower roof eave', () => {
  const samples = buildRoofClippedWallSamples({
    bottomY: 5, roofThickness: 0.04, maxStep: 1,
    start: { x: 0, y: 0 }, end: { x: 2, y: 0 },
    getRoofSurfaceHeights: ({ x }) => [5.1, 5 + x],
  })
  assert.ok(samples[1].topY > 5.9)
  assert.ok(samples[2].topY > 6.9)
})

const supportPolygon = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }, { x: 0, y: 6 }]
const facade: Wall = {
  id: 'facade', kind: 'external', height: 2.4, thickness: 0.3,
  start: { x: 0, y: -2 }, end: { x: 0, y: 3 },
}

test('a parallel facade abuts a roof, but a crossing wall and a contained gable are trimmed', () => {
  assert.equal(isRoofAbuttingWall({ supportPolygon, wall: facade }), true)
  assert.equal(isRoofAbuttingWall({ supportPolygon, wall: { ...facade, start: { x: 0, y: 0 }, end: { x: 0, y: 6 } } }), false)
  assert.equal(isRoofAbuttingWall({ supportPolygon, wall: { ...facade, start: { x: -2, y: 3 }, end: { x: 3, y: 3 } } }), false)
  assert.equal(isRoofAbuttingWall({ supportPolygon, wall: { ...facade, kind: 'internal' } }), false)
})

test('detected room side distinguishes a contained facade from a supporting gable', () => {
  const wall = { ...facade, start: { x: 0, y: 1 }, end: { x: 0, y: 5 } }
  assert.equal(isRoofAbuttingWall({ supportPolygon, wall, isInsideRoom: ({ x }) => x < 0 }), true)
  assert.equal(isRoofAbuttingWall({ supportPolygon, wall, isInsideRoom: ({ x }) => x > 0 }), false)
  assert.equal(isRoofAbuttingWall({ supportPolygon, wall, isInsideRoom: () => true }), false)
  assert.equal(isRoofAbuttingWall({
    supportPolygon,
    wall: { ...wall, start: { x: 0, y: -1 }, end: { x: 0, y: 0.05 } },
  }), false)
})

test('an opted-in wall clips against its own roof even when it would otherwise be an abutment', () => {
  const selectedWall = { ...facade, height: 3.4, allowRoofClipHeight: true }
  const options = createWallRoofClipOptions({
    floorElevation: 0,
    floorId: 'floor',
    walls: [selectedWall],
    roofs: [{ floorId: 'floor', supportPolygon,
      undersideFaces: [[[0, 2.4, 0], [4, 2.4, 0], [4, 2.4, 6], [0, 2.4, 6]]],
    }],
  })
  assert.equal(options.volumes.length, 1)
  assert.equal(options.volumes[0].clipSides, false)
  assert.equal(options.volumes[0].clipHeightWallIds?.has(selectedWall.id), true)
  assert.equal(options.volumes[0].excludedWallIds.has(selectedWall.id), false)
  assert.equal(options.volumes[0].protectedFootprints.length, 0)
})

test('a lower-floor roof does not erase an opted-in upper wall', () => {
  const wall = { ...facade, height: 3.4, allowRoofClipHeight: true }
  const face = { ...boundaryFace(2, 3.4), wallId: wall.id }
  const options = createWallRoofClipOptions({
    floorElevation: 0, floorId: 'upper', walls: [wall],
    roofs: [{ floorId: 'lower', supportPolygon,
      undersideFaces: [[[0, 2.4, 0], [4, 2.4, 0], [4, 2.4, 6], [0, 2.4, 6]]],
    }],
  })
  assert.equal(options.volumes[0].skipWallIds?.has(wall.id), true)
  assert.deepEqual(clipWallFacesToRoofUndersides([face], options), [face])
  assert.deepEqual(runWallRoofClipJob(structuredClone(createWallRoofClipJob([face], options))), [face])
})

test('the raised Red House side wall is trimmed below the adjoining roofs when opted in', () => {
  const project = JSON.parse(readFileSync(new URL('../red_house_4.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const floor = project.floors[0]
  const wall = floor.walls.find(candidate => candidate.id.startsWith('93d7c2ba'))!
  wall.height = 3.4
  wall.allowRoofClipHeight = true
  const rooms = buildWallTopology(floor.walls).rooms
  const sourceFaces = buildFloorWallSurfaceFaces({
    renderedWalls: getRenderedWalls(floor.walls), rooms,
    useWallBodyPerimeterMesh: true, roomSurfaceRendererEnabled: true,
  })
  const roofs = resolveBuildingRoofs(project.floors).map(({ roof, resolved, floorId }) => {
    const bounds = getRoofSupportBoundsInRoofSpace(roof)
    return { floorId,
      supportPolygon: [
        { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
      ].map(point => getRoofWorldPointFromLocal(roof, point)),
      undersideFaces: getRoofCoverageUndersideFaces(resolved).map(face => face.map(
        ([x, y, z]): [number, number, number] => [x, y + 0.005, z])),
      heightClipUndersideFaces: getRoofRenderableOuterFaces(resolved).map(face => face.map(
        ([x, y, z]): [number, number, number] => [x, y - getRoofThickness(roof) + 0.005, z])),
    }
  })
  const options = createWallRoofClipOptions({
    floorElevation: floor.elevation, floorId: floor.id, walls: floor.walls,
    roofs, wallFaces: sourceFaces,
  })
  const clipped = clipWallFacesToRoofUndersides(sourceFaces, options)
  const sideTop = (faces: WallMeshFace[]) => Math.max(...faces
    .filter(face => face.wallId === wall.id && face.kind === 'side')
    .flatMap(face => face.vertices.map(vertex => vertex.position[1])))
  assert.equal(sideTop(sourceFaces), 3.4)
  assert.ok(sideTop(clipped) < 3.4 - 0.1, 'the side no longer protrudes to its uncut height')
  assert.ok(clipped.some(face => face.wallId === wall.id && face.faceId.includes(':roof-cap:')),
    'the roof cut closes the wall top')
})

test('the saved raised Red House upper wall stays below the roof after geometry serialization', () => {
  const project = JSON.parse(readFileSync(new URL('../red_house_4.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const raisedWall = project.floors[1].walls.find(candidate => candidate.id.startsWith('3e626ad4'))!
  raisedWall.height = 3.4
  raisedWall.allowRoofClipHeight = true
  const wallInput = JSON.parse(serializeWallGeometryInput(project.floors)) as FloorLevel[]
  const prepared = prepareRenderedFloorData({ ...wallInput[1], name: '', models: [], rooms: [] })
  const floor = prepared.floor
  const wall = floor.walls.find(candidate => candidate.id.startsWith('3e626ad4'))!
  assert.equal(prepared.renderedWalls.find(candidate => candidate.wall.id === wall.id)?.wall.allowRoofClipHeight, true)
  const roofInput = JSON.parse(serializeRoofGeometryInput(project.floors)) as FloorLevel[]
  assert.equal(roofInput[1].walls.find(candidate => candidate.id === wall.id)?.allowRoofClipHeight, true)
  const resolvedRoofs = resolveBuildingRoofs(roofInput)
  assert.ok(resolvedRoofs.every(roof => roof.abuttingWalls.every(candidate => candidate.wall.id !== wall.id)))
  const rooms = prepared.rooms
  const sourceFaces = buildFloorWallSurfaceFaces({
    renderedWalls: prepared.renderedWalls, rooms,
    useWallBodyPerimeterMesh: true, roomSurfaceRendererEnabled: true,
  })
  const roofs = resolvedRoofs.map(({ roof, resolved, floorId, abuttingWalls }) => {
    const bounds = getRoofSupportBoundsInRoofSpace(roof)
    return { floorId,
      abutmentPlanes: getRoofAbutmentPlanes(abuttingWalls, getRoofRenderPosition(roof)),
      supportPolygon: [
        { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
      ].map(point => getRoofWorldPointFromLocal(roof, point)),
      undersideFaces: getRoofCoverageUndersideFaces(resolved).map(face => face.map(
        ([x, y, z]): [number, number, number] => [x, y + 0.005, z])),
      heightClipUndersideFaces: getRoofRenderableOuterFaces(resolved).map(face => face.map(
        ([x, y, z]): [number, number, number] => [x, y - getRoofThickness(roof) + 0.005, z])),
    }
  })
  const options = createWallRoofClipOptions({ floorElevation: floor.elevation, floorId: floor.id,
    walls: prepared.geometryContextWalls, roofs, wallFaces: sourceFaces })
  const clipped = clipWallFacesToRoofUndersides(sourceFaces, options)
  const wallFaces = clipped.filter(face => face.wallId === wall.id)
  assert.ok(wallFaces.length > 0)
  assert.ok(wallFaces.every(face => face.vertices.every(vertex => vertex.position[1] < 2.7)))
  assert.ok(wallFaces.some(face => face.faceId.includes(':roof-cap:')))
  const withoutOwnRoof = createWallRoofClipOptions({ floorElevation: floor.elevation, floorId: floor.id,
    walls: prepared.geometryContextWalls, roofs: roofs.filter(candidate => candidate.floorId !== floor.id),
    wallFaces: sourceFaces })
  const exposedWall = clipWallFacesToRoofUndersides(sourceFaces, withoutOwnRoof)
  assert.ok(exposedWall.some(face => face.wallId === wall.id && face.kind === 'side' &&
    face.vertices.some(vertex => vertex.position[1] > 3.3 && vertex.position[2] > 2 && vertex.position[2] < 7)),
  'removing the wall’s own roof leaves the raised wall continuous above the lower roof')
})

test('red_house_3 clips its shared upper wall under the continuous lower roof', () => {
  const project = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/red_house_3.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const [ground, upper] = project.floors
  // Keep partition coverage even when the editable project has no partitions.
  upper.walls = [...upper.walls, {
    id: 'test-roof-partition', kind: 'internal', height: 2.4, thickness: 0.15,
    start: { x: 4.94, y: 2.5 }, end: { x: 4.94, y: 6.96 },
  }]
  const roof = ground.roofs![0]
  const bounds = { minX: -roof.supportWidth! / 2, maxX: roof.supportWidth! / 2, minY: -roof.supportDepth! / 2, maxY: roof.supportDepth! / 2 }
  const origin = roof.supportPosition!
  const cos = Math.cos(roof.rotation)
  const sin = Math.sin(roof.rotation)
  const toWorld = (point: Point) => ({ x: origin.x + point.x * cos + point.y * sin, y: origin.y - point.x * sin + point.y * cos })
  const rooms = buildWallTopology(upper.walls).rooms
  const isInsideRoom = (point: Point) => rooms.some(({ polygon }) => {
    let inside = false
    polygon.forEach((a, index) => {
      const b = polygon[(index + 1) % polygon.length]
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    })
    return inside
  })
  const options = createWallRoofClipOptions({
    floorElevation: upper.elevation, floorId: upper.id, walls: upper.walls, isInsideRoom,
    roofs: [{
      floorId: ground.id,
      supportPolygon: [
        { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
      ].map(toWorld),
      undersideFaces: buildRoofProfileFaces(roof, {
        minX: bounds.minX - roof.overhangSide!, maxX: bounds.maxX + roof.overhangSide!,
        minY: bounds.minY - roof.overhangEnd!, maxY: bounds.maxY + roof.overhangEnd!,
      }, bounds).map((face) => face.map(([x, y, z]) => {
        const world = toWorld({ x, y: z })
        return [world.x, ground.elevation + ground.roomHeight + y - 0.04 + 0.005, world.y] as [number, number, number]
      })),
    }],
  })
  const uncut = buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls(upper.walls), rooms, useWallBodyPerimeterMesh: true, roomSurfaceRendererEnabled: true })
  const clipped = clipWallFacesToRoofUndersides(uncut, options)
  const roofEmbeddedWalls = upper.walls.filter((wall) => wall.kind === 'external' &&
    Math.abs(wall.start.x - 1.2) < 1e-6 && Math.abs(wall.end.x - 1.2) < 1e-6)
  assert.ok(roofEmbeddedWalls.length > 0)
  for (const { id: wallId } of roofEmbeddedWalls) {
    const before = uncut.filter((face) => face.wallId === wallId)
    assert.ok(before.length > 0)
    assert.notDeepEqual(clipped.filter((face) => face.wallId === wallId), before, `roof-embedded wall ${wallId}`)
  }
  const topContains = (point: Point, faces: typeof clipped) => faces.some((face) => {
    if (face.kind !== 'top') return false
    return [[0, 1, 2], [0, 2, 3]].some((indices) => {
      const [a, b, c] = indices.map((index) => face.vertices[index].position)
      const cross = (u: number[], v: number[], x: number, y: number) => (v[0] - u[0]) * (y - u[2]) - (v[2] - u[2]) * (x - u[0])
      if (Math.abs(cross(a, b, c[0], c[2])) < 1e-10) return false
      const signs = [cross(a, b, point.x, point.y), cross(b, c, point.x, point.y), cross(c, a, point.x, point.y)]
      return signs.every((v) => v >= -1e-8) || signs.every((v) => v <= 1e-8)
    })
  })
  for (const point of roofEmbeddedWalls.flatMap((wall) => [0.2, 0.8].map((t) => ({ x: wall.start.x + (wall.end.x - wall.start.x) * t, y: wall.start.y + (wall.end.y - wall.start.y) * t })))) {
    assert.ok(topContains(point, uncut))
    assert.ok(topContains(point, clipped), `missing facade cap at ${JSON.stringify(point)}`)
  }
  for (const wallId of ['c4bee8af-9828-49f7-a56a-b3473bd314e8', '2ff7776a-a60a-4be8-bd41-0027092397d2', 'test-roof-partition']) {
    const before = uncut.filter((face) => face.wallId === wallId)
    const after = clipped.filter((face) => face.wallId === wallId)
    assert.ok(before.length > 0 && after.length > 0)
    assert.notDeepEqual(after, before, `roof-covered wall ${wallId}`)
  }
})
