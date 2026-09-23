import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebGLRenderer } from 'three'
import { withSpecularOnlyImageBasedLighting } from '../src/materials/imageBasedLighting.ts'

test('surface IBL preserves reflections while removing diffuse environment light', () => {
  let baseCompileCalled = false
  const shader = {
    fragmentShader: 'before\n#include <lights_fragment_end>\nafter',
  }
  const overrides = withSpecularOnlyImageBasedLighting({
    onBeforeCompile: (compiledShader) => {
      baseCompileCalled = true
      compiledShader.fragmentShader = compiledShader.fragmentShader.replace(
        'before',
        'variation-before',
      )
    },
    customProgramCacheKey: () => 'variation',
  })

  overrides.onBeforeCompile?.(
    shader as Parameters<NonNullable<typeof overrides.onBeforeCompile>>[0],
    {} as WebGLRenderer,
  )

  assert.equal(baseCompileCalled, true)
  assert.match(shader.fragmentShader, /variation-before/)
  assert.match(shader.fragmentShader, /iblIrradiance = vec3\(0\.0\)/)
  assert.match(shader.fragmentShader, /#include <lights_fragment_end>/)
  assert.equal(
    overrides.customProgramCacheKey?.(),
    'variation-house-designer-specular-ibl-v1',
  )
})
