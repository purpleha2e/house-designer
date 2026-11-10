import assert from 'node:assert/strict'
import test from 'node:test'
import { BackSide, BoxGeometry, BufferGeometry, Float32BufferAttribute, FrontSide, DoubleSide } from 'three'
import { indexGeometry } from '../src/indexedGeometry.ts'
import { batchWallSurfaces, wallSurfaceBatchKey, type WallSurfaceBatchPart } from '../src/wallSurfaceBatching.ts'
import { resolvedWallMaterialBatchKey } from '../src/wallEngine/wallMaterialBatchKey.ts'
import { prepareWallRendering } from '../src/wallEngine/wallRenderPreparation.ts'
import { buildWallMeshFaces } from '../src/wallEngine/wallMesh.ts'
import { createWallBufferGeometry } from '../src/wallEngine/wallThreeGeometry.ts'
import type { SurfaceMaterialAssignment, SurfaceMaterialProduct, Wall } from '../src/types.ts'

const paint: SurfaceMaterialAssignment = { id:'paint',materialId:'paint',target:{type:'wall-face',floorId:'floor',wallId:'wall',side:'both'} }
const material = { id:'paint',pbr:{baseColor:'#ffffff'} } as SurfaceMaterialProduct
const source = (geometry: BufferGeometry, overrides: Partial<WallSurfaceBatchPart> = {}): WallSurfaceBatchPart => ({
  geometry, floorId:'floor',assignment:paint,material,fallback:'external',side:FrontSide,shadowSide:BackSide,
  castShadow:true,receiveShadow:true,renderOrder:0,solidGable:true,roofId:'roof',...overrides,
})
const stream = (geometry: BufferGeometry) => Array.from({ length:geometry.index?.count ?? geometry.getAttribute('position').count }, (_, i) => {
  const vertex=geometry.index?.getX(i)??i
  return Object.entries(geometry.attributes).map(([name,attribute])=>[name,
    Array.from(attribute.array.slice(vertex*attribute.itemSize,(vertex+1)*attribute.itemSize))])
})

test('resolved wall finishes merge across wall kinds; missing materials retain their actual fallback', () => {
  assert.equal(resolvedWallMaterialBatchKey(paint,'external',true),resolvedWallMaterialBatchKey({...paint,id:'other'},'internal',true))
  assert.equal(resolvedWallMaterialBatchKey(paint,'external',false),resolvedWallMaterialBatchKey(undefined,'external',false))
  assert.notEqual(resolvedWallMaterialBatchKey(paint,'external',false),resolvedWallMaterialBatchKey(paint,'internal',false))
  for (const change of [{customColor:'#123456'},{textureScale:2},{textureRotation:90},{materialId:'other'}]) {
    assert.notEqual(resolvedWallMaterialBatchKey(paint,'external',true),resolvedWallMaterialBatchKey({...paint,...change},'external',true))
  }
  assert.equal(resolvedWallMaterialBatchKey(paint,'external',true,false),
    resolvedWallMaterialBatchKey({...paint,textureScale:2,textureRotation:90},'internal',true,false),
    'texture settings have no render effect on textureless paint')
})

test('indexed geometry preserves every attribute, group offset, seam and sub-micrometre vertex', () => {
  const geometry=new BoxGeometry(2,.09,.018).toNonIndexed()
  // Same position/normal can still carry different per-face GI receiver data.
  const offsets=new Float32Array(geometry.getAttribute('position').count*3)
  offsets[9]=.003
  geometry.setAttribute('hdGIReceiverOffset',new Float32BufferAttribute(offsets,3))
  const indexed=indexGeometry(geometry)
  assert.ok(indexed.index)
  assert.deepEqual(stream(indexed),stream(geometry))
  assert.deepEqual(indexed.groups,geometry.groups)
  assert.ok(indexed.getAttribute('position').count<geometry.getAttribute('position').count)
  const tiny=new BufferGeometry()
  tiny.setAttribute('position',new Float32BufferAttribute([0,0,0,1e-8,0,0,0,0,0],3))
  const exact=indexGeometry(tiny)
  assert.equal(exact.getAttribute('position').count,2,'indexing must not round away narrow clipped slivers')
  assert.deepEqual(stream(exact),stream(tiny))
  for(const item of [geometry,indexed,tiny,exact])item.dispose()
})

test('gable batches ignore roof/wall/pick identity but preserve floors and rendering constraints', () => {
  const first=new BoxGeometry(1,1,.2),second=first.toNonIndexed().translate(2,0,0)
  const a=source(first),b=source(second,{wallId:'other-wall',roofId:'other-roof',fallback:'internal',interior:true})
  assert.equal(wallSurfaceBatchKey(a),wallSurfaceBatchKey(b))
  for(const change of [{floorId:'upper'},{side:BackSide},{shadowSide:DoubleSide},{castShadow:false},
    {receiveShadow:false},{renderOrder:2},{polygonOffset:true},{solidGable:false}]){
    assert.notEqual(wallSurfaceBatchKey(a),wallSurfaceBatchKey({...a,...change}))
  }
  const parts=[a,b,source(first,{floorId:'upper'}),source(first,{assignment:{...paint,customColor:'#ff0000'}})]
  const batches=batchWallSurfaces(parts)
  assert.equal(batches.length,3)
  assert.equal(batches[0].sources.length,2)
  assert.deepEqual(stream(batches[0].geometry),[...stream(first),...stream(second)])
  assert.deepEqual(batches[0].geometry.groups,[],'no per-surface draw groups')
  assert.ok(batches.every(batch=>batch.geometry.index&&batch.geometry.boundingBox&&batch.geometry.boundingSphere))
  batches.forEach(batch=>batch.geometry.dispose())
  first.dispose();second.dispose()
})

test('wall worker consolidates available finishes and indexes render geometry without changing pick payloads', () => {
  const walls:Wall[]=[{id:'outside',kind:'external',start:{x:0,y:0},end:{x:2,y:0},height:2.4,thickness:.3},
    {id:'inside',kind:'internal',start:{x:0,y:2},end:{x:2,y:2},height:2.4,thickness:.1}]
  const faces=buildWallMeshFaces(walls)
  const assignments=walls.map(wall=>({...paint,id:wall.id,target:{...paint.target,wallId:wall.id}} as SurfaceMaterialAssignment))
  const input={kind:'render' as const,faces,walls,surfaceAssignments:assignments,floorId:'floor',elevation:0}
  const conservative=prepareWallRendering(input),resolved=prepareWallRendering({...input,availableMaterialIds:['paint']})
  assert.ok(resolved.payload.groups.length<conservative.payload.groups.length)
  const geometry=createWallBufferGeometry(resolved.payload),indexed=createWallBufferGeometry(resolved.payload,true)
  assert.deepEqual(stream(indexed),stream(geometry),'GI corner attributes and triangle order are retained')
  assert.deepEqual(indexed.groups,geometry.groups,'wall fading uses the same six-index face spans')
  geometry.dispose();indexed.dispose()
  const missing=prepareWallRendering({...input,availableMaterialIds:[]})
  assert.equal(missing.payload.groups.length,2,'external/internal fallback colours must remain separate')
})
