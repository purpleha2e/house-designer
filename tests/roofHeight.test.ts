import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Raycaster, Vector3, DoubleSide } from 'three'
import { normalizeFloor } from '../src/modelPlacement.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { getRoofRenderableOuterFaces, roofBoundsPolygon, roofSurfaceHeights } from '../src/roofJunctions.ts'
import { buildBuildingRoofGables } from '../src/roofGableGeometry.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { createWallRoofClipOptions } from '../src/roofWallClipping.ts'
import { createWallRoofClipJob, runWallRoofClipJob } from '../src/wallEngine/wallRoofClipJob.ts'
import { buildFloorWallSurfaceFaces } from '../src/wallEngine/floorWallSurfaceMesh.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import { getRoofCeilingCutouts } from '../src/roofCeilingClipping.ts'
import type { FloorLevel, RoofStructure } from '../src/types.ts'

function floor(): FloorLevel {
  const points = [{ x: -2, y: -3 }, { x: 2, y: -3 }, { x: 2, y: 3 }, { x: -2, y: 3 }]
  return { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: 0.3,
    models: [], rooms: [], roofs: [{ id: 'roof', type: 'up-and-over', rotation: 0,
      position: { x: 0, y: 0 }, supportPosition: { x: 0, y: 0 }, supportWidth: 4, supportDepth: 6,
      width: 4.4, depth: 6.4, overhangSide: 0.2, overhangEnd: 0.2, thickness: 0.04,
      pitchDegrees: 35, clipsGeometry: false, heightOffset: -0.3 }],
    walls: points.map((start, i) => ({ id: `wall-${i}`, kind: 'external', start,
      end: points[(i + 1) % points.length], height: 2.4, thickness: 0.3, openings: [] })),
  }
}

test('signed roof offsets and the separate fitting setting survive saving and loading', () => {
  for (const heightOffset of [-0.3, 0, 0.45]) {
    const f = floor()
    Object.assign(f.roofs![0], { heightOffset, fitSupportingWalls: true })
    const restored = normalizeFloor(JSON.parse(JSON.stringify(f)), new Map())
    assert.equal(restored.roofs![0].heightOffset, heightOffset)
    assert.equal(restored.roofs![0].fitSupportingWalls, true)
    assert.equal(restored.roofs![0].clipsGeometry, false)
  }
  assert.equal(normalizeFloor(floor(), new Map()).roofs![0].fitSupportingWalls, false)
  const invalid = floor()
  invalid.roofs![0].heightOffset = NaN
  assert.equal(normalizeFloor(invalid, new Map()).roofs![0].heightOffset, 0)
})

test('lowering translates roof panels and gable peaks without changing pitch or plan geometry', () => {
  const f = floor()
  const original = structuredClone(f)
  original.roofs![0].heightOffset = 0
  const [before] = resolveBuildingRoofs([original]), [after] = resolveBuildingRoofs([f])
  after.resolved.faces.forEach((face, i) => face.forEach(([x, y, z], j) => {
    const previous = before.resolved.faces[i][j]
    assert.equal(x, previous[0]); assert.equal(z, previous[2])
    assert.ok(Math.abs(y - previous[1] + 0.3) < 1e-8)
  }))
  assert.deepEqual(after.resolved.support, before.resolved.support)
  const peak = (level: FloorLevel) => {
    const roofs = resolveBuildingRoofs([level])
    const gables = buildBuildingRoofGables([level], roofs, buildBuildingRoomVolumes([level], roofs))
    return Math.max(...gables.flatMap(g => g.faces.flatMap(face => face.points.map(p => p[1]))))
  }
  assert.ok(Math.abs(peak(original) - peak(f) - 0.3) < 1e-8)
})

function clipped(floors: FloorLevel[], floorIndex = 0) {
  const f = floors[floorIndex], roofs = resolveBuildingRoofs(floors)
  const faces = buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls(f.walls), rooms: [], useWallBodyPerimeterMesh: true })
  const options = createWallRoofClipOptions({ floorId: f.id, floorElevation: f.elevation, walls: f.walls,
    roofs: roofs.map(candidate => ({ floorId: candidate.floorId, clipsGeometry: candidate.roof.clipsGeometry,
      fitSupportingWallIds: candidate.roof.fitSupportingWalls ? candidate.supportingWallIds : [],
      supportPolygon: roofBoundsPolygon(candidate.resolved, candidate.resolved.support),
      undersideFaces: candidate.resolved.coverageFaces,
      heightClipUndersideFaces: getRoofRenderableOuterFaces(candidate.resolved).map(face =>
        face.map(([x, y, z]): [number, number, number] => [x, y - 0.035, z])),
    })) })
  return runWallRoofClipJob(createWallRoofClipJob(faces, options))
}

test('fitting trims both skins and closes supporting wall tops even when general clipping is off', () => {
  for (const fitSupportingWalls of [false, true]) {
    const f = floor(), before = structuredClone(f)
    f.roofs![0].fitSupportingWalls = fitSupportingWalls
    const faces = clipped([f])
    for (const wallId of ['wall-1', 'wall-3']) {
      const sideFaces = faces.filter(face => face.wallId === wallId && face.kind === 'side')
      const top = Math.max(...sideFaces.flatMap(face => face.vertices.map(v => v.position[1])))
      const expected = fitSupportingWalls ? 2.1 + 0.3 * Math.tan(35 * Math.PI / 180) - 0.035 : 2.4
      assert.ok(Math.abs(top - expected) < 1e-6, `${wallId}: ${top}`)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(faces.flatMap(face =>
      face.vertices.slice(1, -1).flatMap((v, i) => [face.vertices[0].position, v.position, face.vertices[i + 2].position].flat())), 3))
    const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material)
    for (const x of [-2, 2]) {
      const hit = new Raycaster(new Vector3(x, 4, 0), new Vector3(0, -1, 0)).intersectObject(mesh)[0]
      const expected = fitSupportingWalls ? 2.1 + 0.15 * Math.tan(35 * Math.PI / 180) - 0.035 : 2.4
      assert.ok(hit && Math.abs(hit.point.y - expected) < 1e-5,
        `the cut closes the wall thickness at x=${x}: ${hit?.point.y}`)
    }
    geometry.dispose(); material.dispose()
    assert.deepEqual(f.walls, before.walls, 'fitting never rewrites wall heights or endpoints')
  }
})

test('fitting preserves taller facades, continuing facades, partitions and other floors', () => {
  const f = floor()
  f.roofs![0].fitSupportingWalls = true
  f.walls.push(
    { id: 'taller', kind: 'external', start: { x: -2, y: -3 }, end: { x: -2, y: 3 }, thickness: 0.3, height: 3.4 },
    { id: 'continuing', kind: 'external', start: { x: 2, y: -5 }, end: { x: 2, y: 5 }, thickness: 0.3, height: 2.4 },
    { id: 'partition', kind: 'internal', start: { x: -1, y: 0 }, end: { x: 1, y: 0 }, thickness: 0.1, height: 2.4 },
  )
  const other = { ...structuredClone(f), id: 'other-floor', roofs: [] as RoofStructure[] }
  const [resolved] = resolveBuildingRoofs([f, other])
  assert.deepEqual(new Set(resolved.supportingWallIds), new Set(['wall-0', 'wall-1', 'wall-2', 'wall-3']))
  for (const [id, height] of [['taller', 3.4], ['continuing', 2.4], ['partition', 2.4]] as const) {
    const top = Math.max(...clipped([f, other]).filter(face => face.wallId === id).flatMap(face => face.vertices.map(v => v.position[1])))
    assert.equal(top, height)
  }
  assert.equal(Math.max(...clipped([f, other], 1).flatMap(face => face.vertices.map(v => v.position[1]))), 3.4)
})

test('a passive fitted roof can use resolved underside coverage without an original profile', () => {
  const f = floor(), wall = f.walls[1]
  const faces = buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls([wall]), rooms: [], useWallBodyPerimeterMesh: true })
  const options = createWallRoofClipOptions({ floorId: f.id, floorElevation: 0, walls: [wall], roofs: [{
    floorId: f.id, clipsGeometry: false, fitSupportingWallIds: [wall.id], supportPolygon: [],
    undersideFaces: [[[-3, 2.1, -4], [3, 2.1, -4], [3, 2.1, 4], [-3, 2.1, 4]]],
  }] })
  const result = runWallRoofClipJob(createWallRoofClipJob(faces, options))
  assert.ok(Math.abs(Math.max(...result.flatMap(face => face.vertices.map(v => v.position[1]))) - 2.1) < 1e-8)
})

test('a lowered fitted roof trims its own horizontal ceiling without gaining authority over other floors', () => {
  const f = floor()
  f.roofs![0].fitSupportingWalls = true
  const roofs = resolveBuildingRoofs([f]).map(candidate => candidate.resolved)
  assert.ok(getRoofCeilingCutouts(roofs, 2.38, f.id).length)
  assert.deepEqual(getRoofCeilingCutouts(roofs, 2.38, 'other-floor'), [])
  assert.deepEqual(getRoofCeilingCutouts(roofs, 2.38), [], 'floor slabs retain their separate clipping policy')
  f.roofs![0].fitSupportingWalls = false
  assert.deepEqual(getRoofCeilingCutouts(resolveBuildingRoofs([f]).map(candidate => candidate.resolved), 2.38, f.id), [])
})

test('fitting a stepped perimeter removes a shared cap even when an unfitted wall owns its triangles', () => {
  const floors: FloorLevel[] = JSON.parse(readFileSync(new URL('./fixtures/roofFinishingRegression.json', import.meta.url), 'utf8')).floors
  const before = JSON.stringify(floors)
  const faces = clipped(floors, 1)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(faces.flatMap(face => face.vertices.slice(1, -1)
    .flatMap((v, i) => [face.vertices[0].position, v.position, face.vertices[i + 2].position].flat())), 3))
  const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material)
  mesh.position.y = floors[1].elevation; mesh.updateMatrixWorld()
  const roof = resolveBuildingRoofs(floors).find(candidate => candidate.roof.asymmetricSides)!
  for (const [x, z] of [[4, 16.35], [6.35, 16], [6.35, 16.35]]) {
    const hit = new Raycaster(new Vector3(x, 10, z), new Vector3(0, -1, 0)).intersectObject(mesh)[0]
    const top = Math.max(...roofSurfaceHeights(roof.resolved.exteriorFaces, { x, y: z }))
    assert.ok(hit && Math.abs(hit.point.y - top + 0.035) < 1e-5, `shared cap closes at the roof underside at ${x},${z}: ${hit?.point.y}`)
  }
  const untouched = new Raycaster(new Vector3(2.8, 10, 17.74), new Vector3(0, -1, 0)).intersectObject(mesh)[0]
  assert.ok(untouched && Math.abs(untouched.point.y - 5.1) < 1e-5, 'the adjoining unfitted perimeter keeps its cap')
  geometry.dispose(); material.dispose()
  assert.equal(JSON.stringify(floors), before)
})

test('an asymmetric gable and fitted walls close continuously across the lower eave and offset peak', () => {
  const f = floor()
  Object.assign(f.roofs![0], { heightOffset: 0, pitchDegrees: 45, asymmetricSides: true,
    ridgeOffset: 0.5, ridgeHeight: 1.5, fitSupportingWalls: true })
  const roofs = resolveBuildingRoofs([f])
  const gables = buildBuildingRoofGables([f], roofs, buildBuildingRoomVolumes([f], roofs))
  const faces = [...clipped([f]).map(face => face.vertices.map(v => v.position)),
    ...gables.flatMap(gable => gable.faces.map(face => face.points))]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(faces.flatMap(face =>
    face.slice(1, -1).flatMap((v, i) => [face[0], v, face[i + 2]].flat())), 3))
  const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material)
  for (const [x, z] of [[-2, 0], [2, 0], [-1.9, -3], [-1, -3], [0.5, -3], [1.9, -3]]) {
    const hit = new Raycaster(new Vector3(x, 5, z), new Vector3(0, -1, 0)).intersectObject(mesh)[0]
    const roofTop = Math.max(...roofSurfaceHeights(roofs[0].resolved.exteriorFaces, { x, y: z }))
    assert.ok(hit && Math.abs(hit.point.y - (roofTop - 0.035)) < 0.006,
      `closed wall/gable at ${x},${z}: ${hit?.point.y}, roof ${roofTop}`)
  }
  assert.ok(Math.max(...roofSurfaceHeights(roofs[0].resolved.exteriorFaces, { x: -2, y: 0 })) < 2.4)
  geometry.dispose(); material.dispose()
})
