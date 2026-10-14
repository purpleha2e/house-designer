import assert from 'node:assert/strict'
import test from 'node:test'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { createIndirectField, roomProbePoint, type IndirectFloor } from '../src/indirectLighting.ts'
import { snapshotIndirectGeometry, createIndirectVisibilityFromSnapshot, restoreIndirectVisibility, writeIndirectVisibility } from '../src/indirectVisibility.ts'
import { applyIndirectLampRows, traceIndirectLampRows } from '../src/indirectLampPreparation.ts'
import { pointIsInsideRoomPolygon } from '../src/roomLightMask.ts'
import type { Point } from '../src/types.ts'

// Original exhaustive search is the reference for placement and tie breaking.
function exhaustivePoint(polygon: Point[], requested: Point, inset = .18) {
  const clearance = (point: Point) => Math.min(...polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t)
  }))
  if (pointIsInsideRoomPolygon(requested, polygon) && clearance(requested) >= inset) return requested
  const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x))
  const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y))
  let best = polygon[0], score = Infinity
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const point = { x: minX + (x + .5) / 24 * (maxX - minX), y: minY + (y + .5) / 24 * (maxY - minY) }
    if (!pointIsInsideRoomPolygon(point, polygon)) continue
    const next = Math.hypot(point.x - requested.x, point.y - requested.y) + Math.max(0, inset - clearance(point)) * 100
    if (next < score) { best = point; score = next }
  }
  return best
}

test('reused room searches keep the exhaustive probe positions, slots and room priorities', () => {
  const polygons = [
    [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 6 }, { x: 0, y: 6 }],
    [{ x: 1.1, y: 2 }, { x: 1.25, y: 2 }, { x: 1.25, y: 5 }, { x: 1.1, y: 5 }],
    [{ x: 4, y: 2 }, { x: 7, y: 3 }, { x: 6, y: 5 }, { x: 3, y: 4 }],
    [{ x: 20, y: 20 }, { x: 24, y: 20 }, { x: 24, y: 24 }, { x: 20, y: 24 }],
  ]
  const floors: IndirectFloor[] = [{ id: 'ground', elevation: 0, height: 3,
    rooms: polygons.map((polygon, i) => ({ signature: String(i), polygon })) }]
  const field = createIndirectField(floors, 0)
  try {
    for (let z = 0; z < field.n; z++) for (let x = 0; x < field.n; x++) {
      const requested = { x: field.bounds.minX + x * field.spacing, y: field.bounds.minZ + z * field.spacing }
      const inside = field.regions.find(region => pointIsInsideRoomPolygon(requested, region.polygon))
      const nearest = inside ? { region: inside, point: exhaustivePoint(inside.polygon, requested), distance: 0 } : field.regions.map(region => {
        const point = exhaustivePoint(region.polygon, requested)
        return { region, point, distance: Math.hypot(point.x - requested.x, point.y - requested.y) }
      }).sort((a, b) => a.distance - b.distance)[0]
      const index = z * field.n + x, probe = field.probes.find(probe => probe.index === index)
      if (!nearest || nearest.distance > field.spacing) { assert.equal(probe, undefined); continue }
      assert.ok(probe)
      assert.equal(probe.region.id, nearest.region.id)
      assert.deepEqual([probe.position.x, probe.position.z], [nearest.point.x, nearest.point.y])
      assert.deepEqual(roomProbePoint(nearest.region.polygon, requested), exhaustivePoint(nearest.region.polygon, requested))
      const upper = field.probes.find(probe => probe.index === index + field.n ** 2)!
      assert.deepEqual([upper.position.x, upper.position.z], [nearest.point.x, nearest.point.y])
    }
  } finally { field.dispose() }
})

test('cloned BVH rows assemble byte-identical lamp atlases, including reordered primitives and empty geometry', () => {
  const scene = new Group(), material = new MeshStandardMaterial()
  for (let i = 0; i < 8; i++) {
    const wall = new Mesh(new BoxGeometry(.05, 3, 4), material)
    wall.position.set(i * .7, 1.5, 2); scene.add(wall)
  }
  for (const snapshot of [snapshotIndirectGeometry(scene), []]) {
    const visibility = createIndirectVisibilityFromSnapshot(snapshot)
    const restored = restoreIndirectVisibility(structuredClone(visibility.snapshot()))
    const field = createIndirectField([], 5)
    // Small atlas keeps the test fast; row boundaries cross lamps and tile rows.
    field.distanceSize = 16; field.distanceColumns = 3; field.distanceWidth = 48
    field.distanceData = new Float32Array(48 * 32)
    const lights: [number, number, number][] = Array.from({ length: 5 }, (_, i) => [i + .3, .8, 2])
    try {
      lights.forEach((light, i) => writeIndirectVisibility(field, i, new Vector3(...light), visibility))
      const expected = field.distanceData.slice()
      field.distanceData.fill(0)
      for (const [firstRow, rowCount] of [[54, 26], [0, 27], [27, 27]]) {
        applyIndirectLampRows(field, firstRow, traceIndirectLampRows({ lights, size: 16, firstRow, rowCount }, restored))
      }
      assert.deepEqual(field.distanceData, expected)
      assert.deepEqual(visibility.triangleTexture().image.data, restored.triangleTexture().image.data)
      assert.ok(visibility.snapshot().positions.byteLength > 0 || snapshot.length === 0, 'source geometry is never detached')
    } finally { field.dispose(); visibility.dispose(); restored.dispose() }
  }
  scene.traverse(object => { if (object instanceof Mesh) object.geometry.dispose() }); material.dispose()
})

