import assert from 'node:assert/strict'
import test from 'node:test'
import { DataTexture, MeshStandardMaterial } from 'three'
import { createRoomLightMask, createRoomLightMaskStack, getRoomLightMaskIdAtPoint } from '../src/roomLightMask.ts'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../src/roomLightShader.ts'
import { buildDoorwayFloorPatches } from '../src/doorwayFloors.ts'
import type { Point, Wall } from '../src/types.ts'
import { createLightPortalTexture } from '../src/roomLightPortals.ts'

test('room boundaries and portal polygons share one atlas without changing record indices', () => {
  const boundaries = Float32Array.from({ length: 1025 * 4 }, (_, index) => index / 4)
  const opening = [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }]
  const packed = createLightPortalTexture([{ y: 3, openings: [opening] }, { y: 6, openings: [] }],
    { minX: 0, minZ: 0, size: 1 }, 4, boundaries)
  try {
    const records = packed.edges.image.data as Float32Array
    assert.deepEqual(records.subarray(0, boundaries.length), boundaries, 'room lookup indices remain unchanged across atlas rows')
    assert.deepEqual(packed.edgeRanges.slice(0, 2).map(range => range.toArray()), [[1025, 1030], [1030, 1030]])
    assert.equal(records[1025 * 4], 4, 'the portal header follows the room records')
    assert.deepEqual(Array.from(records.subarray(1026 * 4, 1027 * 4)), Array.from(new Float32Array([.2, .2, .8, .2])))
  } finally { packed.dispose() }
})

test('overlapping storeys have independent globally unique room IDs in one mask atlas', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
  const mask = createRoomLightMaskStack([{ id: 'upper', elevation: 3, rooms: [{ signature: 'room', polygon }] },
    { id: 'ground', elevation: 0, rooms: [{ signature: 'room', polygon }] }], { minX: 0, minZ: 0, size: 4 }, 32)
  assert.deepEqual(mask.floorHeights, [0, 3]); assert.equal(mask.height, 64)
  const lower = mask.roomIdsBySignature.get('ground:room'), upper = mask.roomIdsBySignature.get('upper:room')
  assert.ok(lower && upper && lower !== upper)
  assert.equal(mask.data[16 * 32 + 16], lower)
  assert.equal(mask.data[(32 + 16) * 32 + 16], upper)
  assert.ok(mask.boundaries[lower * 4 + 1] > mask.boundaries[lower * 4])
  assert.ok(mask.boundaries[upper * 4] >= mask.boundaries[lower * 4 + 1], 'each storey retains its own edge range')
})

test('exact light boundaries merge doorway extensions and retain sub-texel partitions', () => {
  const rectangle = (left: number, bottom: number, right: number, top: number) =>
    [{ x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top }]
  const mask = createRoomLightMask([
    { signature: 'hall', polygon: rectangle(0, 0, 4.0000001, 6) },
    { signature: 'hall', polygon: rectangle(4, 2, 4.15, 3) },
    { signature: 'partition', polygon: rectangle(1.011, 1, 1.021, 5) },
  ], { minX: -2, minZ: -2, size: 10 }, 16)
  const id = mask.roomIdsBySignature.get('hall')!
  const edges = []
  for (let i = mask.boundaries[id * 4]; i < mask.boundaries[id * 4 + 1]; i++) edges.push([...mask.boundaries.slice(i * 4, i * 4 + 4)])
  assert.ok(!edges.some(([ax, az, bx, bz]) => ax === 4 && bx === 4 && Math.min(az, bz) < 3 && Math.max(az, bz) > 2),
    'a doorway and its room have no internal blocking edge')
  for (const x of [1.011, 1.021]) assert.ok(edges.some(([ax, az, bx, bz]) =>
    Math.abs(ax - x) < 1e-6 && Math.abs(bx - x) < 1e-6 && Math.abs(bz - az) === 4),
  'both faces of a 1 cm partition survive even when they occupy one mask cell')
})

test('room light mask gives enclosed rooms distinct ids and leaves exterior points global', () => {
  const mask = createRoomLightMask([
    { signature: 'left', polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
    { signature: 'right', polygon: [{ x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 4 }] },
  ], { minX: -1, minZ: -1, size: 10 }, 100)

  const leftId = mask.roomIdsBySignature.get('left')
  const rightId = mask.roomIdsBySignature.get('right')
  assert.ok(leftId)
  assert.ok(rightId)
  assert.notEqual(leftId, rightId)
  assert.equal(getRoomLightMaskIdAtPoint(mask, { x: 2, y: 2 }), leftId)
  assert.equal(getRoomLightMaskIdAtPoint(mask, { x: 6, y: 2 }), rightId)
  assert.equal(getRoomLightMaskIdAtPoint(mask, { x: 9, y: 2 }), 0)
})

test('room light shader masks point and spot contributions while preserving existing hooks', () => {
  const material = new MeshStandardMaterial()
  let originalHookCalled = false
  const originalHook = () => {
    originalHookCalled = true
  }
  material.onBeforeCompile = originalHook
  const uniforms = createRoomLightShaderUniforms(new DataTexture())
  const restore = applyRoomLightShader(material, uniforms)
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <lights_fragment_begin>',
  }

  material.onBeforeCompile(shader as never, {} as never)
  assert.equal(originalHookCalled, true)
  assert.match(shader.vertexShader, /hdRoomLightWorldPosition/)
  assert.match(shader.fragmentShader, /hdPointLightRoomIds\[hdIndex\]/)
  assert.match(shader.fragmentShader, /hdSpotLightRoomIds\[hdIndex\]/)
  assert.match(shader.fragmentShader, /hdIndex < hdRoomLightVisibilityCount/)
  assert.match(shader.fragmentShader, /directLight.color \*= hdPointVisibilities\[i\]/)
  assert.match(shader.fragmentShader, /directLight.color \*= hdSpotVisibilities\[i\]/)
  assert.doesNotMatch(shader.fragmentShader, /hdRoomLightFactor\(hd(?:Point|Spot)LightRoomIds\[i\]/,
    'Three must not duplicate the room/portal geometry check in its unrolled light loops')
  assert.equal(shader.uniforms.hdRoomLightMask, uniforms.mask)

  restore()
  assert.equal(material.onBeforeCompile, originalHook)
})

test('room lighting reaches boundary surfaces between mask sample centres', () => {
  for (const angle of [0, 0.37, Math.PI / 4]) {
    const polygon = [{ x: -1.3, y: -0.9 }, { x: 1.3, y: -0.9 }, { x: 1.3, y: 0.9 }, { x: -1.3, y: 0.9 }]
      .map(p => ({ x: 3.017 + p.x * Math.cos(angle) - p.y * Math.sin(angle),
        y: 3.013 + p.x * Math.sin(angle) + p.y * Math.cos(angle) }))
    const mask = createRoomLightMask([{ signature: 'room', polygon }], { minX: 0, minZ: 0, size: 6 }, 128)
    const roomId = mask.roomIdsBySignature.get('room')
    for (let edge = 0; edge < polygon.length; edge++) {
      const a = polygon[edge], b = polygon[(edge + 1) % polygon.length]
      for (let i = 0; i <= 100; i++) {
        const t = i / 100
        // Interior points arbitrarily close to the wall/ceiling perimeter
        // must still receive that room's light, including diagonal corners.
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        p.x += (3.017 - p.x) * 0.0001
        p.y += (3.013 - p.y) * 0.0001
        assert.equal(getRoomLightMaskIdAtPoint(mask, p), roomId, `angle ${angle}, edge ${edge}, sample ${i}`)
      }
    }
  }
})

test('room-light hooks inherited by fade clones reuse the same shader cache key', () => {
  const material = new MeshStandardMaterial()
  const uniforms = createRoomLightShaderUniforms(new DataTexture())
  applyRoomLightShader(material, uniforms)
  const clone = material.clone()
  clone.onBeforeCompile = material.onBeforeCompile.bind(material)
  clone.customProgramCacheKey = material.customProgramCacheKey.bind(material)
  applyRoomLightShader(clone, uniforms)
  assert.equal(clone.customProgramCacheKey(), material.customProgramCacheKey())
})

test('boundary coverage preserves room separation across a thin wall', () => {
  const rectangle = (left: number, right: number) =>
    [{ x: left, y: 1.017 }, { x: right, y: 1.017 }, { x: right, y: 4.013 }, { x: left, y: 4.013 }]
  const mask = createRoomLightMask([
    { signature: 'left', polygon: rectangle(1.017, 3.017) },
    { signature: 'right', polygon: rectangle(3.117, 5.117) },
  ], { minX: 0, minZ: 0, size: 6 }, 128)
  assert.equal(getRoomLightMaskIdAtPoint(mask, { x: 3.016, y: 2 }), mask.roomIdsBySignature.get('left'))
  assert.equal(getRoomLightMaskIdAtPoint(mask, { x: 3.118, y: 2 }), mask.roomIdsBySignature.get('right'))
  assert.equal(getRoomLightMaskIdAtPoint(mask, { x: 3.07, y: 2 }), 0)
  assert.equal(getRoomLightMaskIdAtPoint(mask, { x: 0.93, y: 2 }), 0)
})

test('doorway floor strips receive their adjoining room lights without lighting the solid wall', () => {
  for (const angle of [0, 0.37]) {
    const transform = (p: Point) => ({
      x: 4 + p.x * Math.cos(angle) - p.y * Math.sin(angle),
      y: 4 + p.x * Math.sin(angle) + p.y * Math.cos(angle),
    })
    const rectangle = (left: number, right: number) =>
      [{ x: left, y: -2 }, { x: right, y: -2 }, { x: right, y: 2 }, { x: left, y: 2 }].map(transform)
    const rooms = [
      { signature: 'left', polygon: rectangle(-2, -0.05) },
      { signature: 'right', polygon: rectangle(0.05, 2) },
    ]
    const wall: Wall = {
      id: 'partition', kind: 'external', thickness: 0.1, height: 2.4,
      start: transform({ x: 0, y: -2 }), end: transform({ x: 0, y: 2 }),
      openings: [{ id: 'door', modelId: 'door', center: 2, width: 1, bottom: 0, height: 2.1 }],
    }
    const { patches } = buildDoorwayFloorPatches([wall], rooms)
    const mask = createRoomLightMask([...rooms, ...patches.map(patch => ({
      signature: patch.roomSignature, polygon: patch.outline,
    }))], { minX: 0, minZ: 0, size: 8 })
    assert.equal(mask.roomIdsBySignature.size, 2)
    for (const [signature, x] of [['left', -0.025], ['right', 0.025]] as const) {
      const id = mask.roomIdsBySignature.get(signature)
      assert.ok(id)
      assert.equal(getRoomLightMaskIdAtPoint(mask, transform({ x: x * 40, y: 0 })), id)
      for (let y = -0.4; y <= 0.4; y += 0.02) {
        assert.equal(getRoomLightMaskIdAtPoint(mask, transform({ x, y })), id,
          `doorway strip must get ${signature} light at ${angle} radians`)
      }
    }
    assert.equal(getRoomLightMaskIdAtPoint(mask, transform({ x: 0, y: 1 })), 0,
      'the uncut wall beyond the doorway must still block room lighting')
  }
})
