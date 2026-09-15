import assert from 'node:assert/strict'
import test from 'node:test'
import type { SurfaceMaterialAssignment } from '../src/types.ts'
import type { WallMeshFace } from '../src/wallEngine/wallMesh.ts'
import { buildWallBufferGeometryPayload } from '../src/wallEngine/wallBuffer.ts'
import { wallMaterialBatchKey } from '../src/wallEngine/wallMaterialBatchKey.ts'

const finish = (id: string, overrides: Partial<SurfaceMaterialAssignment> = {}): SurfaceMaterialAssignment => ({
  id, materialId:'brick', target:{type:'wall-surface-fragment',wallId:id,fragmentId:id,side:1}, ...overrides,
})

test('batch identity ignores selection and coverage but preserves all per-assignment finish settings', () => {
  const a=finish('a'), key=wallMaterialBatchKey(a,'external')
  assert.equal(key,wallMaterialBatchKey(finish('other',{textureScale:1,textureRotation:0,coverageHeight:1.5}),'external'))
  for(const change of [{materialId:'paint'},{customColor:'#123456'},{textureScale:2},{textureRotation:90}]) {
    assert.notEqual(key,wallMaterialBatchKey(finish('a',change),'external'))
  }
  assert.notEqual(wallMaterialBatchKey(undefined,'external'),wallMaterialBatchKey(undefined,'internal'))
  assert.notEqual(key,wallMaterialBatchKey(a,'internal'),'catalog misses retain the wall kind fallback')
})

test('render batches merge identical finishes while face picking and vertex attributes stay intact', () => {
  const faces: WallMeshFace[] = [0,1,2].map(i=>({
    faceId:`region-${i}`,wallId:`wall-${i}`,kind:'side',normal:[0,0,1],
    materialSource:{wallId:`wall-${i}`,side:1,fragmentId:`region-${i}`},
    pickSource:{wallId:`wall-${i}`,side:1},uvSource:{wallId:`wall-${i}`,side:1},
    vertices:[[i*2,0,0],[i*2+1,0,0],[i*2+1,2,0],[i*2,2,0]]
      .map(position=>({position,uv:[position[0]*0.7+0.3,position[1]+2.7]})) as WallMeshFace['vertices'],
  }))
  const assignments=new Map(faces.map(f=>[f.wallId,finish(f.wallId)]))
  assignments.set('wall-1',finish('wall-1',{customColor:'#123456'}))
  const options={floorId:'floor',materialBatchKey:(source: WallMeshFace['materialSource'])=>wallMaterialBatchKey(assignments.get(source.wallId),'external')}
  const original=buildWallBufferGeometryPayload(faces,{floorId:'floor'})
  const batched=buildWallBufferGeometryPayload(faces,options)
  assert.equal(original.groups.length,3)
  assert.equal(batched.groups.length,2)
  assert.deepEqual(batched.groups[0].faceIds,['region-0','region-2'])
  assert.equal(batched.pickTargets.size,0,'render batches must not masquerade as a single selected wall')
  const attributes=(p:typeof original)=>Array.from({length:p.positions.length/3},(_,i)=>JSON.stringify([
    ...p.positions.slice(i*3,i*3+3),...p.normals.slice(i*3,i*3+3),...p.uvs.slice(i*2,i*2+2),
  ])).sort()
  assert.deepEqual(attributes(batched),attributes(original))
  const picks=buildWallBufferGeometryPayload(faces,{...options,groupBy:'face'})
  assert.equal(picks.groups.length,3)
  assert.deepEqual([...picks.pickTargets.values()].map(t=>t.type==='wall-surface-fragment'?t.fragmentId:null),faces.map(f=>f.faceId))
  assignments.set('wall-2',finish('wall-2',{textureRotation:90}))
  const edited=buildWallBufferGeometryPayload(faces,options)
  assert.equal(edited.groups.length,3,'editing one region separates its batch')
  assert.deepEqual(attributes(edited),attributes(original))
  assignments.set('wall-2',finish('wall-2'))
  assert.equal(buildWallBufferGeometryPayload(faces,options).groups.length,2,'restoring a finish merges its batch again')
})
