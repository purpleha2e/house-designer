import assert from 'node:assert/strict'
import test from 'node:test'
import { Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, ShaderLib, UniformsUtils, type WebGLRenderer } from 'three'
import { bakeExteriorSkyOcclusion } from '../src/exteriorSkyOcclusion.ts'
import { snapshotIndirectGeometry } from '../src/indirectVisibility.ts'
import { createIndirectField } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms, enableExteriorSkyMaterial, ensureExteriorSkyUniforms } from '../src/indirectLightingShader.ts'
import { isExteriorSkyOccluder, isExteriorSkyReceiver } from '../src/exteriorSkyReceivers.ts'

test('opening frames receive exterior occlusion while glass and furniture retain their lighting', () => {
  const root = new Group(), frame = new MeshStandardMaterial(), glass = new MeshPhysicalMaterial({ transmission: 1 })
  const mesh = new Mesh(new PlaneGeometry(), [frame, glass])
  root.add(mesh)
  try {
    assert.equal(isExteriorSkyReceiver(mesh, frame), false, 'ordinary furniture is not opted in')
    root.userData.exteriorSkyReceiver = true
    mesh.visible = false // Sources hidden by instancing still identify shared receiver materials.
    assert.equal(isExteriorSkyReceiver(mesh, frame), true)
    assert.equal(isExteriorSkyReceiver(mesh, glass), false)
    assert.equal(isExteriorSkyOccluder(mesh), false, 'opening receivers do not alter the architecture bake')
  } finally { frame.dispose(); glass.dispose(); mesh.geometry.dispose() }
})

test('baked visibility distinguishes sheltered and exposed sky without changing geometry', () => {
  const scene = new Group(), geometry = new PlaneGeometry(4, 4), material = new MeshStandardMaterial()
  const roof = new Mesh(geometry, material); roof.position.y = 2; roof.rotation.x = -Math.PI / 2; scene.add(roof)
  try {
    const before = geometry.attributes.position.array.slice()
    const field = bakeExteriorSkyOcclusion(snapshotIndirectGeometry(scene))
    const sample = (x: number, y: number, z: number, axis: number) => {
      const p = [x, y, z].map((v, a) => Math.round((v - field.min[a]) / field.cell))
      return field.positive[(p[0] + field.dimensions[0] * (p[1] + field.dimensions[1] * p[2])) * 4 + axis] / 255
    }
    const sheltered = sample(0, 1.5, 0, 1), exposed = sample(0, 2.5, 0, 1)
    assert.ok(sheltered < .2, `under roof: ${sheltered}`)
    assert.ok(exposed > .95, `above roof: ${exposed}`)
    assert.equal(field.rays, field.dimensions.reduce((a, b) => a * b, 1) * 48)
    assert.ok(field.positive.byteLength + field.negative.byteLength <= 80000 * 8)
    assert.deepEqual(geometry.attributes.position.array, before)
  } finally { geometry.dispose(); material.dispose() }
})

test('sky experiment uses a separate shader variant, uniform comparisons and capture exclusion', () => {
  const field = createIndirectField([]), material = new MeshStandardMaterial(), uniforms = createIndirectUniforms(field)
  try {
    applyIndirectLightingShader(material, uniforms)
    const original = material.customProgramCacheKey()
    uniforms.hdExteriorSkyFeature.value = 1
    assert.equal(material.customProgramCacheKey(), original, 'unrelated furniture keeps its texture budget')
    enableExteriorSkyMaterial(material)
    const enabled = material.customProgramCacheKey()
    assert.notEqual(enabled, original)
    uniforms.hdExteriorSkyStrength.value = .75
    const shader = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader }
    material.onBeforeCompile(shader as never, {} as WebGLRenderer)
    assert.ok(shader.fragmentShader.startsWith('#define HD_EXTERIOR_SKY_OCCLUSION'))
    assert.ok(shader.fragmentShader.includes('if (hdGICapture < .5 && hdExteriorSkyStrength > 0.0)'))
    assert.ok(shader.fragmentShader.includes('radiance *= reflectionVisibility'))
    assert.ok(shader.fragmentShader.includes('if (hdGILocalReflection < .5)'))
    uniforms.hdExteriorSkyStrength.value = 0
    assert.equal(material.customProgramCacheKey(), enabled, 'comparison toggles reuse the shader')
  } finally { field.dispose(); material.dispose() }
})

test('an already-open editor upgrades sky-only lighting state before compiling the eave shader', () => {
  const field = createIndirectField([]), material = new MeshStandardMaterial(), uniforms = createIndirectUniforms(field)
  const skyStrength = uniforms.hdExteriorSkyStrength, skyField = uniforms.hdExteriorSkyField
  const floorCount = uniforms.hdGIFloorCount
  uniforms.hdExteriorSkyFeature.value = 1
  skyStrength.value = .65
  for (const key of Object.keys(uniforms).filter(key => key.startsWith('hdExteriorEave'))) Reflect.deleteProperty(uniforms, key)
  try {
    applyIndirectLightingShader(material, uniforms)
    enableExteriorSkyMaterial(material)
    const shader = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader }
    material.onBeforeCompile(shader as never, {} as WebGLRenderer)
    assert.ok(shader.uniforms.hdExteriorEaveLayers)
    assert.equal(uniforms.hdExteriorEaveLayers.value, 0, 'roof data starts disabled until bound')
    assert.equal(uniforms.hdExteriorSkyStrength, skyStrength)
    assert.equal(uniforms.hdExteriorSkyStrength.value, .65)
    assert.equal(uniforms.hdExteriorSkyField, skyField)
    assert.equal(uniforms.hdGIFloorCount, floorCount)
    uniforms.hdExteriorEaveLayers.value = 5
    assert.equal(ensureExteriorSkyUniforms(uniforms), false)
    assert.equal(uniforms.hdExteriorEaveLayers.value, 5, 'subsequent checks preserve the bound roof data')
  } finally { field.dispose(); material.dispose() }
})
