import type { BufferGeometry } from 'three'
import { clipRoofGeometryByVolumes } from './roofAbutmentGeometry.ts'
import { roofBoundsPolygon, roofToWorld, type ResolvedRoof } from './roofJunctions.ts'
import { getRoofThickness } from './roofThickness.ts'
import { footprintPlanes, roofFacePlanes, type ClipPlane } from './wallEngine/wallRoofClip.ts'

/** Clip the original solid's underside and perimeter, rather than extruding cut top edges.
 * A top intersection is not an exposed thickness edge. Below an overhang the
 * underside can continue underneath that intersection until it meets the other solid.
 */
export function clipRoofShellAtJunctions(geometry: BufferGeometry, roof: ResolvedRoof, others: ResolvedRoof[]) {
  const volumes: ClipPlane[][] = []
  for (const target of others) {
    if (target.roof.id === roof.roof.id) continue
    const bounds = { ...target.support }
    if (target.resolvedExtents.minY < target.extents.minY) bounds.minY = target.resolvedExtents.minY
    if (target.resolvedExtents.maxY > target.extents.maxY) bounds.maxY = target.resolvedExtents.maxY
    if (target.roof.type === 'up-and-over' && roof.connections.some(c => c.state === 'joined' && c.targetRoofId === target.roof.id)) {
      bounds.minY = Math.min(target.resolvedExtents.minY, target.support.minY)
      bounds.maxY = Math.max(target.resolvedExtents.maxY, target.support.maxY)
    }
    const building = footprintPlanes(roofBoundsPolygon(target, bounds))
    const thickness = getRoofThickness(target.roof)
    for (const face of target.structuralFaces) {
      const planes = roofFacePlanes(face)
      if (!planes.length) continue
      const above = planes.pop()!
      const below: ClipPlane = p => -above(p) - thickness - 0.000001
      // Meet underside to underside. Using the top plane would cut a second
      // thickness-wide notch out of the interior ceiling at every junction.
      // Only the supported footprint encloses another roof's interior. An
      // adjoining overhang must not carve its profile into the vaulted ceiling
      // on the room side of that footprint's wall.
      volumes.push([...planes, ...building, below])
    }
  }
  return clipRoofGeometryByVolumes(geometry, volumes, p => roofToWorld(roof.roof, roof.elevation, p))
}
