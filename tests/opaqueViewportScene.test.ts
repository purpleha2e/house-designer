import assert from 'node:assert/strict'
import test from 'node:test'
import { BatchedMesh, BoxGeometry, DirectionalLight, Group, InstancedMesh, Light, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PointLight, SpotLight, Scene, Texture, Vector3, WebGLRenderTarget } from 'three'
import { createOpaqueViewportScene, prepareOpaqueViewportScene } from '../src/opaqueViewportScene.ts'
import { createIndirectField } from '../src/indirectLighting.ts'
import { applyIndirectLightingShader, createIndirectUniforms, getIndirectLightingUniforms } from '../src/indirectLightingShader.ts'
import { applyRoomLightShader, createRoomLightShaderUniforms, getRoomLightUniforms } from '../src/roomLightShader.ts'

test('basic geometry fallback keeps authored colour, glass and cutouts without detailed shader inputs', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), map = new Texture()
  const source = new MeshPhysicalMaterial({ color: '#778899', map, alphaMap: map, alphaTest: .4,
    normalMap: map, roughnessMap: map, metalnessMap: map, aoMap: map, transmission: 1, transparent: true })
  scene.add(new Mesh(geometry, source))
  const display = createOpaqueViewportScene(scene, { basic: true })
  const copy = (display.scene.children.find(o => o instanceof Mesh) as Mesh).material as MeshStandardMaterial
  assert.equal(display.scene.userData.basicGeometryViewport, true)
  assert.ok(copy.color.equals(source.color)); assert.equal(copy.map, map); assert.equal(copy.alphaMap, map)
  assert.equal(copy.alphaTest, .4); assert.equal(copy.transparent, true); assert.ok(copy.opacity < 1)
  for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) assert.equal(copy[key], null)
  assert.equal(source.normalMap, map); assert.equal(source.transmission, 1)
  display.dispose(); geometry.dispose(); source.dispose(); map.dispose()
})

test('early sunlight preserves casters, receivers and hidden ceiling blockers without owning the source shadow map', () => {
  const source = new Scene(), sun = new DirectionalLight(), geometry = new BoxGeometry()
  sun.userData.houseDesignerRole = 'sun-light'; sun.castShadow = true
  sun.shadow.map = new WebGLRenderTarget(16,16)
  let disposed = 0; sun.shadow.map.addEventListener('dispose',()=>disposed++)
  const surface = new Mesh(geometry,new MeshStandardMaterial())
  surface.castShadow = surface.receiveShadow = true
  const blocker = new Mesh(geometry,new MeshStandardMaterial({colorWrite:false}))
  blocker.userData.houseDesignerSunShadowBlocker = true; blocker.visible = false; blocker.castShadow = true
  source.add(sun,sun.target,surface,blocker)
  const snapshot = createOpaqueViewportScene(source,{lighting:true})
  assert.equal(snapshot.scene.userData.preparedLightingViewport,true)
  const light = snapshot.scene.children.find(o=>o instanceof DirectionalLight) as DirectionalLight
  assert.equal(light.castShadow,true); assert.equal(light.shadow,sun.shadow)
  const copy = snapshot.scene.children.find(o=>o instanceof Mesh&&!o.userData.houseDesignerSunShadowBlocker) as Mesh
  assert.equal(copy.castShadow,true); assert.equal(copy.receiveShadow,true)
  const shadowBlocker = snapshot.scene.children.find(o=>o.userData.houseDesignerSunShadowBlocker) as Mesh
  assert.ok(shadowBlocker); assert.equal(shadowBlocker.castShadow,true); assert.equal(shadowBlocker.visible,false)
  snapshot.dispose(); assert.equal(disposed,0,'releasing the preview must not clear the live sun map')
  sun.dispose(); geometry.dispose(); (surface.material as MeshStandardMaterial).dispose(); (blocker.material as MeshStandardMaterial).dispose()
})

test('startup copies yield to input and release partial resources on cancellation', async () => {
  const source = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  for (let i = 0; i < 2000; i++) source.add(new Mesh(geometry, material))
  let cancelled = false, heartbeat = false, disposed = 0
  geometry.addEventListener('dispose', () => disposed++)
  const work = prepareOpaqueViewportScene(source, {}, () => cancelled)
  setTimeout(() => { heartbeat = true; cancelled = true; geometry.dispose() }, 0)
  assert.equal(await work, undefined)
  assert.equal(heartbeat, true)
  assert.equal(disposed, 1, 'cancelled copies release any leases on source geometry')
  assert.equal(source.children.length, 2000)
  material.dispose()
})

test('a cooperative startup copy cannot revive a detached geometry owner', async () => {
  const source = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const mesh = new Mesh(geometry, material); source.add(mesh)
  let disposed = 0; geometry.addEventListener('dispose', () => disposed++)
  const work = prepareOpaqueViewportScene(source, { basic: true }, () => false)
  mesh.removeFromParent(); geometry.dispose()
  const display = await work
  assert.equal(display?.meshes, 0)
  assert.equal(display?.scene.children.some(o => o instanceof Mesh), false)
  display?.dispose(); assert.equal(disposed, 1); material.dispose()
})

test('early lighting shares diffuse uniforms and room masks with alpha glass, without reflections or shadows', () => {
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
  assert.equal(lit.type, 'MeshStandardMaterial'); assert.equal(lit.envMap, null); assert.equal(lit.transparent, true)
  assert.ok(Math.abs(lit.opacity - .1) < 1e-6); assert.equal(lit.depthWrite, false)
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
  assert.equal(pbr.transparent,true); assert.ok(Math.abs(pbr.opacity - .04) < 1e-6); assert.equal(pbr.type,'MeshStandardMaterial')
  assert.notEqual(pbr.onBeforeCompile,material.onBeforeCompile)
  assert.equal(snapshot.scene.children.filter(o => o instanceof Light).length,2)
  let disposed = 0
  geometry.addEventListener('dispose',()=>disposed++); map.addEventListener('dispose',()=>disposed++)
  geometry.dispose(); map.dispose(); assert.equal(disposed,0)
  snapshot.dispose(); snapshot.dispose(); assert.equal(disposed,2)
  material.dispose(); hidden.material.dispose()
})

test('startup preserves ordinary glass opacity and texture cutouts without changing the source', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), alphaMap = new Texture()
  const glass = new MeshStandardMaterial({ transparent: true, opacity: .32 })
  const cutout = new MeshStandardMaterial({ alphaMap, alphaTest: .5 })
  scene.add(new Mesh(geometry, glass), new Mesh(geometry, cutout))
  const snapshot = createOpaqueViewportScene(scene)
  const copies = snapshot.scene.children.filter(o => o instanceof Mesh).map(o => o.material as MeshStandardMaterial)
  assert.equal(copies[0].opacity, .32); assert.equal(copies[0].transparent, true)
  assert.equal(copies[0].depthWrite, false); assert.equal(copies[0].forceSinglePass, true)
  assert.equal(copies[1].alphaMap, alphaMap); assert.equal(copies[1].alphaTest, .5)
  assert.equal(copies[1].transparent, false); assert.equal(copies[1].depthWrite, true)
  assert.equal(glass.depthWrite, true); assert.equal(glass.opacity, .32)
  snapshot.dispose(); geometry.dispose(); glass.dispose(); cutout.dispose(); alphaMap.dispose()
})

test('opaque startup preserves ordinary instances and batched transforms', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial()
  const instances = new InstancedMesh(geometry, material, 2)
  instances.position.x = 3; instances.setMatrixAt(0,new Matrix4().makeTranslation(1,0,0)); instances.setMatrixAt(1,new Matrix4().makeTranslation(2,0,0))
  const batch = new BatchedMesh(1,24,36,material), id = batch.addInstance(batch.addGeometry(geometry))
  batch.setMatrixAt(id,new Matrix4().makeTranslation(9,0,0)); scene.add(instances,batch)
  const snapshot = createOpaqueViewportScene(scene)
  const ordinary = snapshot.scene.children.filter(o => o instanceof Mesh && !(o instanceof BatchedMesh))
  assert.equal(ordinary.length, 1, 'instances stay in one draw instead of becoming individual meshes')
  const instanced = ordinary[0] as InstancedMesh
  assert.ok(instanced instanceof InstancedMesh)
  const world = new Matrix4()
  assert.deepEqual([0, 1].map(i => {
    instanced.getMatrixAt(i, world); world.premultiply(instanced.matrixWorld); return world.elements[12]
  }), [4, 5])
  const copied = snapshot.scene.children.find(o=>o instanceof BatchedMesh) as BatchedMesh
  assert.equal(copied.geometry,batch.geometry)
  const matrix = new Matrix4(); copied.getMatrixAt(id,matrix); assert.equal(matrix.elements[12],9)
  let disposed = 0; batch.geometry.addEventListener('dispose',()=>disposed++)
  snapshot.dispose(); assert.equal(disposed,0)
  batch.dispose(); instances.dispose(); geometry.dispose(); material.dispose()
})
