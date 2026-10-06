import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { assembleRoofCells, constructRoofAssembly, constructJoinedRoofAssembly, createJoinedRoofAssemblyGeometries, createRoofAssemblyGeometries, roofPanelSolid } from '../src/roofAssembly.ts'
import { subtractSolid } from '../src/convexSolid.ts'
import { roofJunctionInput, resolveRoofJunctions, roofToWorld } from '../src/roofJunctions.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { buildBuildingRoomVolumes } from '../src/buildingRoomVolumes.ts'
import type { FloorLevel, RoofStructure } from '../src/types.ts'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { getPitchedRoofHeightAtX } from '../src/roofProfile.ts'

function closed(assembly: ReturnType<typeof assembleRoofCells>) {
  assert.ok(assembly.faces.length)
  const bad = assembly.edges.filter(edge => edge.faces.length !== 2)
  assert.equal(bad.length, 0, `every boundary edge has two incident faces: ${JSON.stringify(bad.slice(0, 5))}`)
  assert.ok(assembly.faces.every(face => face.points.flat().every(Number.isFinite)))
}

test('cutting a constructed roof panel closes the cut and retains its material ownership', () => {
  const panel = roofPanelSolid([[0, 1, 0], [2, 2, 0], [2, 2, 2], [0, 1, 2]], (x) => 0.8 + x / 2, 'top', 'underside', 'shell')!
  const cells = subtractSolid(panel, [[1, 0, 0, -1], [0, 0, 1, -1]], 'shell')
  const assembly = assembleRoofCells(cells)
  closed(assembly)
  assert.ok(assembly.faces.some(face => face.tag === 'shell' && face.points.every(p => Math.abs(p[0] - 1) < 1e-7)))
  assert.ok(assembly.faces.some(face => face.tag === 'top'))
})

test('joining unequal panel subdivisions removes their internal walls and conforms the shared boundary', () => {
  const make = (x1: number, x2: number, z1: number, z2: number) => roofPanelSolid(
    [[x1, 1, z1], [x2, 1, z1], [x2, 1, z2], [x1, 1, z2]], () => 0, 'top', 'underside', 'shell')!
  const assembly = assembleRoofCells([make(0, 1, 0, 2), make(1, 2, 0, 1), make(1, 2, 1, 2)])
  closed(assembly)
  assert.ok(!assembly.faces.some(face => face.points.every(p => Math.abs(p[0] - 1) < 1e-7)))
})

test('roof and eave boxes form one closed assembly after a room-volume cut', () => {
  const roof: RoofStructure = { id: 'roof', type: 'up-and-over', width: 6, depth: 8,
    pitchDegrees: 30, position: { x: 0, y: 0 }, rotation: 0, overhangSide: 0.3 }
  const resolved = resolveRoofJunctions([roofJunctionInput(roof, 'floor', 3)])[0]
  const input = { resolved, roomCuts: [{ face: [[-5, 4, 1], [0, 4, 1], [0, 4, 2], [-5, 4, 2]] as [number, number, number][], thickness: 0.04, bottomY: 0 }] }
  const assembly = constructRoofAssembly(input)
  closed(assembly)
  assert.ok(assembly.faces.some(face => face.tag === 'eaves'))
  const geometries = createRoofAssemblyGeometries(input)
  for (const geometry of Object.values(geometries)) {
    assert.ok([...geometry.getAttribute('position').array, ...geometry.getAttribute('normal').array, ...geometry.getAttribute('uv').array].every(Number.isFinite))
    geometry.dispose()
  }
})

test('a clipping roof keeps its overhang above the walls it trims in its own room', () => {
  const { floors } = JSON.parse(readFileSync(new URL('../colin_house_v2.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors)
  const porch = roofs.find(candidate => candidate.roof.id === '316c6436-0af8-4dc5-9790-ad4352f645cc')!
  assert.equal(porch.roof.position.x, 4.820947043446451, 'the authored roof remains central')
  assert.equal(porch.roof.supportWidth, 3.100000086892902)
  const { cuts } = buildBuildingRoomVolumes(floors, roofs)
  const geometries = createRoofAssemblyGeometries({ resolved: porch.resolved,
    abuttingWalls: porch.abuttingWalls, roomCuts: cuts })
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometries.top, material)
  mesh.position.set(porch.roof.position.x, porch.floorTopElevation, porch.roof.position.y)
  mesh.updateMatrixWorld(true)
  for (const z of [16.7, 17, 17.45]) {
    const hits = new Raycaster(new Vector3(3.14, 2.5, z), new Vector3(0, -1, 0)).intersectObject(mesh)
    assert.ok(hits.length, 'the horizontal room fallback must not remove the roof overhang')
    assert.ok(hits[0].point.y < 2.4, 'the wall needs trimming; the roof was not raised to hide it')
  }
  Object.values(geometries).forEach(geometry => geometry.dispose())
  material.dispose()
})

test('saved asymmetric junction roofs produce closed assemblies including chamfers and eave extensions', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofFinishingRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  for (const mounted of [false, true]) {
    if (mounted) floors.flatMap(f => f.roofs ?? []).forEach(r => { delete r.mountSide })
    for (const candidate of resolveBuildingRoofs(floors)) {
      const assembly = constructRoofAssembly({ resolved: candidate.resolved, abuttingWalls: candidate.abuttingWalls })
      if (assembly.faces.length) closed(assembly)
    }
  }
})

test('deep chamfers keep the lowered fascia and soffit closed below the original eave', () => {
  const roof: RoofStructure = { id: 'roof', type: 'up-and-over', width: 4.4, depth: 6.4,
    supportWidth: 4, supportDepth: 6, supportPosition: { x: 0, y: 0 },
    pitchDegrees: 33, position: { x: 0, y: 0 }, rotation: 0,
    overhangSide: 0.2, overhangEnd: 0.2, thickness: 0.04,
    ridgeEndChamfer: { angleDegrees: 33, distance: 4.25 } }
  const resolved = resolveRoofJunctions([roofJunctionInput(roof, 'floor', 3)])[0]
  const assembly = constructRoofAssembly({ resolved })
  closed(assembly)
  const geometries = createRoofAssemblyGeometries({ resolved })
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometries.eaves!, material)
  mesh.position.y = resolved.elevation; mesh.updateMatrixWorld()
  const slope = Math.tan(33 * Math.PI / 180)
  const endHeight = 3 + 2 * slope - 4.25 * slope
  for (const x of [-1.9, 0, 1.9]) {
    const hit = new Raycaster(new Vector3(x, endHeight - 0.1, 4), new Vector3(0, 0, -1)).intersectObject(mesh)[0]
    assert.ok(hit && Math.abs(hit.point.z - 3.2) < 1e-5, 'fascia follows the lowered chamfer along its end')
  }
  for (const x of [-2.1, 2.1]) {
    const hit = new Raycaster(new Vector3(x, 0, 3.1), new Vector3(0, 1, 0)).intersectObject(mesh)[0]
    assert.ok(hit && hit.point.y < 2, 'the lowered chamfer retains a soffit across each side overhang')
  }
  Object.values(geometries).forEach(g => g.dispose()); material.dispose()
})

test('joined saved assemblies retain a closed shared boundary after room cuts', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofFinishingRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors), roomCuts = buildBuildingRoomVolumes(floors, roofs).cuts
  for (const floor of floors) {
    const inputs = roofs.filter(r => r.floorId === floor.id).map(r => ({ resolved: r.resolved, abuttingWalls: r.abuttingWalls, roomCuts }))
    if (!inputs.length) continue
    const assembly = constructJoinedRoofAssembly(inputs)
    closed(assembly)
    const reversed = constructJoinedRoofAssembly([...inputs].reverse())
    closed(reversed)
    assert.deepEqual(reversed.faces, assembly.faces, 'material ownership and geometry are independent of input order')
  }
})

test('near-level chamfer and side eaves share a flat soffit through both corners', () => {
  for (const end of [-1, 1]) {
    const roof: RoofStructure = { id: 'roof', type: 'up-and-over', width: 4.4, depth: 6.4,
      supportWidth: 4, supportDepth: 6, supportPosition: { x: 0, y: 0 },
      pitchDegrees: 45, position: { x: 0, y: 0 }, rotation: 0,
      overhangSide: 0.2, overhangEnd: 0.2, thickness: 0.04,
      [end < 0 ? 'ridgeStartChamfer' : 'ridgeEndChamfer']: { angleDegrees: 30, distance: 2.16 / Math.tan(Math.PI / 6) } }
    const resolved = resolveRoofJunctions([roofJunctionInput(roof, 'floor', 0)])[0]
    closed(constructRoofAssembly({ resolved }))
    const geometries = createRoofAssemblyGeometries({ resolved })
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometries.eaves!, material)
    mesh.updateMatrixWorld()
    for (const side of [-1, 1]) for (const distance of [1.95, 2.01, 2.05, 2.15, 2.19]) {
      const x = side * distance
      const bottom = -0.2 - 0.04 - 0.16
      const hits = (y: number) => new Raycaster(new Vector3(x, y, end * 3.3),
        new Vector3(0, 0, -end), 0, 0.10001).intersectObject(mesh)
      assert.ok(hits(bottom + 0.005).length, `fascia reaches its bottom at ${x}`)
      assert.equal(hits(bottom - 0.005).length, 0, `no hanging fascia step at ${x}`)
      for (const z of [3.01, 3.1, 3.19]) {
        const hit = new Raycaster(new Vector3(x, -1, end * z), new Vector3(0, 1, 0)).intersectObject(mesh)[0]
        assert.ok(hit && Math.abs(hit.point.y - bottom) < 1e-6, 'the complete soffit is level, including its rear edge')
      }
    }
    Object.values(geometries).forEach(g => g.dispose()); material.dispose()
  }
})

test('coplanar adjacent roofs share tile coordinates across their ownership boundary', () => {
  const make = (id: string, z: number) => roofJunctionInput({ id, type: 'lean-to', width: 4, depth: 4,
    pitchDegrees: 30, position: { x: 0, y: z }, rotation: 0 }, 'floor', 3)
  const resolved = resolveRoofJunctions([make('a', 0), make('b', 4)])
  const geometries = createJoinedRoofAssemblyGeometries(resolved.map(r => ({ resolved: r })))
  const edgeUvs = resolved.map(r => {
    const geometry = geometries.get(r.roof.id)!.top, p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    const entries = new Map<string, number[]>()
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i) + r.roof.position.y - 2) < 1e-6)
      entries.set(p.getX(i).toFixed(6), [uv.getX(i), uv.getY(i)])
    return entries
  })
  assert.ok(edgeUvs[0].size >= 2)
  for (const [key, uv] of edgeUvs[0]) assert.deepEqual(uv, edgeUvs[1].get(key))
  geometries.forEach(parts => Object.values(parts).forEach(g => g.dispose()))
})

test('a chamfer reaching the wall top has continuous end fascia, including the joined corner', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofAssemblyRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors), roomCuts = buildBuildingRoomVolumes(floors, roofs).cuts
  const inputs = roofs.filter(r => r.floorId === floors[1].id).map(r => ({ resolved: r.resolved, abuttingWalls: r.abuttingWalls, roomCuts }))
  const assembly = constructJoinedRoofAssembly(inputs)
  closed(assembly)
  assert.deepEqual(constructJoinedRoofAssembly([...inputs].reverse()).faces, assembly.faces)
  const sharedSlope = assembly.faces.filter(face => face.tag.endsWith('/top') &&
    Math.abs(face.plane[0] - 0.4694715627864) < 1e-7 && Math.abs(face.plane[3] - 4.7978) < 0.001)
  assert.equal(new Set(sharedSlope.map(face => face.tag)).size, 2, 'both roofs retain their selectable tile faces')
  for (const face of sharedSlope) for (let axis = 0; axis < 4; axis++)
    assert.ok(Math.abs(face.plane[axis] - sharedSlope[0].plane[axis]) < 1e-10, 'joined skins lie on one exact plane')
  const geometries = createJoinedRoofAssemblyGeometries(inputs)
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const meshes = inputs.map(({ resolved: r }) => {
    const mesh = new Mesh(geometries.get(r.roof.id)!.eaves!, material)
    mesh.position.set(r.roof.position.x, r.elevation + (r.roof.heightOffset ?? 0), r.roof.position.y)
    mesh.rotation.y = r.roof.rotation; mesh.updateMatrixWorld()
    return mesh
  })
  const chamfer = roofs.find(r => r.roof.asymmetricSides)!.resolved
  const endX = roofToWorld(chamfer.roof, chamfer.elevation, [0, 0, chamfer.extents.maxY])[0]
  for (const z of [10.5, 11.5, 12.5, 13.5, 14.5, 15.74, 15.75, 15.8, 15.85, 15.94, 16]) {
    const hit = new Raycaster(new Vector3(-2, 4.88, z), new Vector3(1, 0, 0), 0, 1.5).intersectObjects(meshes)[0]
    assert.ok(hit, `end fascia remains at ${z}`)
    assert.ok(Math.abs(hit.point.x - endX) < 1e-5)
  }
  for (const z of [16.35, 16.45, 16.55, 16.65]) {
    const hits = new Raycaster(new Vector3(-2, 4.6, z), new Vector3(1, 0, 0), 0, 1.4).intersectObjects(meshes)
    assert.equal(hits.length, 0, 'the hidden lower slope leaves no isolated fascia below the joined roof')
  }
  assert.ok(!assembly.faces.some(face => face.tag.endsWith('/top') && face.points.some(p =>
    p[0] < -0.6271027 && p[1] < 4.79 && p[2] > 16.32 && p[2] < 16.71)),
  'shared support at the upper slope cannot retain a lower tile fragment')
  const shells = inputs.map(({ resolved: r }) => {
    const mesh = new Mesh(geometries.get(r.roof.id)!.shell, material)
    mesh.position.set(r.roof.position.x, r.elevation + (r.roof.heightOffset ?? 0), r.roof.position.y)
    mesh.rotation.y = r.roof.rotation; mesh.updateMatrixWorld()
    return mesh
  })
  for (const z of [16.1, 16.2, 16.25]) {
    const hits = new Raycaster(new Vector3(-2, 4.82, z), new Vector3(1, 0, 0), 0, 1.3).intersectObjects(shells)
    assert.equal(hits.length, 0, 'tile shell cannot replace the fascia finish at the joined edge')
  }
  geometries.forEach(parts => Object.values(parts).forEach(g => g.dispose()))
  material.dispose()
})

for (const matchOverhang of [false, true]) {
test(`the saved mounted roof keeps a closed fascia with ${matchOverhang ? 'explicitly matched' : 'continuous side-pitch'} overhangs`, () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofAssemblyRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  if (matchOverhang) {
    const source = floors.flatMap(f => f.roofs ?? []).find(r => r.asymmetricSides)!
    const target = floors.flatMap(f => f.roofs ?? []).find(r => r.id === source.ridgeHeightTargetRoofId)!
    source.overhangPitchDegrees = target.overhangPitchDegrees ?? target.pitchDegrees
  }
  const before = JSON.stringify(floors)
  const roofs = resolveBuildingRoofs(floors)
  const mounted = roofs.find(r => r.roof.asymmetricSides)!.resolved
  const target = roofs.find(r => r.roof.id === mounted.roof.ridgeHeightTargetRoofId)!.resolved
  const edgeHeight = mounted.elevation + getPitchedRoofHeightAtX(mounted.roof, mounted.support, mounted.extents.minX)
  const targetHeight = target.elevation + getPitchedRoofHeightAtX(target.roof, target.support, target.extents.minX)
  assert.ok(Math.abs(edgeHeight - targetHeight) < 1e-9, 'nearby outer tile edges meet at one height regardless of pitch')
  const roomCuts = buildBuildingRoomVolumes(floors, roofs).cuts
  const inputs = roofs.filter(r => r.floorId === floors[1].id).map(r => ({ resolved: r.resolved, abuttingWalls: r.abuttingWalls, roomCuts }))
  const assembly = constructJoinedRoofAssembly(inputs)
  closed(assembly)
  const fasciaBottom = edgeHeight - 0.04 - 0.16
  const edgeZ = mounted.roof.position.y + mounted.extents.minX
  const fascia = assembly.faces.filter(face => face.tag.endsWith('/eaves') &&
    face.points.every(p => Math.abs(p[2] - edgeZ) < 1e-7))
  assert.ok(fascia.length > 0)
  assert.ok(fascia.every(face => face.points.every(p => p[1] >= fasciaBottom - 1e-7)), 'no fascia hangs below the shared bottom')
  assert.equal(JSON.stringify(floors), before, 'saved roof settings remain unchanged')
})
}

for (const fixture of ['red_house_material_regions', 'springfield_13']) {
  test(`${fixture} remains closed when constructed with its room and slab cuts`, () => {
    const { floors } = JSON.parse(readFileSync(new URL(`./fixtures/roof-junctions/${fixture}.json`, import.meta.url), 'utf8')) as { floors: FloorLevel[] }
    const roofs = resolveBuildingRoofs(floors), roomCuts = buildBuildingRoomVolumes(floors, roofs).cuts
    for (const floor of floors) {
      const inputs = roofs.filter(r => r.floorId === floor.id).map(r => ({ resolved: r.resolved, abuttingWalls: r.abuttingWalls, roomCuts }))
      if (inputs.length) closed(constructJoinedRoofAssembly(inputs))
    }
  })
}
