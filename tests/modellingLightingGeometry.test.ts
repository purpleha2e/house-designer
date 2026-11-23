import assert from 'node:assert/strict'
import test from 'node:test'
import { BatchedMesh, Box3, BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PointLight, Scene, Vector3 } from 'three'
import { isModellingLightingArchitecture, modellingLightingArchitectureRevision } from '../src/modellingLightingGeometry.ts'
import { prepareFastCaptureScene } from '../src/indirectCaptureScene.ts'
import { snapshotFastGIGeometry, voxelizeFastGeometry } from '../src/fastGIGeometry.ts'

test('architecture predicate excludes model hierarchies, instances, batches and helpers', () => {
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial(), scene = new Scene()
  const floor = new Group(); floor.userData.houseDesignerRole = 'doorway-floor'
  const floorMesh = new Mesh(geometry, material); floor.add(floorMesh); scene.add(floor)
  assert.equal(isModellingLightingArchitecture(floorMesh), true, 'generated floors can inherit their shell role')
  const model = new Group(); model.name = 'model-transform-chair'
  const modelMesh = new Mesh(geometry, material); modelMesh.userData.houseDesignerRole = 'wall-engine-render'; model.add(modelMesh); scene.add(model)
  assert.equal(isModellingLightingArchitecture(modelMesh), false, 'an imported model cannot spoof shell ancestry')
  const instance = new InstancedMesh(geometry, material, 1); instance.userData.houseDesignerRole = 'model-batch'; scene.add(instance)
  const batch = new BatchedMesh(1, 24, 36, material); batch.userData.houseDesignerRole = 'model-batches'; scene.add(batch)
  assert.equal(isModellingLightingArchitecture(instance), false)
  assert.equal(isModellingLightingArchitecture(batch), false)
  const helper = new Mesh(geometry, material); helper.userData.houseDesignerRole = 'wall-engine-highlight'; floor.add(helper)
  assert.equal(isModellingLightingArchitecture(helper), false)
  const untagged = new Mesh(geometry, material); scene.add(untagged)
  assert.equal(isModellingLightingArchitecture(untagged), false)
  instance.dispose(); batch.dispose(); geometry.dispose(); material.dispose()
})

test('architecture capture and occupancy retain real openings while excluding complex model transport', async () => {
  const scene = new Scene(), material = new MeshStandardMaterial(), geometries: BoxGeometry[] = []
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, parent: Group | Scene = scene) => {
    const geometry = new BoxGeometry(w, h, d); geometries.push(geometry)
    const mesh = new Mesh(geometry, material); mesh.name = name; mesh.position.set(x, y, z)
    mesh.userData.houseDesignerRole = 'wall-engine-render'; parent.add(mesh); return mesh
  }
  // This is the wall engine's cut-out topology, not a whole-wall bounding box.
  box('left-jamb', .5, 2, 2, 1, 4, .1)
  box('right-jamb', 3.5, 2, 2, 1, 4, .1)
  box('window-sill', 2, .5, 2, 2, 1, .1)
  box('window-header', 2, 3.5, 2, 2, 1, .1)
  const model = new Group(); model.name = 'model-transform-complex-sofa'; scene.add(model)
  box('furniture', 2, 2, 1, 2, 2, .1, model)
  const lamp = new PointLight(); lamp.position.set(2, 2, 0); scene.add(lamp)
  scene.updateMatrixWorld(true)
  const capture = await prepareFastCaptureScene(scene, () => false, isModellingLightingArchitecture)
  assert.ok(capture)
  assert.equal(capture.sourceMeshes, 4)
  assert.equal(capture.scene.getObjectByName('furniture'), undefined)
  assert.equal((capture.scene.getObjectByName('left-jamb') as Mesh).geometry, (scene.getObjectByName('left-jamb') as Mesh).geometry,
    'capture keeps exact opening triangles')
  assert.ok(capture.scene.children.some(object => object instanceof PointLight), 'lamp emitters remain active')
  const parts = snapshotFastGIGeometry(scene, new Box3(new Vector3(), new Vector3(4, 4, 4)), isModellingLightingArchitecture)
  assert.equal(parts.length, 4)
  const { data } = voxelizeFastGeometry(parts, [0, 0, 0], [4, 4, 4], 32)
  const occupied = (x: number, y: number, z: number) => data[Math.floor(x * 8) + Math.floor(z * 8) * 32 + Math.floor(y * 8) * 1024] !== 0
  assert.equal(occupied(2, 2, 2), false, 'window/door opening stays clear')
  assert.equal(occupied(.5, 2, 2), true, 'opening jamb still blocks light')
  assert.equal(occupied(2, 2, 1), false, 'excluded furniture cannot shadow bounced light')
  capture.dispose(); geometries.forEach(geometry => geometry.dispose()); material.dispose()
})

test('shell revision follows wall geometry and colour, but ignores furniture transforms and finishes', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), furnitureGeometry = new BoxGeometry(), wallMaterial = new MeshStandardMaterial(), furnitureMaterial = new MeshStandardMaterial()
  const wall = new Mesh(geometry, wallMaterial); wall.userData.houseDesignerRole = 'wall-engine-render'; scene.add(wall)
  const model = new Group(); model.name = 'model-transform-bed'; scene.add(model)
  const furniture = new Mesh(furnitureGeometry, furnitureMaterial); model.add(furniture)
  const initial = modellingLightingArchitectureRevision(scene)
  model.position.x = 5; furnitureMaterial.color.set('red'); furniture.geometry.attributes.normal.needsUpdate = true
  assert.equal(modellingLightingArchitectureRevision(scene), initial)
  wallMaterial.color.set('blue')
  const recoloured = modellingLightingArchitectureRevision(scene)
  assert.notEqual(recoloured, initial)
  wall.position.x = 1
  assert.notEqual(modellingLightingArchitectureRevision(scene), recoloured)
  geometry.dispose(); furnitureGeometry.dispose(); wallMaterial.dispose(); furnitureMaterial.dispose()
})

test('generated dormer shell stays structural while its imported window remains receiver-only', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const container = new Group(); container.name = 'model-transform-dormer'
  container.userData.lightingModelId = 'dormer'; container.userData.modellingArchitectureContainer = true; scene.add(container)
  const roof = new Mesh(geometry, material); roof.userData.houseDesignerRole = 'dormer-roof-shell'; container.add(roof)
  const frameContainer = new Group(); frameContainer.userData.houseDesignerRole = 'dormer-window'; container.add(frameContainer)
  const frame = new Mesh(geometry, material); frame.userData.houseDesignerRole = 'wall-engine-render'; frameContainer.add(frame)
  assert.equal(isModellingLightingArchitecture(roof), true)
  assert.equal(isModellingLightingArchitecture(frame), false)
  const key = modellingLightingArchitectureRevision(scene)
  frame.position.x = 1
  assert.equal(modellingLightingArchitectureRevision(scene), key)
  roof.position.x = 1
  assert.notEqual(modellingLightingArchitectureRevision(scene), key)
  geometry.dispose(); material.dispose()
})
