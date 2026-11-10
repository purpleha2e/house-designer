import { Box3, Vector3 } from 'three'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MAX_LOCAL_LIGHTS, writeIndirectPosition, type IndirectField } from './indirectLighting.ts'
import type { IndirectVisibility } from './indirectVisibility.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'
import {INDIRECT_ADDITIONAL_PROBE_BUDGET,INDIRECT_CONTACT_RADIUS,indirectContactKernel} from './indirectContactProbes.ts'

export const INDIRECT_FURNITURE_PROBE_VERSION = 2
const SPACING = .75, MAX_ADDITIONAL_PROBES = INDIRECT_ADDITIONAL_PROBE_BUDGET

/** Raised furniture hides the normal probe layers from the floor. Capture the
 * actual radiance in its open underside instead of treating missing data as black.
 * Boxes restrict placement work; actual triangles determine clearance. */
export function addIndirectFurnitureProbes(field: IndirectField, boxes: Box3[], visibility: IndirectVisibility) {
  const used = new Set(field.probes.map(probe => probe.index)), limit = INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS
  // Keep regular-grid and room-centre slots stable across opening edits.
  let index = Math.max(field.floors.length * field.n * field.n * 2, ...used, 0) + 1, added = 0
  const up = new Vector3(0, 1, 0), origin = new Vector3(), direction = new Vector3()
  const directions = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), up, new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
  // Authoring order should not change atlas identity during incremental bakes.
  const ordered = [...boxes].sort((a, b) => a.min.y - b.min.y || a.min.x - b.min.x || a.min.z - b.min.z || a.max.x - b.max.x || a.max.z - b.max.z)
  for (const floor of field.floors) for (const box of ordered) {
    if (box.max.y <= floor.elevation + .14 || box.min.y >= floor.elevation + .8) continue
    const nx = Math.max(1, Math.ceil((box.max.x - box.min.x) / SPACING)), nz = Math.max(1, Math.ceil((box.max.z - box.min.z) / SPACING))
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      if (field.probes.filter(p=>p.kind).length >= MAX_ADDITIONAL_PROBES || index >= limit) break
      origin.set(box.min.x + (x + .5) / nx * (box.max.x - box.min.x), floor.elevation + .04,
        box.min.z + (z + .5) / nz * (box.max.z - box.min.z))
      const region = field.regions.find(region => region.floorId === floor.id && pointIsInsideRoomPolygon({ x: origin.x, y: origin.z }, region.polygon))
      if (!region) continue
      const hit = visibility.hit(origin, up, .76)
      // An upward-facing exit is a solid plinth, not a gap under furniture.
      if (!hit?.face || hit.face.normal.y > (field.contactLighting?-.01:-.5) || hit.distance < .10) continue
      origin.y = Math.min(floor.elevation + .18, floor.elevation + .012 + (hit.point.y - floor.elevation - .012) * (field.contactLighting?.5:.45))
      if (directions.some(direction => visibility.distance(origin, direction, .05) < .05)) continue
      if (field.probes.some(probe => {
        if (probe.region.floorId !== floor.id || probe.position.distanceToSquared(origin) >= .5 ** 2) return false
        direction.subVectors(origin, probe.position)
        const distance = direction.length()
        return distance < .001 || (probe.kind==='contact'?!visibility.occluded(probe.position,direction.multiplyScalar(1/distance),distance-.001,.0001):visibility.distance(probe.position, direction.multiplyScalar(1 / distance), distance - .001) >= distance - .001)
      })) continue
      while (used.has(index) && index < limit) index++
      if (index >= limit) break
      const position = origin.clone()
      field.probes.push({ index, position, region, kind: 'floor' }); used.add(index)
      writeIndirectPosition(field.positionData, index++, position); added++
    }
  }
  field.floorProbeLayoutVersion = INDIRECT_FURNITURE_PROBE_VERSION
  field.positions.needsUpdate = true
  return added
}

/** Open doors and tall furniture can hide a pocket of floor from every regular
 * probe, even when there is no horizontal underside. Missing measurements are
 * not contact shadows: capture those pockets before building the floor layer. */
export function addIndirectFloorCoverageProbes(field: IndirectField, boxes: Box3[], visibility: IndirectVisibility) {
  const limit = INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS
  let index = Math.max(field.floors.length * field.n * field.n * 2, ...field.probes.map(p => p.index), 0) + 1
  let added = 0, floorProbes = field.probes.filter(p => p.kind).length
  const radiusSquared = (field.spacing * 1.75) ** 2, point = new Vector3(), direction = new Vector3()
  const axes = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]
  const visited = new Set<string>(), step = .25
  const ordered = [...boxes].sort((a, b) => a.min.y - b.min.y || a.min.x - b.min.x || a.min.z - b.min.z || a.max.x - b.max.x || a.max.z - b.max.z)
  for (const floor of field.floors) for (const box of ordered) {
    if (box.max.y <= floor.elevation + .14 || box.min.y >= floor.elevation + .8) continue
    for (let z = Math.ceil((box.min.z - .75) / step); z <= Math.floor((box.max.z + .75) / step); z++) {
      for (let x = Math.ceil((box.min.x - .75) / step); x <= Math.floor((box.max.x + .75) / step); x++) {
        if (floorProbes >= MAX_ADDITIONAL_PROBES || index >= limit) { field.positions.needsUpdate = true; return added }
        const key = `${floor.id}:${x}:${z}`
        if (visited.has(key)) continue
        visited.add(key); point.set(x * step, floor.elevation + .016, z * step)
        const region = field.regions.find(r => r.floorId === floor.id && pointIsInsideRoomPolygon({ x: point.x, y: point.z }, r.polygon))
        if (!region) continue
        let support = 0
        // Geometry alone determines coverage; new probes have not been captured
        // yet and must still prevent duplicate placement in the same pocket.
        for (const probe of field.probes) {
          direction.subVectors(point, probe.position)
          const distanceSquared = direction.lengthSq()
          const contact=probe.kind==='contact'
          if (distanceSquared >= (contact?INDIRECT_CONTACT_RADIUS**2:radiusSquared)) continue
          const distance = Math.sqrt(distanceSquared)
          const near=contact?.0001:.025
          if (distance > near && visibility.occluded(probe.position, direction.multiplyScalar(1 / distance), distance - .001,near)) continue
          support += contact?indirectContactKernel(distanceSquared):(1 - distanceSquared / radiusSquared) ** 2
          if (support >= .1) break
        }
        if (support >= .1) continue
        const position = point.clone(); position.y = floor.elevation + .18
        // Require a clear path to the floor and clearance on every side. The
        // first outward-facing hit identifies a candidate inside solid geometry.
        if (visibility.occluded(point, axes[2], .164 - .001)) continue
        // Architectural ceilings may be double-sided sheets with an upward
        // normal. Only use an outward top face to reject points that are
        // actually inside a furniture bound, before that bound's upper edge.
        if (ordered.some(bounds => {
          if (!bounds.containsPoint(position)) return false
          const above = visibility.hit(position, axes[2], bounds.max.y - position.y + .001)
          return !!above?.face && above.face.normal.y > .001
        })) continue
        if (axes.some(axis => {
          const hit = visibility.hit(position, axis, .3)
          return !!hit && (hit.distance < .05 || (hit.face?.normal.dot(axis) ?? 0) > .001)
        })) continue
        field.probes.push({ index, position, region, kind: 'floor' })
        writeIndirectPosition(field.positionData, index++, position); added++; floorProbes++
      }
    }
  }
  field.positions.needsUpdate = true
  return added
}
