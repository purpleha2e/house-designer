import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3 } from 'three'
import { buildBuildingRoofGables, getGableWallClipData } from '../src/roofGableGeometry.ts'
import { createWallRoofClipOptions } from '../src/roofWallClipping.ts'
import { createWallRoofClipJob, runWallRoofClipJob } from '../src/wallEngine/wallRoofClipJob.ts'
import { buildFloorWallSurfaceFaces } from '../src/wallEngine/floorWallSurfaceMesh.ts'
import { getRenderedWalls } from '../src/wallGeometry.ts'
import { buildWallTopology } from '../src/wallTopology.ts'
import { getRoofCoverageUndersideFaces, getRoofRenderableOuterFaces, roofBoundsPolygon, roofSurfaceHeights } from '../src/roofJunctions.ts'
import { getRoofAbutmentPlanes } from '../src/roofAbutmentGeometry.ts'
import { getRoofThickness } from '../src/roofThickness.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { getRoofRenderPosition, resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { buildCeilingSlabFootprints } from '../src/ceilingSlabFootprint.ts'
import { buildStoreyGeometry } from '../src/storeyGeometry.ts'
import { intersectSolid, prismSolid, solidBoundaryFaces, subtractSolid, solidPolygonArea } from '../src/convexSolid.ts'
import type { FloorLevel, RoofStructure, Wall } from '../src/types.ts'
import { createCeilingLoftFloor } from '../src/loftFloor.ts'
import { getGableSurface } from '../src/gableSurfaces.ts'
import { getSurfaceSelectionFloorId } from '../src/surfaceSelection.ts'
import { replaceRoofMaterialAssignment, roofSurfaceTargetsMatch } from '../src/roofMaterialAssignments.ts'

function hitGables(gables: ReturnType<typeof buildBuildingRoofGables>, origin: number[], direction: number[]) {
  const meshes = gables.map(gable => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(gable.faces.flatMap(face =>
      face.points.slice(1, -1).flatMap((point, i) => [face.points[0], point, face.points[i + 2]].flat())), 3))
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
    mesh.userData.gableFaces = gable.faces.flatMap(face => face.points.slice(1, -1).map(() => face))
    return mesh
  })
  const hits = new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObjects(meshes)
  meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose() })
  return hits
}

function joinedFloor(partition: boolean): FloorLevel {
  const points = [{ x: -2, y: -4 }, { x: 2, y: -4 }, { x: 2, y: 4 }, { x: -2, y: 4 }]
  const walls: Wall[] = points.map((start, index) => ({ id: `wall-${index}`, kind: 'external',
    start, end: points[(index + 1) % points.length], thickness: 0.3, height: 2.4 }))
  if (partition) walls.push({ id: 'intentional-partition', kind: 'external', start: { x: -2, y: 0 },
    end: { x: 2, y: 0 }, thickness: 0.3, height: 2.4 })
  const roofs: RoofStructure[] = [-2, 2].map((y, i) => ({ id: `roof-${i}`, type: 'up-and-over',
    position: { x: 0, y }, supportPosition: { x: 0, y }, supportWidth: 4, supportDepth: 4,
    width: 4.3, depth: 4.3, overhangSide: 0.15, overhangEnd: 0.15, pitchDegrees: 45, rotation: 0 }))
  return { id: 'ground', name: 'Ground', elevation: 0, roomHeight: 2.4, slabThickness: 0.3, walls, roofs, models: [], rooms: [] }
}

test('flush joined roofs have an open attic; an explicit external partition still reaches the roof', () => {
  for (const partition of [false, true]) {
    const floor = joinedFloor(partition)
    const roofs = resolveBuildingRoofs([floor])
    const gables = buildBuildingRoofGables([floor], roofs, buildBuildingRoomVolumes([floor], roofs))
    const hits = hitGables(gables, [0, 3.3, -1], [0, 0, 1])
    assert.ok(hits.length > 0, 'the far exterior gable still closes the roof')
    if (partition) assert.ok(hits[0].point.z < 0.2, 'the drawn partition continues above its 2.4m height')
    else assert.ok(hits[0].point.z > 3.5, 'no automatic gable may block the joined attic')
  }
})

test('partial joins leave only the exposed gable and are independent of roof order', () => {
  const floor = joinedFloor(false)
  Object.assign(floor.roofs![1], { position: { x: 0.7, y: 2 }, supportPosition: { x: 0.7, y: 2 },
    supportWidth: 2, width: 2.3, pitchDegrees: 40 })
  const areas: number[] = []
  for (const reversed of [false, true]) {
    if (reversed) floor.roofs!.reverse()
    const roofs = resolveBuildingRoofs([floor])
    const gables = buildBuildingRoofGables([floor], roofs, buildBuildingRoomVolumes([floor], roofs))
    assert.ok(hitGables(gables, [0.7, 2.9, -1], [0, 0, 1])[0].point.z > 3.5, 'opening into the narrower adjoining roof')
    assert.ok(hitGables(gables, [-1.3, 2.9, -1], [0, 0, 1])[0].point.z < 0.2, 'exposed side of the wider gable')
    assert.ok(hitGables(gables, [0, 4.1, -1], [0, 0, 1])[0].point.z < 0.2, 'gable above the lower adjoining roof')
    areas.push(gables.flatMap(gable => gable.faces).reduce((sum, face) => sum + solidPolygonArea(face.points), 0))
  }
  assert.ok(Math.abs(areas[0] - areas[1]) < 1e-6)
})

test('adding a wall-less loft preserves exterior gables and keeps joined attic openings', () => {
  for (const partialJoin of [false, true]) {
    const floor = joinedFloor(false)
    if (partialJoin) Object.assign(floor.roofs![1], {
      position: { x: 0.7, y: 2 }, supportPosition: { x: 0.7, y: 2 },
      supportWidth: 2, width: 2.3, pitchDegrees: 40,
    })
    const loft = createCeilingLoftFloor([floor], floor.id, 'loft')!
    const floors = [floor, loft]
    const roofs = resolveBuildingRoofs(floors)
    const gables = buildBuildingRoofGables(floors, roofs, buildBuildingRoomVolumes(floors, roofs))
    const front = hitGables(gables, [0, 3.3, -5], [0, 0, 1])[0]
    assert.ok(front && Math.abs(front.point.z + 4.15) < 1e-5, 'front exterior gable stays closed above the loft')
    assert.equal(front.object.userData.gableFaces[front.faceIndex!].interior, false)
    const inside = hitGables(gables, [0, 3.3, -3], [0, 0, -1])[0]
    assert.ok(inside)
    assert.equal(inside.object.userData.gableFaces[inside.faceIndex!].interior, true,
      'the room-facing gable retains its interior finish')
    const rear = hitGables(gables, [0.7, 3.1, 5], [0, 0, -1])[0]
    assert.ok(rear && rear.point.z > 3.5, 'rear exterior gable stays closed above the loft')
    const join = hitGables(gables, [0.7, 2.9, -1], [0, 0, 1])[0]
    assert.ok(join && join.point.z > 3.5, 'the opening between joined roofs remains open')
    if (partialJoin) {
      const exposed = hitGables(gables, [-1.3, 2.9, -1], [0, 0, 1])[0]
      assert.ok(exposed && exposed.point.z < 0.2, 'gable beside the narrower roof stays closed')
      const above = hitGables(gables, [0, 4.1, -1], [0, 0, 1])[0]
      assert.ok(above && above.point.z < 0.2, 'gable above the lower adjoining roof stays closed')
      const outside = hitGables(gables, [0, 4.1, 1], [0, 0, -1])[0]
      assert.ok(outside)
      assert.equal(outside.object.userData.gableFaces[outside.faceIndex!].interior, false,
        'exposed gable above the lower roof retains its exterior finish')
    }
  }
})

test('loft partitions meet the gable interior without replacing its exterior brick face', () => {
  for (const reversed of [false, true]) {
    const ground = joinedFloor(false)
    const loft = createCeilingLoftFloor([ground], ground.id, 'loft')!
    const wall: Wall = { id: 'knee', kind: 'internal', thickness: 0.15, height: 2.4, allowRoofClipHeight: true,
      start: { x: -0.8, y: -4.15 }, end: { x: -0.8, y: 4.15 } }
    if (reversed) [wall.start, wall.end] = [wall.end, wall.start]
    loft.walls = [wall]
    const floors = [ground, loft], original = structuredClone(floors)
    const roofs = resolveBuildingRoofs(floors)
    const gables = buildBuildingRoofGables(floors, roofs, buildBuildingRoomVolumes(floors, roofs))
    for (const sign of [-1, 1]) {
      const exterior = hitGables(gables, [-0.8, 3.1, sign * 5], [0, 0, -sign])[0]
      assert.ok(exterior && Math.abs(exterior.point.z - sign * 4.15) < 1e-5, 'brick skin spans the partition end')
      assert.equal(exterior.object.userData.gableFaces[exterior.faceIndex!].interior, false)
    }
    const faces = buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls(loft.walls), rooms: [], useWallBodyPerimeterMesh: true })
    const options = createWallRoofClipOptions({ floorId: loft.id, floorElevation: loft.elevation,
      walls: loft.walls, clipToInheritedRoofs: true,
      gableWallVolumes: gables.flatMap(gable => gable.solids.map(solid => solid.planes)),
      roofs: roofs.map(({ floorId, roof, resolved }) => ({ floorId,
        supportPolygon: roofBoundsPolygon(resolved, resolved.support),
        undersideFaces: getRoofCoverageUndersideFaces(resolved),
      })),
    })
    const clipped = runWallRoofClipJob(structuredClone(createWallRoofClipJob(faces, options)))
    const sides = clipped.filter(face => face.kind === 'side')
    assert.ok(sides.length)
    assert.ok(sides.every(face => face.vertices.every(vertex => Math.abs(vertex.position[2]) <= 3.85 + 1e-6)),
      'partition faces end at the inside of both gables')
    assert.ok(sides.some(face => face.vertices.some(vertex => Math.abs(Math.abs(vertex.position[2]) - 3.85) < 1e-6)),
      'the partition reaches the gable without a gap')
    assert.ok(clipped.every(face => face.vertices.every(vertex => vertex.uv.every(Number.isFinite))))
    assert.deepEqual(floors, original, 'saved wall endpoints remain snapped to the boundary')
  }
})

test('inside gable selection and paint belong to the loft end, independently of its supporting wall', () => {
  const floor = joinedFloor(false)
  floor.roofs = [{ ...floor.roofs![0], position: { x: 0, y: 0 }, supportPosition: { x: 0, y: 0 },
    depth: 8.3, supportDepth: 8 }]
  const loft = createCeilingLoftFloor([floor], floor.id, 'loft')!
  const floors = [floor, loft]
  const roofs = resolveBuildingRoofs(floors)
  const gables = buildBuildingRoofGables(floors, roofs, buildBuildingRoomVolumes(floors, roofs))
  const front = gables.find(gable => gable.end === 'minY')!
  const rear = gables.find(gable => gable.end === 'maxY')!
  const interior = front.faces.find(face => face.interior && face.spaceFloorId === loft.id)!
  assert.ok(interior.wall, 'regression fixture inherits a supporting wall below the loft')
  assert.equal(interior.wallFloorId, floor.id)
  const surface = getGableSurface(front, interior)
  assert.equal(surface.part, 'gable-interior')
  assert.equal(surface.spaceFloorId, loft.id)
  assert.equal('wallId' in surface, false, 'picking cannot select the downstairs wall')
  assert.equal(getSurfaceSelectionFloorId(surface, floor.id, floors), loft.id)
  assert.equal(getSurfaceSelectionFloorId(surface, loft.id, floors), loft.id)
  const exterior = getGableSurface(front, front.faces.find(face => !face.interior)!)
  const otherEnd = getGableSurface(rear, rear.faces.find(face => face.interior && face.spaceFloorId === loft.id)!)
  const downstairs = getGableSurface(front, { ...interior, spaceFloorId: floor.id })
  assert.equal(roofSurfaceTargetsMatch(surface, exterior), false)
  assert.equal(roofSurfaceTargetsMatch(surface, otherEnd), false)
  assert.equal(roofSurfaceTargetsMatch(surface, downstairs), false)
  const original = [{ id: 'wall-finish', materialId: 'brick',
    target: { type: 'wall-face' as const, wallId: interior.wall!.id, side: 'both' as const } }]
  const painted = replaceRoofMaterialAssignment(original, surface, { id: 'loft-paint', materialId: 'paint' })
  const bothEnds = replaceRoofMaterialAssignment(painted, otherEnd, { id: 'rear-paint', materialId: 'wallpaper' })
  const saved = JSON.parse(JSON.stringify(bothEnds))
  assert.equal(saved.length, 3)
  assert.ok(roofSurfaceTargetsMatch(saved[1].target, surface), 'saved target still matches the highlighted mesh')
  const changed = replaceRoofMaterialAssignment(saved, surface, { id: 'new-paint', materialId: 'plaster' })
  assert.deepEqual(changed[0], original[0], 'painting the loft preserves the wall below')
  assert.equal(changed[1].materialId, 'wallpaper', 'painting one end preserves the other end')
  assert.deepEqual(replaceRoofMaterialAssignment(changed, surface, null), [saved[0], saved[2]])
})

test('wall worker trims manually raised walls to the combined roof', () => {
  const { floors } = JSON.parse(readFileSync(new URL('../red_house_3.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const floor = floors[1]
  const ids = ['3e626ad4-bf30-4d1a-b6cc-15fc6a33da0e', '2ff7776a-a60a-4be8-bd41-0027092397d2']
  floor.walls = floor.walls.map(wall => ids.includes(wall.id) ? { ...wall, height: 3.4 } : wall)
  const roofs = resolveBuildingRoofs(floors)
  const gables = buildBuildingRoofGables(floors, roofs, buildBuildingRoomVolumes(floors, roofs))
  const faces = buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls(floor.walls),
    rooms: buildWallTopology(floor.walls).rooms, useWallBodyPerimeterMesh: true })
  const data = getGableWallClipData(gables, roofs, floor.id, floor.elevation)
  const options = createWallRoofClipOptions({ floorId: floor.id, floorElevation: floor.elevation, walls: floor.walls, roofs: [], ...data })
  const clipped = runWallRoofClipJob(structuredClone(createWallRoofClipJob(faces, options)))
  let checked = 0
  for (const face of clipped.filter(face => ids.includes(face.wallId))) for (const vertex of face.vertices) {
    const [x, y, z] = vertex.position
    const heights = roofs.flatMap(candidate => roofSurfaceHeights(getRoofRenderableOuterFaces(candidate.resolved), { x, y: z })
      .map(height => height - getRoofThickness(candidate.roof)))
    if (heights.length) {
      assert.ok(y + floor.elevation <= Math.max(...heights) + 0.006, 'raised wall stays below the roof skin')
      checked++
    }
  }
  assert.ok(checked > 10)
  assert.ok(clipped.length < faces.length * 15, 'clipping remains bounded')
})

test('a lower stepped roof does not erase the next storey facade band', () => {
  const project = JSON.parse(readFileSync(new URL('../roof_tests_3.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(project.floors)
  const gables = buildBuildingRoofGables(project.floors, roofs,
    buildBuildingRoomVolumes(project.floors, roofs))
  const storeys = buildStoreyGeometry(project.floors.map(floor => ({ floor,
    footprints: buildCeilingSlabFootprints(floor.walls),
    faces: buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls(floor.walls),
      rooms: buildWallTopology(floor.walls).rooms, useWallBodyPerimeterMesh: true }),
  })))
  const floor = project.floors[2]
  const faces = storeys.get(floor.id)!.wallFaces
  const options = createWallRoofClipOptions({ floorId: floor.id, floorElevation: floor.elevation,
    walls: floor.walls, wallFaces: faces, roofs: [],
    ...getGableWallClipData(gables, roofs, floor.id, floor.elevation),
  })
  const clipped = runWallRoofClipJob(structuredClone(createWallRoofClipJob(faces, options)))
  const wallId = '9ea0410e-c314-4846-98d0-217e6a1cb348'
  assert.ok(clipped.some(face => face.storeyBoundary && face.wallId === wallId &&
    Math.min(...face.vertices.map(vertex => vertex.position[0])) <= 3 &&
    Math.max(...face.vertices.map(vertex => vertex.position[0])) >= 3 &&
    Math.min(...face.vertices.map(vertex => vertex.position[1])) <= 2.55 &&
    Math.max(...face.vertices.map(vertex => vertex.position[1])) >= 2.55),
  'the standard-height upper wall continues across the floor assembly')

  const lowerFloor = project.floors[1]
  const lowerFaces = storeys.get(lowerFloor.id)!.wallFaces
  const lowerRooms = buildWallTopology(lowerFloor.walls).rooms
  const lowerOptions = createWallRoofClipOptions({
    floorId: lowerFloor.id,
    floorElevation: lowerFloor.elevation,
    walls: lowerFloor.walls,
    wallFaces: lowerFaces,
    ...getGableWallClipData(gables, roofs, lowerFloor.id, lowerFloor.elevation),
    isInsideRoom: point => lowerRooms.some(({ polygon }) => {
      let inside = false
      polygon.forEach((a, index) => {
        const b = polygon[(index + 1) % polygon.length]
        if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
      })
      return inside
    }),
    roofs: roofs.map(({ roof, resolved, floorId, abuttingWalls }) => ({
      floorId,
      supportPolygon: roofBoundsPolygon(resolved, resolved.support),
      abutmentPlanes: getRoofAbutmentPlanes(abuttingWalls, getRoofRenderPosition(roof)),
      undersideFaces: getRoofCoverageUndersideFaces(resolved).map(face => face.map(
        ([x, y, z]): [number, number, number] => [x, y + 0.005, z])),
    })),
  })
  const lowerClipped = runWallRoofClipJob(structuredClone(createWallRoofClipJob(lowerFaces, lowerOptions)))
  assert.ok(lowerClipped.some(face => face.kind === 'side' && face.normal[2] > 0.99 &&
    face.vertices.every(vertex => Math.abs(vertex.position[2] - 5.561111111) < 1e-5) &&
    Math.min(...face.vertices.map(vertex => vertex.position[0])) <= 3 &&
    Math.max(...face.vertices.map(vertex => vertex.position[0])) >= 3 &&
    Math.min(...face.vertices.map(vertex => vertex.position[1])) <= 2 &&
    Math.max(...face.vertices.map(vertex => vertex.position[1])) >= 2),
  'the first-storey facade owns the visible face beside the ground roof')

  const steppedRoof = roofs.find(candidate => candidate.roof.id === '8d8264dd-442f-4b50-9c52-ce770459687c')!
  assert.ok(Math.max(...steppedRoof.resolved.faces.flat().map(point => point[0])) < 8.88,
    'the visible roof stops just inside the facade')
  assert.ok(Math.max(...getRoofCoverageUndersideFaces(steppedRoof.resolved).flat().map(point => point[0])) > 9.16,
    'the wall clipping envelope continues through the facade thickness')
})

test('convex gable solids retain closed cuts and remove internal cell boundaries', () => {
  const box = prismSolid([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }], 0, 3, 'gable')
  const sloping = intersectSolid(box, [-1, -1, 0, 3], 'roof')!
  const split = [intersectSolid(sloping, [1, 0, 0, -1], 'split')!, intersectSolid(sloping, [-1, 0, 0, 1], 'split')!]
  assert.ok(solidBoundaryFaces(split).every(face => face.tag !== 'split'))
  const area = (faces: typeof sloping.faces) => faces.reduce((sum, face) => sum + solidPolygonArea(face.points), 0)
  assert.ok(Math.abs(area(solidBoundaryFaces(split)) - area(sloping.faces)) < 1e-8)
  const opening = prismSolid([{ x: 0.5, y: -1 }, { x: 1.5, y: -1 }, { x: 1.5, y: 2 }, { x: 0.5, y: 2 }], 0, 1.5, 'door')
  const cut = solidBoundaryFaces(subtractSolid(sloping, opening.planes, 'door'))
  assert.ok(cut.some(face => face.tag === 'door'), 'new opening reveals close the solid')
  assert.ok(cut.every(face => solidPolygonArea(face.points) > 1e-10))
})

test('Red House gables leave the facade and both perpendicular wall junctions owned by the wall', () => {
  const { floors } = JSON.parse(readFileSync(new URL('../red_house_4.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors)
  const roomVolumes = buildBuildingRoomVolumes(floors, roofs)
  const gables = buildBuildingRoofGables(floors, roofs, roomVolumes)
  const storeys = buildStoreyGeometry(floors.map(floor => ({ floor,
    footprints: buildCeilingSlabFootprints(floor.walls),
    faces: buildFloorWallSurfaceFaces({ renderedWalls: getRenderedWalls(floor.walls),
      rooms: buildWallTopology(floor.walls).rooms, useWallBodyPerimeterMesh: true }),
  })))
  const meshes = floors.flatMap(floor => {
    const rooms = buildWallTopology(floor.walls).rooms
    const faces = storeys.get(floor.id)!.wallFaces
    const options = createWallRoofClipOptions({ floorId: floor.id, floorElevation: floor.elevation,
      walls: floor.walls, wallFaces: faces, ...getGableWallClipData(gables, roofs, floor.id, floor.elevation),
      isInsideRoom: point => rooms.some(({ polygon }) => {
        let inside = false
        polygon.forEach((a, index) => {
          const b = polygon[(index + 1) % polygon.length]
          if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside = !inside
        })
        return inside
      }),
      roofs: roofs.map(({ roof, resolved, floorId, abuttingWalls }) => ({ floorId,
        supportPolygon: roofBoundsPolygon(resolved, resolved.support),
        abutmentPlanes: getRoofAbutmentPlanes(abuttingWalls, getRoofRenderPosition(roof)),
        undersideFaces: getRoofCoverageUndersideFaces(resolved).map(face => face.map(([x,y,z]): [number,number,number] => [x,y+0.005,z])),
      })),
    })
    const clipped = runWallRoofClipJob(structuredClone(createWallRoofClipJob(faces, options)))
    return clipped.map(face => {
      const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(
        [0,1,2,0,2,3].flatMap(index => {
          const [x,y,z] = face.vertices[index].position
          return [x,y+floor.elevation,z]
        }), 3))
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
      mesh.userData.face = face
      return mesh
    })
  })
  const ray = (origin: number[], direction: number[]) => new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObjects(meshes)[0]
  for (const z of [2.5, 6.4, 6.7658, 7.5]) {
    const hit = ray([2,4.5,z],[-1,0,0])
    assert.ok(hit && Math.abs(hit.point.x - 1.35) < 1e-5, `facade at z=${z}`)
    assert.equal(hit.object.userData.face.pickSource.wallId, '3e626ad4-bf30-4d1a-b6cc-15fc6a33da0e')
    assert.ok(!hitGables(gables, [2,4.5,z], [-1,0,0]).some(gable => gable.distance <= hit.distance + 1e-5), 'no overlaid roof-owned face')
  }
  for (const x of [1.3, 1.34]) {
    assert.ok(Math.abs(ray([x,2.85,8.5],[0,0,-1]).point.z - 7.984318178) < 1e-5, 'no notch at the low outside corner')
  }
  for (const y of [2.3, 2.35, 2.45, 2.55, 2.65]) for (const z of [1.24, 1.28, 1.32]) {
    const hit = ray([2,y,z],[-1,0,0])
    assert.ok(hit && Math.abs(hit.point.x - 1.35) < 1e-5, `facade beside the overhang at ${y}, ${z}`)
  }
  for (const y of [2.45, 2.55, 2.65]) for (const z of [2.8, 3.3, 4.4, 6.5]) {
    const hit = ray([7,y,z],[-1,0,0])
    assert.ok(hit && Math.abs(hit.point.x - 5.92) < 1e-5, 'the floor band owns the facade')
    assert.ok(!hitGables(gables, [7,y,z], [-1,0,0]).some(gable => Math.abs(gable.point.x - 5.92) < 1e-5),
      'the gable cannot duplicate the floor band')
  }
  meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose() })
})

test('Red House roof-owned gables close the upper room and preserve its doorway', () => {
  const project = JSON.parse(readFileSync(new URL('../red_house_3.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const before = JSON.stringify(project)
  const roofs = resolveBuildingRoofs(project.floors)
  const gables = buildBuildingRoofGables(project.floors, roofs, buildBuildingRoomVolumes(project.floors, roofs))
  assert.equal(JSON.stringify(project), before)
  const main = gables.filter(gable => gable.roofId === 'b490e12e-e2cc-4509-801c-33d0e68a1aa2')
  assert.equal(main.length, 2)
  const meshes = main.map(gable => {
    const positions = gable.faces.flatMap(face => face.points.slice(1, -1).flatMap((point, i) =>
      [face.points[0], point, face.points[i + 2]].flat()))
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
  })
  const hit = (origin: number[], direction: number[]) => new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObjects(meshes)[0]
  for (const y of [5.15, 5.3, 5.5, 5.8]) {
    assert.ok(Math.abs(hit([3, y, 4.7], [-1, 0, 0])!.point.x - 1.35) < 1e-5, `inner wall C at height ${y}`)
    assert.ok(Math.abs(hit([4, y, 4.7], [1, 0, 0])!.point.x - 5.62) < 1e-5, `inner wall A at height ${y}`)
  }
  assert.equal(hit([3, 3.7, 5.2431305714], [-1, 0, 0]), undefined, 'the upstairs doorway remains open')
  assert.ok(main.some(gable => gable.faces.some(face => face.interior)), 'interior has its own finish')
})

test('loft gables restrict wall finishes to vertical skins', () => {
  const project = JSON.parse(readFileSync(new URL('../loft_test.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(project.floors)
  const gables = buildBuildingRoofGables(project.floors, roofs, buildBuildingRoomVolumes(project.floors, roofs))
  const faces = gables.flatMap(gable => gable.faces)
  const wallSkins = faces.filter(face => face.wallSide !== undefined)
  const caps = faces.filter(face => Math.abs(face.plane[1]) > 1e-7)

  assert.ok(wallSkins.length > 0)
  assert.ok(wallSkins.every(face => Math.abs(face.plane[1]) <= 1e-7),
    'only vertical wall skins can inherit a wall-side material')
  assert.ok(caps.length > 0)
  assert.ok(caps.every(face => face.wallSide === undefined),
    'roof-contact caps cannot inherit a wall-side material')

  assert.ok(wallSkins.some(face => face.interior))
})

test('gable return brick UVs retain their width on perpendicular faces', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofFinishingRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors)
  const gables = buildBuildingRoofGables(floors, roofs, buildBuildingRoomVolumes(floors, roofs))
  let returns = 0
  for (const face of gables.flatMap(gable => gable.faces).filter(face => face.wallSide !== undefined)) {
    const wall = face.wall!
    const dx = wall.end.x - wall.start.x, dz = wall.end.y - wall.start.y
    if (Math.abs(face.plane[0] * dx + face.plane[2] * dz) > 0.01) returns++
    const uvArea = Math.abs(face.uvs.reduce((sum, [u, v], i) => {
      const [nu, nv] = face.uvs[(i + 1) % face.uvs.length]
      return sum + u * nv - nu * v
    }, 0)) / 2
    assert.ok(Math.abs(uvArea - solidPolygonArea(face.points)) < 1e-7, 'brick UVs use metres along the actual face')
  }
  assert.ok(returns > 0, 'the saved junction exercises perpendicular return faces')
})

test('fitted asymmetric eaves close the raised side above its actual supporting wall', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofFinishingRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const before = JSON.stringify(floors)
  const roofs = resolveBuildingRoofs(floors)
  const roof = roofs.find(candidate => candidate.roof.asymmetricSides)!
  const gables = buildBuildingRoofGables(floors, roofs, buildBuildingRoomVolumes(floors, roofs))
  const side = gables.filter(gable => gable.roofId === roof.roof.id && gable.end === 'minX')
  const joinedCorner = hitGables(gables, [1, 5.2, 9.9], [1, 0, 0])[0]
  assert.ok(joinedCorner && Math.abs(joinedCorner.point.x - 1.580552174) < 1e-5,
    'the incoming wall continues beneath the joined eave without exposing its original top cap')
  for (const x of [0, 0.8, 1.4]) {
    const hits = hitGables(side, [x, 5.2, 9], [0, 0, 1])
    assert.ok(hits.length && Math.abs(hits[0].point.z - 10.010690667) < 1e-5, 'brick continues in the supporting facade plane')
    const top = hitGables(side, [x, 8, 10.16], [0, -1, 0])[0]
    const roofTop = Math.max(...roofSurfaceHeights(roof.resolved.exteriorFaces, { x, y: 10.16 }))
    assert.ok(top && Math.abs(top.point.y - roofTop + 0.04) < 1e-5, 'the raised infill reaches the underside')
  }
  assert.equal(hitGables(side, [2.5, 5.2, 9], [0, 0, 1]).length, 0, 'no floating wall is invented beyond the support wall')
  assert.equal(JSON.stringify(floors), before)
  floors[1].roofs!.find(r => r.id === roof.roof.id)!.fitSupportingWalls = false
  const unfitted = resolveBuildingRoofs(floors)
  assert.ok(!buildBuildingRoofGables(floors, unfitted, buildBuildingRoomVolumes(floors, unfitted))
    .some(gable => gable.roofId === roof.roof.id && gable.end === 'minX'))
})
