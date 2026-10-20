import assert from 'node:assert/strict'
import test from 'node:test'
import { FloatType, HalfFloatType, UnsignedByteType, UnsignedShortType, type WebGLRenderer } from 'three'
import { installNonBlockingReadbackChecks } from '../src/readbackCapabilities.ts'

test('lighting readbacks skip GPU parameter queries for types already supported by Three', () => {
  const canvas = new EventTarget()
  let queries = 0
  const capabilities = () => ({ textureTypeReadable: () => { queries++; return false } })
  const renderer = { capabilities: capabilities(), extensions: { has: (name: string) => name === 'EXT_color_buffer_float' },
    domElement: canvas } as unknown as WebGLRenderer
  installNonBlockingReadbackChecks(renderer)
  installNonBlockingReadbackChecks(renderer)
  for (const type of [UnsignedByteType, FloatType, HalfFloatType]) assert.equal(renderer.capabilities.textureTypeReadable(type), true)
  assert.equal(queries, 0)
  assert.equal(renderer.capabilities.textureTypeReadable(UnsignedShortType), false, 'other types keep the original capability check')
  assert.equal(queries, 1)
  Object.assign(renderer, { capabilities: capabilities() })
  canvas.dispatchEvent(new Event('webglcontextrestored'))
  assert.equal(renderer.capabilities.textureTypeReadable(HalfFloatType), true)
  assert.equal(queries, 1, 'a restored context retains the nonblocking path')
})

test('half float retains the driver check when no supporting extension exists', () => {
  let queries = 0
  const renderer = { capabilities: { textureTypeReadable: () => { queries++; return true } },
    extensions: { has: () => false }, domElement: new EventTarget() } as unknown as WebGLRenderer
  installNonBlockingReadbackChecks(renderer)
  assert.equal(renderer.capabilities.textureTypeReadable(HalfFloatType), true)
  assert.equal(queries, 1)
})
