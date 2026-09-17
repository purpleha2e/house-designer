import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { Mesh, MeshBasicMaterial, Raycaster, Vector3, DoubleSide } from 'three'
import type { FloorLevel, RoofStructure } from '../src/types.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { roofBoundsPolygon, roofJunctionInput, resolveRoofJunctions, roofSurfaceHeights, roofToLocal, roofToWorld, type ResolvedRoof } from '../src/roofJunctions.ts'
import { createSolidRoofGeometryFromFaces, partitionRoofFacesByRooms, splitRoofUndersideFaces } from '../src/roofSolidGeometry.ts'
import { clipRoofShellAtJunctions } from '../src/roofShellClipping.ts'
import { getRoofThickness } from '../src/roofThickness.ts'

function solid(roof: ResolvedRoof, others: ResolvedRoof[]) {
  const result = createSolidRoofGeometryFromFaces(roof.structuralFaces.map(f => f.map(p => roofToLocal(roof.roof, roof.elevation, p))), undefined, getRoofThickness(roof.roof))
  for (const part of ['shell', 'underside'] as const) {
    const raw = result[part]
    result[part] = clipRoofShellAtJunctions(raw, roof, others)
    if (raw !== result[part]) raw.dispose()
  }
  return result
}

function worldMesh(geometry: ReturnType<typeof solid>['shell'], roof: ResolvedRoof) {
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
  mesh.position.fromArray(roofToWorld(roof.roof, roof.elevation, [0, 0, 0]))
  mesh.rotation.y = roof.roof.rotation
  mesh.updateMatrixWorld()
  return mesh
}

test('roof underside finish stops at the support while exterior overhang becomes soffit', () => {
  const roof: RoofStructure = {
    id: 'gable', type: 'up-and-over', position: { x: 0, y: 0 },
    supportPosition: { x: 0, y: 0 }, supportWidth: 4, supportDepth: 4,
    width: 4.6, depth: 4.6, overhangEnd: 0.3, overhangSide: 0.3,
    rotation: 0, pitchDegrees: 35, thickness: 0.2,
  }
  const [resolved] = resolveRoofJunctions([roofJunctionInput(roof, 'floor', 2.4)])
  const split = splitRoofUndersideFaces(resolved.structuralFaces, roofBoundsPolygon(resolved, resolved.support))
  assert.ok(roofSurfaceHeights(split.undersideFaces, { x: 0.5, y: 0 }).length,
    'the supported ceiling remains part of the selectable underside')
  assert.equal(roofSurfaceHeights(split.soffitFaces, { x: 0.5, y: 0 }).length, 0)
  assert.ok(roofSurfaceHeights(split.soffitFaces, { x: 0.5, y: 2.15 }).length,
    'the gable-end overhang is an exterior soffit')
  assert.equal(roofSurfaceHeights(split.undersideFaces, { x: 0.5, y: 2.15 }).length, 0,
    'interior material cannot reach the exterior overhang')
})

test('two rooms carve one continuous interior roof skin and leave the exterior overhang', () => {
  const face: [number, number, number][] = [[0, 3, 0], [4, 3, 0], [4, 3, 2], [0, 3, 2]]
  const rooms = [
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
    [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
  ]
  const { inside, outside } = partitionRoofFacesByRooms([face], rooms)
  for (const x of [0.5, 1.99, 2.01, 2.5]) {
    assert.ok(roofSurfaceHeights(inside, { x, y: 1 }).length, `room ceiling missing at x=${x}`)
    assert.equal(roofSurfaceHeights(outside, { x, y: 1 }).length, 0)
  }
  assert.equal(roofSurfaceHeights(inside, { x: 3.5, y: 1 }).length, 0)
  assert.ok(roofSurfaceHeights(outside, { x: 3.5, y: 1 }).length)
})

test('a concave room leaves its notch as an exterior soffit', () => {
  const face: [number, number, number][] = [[0, 3, 0], [3, 3, 0], [3, 3, 3], [0, 3, 3]]
  const room = [
    { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 },
    { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 },
  ]
  const { inside, outside } = partitionRoofFacesByRooms([face], [room])
  assert.ok(roofSurfaceHeights(inside, { x: 0.5, y: 2 }).length)
  assert.ok(roofSurfaceHeights(inside, { x: 2, y: 0.5 }).length)
  assert.equal(roofSurfaceHeights(inside, { x: 2, y: 2 }).length, 0)
  assert.ok(roofSurfaceHeights(outside, { x: 2, y: 2 }).length)
})

test('roof shell excludes an authored perimeter once the visible roof no longer reaches it', () => {
  const structuralFace = [[0, 1, 0], [2, 1, 0], [2, 1, 2], [0, 1, 2]] as [number, number, number][]
  const visibleFace = [[0, 1, 0], [1, 1, 0], [1, 1, 2], [0, 1, 2]] as [number, number, number][]
  const geometry = createSolidRoofGeometryFromFaces([visibleFace], undefined, 0.2, [structuralFace])
  const positions = geometry.shell.getAttribute('position')
  for (let index = 0; index < positions.count; index++) {
    assert.ok(positions.getX(index) <= 1 + 1e-8, 'a fully concealed fascia must not remain on the old perimeter')
  }
  Object.values(geometry).forEach(part => part.dispose())
})

test('soffit follows the visible roof while the room-side underside remains structural', () => {
  const structuralFace = [[0, 1, 0], [2, 1, 0], [2, 1, 2], [0, 1, 2]] as [number, number, number][]
  const visibleFace = [[0, 1, 0], [1, 1, 0], [1, 1, 2], [0, 1, 2]] as [number, number, number][]
  const support = [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.75, y: 1.75 }, { x: 0.25, y: 1.75 }]
  const split = splitRoofUndersideFaces([structuralFace], support, [visibleFace])
  assert.ok(split.undersideFaces.some(face => face.some(([x]) => x >= 0.75)), 'the interior ceiling keeps its structural coverage')
  assert.ok(split.soffitFaces.every(face => face.every(([x]) => x <= 1 + 1e-8)), 'concealed roof cannot leave a shadow-casting soffit')
})

test('Red House junction has no extruded cut edge and a continuous underside at the former strip', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/red_house_material_regions.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors).map(r => r.resolved)
  const vault = roofs.find(r => r.roof.id.startsWith('b490'))!
  const clipped = solid(vault, roofs)
  const shell = worldMesh(clipped.shell, vault)
  const underside = worldMesh(clipped.underside, vault)
  const original = createSolidRoofGeometryFromFaces(vault.faces.map(f => f.map(p => roofToLocal(vault.roof, vault.elevation, p))), undefined, getRoofThickness(vault.roof))
  const oldShell = worldMesh(original.shell, vault)
  const ray = new Raycaster(new Vector3(3.4, 4.3, 5), new Vector3(1.4261105077 - 3.4, 5.0063353278 - 4.3, 5.6527147325 - 5).normalize())
  assert.ok(ray.intersectObject(oldShell).length, 'reproduces the thickness strip in the old extruded top boundary')
  assert.equal(ray.intersectObject(shell).length, 0, 'the cut line is not a perimeter edge')
  const adjoining = roofs.filter(r => r !== vault).map(r => ({ roof: r, geometry: solid(r, roofs) }))
  const ceilings = [underside, ...adjoining.map(r => worldMesh(r.geometry.underside, r.roof))]
  // Sample the narrow region formerly missing between the two extruded skins.
  for (const z of [5.62, 5.63, 5.64, 5.65, 5.66]) {
    const hits = new Raycaster(new Vector3(1.48, 4.8, z), new Vector3(0, 1, 0)).intersectObjects(ceilings)
    assert.ok(hits.length && hits[0].point.y < 5.1, `ceiling remains continuous at z=${z}`)
  }
  // A neighbouring eave must not replace even a narrow piece of this room's
  // ceiling. Checking the combined skins alone missed the notch from above.
  const raw = createSolidRoofGeometryFromFaces(vault.structuralFaces.map(f => f.map(p => roofToLocal(vault.roof, vault.elevation, p))), undefined, getRoofThickness(vault.roof))
  const rawUnderside = worldMesh(raw.underside, vault)
  for (const x of [1.351, 1.38, 1.42, 1.46, 1.48, 1.5, 1.52]) {
    for (const centerZ of [3.75, 5.65]) {
      for (let offset = -10; offset <= 10; offset++) {
        const z = centerZ + offset * 0.01
        const probe = new Raycaster(new Vector3(x, 4.3, z), new Vector3(0, 1, 0))
        const expected = probe.intersectObject(rawUnderside)[0]
        const actual = probe.intersectObject(underside)[0]
        assert.ok(expected, `fixture has an uninterrupted ceiling at ${x},${z}`)
        assert.ok(actual && Math.abs(actual.point.y - expected.point.y) < 1e-5,
          `adjoining overhang must not notch the vaulted underside at ${x},${z}`)
      }
    }
  }
  Object.values(raw).forEach(g => g.dispose())
  rawUnderside.material.dispose()
  for (const geometry of Object.values(clipped)) {
    assert.ok([...geometry.getAttribute('normal').array, ...geometry.getAttribute('uv').array].every(Number.isFinite))
    geometry.dispose()
  }
  adjoining.forEach(r => Object.values(r.geometry).forEach(g => g.dispose()))
  ceilings.slice(1).forEach(m => m.material.dispose())
  Object.values(original).forEach(g => g.dispose())
  ;[shell, underside, oldShell].forEach(m => m.material.dispose())
})

for (const type of ['flat', 'hip', 'lean-to', 'up-and-over', 'bay'] as const) {
  test(`${type} has a separate downward-facing underside at its configured thickness`, () => {
    const roof: RoofStructure = { id: type, type, position: { x: 0, y: 0 }, width: 4, depth: 4, rotation: 0, pitchDegrees: 35, thickness: 0.3 }
    const [resolved] = resolveRoofJunctions([roofJunctionInput(roof, 'floor', 2.4)])
    const geometry = solid(resolved, [resolved])
    const top = worldMesh(geometry.top, resolved), bottom = worldMesh(geometry.underside, resolved)
    const ray = new Raycaster(new Vector3(0.5, 0, 0.5), new Vector3(0, 1, 0))
    const upper = ray.intersectObject(top)[0], lower = ray.intersectObject(bottom)[0]
    assert.ok(upper && lower)
    assert.ok(Math.abs(upper.point.y - lower.point.y - 0.3) < 1e-5)
    assert.ok(lower.face!.normal.y < 0)
    const normals = geometry.shell.getAttribute('normal')
    for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(normals.getY(i)) < 1e-8)
    Object.values(geometry).forEach(g => g.dispose())
    top.material.dispose(); bottom.material.dispose()
  })
}
