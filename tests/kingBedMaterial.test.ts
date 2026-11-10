import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the king bed fabric and wood have a diffuse, non-metallic default material', () => {
  const glb = readFileSync(new URL('../src/models/assets/king_bed.glb', import.meta.url))
  assert.equal(glb.readUInt32LE(0), 0x46546c67)
  assert.equal(glb.readUInt32LE(8), glb.length)
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a)
  const model = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString())
  for (const mesh of model.meshes) for (const primitive of mesh.primitives) {
    const material = model.materials[primitive.material]
    assert.ok(material, 'every bed part retains its embedded material')
    assert.equal(material.pbrMetallicRoughness.metallicFactor, 0, 'fabric and wood must receive bounced diffuse light')
    assert.equal(material.pbrMetallicRoughness.roughnessFactor ?? 1, 1)
    assert.ok(primitive.attributes.POSITION !== undefined)
    assert.ok(primitive.attributes.NORMAL !== undefined)
  }
})
