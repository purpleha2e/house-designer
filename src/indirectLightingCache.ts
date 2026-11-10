import type {IndirectSpatialInterpolation} from './indirectSpatialInterpolation.ts'
import { Vector3 } from 'three'
import { createIndirectProbeObstacles, type IndirectProbeObstacle } from './indirectProbeObstacles.ts'
import { createIndirectField, INDIRECT_ATLAS_SIZE, INDIRECT_MASK_SIZE, INDIRECT_MAX_LOCAL_LIGHTS, serializeIndirectField,
  writeIndirectPosition, type IndirectFloor } from './indirectLighting.ts'
import { createIndirectVisibilityFromSnapshot, writeIndirectVisibility, type IndirectGeometrySnapshot, type IndirectVisibilitySnapshot } from './indirectVisibility.ts'
import { createIndirectVolumeLookup, writeIndirectCeilingRow, writeIndirectVolumeRow,type IndirectInterpolationReuseData } from './indirectVolume.ts'
import { pointIsInsideRoomPolygon } from './roomLightMask.ts'
import { createIndirectFloorLookup, writeIndirectFloorLayer, writeIndirectFloorRow } from './indirectFloorLighting.ts'
import { planIndirectZones, type IndirectZoneChange, type IndirectZoneProbe } from './indirectLightingZones.ts'
import { addIndirectFloorCoverageProbes, addIndirectFurnitureProbes } from './indirectFurnitureProbes.ts'
import {addIndirectContactProbes} from './indirectContactProbes.ts'
import { createIndirectPreviewField } from './indirectLivePreview.ts'
import { createIndirectPreparationTimer, type IndirectPreparationProgress } from './indirectPreparation.ts'
import type { IndirectSHOrder } from './indirectSH.ts'

export const INDIRECT_MIN_PROBE_SPACING = 0.6

/** Relocation can collapse several grid nodes onto one wall inset or clear
 * furniture position. Keep the least-displaced sample, but never combine
 * samples across an occluder or on separate storeys. Atlas indices stay stable. */
export function pruneRedundantIndirectProbes(field: ReturnType<typeof createIndirectField>,
  visibility: Pick<ReturnType<typeof createIndirectVisibilityFromSnapshot>, 'distance'>) {
  const spacing = INDIRECT_MIN_PROBE_SPACING
  const cells = new Map<string, typeof field.probes>()
  const direction = new Vector3()
  const cellKey = (floor: string, x: number, y: number, z: number) => `${floor}:${x}:${y}:${z}`
  const displacement = (probe: typeof field.probes[number]) => {
    const floorIndex = field.floors.findIndex(floor => floor.id === probe.region.floorId)
    const grid = field.grids[floorIndex], slot = probe.index - grid.start
    if (slot < 0 || slot >= 2 * field.n * field.n) return probe.position.distanceToSquared(probe.region.centre)
    const layer = Math.floor(slot / (field.n * field.n)), planar = slot % (field.n * field.n)
    return (probe.position.x - field.bounds.minX - (planar % field.n) * field.spacing) ** 2 +
      (probe.position.z - field.bounds.minZ - Math.floor(planar / field.n) * field.spacing) ** 2 +
      (probe.position.y - (layer ? grid.upper : grid.lower)) ** 2
  }
  const candidates = field.probes.map(probe => ({ probe, moved: displacement(probe) }))
    .sort((a, b) => a.moved - b.moved || a.probe.index - b.probe.index)
  const retained = new Set<number>()
  for (const { probe } of candidates) {
    const { x, y, z } = probe.position, floor = probe.region.floorId
    const cx = Math.floor(x / spacing), cy = Math.floor(y / spacing), cz = Math.floor(z / spacing)
    let redundant = false
    neighbours: for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const other of cells.get(cellKey(floor, cx + dx, cy + dy, cz + dz)) ?? []) {
        direction.subVectors(probe.position, other.position)
        const distance = direction.length()
        if (distance >= spacing) continue
        if (distance < .00001 || visibility.distance(other.position, direction.multiplyScalar(1 / distance), distance) >= distance) {
          redundant = true; break neighbours
        }
      }
    }
    if (redundant) { field.positionData[probe.index * 4 + 3] = 0; continue }
    retained.add(probe.index)
    const key = cellKey(floor, cx, cy, cz), bucket = cells.get(key) ?? []
    bucket.push(probe); cells.set(key, bucket)
  }
  const count = field.probes.length
  field.probes.splice(0, count, ...field.probes.filter(probe => retained.has(probe.index)))
  field.positions.needsUpdate = true
  return count - field.probes.length
}

/** Runs entirely in the GI worker. No renderer, DOM, shader compilation or GPU readbacks. */
export function* prepareIndirectCacheSteps(floors: IndirectFloor[], lights: [number, number, number][],
  geometry: IndirectGeometrySnapshot, obstacles: IndirectProbeObstacle[],
  zones?: { previous: IndirectZoneProbe[]; changes: IndirectZoneChange[]; captureNewOnly?: boolean },
  onProgress?: (progress: IndirectPreparationProgress) => void, previousVisibility?: IndirectVisibilitySnapshot,
  previousInterpolation?:{volume:IndirectInterpolationReuseData;floor:IndirectInterpolationReuseData;preview:IndirectInterpolationReuseData;previewFloor:IndirectInterpolationReuseData}, shOrder: IndirectSHOrder = 1,spatialInterpolation:IndirectSpatialInterpolation='legacy',contactLighting=false) {
  const timer = createIndirectPreparationTimer(onProgress)
  timer.start('layout')
  const field = createIndirectField(floors, lights.length, shOrder,spatialInterpolation,contactLighting)
  timer.start('geometry')
  const visibility = createIndirectVisibilityFromSnapshot(geometry, previousVisibility)
  timer.start('structure')
  const structure = createIndirectVisibilityFromSnapshot(geometry.filter(part => part.structural))
  timer.start('probes')
  const obstacleQuery = createIndirectProbeObstacles(obstacles, visibility), boxes = obstacleQuery.boxes
  const up = new Vector3(0, 1, 0), origin = new Vector3()
  for (const probe of field.probes) {
    if (obstacleQuery.contains(probe.position)) {
      findClearPosition: for (const radius of [.3, .6, 1, 1.5]) for (let direction = 0; direction < 8; direction++) {
        const point = probe.position.clone().add(new Vector3(Math.cos(direction * Math.PI / 4) * radius, 0, Math.sin(direction * Math.PI / 4) * radius))
        if (field.regions.some(region => region.floorId === probe.region.floorId && pointIsInsideRoomPolygon({ x: point.x, y: point.z }, region.polygon)) &&
          !obstacleQuery.contains(point)) { probe.position.copy(point); break findClearPosition }
      }
    }
    origin.set(probe.position.x, probe.region.bottom + .08, probe.position.z)
    const max = Math.max(0, probe.position.y - origin.y), distance = structure.distance(origin, up, max)
    if (distance < max) probe.position.y = Math.max(probe.region.bottom + .12, origin.y + distance - .12)
    writeIndirectPosition(field.positionData, probe.index, probe.position)
  }
  pruneRedundantIndirectProbes(field, visibility)
  if(contactLighting)addIndirectContactProbes(field, boxes.filter((_,i)=>obstacles[i].contact), visibility,obstacles.flatMap(o=>o.seeds??[]))
  addIndirectFurnitureProbes(field, boxes, visibility)
  addIndirectFloorCoverageProbes(field, boxes, visibility)
  timer.start('ceilings')
  for (let row = 0; row < field.floors.length * INDIRECT_MASK_SIZE; row++) writeIndirectCeilingRow(field, row, structure)
  structure.dispose()
  timer.start('lamps')
  const lampPositions = lights.slice(0, INDIRECT_MAX_LOCAL_LIGHTS)
  if (lampPositions.length) yield { field, visibility, lights: lampPositions }
  lampPositions.forEach((light, index) => {
    const position = new Vector3(...light)
    writeIndirectPosition(field.positionData, INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS + index, position)
  })
  timer.start('tables')
  const triangles = visibility.triangleTexture()
  const reusable=(data:IndirectInterpolationReuseData|undefined)=>data&&zones?.changes.length?{previous:data,changes:zones.changes}:undefined
  const lookup = createIndirectVolumeLookup(field, visibility,undefined,reusable(previousInterpolation?.volume))
  const floorLookup = createIndirectFloorLookup(field, visibility,reusable(previousInterpolation?.floor))
  const preview = createIndirectPreviewField(field)
  preview.coefficients = field.coefficients.map(data => data.slice())
  preview.positionData = field.positionData.slice()
  const previewLookup = createIndirectVolumeLookup(preview, visibility,undefined,reusable(previousInterpolation?.preview))
  const previewFloorLookup = createIndirectFloorLookup(preview, visibility,reusable(previousInterpolation?.previewFloor))
  // Release descriptors for old layouts rejected by the compatibility checks.
  // eslint-disable-next-line no-useless-assignment -- The returned closures otherwise retain this generator parameter.
  previousInterpolation=undefined
  timer.start('zones')
  const zonePlan = zones ? planIndirectZones(field, visibility, zones.previous, zones.changes) : undefined
  if (zones?.captureNewOnly && zonePlan && zones.previous.every(previous => field.probes.some(probe =>
    probe.index === previous.index && probe.region.floorId === previous.floorId && probe.position.distanceToSquared(origin.fromArray(previous.position)) < 1e-8))) {
    // Adding underside probes does not alter the existing direct-only captures.
    // Keep those and refresh only the new captures plus affected second bounces.
    const previousIndices = new Set(zones.previous.map(probe => probe.index))
    zonePlan.first = field.probes.filter(probe => !previousIndices.has(probe.index)).map(probe => probe.index)
  }
  timer.start('ready')
  const interpolationProfile={warmVolumeRows:0,warmFloorRows:0,warmVolumeCpuMs:0,warmFloorCpuMs:0,evaluations:[] as {copyMs:number;decodeMs:number;volumeMs:number;floorMs:number;outputCopyMs:number;visibilityTests:number}[]}
  const interpolationStatistics=()=>({...interpolationProfile,volume:lookup.statistics(),floor:floorLookup.statistics(),preview:previewLookup.statistics(),previewFloor:previewFloorLookup.statistics(),dimensions:{volumeCells:field.volume.rows*field.volume.n,floorCells:field.floors.length*field.floorLayer.n**2,volumeN:field.volume.n,floorN:field.floorLayer.n,probes:field.probes.length}})
  return { field, visibility,
    interpolationStatistics,
    interpolationReuse(){return{volume:lookup.reuseData(),floor:floorLookup.reuseData(),preview:previewLookup.reuseData(),previewFloor:previewFloorLookup.reuseData()}},
    /** Populate geometry-only weights while the renderer captures bounce one.
     * Yield between rows so previews and edit requests can take priority. */
    *warmVisibility() {
      const result = new Float64Array(field.coefficientCount * 3)
      for (let row = 0; row < field.volume.rows; row++) {
        const started=performance.now()
        writeIndirectVolumeRow(field, row, result, visibility, lookup, true)
        interpolationProfile.warmVolumeCpuMs+=performance.now()-started;interpolationProfile.warmVolumeRows++
        yield
      }
      for (let row = 0; row < field.floors.length * field.floorLayer.n; row++) {
        const started=performance.now()
        writeIndirectFloorRow(field, row, visibility, floorLookup, true)
        interpolationProfile.warmFloorCpuMs+=performance.now()-started;interpolationProfile.warmFloorRows++
        yield
      }
    },
    updateLights(positions: [number, number, number][]) {
      if (positions.length !== lights.length) throw new Error('GI light count changed')
      positions.slice(0, INDIRECT_MAX_LOCAL_LIGHTS).forEach((position, index) => {
        if (position.every((value, axis) => value === lights[index][axis])) return
        const point = new Vector3(...position)
        writeIndirectVisibility(field, index, point, visibility)
        writeIndirectPosition(field.positionData, INDIRECT_ATLAS_SIZE ** 2 - INDIRECT_MAX_LOCAL_LIGHTS + index, point)
      })
      lights = positions.map(position => [...position])
      return { distances: field.distanceData.slice(), positions: field.positionData.slice() }
    },
    snapshot() { return { field: serializeIndirectField(field), zonePlan, geometryRefitted: visibility.refitted, prepareTimings: { ...timer.timings }, triangles: { data: triangles.image.data as Float32Array,
      width: triangles.image.width, height: triangles.image.height } } },
    plan(previous: IndirectZoneProbe[], changes: IndirectZoneChange[]) {
      return planIndirectZones(field, visibility, previous, changes)
    },
    gpuPreview() {
      const result = new Float64Array(field.coefficientCount * 3)
      for (let row = 0; row < preview.volume.rows; row++) writeIndirectVolumeRow(preview, row, result, visibility, previewLookup, true)
      for (let row = 0; row < preview.floors.length * preview.floorLayer.n; row++) writeIndirectFloorRow(preview, row, visibility, previewFloorLookup, true)
      return { volume: previewLookup.graph(), floor: previewFloorLookup.graph() }
    },
    preview(coefficients: Uint16Array[], positions: Float32Array) {
      // Separate coefficient buffers preserve completed full-resolution bounce data.
      coefficients.forEach((data, colour) => preview.coefficients[colour].set(data))
      preview.positionData.set(positions)
      previewLookup.refreshCoefficients(); previewFloorLookup.refreshCoefficients()
      const result = new Float64Array(field.coefficientCount * 3)
      for (let row = 0; row < preview.volume.rows; row++) writeIndirectVolumeRow(preview, row, result, visibility, previewLookup)
      writeIndirectFloorLayer(preview, visibility, previewFloorLookup)
      return { volume: preview.volume.data.slice(), floor: preview.floorLayer.data.slice() }
    },
    volume(coefficients: Uint16Array[], positions: Float32Array) {
      let at=performance.now();const beforeRays=lookup.statistics().visibilityTests+floorLookup.statistics().visibilityTests
      coefficients.forEach((values, index) => field.coefficients[index].set(values)); field.positionData.set(positions)
      const copyMs=performance.now()-at;at=performance.now()
      lookup.refreshCoefficients()
      floorLookup.refreshCoefficients()
      const decodeMs=performance.now()-at;at=performance.now()
      const result = new Float64Array(field.coefficientCount * 3)
      for (let row = 0; row < field.volume.rows; row++) writeIndirectVolumeRow(field, row, result, visibility, lookup)
      const volumeMs=performance.now()-at;at=performance.now()
      writeIndirectFloorLayer(field, visibility, floorLookup)
      const floorMs=performance.now()-at;at=performance.now();const data=field.volume.data.slice(),outputCopyMs=performance.now()-at
      interpolationProfile.evaluations.push({copyMs,decodeMs,volumeMs,floorMs,outputCopyMs,visibilityTests:lookup.statistics().visibilityTests+floorLookup.statistics().visibilityTests-beforeRays});if(interpolationProfile.evaluations.length>8)interpolationProfile.evaluations.shift()
      return data
    },
    dispose() { preview.dispose(); field.dispose(); visibility.dispose() },
  }
}
/** Synchronous path used by tests and the serial fallback. */
export function prepareIndirectCache(...args: Parameters<typeof prepareIndirectCacheSteps>) {
  const steps = prepareIndirectCacheSteps(...args)
  let step = steps.next()
  while (!step.done) {
    const { field, visibility, lights } = step.value
    lights.forEach((light, index) => writeIndirectVisibility(field, index, new Vector3(...light), visibility))
    step = steps.next()
  }
  return step.value
}
export type PreparedIndirectCache = ReturnType<ReturnType<typeof prepareIndirectCache>['snapshot']>
export type IndirectInterpolationProfile=ReturnType<ReturnType<typeof prepareIndirectCache>['interpolationStatistics']>
