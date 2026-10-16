import assert from 'node:assert/strict'
import test from 'node:test'
import { BatchedMesh, BoxGeometry, Group, InstancedMesh, Light, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PointLight, SpotLight, Scene, Texture, Vector3 } from 'three'
import { createOpaqueViewportScene } from '../src/opaqueViewportScene.ts'
import { createIndirectField } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms, getIndirectLightingUniforms } from '../src/indirectLightingShader.ts'
import { applyRoomLightShader, createRoomLightShaderUniforms, getRoomLightUniforms } from '../src/roomLightShader.ts'

test('early lighting shares diffuse uniforms and room masks while keeping reflections, transparency and shadows out', () => {
  const source = new Scene(), geometry = new BoxGeometry(), environment = new Texture()
  const material = new MeshPhysicalMaterial({ envMap: environment, transmission: 1, transparent: true })
  const field = createIndirectField([], 0), gi = createIndirectUniforms(field), room = createRoomLightShaderUniforms(field.mask)
  room.unshadowedPointRoomIds.value[0] = 7
  applyRoomLightShader(material, room); applyIndirectLightingShader(material, gi)
  const mesh = new Mesh(geometry, material); mesh.receiveShadow = mesh.castShadow = true
  const parent = new Group(), point = new PointLight(0xff0000, 3), spot = new SpotLight(0xffffff, 4)
  parent.position.set(2,3,4); point.position.x = 1; point.castShadow = true; parent.add(point, spot, spot.target)
  spot.target.position.set(1,2,3); source.add(parent, mesh)
  const snapshot = createOpaqueViewportScene(source, { lighting: true })
  const copy = snapshot.scene.children.find(o => o instanceof Mesh) as Mesh
  const lit = copy.material as MeshStandardMaterial
  assert.equal(lit.type, 'MeshStandardMaterial'); assert.equal(lit.envMap, null); assert.equal(lit.transparent, false)
  assert.equal(copy.castShadow, false); assert.equal(copy.receiveShadow, false)
  assert.equal(getIndirectLightingUniforms(lit), gi, 'diffuse publication updates the displayed uniforms without recompilation')
  assert.equal(getRoomLightUniforms(lit)?.pointRoomIds, room.unshadowedPointRoomIds, 'unshadowed stage retains room isolation even with final shadows enabled')
  const light = snapshot.scene.children.find(o => o instanceof PointLight) as PointLight
  assert.equal(light.castShadow, false); assert.deepEqual(light.position.toArray(), [3,3,4])
  point.intensity = 9; point.position.x = 5; snapshot.syncLighting()
  assert.equal(light.intensity, 9); assert.equal(light.position.x, 7)
  const spotCopy = snapshot.scene.children.find(o => o instanceof SpotLight) as SpotLight
  assert.deepEqual(spotCopy.target.position.toArray(), [3,5,7])
  snapshot.dispose(); assert.equal(material.envMap, environment); assert.equal(point.castShadow, true)
  geometry.dispose(); material.dispose(); environment.dispose(); field.dispose(); point.dispose(); spot.dispose()
})

test('opaque startup keeps PBR maps and world transforms without full lighting hooks or pick geometry', () => {
  const scene = new Scene(), parent = new Group(), geometry = new BoxGeometry(), map = new Texture()
  const material = new MeshPhysicalMaterial({ map, normalMap: map, roughnessMap: map, metalnessMap: map, transparent: true, opacity: 0.4, transmission: 1 })
  material.onBeforeCompile = () => { throw Error('full lighting hook must not execute') }
  const mesh = new Mesh(geometry, material); parent.position.set(2,3,4); parent.add(mesh); scene.add(parent)
  const pick = new Mesh(geometry, material); pick.userData.houseDesignerRole = 'wall-engine-pick'; scene.add(pick)
  const hidden = new Mesh(geometry, new MeshStandardMaterial({ opacity: 0 })); scene.add(hidden)
  const snapshot = createOpaqueViewportScene(scene)
  const meshes = snapshot.scene.children.filter(o => o instanceof Mesh)
  assert.equal(meshes.length,1)
  const copy = meshes[0], pbr = copy.material as MeshStandardMaterial
  assert.equal(copy.geometry,geometry)
  assert.deepEqual(copy.getWorldPosition(new Vector3()).toArray(),[2,3,4])
  for (const name of ['map','normalMap','roughnessMap','metalnessMap'] as const) assert.equal(pbr[name],map)
  assert.equal(pbr.transparent,false); assert.equal(pbr.opacity,1); assert.equal(pbr.type,'MeshStandardMaterial')
  assert.notEqual(pbr.onBeforeCompile,material.onBeforeCompile)
  assert.equal(snapshot.scene.children.filter(o => o instanceof Light).length,2)
  let disposed = 0
  geometry.addEventListener('dispose',()=>disposed++); map.addEventListener('dispose',()=>disposed++)
  geometry.dispose(); map.dispose(); assert.equal(disposed,0)
  snapshot.dispose(); snapshot.dispose(); assert.equal(disposed,2)
  material.dispose(); hidden.material.dispose()
})

test('opaque startup preserves ordinary instances and batched transforms', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const instances = new InstancedMesh(geometry, material, 2)
  instances.position.x = 3; instances.setMatrixAt(0,new Matrix4().makeTranslation(1,0,0)); instances.setMatrixAt(1,new Matrix4().makeTranslation(2,0,0))
  const batch = new BatchedMesh(1,24,36,material), id = batch.addInstance(batch.addGeometry(geometry))
  batch.setMatrixAt(id,new Matrix4().makeTranslation(9,0,0)); scene.add(instances,batch)
  const snapshot = createOpaqueViewportScene(scene)
  const ordinary = snapshot.scene.children.filter(o => o instanceof Mesh && !(o instanceof BatchedMesh))
  assert.deepEqual(ordinary.map(o=>o.getWorldPosition(new Vector3()).x),[4,5])
  const copied = snapshot.scene.children.find(o=>o instanceof BatchedMesh) as BatchedMesh
  assert.equal(copied.geometry,batch.geometry)
  const matrix = new Matrix4(); copied.getMatrixAt(id,matrix); assert.equal(matrix.elements[12],9)
  let disposed = 0; batch.geometry.addEventListener('dispose',()=>disposed++)
  snapshot.dispose(); assert.equal(disposed,0)
  batch.dispose(); instances.dispose(); geometry.dispose(); material.dispose()
})
