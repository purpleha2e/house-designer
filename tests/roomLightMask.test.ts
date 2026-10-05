import assert from 'node:assert/strict'
import test from 'node:test'
import { DataTexture, MeshStandardMaterial } from 'three'
import { createRoomLightMask, getRoomLightMaskIdAtPoint } from '../src/roomLightMask.ts'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../src/roomLightShader.ts'
import { buildDoorwayFloorPatches } from '../src/doorwayFloors.ts'
import type { Point, Wall } from '../src/types.ts'

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
  assert.match(shader.fragmentShader, /hdPointLightRoomIds\[i\]/)
  assert.match(shader.fragmentShader, /hdSpotLightRoomIds\[i\]/)
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
