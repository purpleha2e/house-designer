import assert from 'node:assert/strict'
import test from 'node:test'
import { DataTexture, MeshStandardMaterial } from 'three'
import { createRoomLightMask, getRoomLightMaskIdAtPoint } from '../src/roomLightMask.ts'
import { applyRoomLightShader, createRoomLightShaderUniforms } from '../src/roomLightShader.ts'

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
