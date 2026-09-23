import assert from 'node:assert/strict'
import test from 'node:test'
import { MeshBasicMaterial, MeshStandardMaterial, Texture } from 'three'
import {
  applyImportedPbrEnvironment,
  normalizeImportedPbrMaterial,
} from '../src/importedPbrMaterials.ts'

test('keeps valid imported PBR values unchanged', () => {
  const material = new MeshStandardMaterial({ metalness: 1, roughness: 0.3 })
  const originalVersion = material.version

  assert.equal(normalizeImportedPbrMaterial(material), false)
  assert.equal(material.metalness, 1)
  assert.equal(material.roughness, 0.3)
  assert.equal(material.version, originalVersion)
})

test('clamps invalid Blender PBR factors instead of flattening metal to diffuse', () => {
  const material = new MeshStandardMaterial()
  material.metalness = 11.6
  material.roughness = -0.2
  const originalVersion = material.version

  assert.equal(normalizeImportedPbrMaterial(material), true)
  assert.equal(material.metalness, 1)
  assert.equal(material.roughness, 0)
  assert.ok(material.version > originalVersion)
})

test('ignores non-PBR materials', () => {
  const material = new MeshBasicMaterial()

  assert.equal(normalizeImportedPbrMaterial(material), false)
})

test('applies environment lighting only to metallic imported PBR materials', () => {
  const environmentMap = new Texture()
  const metallicMaterial = new MeshStandardMaterial({ metalness: 1 })
  const paintedMaterial = new MeshStandardMaterial({ metalness: 0 })
  const paintedFrameWithExportNoise = new MeshStandardMaterial({ metalness: 0.05 })
  const basicMaterial = new MeshBasicMaterial()

  assert.equal(
    applyImportedPbrEnvironment(metallicMaterial, environmentMap, 0.55),
    true,
  )
  assert.equal(metallicMaterial.envMap, environmentMap)
  assert.equal(metallicMaterial.envMapIntensity, 0.55)
  assert.equal(
    applyImportedPbrEnvironment(metallicMaterial, environmentMap, 0.55),
    false,
  )
  assert.equal(
    applyImportedPbrEnvironment(paintedMaterial, environmentMap, 0.55),
    false,
  )
  assert.equal(paintedMaterial.envMap, null)
  assert.equal(
    applyImportedPbrEnvironment(
      paintedFrameWithExportNoise,
      environmentMap,
      0.55,
    ),
    false,
  )
  assert.equal(paintedFrameWithExportNoise.envMap, null)
  assert.equal(
    applyImportedPbrEnvironment(basicMaterial, environmentMap, 0.55),
    false,
  )
})
