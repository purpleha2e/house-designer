import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import type { FloorLevel } from '../src/types.ts'
import { resolveBuildingRoofs } from '../src/roofBuildingGeometry.ts'
import { roofToLocal, roofToWorld } from '../src/roofJunctions.ts'
import { getRoofThickness } from '../src/roofThickness.ts'
import { createUpAndOverEavesGeometry } from '../src/roofEavesGeometry.ts'
import { clipEavesInsideAdjoiningRoofs } from '../src/roofEavesClipping.ts'
import { roofFacePlanes } from '../src/wallEngine/wallRoofClip.ts'

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
