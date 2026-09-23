import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three'
import {
  createBoxProjectedUvGeometry,
  hasUsableTextureUvs,
} from '../src/modelMaterialUvs.ts'

test('rejects exported UVs that all address one texture pixel', () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 0, 1,
    ], 3),
  )
  geometry.setAttribute(
    'uv',
    new Float32BufferAttribute([
      0, 1,
      0, 1,
      0, 1,
    ], 2),
  )

  assert.equal(hasUsableTextureUvs(geometry), false)
})

test('box projection creates usable UVs without mutating the source geometry', () => {
  const source = new BoxGeometry(1, 1, 1)
  const originalUv = source.getAttribute('uv')
  source.setAttribute(
    'uv',
    new Float32BufferAttribute(new Float32Array(originalUv.count * 2), 2),
  )

  const projected = createBoxProjectedUvGeometry(source)

  assert.notEqual(projected, source)
  assert.equal(hasUsableTextureUvs(source), false)
  assert.equal(hasUsableTextureUvs(projected), true)
  assert.equal(projected.userData.houseDesignerGeneratedUvs, true)
})
