import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoomRoofCeilingFaces } from '../src/roomRoofCeiling.ts'
import { roofSurfaceHeights } from '../src/roofJunctions.ts'
import type { RoomRoofCut } from '../src/roofRoomCsg.ts'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { readFileSync } from 'node:fs'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import type { FloorLevel } from '../src/types.ts'

test('a sloping ceiling finishes only its room and storey, leaving stair openings clear', () => {
  const cuts: RoomRoofCut[] = [{ roomVolume: true, floorId: 'hall', roofId: 'porch',
    thickness: 0, bottomY: -1, face: [[0, -0.5, 0], [4, 3.5, 0], [4, 3.5, 4], [0, -0.5, 4]] }]
  const room = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }]
  const stair = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }]
  const faces = getRoomRoofCeilingFaces(cuts, 'hall', room, 2.4, 0, [stair])
  const heights = (x: number, y: number) => roofSurfaceHeights(faces, { x, y })
  assert.ok(Math.abs(heights(2.5, 2.5)[0] - 1.996) < 1e-7, 'lining sits below the roof skin')
  for (const point of [[0.2, 0.5], [2.99, 0.5], [2, 3.5], [1.5, 1.5]]) {
    assert.equal(heights(point[0], point[1]).length, 0, `no finish at ${point}`)
  }
  assert.deepEqual(getRoomRoofCeilingFaces(cuts, 'upstairs', room, 5.1, 2.7), [])
})

test('a roof ending inside a room has a visible return up to the flat ceiling', () => {
  const cuts: RoomRoofCut[] = [
    { roomVolume: true, floorId: 'hall', roofId: 'porch', thickness: 0, bottomY: 0,
      face: [[0, 2, 1], [2, 2.4, 1], [2, 2.4, 3], [0, 2, 3]] },
    // Split the neighbour to exercise partially overlapping edge intervals.
    ...[[0, 1], [1, 2]].map(([a, b]) => ({ roomVolume: true, floorId: 'hall', roofId: '', thickness: 0, bottomY: 0,
      face: [[a, 2.4, 0], [b, 2.4, 0], [b, 2.4, 1], [a, 2.4, 1]] as [number, number, number][] })),
  ]
  const room = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }]
  const faces = getRoomRoofCeilingFaces(cuts, 'hall', room, 2.4, 0)
  const returns = faces.filter(face => face.every(p => p[2] === 1))
  assert.ok(returns.length >= 2, 'closes each shared edge interval')
  const positions = returns.flatMap(face => face.slice(1, -1).flatMap((p, i) => [...face[0], ...p, ...face[i + 2]]))
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material)
  for (const x of [.25, 1.25]) {
    assert.ok(new Raycaster(new Vector3(x, 2.35, .5), new Vector3(0, 0, 1)).intersectObject(mesh).length,
      'return faces the room on the flat-ceiling side')
  }
  assert.equal(new Raycaster(new Vector3(.25, 1.9, .5), new Vector3(0, 0, 1)).intersectObject(mesh).length, 0,
    'does not extend below the sloping ceiling')
  geometry.dispose(); material.dispose()
})

test('Colin hall ceiling closes the exposed end of the bay roof cut', () => {
  const house = JSON.parse(readFileSync(new URL('../colin_house_v2.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const volumes = buildBuildingRoomVolumes(house.floors, resolveBuildingRoofs(house.floors))
  const floor = house.floors[0]
  const faces = volumes.roomPolygonsByFloor.get(floor.id)!.flatMap(polygon =>
    getRoomRoofCeilingFaces(volumes.cuts, floor.id, polygon, floor.elevation + floor.roomHeight - .02, floor.elevation))
  const panels = faces.filter(face => face.every(p => Math.abs(p[2] - 16.3307676465) < 1e-5))
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(panels.flatMap(face =>
    face.slice(1, -1).flatMap((p, i) => [...face[0], ...p, ...face[i + 2]])), 3))
  const material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material)
  assert.ok(new Raycaster(new Vector3(3.2, 2.35, 16.1), new Vector3(0, 0, 1)).intersectObject(mesh).length,
    'the opening visible from the saved hall viewpoint is covered by the ceiling return')
  geometry.dispose(); material.dispose()
})
