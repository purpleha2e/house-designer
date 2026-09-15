import type { BufferGeometry } from 'three'
import { clipRoofGeometryByVolumes } from './roofAbutmentGeometry.ts'
import { roofToWorld, type ResolvedRoof } from './roofJunctions.ts'
import { roofFacePlanes } from './wallEngine/wallRoofClip.ts'

/** Trim the full soffit box, whose underside can enter a vault even when its top is clipped. */
export function clipEavesInsideAdjoiningRoofs(geometry: BufferGeometry, roof: ResolvedRoof, others: ResolvedRoof[]) {
  const volumes = others.filter(other => other.roof.id !== roof.roof.id).flatMap(other =>
    other.structuralFaces.flatMap(face => {
      const planes = roofFacePlanes(face)
      if (!planes.length) return []
      const above = planes.pop()!
      return [[...planes, (p: [number, number, number]) => -above(p),
        ([, y]: [number, number, number]) => y - other.elevation]]
    }))
  return clipRoofGeometryByVolumes(geometry, volumes, p => roofToWorld(roof.roof, roof.elevation, p))
}
