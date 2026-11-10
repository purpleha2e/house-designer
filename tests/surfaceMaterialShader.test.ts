import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshStandardMaterial, type WebGLRenderer } from 'three'
import { createIndirectField } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms } from '../src/indirectLightingShader.ts'
import { applyRoomLightShader, createRoomLightMaskTexture, createRoomLightShaderUniforms } from '../src/roomLightShader.ts'
import { createRoomLightMask } from '../src/roomLightMask.ts'
import { withSpecularOnlyImageBasedLighting } from '../src/materials/imageBasedLighting.ts'
import { updateSurfaceMaterialShader } from '../src/materials/surfaceMaterialShader.ts'

for (const finishFirst of [true, false]) {
  test(`surface finish updates retain GI and room visibility (${finishFirst ? 'finish' : 'lighting'} installed first)`, () => {
    const field = createIndirectField([])
    const texture = createRoomLightMaskTexture(createRoomLightMask([], { minX: 0, minZ: 0, size: 4 }, 4))
    const material = new MeshStandardMaterial()
    material.customProgramCacheKey = () => 'oak'
    const update = () => updateSurfaceMaterialShader(material, withSpecularOnlyImageBasedLighting())
    try {
      if (finishFirst) update()
      applyRoomLightShader(material, createRoomLightShaderUniforms(texture))
      applyIndirectLightingShader(material, createIndirectUniforms(field))
      if (!finishFirst) update()
      const key = material.customProgramCacheKey()
      for (let i = 0; i < 3; i++) {
        update() // Texture arrivals and environment changes repeat the finish effect.
        const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <project_vertex>',
          fragmentShader: '#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>' }
        material.onBeforeCompile(shader as never, {} as WebGLRenderer)
        assert.ok(shader.uniforms.hdGIEnabled)
        assert.ok(shader.uniforms.hdRoomLightEnabled)
        assert.equal(shader.fragmentShader.split('float hdGIFloor(').length - 1, 1)
        assert.equal(shader.fragmentShader.split('// House Designer: retain environment radiance').length - 1, 1)
        assert.equal(material.customProgramCacheKey(), key)
      }
      updateSurfaceMaterialShader(material, {}) // Removing reflection-only finish retains lighting.
      const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <lights_fragment_begin>\n#include <lights_fragment_end>' }
      material.onBeforeCompile(shader as never, {} as WebGLRenderer)
      assert.ok(shader.uniforms.hdGIEnabled)
      assert.ok(shader.uniforms.hdRoomLightEnabled)
      assert.ok(!shader.fragmentShader.includes('// House Designer: retain environment radiance'))
      assert.notEqual(material.customProgramCacheKey(), key)
    } finally { material.dispose(); texture.dispose(); field.dispose() }
  })
}
