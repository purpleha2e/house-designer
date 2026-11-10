import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, DefaultLoadingManager, Vector3 } from 'three'
import { clearModelAssetBounds, getModelAssetBounds, rememberModelAssetBounds } from '../src/modelAssetBounds.ts'
import { createFloorplanGltfLoader, createFloorplanKtx2Loader } from '../src/floorplanAssetLoading.ts'

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
