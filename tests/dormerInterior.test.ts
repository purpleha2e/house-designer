import assert from 'node:assert/strict'
import test from 'node:test'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { createDormerStructuralAssembly, getDormerOpeningPolygon } from '../src/dormerPlacement.ts'
import { createDormerGeometries } from '../src/dormerGeometry.ts'
import { prepareDormerInteriors } from '../src/dormerInterior.ts'
import type { ModelDefinition } from '../src/models/modelLibrary.ts'
import type { FloorLevel, RoofStructure, Wall } from '../src/types.ts'
import { buildWallBodyPerimeterMeshFaces, buildWallMeshFaces } from '../src/wallEngine/wallMesh.ts'
import { clipWallFacesToRoofUndersides, roofFacePlanes } from '../src/wallEngine/wallRoofClip.ts'

const definition: ModelDefinition = {
  id: 'dormer', name: 'Dormer', category: 'Windows', color: '#fff',
  width: 1.25, height: 1.35, depth: 1.35, shape: 'box', roofMount: 'dormer',
}
const roof: RoofStructure = {
  id: 'roof', type: 'up-and-over', width: 6, depth: 8,
  position: { x: 0, y: 0 }, rotation: 0, pitchDegrees: 45, thickness: 0.08,
}

test('cheeks do not project into the loft below its roof, but retain the recessed wall returns', () => {
  const assembly = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: 'd', wallBaseY: -0.4 })
  const material = new MeshBasicMaterial({ side: DoubleSide })
  for (const withKneeWall of [true, false]) {
    const geometries = createDormerGeometries(assembly, 1, withKneeWall ? [[0, 0, -1, -0.55]] : [])
    const walls = new Mesh(geometries.walls, material)
    const hitCheek = (side: number, y: number, z: number) => new Raycaster(
      new Vector3(0, y, z), new Vector3(side, 0, 0), 0, 1,
    ).intersectObject(walls).length > 0
    for (const side of [-1, 1]) {
      assert.equal(hitCheek(side, 0.4, -0.8), false, 'remove the fin inside the room')
      assert.equal(hitCheek(side, 0.9, -0.8), true, 'close the cheek above the host roof')
      assert.equal(hitCheek(side, -0.1, -0.25), withKneeWall, 'retain the return outside the knee wall')
      if (withKneeWall) {
        assert.equal(hitCheek(side, 0.1, -0.551), false)
        assert.equal(hitCheek(side, 0.1, -0.549), true)
      }
    }
    Object.values(geometries).forEach(geometry => geometry.dispose())
  }
  material.dispose()
})

test('dormer gable closes above the window, ceiling reaches the valley, and fascia stays outside', () => {
  for (const pitchDegrees of [25, 35, 45, 60, 75]) {
    const host = { ...roof, pitchDegrees }
    const assembly = createDormerStructuralAssembly({ definition, hostRoof: host, ownerId: 'd', wallBaseY: -0.4 })
    const geometries = createDormerGeometries(assembly)
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const walls = new Mesh(geometries.walls, material)
    const ceiling = new Mesh(geometries.underside, material)
    const gableY = assembly.wallHeight + assembly.roofRise / 2
    assert.ok(new Raycaster(new Vector3(0, gableY, -0.2), new Vector3(0, 0, 1)).intersectObject(walls).length,
      `front gable must be closed at ${pitchDegrees} degrees`)
    const slope = Math.tan(pitchDegrees * Math.PI / 180)
    const ridge = assembly.wallHeight + assembly.roofRise
    for (const x of [-0.4, 0, 0.4]) {
      const top = ridge - Math.abs(x) * slope
      for (const z of [-0.1, -(top / slope) + 0.05]) {
        assert.ok(new Raycaster(new Vector3(x, -0.3, z), new Vector3(0, 1, 0)).intersectObject(ceiling).length,
          `ceiling must cover the full recess at ${pitchDegrees} degrees`)
      }
    }
    const p = geometries.fascia.getAttribute('position')
    for (let i = 0; i < p.count; i++) assert.ok(p.getY(i) + slope * p.getZ(i) >= -1e-6)
    Object.values(geometries).forEach(geometry => geometry.dispose())
    material.dispose()
  }
})

test('aperture follows the roof intersection and an attachment after the roof moves', () => {
  const host = { ...roof, position: { x: 8, y: 3 }, rotation: Math.PI / 3 }
  const assembly = createDormerStructuralAssembly({ definition, hostRoof: host, ownerId: 'd' })
  const model = {
    id: 'd', modelId: 'dormer', position: { x: -100, y: -100 }, rotation: 0, scale: 1,
    roofAttachment: { roofId: host.id, surface: 'positive-x' as const, localPosition: { x: 2, y: 0 } },
  }
  const polygon = getDormerOpeningPolygon(model, definition, host)
  assert.equal(polygon.length, 5)
  assert.ok(polygon.every(p => p.x > 0 && p.y > -2))
  const front = { x: (polygon[0].x + polygon[1].x) / 2, y: (polygon[0].y + polygon[1].y) / 2 }
  assert.ok(Math.abs(Math.hypot(polygon[3].x - front.x, polygon[3].y - front.y) - assembly.depth) < 1e-8)
  assert.ok(assembly.depth > definition.depth, 'the original model depth must not truncate the valley')
})

function fixture() {
  const ring = [{ x: -3, y: -4 }, { x: 3, y: -4 }, { x: 3, y: 4 }, { x: -3, y: 4 }]
  const walls: Wall[] = ring.map((start, i) => ({ id: `wall-${i}`, start, end: ring[(i + 1) % 4], height: 2.4, thickness: 0.3, kind: 'external' }))
  return [
    { id: 'lower', name: 'Lower', elevation: 2.7, roomHeight: 2.4, walls, rooms: [], roofs: [roof], models: [{
      id: 'd', modelId: 'dormer', position: { x: 2, y: 0 }, rotation: -Math.PI / 2, scale: 1,
      roofAttachment: { roofId: roof.id, surface: 'positive-x', localPosition: { x: 2, y: 0 } },
    }] },
    { id: 'loft', name: 'Loft', elevation: 5.2, roomHeight: 2.4, rooms: [], roofs: [], models: [], walls: [...walls, {
      id: 'knee', kind: 'internal', start: { x: 1.5, y: -4 }, end: { x: 1.5, y: 4 }, thickness: 0.1, height: 2.4,
    }] },
  ] as FloorLevel[]
}

test('inherited dormer uses the loft floor and opens only the intersecting knee wall without changing saved data', () => {
  const floors = fixture(), original = structuredClone(floors)
  const result = prepareDormerInteriors(floors, new Map([['dormer', definition]]))
  assert.equal(result.baseElevations.get('d'), 5.2)
  const opening = result.floors[1].walls.at(-1)!.openings![0]
  assert.equal(opening.bottom, 0)
  assert.equal(opening.height, 2.4)
  assert.ok(Math.abs(opening.center - 4) < 1e-8)
  assert.equal(opening.width, definition.width)
  const [plane] = result.roomClipPlanes.get('d')!
  assert.ok(plane.every((value, i) => Math.abs(value - [0, 0, -1, -0.55][i]) < 1e-8))
  assert.ok(result.floors[0].walls.every(wall => !wall.openings?.length))
  assert.deepEqual(floors, original)
  floors[0].models = []
  assert.equal(prepareDormerInteriors(floors, new Map([['dormer', definition]])).floors, floors)
})

test('full-height recess stays open through ordinary and perimeter wall caps after sloping roof clipping', () => {
  const wall: Wall = {
    id: 'knee', kind: 'internal', start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.2, height: 2.4,
    openings: [{ id: 'recess', modelId: 'dormer', center: 2, width: 1.2, bottom: 0, height: 2.4 }],
  }
  for (const build of [buildWallMeshFaces, buildWallBodyPerimeterMeshFaces]) {
    const planes = roofFacePlanes([[-1, 0.5, -1], [5, 1.7, -1], [5, 1.7, 1], [-1, 0.5, 1]])
    const faces = clipWallFacesToRoofUndersides(build([wall]), { floorElevation: 0, volumes: [{
      planes, surfacePlane: planes.at(-1), clipSides: true, excludedWallIds: new Set(), protectedFootprints: [],
    }] })
    const caps = faces.filter(face => face.normal[1] > 0.5)
    assert.ok(caps.length)
    for (const face of caps) {
      const x = face.vertices.slice(0, 3).reduce((sum, v) => sum + v.position[0], 0) / 3
      assert.ok(x <= 1.4 + 1e-6 || x >= 2.6 - 1e-6, `cap must not bridge the recess: ${face.faceId}`)
    }
  }
})
