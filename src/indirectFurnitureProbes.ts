import { Box3, Vector3 } from 'three'
import { INDIRECT_ATLAS_SIZE, INDIRECT_MAX_LOCAL_LIGHTS, writeIndirectPosition, type IndirectField } from './indirectLighting.ts'
import type { IndirectVisibility } from './indirectVisibility.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'

export const INDIRECT_FURNITURE_PROBE_VERSION = 1
const SPACING = .75, MAX_ADDITIONAL_PROBES = 128

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
      if (added >= MAX_ADDITIONAL_PROBES || index >= limit) break
      origin.set(box.min.x + (x + .5) / nx * (box.max.x - box.min.x), floor.elevation + .04,
        box.min.z + (z + .5) / nz * (box.max.z - box.min.z))
      const region = field.regions.find(region => region.floorId === floor.id && pointIsInsideRoomPolygon({ x: origin.x, y: origin.z }, region.polygon))
      if (!region) continue
      const hit = visibility.hit(origin, up, .76)
      // An upward-facing exit is a solid plinth, not a gap under furniture.
      if (!hit?.face || hit.face.normal.y > -.5 || hit.distance < .10) continue
      origin.y = Math.min(floor.elevation + .18, floor.elevation + .012 + (hit.point.y - floor.elevation - .012) * .45)
      if (directions.some(direction => visibility.distance(origin, direction, .05) < .05)) continue
      if (field.probes.some(probe => {
        if (probe.region.floorId !== floor.id || probe.position.distanceToSquared(origin) >= .5 ** 2) return false
        direction.subVectors(origin, probe.position)
        const distance = direction.length()
        return distance < .001 || visibility.distance(probe.position, direction.multiplyScalar(1 / distance), distance - .001) >= distance - .001
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
