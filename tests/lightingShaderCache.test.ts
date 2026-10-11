import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshStandardMaterial, type WebGLRenderer } from 'three'
import { createIndirectField } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms } from '../src/indirectLightingShader.ts'
import { applySpecularOnlyImageBasedLighting } from '../src/materials/imageBasedLighting.ts'
import { applyRoomLightShader, createRoomLightMaskTexture, createRoomLightShaderUniforms } from '../src/roomLightShader.ts'
import { createRoomLightMask } from '../src/roomLightMask.ts'

for (const order of ['room-first', 'indirect-first'] as const) {
  test(`fade clones reuse composed lighting programs when ${order}`, () => {
    const field = createIndirectField([])
    const texture = createRoomLightMaskTexture(createRoomLightMask([], { minX: 0, minZ: 0, size: 4 }, 4))
    const room = createRoomLightShaderUniforms(texture)
    const indirect = createIndirectUniforms(field)
    const original = new MeshStandardMaterial()
    original.customProgramCacheKey = () => 'wall'
    const patch = (material: MeshStandardMaterial) => {
      if (order === 'room-first') applyRoomLightShader(material, room)
      applySpecularOnlyImageBasedLighting(material)
      applyIndirectLightingShader(material, indirect)
      if (order === 'indirect-first') applyRoomLightShader(material, room)
    }
    patch(original)
    const expected = original.customProgramCacheKey()
    for (let i = 0; i < 3; i++) {
      const clone = original.clone()
      clone.onBeforeCompile = original.onBeforeCompile.bind(original)
      clone.customProgramCacheKey = original.customProgramCacheKey.bind(original)
      clone.transparent = true
      patch(clone)
      assert.equal(clone.customProgramCacheKey(), expected)
      const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>' }
      clone.onBeforeCompile(shader as never, {} as WebGLRenderer)
      assert.equal(shader.fragmentShader.split('float hdGIFloor(').length - 1, 1)
      assert.equal(shader.vertexShader.split('varying vec3 hdRoomLightWorldPosition;').length - 1, 1)
      clone.dispose()
    }
    original.dispose(); texture.dispose(); field.dispose()
  })
}
