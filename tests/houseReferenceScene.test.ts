import assert from 'node:assert/strict'
import { PathTracingSceneGenerator } from 'three-gpu-pathtracer'
import test from 'node:test'
import { BackSide, Color, DirectionalLight, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { createHouseReferenceScene } from '../src/lightingLab/houseReferenceScene.ts'
import type { HouseSnapshot } from '../src/lightingLab/houseBridge.ts'
import type { HousePart } from '../src/lightingLab/houseGeometry.ts'

const quad = (): HousePart => ({ position: new Float32Array([0,0,0, 2,1,0, 2,0,0, 0,0,0, 0,1,0, 2,1,0]),
  ranges: [{ start: 0, count: 6, material: 0 }], matrices: [new Matrix4().toArray()], structural: false })
const input = { lights: [], sunDirection: [0,1,0], sunColour: [0,0,0], daylight: true }
const snapshot = (): HouseSnapshot => ({ parts: [quad()], finishes: [{ colour: [0,0,0], emission: [2.34,2.64,3], map: null, alphaTest: 0, side: 2, daylightEmitter: true }],
  position: [0,0,0], quaternion: [0,0,0,1], fov: 65, prototypeDaylight: true })

test('triangular panes retain their exact emitter mesh instead of a larger rectangular light', () => {
  const source = snapshot(); source.parts[0].ranges[0].count = 3
  const reference = createHouseReferenceScene(source, input, true)
  assert.equal(reference.windowEmitterTriangles, 1); assert.equal(reference.triangles, 1)
  reference.dispose()
})

test('emitter panes retain exact geometry, two-sided radiance, and daylight on/off', () => {
  const source = snapshot(), reference = createHouseReferenceScene(source, input, false)
  const mesh = reference.scene.children.find(o => o instanceof Mesh) as Mesh
  const material = (mesh.material as MeshStandardMaterial)
  assert.equal(reference.triangles, 2); assert.equal(material.side, 2)
  assert.deepEqual(material.emissive.toArray(), source.finishes[0].emission)
  reference.dispose()
  const dark = createHouseReferenceScene(source, { ...input, daylight: false }, true)
  const darkMesh = dark.scene.children.find(o => o instanceof Mesh) as Mesh
  assert.deepEqual((darkMesh.material as MeshStandardMaterial).emissive.toArray(), [0,0,0]); dark.dispose()
})

test('reference preserves full geometry and authored PBR properties with physical two-sided occlusion', () => {
  const source = snapshot(), map = new Texture(), material = new MeshStandardMaterial({ color: '#bbbbbb', roughness: .2, metalness: .7, map, side: BackSide })
  source.parts[0].lightingProxy = 'shared-detail'; source.parts[0].transport = { ...quad(), ranges: [] }
  source.finishes[0] = { colour: material.color.toArray(), emission: [0,0,0], map, alphaTest: 0, side: 0, referenceMaterial: material }
  const reference = createHouseReferenceScene(source, input, false), mesh = reference.scene.children.find(o => o instanceof Mesh) as Mesh
  const copied = (mesh.material as MeshStandardMaterial)
  assert.equal(reference.triangles, 2); assert.equal(copied.roughness, .2); assert.equal(copied.metalness, .7); assert.equal(copied.side, 2)
  assert.equal(material.side, BackSide)
  assert.notEqual(copied.map, map); assert.equal(map.version, 0)
  assert.deepEqual(material.color, new Color('#bbbbbb'))
  reference.dispose(); material.dispose(); map.dispose()
})

test('shared source vertices cannot overwrite the material on an adjacent face', () => {
  const source = snapshot(), part = quad()
  part.position = new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,1,0])
  part.index = new Uint32Array([0,1,2, 1,3,2])
  part.ranges = [{ start: 0, count: 3, material: 0 }, { start: 3, count: 3, material: 1 }]
  source.parts = [part]
  source.finishes = [[1,0,0],[0,0,1]].map(colour => ({ colour, emission: [0,0,0], map: null, alphaTest: 0, side: 2 }))
  const reference = createHouseReferenceScene(source, input, true)
  const generator = new PathTracingSceneGenerator(reference.scene)
  const result = generator.generate(), geometry = result.geometry
  // Check the actual merged geometry consumed by the GPU, whose mesh order
  // differs from the scene order, rather than just checking source groups.
  for (let triangle = 0; triangle < 2; triangle++) {
    const ids = [0,1,2].map(i => geometry.index!.getX(triangle * 3 + i))
    const x = ids.reduce((sum, id) => sum + geometry.attributes.position.getX(id), 0) / 3
    const expected = x < .5 ? [1,0,0] : [0,0,1]
    for (const id of ids) {
      const material = result.materials[geometry.attributes.materialIndex.getX(id)] as MeshStandardMaterial
      assert.deepEqual(material.color.toArray(), expected)
    }
  }
  geometry.dispose()
  reference.dispose()
})

test('exterior reference uses non-emissive clear glass and retains the sky budget and designer sun', () => {
  const source = snapshot(), background = new Texture()
  source.finishes[0] = { ...source.finishes[0], daylightEmitter: false, glazing: true }
  source.exterior = { background, backgroundIntensity: .8, backgroundRotation: [0, .7, 0] }
  const lighting = { ...input, sunDirection: [1, 2, 3], sunColour: [1.3, 1.2, 1.1] }
  const result = createHouseReferenceScene(source, lighting, false)
  const mesh = result.scene.children.find(o => o instanceof Mesh) as Mesh
  const glass = mesh.material as MeshPhysicalMaterial
  assert.equal(result.windowEmitterTriangles, 0)
  assert.equal(glass.transmission, 1); assert.equal(glass.ior, 1.5); assert.equal(glass.thickness, 0)
  assert.deepEqual(glass.emissive.toArray(), [0, 0, 0])
  assert.notEqual(result.scene.background, background)
  assert.equal(result.scene.backgroundIntensity, .8); assert.equal(result.scene.backgroundRotation.y, .7)
  const sun = result.scene.children.find(o => o instanceof DirectionalLight) as DirectionalLight
  assert.deepEqual(sun.color.toArray(), lighting.sunColour)
  assert.ok(sun.position.clone().sub(sun.target.position).normalize().distanceTo(new Vector3(1, 2, 3).normalize()) < 1e-10)
  const previous = createHouseReferenceScene(snapshot(), input, false)
  assert.deepEqual(result.scene.environment!.image.data, previous.scene.environment!.image.data)
  result.dispose(); previous.dispose()
  assert.equal(background.version, 0)
})

