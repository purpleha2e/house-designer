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

function hitGables(gables: ReturnType<typeof buildBuildingRoofGables>, origin: number[], direction: number[]) {
  const meshes = gables.map(gable => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(gable.faces.flatMap(face =>
      face.points.slice(1, -1).flatMap((point, i) => [face.points[0], point, face.points[i + 2]].flat())), 3))
    return new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
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
