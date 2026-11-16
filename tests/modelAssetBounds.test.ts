import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, DefaultLoadingManager, Vector3 } from 'three'
import { clearModelAssetBounds, getModelAssetBounds, rememberModelAssetBounds } from '../src/modelAssetBounds.ts'
import { createFloorplanGltfLoader, createFloorplanKtx2Loader } from '../src/floorplanAssetLoading.ts'

test('plan geometry bypasses PBR images and required KTX2 textures entirely', async () => {
  const loader = createFloorplanGltfLoader()
  let textureLoads = 0
  loader.register(() => ({ name: 'TEST_REJECT_PLAN_TEXTURES', loadTexture: () => {
    textureLoads++
    return Promise.reject(new Error('The floor plan must not load a texture'))
  } }))
  const positions = new Float32Array([0,0,0, 2,0,0, 0,0,3])
  const data = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0,0,0], max: [2,0,3] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } }, normalTexture: { index: 1 } }],
    extensionsUsed: ['KHR_texture_basisu'], extensionsRequired: ['KHR_texture_basisu'],
    textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }, { source: 1 }],
    images: [{ uri: 'must-not-load.ktx2' }, { uri: 'must-not-load.png' }],
  }
  const json = Buffer.from(JSON.stringify(data)), jsonLength = Math.ceil(json.length / 4) * 4
  const binary = Buffer.alloc(12 + 8 + jsonLength + 8 + positions.byteLength)
  binary.writeUInt32LE(0x46546c67, 0); binary.writeUInt32LE(2, 4); binary.writeUInt32LE(binary.length, 8)
  binary.writeUInt32LE(jsonLength, 12); binary.writeUInt32LE(0x4e4f534a, 16)
  binary.fill(32, 20, 20 + jsonLength); json.copy(binary, 20)
  binary.writeUInt32LE(positions.byteLength, 20 + jsonLength); binary.writeUInt32LE(0x004e4942, 24 + jsonLength)
  Buffer.from(positions.buffer).copy(binary, 28 + jsonLength)
  const gltf = await loader.parseAsync(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength), '')
  assert.equal(textureLoads, 0)
  const bounds = new Box3().setFromObject(gltf.scene)
  assert.deepEqual(bounds.min.toArray(), [0,0,0])
  assert.deepEqual(bounds.max.toArray(), [2,0,3])
  gltf.scene.traverse(object => {
    if ('isMesh' in object && object.isMesh) {
      const mesh = object as import('three').Mesh
      assert.equal((mesh.material as import('three').MeshBasicMaterial).map, null)
      mesh.geometry.dispose(); (mesh.material as import('three').Material).dispose()
    }
  })
})

test('loaded 3D bounds are reusable plan metadata keyed by the complete asset revision',()=>{
  clearModelAssetBounds()
  const box=new Box3(new Vector3(-1,0,-2),new Vector3(3,2,4))
  const bounds=rememberModelAssetBounds('window.glb?hdModelRefresh=1',box)
  assert.deepEqual(bounds,{width:4,height:2,depth:6,minX:-1,minZ:-2,maxX:3,maxZ:4})
  assert.equal(getModelAssetBounds('window.glb?hdModelRefresh=1'),bounds)
  assert.equal(getModelAssetBounds('window.glb?hdModelRefresh=2'),undefined)
  box.max.set(100,100,100)
  assert.equal(bounds.width,4,'metadata does not borrow mutable geometry bounds')
  assert.equal(Object.isFrozen(bounds),true)
  clearModelAssetBounds();assert.equal(getModelAssetBounds('window.glb?hdModelRefresh=1'),undefined)
})

test('plan GLB and compressed-texture loading cannot publish global 3D progress',()=>{
  const gltf=createFloorplanGltfLoader(),ktx=createFloorplanKtx2Loader()
  assert.notEqual(gltf.manager,DefaultLoadingManager)
  assert.equal(gltf.manager,ktx.manager)
  let globalStarts=0,planErrors=0
  const original=DefaultLoadingManager.onStart,oldError=gltf.manager.onError
  DefaultLoadingManager.onStart=()=>globalStarts++
  gltf.manager.onError=()=>planErrors++
  try{
    gltf.manager.itemStart('plan-only.glb');ktx.manager.itemStart('plan-only.ktx2')
    gltf.manager.itemError('plan-only.glb');gltf.manager.itemEnd('plan-only.glb');ktx.manager.itemEnd('plan-only.ktx2')
    assert.equal(globalStarts,0);assert.equal(planErrors,1,'plan failures remain observable to their owner')
    DefaultLoadingManager.itemStart('real-3d-asset.glb');DefaultLoadingManager.itemEnd('real-3d-asset.glb')
    assert.equal(globalStarts,1,'actual 3D loading keeps its progress notifications')
  }finally{DefaultLoadingManager.onStart=original;gltf.manager.onError=oldError;ktx.dispose()}
})
