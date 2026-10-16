import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareWallRendering, resolveWallEngineFinish } from '../src/wallEngine/wallRenderPreparation.ts'
import { buildWallMeshFaces } from '../src/wallEngine/wallMesh.ts'
import type { SurfaceMaterialAssignment, Wall } from '../src/types.ts'

test('worker wall preparation preserves vertices and batches equivalent side/cap finishes',()=>{
  const wall:Wall={id:'wall',kind:'external',start:{x:0,y:0},end:{x:2,y:0},height:2.4,thickness:.3}
  const faces=buildWallMeshFaces([wall]),original=structuredClone(faces)
  const assignment:SurfaceMaterialAssignment={id:'paint',materialId:'white',target:{type:'wall-face',floorId:'floor',wallId:'wall',side:'both'}}
  const result=structuredClone(prepareWallRendering({kind:'render',faces,walls:[wall],surfaceAssignments:[assignment],floorId:'floor',elevation:0}))
  assert.deepEqual(faces,original,'worker preparation must not mutate canonical clipping faces')
  assert.equal(result.payload.groups.length,2,'equivalent painted faces share one slot; unassigned wall body retains its fallback')
  assert.equal(result.payload.positions.length,faces.length*6*3)
  assert.equal(result.renderFaces.length,faces.length)
  for(const slot of result.payload.materialSlots)assert.equal(resolveWallEngineFinish({source:slot.source,surfaceAssignments:[assignment],wallsById:new Map([['wall',wall]])}).assignment?.materialId,
    slot.source.role==='cap'||typeof slot.source.side==='number'?'white':undefined)
  const side=faces.find(face=>face.pickSource.side===1)!
  const fragment:SurfaceMaterialAssignment={id:'brick',materialId:'brick',target:{type:'wall-surface-fragment',wallId:'wall',side:1,fragmentId:side.faceId}}
  const changed=prepareWallRendering({kind:'render',faces,walls:[wall],surfaceAssignments:[assignment,fragment],floorId:'floor',elevation:0})
  const painted=changed.renderFaces.find(face=>face.faceId===side.faceId)!
  assert.equal(painted.materialSource.fragmentId,side.faceId)
  assert.equal(resolveWallEngineFinish({source:painted.materialSource,surfaceAssignments:[assignment,fragment],wallsById:new Map([['wall',wall]])}).assignment?.materialId,'brick')
})
