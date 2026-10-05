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
import { getPitchedRoofSurfaceDistance } from '../src/roofProfile.ts'
import { createSolidRoofGeometryFromFaces, cutRoofFacesAtDormerOpenings, type RoofVertex } from '../src/roofSolidGeometry.ts'

const definition: ModelDefinition = {
  id: 'dormer', name: 'Dormer', category: 'Windows', color: '#fff',
  width: 1.25, height: 1.35, depth: 1.35, shape: 'box', roofMount: 'dormer',
}
const roof: RoofStructure = {
  id: 'roof', type: 'up-and-over', width: 6, depth: 8,
  position: { x: 0, y: 0 }, rotation: 0, pitchDegrees: 45, thickness: 0.08,
}

test('dormer tiles follow the main roof UV convention and boxed soffits close the overhang', () => {
  for (const width of [1.25, 2.8]) for (const pitchDegrees of [25, 45, 65]) {
    const assembly = createDormerStructuralAssembly({ definition, hostRoof: { ...roof, pitchDegrees }, ownerId: 'd', width, height: 1.8 })
    const geometries = createDormerGeometries(assembly)
    const positions = geometries.top.getAttribute('position'), uvs = geometries.top.getAttribute('uv')
    const bounds = { minX: -assembly.roofHalfWidth, maxX: assembly.roofHalfWidth, minY: -assembly.depth, maxY: 0.08 }
    for (let i = 0; i < positions.count; i++) {
      assert.ok(Math.abs(uvs.getX(i) - positions.getZ(i)) < 1e-5, 'tile courses follow the ridge')
      assert.ok(Math.abs(uvs.getY(i) - getPitchedRoofSurfaceDistance(assembly.roof, bounds, positions.getX(i))) < 1e-5,
        'same pitch distance and orientation as the host roof')
    }
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const fascia = new Mesh(geometries.fascia, material)
    for (const side of [-1, 1]) {
      const x = side * (width / 2 + assembly.walls[0].thickness / 2 + assembly.roofHalfWidth) / 2
      const hits = new Raycaster(new Vector3(x, 0, -0.15), new Vector3(0, 1, 0)).intersectObject(fascia)
      assert.ok(hits.length, 'horizontal soffit closes the eaves')
      assert.ok(Math.abs(hits[0].point.y - (assembly.wallHeight - roof.thickness! - 0.16)) < 1e-5)
    }
    const front = new Raycaster(new Vector3(0.2, 0, assembly.walls[0].thickness / 2 + 0.02), new Vector3(0, 1, 0)).intersectObject(fascia)
    assert.ok(front.length, 'front overhang has a continuous soffit below the roof')
    Object.values(geometries).forEach(geometry => geometry.dispose())
    material.dispose()
  }
})

test('interior wall faces and window reveals have a separate finish with usable texture coordinates', () => {
  const assembly = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: 'd', wallBaseY: -0.4 })
  const geometries = createDormerGeometries(assembly, 1, [[0, 0, -1, -0.55]])
  const materials = [new MeshBasicMaterial({ side: DoubleSide }), new MeshBasicMaterial({ side: DoubleSide })]
  const walls = new Mesh(geometries.walls, materials)
  assert.equal(geometries.walls.groups.length, 2, 'one draw call per finish')
  const hit = (start: number[], direction: number[]) => new Raycaster(new Vector3(...start), new Vector3(...direction)).intersectObject(walls)[0]
  assert.equal(hit([0, -0.2, -0.3], [0, 0, 1]).face!.materialIndex, 1, 'inner front')
  assert.equal(hit([0, -0.2, 0.3], [0, 0, -1]).face!.materialIndex, 0, 'outer front')
  for (const side of [-1, 1]) {
    assert.equal(hit([0, 0.4, -0.25], [side, 0, 0]).face!.materialIndex, 1, 'inner cheek')
    assert.equal(hit([side, 0.4, -0.25], [-side, 0, 0]).face!.materialIndex, 0, 'outer cheek')
    assert.equal(hit([0, assembly.windowBottom + assembly.windowHeight / 2, 0], [side, 0, 0]).face!.materialIndex, 1, 'window reveal')
  }
  const uv = geometries.walls.getAttribute('uv')
  for (let i = 0; i < uv.count; i += 3) {
    const area = (uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) -
      (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i))
    assert.ok(Math.abs(area) > 1e-10, 'wall texture must not collapse into a line')
  }
  Object.values(geometries).forEach(geometry => geometry.dispose())
  materials.forEach(material => material.dispose())
})

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
    const apron = new Raycaster(new Vector3(0, -0.3, -0.2), new Vector3(0, 0, 1), 0, 0.4)
    assert.equal(apron.intersectObject(walls).length > 0, withKneeWall,
      'the front apron extends below the roof lining only when joined to an internal wall')
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

test('both valley linings meet without exposing the tiled shell through a narrow gap', () => {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  for (const pitchDegrees of [25, 45, 75]) for (const depthScale of [0.7, 1, 1.4]) {
    const host = { ...roof, pitchDegrees }
    const assembly = createDormerStructuralAssembly({ definition, hostRoof: host, ownerId: 'd', depthScale })
    const geometries = createDormerGeometries(assembly, depthScale)
    const slope = Math.tan(pitchDegrees * Math.PI / 180), hostSlope = slope * depthScale
    // Work in dormer-local space; scale the plan cutter back into that space.
    const model = { id: 'd', modelId: 'dormer', position: { x: 0, y: 0 }, rotation: 0, depthScale }
    const opening = getDormerOpeningPolygon(model, definition, host).map(p => ({ x: p.x, y: p.y / depthScale }))
    const face: RoofVertex[] = [[-4, 0, 1], [4, 0, 1], [4, 0, -assembly.depth - 1], [-4, 0, -assembly.depth - 1]]
    face.forEach(p => { p[1] = -hostSlope * p[2] })
    const cut = cutRoofFacesAtDormerOpenings([face], [opening])
    const hostGeometry = createSolidRoofGeometryFromFaces(cut, undefined, host.thickness, [face], cut)
    const ceiling = new Mesh(geometries.underside, material)
    const hostCeiling = new Mesh(hostGeometry.underside, material)
    const shell = new Mesh(geometries.shell, material)
    const ridge = assembly.wallHeight + assembly.roofRise
    for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) {
      const valleyZ = -(ridge - Math.abs(x) * slope) / hostSlope
      for (const offset of [-0.001, -0.0001, 0.0001, 0.001]) {
        const ray = new Raycaster(new Vector3(x, -1, valleyZ + offset), new Vector3(0, 1, 0))
        const hit = ray.intersectObjects([ceiling, hostCeiling, shell])[0]
        assert.ok(hit && hit.object !== shell,
          `closed lining at pitch ${pitchDegrees}, depth scale ${depthScale}, x ${x}, valley offset ${offset}`)
      }
    }
    Object.values(geometries).forEach(geometry => geometry.dispose())
    Object.values(hostGeometry).forEach(geometry => geometry?.dispose())
  }
  material.dispose()
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

test('wide low dormer uses its gable for the window and opens a loft knee wall behind the side valley', () => {
  const floors = fixture(), model = floors[0].models[0], knee = floors[1].walls.at(-1)!
  model.dormerWidth = 2.25
  model.dormerHeight = 0.6
  model.roofAttachment!.localPosition.x = 3.0628988228767007
  knee.start.x = knee.end.x = 2.20147027033899
  const window: ModelDefinition = { ...definition, id: 'three-pane', roofMount: undefined, wallMount: 'window', width: 1.64, height: 1.1 }
  model.dormerWindowModelId = window.id
  const definitions = new Map([[definition.id, definition], [window.id, window]])
  const prepared = prepareDormerInteriors(floors, definitions)
  assert.equal(prepared.baseElevations.get(model.id), floors[1].elevation, 'the mount and sill can lie below the loft slab')
  const opening = prepared.floors[1].walls.at(-1)!.openings?.[0]
  assert.ok(opening && opening.width > 1.8 && opening.width <= 2.25,
    'the triangular rear of the aperture must carve the knee wall')
  assert.ok(prepared.floors[1].walls.find(wall => wall.id === 'wall-1')!.openings?.length,
    'the loft eaves wall inside the recess must also be cleared')
  assert.equal(prepared.floors[0].walls.find(wall => wall.id === 'wall-1')!.openings, undefined,
    'leave the supporting facade on the storey below intact')
  assert.equal(prepared.wallContacts.get(model.id)!.length, 1, 'material inheritance uses the internal wall only')
  assert.equal(prepared.roomClipPlanes.get(model.id)!.length, 1,
    'an internal knee wall remains the return boundary when an external eaves wall also intersects')
  const assembly = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: model.id, width: 2.25, height: 0.6,
    windowDefinition: window, wallBaseY: -0.2 })
  assert.ok(assembly.windowWidth > 1.2 && assembly.windowHeight > 0.8, 'use gable headroom instead of shrinking below the eaves')
  assert.ok(Math.abs(assembly.windowWidth / assembly.windowHeight - window.width / window.height) < 1e-8)
  const topCorner = assembly.windowBottom + assembly.windowHeight
  const ceilingAtCorner = assembly.wallHeight + assembly.roofRise - assembly.windowWidth / 2 - roof.thickness!
  assert.ok(topCorner < ceilingAtCorner - 0.15, 'window still clears the pitched lining')
  const raisedFloor = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: model.id, width: 2.25, height: 0.6,
    windowDefinition: window, wallBaseY: 0.02 })
  assert.ok(raisedFloor.wallBaseY <= -roof.thickness! - raisedFloor.walls[0].thickness / 2,
    'front must reach through the roof skin beneath a higher loft slab')
  const geometries = createDormerGeometries(assembly, 1, prepared.roomClipPlanes.get(model.id))
  const material = new MeshBasicMaterial({ side: DoubleSide }), walls = new Mesh(geometries.walls, material)
  for (const side of [-1, 1]) {
    const hit = (z: number) => new Raycaster(new Vector3(0, -0.05, z), new Vector3(side, 0, 0)).intersectObject(walls).length > 0
    assert.ok(hit(-0.85), 'lower cheek returns must reach the knee wall behind the valley')
    assert.equal(hit(-1.05), false, 'returns must not continue into the room')
  }
  Object.values(geometries).forEach(geometry => geometry.dispose())
  material.dispose()
})

test('wall thickness colliding with a newly added dormer creates a recess and deleting it restores the wall', () => {
  const floors = fixture(), model = floors[0].models[0]
  const knee = floors[1].walls.at(-1)!
  // Centre line is ahead of the front face; its 20 cm solid still intersects.
  knee.start.x = knee.end.x = 2.06
  knee.thickness = 0.2
  const definitions = new Map([['dormer', definition]])
  floors[0].models = []
  assert.equal(prepareDormerInteriors(floors, definitions).floors, floors)
  floors[0].models = [model]
  const added = prepareDormerInteriors(floors, definitions)
  assert.equal(added.floors[1].walls.at(-1)!.openings?.length, 1)
  assert.equal(added.roomClipPlanes.get(model.id)?.length, 1)
  model.roofAttachment!.localPosition.y = 3.5
  assert.equal(prepareDormerInteriors(floors, definitions).floors[1].walls.at(-1)!.openings?.length, 1)
  floors[0].models = []
  assert.equal(prepareDormerInteriors(floors, definitions).floors, floors)
  assert.equal(knee.openings, undefined)
})

test('an upper-floor external wall closes the dormer recess down to the floor', () => {
  const floors = fixture(), model = floors[0].models[0]
  floors[1].walls = structuredClone(floors[1].walls.slice(0, -1))
  // A recessed external eaves wall, as in Red House 5; no internal knee wall.
  const eaves = floors[1].walls[1]
  eaves.start.x = eaves.end.x = 1.5
  floors[1].walls[0].end.x = floors[1].walls[2].start.x = 1.5
  const original = structuredClone(floors)
  const result = prepareDormerInteriors(floors, new Map([[definition.id, definition]]))
  assert.equal(result.baseElevations.get(model.id), floors[1].elevation)
  assert.ok(result.floors[1].walls[1].openings?.length, 'cut the external eaves wall')
  const planes = result.roomClipPlanes.get(model.id)
  assert.equal(planes?.length, 1, 'external room boundary needs full-height returns')
  assert.equal(result.wallContacts.has(model.id), false, 'retain the chosen dormer interior finish')
  const recess = result.floorRecesses[0]
  assert.equal(recess.floorId, floors[1].id)
  assert.ok(recess.polygon.length >= 3)
  assert.ok(recess.roomProbe.x < 1.5 - eaves.thickness / 2, 'floor material probe is inside the adjoining room')
  assert.ok(recess.polygon.every(p => p.x <= 2 + 1e-6 && p.x >= 1.3 - 1e-6),
    'floor extension stays between the dormer front and room-facing wall')
  const assembly = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: model.id, wallBaseY: -0.8 })
  const geometries = createDormerGeometries(assembly, 1, planes, result.wallJunctionSolids.get(model.id))
  const material = new MeshBasicMaterial({ side: DoubleSide }), walls = new Mesh(geometries.walls, material)
  const hit = (direction: number[], z: number) => new Raycaster(new Vector3(0, -0.6, z), new Vector3(...direction)).intersectObject(walls).length > 0
  assert.ok(hit([0, 0, 1], -0.2), 'front apron closes below the roof lining')
  for (const side of [-1, 1]) {
    assert.ok(hit([side, 0, 0], -0.6), 'side return reaches the room-facing external wall surface')
    assert.equal(hit([side, 0, 0], -0.7), false, 'return stops before projecting into the room')
    const cap = (x: number) => new Raycaster(new Vector3(side * x, -0.6, -0.8), new Vector3(0, 0, 1), 0, 0.3)
      .intersectObject(walls).length > 0
    assert.equal(cap(0.7), false, 'the existing wall owns the outer half of the coplanar junction')
    assert.ok(cap(0.55), 'the exposed return end inside the wall opening stays closed')
    const upperCheek = new Raycaster(new Vector3(side, 0.9, -0.8), new Vector3(-side, 0, 0), 0, 0.6)
      .intersectObject(walls)[0]
    assert.ok(upperCheek && Math.abs(Math.abs(upperCheek.point.x) - 0.775) < 1e-6,
      'the outer cheek above the host roof must not be removed with the buried cap')
  }
  assert.deepEqual(floors, original, 'saved walls remain unchanged')
  ;[eaves.start, eaves.end] = [eaves.end, eaves.start]
  const reversed = prepareDormerInteriors(floors, new Map([[definition.id, definition]]))
  assert.deepEqual(reversed.roomClipPlanes.get(model.id), planes,
    'reversing the external wall retains the same room-facing boundary')
  model.roofAttachment!.localPosition.y += 0.25
  const moved = prepareDormerInteriors(floors, new Map([[definition.id, definition]]))
  assert.ok(moved.floorRecesses[0].polygon.every((point, i) =>
    Math.abs(point.x - recess.polygon[i].x) < 1e-6 &&
    Math.abs(point.y - recess.polygon[i].y - 0.25) < 1e-6), 'floor follows the roof attachment when moved')
  floors[0].models = []
  const removed = prepareDormerInteriors(floors, new Map([[definition.id, definition]]))
  assert.equal(removed.floors, floors, 'removing the dormer restores the external wall')
  assert.equal(removed.roomClipPlanes.size, 0)
  assert.equal(removed.floorRecesses.length, 0, 'removing the dormer also removes its floor extension')
  Object.values(geometries).forEach(geometry => geometry.dispose())
  material.dispose()
})

test('steeply angled and reversed internal walls are detected by their solid intersection', () => {
  const floors = fixture(), knee = floors[1].walls.at(-1)!
  knee.start = { x: 0.7, y: -0.3 }
  knee.end = { x: 2.2, y: 0.3 }
  const definitions = new Map([['dormer', definition]])
  const forward = prepareDormerInteriors(floors, definitions)
  const opening = forward.floors[1].walls.at(-1)!.openings?.[0]
  assert.ok(opening && opening.width > 0 && opening.width < Math.hypot(1.5, 0.6))
  ;[knee.start, knee.end] = [knee.end, knee.start]
  const reversed = prepareDormerInteriors(floors, definitions)
  assert.ok(Math.abs(reversed.floors[1].walls.at(-1)!.openings![0].width - opening.width) < 1e-8)
  assert.equal(forward.wallContacts.get('d')![0].side, -reversed.wallContacts.get('d')![0].side,
    'reversing the wall flips the side index but preserves the physical room-facing finish')
})

test('a dormer mounted just below the loft slab still joins the loft wall', () => {
  const floors = fixture()
  floors[1].elevation = 6.3
  const prepared = prepareDormerInteriors(floors, new Map([['dormer', definition]]))
  assert.equal(prepared.baseElevations.get('d'), 6.3)
  assert.equal(prepared.floors[1].walls.at(-1)!.openings?.length, 1)
})

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

test('a slab-boundary loft hosts the dormer with no walls or a single knee wall', () => {
  for (const withKneeWall of [false, true]) for (const reversed of [false, true]) {
    const floors = fixture(), loft = floors[1]
    loft.floorFootprints = [loft.walls.slice(0, 4).map(wall => ({ ...wall.start }))]
    const knee = loft.walls.at(-1)!
    // This wall alone is not an enclosure. Its endpoint order must not decide
    // whether the dormer belongs to the loft or the storey below.
    if (reversed) [knee.start, knee.end] = [knee.end, knee.start]
    loft.walls = withKneeWall ? [knee] : []
    const original = structuredClone(floors)
    const prepared = prepareDormerInteriors(floors, new Map([[definition.id, definition]]))
    assert.equal(prepared.baseElevations.get('d'), loft.elevation)
    assert.deepEqual(floors, original)
    assert.ok(prepared.floors[0].walls.every(wall => !wall.openings?.length))
    if (!withKneeWall) {
      assert.equal(prepared.roomClipPlanes.has('d'), false)
      continue
    }
    const opening = prepared.floors[1].walls[0].openings![0]
    assert.equal(opening.width, definition.width)
    assert.equal(opening.height, knee.height)
    assert.equal(prepared.wallContacts.get('d')?.[0].wallId, knee.id)
    assert.equal(prepared.floorRecesses[0].floorId, loft.id)
    const assembly = createDormerStructuralAssembly({ definition, hostRoof: roof, ownerId: 'd', wallBaseY: -0.9 })
    const geometries = createDormerGeometries(assembly, 1,
      prepared.roomClipPlanes.get('d'), prepared.wallJunctionSolids.get('d'))
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometries.walls, [material, material])
    for (const side of [-1, 1]) {
      const hit = (z: number) => new Raycaster(new Vector3(0, -0.1, z), new Vector3(side, 0, 0))
        .intersectObject(mesh)[0]
      assert.equal(hit(-0.8), undefined, 'no cheek fin projecting into the loft')
      assert.equal(hit(-0.25)?.face?.materialIndex, 1, 'recess retains its interior finish')
    }
    Object.values(geometries).forEach(geometry => geometry.dispose())
    material.dispose()
  }
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
