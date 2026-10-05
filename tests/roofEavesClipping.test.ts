import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import type { FloorLevel } from '../src/types.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { roofToLocal, roofToWorld, roofSurfaceHeights } from '../src/roofJunctions.ts'
import { getRoofThickness } from '../src/roofThickness.ts'
import { createUpAndOverEavesGeometry } from '../src/roofEavesGeometry.ts'
import { clipEavesInsideAdjoiningRoofs, clipEavesAtJoinedRoofs } from '../src/roofEavesClipping.ts'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3 } from 'three'
import { roofFacePlanes } from '../src/wallEngine/wallRoofClip.ts'

test('unequal joined eaves have continuous fascia without an internal hanging strip', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roofFinishingRegression.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors).map(r => r.resolved)
  const pair = roofs.filter(r => r.roof.id.startsWith('8e321') || r.roof.id.startsWith('b46c'))
  const meshes = pair.map(roof => {
    const raw = createUpAndOverEavesGeometry(roof.roof, roof.support, roof.extents,
      roof.faces.map(face => face.map(p => roofToLocal(roof.roof, roof.elevation, p))), getRoofThickness(roof.roof))!
    const clipped = clipEavesAtJoinedRoofs(raw, roof)
    const p = clipped.getAttribute('position')
    const positions = Array.from({ length: p.count }, (_, i) =>
      roofToWorld(roof.roof, roof.elevation, [p.getX(i), p.getY(i), p.getZ(i)])).flat()
    assert.ok(positions.every(Number.isFinite))
    const mesh = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)),
      new MeshBasicMaterial({ side: DoubleSide }))
    if (clipped !== raw) clipped.dispose()
    raw.dispose()
    return mesh
  })
  const hit = (y: number, z: number) => new Raycaster(new Vector3(1, y, z), new Vector3(1, 0, 0), 0, 1).intersectObjects(meshes)[0]
  const target = pair.find(r => r.roof.asymmetricSides)!
  for (const z of [8.5, 9.2, 9.4, 9.7]) {
    const height = Math.max(...pair.flatMap(r => roofSurfaceHeights(r.faces, { x: 1.380552174, y: z })))
    assert.ok(hit(height - 0.12, z), `fascia continues along the outside edge at ${z}`)
  }
  assert.ok(target.joinedEaveFaces!.length)
  assert.ok(!hit(4.9, 9.95), 'the old low fascia cannot hang beneath the joined roof')
  meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose() })
})

test('red house soffit boxes stop outside the adjoining vaulted roof space', () => {
  const { floors } = JSON.parse(readFileSync(new URL('./fixtures/roof-junctions/red_house_material_regions.json', import.meta.url), 'utf8')) as { floors: FloorLevel[] }
  const roofs = resolveBuildingRoofs(floors).map(r => r.resolved)
  const roof = roofs.find(r => r.roof.id.startsWith('70fb'))!
  const vault = roofs.find(r => r.roof.id.startsWith('b490'))!
  const original = createUpAndOverEavesGeometry(roof.roof, roof.support, roof.resolvedExtents,
    roof.faces.map(f => f.map(p => roofToLocal(roof.roof, roof.elevation, p))), getRoofThickness(roof.roof))!
  const clipped = clipEavesInsideAdjoiningRoofs(original, roof, roofs)
  const volumes = vault.structuralFaces.map(face => {
    const planes = roofFacePlanes(face), above = planes.pop()!
    return [...planes, (p: [number,number,number]) => -above(p)]
  })
  const insideCount = (geometry: typeof original) => {
    const p = geometry.getAttribute('position')
    let count = 0
    for (let i = 0; i < p.count; i += 3) {
      const center = [0,1,2].map(axis => [0,1,2].reduce((sum, offset) => sum + p.getComponent(i+offset, axis)/3, 0)) as [number,number,number]
      const world = roofToWorld(roof.roof, roof.elevation, center)
      if (world[1] > vault.elevation && volumes.some(planes => planes.every(plane => plane(world) > 1e-5))) count++
    }
    return count
  }
  assert.ok(insideCount(original) > 0, 'fixture reproduces soffits inside the vault')
  assert.equal(insideCount(clipped), 0)
  assert.ok(clipped.getAttribute('position').count > 0, 'exterior soffits remain')
  assert.ok([...clipped.getAttribute('uv').array, ...clipped.getAttribute('normal').array].every(Number.isFinite))
  original.dispose(); clipped.dispose()
})
